#!/usr/bin/env bash
set -e

echo "======================================================"
echo "🚀 LinkedIn & Workday Automation - One-Line Installer"
echo "======================================================"

# 1. Check prerequisites: Node.js and Git
if ! command -v git &> /dev/null; then
    echo "❌ Error: Git is not installed. Please install Git first."
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed. Please install Node.js (v18+) from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'.' -f1 | sed 's/v//')
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "⚠️ Warning: Node.js v18 or higher is recommended. (Current: $(node -v))"
fi

# 2. Determine target directory
TARGET_DIR="$HOME/linkedin_note"

# If already inside the project directory, use current directory
if [ -f "./package.json" ]; then
    PROJECT_DIR="$(pwd)"
else
    PROJECT_DIR="$TARGET_DIR"
    if [ ! -d "$PROJECT_DIR/.git" ]; then
        echo "📦 Cloning repository to $PROJECT_DIR..."
        git clone https://github.com/tomar-ayush/resume-agents.git "$PROJECT_DIR" || {
            echo "⚠️ Could not clone repository automatically. Using local directory if available."
        }
    fi
    cd "$PROJECT_DIR"
fi

echo "📥 Installing Node dependencies..."
npm install --quiet

echo "⚙️ Running automated Chrome setup..."
node setup.js

echo "------------------------------------------------------"
echo "✅ Setup Complete! A shortcut has been added to your Desktop."
echo "🚀 Starting server..."
echo "------------------------------------------------------"

npm start
