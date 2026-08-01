# LinkedIn & Workday Automation - One-Line Windows Installer

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "🚀 LinkedIn & Workday Automation - Windows Installer" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan

# 1. Check Git and Node
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Error: Git is not installed. Please install Git from https://git-scm.com/" -ForegroundColor Red
    exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Error: Node.js is not installed. Please install Node.js (v18+) from https://nodejs.org/" -ForegroundColor Red
    exit 1
}

# 2. Determine target directory
$TargetDir = "$HOME\linkedin_note"

if (Test-Path ".\package.json") {
    $ProjectDir = Get-Location
} else {
    $ProjectDir = $TargetDir
    if (-not (Test-Path "$ProjectDir\.git")) {
        Write-Host "📦 Cloning repository to $ProjectDir..." -ForegroundColor Yellow
        git clone https://github.com/tomar-ayush/resume-agents.git "$ProjectDir"
    }
    Set-Location $ProjectDir
}

Write-Host "📥 Installing Node dependencies..." -ForegroundColor Yellow
npm install --quiet

Write-Host "⚙️ Running automated Chrome setup..." -ForegroundColor Yellow
node setup.js

Write-Host "------------------------------------------------------" -ForegroundColor Green
Write-Host "✅ Setup Complete! A shortcut has been added to your Desktop." -ForegroundColor Green
Write-Host "🚀 Starting server..." -ForegroundColor Green
Write-Host "------------------------------------------------------" -ForegroundColor Green

npm start
