#!/usr/bin/env bash
cd "$(dirname "$0")"
echo "----------------------------------------------"
echo "🚀 Starting LinkedIn & Workday Automation..."
echo "----------------------------------------------"
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi
npm start
