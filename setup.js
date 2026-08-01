/**
 * Automated Cross-Platform Setup & Profile Sync Script
 * 
 * Features:
 * - Real-time progressive copy updates with an interactive progress bar.
 * - Clear step-by-step indicators ([1/5] to [5/5]).
 * - Graceful Chrome closing across macOS, Windows, and Linux.
 * - Desktop shortcut generation.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';

// --- Logging Helper ---

function logStep(stepNum, totalSteps, title) {
  console.log(`\n======================================================`);
  console.log(`[${stepNum}/${totalSteps}] ${title}`);
  console.log(`======================================================`);
}

function logInfo(msg) {
  console.log(`  ℹ️  ${msg}`);
}

function logSuccess(msg) {
  console.log(`  ✅ ${msg}`);
}

function logWarning(msg) {
  console.log(`  ⚠️  ${msg}`);
}

function logError(msg) {
  console.log(`  ❌ ${msg}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 1. Gracefully close Chrome per OS
function closeChrome() {
  logInfo('Closing active Google Chrome instances to release session database locks...');
  try {
    if (IS_MAC) {
      execSync(`osascript -e 'quit app "Google Chrome"'`, { stdio: 'ignore' });
    } else if (IS_WIN) {
      execSync(`taskkill /IM chrome.exe /F`, { stdio: 'ignore' });
    } else if (IS_LINUX) {
      execSync(`pkill google-chrome || pkill chrome || pkill chromium`, { stdio: 'ignore' });
    }
  } catch (e) {
    // Chrome was not running
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

// 3. Find active Chrome Profiles
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

  profiles.sort((a, b) => b.size - a.size);
  return profiles;
}

// Calculate directory size recursively
function getFolderSize(dirPath) {
  let size = 0;
  if (!fs.existsSync(dirPath)) return 0;

  try {
    const files = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const file of files) {
      const filePath = path.join(dirPath, file.name);
      try {
        if (file.isDirectory()) {
          size += getFolderSize(filePath);
        } else {
          const stats = fs.statSync(filePath);
          size += stats.size;
        }
      } catch (e) {}
    }
  } catch (e) {}

  return size;
}

// Copy Directory with Real-time Terminal Progress Bar
function copyDirWithProgress(src, dest, totalSize) {
  let copiedBytes = 0;
  const barLength = 25;
  const safeTotalSize = Math.max(totalSize, 1);

  function renderProgress() {
    const pct = Math.min(100, (copiedBytes / safeTotalSize) * 100);
    const filled = Math.round((barLength * pct) / 100);
    const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
    const copiedMB = (copiedBytes / (1024 * 1024)).toFixed(1);
    const totalMB = (safeTotalSize / (1024 * 1024)).toFixed(1);
    process.stdout.write(`\r  ⏳ Copying files: [${bar}] ${pct.toFixed(1)}% (${copiedMB} MB / ${totalMB} MB)`);
  }

  function copyRecursive(currentSrc, currentDest) {
    if (!fs.existsSync(currentDest)) {
      fs.mkdirSync(currentDest, { recursive: true });
    }
    const entries = fs.readdirSync(currentSrc, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(currentSrc, entry.name);
      const destPath = path.join(currentDest, entry.name);

      try {
        if (entry.isDirectory()) {
          copyRecursive(srcPath, destPath);
        } else {
          fs.copyFileSync(srcPath, destPath);
          const stats = fs.statSync(srcPath);
          copiedBytes += stats.size;
          renderProgress();
        }
      } catch (e) {
        // Skip locked temporary files safely
      }
    }
  }

  renderProgress();
  copyRecursive(src, dest);
  process.stdout.write('\n'); // New line when completed
}

// Create Desktop Shortcut for Non-Technical Users
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
    logSuccess(`Created Desktop shortcut: ${shortcutPath}`);
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
    logSuccess(`Created Desktop shortcut: ${shortcutPath}`);
  }
}

// --- Main Setup Flow ---

async function runSetup() {
  console.log('\n🚀 Starting LinkedIn & Workday Automation Setup...');

  const args = process.argv.slice(2);
  let selectedProfileName = null;
  const profileArg = args.find((a) => a.startsWith('--profile='));
  if (profileArg) {
    selectedProfileName = profileArg.split('=')[1];
  }

  // STEP 1: Detect Chrome Installation
  logStep(1, 5, 'Detecting Chrome Installation & Profiles');
  const systemChromeDir = getSystemChromeDir();
  if (!systemChromeDir || !fs.existsSync(systemChromeDir)) {
    logError(`Could not find Google Chrome user directory at: ${systemChromeDir}`);
    logWarning('Please ensure Google Chrome is installed.');
    process.exit(1);
  }

  const profiles = findActiveProfiles(systemChromeDir);
  if (profiles.length === 0) {
    logError(`No Chrome profiles found inside: ${systemChromeDir}`);
    process.exit(1);
  }

  if (!selectedProfileName) {
    selectedProfileName = profiles[0].name;
  }

  logInfo(`Found system Chrome directory: ${systemChromeDir}`);
  logInfo(`Selected active Chrome profile: "${selectedProfileName}"`);
  logSuccess('Chrome profile detected!');

  // STEP 2: Close Active Chrome
  logStep(2, 5, 'Closing Active Chrome Instances');
  closeChrome();
  logInfo('Waiting 3 seconds for database locks to clear...');
  await sleep(3000);
  logSuccess('Chrome closed successfully!');

  // STEP 3: Copy Profile Data with Real-time Progress Bar
  logStep(3, 5, 'Copying Chrome Profile & Session Data');
  const targetDir = path.join(os.homedir(), 'chrome-automation');
  logInfo(`Target directory: ${targetDir}`);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Copy Local State Key
  const localStateSrc = path.join(systemChromeDir, 'Local State');
  const localStateDest = path.join(targetDir, 'Local State');
  if (fs.existsSync(localStateSrc)) {
    fs.copyFileSync(localStateSrc, localStateDest);
    logSuccess('Copied Local State encryption key.');
  }

  // Copy Profile Folder with Progress Bar
  const profileSrc = path.join(systemChromeDir, selectedProfileName);
  const profileDest = path.join(targetDir, selectedProfileName);

  if (fs.existsSync(profileSrc)) {
    logInfo(`Calculating profile data size...`);
    const totalSize = getFolderSize(profileSrc);
    logInfo(`Total size to copy: ${(totalSize / (1024 * 1024)).toFixed(1)} MB`);
    
    copyDirWithProgress(profileSrc, profileDest, totalSize);
    logSuccess(`Successfully copied "${selectedProfileName}" to automation directory!`);
  } else {
    logError(`Source profile folder "${profileSrc}" does not exist!`);
    process.exit(1);
  }

  // STEP 4: Save Configuration & Sentinel
  logStep(4, 5, 'Saving Configuration & Sentinel Files');
  const firstRunFile = path.join(targetDir, 'First Run');
  fs.writeFileSync(firstRunFile, '');
  logSuccess('Created "First Run" sentinel file.');

  const configJsonPath = path.join(__dirname, 'config.json');
  fs.writeFileSync(
    configJsonPath,
    JSON.stringify({ CHROME_PROFILE_DIRECTORY: selectedProfileName }, null, 2)
  );
  logSuccess('Saved configuration file config.json');

  // STEP 5: Create Shortcuts
  logStep(5, 5, 'Generating Desktop Launchers');
  createDesktopShortcut(__dirname);

  console.log('\n======================================================');
  logSuccess('✨ Setup Completed Successfully!');
  console.log('======================================================\n');

  if (args.includes('--start')) {
    logInfo('Starting server now...');
    execSync('npm start', { stdio: 'inherit' });
  }
}

runSetup().catch((err) => {
  logError(`Setup failed: ${err.message}`);
  console.error(err);
  process.exit(1);
});
