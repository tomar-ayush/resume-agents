// Page: my_information
// Contact info, legal name, address, phone, and (on some tenants) the
// "How Did You Hear About Us?" source field. Each field is its own autofiller
// so a single bad selector never blocks the rest of the page.

const {
  guarded,
  safeFill,
  safeTypeahead,
  isVisible,
  fillFieldWithFallback,
  typeaheadWithFallback,
  labelledFormField,
  normalizePhoneNumber,
  logStep,
} = require('../helpers');

const autofillers = [
  {
    name: 'previously_worked_no',
    run: async (page) => {
      // Try known selector first; then match by label ("Have you previously been employed…").
      const noRadio = 'div[data-automation-id="previousWorker"] input[id="2"]';
      if (await isVisible(page, noRadio, 400)) {
        const el = page.locator(noRadio).first();
        if (!(await el.isChecked().catch(() => false))) {
          await el.click().catch(() => { });
        }
        return;
      }
      const field = labelledFormField(page, /previously.*employ/i);
      if (!(await field.isVisible({ timeout: 400 }).catch(() => false))) return;
      const noOption = field.locator('label:has-text("No"), input[value="No"], input[value="2"]').first();
      if (await noOption.isVisible({ timeout: 400 }).catch(() => false)) {
        await noOption.click().catch(() => { });
      }
    },
  },
  {
    name: 'first_name',
    run: (page, profile) => fillFieldWithFallback(
      page,
      'input[data-automation-id="legalNameSection_firstName"]',
      /Given Name|First Name/i,
      profile.firstName,
    ),
  },
  {
    name: 'last_name',
    run: (page, profile) => fillFieldWithFallback(
      page,
      'input[data-automation-id="legalNameSection_lastName"]',
      /Family Name|Last Name/i,
      profile.lastName,
    ),
  },
  {
    name: 'suffix',
    run: (page, profile) => profile.suffix
      ? typeaheadWithFallback(page, 'button[data-automation-id="legalNameSection_social"]', /Suffix/i, profile.suffix)
      : null,
  },
  {
    name: 'address_line1',
    run: (page, profile) => fillFieldWithFallback(
      page,
      'input[data-automation-id="addressSection_addressLine1"]',
      /Address Line 1/i,
      profile.street,
    ),
  },
  {
    name: 'city',
    run: (page, profile) => fillFieldWithFallback(
      page,
      'input[data-automation-id="addressSection_city"]',
      /^City/i,
      profile.city,
    ),
  },
  {
    name: 'state',
    run: (page, profile) => profile.state
      ? typeaheadWithFallback(page, 'button[data-automation-id="addressSection_countryRegion"]', /State|Province|Region/i, profile.state)
      : null,
  },
  {
    name: 'postal_code',
    run: (page, profile) => fillFieldWithFallback(
      page,
      'input[data-automation-id="addressSection_postalCode"]',
      /Postal Code|ZIP/i,
      profile.postalCode,
    ),
  },
  {
    name: 'phone_type',
    run: (page, profile) => profile.phoneType
      ? typeaheadWithFallback(page, 'button[data-automation-id="phone-device-type"]', /Phone Device Type/i, profile.phoneType)
      : null,
  },
  {
    name: 'phone_number',
    run: (page, profile) => fillFieldWithFallback(
      page,
      'input[data-automation-id="phone-number"]',
      /^Phone Number/i,
      normalizePhoneNumber(profile.phoneNumber),
    ),
  },
  {
    name: 'source',
    run: (page, profile) => typeaheadWithFallback(
      page,
      'div[data-automation-id="formField-source"] button',
      /How Did You Hear About Us/i,
      profile.source || 'LinkedIn',
    ),
  },
];

async function autofill(page, profile) {
  for (const a of autofillers) {
    await guarded(`my_info.${a.name}`, () => a.run(page, profile));
  }
}

module.exports = { pageType: 'my_information', autofillers, autofill };
