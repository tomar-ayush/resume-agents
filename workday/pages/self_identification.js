// Page: self_identification
// Name, signature date, and disability status. Each is its own autofiller.

const { guarded, safeFill, safeClick, isVisible, logStep } = require('../helpers');

const autofillers = [
  {
    name: 'name',
    run: (page, profile) => safeFill(page, 'input[data-automation-id="name"]', profile.fullName),
  },
  {
    name: 'signature_date',
    run: async (page) => {
      const dateIcon = page.locator('div[data-automation-id="dateIcon"]').first();
      if (!(await dateIcon.isVisible({ timeout: 400 }).catch(() => false))) return;
      await dateIcon.click().catch(() => { });
      await safeClick(page, 'button[data-automation-id="datePickerSelectedToday"]', 1500);
    },
  },
  {
    name: 'disability',
    run: async (page, profile) => {
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
    },
  },
];

async function autofill(page, profile) {
  for (const a of autofillers) {
    await guarded(`self_id.${a.name}`, () => a.run(page, profile));
  }
  logStep('self_identification_autofilled');
}

module.exports = { pageType: 'self_identification', autofillers, autofill };
