// Page: create_account_prompt
// Register modal is CLOSED. We do NOT click the create-account link — the user
// opens it themselves (e.g. from the sign-in modal) when they prefer to
// register instead of signing in. Once open, the `create_account` page fills
// the fields and the user completes registration + verification.

const { logStep } = require('../helpers');

let logged = false;

const autofillers = [];

async function autofill() {
  if (!logged) {
    logged = true;
    logStep('auth_prompt_awaiting_user', {
      pageType: 'create_account_prompt',
      note: 'user opens the register modal themselves',
    });
  }
}

module.exports = { pageType: 'create_account_prompt', autofillers, autofill };
