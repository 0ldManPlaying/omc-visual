<p align="center">
  <h1 align="center">OMC Visual</h1>
  <p align="center">
    <strong>A web-based visual interface for oh-my-claudecode — multi-agent orchestration in your browser.</strong>
  </p>
  <p align="center">
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="MIT License"></a>
    <img src="https://img.shields.io/badge/node-20%2B-brightgreen.svg" alt="Node.js 20+">
    <img src="https://img.shields.io/badge/PRs-welcome-blue.svg" alt="PRs Welcome">
  </p>
</p>

<!-- screenshot -->
> **Add screenshot here** — a full-page capture of the Dashboard or Live Monitor in action.

---

## What is OMC Visual?

OMC Visual is a browser-based control panel for [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode), the multi-agent orchestration plugin for Claude Code. It replaces terminal-only workflows with a visual interface — making multi-agent AI orchestration accessible to developers, designers, and product managers alike.

It integrates with [Clawhip](https://github.com/Yeachan-Heo/clawhip) for real-time tmux monitoring and git event tracking, and with [CLI-Anything](https://github.com/HKUDS/CLI-Anything) for a universal software control panel.

## Features

| Page | Description |
|------|-------------|
| **Dashboard** | Server status, active session overview, quick launch buttons, Clawhip daemon management, and live event feed |
| **Mission Control** | Launch sessions in any execution mode (autopilot, ralph, ultrawork, team, plan, ecomode) with configurable team size |
| **Live Monitor** | Real-time ANSI-rendered output streaming with event sidebar and session input |
| **Team Monitor** | Per-worker panels showing individual agent status, tasks, and Clawhip events with pipeline progress visualization |
| **Event Timeline** | Chronological view of all Clawhip events (keywords, stale detection, git commits, GitHub events) with filtering and search |
| **Agent Roster** | Browse all 32 OMC agents across three model tiers (Opus, Sonnet, Haiku) |
| **Session History** | Past sessions with pagination, mode filtering, event replay, and detail view — backed by SQLite |
| **HUD Metrics** | Token usage, cost tracking, and session duration analytics with interactive charts |
| **Settings** | View and edit OMC plugin config, Clawhip daemon config (`config.toml`), and Visual server settings |
| **Tool Library** | Discover and run [CLI-Anything](https://github.com/HKUDS/CLI-Anything) tools with streaming output |

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/user/omc-visual.git
cd omc-visual

# 2. Install dependencies and build the frontend
bash setup.sh

# 3. Start the server
npm start
```

Open `http://localhost:3200` in your browser.

### Development mode

```bash
npm run dev
# Frontend: http://localhost:5173 (proxies API to :3200)
# Server:   http://localhost:3200
```

## Requirements

### Minimum

| Requirement | Version |
|-------------|---------|
| **Node.js** | 20+ |
| **tmux** | any |
| **Claude Code CLI** | latest (with subscription or API key) |
| **oh-my-claudecode** | latest |

### Recommended

| Requirement | Purpose |
|-------------|---------|
| **Clawhip** | Real-time tmux monitoring, keyword detection, git events (auto-installable from Dashboard) |
| **CLI-Anything** | Universal CLI tool integration (`pip install cli-anything-*`) |
| **Python 3 + pip** | Required for CLI-Anything tools |

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Browser                        │
│   React 19 · Vite 6 · Tailwind CSS 4 · Zustand  │
│   10 pages · WebSocket client · xterm.js         │
└────────────────────┬────────────────────────────┘
                     │ HTTP + WebSocket
┌────────────────────▼────────────────────────────┐
│            OMC Visual Server                     │
│   Fastify 5 · Node.js 20+ · SQLite              │
│   REST API · WebSocket hub · State watcher       │
│   CLI commander · Tool manager                   │
└──┬─────────────────┬──────────────────┬─────────┘
   │                 │                  │
   ▼                 ▼                  ▼
┌────────┐   ┌────────────┐   ┌───────────────┐
│  OMC   │   │  Clawhip   │   │ CLI-Anything  │
│ Plugin │   │  Daemon    │   │   Tools       │
│ + CLI  │   │ (port      │   │ (pip install) │
│        │   │  25294)    │   │               │
└────────┘   └────────────┘   └───────────────┘
```

## Configuration

### Clawhip

OMC Visual reads and writes Clawhip's `config.toml` via the Settings page. Key sections:

- **`[tmux]`** — Session patterns to monitor, keyword triggers, stale detection timeouts
- **`[git]`** — Repository paths, commit and push event tracking
- **`[webhook]`** — Points to `http://localhost:3200/api/clawhip/events` for event delivery

You can also install, start, and stop the Clawhip daemon directly from the Dashboard.

### CLI-Anything Integration

OMC Visual scans your `PATH` for `cli-anything-*` executables and displays them in the Tool Library.

```bash
# Install a tool (e.g., GIMP control)
pip install cli-anything-gimp

# Ensure the binary is on PATH
export PATH="$HOME/.local/bin:$PATH"
```

Tools can be executed from the Tool Library page with streaming stdout/stderr output via WebSocket.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 6, Tailwind CSS 4, Zustand 5, React Router 7 |
| Icons | Lucide React |
| Charts | Recharts |
| Terminal | xterm.js, ansi_up |
| Backend | Node.js 20+, Fastify 5 |
| WebSocket | @fastify/websocket |
| Database | SQLite (better-sqlite3) |
| File watching | Chokidar |

## API Reference

<details>
<summary>Click to expand full API documentation</summary>

### Sessions
- `POST /api/session/start` — Start a new session `{ mode, prompt, workdir? }`
- `POST /api/session/team` — Start a team session `{ workers, role, prompt }`
- `POST /api/session/stop` — Stop the running session
- `GET /api/session/current` — Get current session status
- `POST /api/session/input` — Send stdin to running session

### System
- `GET /api/status` — Full system status (server, OMC, Clawhip, session)
- `GET /api/status/health` — Quick health check
- `GET /api/status/agents` — List all OMC agents

### Clawhip
- `POST /api/clawhip/events` — Webhook endpoint for Clawhip events
- `POST /api/clawhip/install` — Install Clawhip from GitHub
- `POST /api/clawhip/start` — Start Clawhip daemon
- `POST /api/clawhip/stop` — Stop Clawhip daemon
- `GET /api/clawhip/status` — Daemon status
- `GET /api/clawhip/config` — Get config.toml
- `POST /api/clawhip/scaffold-config` — Generate default config

### History
- `GET /api/history/sessions` — List sessions `?limit=50&offset=0&mode=`
- `GET /api/history/sessions/:id` — Session detail with events and metrics
- `GET /api/history/sessions/:id/events` — Session events for replay
- `DELETE /api/history/sessions/:id` — Delete a session
- `GET /api/history/metrics` — Aggregate metrics

### Settings
- `GET /api/settings` — All settings (OMC, Clawhip, Visual)
- `PUT /api/settings/omc` — Update OMC settings
- `PUT /api/settings/clawhip` — Update Clawhip config.toml
- `PUT /api/settings/visual` — Update Visual server settings

### CLI-Anything Tools
- `GET /api/tools/installed` — List tools on PATH (`?refresh=1` to rescan)
- `GET /api/tools/hub` — Future registry browser (placeholder)
- `POST /api/tools/execute` — Run tool `{ binary, args?, jsonMode? }` (output on WebSocket `tools` channel)
- `POST /api/tools/stop` — Stop active tool process

### WebSocket
- `ws://HOST:3200/ws` — Real-time streaming
  - Channels: `output`, `workers`, `state`, `session`, `hud`, `install`, `tools`

</details>

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on setting up the development environment, code style, and submitting pull requests.

## License

[MIT](LICENSE) — see the LICENSE file for details.

## Credits

OMC Visual builds on top of these projects:

- **[oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode)** — Multi-agent orchestration plugin for Claude Code (by Yeachan-Heo)
- **[Clawhip](https://github.com/Yeachan-Heo/clawhip)** — Notification daemon with tmux/git monitoring (by Yeachan-Heo)
- **[CLI-Anything](https://github.com/HKUDS/CLI-Anything)** — Universal CLI generator for any software (by HKUDS, University of Hong Kong)
