// Page: legal_notice
// Blocking legal / cookie notice modal. Must be dismissed before the form is
// usable. Single autofiller: click "Accept".

const { safeClick, logStep } = require('../helpers');

const autofillers = [
  {
    name: 'accept',
    run: async (page) => {
      const clicked = await safeClick(page, 'button[data-automation-id="legalNoticeAcceptButton"]', 1500);
      logStep('legal_notice_accept_click', { clicked });
      return clicked;
    },
  },
];

async function autofill(page) {
  for (const a of autofillers) {
    await a.run(page);
  }
}

module.exports = { pageType: 'legal_notice', autofillers, autofill };
