# Contributing to OMC Visual

Thank you for your interest in contributing to OMC Visual! This guide will help you get started.

## Development Environment Setup

### Prerequisites

- Node.js 20+
- tmux
- Git

### Getting Started

```bash
# Clone the repository
git clone https://github.com/user/omc-visual.git
cd omc-visual

# Install all dependencies (server + frontend)
bash setup.sh

# Start in development mode (hot-reload)
npm run dev
```

This starts:
- **Frontend** at `http://localhost:5173` (Vite dev server, proxies API calls to `:3200`)
- **Backend** at `http://localhost:3200` (Fastify server)

### Optional Dependencies

- **oh-my-claudecode** — required for actual session management and agent orchestration
- **Clawhip** — for tmux monitoring and event tracking (installable from the Dashboard UI)
- **CLI-Anything tools** — `pip install cli-anything-*` for Tool Library features

## Project Structure

```
omc-visual/
├── server/src/           # Fastify backend
│   ├── index.js          # Server entry point
│   ├── routes/           # REST API routes
│   └── services/         # Business logic (WebSocket, CLI, state, SQLite, tools)
├── frontend/src/         # React frontend
│   ├── App.jsx           # Layout + routing
│   ├── stores/           # Zustand state management
│   ├── components/       # Shared components
│   └── pages/            # Page components (one per route)
├── setup.sh              # One-command setup script
└── package.json          # Monorepo root
```

## Code Style

### General

- **ES Modules** — all code uses `import`/`export` (ESM), no CommonJS `require()`
- **No TypeScript** — plain JavaScript with JSDoc comments where helpful
- **Formatting** — 2-space indentation, single quotes, no semicolons in frontend code

### Frontend

- **React 19** with functional components and hooks
- **Tailwind CSS 4** for styling — use utility classes, avoid custom CSS
- **Zustand 5** for state management — all shared state lives in `stores/useStore.js`
- **Lucide React** for icons — import only the icons you need
- **Recharts** for charts and data visualization
- Keep components focused — one page component per route in `pages/`

### Backend

- **Fastify 5** with plugin architecture — each route file exports a Fastify plugin
- **SQLite** via `better-sqlite3` — synchronous queries are fine for this use case
- **WebSocket** messages follow the format: `{ channel, type, data, timestamp }`

## How to Submit a Pull Request

1. **Fork** the repository and create a feature branch:
   ```bash
   git checkout -b feat/my-feature
   ```

2. **Make your changes** — keep commits focused and atomic.

3. **Test your changes**:
   - Verify the frontend builds without errors: `cd frontend && npm run build`
   - Verify the server starts correctly: `npm start`
   - Test the feature manually in the browser

4. **Write a clear commit message**:
   ```
   feat: add dark mode toggle to settings page

   Adds a theme switcher in Settings that persists the preference
   to localStorage and applies it via Tailwind's dark mode class.
   ```

   Use conventional commit prefixes: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`

5. **Push and open a PR**:
   ```bash
   git push origin feat/my-feature
   ```
   Then open a pull request against `main` with:
   - A clear description of what changed and why
   - Screenshots for any UI changes
   - Steps to test the change

## Issue Templates

### Bug Report

When filing a bug, please include:

- **Environment** — OS, Node.js version, browser
- **Steps to reproduce** — minimal steps to trigger the bug
- **Expected behavior** — what should happen
- **Actual behavior** — what actually happens
- **Screenshots/logs** — browser console errors, server logs, or screenshots

### Feature Request

When requesting a feature, please include:

- **Problem** — what limitation or pain point does this address?
- **Proposed solution** — how should it work?
- **Alternatives considered** — other approaches you thought of
- **Context** — any additional context, mockups, or examples

## Getting Help

- Open an issue for bugs or feature requests
- Check existing issues before creating duplicates
- For questions about oh-my-claudecode itself, see the [OMC repository](https://github.com/Yeachan-Heo/oh-my-claudecode)
