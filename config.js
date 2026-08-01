const path = require('path');
const os = require('os');
const fs = require('fs');

function getSystemChromeExecutable() {
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  if (process.platform === 'win32') {
    const programFiles = process.env['PROGRAMFILES'] || 'C:\\Program Files';
    const programFilesx86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'] || path.join(os.homedir(), 'AppData', 'Local');

    const candidates = [
      path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesx86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    for (const cand of candidates) {
      if (fs.existsSync(cand)) return cand;
    }
    return candidates[0];
  }
  if (process.platform === 'linux') {
    const candidates = ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
    for (const cand of candidates) {
      if (fs.existsSync(cand)) return cand;
    }
    return '/usr/bin/google-chrome';
  }
  return '';
}

// Load config overrides from local JSON file if exists
let localConfig = {};
const configJsonPath = path.join(__dirname, 'config.json');
if (fs.existsSync(configJsonPath)) {
  try {
    localConfig = JSON.parse(fs.readFileSync(configJsonPath, 'utf8'));
  } catch (e) {
    // Ignore invalid JSON
  }
}

const chromeUserDataDir = process.env.CHROME_USER_DATA_DIR || localConfig.CHROME_USER_DATA_DIR || path.join(os.homedir(), 'chrome-automation');
const chromeProfileDirectory = process.env.CHROME_PROFILE_DIRECTORY || localConfig.CHROME_PROFILE_DIRECTORY || 'Profile 1';
const chromeExecutablePath = process.env.CHROME_EXECUTABLE_PATH || localConfig.CHROME_EXECUTABLE_PATH || getSystemChromeExecutable();

module.exports = {
  CHROME_USER_DATA_DIR: chromeUserDataDir,
  CHROME_PROFILE_DIRECTORY: chromeProfileDirectory,
  CHROME_EXECUTABLE_PATH: chromeExecutablePath,
  LINKEDIN_HOME_URL: 'https://www.linkedin.com',
  DEFAULT_TIMEOUT_MS: 600000,
};

