# LinkedIn & Workday Automation - Windows Installer

Write-Host ""
Write-Host "🚀 Setting up LinkedIn & Workday Automation..." -ForegroundColor Cyan
Write-Host ""

# 1. Check Git & Node
Write-Host -NoNewline "  [1/4] Checking prerequisites (Git & Node.js)... "
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Failed" -ForegroundColor Red
    Write-Host "      Reason: Git is not installed. Please install Git from https://git-scm.com/" -ForegroundColor Red
    exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Failed" -ForegroundColor Red
    Write-Host "      Reason: Node.js is not installed. Please install Node.js (v18+) from https://nodejs.org/" -ForegroundColor Red
    exit 1
}
Write-Host "✔" -ForegroundColor Green

# 2. Directory Setup
Write-Host -NoNewline "  [2/4] Setting up project directory... "
$TargetDir = "$HOME\linkedin_note"

if (-not (Test-Path ".\package.json")) {
    $ProjectDir = $TargetDir
    if (-not (Test-Path "$ProjectDir\.git")) {
        git clone https://github.com/tomar-ayush/resume-agents.git "$ProjectDir" *>$null
    }
    Set-Location $ProjectDir
}
Write-Host "✔" -ForegroundColor Green

# 3. Dependencies
Write-Host -NoNewline "  [3/4] Installing dependencies... "
npm install --no-audit --no-fund *>$null
Write-Host "✔" -ForegroundColor Green

# 4. Chrome Setup
Write-Host "  [4/4] Syncing Chrome session profile..."
node setup.js
