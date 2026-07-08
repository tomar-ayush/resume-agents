// Page: my_experience
// Work history, education, skills, resume upload, and website links. Each
// section is its own autofiller so they fail independently.
//
// Tenant note: Workday uses DYNAMIC ids on the actual <input> elements
// (e.g. workExperience-6--jobTitle, education-15--schoolName) that change per
// session. The STABLE anchors are:
//   * the section group:  div[role="group"][aria-labelledby="Work-Experience-section"]
//   * the formField container: div[data-automation-id="formField-jobTitle"]
//   * date spinbuttons: input[data-automation-id="dateSectionMonth-input"] / "...Year-input"
// So we scope every locator by the section group + formField container, never
// by the dynamic input id.

const { guarded, safeFill, safeTypeahead, safeClick, isVisible, logStep } = require('../helpers');

const WORK_EXP_SECTION = 'div[role="group"][aria-labelledby="Work-Experience-section"]';
const EDU_SECTION = 'div[role="group"][aria-labelledby="Education-section"]';
const WEBSITES_SECTION = 'div[role="group"][aria-labelledby="Websites-section"]';

// --- work experience ---------------------------------------------------------

// Returns true if at least one work-experience block is expanded (a jobTitle
// field is visible). If not, clicks "Add" / "Add Another" in the section.
async function ensureWorkExperienceBlock(page) {
  const jobTitle = page.locator(`${WORK_EXP_SECTION} div[data-automation-id="formField-jobTitle"] input`).first();
  if (await jobTitle.isVisible({ timeout: 400 }).catch(() => false)) return true;
  await safeClick(page, `${WORK_EXP_SECTION} button[data-automation-id="add-button"]`, 2000);
  try {
    await jobTitle.waitFor({ state: 'visible', timeout: 6000 });
    return true;
  } catch (_) {
    return false;
  }
}

async function fillOneWorkExperience(page, entry) {
  const ok = await ensureWorkExperienceBlock(page);
  if (!ok) return;

  await safeFill(page, `${WORK_EXP_SECTION} div[data-automation-id="formField-jobTitle"] input`, entry.jobtitle);
  await safeFill(page, `${WORK_EXP_SECTION} div[data-automation-id="formField-companyName"] input`, entry.company);
  await safeFill(page, `${WORK_EXP_SECTION} div[data-automation-id="formField-location"] input`, entry.location);
  await safeFill(page, `${WORK_EXP_SECTION} div[data-automation-id="formField-roleDescription"] textarea`, entry.description);

  const dateInputs = [
    [`${WORK_EXP_SECTION} div[data-automation-id="formField-startDate"] input[data-automation-id="dateSectionMonth-input"]`, entry.startDateMonth],
    [`${WORK_EXP_SECTION} div[data-automation-id="formField-startDate"] input[data-automation-id="dateSectionYear-input"]`, entry.startDateYear],
    [`${WORK_EXP_SECTION} div[data-automation-id="formField-endDate"] input[data-automation-id="dateSectionMonth-input"]`, entry.endDateMonth],
    [`${WORK_EXP_SECTION} div[data-automation-id="formField-endDate"] input[data-automation-id="dateSectionYear-input"]`, entry.endDateYear],
  ];
  for (const [sel, val] of dateInputs) {
    if (!val) continue;
    const el = page.locator(sel).first();
    if (!(await el.isVisible({ timeout: 300 }).catch(() => false))) continue;
    const current = await el.inputValue().catch(() => '');
    if (current && current.trim()) continue;
    // The date spinbuttons have tabindex="-1", so a normal .click() cannot
    // focus them — the keystrokes would fall through to the previously focused
    // field (the role-description textarea) and the date would never be set,
    // causing the loop to re-fire forever. Force focus via the DOM (bypassing
    // tabindex) and type into the now-focused element. No click → no scroll.
    await el.evaluate((node) => node.focus()).catch(() => { });
    await page.keyboard.type(String(val), { delay: 60 });
  }
}

// --- education ----------------------------------------------------------------

async function ensureEducationBlock(page) {
  const school = page.locator(`${EDU_SECTION} div[data-automation-id="formField-schoolName"] input`).first();
  if (await school.isVisible({ timeout: 400 }).catch(() => false)) return true;
  await safeClick(page, `${EDU_SECTION} button[data-automation-id="add-button"]`, 2000);
  try {
    await school.waitFor({ state: 'visible', timeout: 6000 });
    return true;
  } catch (_) {
    return false;
  }
}

async function fillEducation(page, profile) {
  if (!profile.school && !profile.degree && !profile.gpa) return;
  const ok = await ensureEducationBlock(page);
  if (!ok) return;

  if (profile.school) {
    await safeFill(page, `${EDU_SECTION} div[data-automation-id="formField-schoolName"] input`, profile.school);
  }
  if (profile.degree) {
    await safeTypeahead(page, `${EDU_SECTION} div[data-automation-id="formField-degree"] button`, profile.degree);
  }
  if (profile.fieldOfStudy) {
    await addMultiselectValue(page, `${EDU_SECTION} div[data-automation-id="formField-fieldOfStudy"]`, profile.fieldOfStudy);
  }
  if (profile.gpa) {
    await safeFill(page, `${EDU_SECTION} div[data-automation-id="formField-gradeAverage"] input`, profile.gpa);
  }
  if (profile.startDate) {
    await fillYearOnly(page, `${EDU_SECTION} div[data-automation-id="formField-firstYearAttended"]`, profile.startDate);
  }
  if (profile.endDate) {
    await fillYearOnly(page, `${EDU_SECTION} div[data-automation-id="formField-lastYearAttended"]`, profile.endDate);
  }
}

// Education "From/To" only has a year spinbutton (no month). Same tabindex="-1"
// trap as the work-experience dates: force-focus via the DOM, then type.
async function fillYearOnly(page, formFieldSelector, value) {
  const el = page.locator(`${formFieldSelector} input[data-automation-id="dateSectionYear-input"]`).first();
  if (!(await el.isVisible({ timeout: 300 }).catch(() => false))) return;
  const current = await el.inputValue().catch(() => '');
  if (current && current.trim()) return;
  await el.evaluate((node) => node.focus()).catch(() => { });
  await page.keyboard.type(String(value), { delay: 60 });
}

// --- multiselect helper (skills, field of study) -----------------------------

// Workday multiselect interaction model (observed on Copart tenant):
//   1. type the value into the SEARCH INPUT
//   2. wait for the search results dropdown (activeListContainer) to populate
//   3. click the option whose promptOption text MATCHES the skill (the results
//      popup is teleported OUTSIDE formField-skills, so we search the whole
//      document for [data-automation-id="activeListContainer"] [data-automation-id="menuItem"]
//      and exclude the selectedItemList chips)
//   4. verify a chip appeared, then CLEAR the input
// Skips if the value is already selected as a chip.
async function addMultiselectValue(page, containerSelector, value) {
  if (!value) return;
  const container = page.locator(containerSelector).first();
  if (!(await container.isVisible({ timeout: 400 }).catch(() => false))) return;

  const v = String(value).toLowerCase();
  const already = await page.evaluate((val) => {
    const chips = Array.from(
      document.querySelectorAll('[data-automation-id="selectedItemList"] [data-automation-id="selectedItem"]')
    );
    return chips.some((c) => (c.textContent || '').trim().toLowerCase().includes(val));
  }, v).catch(() => false);
  if (already) {
    logStep('skill_already_selected', { value });
    return;
  }

  // Search input: prefer placeholder="Search", fall back to first input.
  let input = container.locator('input[placeholder="Search"]').first();
  if (!(await input.isVisible({ timeout: 400 }).catch(() => false))) {
    input = container.locator('input').first();
  }
  if (!(await input.isVisible({ timeout: 400 }).catch(() => false))) {
    logStep('skill_input_not_visible', { value });
    return;
  }
  await input.click().catch(() => { });
  await input.fill(value).catch(() => { });
  // Wait 1s, then press Enter to trigger the search.
  await page.waitForTimeout(1000);
  await page.keyboard.press('Enter').catch(() => { });
  // Wait 2s for the results to populate.
  await page.waitForTimeout(2000);

  // The results popup lives in activeListContainer (teleported outside the
  // formField container). Always select the FIRST option in the list.
  const option = page
    .locator('[data-automation-id="activeListContainer"] [data-automation-id="menuItem"]')
    .first();

  let clicked = false;
  if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
    await option.click({ timeout: 3000 }).catch(() => { });
    clicked = true;
  } else {
    // Fallback: press Enter to commit the top result.
    await page.keyboard.press('Enter').catch(() => { });
  }

  // Let the user verify the selection before we move on to the next skill.
  logStep('skill_option_clicked', { value, clicked });
  await page.waitForTimeout(500);

  // Clear the input so the next value can be typed fresh.
  await input.fill('').catch(() => { });
  await page.waitForTimeout(500);
}

// --- skills ------------------------------------------------------------------

async function fillSkills(page, skills) {
  if (!Array.isArray(skills) || skills.length === 0) {
    logStep('skills_empty_or_missing');
    return;
  }
  const container = page.locator('div[data-automation-id="formField-skills"]').first();
  if (!(await container.isVisible({ timeout: 400 }).catch(() => false))) {
    logStep('skills_container_not_visible');
    return;
  }
  logStep('skills_start', { count: skills.length });
  for (const skill of skills) {
    await addMultiselectValue(page, 'div[data-automation-id="formField-skills"]', skill);
  }
  logStep('skills_done');
}

// --- resume ------------------------------------------------------------------

async function uploadResume(page, resumeFilePath) {
  if (!resumeFilePath) return;
  // Resolve to an absolute path (profile may store a relative path) and skip
  // silently if the file doesn't exist, so a missing resume never throws or
  // causes the assist loop to spin.
  const absPath = require('node:path').resolve(__dirname, '..', resumeFilePath);
  let exists = false;
  try { await require('node:fs/promises').access(absPath); exists = true; } catch (_) { /* noop */ }
  if (!exists) {
    logStep('resume_skipped_missing_file', { resumeFilePath, absPath });
    return;
  }
  const sel = 'input[data-automation-id="file-upload-input-ref"]';
  if (!(await isVisible(page, sel, 800))) return;
  await page.locator(sel).first().setInputFiles(absPath);
  logStep('resume_uploaded', { resumeFilePath: absPath });
}

// --- websites ----------------------------------------------------------------

// The Websites section is already expanded (a "Websites 1" block with a
// formField-url input is present on load). We fill that first input, then for
// each additional link click "Add Another" and fill the newly added url input.
async function fillWebsites(page, profile) {
  const section = page.locator(WEBSITES_SECTION).first();
  if (!(await section.isVisible({ timeout: 400 }).catch(() => false))) return;

  const links = [profile.linkedInLink, profile.githubLink].filter(Boolean);
  if (links.length === 0) return;

  for (let i = 0; i < links.length; i += 1) {
    // For the 2nd+ link, expand a new block first.
    if (i > 0) {
      await safeClick(page, `${WEBSITES_SECTION} button[data-automation-id="add-button"]`, 2000);
      await page.waitForTimeout(600);
    }
    const input = section.locator('div[data-automation-id="formField-url"] input').nth(i);
    if (!(await input.isVisible({ timeout: 400 }).catch(() => false))) continue;
    const cur = await input.inputValue().catch(() => '');
    if (!cur) await input.fill(links[i]);
  }
}

// --- autofillers --------------------------------------------------------------

const autofillers = [
  {
    name: 'work_experience',
    run: async (page, profile) => {
      const entries = Array.isArray(profile.workexperiences) ? profile.workexperiences : [];
      for (const entry of entries) {
        await fillOneWorkExperience(page, entry);
      }
    },
  },
  { name: 'education', run: (page, profile) => fillEducation(page, profile) },
  { name: 'skills', run: (page, profile) => fillSkills(page, profile.skills) },
  { name: 'resume', run: (page, profile) => uploadResume(page, profile.resumeFilePath) },
  { name: 'websites', run: (page, profile) => fillWebsites(page, profile) },
];

async function autofill(page, profile) {
  for (const a of autofillers) {
    await guarded(`work_experience.${a.name}`, () => a.run(page, profile));
  }
}

module.exports = { pageType: 'my_experience', autofillers, autofill };
