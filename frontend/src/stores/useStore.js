import { create } from 'zustand';

export const useStore = create((set, get) => ({
  // Connection state
  connected: false,
  serverStatus: null,

  // Session state
  session: null,
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

  // Connect to the WebSocket server
  connect: () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      set({ connected: true, ws });
      console.log('[WS] Connected');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const state = get();

        switch (msg.channel) {
          case 'output':
            set({ outputLines: [...state.outputLines.slice(-500), msg] });
            break;

          case 'workers':
            set({ workerEvents: [...state.workerEvents.slice(-100), msg] });
            break;

          case 'state':
            set({ stateEvents: [...state.stateEvents.slice(-120), msg] });
            break;

          case 'session':
            if (msg.type === 'ended' || msg.type === 'stopped') {
              set({ session: null });
              break;
            }
            if (msg.session != null) {
              set({ session: msg.session });
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
                setTimeout(() => get().fetchStatus(), 1000);
              }
            }
            break;

          default:
            if (msg.type === 'connected') {
              set({ connected: true });
            }
        }
      } catch (e) {
        // ignore
      }
    };

    ws.onclose = () => {
      set({ connected: false, ws: null });
      console.log('[WS] Disconnected — reconnecting in 3s');
      setTimeout(() => get().connect(), 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  },

  // Send input to the running session
  sendInput: (text) => {
    const { ws } = get();
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'input', text }));
    }
  },

  // Clear output
  clearOutput: () => set({ outputLines: [], workerEvents: [], stateEvents: [] }),

  clearToolOutput: () => set({ toolEvents: [] }),

  fetchTools: async (refresh = false) => {
    try {
      const q = refresh ? '?refresh=1' : '';
      const res = await fetch(`/api/tools/installed${q}`);
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
      const res = await fetch('/api/tools/execute', {
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
      const res = await fetch('/api/tools/stop', { method: 'POST' });
      return await res.json();
    } catch {
      return { status: 'error' };
    }
  },

  // Fetch server status via REST
  fetchStatus: async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      set({ serverStatus: data, session: data.session });
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
      const res = await fetch('/api/clawhip/install', { method: 'POST' });
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
      const res = await fetch('/api/clawhip/start', { method: 'POST' });
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
      const res = await fetch('/api/clawhip/stop', { method: 'POST' });
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
      const res = await fetch('/api/clawhip/scaffold-config', { method: 'POST' });
      return await res.json();
    } catch {
      return { error: 'Could not connect to server' };
    }
  },
}));
