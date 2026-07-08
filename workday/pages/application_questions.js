// Page: application_questions
// Highly tenant-specific — questions vary per posting. Best-effort only:
//   * Fill a common "How did you hear about us?" (`formField-source`) if the
//     profile has a `source` value.
//   * Nothing else is safe to guess; the user fills the rest manually.

const { guarded, safeFill, safeTypeahead, isVisible, logStep } = require('../helpers');

const autofillers = [
  {
    name: 'source',
    run: async (page, profile) => {
      if (!profile.source) return;
      const trigger = 'div[data-automation-id="formField-source"] button';
      const input = 'div[data-automation-id="formField-source"] input';
      if (await isVisible(page, trigger, 400)) {
        await safeTypeahead(page, trigger, profile.source);
      } else if (await isVisible(page, input, 400)) {
        await safeFill(page, input, profile.source);
      }
    },
  },
];

async function autofill(page, profile) {
  for (const a of autofillers) {
    await guarded(`app_questions.${a.name}`, () => a.run(page, profile));
  }
  logStep('application_questions_autofilled_partially');
}

module.exports = { pageType: 'application_questions', autofillers, autofill };
