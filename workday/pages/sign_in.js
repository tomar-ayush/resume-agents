// Page: sign_in
// Sign-in modal is OPEN. We ONLY fill email/password. We do NOT click the
// Sign In button — the user clicks it and completes any OTP / 2FA themselves.
// If sign-in fails or the user prefers, they can switch to the register flow;
// we never auto-navigate there.

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
];

async function autofill(page, profile) {
  for (const a of autofillers) {
    await guarded(`sign_in.${a.name}`, () => a.run(page, profile));
  }
  if (!awaitLogged) {
    awaitLogged = true;
    logStep('auth_fields_filled_awaiting_user', {
      pageType: 'sign_in',
      next: 'user clicks Sign In and completes OTP',
    });
  }
}

module.exports = { pageType: 'sign_in', autofillers, autofill };
