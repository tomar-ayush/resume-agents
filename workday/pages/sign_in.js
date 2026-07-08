// Page: sign_in
// Sign-in modal is OPEN. Fill email/password, submit. If Workday reports an
// error (e.g. account doesn't exist yet) we pivot to the create-account link.

const { guarded, safeFill, safeClick, isVisible, logStep } = require('../helpers');

// Click Submit at most once per session (loop re-fires autofill every ~30s).
let submitted = false;

const autofillers = [
  {
    name: 'email',
    run: (page, profile) => safeFill(page, 'input[data-automation-id="email"]', profile.email),
  },
  {
    name: 'password',
    run: (page, profile) => safeFill(page, 'input[data-automation-id="password"]', profile.password),
  },
  {
    name: 'submit',
    run: async (page) => {
      if (submitted) return true; // already submitted; don't re-click
      const clicked = await safeClick(page, 'button[data-automation-id="signInSubmitButton"]', 1500);
      if (clicked) submitted = true;
      logStep('sign_in_submitted', { submitted: clicked });
      return clicked;
    },
  },
  {
    name: 'error_to_create_account',
    run: async (page) => {
      await page.waitForTimeout(3000);
      if (await isVisible(page, 'div[data-automation-id="errorMessage"]', 500)) {
        logStep('sign_in_error_switching_to_create_account');
        return await safeClick(page, 'button[data-automation-id="createAccountLink"]', 1500);
      }
      return false;
    },
  },
];

async function autofill(page, profile) {
  for (const a of autofillers) {
    await guarded(`sign_in.${a.name}`, () => a.run(page, profile));
  }
}

module.exports = { pageType: 'sign_in', autofillers, autofill };
