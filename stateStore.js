const fs = require('node:fs/promises');
const path = require('node:path');

const STATE_FILE_PATH = path.join(__dirname, 'state.json');

let stateCache = null;

async function loadState() {
  try {
    const content = await fs.readFile(STATE_FILE_PATH, 'utf8');
    stateCache = JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      stateCache = { jobs: {} };
      await fs.writeFile(STATE_FILE_PATH, JSON.stringify(stateCache, null, 2));
    } else {
      throw error;
    }
  }

  return stateCache;
}

async function ensureStateLoaded() {
  if (!stateCache) {
    await loadState();
  }
  return stateCache;
}

async function saveState() {
  await ensureStateLoaded();
  await fs.writeFile(STATE_FILE_PATH, JSON.stringify(stateCache, null, 2));
  return stateCache;
}

async function createJob(payload) {
  const current = await ensureStateLoaded();
  const referral_id = payload.referral_id;
  // Spread the full payload so callers (LinkedIn / Workday / anything else)
  // can persist any set of fields they care about without changing this file.
  current.jobs[referral_id] = {
    ...payload,
    referral_id,
    state: 'queued',
    error: null,
    updated_at: new Date().toISOString(),
  };
  await saveState();
  return current.jobs[referral_id];
}

async function updateJob({ referral_id, state, error }) {
  const current = await ensureStateLoaded();
  const existing = current.jobs[referral_id];
  if (!existing) {
    current.jobs[referral_id] = {
      referral_id,
      message: '',
      linkedin_url: '',
      referral_name: '',
      user_name: '',
      state: state || 'queued',
      error: error || null,
      updated_at: new Date().toISOString(),
    };
  } else {
    Object.assign(existing, {
      state: state || existing.state,
      error: error ?? existing.error,
      updated_at: new Date().toISOString(),
    });
  }
  await saveState();
  return current.jobs[referral_id];
}

async function getState(referral_id) {
  const current = await ensureStateLoaded();
  if (referral_id) {
    return current.jobs[referral_id] || null;
  }
  return current.jobs;
}

module.exports = {
  loadState,
  ensureStateLoaded,
  createJob,
  updateJob,
  getState,
  saveState,
};
