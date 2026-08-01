#!/usr/bin/env bash
set -e

echo ""
echo "🚀 Setting up LinkedIn & Workday Automation..."
echo ""

# 1. Prerequisites
echo -n "  [1/4] Checking prerequisites (Git & Node.js)... "
if ! command -v git &> /dev/null; then
    echo "❌ Failed"
    echo "      Reason: Git is not installed. Please install Git first."
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "❌ Failed"
    echo "      Reason: Node.js is not installed. Please install Node.js (v18+) from https://nodejs.org/"
    exit 1
fi
echo "✔"

# 2. Directory Setup
echo -n "  [2/4] Setting up project directory... "
TARGET_DIR="$HOME/linkedin_note"

if [ ! -f "./package.json" ]; then
    if [ ! -d "$TARGET_DIR/.git" ]; then
        git clone https://github.com/tomar-ayush/resume-agents.git "$TARGET_DIR" > /dev/null 2>&1 || {
            echo "❌ Failed"
            echo "      Reason: Could not clone git repository."
            exit 1
        }
    fi
    cd "$TARGET_DIR"
fi
echo "✔"

# 3. Install Dependencies
echo -n "  [3/4] Installing dependencies... "
npm install --no-audit --no-fund > /dev/null 2>&1 || {
    echo "❌ Failed"
    echo "      Reason: 'npm install' failed."
    exit 1
}
echo "✔"

# 4. Chrome Setup
echo "  [4/4] Syncing Chrome session profile..."
node setup.js || {
    echo "  ❌ Chrome setup failed."
    exit 1
}

echo ""
echo "✨ Setup complete! Desktop shortcut created."
echo "🚀 Starting server..."
echo ""

npm start
