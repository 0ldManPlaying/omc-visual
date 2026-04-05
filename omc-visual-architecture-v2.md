# OMC Visual — Open Source Visual Interface for oh-my-claudecode

**Project:** Visual frontend + backend for oh-my-claudecode  
**Status:** Architecture & RFC (Request for Comments) — v2  
**License:** MIT (matching upstream)  
**Target contribution:** github.com/Yeachan-Heo/oh-my-claudecode  
**Date:** April 2026  
**Revision:** v2 — Clawhip + CLI-Anything integratie

---

## 1. Probleem dat we oplossen

oh-my-claudecode is een krachtig multi-agent orkestratiesysteem met 32 agents, 36+ skills en meerdere execution modes. Maar het heeft één groot adoptieprobleem: **alles draait via de terminal.** Dit sluit een hele groep gebruikers uit — designers, product managers, non-coders, en visueel ingestelde developers — die wél baat zouden hebben bij multi-agent workflows maar de CLI-drempel niet over komen.

**OMC Visual** lost dit op door een web-based interface te bieden die:

- De CLI-commando's vertaalt naar visuele interacties
- Live output van agents en tmux-sessies streamt naar de browser
- Team-orkestratie zichtbaar maakt met real-time dashboards
- Dezelfde "zero learning curve" filosofie van OMC naar een visuele omgeving brengt
- Via Clawhip bestaande monitoring-infra hergebruikt in plaats van het wiel opnieuw uit te vinden
- Via CLI-Anything de deur opent naar een universeel softwarebesturingspaneel

---

## 2. Ecosysteem overzicht

OMC Visual staat niet op zichzelf. Het bouwt voort op drie bestaande projecten die samen een compleet ecosysteem vormen:

| Project | Rol in ons ecosysteem | Maker | Stars |
|---------|----------------------|-------|-------|
| **oh-my-claudecode** | Multi-agent orkestratie — het hart van de operatie | Yeachan-Heo | 4.6k |
| **Clawhip** | Notificatie-daemon met tmux/git monitoring — onze ogen en oren | Yeachan-Heo | 7 |
| **CLI-Anything** | Universele CLI-generator voor elke software — ons extensiepunt | HKUDS (HKU) | 20.5k |

### 2.1 oh-my-claudecode (OMC)
Multi-agent orkestratie-plugin voor Claude Code. Biedt 32 gespecialiseerde agents, 36+ skills, 7 execution modes (Autopilot, Ralph, Ultrawork, Team, Ecomode, etc.), MCP-servers voor state en geheugen, en een HUD statusline. Agents draaien in tmux-panes en communiceren via het .omc/ state-systeem.

### 2.2 Clawhip
Standalone daemon (Rust, draait op port 25294) van dezelfde maker als OMC. Monitort tmux-sessies op keywords en stale-detection, volgt git commits en GitHub events, en routeert alles naar Discord via configureerbare presets. Cruciaal voor ons: de tmux-monitoring die we anders zelf moesten bouwen is hier al productie-klaar beschikbaar.

### 2.3 CLI-Anything
Framework van de Universiteit van Hong Kong (20.5k stars) dat elke software met een codebase omzet naar een agent-bestuurbare CLI. Ondersteunt 17+ applicaties (GIMP, Blender, LibreOffice, OBS Studio, Inkscape, etc.) met 1.839 passing tests.

---

## 3. Architectuur overzicht

Drie lagen: Browser (React Frontend) → OMC Visual Server (Node.js) → Bestaand ecosysteem (OMC + Clawhip + CLI-Anything). Wij bouwen laag 1 en 2, laag 3 blijft ongewijzigd.

---

## 4. Backend: OMC Visual Server

**Stack:** Node.js 20+, Fastify, ws (WebSocket), node-pty, SQLite (better-sqlite3)

**Core modules:**
- **CLI Commander** — spawnt claude processen via clawhip tmux new wrapper
- **Clawhip Connector** — ontvangt events van Clawhip daemon op POST /api/clawhip/events
- **State Watcher** — monitort .omc/state/ bestanden via chokidar
- **WebSocket Hub** — centrale message broker naar browser clients

---

## 5. Frontend: React Interface

**Stack:** React 19 + Vite, Tailwind CSS 4, Zustand, xterm.js, Recharts, React Router 7, Lucide React

**Pagina's:**
- **Dashboard** — server status, sessie overzicht, quick launch, event feed
- **Mission Control** — taak configureren en lanceren
- **Live Monitor** — real-time output + event sidebar
- **Agent Roster** — 32 agents overzicht
- **Tool Library** (fase 4) — CLI-Anything tools
- **Session History** (fase 3) — archief
- **Settings** (fase 3) — configuratie

---

## 6. Integratiepunten

### 6.1 oh-my-claudecode — Directe integratie
CLI commands via node-pty, .omc/state/ via filesystem watching, HUD data, agent definities uit ~/.claude/agents/*.md

### 6.2 Clawhip — Event monitoring
tmux keyword/stale detection, clawhip tmux new wrapper, git commit monitoring, GitHub webhooks

### 6.3 CLI-Anything — Tool extensie (fase 4)
cli-anything-* tools detectie, JSON output parsing, REPL via node-pty

---

## 7. Deployment model

Self-hosted: Node.js 20+, tmux, Claude Code CLI, oh-my-claudecode, Clawhip daemon, optioneel CLI-Anything tools.

---

## 8. Ontwikkel-roadmap (herzien)

### Fase 1: Foundation (week 1-2) ✅ DONE
- [x] Project setup (monorepo: /server + /frontend)
- [x] Backend: Fastify server met REST endpoints
- [x] Backend: node-pty process spawning voor Claude CLI
- [x] Backend: basis WebSocket streaming (main output)
- [x] Backend: Clawhip connector — events ontvangen via webhook
- [x] Frontend: React app met routing en layout
- [x] Frontend: Dashboard met server status + Clawhip status
- [x] Frontend: Mission Control — taak starten (autopilot mode)
- [x] Frontend: Live output view met xterm.js

### Fase 2: Team Orchestration + Clawhip (week 3-4) ✅ DONE
- [x] Backend: clawhip tmux new wrapper voor sessie-lancering met monitoring
- [x] Backend: State Watcher — .omc/state/ bestanden volgen
- [x] Backend: Clawhip event processing (keyword, stale, git events)
- [x] Frontend: Agent Roster — overzicht van alle agents
- [x] Frontend: Clawhip daemon management (install/start/stop)
- [x] Frontend: Live Monitor met ANSI rendering en event sidebar
- [x] Alle execution modes ondersteunen (ralph, ulw, eco, team, plan)
- [x] Frontend: Team Monitor — per-worker panels met Clawhip events
- [x] Frontend: Event timeline — chronologische weergave van alle events
- [x] Frontend: Pipeline progress visualisatie

### Fase 3: Polish & Intelligence (week 5-6)
- [x] Frontend: Session History met replay en Clawhip events
- [x] Frontend: HUD metrics dashboard (tokens, kosten)
- [x] Frontend: Settings pagina (OMC + Clawhip configuratie)
- [x] Backend: SQLite sessie-opslag
- [ ] Notificatie-integratie (Discord/Telegram via Clawhip routes)
- [x] Documentatie schrijven (`README.md`)
- **Resultaat:** Volledig afgewerkt product, klaar voor open source release

### Fase 4: CLI-Anything + Ecosysteem (week 7-8)
- [x] Backend: Tool Manager — geïnstalleerde cli-anything-* tools detecteren
- [x] Backend: Tool execution endpoint met streaming output
- [x] Frontend: Tool Library — catalogus van beschikbare tools
- [x] Frontend: CLI-Anything Hub browser (placeholder API `GET /api/tools/hub` + PyPI-link in UI)
- [ ] Frontend: Tool-specifieke UI panels (per-app forms; nu generieke runner + `--help`)
- [x] Documentatie: integratie-handleiding voor CLI-Anything (zie README)
- **Resultaat:** Visuele interface voor zowel OMC-agents als CLI-Anything tools

### Fase 5: Community & Contributie (week 9+)
- [x] README.md polijsten voor open source release (badges, features, architecture diagram, contributing link)
- [x] CONTRIBUTING.md aanmaken (dev setup, code style, PR workflow, issue templates)
- [x] LICENSE bestand (MIT 2026)
- [x] .gitignore controleren en bijwerken
- [x] Git repository initialiseren met initiële commit
- [ ] PR voorbereiden voor oh-my-claudecode repo
- [ ] Demo video maken
- [ ] Discussie openen met Yeachan-Heo (maintainer OMC + Clawhip)
- [ ] Discussie openen met HKUDS (maintainer CLI-Anything)
- [ ] Community feedback verwerken
- [ ] oh-my-codex ondersteuning toevoegen (tweede CLI target)

---

## 9. Open source strategie

Start met Optie A (eigen repo), bewijs de waarde, evalueer dan Optie C (platformproject).
Licentie: MIT. Community: demo-first aanpak.

---

## 10. Waarom dit werkt

1. Geen fork, geen wijziging — we bouwen bovenop
2. Hergebruik boven herbouw — Clawhip's monitoring
3. OMC's eigen state-systeem — .omc/ directory
4. Clawhip als event-bus
5. CLI-Anything als force multiplier
6. Node.js over de hele linie
7. Self-hosted
8. Open source gap — geen multi-agent CLI tool heeft een visuele interface
9. Ecosysteem-denken
