// Page detection. Pure function of the current page state — no side effects.
//
// Priority order matters: blocking modals first, then modal-open sign-in states,
// then form pages, then generic fallback (adventure button).
//
// Newer AspenTech-style Workday tenants use `applyFlow*Page` container IDs.
// Legacy tenants use `*Page` (no prefix). Support both.

const { isVisible } = require('./helpers');

// Each entry: { type, selectors[] }. detectPage walks the list top-to-bottom
// and returns the first type whose ANY selector is visible. Keeping the list
// here (instead of inline in detectPage) makes it trivial to add a new tenant
// marker without touching logic.
const PAGE_SIGNATURES = [
  { type: 'legal_notice', selectors: ['button[data-automation-id="legalNoticeAcceptButton"]'] },
  { type: 'create_account', selectors: ['button[data-automation-id="createAccountSubmitButton"]'] },
  { type: 'sign_in', selectors: ['button[data-automation-id="signInSubmitButton"]'] },
  {
    type: 'sign_in_prompt',
    selectors: [
      'button[data-automation-id="utilityButtonSignIn"]',
      'button[data-automation-id="signInLink"]',
      'a[data-automation-id="signInLink"]',
    ],
  },
  {
    type: 'create_account_prompt',
    selectors: [
      'button[data-automation-id="createAccountLink"]',
      'a[data-automation-id="createAccountLink"]',
    ],
  },
  { type: 'apply_choice', selectors: ['a[data-automation-id="applyManually"]'] },
  {
    type: 'my_information',
    selectors: [
      'div[data-automation-id="contactInformationPage"]',
      'div[data-automation-id="applyFlowMyInfoPage"]',
    ],
  },
  {
    type: 'my_experience',
    selectors: [
      'div[data-automation-id="myExperiencePage"]',
      'div[data-automation-id="applyFlowMyExperiencePage"]',
      'div[data-automation-id="applyFlowMyExpPage"]',
      'div[data-automation-id="applyFlowExperiencePage"]',
    ],
  },
  {
    type: 'application_questions',
    selectors: [
      'div[data-automation-id="applyFlowApplicationQuestionsPage"]',
      'div[data-automation-id="applicationQuestionsPage"]',
      'div[data-automation-id="additionalInformationPage"]',
    ],
  },
  {
    type: 'voluntary_disclosures',
    selectors: [
      'div[data-automation-id="voluntaryDisclosuresPage"]',
      'div[data-automation-id="applyFlowVoluntaryDisclosuresPage"]',
    ],
  },
  {
    type: 'self_identification',
    selectors: [
      'div[data-automation-id="selfIdentificationPage"]',
      'div[data-automation-id="applyFlowSelfIdentificationPage"]',
    ],
  },
  {
    type: 'review',
    selectors: [
      'div[data-automation-id="reviewSubmitPage"]',
      'div[data-automation-id="pageSummary"]',
      'div[data-automation-id="applyFlowReviewPage"]',
      'div[data-automation-id="applyFlowReviewSubmitPage"]',
    ],
  },
  { type: 'apply_gate', selectors: ['a[data-automation-id="adventureButton"]'] },
];

async function detectPage(page) {
  const url = page.url();
  if (/confirmation|thankyou|thank-you|submitted/i.test(url)) return 'confirmation';

  for (const sig of PAGE_SIGNATURES) {
    for (const sel of sig.selectors) {
      if (await isVisible(page, sel, 300)) return sig.type;
    }
  }

  return 'unknown';
}

module.exports = { detectPage, PAGE_SIGNATURES };
