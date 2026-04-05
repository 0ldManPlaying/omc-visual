#!/bin/bash
# OMC Visual — Fase 2 Deploy Script
# Dit script vervangt 3 bestanden en herbouwt de frontend
#
# GEBRUIK:
#   1. Upload de UPDATED map naar je server (bijv. via Cursor SSH drag & drop)
#   2. Draai: bash deploy.sh
#
# Het script maakt automatisch backups van je huidige bestanden.

set -e

PROJECT_DIR="$HOME/oh-my-claude/omc-visual"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║     OMC Visual — Fase 2 Deploy                  ║"
echo "║     Clawhip installatie + dashboard update       ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Check project dir exists
if [ ! -d "$PROJECT_DIR" ]; then
  echo "❌ Project niet gevonden op: $PROJECT_DIR"
  exit 1
fi

echo "📁 Project gevonden: $PROJECT_DIR"
echo ""

# --- Step 1: Backup ---
echo "📦 Stap 1/4 — Backups maken..."
BACKUP_DIR="$PROJECT_DIR/backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

cp "$PROJECT_DIR/server/src/routes/clawhip.js" "$BACKUP_DIR/clawhip.js" 2>/dev/null && echo "   ✓ clawhip.js backup" || echo "   ⚠ clawhip.js niet gevonden (nieuw bestand)"
cp "$PROJECT_DIR/frontend/src/stores/useStore.js" "$BACKUP_DIR/useStore.js" 2>/dev/null && echo "   ✓ useStore.js backup" || true
cp "$PROJECT_DIR/frontend/src/pages/Dashboard.jsx" "$BACKUP_DIR/Dashboard.jsx" 2>/dev/null && echo "   ✓ Dashboard.jsx backup" || true

echo "   Backups opgeslagen in: $BACKUP_DIR"
echo ""

# --- Step 2: Copy new files ---
echo "📝 Stap 2/4 — Nieuwe bestanden plaatsen..."

cp "$SCRIPT_DIR/server-routes/clawhip.js" "$PROJECT_DIR/server/src/routes/clawhip.js"
echo "   ✓ server/src/routes/clawhip.js"

cp "$SCRIPT_DIR/frontend-stores/useStore.js" "$PROJECT_DIR/frontend/src/stores/useStore.js"
echo "   ✓ frontend/src/stores/useStore.js"

cp "$SCRIPT_DIR/frontend-pages/Dashboard.jsx" "$PROJECT_DIR/frontend/src/pages/Dashboard.jsx"
echo "   ✓ frontend/src/pages/Dashboard.jsx"
echo ""

# --- Step 3: Rebuild frontend ---
echo "🔨 Stap 3/4 — Frontend opnieuw bouwen..."
cd "$PROJECT_DIR/frontend"
npm run build
echo "   ✓ Frontend build voltooid"
echo ""

# --- Step 4: Restart server ---
echo "🔄 Stap 4/4 — Server herstarten..."

# Try pm2 first, then manual restart
if command -v pm2 &> /dev/null && pm2 list 2>/dev/null | grep -q "omc-visual"; then
  pm2 restart omc-visual
  echo "   ✓ Server herstart via pm2"
else
  # Kill existing and start fresh
  pkill -f "node.*omc-visual.*index.js" 2>/dev/null || true
  sleep 1
  cd "$PROJECT_DIR/server"
  nohup node src/index.js > /tmp/omc-visual.log 2>&1 &
  echo "   ✓ Server gestart (PID: $!)"
  echo "   📋 Logs: tail -f /tmp/omc-visual.log"
fi

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  ✅ Deploy voltooid!                             ║"
echo "║                                                  ║"
echo "║  Open je dashboard en klik op 'Install Clawhip'  ║"
echo "║  in het System panel onderaan de pagina.          ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
