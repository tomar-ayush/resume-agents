// Page: create_account_prompt
// Register modal is CLOSED — these buttons OPEN it. We click the create-account
// link so the create_account page can fill signup fields.

const { safeClick, logStep } = require('../helpers');

const autofillers = [
  {
    name: 'open_create_account',
    run: async (page) => {
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
    },
  },
];

async function autofill(page) {
  for (const a of autofillers) {
    await a.run(page);
  }
}

module.exports = { pageType: 'create_account_prompt', autofillers, autofill };
