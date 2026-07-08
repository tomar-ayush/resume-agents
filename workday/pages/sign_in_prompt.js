// Page: sign_in_prompt
// Sign-in / register modal is CLOSED. We do NOT click the sign-in link — the
// login window appears automatically after "Apply Manually" (or the user opens
// it themselves). Once the modal is open, the `sign_in` page fills the
// credentials and the user completes the actual sign-in + OTP.

const { logStep } = require('../helpers');

let logged = false;

const autofillers = [];

async function autofill() {
  if (!logged) {
    logged = true;
    logStep('auth_prompt_awaiting_user', {
      pageType: 'sign_in_prompt',
      note: 'login window opens automatically or user opens it',
    });
  }
}

module.exports = { pageType: 'sign_in_prompt', autofillers, autofill };
