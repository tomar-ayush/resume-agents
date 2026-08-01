# LinkedIn & Workday Automation - One-Line Windows Installer

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "🚀 LinkedIn & Workday Automation - Windows Installer" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Prerequisites
Write-Host "------------------------------------------------------" -ForegroundColor Yellow
Write-Host "[Step 1/4] 🔍 Checking Prerequisites (Git & Node.js)..." -ForegroundColor Yellow
Write-Host "------------------------------------------------------" -ForegroundColor Yellow

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Error: Git is not installed. Please install Git from https://git-scm.com/" -ForegroundColor Red
    exit 1
}
Write-Host "  ✅ Git detected" -ForegroundColor Green

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Error: Node.js is not installed. Please install Node.js (v18+) from https://nodejs.org/" -ForegroundColor Red
    exit 1
}
Write-Host "  ✅ Node.js detected" -ForegroundColor Green

# Step 2: Directory Setup
Write-Host ""
Write-Host "------------------------------------------------------" -ForegroundColor Yellow
Write-Host "[Step 2/4] 📦 Setting Up Project Directory..." -ForegroundColor Yellow
Write-Host "------------------------------------------------------" -ForegroundColor Yellow

$TargetDir = "$HOME\linkedin_note"

if (Test-Path ".\package.json") {
    $ProjectDir = Get-Location
    Write-Host "  ℹ️ Using current directory: $ProjectDir" -ForegroundColor Gray
} else {
    $ProjectDir = $TargetDir
    if (-not (Test-Path "$ProjectDir\.git")) {
        Write-Host "  ⏳ Cloning repository to $ProjectDir..." -ForegroundColor Gray
        git clone https://github.com/tomar-ayush/resume-agents.git "$ProjectDir"
        Write-Host "  ✅ Repository cloned successfully!" -ForegroundColor Green
    } else {
        Write-Host "  ℹ️ Project already exists at: $ProjectDir" -ForegroundColor Gray
    }
    Set-Location $ProjectDir
}

# Step 3: Install Dependencies
Write-Host ""
Write-Host "------------------------------------------------------" -ForegroundColor Yellow
Write-Host "[Step 3/4] 📥 Installing Dependencies..." -ForegroundColor Yellow
Write-Host "------------------------------------------------------" -ForegroundColor Yellow
Write-Host "  ⏳ Downloading and installing npm packages..." -ForegroundColor Gray
npm install --no-audit --no-fund
Write-Host "  ✅ Dependencies installed successfully!" -ForegroundColor Green

# Step 4: Run Setup
Write-Host ""
Write-Host "------------------------------------------------------" -ForegroundColor Yellow
Write-Host "[Step 4/4] ⚙️ Syncing Chrome Profile & Session..." -ForegroundColor Yellow
Write-Host "------------------------------------------------------" -ForegroundColor Yellow
node setup.js

Write-Host ""
Write-Host "======================================================" -ForegroundColor Green
Write-Host "🎉 Setup Completed Successfully!" -ForegroundColor Green
Write-Host "📌 A desktop shortcut has been created on your Desktop." -ForegroundColor Green
Write-Host "🚀 Launching Express server..." -ForegroundColor Green
Write-Host "======================================================" -ForegroundColor Green
Write-Host ""

npm start
