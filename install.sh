#!/usr/bin/env bash
set -e

echo ""
echo "======================================================"
echo "🚀 LinkedIn & Workday Automation - One-Line Installer"
echo "======================================================"
echo ""

# Step 1: Check prerequisites
echo "------------------------------------------------------"
echo "[Step 1/4] 🔍 Checking Prerequisites (Git & Node.js)..."
echo "------------------------------------------------------"

if ! command -v git &> /dev/null; then
    echo "❌ Error: Git is not installed. Please install Git first."
    exit 1
fi
echo "  ✅ Git detected: $(git --version)"

if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed. Please install Node.js (v18+) from https://nodejs.org/"
    exit 1
fi
echo "  ✅ Node.js detected: $(node -v)"

NODE_VERSION=$(node -v | cut -d'.' -f1 | sed 's/v//')
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "  ⚠️ Warning: Node.js v18 or higher is recommended. (Current: $(node -v))"
fi

# Step 2: Determine & prepare directory
echo ""
echo "------------------------------------------------------"
echo "[Step 2/4] 📦 Setting Up Project Directory..."
echo "------------------------------------------------------"

TARGET_DIR="$HOME/linkedin_note"

if [ -f "./package.json" ]; then
    PROJECT_DIR="$(pwd)"
    echo "  ℹ️ Using current directory: $PROJECT_DIR"
else
    PROJECT_DIR="$TARGET_DIR"
    if [ ! -d "$PROJECT_DIR/.git" ]; then
        echo "  ⏳ Cloning repository to $PROJECT_DIR..."
        git clone https://github.com/tomar-ayush/resume-agents.git "$PROJECT_DIR"
        echo "  ✅ Repository cloned successfully!"
    else
        echo "  ℹ️ Project already exists at: $PROJECT_DIR"
    fi
    cd "$PROJECT_DIR"
fi

# Step 3: Install dependencies
echo ""
echo "------------------------------------------------------"
echo "[Step 3/4] 📥 Installing Dependencies..."
echo "------------------------------------------------------"
echo "  ⏳ Downloading and installing npm packages (patchright, express, etc.)..."
npm install --no-audit --no-fund
echo "  ✅ Dependencies installed successfully!"

# Step 4: Chrome Profile Setup
echo ""
echo "------------------------------------------------------"
echo "[Step 4/4] ⚙️ Syncing Chrome Profile & Session..."
echo "------------------------------------------------------"
node setup.js

echo ""
echo "======================================================"
echo "🎉 Setup Completed Successfully!"
echo "📌 A desktop shortcut has been created on your Desktop."
echo "🚀 Launching Express server..."
echo "======================================================"
echo ""

npm start
