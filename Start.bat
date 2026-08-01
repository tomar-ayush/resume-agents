@echo off
cd /d "%~dp0"
echo ----------------------------------------------
echo 🚀 Starting LinkedIn & Workday Automation...
echo ----------------------------------------------
if not exist "node_modules\" (
    echo Installing dependencies...
    npm install
)
npm start
pause
