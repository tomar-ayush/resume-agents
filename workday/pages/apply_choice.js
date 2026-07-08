// Page: apply_choice
// "Apply Manually" vs "Apply with X" choice. We always pick manual so the
// assistant can drive the native Workday form.

const { safeClick, logStep } = require('../helpers');

const autofillers = [
  {
    name: 'click_apply_manually',
    run: async (page) => {
      const clicked = await safeClick(page, 'a[data-automation-id="applyManually"]', 1500);
      logStep('apply_manually_click', { clicked });
      return clicked;
    },
  },
];

async function autofill(page) {
  for (const a of autofillers) {
    await a.run(page);
  }
}

module.exports = { pageType: 'apply_choice', autofillers, autofill };
