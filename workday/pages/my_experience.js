// Page: my_experience
// Work history, education, skills, resume upload, and website links. Each
// section is its own autofiller so they fail independently.

const { guarded, safeFill, safeTypeahead, safeClick, isVisible, logStep, debugFormFieldsInGroup } = require('../helpers');

// --- work experience helpers -------------------------------------------------

async function addWorkExperienceSection(page, index) {
  const scope = `div[data-automation-id="workExperience-${index}"]`;
  if (await isVisible(page, scope, 400)) return true;
  // AspenTech tenant: the Add button lives inside the Work Experience group,
  // scoped by its aria-labelledby h4 id (not a "workExperienceSection" div).
  const addSelector = 'div[role="group"][aria-labelledby="Work-Experience-section"] button[data-automation-id="add-button"]';
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

  // First time we expand a work-experience block, dump its real field
  // selectors so we can learn the tenant's exact markup (AspenTech uses
  // different ids than legacy Workday).
  if (index === 1) {
    const fields = await debugFormFieldsInGroup(page, 'div[role="group"][aria-labelledby="Work-Experience-section"]');
    logStep('work_experience_fields_dump', { count: fields.length, fields });
  }

  await safeFill(page, `${scope} input[data-automation-id="jobTitle"]`, entry.jobtitle);
  await safeFill(page, `${scope} input[data-automation-id="company"]`, entry.company);
  await safeFill(page, `${scope} input[data-automation-id="location"]`, entry.location);

  const dateInputs = [
    [`${scope} div[data-automation-id="formField-startDate"] input[data-automation-id="dateSectionMonth-input"]`, entry.startDateMonth],
    [`${scope} div[data-automation-id="formField-startDate"] input[data-automation-id="dateSectionYear-input"]`, entry.startDateYear],
    [`${scope} div[data-automation-id="formField-endDate"] input[data-automation-id="dateSectionMonth-input"]`, entry.endDateMonth],
    [`${scope} div[data-automation-id="formField-endDate"] input[data-automation-id="dateSectionYear-input"]`, entry.endDateYear],
  ];
  for (const [sel, val] of dateInputs) {
    if (!val) continue;
    const el = page.locator(sel).first();
    if (!(await el.isVisible({ timeout: 300 }).catch(() => false))) continue;
    const current = await el.inputValue().catch(() => '');
    if (current && current.trim()) continue;
    await el.click().catch(() => { });
    await page.keyboard.type(String(val), { delay: 60 });
  }

  await safeFill(page, `${scope} textarea[data-automation-id="description"]`, entry.description);
}

// --- education helpers --------------------------------------------------------

async function fillEducation(page, profile) {
  if (!profile.school && !profile.degree && !profile.gpa) return;

  if (!(await isVisible(page, 'div[data-automation-id="formField-schoolItem"]', 400))) {
    await safeClick(page, 'div[role="group"][aria-labelledby="Education-section"] button[data-automation-id="add-button"]', 2000);
    await page.waitForTimeout(600);
  }

  if (profile.school) {
    const schoolEl = page.locator('div[data-automation-id="formField-schoolItem"] input').first();
    if (await schoolEl.isVisible({ timeout: 400 }).catch(() => false)) {
      const cur = await schoolEl.inputValue().catch(() => '');
      if (!cur) {
        await schoolEl.fill(profile.school);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
        await page.keyboard.press('Enter');
      }
    }
  }

  if (profile.degree) await safeTypeahead(page, 'button[data-automation-id="degree"]', profile.degree);
  if (profile.gpa) await safeFill(page, 'input[data-automation-id="gpa"]', profile.gpa);
  if (profile.startDate) await safeFill(page, 'div[data-automation-id="formField-firstYearAttended"] input', profile.startDate);
  if (profile.endDate) await safeFill(page, 'div[data-automation-id="formField-lastYearAttended"] input', profile.endDate);
}

// --- skills helpers -----------------------------------------------------------

async function fillSkills(page, skills) {
  if (!Array.isArray(skills) || skills.length === 0) return;
  // AspenTech tenant: skills is a multiselect inside formField-skills. The
  // visible <input> has id="skills--skills". Type the value, then Enter to
  // commit it as a chip. Skip skills already present so re-fires don't add
  // duplicate chips.
  const el = page.locator('div[data-automation-id="formField-skills"] input').first();
  if (!(await el.isVisible({ timeout: 400 }).catch(() => false))) return;
  for (const skill of skills) {
    const already = await page.evaluate((s) => {
      const chips = Array.from(document.querySelectorAll('[data-automation-id="formField-skills"] [data-automation-id*="selectedOption"], [data-automation-id="formField-skills"] [class*="chip"]'));
      return chips.some((c) => (c.textContent || '').toLowerCase().includes(s.toLowerCase()));
    }, skill).catch(() => false);
    if (already) continue;
    await el.click().catch(() => { });
    await el.fill(skill);
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1200);
  }
}

// --- resume helpers -----------------------------------------------------------

async function uploadResume(page, resumeFilePath) {
  if (!resumeFilePath) return;
  const sel = 'input[data-automation-id="file-upload-input-ref"]';
  if (!(await isVisible(page, sel, 800))) return;
  await page.locator(sel).first().setInputFiles(resumeFilePath);
  logStep('resume_uploaded', { resumeFilePath });
}

// --- websites helpers ---------------------------------------------------------

async function fillWebsites(page, profile) {
  let panelCount = 0;

  if (profile.linkedInLink) {
    const dedicated = 'input[data-automation-id="linkedinQuestion"]';
    if (await isVisible(page, dedicated, 400)) {
      await safeFill(page, dedicated, profile.linkedInLink);
    } else {
      panelCount += 1;
      const panel = `div[data-automation-id="websitePanelSet-${panelCount}"] input`;
      if (!(await isVisible(page, panel, 400))) {
        await safeClick(page, 'div[role="group"][aria-labelledby="Websites-section"] button[data-automation-id="add-button"]', 2000);
        await page.waitForTimeout(400);
      }
      await safeFill(page, panel, profile.linkedInLink);
    }
  }

  if (profile.githubLink) {
    panelCount += 1;
    const panel = `div[data-automation-id="websitePanelSet-${panelCount}"] input`;
    if (!(await isVisible(page, panel, 400))) {
      await safeClick(page, 'div[data-automation-id="websiteSection"] button[data-automation-id="Add"]', 2000);
      await page.waitForTimeout(400);
    }
    await safeFill(page, panel, profile.githubLink);
  }
}

// --- autofillers --------------------------------------------------------------

const autofillers = [
  {
    name: 'work_experience',
    run: async (page, profile) => {
      const entries = Array.isArray(profile.workexperiences) ? profile.workexperiences : [];
      for (let i = 0; i < entries.length; i += 1) {
        await fillOneWorkExperience(page, entries[i], i + 1);
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
