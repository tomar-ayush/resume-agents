// Page: voluntary_disclosures
// Gender, ethnicity, veteran status, and the agreement checkbox. Each is its
// own autofiller. All optional — skipped when the profile omits the value.

const { guarded, safeTypeahead, safeClick, logStep } = require('../helpers');

const autofillers = [
  {
    name: 'gender',
    run: (page, profile) => profile.gender
      ? safeTypeahead(page, 'button[data-automation-id="gender"]', profile.gender)
      : null,
  },
  {
    name: 'hispanic',
    run: (page, profile) => profile.hispanicOrLatino
      ? safeTypeahead(page, 'button[data-automation-id="hispanicOrLatino"]', profile.hispanicOrLatino)
      : null,
  },
  {
    name: 'ethnicity',
    run: (page, profile) => profile.ethnicity
      ? safeTypeahead(page, 'button[data-automation-id="ethnicityDropdown"]', profile.ethnicity)
      : null,
  },
  {
    name: 'veteran',
    run: (page, profile) => profile.veteranStatus
      ? safeTypeahead(page, 'button[data-automation-id="veteranStatus"]', profile.veteranStatus)
      : null,
  },
  {
    name: 'agreement',
    run: async (page) => {
      const agreeCb = page.locator('input[data-automation-id="agreementCheckbox"]').first();
      if (!(await agreeCb.isVisible({ timeout: 400 }).catch(() => false))) return;
      const checked = await agreeCb.isChecked().catch(() => false);
      if (!checked) await agreeCb.click().catch(() => { });
    },
  },
];

async function autofill(page, profile) {
  for (const a of autofillers) {
    await guarded(`vol.${a.name}`, () => a.run(page, profile));
  }
  logStep('voluntary_disclosures_autofilled');
}

module.exports = { pageType: 'voluntary_disclosures', autofillers, autofill };
