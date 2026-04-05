import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

import { sessionRoutes } from './routes/session.js';
import { statusRoutes } from './routes/status.js';
import { clawhipRoutes } from './routes/clawhip.js';
import { historyRoutes } from './routes/history.js';
import { settingsRoutes } from './routes/settings.js';
import { toolsRoutes } from './routes/tools.js';
import { serversRoutes } from './routes/servers.js';
import { loadServersConfig } from './services/servers-registry.js';
import { WebSocketHub } from './services/websocket-hub.js';
import { ToolManager } from './services/tool-manager.js';
import { StateWatcher } from './services/state-watcher.js';
import { CLICommander } from './services/cli-commander.js';
import { SessionStore } from './services/session-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.OMC_VISUAL_PORT || 3200;
const HOST = process.env.OMC_VISUAL_HOST || '0.0.0.0';

async function start() {
  const app = Fastify({ logger: true });

  // Plugins
  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebsocket);

  // Serve frontend build if it exists
  const frontendDist = join(__dirname, '../../frontend/dist');
  if (existsSync(frontendDist)) {
    await app.register(fastifyStatic, {
      root: frontendDist,
      prefix: '/',
    });
  }

  // Core services (shared across routes)
  const wsHub = new WebSocketHub();
  const sessionStore = new SessionStore();
  const cliCommander = new CLICommander(wsHub, sessionStore);
  loadServersConfig();
  const orphanCleanup = cliCommander.cleanupOmcTmuxSessions();
  console.log(
    `[Startup] Cleaned ${orphanCleanup.cleaned ?? orphanCleanup.killed ?? 0} orphan omc tmux session(s)`
  );
  cliCommander.initializeOnServerStart();
  const stateWatcher = new StateWatcher(wsHub, sessionStore, () => cliCommander.getSession()?.id);
  const toolManager = new ToolManager();
  try {
    toolManager.refresh();
  } catch (e) {
    console.warn('[ToolManager] Initial scan failed:', e.message);
  }

  // Decorate app with services so routes can access them
  app.decorate('wsHub', wsHub);
  app.decorate('cliCommander', cliCommander);
  app.decorate('stateWatcher', stateWatcher);
  app.decorate('sessionStore', sessionStore);
  app.decorate('toolManager', toolManager);

  // WebSocket endpoint
  app.register(async function (fastify) {
    fastify.get('/ws', { websocket: true }, (socket, req) => {
      wsHub.addClient(socket);

      socket.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          // Handle client messages (e.g., user input to session)
          if (msg.type === 'input' && Object.prototype.hasOwnProperty.call(msg, 'text')) {
            const tmuxSession =
              typeof msg.tmuxSession === 'string' && msg.tmuxSession.trim()
                ? msg.tmuxSession.trim()
                : undefined;
            cliCommander.sendInput(msg.text == null ? '' : String(msg.text), { tmuxSession });
          }
        } catch (e) {
          // ignore malformed messages
        }
      });

      socket.on('close', () => {
        wsHub.removeClient(socket);
      });
    });
  });

  // REST routes
  await app.register(sessionRoutes, { prefix: '/api/session' });
  await app.register(statusRoutes, { prefix: '/api/status' });
  await app.register(clawhipRoutes, { prefix: '/api/clawhip' });
  await app.register(historyRoutes, { prefix: '/api/history' });
  await app.register(settingsRoutes, { prefix: '/api/settings' });
  await app.register(toolsRoutes, { prefix: '/api/tools' });
  await app.register(serversRoutes, { prefix: '/api/servers' });

  /** Session terminal output replay (canonical path per UI spec) */
  app.get('/api/sessions/:id/output', async (req, reply) => {
    const session = sessionStore.getSession(req.params.id);
    if (!session) return reply.code(404).send({ error: 'Session not found' });
    const rows = sessionStore.getSessionOutput(req.params.id);
    const chunks = rows.map((r) => ({
      text: r.text,
      type: r.type,
      timestamp: r.timestamp,
    }));
    return { sessionId: req.params.id, chunks };
  });

  // SPA fallback for frontend routing
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/ws')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    const indexPath = join(frontendDist, 'index.html');
    if (existsSync(indexPath)) {
      return reply.sendFile('index.html');
    }
    return reply.code(200).send({
      message: 'OMC Visual server running. Frontend not built yet.',
      hint: 'Run: cd frontend && npm run build',
    });
  });

  // Start
  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`
╔══════════════════════════════════════════╗
║         OMC Visual Server v0.1.0         ║
║                                          ║
║  Dashboard:  http://${HOST}:${PORT}          ║
║  WebSocket:  ws://${HOST}:${PORT}/ws          ║
║  API:        http://${HOST}:${PORT}/api       ║
╚══════════════════════════════════════════╝
    `);

    // Start watching OMC state
    stateWatcher.start();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
