#!/bin/bash
# ============================================================
# OMC Visual — Setup Script
# Run this in your project directory on the server
# ============================================================

set -e

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║       OMC Visual — Setup v0.1.0          ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "❌ Node.js is required but not installed."
  echo "   Install: sudo apt install -y nodejs npm"
  exit 1
fi

NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "❌ Node.js 20+ required, found $(node --version)"
  exit 1
fi
echo "✅ Node.js $(node --version)"

# Check npm
if ! command -v npm &>/dev/null; then
  echo "❌ npm is required but not installed."
  exit 1
fi
echo "✅ npm $(npm --version)"

# Check tmux
if ! command -v tmux &>/dev/null; then
  echo "⚠️  tmux not found. Installing..."
  sudo apt install -y tmux
fi
echo "✅ tmux $(tmux -V)"

# Check Claude Code
if command -v claude &>/dev/null; then
  echo "✅ Claude Code $(claude --version 2>/dev/null | head -1)"
else
  echo "⚠️  Claude Code CLI not found (optional for development)"
fi

# Check OMC
if command -v omc &>/dev/null; then
  echo "✅ oh-my-claudecode $(omc --version 2>/dev/null | head -1)"
else
  echo "⚠️  oh-my-claudecode not found (optional for development)"
fi

echo ""
echo "--- Installing dependencies ---"
echo ""

# Install root dependencies
echo "📦 Root dependencies..."
npm install

# Install server dependencies
echo "📦 Server dependencies..."
cd server
npm install
cd ..

# Install frontend dependencies
echo "📦 Frontend dependencies..."
cd frontend
npm install
cd ..

echo ""
echo "--- Build frontend ---"
echo ""
cd frontend
npm run build
cd ..

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║            Setup Complete!               ║"
echo "║                                          ║"
echo "║  Start the server:                       ║"
echo "║    npm start                             ║"
echo "║                                          ║"
echo "║  Or development mode (hot reload):       ║"
echo "║    npm run dev                           ║"
echo "║                                          ║"
echo "║  Then open in your browser:              ║"
echo "║    http://YOUR_SERVER_IP:3200             ║"
echo "╚══════════════════════════════════════════╝"
echo ""
