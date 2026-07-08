// Page: create_account
// Register modal is OPEN. Fill email/password/verify, tick the agreement box,
// submit.

const { guarded, safeFill, safeClick, logStep } = require('../helpers');

// Click Submit at most once per session. The assist loop re-fires autofill
// every ~30s; without this guard it would re-click Submit (and re-scroll the
// modal) forever, looking "stuck" on the register page.
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
    name: 'verify',
    run: (page, profile) => safeFill(page, 'input[data-automation-id="verifyPassword"]', profile.password),
  },
  {
    name: 'agree',
    run: async (page) => {
      const cb = page.locator('input[data-automation-id="createAccountCheckbox"]').first();
      if (await cb.isVisible({ timeout: 400 }).catch(() => false)) {
        const checked = await cb.isChecked().catch(() => false);
        if (!checked) await cb.click().catch(() => { });
      }
    },
  },
  {
    name: 'submit',
    run: async (page) => {
      if (submitted) return true; // already submitted; don't re-click
      const clicked = await safeClick(page, 'button[data-automation-id="createAccountSubmitButton"]', 1500);
      if (clicked) submitted = true;
      logStep('create_account_submitted', { submitted: clicked });
      return clicked;
    },
  },
];

async function autofill(page, profile) {
  for (const a of autofillers) {
    await guarded(`create_account.${a.name}`, () => a.run(page, profile));
  }
}

module.exports = { pageType: 'create_account', autofillers, autofill };
