const {
  CHROME_USER_DATA_DIR,
  CHROME_PROFILE_DIRECTORY,
  CHROME_EXECUTABLE_PATH,
  DEFAULT_TIMEOUT_MS,
} = require('../config');
const { getOrCreateBrowserContext } = require('../browser');

// Workday application assistant (page-by-page).
//
// Design principles:
//   * NOT autopilot. Every field is a best-effort attempt; the user reviews and
//     clicks "Save & Continue" themselves.
//   * Each page is an independent unit. If one page fails to autofill (missing
//     selector, tenant-specific markup, unexpected exception), the loop still
//     runs autofill for the NEXT page when the user navigates there.
//   * Each FIELD inside a page is also independent — one bad field does not
//     stop the rest of that page's fields.
//
// Pages this assistant knows about (in the order Workday presents them):
//   1. legal_notice          → click "Accept" (blocking modal on some tenants)
//   2. apply_gate            → click Apply / Get Started
//   3. apply_choice          → click "Apply Manually"
//   4. sign_in_prompt        → click Sign In (opens sign-in modal)
//   5. sign_in               → fill email/password, submit
//   6. create_account        → fill signup fields, submit
//   7. my_information        → contact info, name, address, phone
//   8. my_experience         → work history, education, skills, resume, links
//   9. application_questions → tenant-specific ("how did you hear?", etc.)
//  10. voluntary_disclosures → gender, ethnicity, veteran, agreement
//  11. self_identification   → name, signature date, disability
//  12. review                → no autofill; user submits manually
//
// The session ends when confirmation is detected, the user closes the tab,
// or MAX_SESSION_MS elapses.

const POLL_INTERVAL_MS = 2000;
const MAX_SESSION_MS = 45 * 60 * 1000;
const AUTOFILL_COOLDOWN_MS = 4000;

function logStep(step, details = {}) {
  console.log('[workday]', JSON.stringify({
    timestamp: new Date().toISOString(),
    step,
    ...details,
  }));
}

// --- resilience helpers ------------------------------------------------------

// Run `fn` and swallow any exception. If it throws we log and return null so
// the rest of the page keeps trying. Use this to isolate every field / section
// on a page — one bad selector never aborts the whole autofill for that page.
async function guarded(label, fn) {
  try {
    return await fn();
  } catch (error) {
    logStep('field_error', { label, error: error.message });
    return null;
  }
}

// --- selector helpers --------------------------------------------------------

async function isVisible(page, selector, timeoutMs = 300) {
  try {
    await page.waitForSelector(selector, { state: 'visible', timeout: timeoutMs });
    return true;
  } catch (_) {
    return false;
  }
}

async function safeClick(page, selector, timeoutMs = 400) {
  try {
    const el = page.locator(selector).first();
    await el.waitFor({ state: 'visible', timeout: timeoutMs });
    await el.click({ delay: 60 });
    return true;
  } catch (_) {
    return false;
  }
}

// Fill only if visible AND currently empty (don't clobber the user's edits).
async function safeFill(page, selector, value) {
  if (value === undefined || value === null || value === '') return false;
  try {
    const el = page.locator(selector).first();
    if (!(await el.isVisible({ timeout: 300 }).catch(() => false))) return false;
    const current = await el.inputValue().catch(() => '');
    if (current && current.trim() !== '') return false;
    await el.fill(String(value));
    return true;
  } catch (_) {
    return false;
  }
}

// Workday dropdown pattern: click trigger, type option, Enter.
async function safeTypeahead(page, triggerSelector, value) {
  if (!value) return false;
  try {
    const el = page.locator(triggerSelector).first();
    if (!(await el.isVisible({ timeout: 300 }).catch(() => false))) return false;
    // Skip if the dropdown already shows a chosen value (not the placeholder).
    const chosen = (await el.innerText().catch(() => '')).trim().toLowerCase();
    if (chosen && !/select one|choose/i.test(chosen) && chosen !== '') return false;
    await el.click();
    await page.waitForTimeout(200);
    await page.keyboard.type(String(value), { delay: 70 });
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    return true;
  } catch (_) {
    return false;
  }
}

// --- label-based fallbacks ---------------------------------------------------

// Find a Workday `formField-*` container by its visible label text and return
// its inner <input> / <textarea>. Tenants rename their private data-automation-ids
// but the visible labels stay the same — this is the resilient fallback path.
function labelledFormField(page, labelPattern) {
  return page.locator('div[data-automation-id^="formField-"]', { hasText: labelPattern }).first();
}

async function fillByLabel(page, labelPattern, value) {
  if (!value) return false;
  try {
    const field = labelledFormField(page, labelPattern);
    if (!(await field.isVisible({ timeout: 300 }).catch(() => false))) return false;
    const input = field.locator('input, textarea').first();
    if (!(await input.isVisible({ timeout: 300 }).catch(() => false))) return false;
    const current = await input.inputValue().catch(() => '');
    if (current && current.trim()) return false;
    await input.fill(String(value));
    return true;
  } catch (_) {
    return false;
  }
}

async function typeaheadByLabel(page, labelPattern, value) {
  if (!value) return false;
  try {
    const field = labelledFormField(page, labelPattern);
    if (!(await field.isVisible({ timeout: 300 }).catch(() => false))) return false;
    const trigger = field.locator('button').first();
    if (!(await trigger.isVisible({ timeout: 300 }).catch(() => false))) return false;
    const chosen = (await trigger.innerText().catch(() => '')).trim().toLowerCase();
    if (chosen && !/select one|choose/i.test(chosen) && chosen !== '') return false;
    await trigger.click();
    await page.waitForTimeout(200);
    await page.keyboard.type(String(value), { delay: 70 });
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    return true;
  } catch (_) {
    return false;
  }
}

// Try selector-first, fall back to label lookup. Returns true if either worked.
async function fillFieldWithFallback(page, selector, labelPattern, value) {
  if (await safeFill(page, selector, value)) return true;
  return await fillByLabel(page, labelPattern, value);
}

// Workday's phone number field expects just the LOCAL digits — the country
// code lives in a separate dropdown (`+91`, `+1`, etc). If the profile stores
// the number with a leading "+countryCode" prefix (a natural way to write it),
// strip that prefix here so the field doesn't error on submit.
function normalizePhoneNumber(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (!s.startsWith('+')) return s;
  return s.replace(/^\+\d{1,3}[-\s]?/, '');
}

async function typeaheadWithFallback(page, triggerSelector, labelPattern, value) {
  if (await safeTypeahead(page, triggerSelector, value)) return true;
  return await typeaheadByLabel(page, labelPattern, value);
}

// Dumps every formField-* container inside the page with its label and the
// automation-ids of its input / textarea / button children. Run once per page
// type when we detect a page but don't recognise its fields.
async function debugFormFields(page) {
  try {
    return await page.evaluate(() => {
      const containers = document.querySelectorAll('div[data-automation-id^="formField-"]');
      const result = [];
      for (const c of containers) {
        const rect = c.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const label = (c.querySelector('label')?.textContent || '').trim();
        const containerId = c.getAttribute('data-automation-id');
        const inner = [];
        for (const n of c.querySelectorAll('[data-automation-id]')) {
          const id = n.getAttribute('data-automation-id');
          if (id === containerId) continue;
          inner.push({ tag: n.tagName.toLowerCase(), id });
          if (inner.length >= 4) break;
        }
        result.push({ container: containerId, label, inner });
        if (result.length >= 30) break;
      }
      return result;
    });
  } catch (_) {
    return [];
  }
}

// --- page detection ----------------------------------------------------------

// Priority order matters: blocking modals first, then modal-open sign-in states,
// then form pages, then generic fallback (adventure button).
//
// Newer AspenTech-style Workday tenants use `applyFlow*Page` container IDs.
// Legacy tenants use `*Page` (no prefix). Support both.
async function detectPage(page) {
  const url = page.url();
  if (/confirmation|thankyou|thank-you|submitted/i.test(url)) return 'confirmation';

  // Blocking legal / cookie notice — must be dismissed before the form is usable.
  if (await isVisible(page, 'button[data-automation-id="legalNoticeAcceptButton"]')) {
    return 'legal_notice';
  }

  // Sign-in / register modal already OPEN.
  if (await isVisible(page, 'button[data-automation-id="createAccountSubmitButton"]')) return 'create_account';
  if (await isVisible(page, 'button[data-automation-id="signInSubmitButton"]')) return 'sign_in';

  // Sign-in / register modal CLOSED — buttons that OPEN it.
  if (await isVisible(page, 'button[data-automation-id="utilityButtonSignIn"], button[data-automation-id="signInLink"], a[data-automation-id="signInLink"]')) {
    return 'sign_in_prompt';
  }
  if (await isVisible(page, 'button[data-automation-id="createAccountLink"], a[data-automation-id="createAccountLink"]')) {
    return 'create_account_prompt';
  }

  if (await isVisible(page, 'a[data-automation-id="applyManually"]')) return 'apply_choice';

  // Form pages. Each supports both the legacy container id and the newer
  // `applyFlow*Page` alias so we work across tenants.
  if (await isVisible(page,
    'div[data-automation-id="contactInformationPage"],'
    + 'div[data-automation-id="applyFlowMyInfoPage"]'
  )) return 'my_information';

  if (await isVisible(page,
    'div[data-automation-id="myExperiencePage"],'
    + 'div[data-automation-id="applyFlowMyExperiencePage"],'
    + 'div[data-automation-id="applyFlowMyExpPage"],'
    + 'div[data-automation-id="applyFlowExperiencePage"]'
  )) return 'my_experience';

  if (await isVisible(page,
    'div[data-automation-id="applyFlowApplicationQuestionsPage"],'
    + 'div[data-automation-id="applicationQuestionsPage"],'
    + 'div[data-automation-id="additionalInformationPage"]'
  )) return 'application_questions';

  if (await isVisible(page,
    'div[data-automation-id="voluntaryDisclosuresPage"],'
    + 'div[data-automation-id="applyFlowVoluntaryDisclosuresPage"]'
  )) return 'voluntary_disclosures';

  if (await isVisible(page,
    'div[data-automation-id="selfIdentificationPage"],'
    + 'div[data-automation-id="applyFlowSelfIdentificationPage"]'
  )) return 'self_identification';

  if (await isVisible(page,
    'div[data-automation-id="reviewSubmitPage"],'
    + 'div[data-automation-id="pageSummary"],'
    + 'div[data-automation-id="applyFlowReviewPage"],'
    + 'div[data-automation-id="applyFlowReviewSubmitPage"]'
  )) return 'review';

  // Generic fallback: any adventure button visible = "click Apply" style CTA.
  if (await isVisible(page, 'a[data-automation-id="adventureButton"]')) return 'apply_gate';
  return 'unknown';
}

// When detectPage returns 'unknown', dump the visible data-automation-ids so
// we can learn what markers this tenant uses.
async function debugUnknownPage(page) {
  const url = page.url();
  let ids = [];
  try {
    ids = await page.evaluate(() => {
      const nodes = document.querySelectorAll('[data-automation-id]');
      const seen = new Set();
      for (const n of nodes) {
        const rect = n.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          seen.add(n.getAttribute('data-automation-id'));
        }
        if (seen.size >= 40) break;
      }
      return Array.from(seen);
    });
  } catch (_) { /* ignore */ }
  logStep('unknown_page_debug', { url, visibleAutomationIds: ids });
}

// --- gate clicks -------------------------------------------------------------

async function clickLegalNoticeAccept(page) {
  const clicked = await safeClick(page, 'button[data-automation-id="legalNoticeAcceptButton"]', 1500);
  logStep('legal_notice_accept_click', { clicked });
  return clicked;
}

async function clickApplyGate(page) {
  const clicked = await safeClick(page, 'a[data-automation-id="adventureButton"]', 1500);
  logStep('apply_gate_click', { clicked });
  return clicked;
}

async function clickApplyManually(page) {
  const clicked = await safeClick(page, 'a[data-automation-id="applyManually"]', 1500);
  logStep('apply_manually_click', { clicked });
  return clicked;
}

async function clickSignInPrompt(page) {
  const selectors = [
    'button[data-automation-id="utilityButtonSignIn"]',
    'button[data-automation-id="signInLink"]',
    'a[data-automation-id="signInLink"]',
  ];
  for (const sel of selectors) {
    if (await safeClick(page, sel, 1200)) {
      logStep('sign_in_prompt_click', { selector: sel });
      return true;
    }
  }
  logStep('sign_in_prompt_click', { clicked: false });
  return false;
}

async function clickCreateAccountPrompt(page) {
  const selectors = [
    'button[data-automation-id="createAccountLink"]',
    'a[data-automation-id="createAccountLink"]',
  ];
  for (const sel of selectors) {
    if (await safeClick(page, sel, 1200)) {
      logStep('create_account_prompt_click', { selector: sel });
      return true;
    }
  }
  return false;
}

// --- sign-in / create-account ------------------------------------------------

async function fillSignIn(page, profile) {
  await guarded('sign_in.email', () => safeFill(page, 'input[data-automation-id="email"]', profile.email));
  await guarded('sign_in.password', () => safeFill(page, 'input[data-automation-id="password"]', profile.password));
  await page.waitForTimeout(300);
  const submitted = await guarded('sign_in.submit',
    () => safeClick(page, 'button[data-automation-id="signInSubmitButton"]', 1500));
  logStep('sign_in_submitted', { submitted });

  await page.waitForTimeout(3000);
  if (await isVisible(page, 'div[data-automation-id="errorMessage"]', 500)) {
    logStep('sign_in_error_switching_to_create_account');
    await guarded('sign_in.error_to_create_account',
      () => safeClick(page, 'button[data-automation-id="createAccountLink"]', 1500));
  }
}

async function fillCreateAccount(page, profile) {
  await guarded('create_account.email', () => safeFill(page, 'input[data-automation-id="email"]', profile.email));
  await guarded('create_account.password', () => safeFill(page, 'input[data-automation-id="password"]', profile.password));
  await guarded('create_account.verify', () => safeFill(page, 'input[data-automation-id="verifyPassword"]', profile.password));

  await guarded('create_account.agree', async () => {
    const cb = page.locator('input[data-automation-id="createAccountCheckbox"]').first();
    if (await cb.isVisible({ timeout: 400 }).catch(() => false)) {
      const checked = await cb.isChecked().catch(() => false);
      if (!checked) await cb.click().catch(() => { });
    }
  });

  await page.waitForTimeout(300);
  const submitted = await guarded('create_account.submit',
    () => safeClick(page, 'button[data-automation-id="createAccountSubmitButton"]', 1500));
  logStep('create_account_submitted', { submitted });
}

// --- My Information -----------------------------------------------------------

async function fillMyInformation(page, profile) {
  await guarded('my_info.previously_worked_no', async () => {
    // Try known selector first; then match by label ("Have you previously been employed…").
    const noRadio = 'div[data-automation-id="previousWorker"] input[id="2"]';
    if (await isVisible(page, noRadio, 400)) {
      const el = page.locator(noRadio).first();
      if (!(await el.isChecked().catch(() => false))) {
        await el.click().catch(() => { });
      }
      return;
    }
    // Label fallback — find the "previously employed" field and click its "No" option.
    const field = labelledFormField(page, /previously.*employ/i);
    if (!(await field.isVisible({ timeout: 400 }).catch(() => false))) return;
    // Workday radios inside these fields have labels "Yes" / "No" as sibling text.
    const noOption = field.locator('label:has-text("No"), input[value="No"], input[value="2"]').first();
    if (await noOption.isVisible({ timeout: 400 }).catch(() => false)) {
      await noOption.click().catch(() => { });
    }
  });

  // Legal name — AspenTech labels the fields "Given Name(s)" / "Family Name",
  // stock Workday labels them "First Name" / "Last Name". Match either.
  await guarded('my_info.first_name', () =>
    fillFieldWithFallback(page,
      'input[data-automation-id="legalNameSection_firstName"]',
      /Given Name|First Name/i,
      profile.firstName));
  await guarded('my_info.last_name', () =>
    fillFieldWithFallback(page,
      'input[data-automation-id="legalNameSection_lastName"]',
      /Family Name|Last Name/i,
      profile.lastName));
  await guarded('my_info.suffix', () => profile.suffix
    ? typeaheadWithFallback(page,
      'button[data-automation-id="legalNameSection_social"]',
      /Suffix/i,
      profile.suffix)
    : null);

  await guarded('my_info.address_line1', () =>
    fillFieldWithFallback(page,
      'input[data-automation-id="addressSection_addressLine1"]',
      /Address Line 1/i,
      profile.street));
  await guarded('my_info.city', () =>
    fillFieldWithFallback(page,
      'input[data-automation-id="addressSection_city"]',
      /^City/i,
      profile.city));
  await guarded('my_info.state', () => profile.state
    ? typeaheadWithFallback(page,
      'button[data-automation-id="addressSection_countryRegion"]',
      /State|Province|Region/i,
      profile.state)
    : null);
  await guarded('my_info.postal_code', () =>
    fillFieldWithFallback(page,
      'input[data-automation-id="addressSection_postalCode"]',
      /Postal Code|ZIP/i,
      profile.postalCode));

  await guarded('my_info.phone_type', () => profile.phoneType
    ? typeaheadWithFallback(page,
      'button[data-automation-id="phone-device-type"]',
      /Phone Device Type/i,
      profile.phoneType)
    : null);
  await guarded('my_info.phone_number', () =>
    fillFieldWithFallback(page,
      'input[data-automation-id="phone-number"]',
      /^Phone Number/i,
      normalizePhoneNumber(profile.phoneNumber)));

  // AspenTech surfaces "How Did You Hear About Us?" on the My Information page.
  // Default to "LinkedIn" if the profile doesn't specify — the field is
  // required and blocking, so a sensible default beats leaving it blank.
  await guarded('my_info.source', () =>
    typeaheadWithFallback(page,
      'div[data-automation-id="formField-source"] button',
      /How Did You Hear About Us/i,
      profile.source || 'LinkedIn'));
}

// --- My Experience ------------------------------------------------------------

async function addWorkExperienceSection(page, index) {
  const scope = `div[data-automation-id="workExperience-${index}"]`;
  if (await isVisible(page, scope, 400)) return true;
  const addSelector = index === 1
    ? 'div[data-automation-id="workExperienceSection"] button[data-automation-id*="add"]'
    : 'div[data-automation-id="workExperienceSection"] button[data-automation-id*="Add"]';
  await safeClick(page, addSelector, 2000);
  try {
    await page.waitForSelector(scope, { timeout: 6000 });
    return true;
  } catch (_) {
    return false;
  }
}

async function fillOneWorkExperience(page, entry, index) {
  const ok = await addWorkExperienceSection(page, index);
  if (!ok) return;
  const scope = `div[data-automation-id="workExperience-${index}"]`;

  await guarded(`work_${index}.jobTitle`,
    () => safeFill(page, `${scope} input[data-automation-id="jobTitle"]`, entry.jobtitle));
  await guarded(`work_${index}.company`,
    () => safeFill(page, `${scope} input[data-automation-id="company"]`, entry.company));
  await guarded(`work_${index}.location`,
    () => safeFill(page, `${scope} input[data-automation-id="location"]`, entry.location));

  const dateInputs = [
    [`${scope} div[data-automation-id="formField-startDate"] input[data-automation-id="dateSectionMonth-input"]`, entry.startDateMonth, `work_${index}.start_month`],
    [`${scope} div[data-automation-id="formField-startDate"] input[data-automation-id="dateSectionYear-input"]`, entry.startDateYear, `work_${index}.start_year`],
    [`${scope} div[data-automation-id="formField-endDate"] input[data-automation-id="dateSectionMonth-input"]`, entry.endDateMonth, `work_${index}.end_month`],
    [`${scope} div[data-automation-id="formField-endDate"] input[data-automation-id="dateSectionYear-input"]`, entry.endDateYear, `work_${index}.end_year`],
  ];
  for (const [sel, val, label] of dateInputs) {
    if (!val) continue;
    await guarded(label, async () => {
      const el = page.locator(sel).first();
      if (!(await el.isVisible({ timeout: 300 }).catch(() => false))) return;
      const current = await el.inputValue().catch(() => '');
      if (current && current.trim()) return;
      await el.click().catch(() => { });
      await page.keyboard.type(String(val), { delay: 60 });
    });
  }

  await guarded(`work_${index}.description`,
    () => safeFill(page, `${scope} textarea[data-automation-id="description"]`, entry.description));
}

async function fillEducation(page, profile) {
  if (!profile.school && !profile.degree && !profile.gpa) return;

  await guarded('education.add_section', async () => {
    if (!(await isVisible(page, 'div[data-automation-id="formField-schoolItem"]', 400))) {
      await safeClick(page, 'div[data-automation-id="educationSection"] button[data-automation-id="Add"]', 2000);
      await page.waitForTimeout(600);
    }
  });

  await guarded('education.school', async () => {
    if (!profile.school) return;
    const schoolEl = page.locator('div[data-automation-id="formField-schoolItem"] input').first();
    if (!(await schoolEl.isVisible({ timeout: 400 }).catch(() => false))) return;
    const cur = await schoolEl.inputValue().catch(() => '');
    if (cur) return;
    await schoolEl.fill(profile.school);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
  });

  await guarded('education.degree',
    () => profile.degree
      ? safeTypeahead(page, 'button[data-automation-id="degree"]', profile.degree)
      : null);
  await guarded('education.gpa',
    () => profile.gpa
      ? safeFill(page, 'input[data-automation-id="gpa"]', profile.gpa)
      : null);
  await guarded('education.start_year',
    () => profile.startDate
      ? safeFill(page, 'div[data-automation-id="formField-firstYearAttended"] input', profile.startDate)
      : null);
  await guarded('education.end_year',
    () => profile.endDate
      ? safeFill(page, 'div[data-automation-id="formField-lastYearAttended"] input', profile.endDate)
      : null);
}

async function fillSkills(page, skills) {
  if (!Array.isArray(skills) || skills.length === 0) return;
  await guarded('skills', async () => {
    const el = page.locator('div[data-automation-id="formField-skillsPrompt"] input').first();
    if (!(await el.isVisible({ timeout: 400 }).catch(() => false))) return;
    for (const skill of skills) {
      await el.fill(skill);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1200);
    }
  });
}

async function uploadResume(page, resumeFilePath) {
  if (!resumeFilePath) return;
  await guarded('resume', async () => {
    const sel = 'input[data-automation-id="file-upload-input-ref"]';
    if (!(await isVisible(page, sel, 800))) return;
    await page.locator(sel).first().setInputFiles(resumeFilePath);
    logStep('resume_uploaded', { resumeFilePath });
  });
}

async function fillWebsites(page, profile) {
  let panelCount = 0;

  await guarded('websites.linkedin', async () => {
    if (!profile.linkedInLink) return;
    const dedicated = 'input[data-automation-id="linkedinQuestion"]';
    if (await isVisible(page, dedicated, 400)) {
      await safeFill(page, dedicated, profile.linkedInLink);
      return;
    }
    panelCount += 1;
    const panel = `div[data-automation-id="websitePanelSet-${panelCount}"] input`;
    if (!(await isVisible(page, panel, 400))) {
      await safeClick(page, 'div[data-automation-id="websiteSection"] button[data-automation-id="Add"]', 2000);
      await page.waitForTimeout(400);
    }
    await safeFill(page, panel, profile.linkedInLink);
  });

  await guarded('websites.github', async () => {
    if (!profile.githubLink) return;
    panelCount += 1;
    const panel = `div[data-automation-id="websitePanelSet-${panelCount}"] input`;
    if (!(await isVisible(page, panel, 400))) {
      await safeClick(page, 'div[data-automation-id="websiteSection"] button[data-automation-id="Add"]', 2000);
      await page.waitForTimeout(400);
    }
    await safeFill(page, panel, profile.githubLink);
  });
}

async function fillMyExperience(page, profile) {
  const entries = Array.isArray(profile.workexperiences) ? profile.workexperiences : [];
  for (let i = 0; i < entries.length; i += 1) {
    await guarded(`work_experience_${i + 1}`, () => fillOneWorkExperience(page, entries[i], i + 1));
  }
  await guarded('education', () => fillEducation(page, profile));
  await guarded('skills', () => fillSkills(page, profile.skills));
  await guarded('resume', () => uploadResume(page, profile.resumeFilePath));
  await guarded('websites', () => fillWebsites(page, profile));
}

// --- Application Questions ---------------------------------------------------

// This step is highly tenant-specific — questions vary per posting. Best-effort:
//   * Fill a common "How did you hear about us?" (`formField-source`) if the
//     profile has a `source` value.
//   * Nothing else is safe to guess; user fills the rest manually.
async function fillApplicationQuestions(page, profile) {
  await guarded('app_questions.source', async () => {
    if (!profile.source) return;
    // Some tenants use a typeahead trigger button; others use a plain input.
    const trigger = 'div[data-automation-id="formField-source"] button';
    const input = 'div[data-automation-id="formField-source"] input';
    if (await isVisible(page, trigger, 400)) {
      await safeTypeahead(page, trigger, profile.source);
    } else if (await isVisible(page, input, 400)) {
      await safeFill(page, input, profile.source);
    }
  });
  logStep('application_questions_autofilled_partially');
}

// --- Voluntary Disclosures ---------------------------------------------------

async function fillVoluntaryDisclosures(page, profile) {
  await guarded('vol.gender',
    () => profile.gender
      ? safeTypeahead(page, 'button[data-automation-id="gender"]', profile.gender)
      : null);
  await page.waitForTimeout(200);
  await guarded('vol.hispanic',
    () => profile.hispanicOrLatino
      ? safeTypeahead(page, 'button[data-automation-id="hispanicOrLatino"]', profile.hispanicOrLatino)
      : null);
  await guarded('vol.ethnicity',
    () => profile.ethnicity
      ? safeTypeahead(page, 'button[data-automation-id="ethnicityDropdown"]', profile.ethnicity)
      : null);
  await page.waitForTimeout(200);
  await guarded('vol.veteran',
    () => profile.veteranStatus
      ? safeTypeahead(page, 'button[data-automation-id="veteranStatus"]', profile.veteranStatus)
      : null);

  await guarded('vol.agreement', async () => {
    const agreeCb = page.locator('input[data-automation-id="agreementCheckbox"]').first();
    if (!(await agreeCb.isVisible({ timeout: 400 }).catch(() => false))) return;
    const checked = await agreeCb.isChecked().catch(() => false);
    if (!checked) await agreeCb.click().catch(() => { });
  });
}

// --- Self-Identification -----------------------------------------------------

async function fillSelfIdentification(page, profile) {
  await guarded('self_id.name',
    () => safeFill(page, 'input[data-automation-id="name"]', profile.fullName));

  await guarded('self_id.signature_date', async () => {
    const dateIcon = page.locator('div[data-automation-id="dateIcon"]').first();
    if (!(await dateIcon.isVisible({ timeout: 400 }).catch(() => false))) return;
    await dateIcon.click().catch(() => { });
    await safeClick(page, 'button[data-automation-id="datePickerSelectedToday"]', 1500);
  });

  await guarded('self_id.disability', async () => {
    const disability = (profile.disability || 'abstain').toLowerCase();
    // Standard Workday template IDs — brittle but common. Fall back to label-text.
    const idMap = {
      yes: 'input[id="64cbff5f364f10000ae7a421cf210000"]',
      no: 'input[id="64cbff5f364f10000aeec521b4ec0000"]',
      abstain: 'input[id="64cbff5f364f10000af3af293a050000"]',
    };
    const idSel = idMap[disability];
    if (idSel && await isVisible(page, idSel, 400)) {
      if (await safeClick(page, idSel, 1000)) return;
    }
    const labels = {
      yes: 'Yes, I have a disability',
      no: 'No, I do not have a disability',
      abstain: 'I do not want to answer',
    };
    const label = labels[disability];
    if (!label) return;
    const radio = page.locator(`label:has-text("${label}")`).first();
    if (await radio.isVisible({ timeout: 400 }).catch(() => false)) {
      await radio.click().catch(() => { });
    }
  });
}

// --- dispatch ----------------------------------------------------------------

async function runAutofillForPage(pageType, page, profile) {
  switch (pageType) {
    case 'legal_notice': return await clickLegalNoticeAccept(page);
    case 'apply_gate': return await clickApplyGate(page);
    case 'apply_choice': return await clickApplyManually(page);
    case 'sign_in_prompt': return await clickSignInPrompt(page);
    case 'create_account_prompt': return await clickCreateAccountPrompt(page);
    case 'sign_in': return await fillSignIn(page, profile);
    case 'create_account': return await fillCreateAccount(page, profile);
    case 'my_information': return await fillMyInformation(page, profile);
    case 'my_experience': return await fillMyExperience(page, profile);
    case 'application_questions': return await fillApplicationQuestions(page, profile);
    case 'voluntary_disclosures': return await fillVoluntaryDisclosures(page, profile);
    case 'self_identification': return await fillSelfIdentification(page, profile);
    case 'review':
      logStep('on_review_awaiting_user_submit');
      return;
    default:
      return;
  }
}

// --- assist loop -------------------------------------------------------------

// Autofill fires on every state transition (signature = pageType@URL). Each
// page's autofill is wrapped in try/catch so a failure on one page never stops
// the loop from firing autofill on the NEXT page when the user navigates.
async function assistLoop(page, profile, updateResult) {
  let lastSignature = null;
  let lastAutofillAt = 0;
  let lastUnknownLogAt = 0;
  const dumpedForPage = new Set(); // pageType where we've already dumped form fields
  const inProgress = { flag: false };
  const startedAt = Date.now();

  const FORM_PAGES = new Set([
    'my_information', 'my_experience', 'application_questions',
    'voluntary_disclosures', 'self_identification', 'review',
  ]);

  while (Date.now() - startedAt < MAX_SESSION_MS) {
    if (page.isClosed()) {
      logStep('page_closed_stopping_loop');
      break;
    }
    if (inProgress.flag) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }

    let pageType = 'unknown';
    try {
      pageType = await detectPage(page);
    } catch (error) {
      logStep('detect_error', { error: error.message });
    }

    if (pageType === 'confirmation') {
      logStep('confirmation_detected');
      await updateResult({ state: 'completed', error: null });
      return { confirmed: true };
    }

    if (pageType === 'unknown') {
      if (Date.now() - lastUnknownLogAt > 10_000) {
        await debugUnknownPage(page);
        lastUnknownLogAt = Date.now();
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }

    const signature = `${pageType}@${page.url()}`;
    const signatureChanged = signature !== lastSignature;
    const cooldownExpired = Date.now() - lastAutofillAt > 30_000;
    const shouldFill = signatureChanged || cooldownExpired;

    if (shouldFill) {
      inProgress.flag = true;
      try {
        logStep('page_detected', { pageType, url: page.url(), signatureChanged });
        await updateResult({ state: `on_${pageType}`, error: null });

        // First time we see a form page, dump the visible form-field structure
        // so we can identify the tenant's exact selectors when autofill misses.
        if (FORM_PAGES.has(pageType) && !dumpedForPage.has(pageType)) {
          dumpedForPage.add(pageType);
          const fields = await debugFormFields(page);
          logStep('form_fields_dump', { pageType, count: fields.length, fields });
        }

        // Per-page try/catch: a failure here NEVER stops the outer loop.
        try {
          await runAutofillForPage(pageType, page, profile);
          await updateResult({ state: `${pageType}_autofilled`, error: null });
        } catch (error) {
          logStep('page_autofill_error', { pageType, error: error.message });
          await updateResult({ state: `${pageType}_autofill_failed`, error: error.message });
        }
        lastSignature = signature;
        lastAutofillAt = Date.now();
        await new Promise((r) => setTimeout(r, AUTOFILL_COOLDOWN_MS));
      } finally {
        inProgress.flag = false;
      }
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  logStep('assist_loop_ended', { reason: page.isClosed() ? 'page_closed' : 'timeout' });
  return { confirmed: false, timedOut: Date.now() - startedAt >= MAX_SESSION_MS };
}

// --- orchestrator ------------------------------------------------------------

async function performWorkdayApplication(payload, updateResult) {
  const { application_id, job_url, profile = {} } = payload;

  logStep('task_started', {
    application_id,
    job_url,
    hasCredentials: !!(profile.email && profile.password),
  });

  if (!job_url) throw new Error('job_url is required.');
  if (!profile.email || !profile.password) {
    throw new Error('profile.email and profile.password are required.');
  }

  await updateResult({ state: 'started', error: null });

  const browser = await getOrCreateBrowserContext({
    userDataDir: CHROME_USER_DATA_DIR,
    profileDirectory: CHROME_PROFILE_DIRECTORY,
    executablePath: CHROME_EXECUTABLE_PATH,
    log: logStep,
  });

  if (!browser || browser.isClosed?.()) {
    throw new Error('Browser context was not created successfully.');
  }

  const page = await browser.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);

  try {
    logStep('navigate_to_job', { job_url });
    await page.goto(job_url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => { });
    await updateResult({ state: 'navigated', error: null });

    const result = await assistLoop(page, profile, updateResult);
    if (result.confirmed) {
      logStep('task_completed', { application_id });
    } else if (result.timedOut) {
      await updateResult({ state: 'timed_out_waiting_for_user', error: null });
      logStep('task_timed_out', { application_id });
    } else {
      await updateResult({ state: 'closed_by_user', error: null });
      logStep('task_closed_by_user', { application_id });
    }
  } catch (error) {
    logStep('task_failed', { application_id, error: error.message });
    await updateResult({ state: 'failed', error: error.message });
    throw error;
  }
}

module.exports = {
  performWorkdayApplication,
};
