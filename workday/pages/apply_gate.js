// Page: apply_gate
// The initial job posting CTA ("Apply" / adventure button). Single autofiller:
// click the adventure button to enter the apply flow.

const { safeClick, logStep } = require('../helpers');

const autofillers = [
  {
    name: 'click_apply',
    run: async (page) => {
      const clicked = await safeClick(page, 'a[data-automation-id="adventureButton"]', 1500);
      logStep('apply_gate_click', { clicked });
      return clicked;
    },
  },
];

async function autofill(page) {
  for (const a of autofillers) {
    await a.run(page);
  }
}

module.exports = { pageType: 'apply_gate', autofillers, autofill };
