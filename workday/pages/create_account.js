// Page: create_account
// Register modal is OPEN. We ONLY fill email/password/verify and tick the
// agreement checkbox. We do NOT click the Register button — the user clicks it
// and completes any email/OTP verification themselves.

const { guarded, safeFill, logStep } = require('../helpers');

// Log once that we've filled the fields and are now waiting on the user.
let awaitLogged = false;

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
    name: 'verify',
    run: (page, profile) => safeFill(page, 'input[data-automation-id="verifyPassword"]', profile.password),
  },
  {
    name: 'agree',
    run: async (page) => {
      const cb = page.locator('input[data-automation-id="createAccountCheckbox"]').first();
      if (await cb.isVisible({ timeout: 400 }).catch(() => false)) {
        const checked = await cb.isChecked().catch(() => false);
        if (!checked) await cb.click().catch(() => {});
      }
    },
  },
];

async function autofill(page, profile) {
  for (const a of autofillers) {
    await guarded(`create_account.${a.name}`, () => a.run(page, profile));
  }
  if (!awaitLogged) {
    awaitLogged = true;
    logStep('auth_fields_filled_awaiting_user', {
      pageType: 'create_account',
      next: 'user clicks Register and completes verification',
    });
  }
}

module.exports = { pageType: 'create_account', autofillers, autofill };
