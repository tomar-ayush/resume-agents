/**
 * Automated Cross-Platform Setup & Profile Sync Script
 * 
 * Handles:
 * 1. Gracefully closing Chrome on macOS, Windows, and Linux.
 * 2. Auto-detecting Chrome user profile path and finding active profiles.
 * 3. Copying Local State + target Profile to ~/chrome-automation.
 * 4. Touching "First Run" sentinel to skip welcome prompts.
 * 5. Creating double-clickable Desktop shortcuts.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';

// --- Helper Functions ---

function log(msg, type = 'info') {
  const icons = { info: 'ℹ️ ', success: '✅', warning: '⚠️ ', error: '❌', rocket: '🚀' };
  console.log(`${icons[type] || ''} ${msg}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 1. Close Chrome gracefully per OS
function closeChrome() {
  log('Closing active Google Chrome instances...', 'info');
  try {
    if (IS_MAC) {
      execSync(`osascript -e 'quit app "Google Chrome"'`, { stdio: 'ignore' });
    } else if (IS_WIN) {
      execSync(`taskkill /IM chrome.exe /F`, { stdio: 'ignore' });
    } else if (IS_LINUX) {
      execSync(`pkill google-chrome || pkill chrome || pkill chromium`, { stdio: 'ignore' });
    }
  } catch (e) {
    // Ignore errors if Chrome was not running
  }
}

// 2. Locate System Chrome Data Directory
function getSystemChromeDir() {
  if (IS_MAC) {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
  }
  if (IS_WIN) {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'Google', 'Chrome', 'User Data');
  }
  if (IS_LINUX) {
    const chromePath = path.join(os.homedir(), '.config', 'google-chrome');
    const chromiumPath = path.join(os.homedir(), '.config', 'chromium');
    return fs.existsSync(chromePath) ? chromePath : chromiumPath;
  }
  return '';
}

// 3. Find active Chrome Profiles (Default, Profile 1, Profile 2, etc.)
function findActiveProfiles(chromeDir) {
  if (!fs.existsSync(chromeDir)) return [];

  const entries = fs.readdirSync(chromeDir, { withFileTypes: true });
  const profiles = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'Default' || entry.name.startsWith('Profile ')) {
      const cookiesPath = path.join(chromeDir, entry.name, 'Cookies');
      let size = 0;
      let hasCookies = false;
      if (fs.existsSync(cookiesPath)) {
        try {
          const stats = fs.statSync(cookiesPath);
          size = stats.size;
          hasCookies = size > 0;
        } catch (e) {}
      }
      profiles.push({ name: entry.name, size, hasCookies });
    }
  }

  // Sort profiles by cookie size descending
  profiles.sort((a, b) => b.size - a.size);
  return profiles;
}

// 4. Create Desktop Shortcut for Non-Technical Users
function createDesktopShortcut(projectDir) {
  const desktopDir = path.join(os.homedir(), 'Desktop');
  if (!fs.existsSync(desktopDir)) return;

  if (IS_MAC || IS_LINUX) {
    const shortcutPath = path.join(desktopDir, 'Start LinkedIn Automation.command');
    const content = `#!/usr/bin/env bash
cd "${projectDir}"
echo "----------------------------------------------"
echo "🚀 Starting LinkedIn & Workday Automation..."
echo "----------------------------------------------"
npm start
`;
    fs.writeFileSync(shortcutPath, content, { mode: 0o755 });
    log(`Created Mac Desktop shortcut: ${shortcutPath}`, 'success');
  } else if (IS_WIN) {
    const shortcutPath = path.join(desktopDir, 'Start LinkedIn Automation.bat');
    const content = `@echo off
cd /d "${projectDir}"
echo ----------------------------------------------
echo 🚀 Starting LinkedIn & Workday Automation...
echo ----------------------------------------------
npm start
pause
`;
    fs.writeFileSync(shortcutPath, content);
    log(`Created Windows Desktop shortcut: ${shortcutPath}`, 'success');
  }
}

// --- Main Setup Flow ---

async function runSetup() {
  log('Starting Automated Setup...', 'rocket');

  // Check command line arguments (e.g. --profile="Profile 2")
  const args = process.argv.slice(2);
  let selectedProfileName = null;
  const profileArg = args.find((a) => a.startsWith('--profile='));
  if (profileArg) {
    selectedProfileName = profileArg.split('=')[1];
  }

  const systemChromeDir = getSystemChromeDir();
  if (!systemChromeDir || !fs.existsSync(systemChromeDir)) {
    log(`Could not find Google Chrome user directory at: ${systemChromeDir}`, 'error');
    log('Please ensure Google Chrome is installed.', 'warning');
    process.exit(1);
  }

  const profiles = findActiveProfiles(systemChromeDir);
  if (profiles.length === 0) {
    log(`No Chrome profiles found inside: ${systemChromeDir}`, 'error');
    process.exit(1);
  }

  if (!selectedProfileName) {
    selectedProfileName = profiles[0].name; // Default to profile with largest Cookies file
  }

  log(`Detected Chrome directory: ${systemChromeDir}`, 'info');
  log(`Selected Chrome profile: ${selectedProfileName}`, 'info');

  // Step 1: Close Chrome to release SQLite locks
  closeChrome();
  await sleep(3000);

  // Step 2: Target automation directory
  const targetDir = path.join(os.homedir(), 'chrome-automation');
  log(`Automation target directory: ${targetDir}`, 'info');

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Step 3: Copy Local State
  const localStateSrc = path.join(systemChromeDir, 'Local State');
  const localStateDest = path.join(targetDir, 'Local State');
  if (fs.existsSync(localStateSrc)) {
    fs.copyFileSync(localStateSrc, localStateDest);
    log('Copied Local State encryption key file.', 'success');
  } else {
    log('Local State file not found in source Chrome directory.', 'warning');
  }

  // Step 4: Copy Selected Profile Directory
  const profileSrc = path.join(systemChromeDir, selectedProfileName);
  const profileDest = path.join(targetDir, selectedProfileName);

  if (fs.existsSync(profileSrc)) {
    log(`Copying profile "${selectedProfileName}" (this may take a few seconds)...`, 'info');
    fs.cpSync(profileSrc, profileDest, { recursive: true, force: true });
    log(`Successfully copied "${selectedProfileName}" to automation directory.`, 'success');
  } else {
    log(`Source profile folder "${profileSrc}" does not exist!`, 'error');
    process.exit(1);
  }

  // Step 5: Touch "First Run" sentinel
  const firstRunFile = path.join(targetDir, 'First Run');
  fs.writeFileSync(firstRunFile, '');
  log('Created First Run sentinel.', 'success');

  // Step 6: Save local config.json
  const configJsonPath = path.join(__dirname, 'config.json');
  fs.writeFileSync(
    configJsonPath,
    JSON.stringify({ CHROME_PROFILE_DIRECTORY: selectedProfileName }, null, 2)
  );

  // Step 7: Create Desktop Shortcut
  createDesktopShortcut(__dirname);

  log('Setup completed successfully! You are ready to run.', 'success');

  if (args.includes('--start')) {
    log('Starting server...', 'rocket');
    execSync('npm start', { stdio: 'inherit' });
  }
}

runSetup().catch((err) => {
  log(`Setup failed: ${err.message}`, 'error');
  console.error(err);
  process.exit(1);
});
