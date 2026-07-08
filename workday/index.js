// Workday application assistant — orchestrator.
//
// This file is the public entry point (require('./workday') resolves here).
// It owns: browser launch, navigation, and delegating the per-page work to the
// assist loop in ./loop. All page-specific logic lives in ./pages/*.

const {
  CHROME_USER_DATA_DIR,
  CHROME_PROFILE_DIRECTORY,
  CHROME_EXECUTABLE_PATH,
  DEFAULT_TIMEOUT_MS,
} = require('../config');
const { getOrCreateBrowserContext } = require('../browser');
const { logStep } = require('./helpers');
const { assistLoop } = require('./loop');

async function performWorkdayApplication(payload, updateResult) {
  const { application_id, job_url, profile = {} } = payload;

  logStep('task_started', {
    application_id,
    job_url,
    hasCredentials: !!(profile.email && profile.password),
  });

  if (!job_url) throw new Error('job_url is required.');
  if (!profile.email || !profile.password) {
    throw new Error('profile.email and profile.password are required.');
  }

  await updateResult({ state: 'started', error: null });

  const browser = await getOrCreateBrowserContext({
    userDataDir: CHROME_USER_DATA_DIR,
    profileDirectory: CHROME_PROFILE_DIRECTORY,
    executablePath: CHROME_EXECUTABLE_PATH,
    log: logStep,
  });

  if (!browser || browser.isClosed?.()) {
    throw new Error('Browser context was not created successfully.');
  }

  const page = await browser.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);

  try {
    logStep('navigate_to_job', { job_url });
    await page.goto(job_url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => { });
    await updateResult({ state: 'navigated', error: null });

    const result = await assistLoop(page, profile, updateResult);
    if (result.confirmed) {
      logStep('task_completed', { application_id });
    } else if (result.timedOut) {
      await updateResult({ state: 'timed_out_waiting_for_user', error: null });
      logStep('task_timed_out', { application_id });
    } else {
      await updateResult({ state: 'closed_by_user', error: null });
      logStep('task_closed_by_user', { application_id });
    }
  } catch (error) {
    logStep('task_failed', { application_id, error: error.message });
    await updateResult({ state: 'failed', error: error.message });
    throw error;
  }
}

module.exports = { performWorkdayApplication };
