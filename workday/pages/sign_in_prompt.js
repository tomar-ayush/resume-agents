// Page: sign_in_prompt
// Sign-in / register modal is CLOSED — these buttons OPEN it. We click the
// sign-in link so the sign_in page can fill credentials.

const { safeClick, logStep } = require('../helpers');

const autofillers = [
  {
    name: 'open_sign_in',
    run: async (page) => {
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
    },
  },
];

async function autofill(page) {
  for (const a of autofillers) {
    await a.run(page);
  }
}

module.exports = { pageType: 'sign_in_prompt', autofillers, autofill };
