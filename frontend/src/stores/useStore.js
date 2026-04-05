import { create } from 'zustand';

function getOrigin() {
  if (typeof window === 'undefined') return '';
  return `${window.location.protocol}//${window.location.host}`;
}

function wsUrlFromActiveServer(activeServer) {
  const base = (activeServer || '').replace(/\/$/, '');
  if (!base) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }
  return `${base.replace(/^http/, 'ws')}/ws`;
}

/** Prefix API paths with the selected OMC Visual server base URL */
export function apiUrl(path) {
  const base = (useStore.getState().activeServer || '').replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  if (!base) return p;
  return `${base}${p}`;
}

/** Derive tmux session name from OMC session id (omc-123 → omc-session-123) */
export function sessionIdToTmuxName(sessionId) {
  if (!sessionId || !String(sessionId).startsWith('omc-')) return null;
  return `omc-session-${String(sessionId).replace(/^omc-/, '')}`;
}

let wsReconnectTimer = null;
let installRefreshTimer = null;

export const useStore = create((set, get) => ({
  // Multi-server: full base URL e.g. http://192.168.1.10:3200 (no trailing slash)
  activeServer: typeof window !== 'undefined' ? getOrigin() : '',
  servers: [],
  serverReachable: {},

  // Connection state
  connected: false,
  serverStatus: null,

  // Session state
  session: null,
  /** Last known tmux target for send-keys; kept after session clears so input still works */
  lastTmuxSession: null,
  outputLines: [],

  // Worker events (from Clawhip)
  workerEvents: [],

  // State events (.omc/ changes)
  stateEvents: [],

  // HUD metrics
  hudData: null,

  // CLI-Anything tools (WebSocket channel `tools`)
  toolEvents: [],
  installedTools: [],
  toolsMeta: { python3: null, refreshedAt: null },

  // Clawhip install state
  clawhipInstall: {
    installing: false,
    progress: 0,
    message: '',
    status: null, // null | 'started' | 'progress' | 'complete' | 'error'
  },

  // WebSocket instance
  ws: null,

  setActiveServer: (url) => {
    const normalized = String(url || '').replace(/\/$/, '') || getOrigin();
    set({
      activeServer: normalized,
      outputLines: [],
      workerEvents: [],
      stateEvents: [],
      lastTmuxSession: null,
    });
  },

  fetchServers: async () => {
    try {
      const res = await fetch(apiUrl('/api/servers'));
      const data = await res.json();
      set({ servers: data.servers || [] });
    } catch {
      set({ servers: [] });
    }
  },

  addServerEntry: async (name, url) => {
    try {
      const res = await fetch(apiUrl('/api/servers'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        set({ servers: data.servers || [] });
        return { ok: true };
      }
      return { ok: false, error: data.error || 'failed' };
    } catch (e) {
      return { ok: false, error: e.message || 'request failed' };
    }
  },

  removeServerEntry: async (name) => {
    try {
      const res = await fetch(apiUrl(`/api/servers/${encodeURIComponent(name)}`), {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        set({ servers: data.servers || [] });
        return { ok: true };
      }
      return { ok: false, error: data.error || 'failed' };
    } catch (e) {
      return { ok: false, error: e.message || 'request failed' };
    }
  },

  testServerConnection: async (name) => {
    try {
      const res = await fetch(apiUrl(`/api/servers/${encodeURIComponent(name)}/status`));
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, ...data };
    } catch (e) {
      return { ok: false, online: false, error: e.message || 'request failed' };
    }
  },

  refreshServerReachability: async () => {
    const { servers } = get();
    if (!servers?.length) return;
    const next = { ...get().serverReachable };
    await Promise.all(
      servers.map(async (s) => {
        try {
          const res = await fetch(apiUrl(`/api/servers/${encodeURIComponent(s.name)}/status`));
          const data = await res.json().catch(() => ({}));
          next[s.name] = data.online === true;
        } catch {
          next[s.name] = false;
        }
      })
    );
    set({ serverReachable: next });
  },

  // Connect to the WebSocket server
  connect: () => {
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
    if (installRefreshTimer) {
      clearTimeout(installRefreshTimer);
      installRefreshTimer = null;
    }

    const prev = get().ws;
    if (prev) {
      prev.onclose = null;
      try {
        prev.close();
      } catch {
        /* ignore */
      }
    }

    const wsUrl = wsUrlFromActiveServer(get().activeServer);
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      set({ connected: true, ws });
      console.log('[WS] Connected', wsUrl);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const state = get();

        switch (msg.channel) {
          case 'output': {
            const nextLines = [...state.outputLines.slice(-500), msg];
            let nextTmux = state.lastTmuxSession;
            if (msg.sessionId) {
              const t = sessionIdToTmuxName(msg.sessionId);
              if (t) nextTmux = t;
            }
            set({ outputLines: nextLines, lastTmuxSession: nextTmux });
            break;
          }

          case 'workers':
            set({ workerEvents: [...state.workerEvents.slice(-100), msg] });
            break;

          case 'state':
            set({ stateEvents: [...state.stateEvents.slice(-120), msg] });
            break;

          case 'session':
            if (msg.type === 'ended' || msg.type === 'stopped' || msg.type === 'killed') {
              set({ session: null });
              break;
            }
            if (msg.type === 'completed' && msg.session != null) {
              const t =
                msg.session.tmuxSession ||
                sessionIdToTmuxName(msg.session.id) ||
                state.lastTmuxSession;
              set({ session: msg.session, lastTmuxSession: t || state.lastTmuxSession });
              break;
            }
            if (msg.session != null) {
              const t =
                msg.session.tmuxSession ||
                sessionIdToTmuxName(msg.session.id) ||
                state.lastTmuxSession;
              set({ session: msg.session, lastTmuxSession: t || state.lastTmuxSession });
            }
            break;

          case 'hud':
            set({ hudData: msg.data !== undefined ? msg.data : msg });
            break;

          case 'tools':
            set({ toolEvents: [...state.toolEvents.slice(-800), msg] });
            break;

          case 'install':
            // Handle Clawhip installation progress
            if (msg.type === 'clawhip_install') {
              set({
                clawhipInstall: {
                  installing: msg.status !== 'complete' && msg.status !== 'error',
                  progress: msg.progress || 0,
                  message: msg.message || '',
                  status: msg.status,
                  version: msg.version || null,
                },
              });

              // If install is complete, refresh server status
              if (msg.status === 'complete') {
                if (installRefreshTimer) clearTimeout(installRefreshTimer);
                installRefreshTimer = setTimeout(() => {
                  installRefreshTimer = null;
                  get().fetchStatus();
                }, 1000);
              }
            }
            break;

          default:
            if (msg.type === 'connected') {
              set({ connected: true });
            }
        }
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      set({ connected: false, ws: null });
      console.log('[WS] Disconnected — reconnecting in 3s');
      wsReconnectTimer = setTimeout(() => {
        wsReconnectTimer = null;
        get().connect();
      }, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  },

  // Send input to the running session (REST first; empty string sends Enter only in tmux)
  sendInput: async (text) => {
    const payload = text === undefined || text === null ? '' : String(text);
    const { session, lastTmuxSession } = get();
    const tmuxSession =
      session?.tmuxSession ||
      (session?.id ? sessionIdToTmuxName(session.id) : null) ||
      lastTmuxSession;
    const body = { text: payload };
    if (tmuxSession) body.tmuxSession = tmuxSession;
    try {
      const res = await fetch(apiUrl('/api/session/input'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) return true;
    } catch {
      /* try WebSocket fallback */
    }
    const { ws } = get();
    if (ws && ws.readyState === 1) {
      try {
        ws.send(JSON.stringify({ type: 'input', text: payload, ...(tmuxSession ? { tmuxSession } : {}) }));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  },

  // Clear output
  clearOutput: () => set({ outputLines: [], workerEvents: [], stateEvents: [] }),

  clearToolOutput: () => set({ toolEvents: [] }),

  fetchTools: async (refresh = false) => {
    try {
      const q = refresh ? '?refresh=1' : '';
      const res = await fetch(apiUrl(`/api/tools/installed${q}`));
      const data = await res.json();
      set({
        installedTools: data.tools || [],
        toolsMeta: { python3: data.python3 ?? null, refreshedAt: data.refreshedAt ?? null },
      });
      return data;
    } catch {
      set({ installedTools: [], toolsMeta: { python3: null, refreshedAt: null } });
      return { tools: [], error: 'fetch failed' };
    }
  },

  executeTool: async (binary, args = [], jsonMode = false) => {
    try {
      const res = await fetch(apiUrl('/api/tools/execute'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ binary, args, jsonMode }),
      });
      const data = await res.json();
      return { ok: res.ok, ...data };
    } catch (e) {
      return { ok: false, error: e.message || 'request failed' };
    }
  },

  stopToolExecution: async () => {
    try {
      const res = await fetch(apiUrl('/api/tools/stop'), { method: 'POST' });
      return await res.json();
    } catch {
      return { status: 'error' };
    }
  },

  stopSession: async () => {
    try {
      await fetch(apiUrl('/api/session/stop'), { method: 'POST' });
      set({ lastTmuxSession: null });
      await get().fetchStatus();
    } catch {
      set({ lastTmuxSession: null });
      await get().fetchStatus();
    }
  },

  killSession: async () => {
    try {
      await fetch(apiUrl('/api/session/kill'), { method: 'POST' });
      set({ lastTmuxSession: null });
      await get().fetchStatus();
    } catch {
      set({ lastTmuxSession: null });
      await get().fetchStatus();
    }
  },

  cleanupSessions: async () => {
    try {
      const res = await fetch(apiUrl('/api/session/cleanup'), { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      set({ lastTmuxSession: null });
      await get().fetchStatus();
      return { ok: res.ok, ...data };
    } catch (e) {
      await get().fetchStatus();
      return { ok: false, error: e.message || 'request failed' };
    }
  },

  // Fetch server status via REST
  fetchStatus: async () => {
    try {
      const res = await fetch(apiUrl('/api/status'));
      const data = await res.json();
      const s = data.session;
      const tFromApi =
        s?.tmuxSession || (s?.id ? sessionIdToTmuxName(s.id) : null);
      set({
        serverStatus: data,
        session: data.session,
        ...(tFromApi ? { lastTmuxSession: tFromApi } : {}),
      });
    } catch {
      set({ serverStatus: null });
    }
  },

  // Install Clawhip
  installClawhip: async () => {
    set({
      clawhipInstall: {
        installing: true,
        progress: 5,
        message: 'Starting installation...',
        status: 'started',
      },
    });

    try {
      const res = await fetch(apiUrl('/api/clawhip/install'), { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        set({
          clawhipInstall: {
            installing: false,
            progress: 0,
            message: data.error || 'Installation failed',
            status: 'error',
          },
        });
      }
      // Progress will continue via WebSocket
    } catch (err) {
      set({
        clawhipInstall: {
          installing: false,
          progress: 0,
          message: 'Could not connect to server',
          status: 'error',
        },
      });
    }
  },

  // Start Clawhip daemon
  startClawhipDaemon: async () => {
    try {
      const res = await fetch(apiUrl('/api/clawhip/start'), { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setTimeout(() => get().fetchStatus(), 500);
      }
      return data;
    } catch {
      return { error: 'Could not connect to server' };
    }
  },

  // Stop Clawhip daemon
  stopClawhipDaemon: async () => {
    try {
      const res = await fetch(apiUrl('/api/clawhip/stop'), { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setTimeout(() => get().fetchStatus(), 500);
      }
      return data;
    } catch {
      return { error: 'Could not connect to server' };
    }
  },

  // Scaffold Clawhip config
  scaffoldClawhipConfig: async () => {
    try {
      const res = await fetch(apiUrl('/api/clawhip/scaffold-config'), { method: 'POST' });
      return await res.json();
    } catch {
      return { error: 'Could not connect to server' };
    }
  },
}));
