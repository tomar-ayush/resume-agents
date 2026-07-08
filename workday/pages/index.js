// Registry: pageType -> page module.
//
// The loop calls `getPageModule(pageType)` to fetch the handler for whatever
// page detectPage() reported. Add a new page by creating a module in this
// folder and registering it here — no other file needs to change.

const legalNotice = require('./legal_notice');
const applyGate = require('./apply_gate');
const applyChoice = require('./apply_choice');
const signInPrompt = require('./sign_in_prompt');
const createAccountPrompt = require('./create_account_prompt');
const signIn = require('./sign_in');
const createAccount = require('./create_account');
const myInformation = require('./my_information');
const myExperience = require('./my_experience');
const applicationQuestions = require('./application_questions');
const voluntaryDisclosures = require('./voluntary_disclosures');
const selfIdentification = require('./self_identification');
const review = require('./review');

const REGISTRY = {
  legal_notice: legalNotice,
  apply_gate: applyGate,
  apply_choice: applyChoice,
  sign_in_prompt: signInPrompt,
  create_account_prompt: createAccountPrompt,
  sign_in: signIn,
  create_account: createAccount,
  my_information: myInformation,
  my_experience: myExperience,
  application_questions: applicationQuestions,
  voluntary_disclosures: voluntaryDisclosures,
  self_identification: selfIdentification,
  review,
};

// Pages that contain form fields worth dumping for debugging on first sight.
const FORM_PAGES = new Set([
  'my_information',
  'my_experience',
  'application_questions',
  'voluntary_disclosures',
  'self_identification',
  'review',
]);

function getPageModule(pageType) {
  return REGISTRY[pageType] || null;
}

module.exports = { REGISTRY, FORM_PAGES, getPageModule };
