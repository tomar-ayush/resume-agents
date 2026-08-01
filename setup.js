/**
 * Automated Cross-Platform Setup & Profile Sync Script
 * Clean output + Global Terminal Alias + ASCII Art Banner.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 1. Close Chrome
function closeChrome() {
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
      if (fs.existsSync(cookiesPath)) {
        try {
          const stats = fs.statSync(cookiesPath);
          size = stats.size;
        } catch (e) {}
      }
      profiles.push({ name: entry.name, size });
    }
  }

  profiles.sort((a, b) => b.size - a.size);
  return profiles;
}

// Calculate directory size
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

// Copy Directory with Inline Progress Bar
function copyDirWithProgress(src, dest, totalSize) {
  let copiedBytes = 0;
  const barLength = 20;
  const safeTotalSize = Math.max(totalSize, 1);

  function renderProgress() {
    const pct = Math.min(100, (copiedBytes / safeTotalSize) * 100);
    const filled = Math.round((barLength * pct) / 100);
    const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
    const copiedMB = (copiedBytes / (1024 * 1024)).toFixed(1);
    const totalMB = (safeTotalSize / (1024 * 1024)).toFixed(1);
    process.stdout.write(`\r        ⏳ Copying: [${bar}] ${pct.toFixed(0)}% (${copiedMB}/${totalMB} MB)`);
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
        // Skip locked temporary files
      }
    }
  }

  renderProgress();
  copyRecursive(src, dest);
  process.stdout.write('\r        ✔ Session copied successfully!                        \n');
}

// Create Desktop Shortcut
function createDesktopShortcut(projectDir) {
  const desktopDir = path.join(os.homedir(), 'Desktop');
  if (!fs.existsSync(desktopDir)) return;

  if (IS_MAC || IS_LINUX) {
    const shortcutPath = path.join(desktopDir, 'Start LinkedIn Automation.command');
    const content = `#!/usr/bin/env bash
cd "${projectDir}"
npm start
`;
    fs.writeFileSync(shortcutPath, content, { mode: 0o755 });
  } else if (IS_WIN) {
    const shortcutPath = path.join(desktopDir, 'Start LinkedIn Automation.bat');
    const content = `@echo off
cd /d "${projectDir}"
npm start
pause
`;
    fs.writeFileSync(shortcutPath, content);
  }
}

// Configure Global Terminal Alias "apply-ai"
function setupGlobalAlias(projectDir) {
  const aliasName = 'apply-ai';

  if (IS_MAC || IS_LINUX) {
    // 1. Create executable script in ~/bin
    const binDir = path.join(os.homedir(), 'bin');
    if (!fs.existsSync(binDir)) {
      try { fs.mkdirSync(binDir, { recursive: true }); } catch (e) {}
    }

    const binScriptPath = path.join(binDir, aliasName);
    const scriptContent = `#!/usr/bin/env bash\ncd "${projectDir}" && npm start\n`;
    try {
      fs.writeFileSync(binScriptPath, scriptContent, { mode: 0o755 });
    } catch (e) {}

    // 2. Append alias to ~/.zshrc, ~/.bashrc, ~/.bash_profile
    const rcFiles = ['.zshrc', '.bashrc', '.bash_profile'].map((f) => path.join(os.homedir(), f));
    const aliasLine = `alias ${aliasName}='cd "${projectDir}" && npm start'`;

    for (const rcFile of rcFiles) {
      if (fs.existsSync(rcFile)) {
        const content = fs.readFileSync(rcFile, 'utf8');
        if (!content.includes(`alias ${aliasName}=`)) {
          fs.appendFileSync(rcFile, `\n# Auto-Apply AI Alias\n${aliasLine}\n`);
        }
      }
    }
  } else if (IS_WIN) {
    const binDir = path.join(os.homedir(), 'bin');
    if (!fs.existsSync(binDir)) {
      try { fs.mkdirSync(binDir, { recursive: true }); } catch (e) {}
    }
    const batPath = path.join(binDir, `${aliasName}.bat`);
    const batContent = `@echo off\ncd /d "${projectDir}"\nnpm start\n`;
    try {
      fs.writeFileSync(batPath, batContent);
    } catch (e) {}
  }
}

// Print ASCII Art Banner
function printAsciiArt() {
  console.log(`
       _   ___ ___ _    __   __   _   ___ 
      /_\\ | _ \\ _ \\ |   \\ \\ / /  /_\\ |_ _|
     / _ \\|  _/  _/ |__  \\ V /  / _ \\ | | 
    /_/ \\_\\_| |_| |____|  |_|  /_/ \\_\\___|
  `);
  console.log('======================================================');
  console.log('✨ Setup Completed Successfully! (Server NOT auto-started)\n');
  console.log('👉 To run from ANYWHERE in your terminal, type:');
  console.log('   $ apply-ai\n');
  console.log('👉 Or double-click the icon on your Desktop:');
  console.log('   [ Start LinkedIn Automation ]');
  console.log('======================================================\n');
}

// --- Main Setup Flow ---

async function runSetup() {
  const args = process.argv.slice(2);
  let selectedProfileName = null;
  const profileArg = args.find((a) => a.startsWith('--profile='));
  if (profileArg) {
    selectedProfileName = profileArg.split('=')[1];
  }

  // 1. Detect Chrome
  process.stdout.write('  [1/4] Detecting Chrome profile... ');
  const systemChromeDir = getSystemChromeDir();
  if (!systemChromeDir || !fs.existsSync(systemChromeDir)) {
    console.log('❌ Failed');
    console.error(`      Reason: Could not find Chrome installation at ${systemChromeDir}`);
    process.exit(1);
  }

  const profiles = findActiveProfiles(systemChromeDir);
  if (profiles.length === 0) {
    console.log('❌ Failed');
    console.error(`      Reason: No user profiles found in ${systemChromeDir}`);
    process.exit(1);
  }

  if (!selectedProfileName) {
    selectedProfileName = profiles[0].name;
  }
  console.log(`✔ (${selectedProfileName})`);

  // 2. Close Chrome
  process.stdout.write('  [2/4] Closing active Chrome instances... ');
  closeChrome();
  await sleep(2500);
  console.log('✔');

  // 3. Copy Session Profile
  console.log(`  [3/4] Copying session files to ~/chrome-automation...`);
  const targetDir = path.join(os.homedir(), 'chrome-automation');
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const localStateSrc = path.join(systemChromeDir, 'Local State');
  const localStateDest = path.join(targetDir, 'Local State');
  if (fs.existsSync(localStateSrc)) {
    fs.copyFileSync(localStateSrc, localStateDest);
  }

  const profileSrc = path.join(systemChromeDir, selectedProfileName);
  const profileDest = path.join(targetDir, selectedProfileName);

  if (fs.existsSync(profileSrc)) {
    const totalSize = getFolderSize(profileSrc);
    copyDirWithProgress(profileSrc, profileDest, totalSize);
  } else {
    console.log('❌ Failed');
    console.error(`      Reason: Source profile ${profileSrc} does not exist.`);
    process.exit(1);
  }

  // Save config & sentinel
  const firstRunFile = path.join(targetDir, 'First Run');
  fs.writeFileSync(firstRunFile, '');

  const configJsonPath = path.join(__dirname, 'config.json');
  fs.writeFileSync(
    configJsonPath,
    JSON.stringify({ CHROME_PROFILE_DIRECTORY: selectedProfileName }, null, 2)
  );

  // 4. Create Desktop Shortcut & Global Terminal Alias
  process.stdout.write('  [4/4] Setting up Desktop shortcut & global terminal alias ("apply-ai")... ');
  createDesktopShortcut(__dirname);
  setupGlobalAlias(__dirname);
  console.log('✔');

  // Print ASCII Art summary
  printAsciiArt();

  if (args.includes('--start')) {
    console.log('🚀 Starting server now...');
    execSync('npm start', { stdio: 'inherit' });
  }
}

runSetup().catch((err) => {
  console.log('❌ Failed');
  console.error(`      Reason: ${err.message}`);
  process.exit(1);
});
