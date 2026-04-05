import { watch } from 'chokidar';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join, relative, sep } from 'path';

/**
 * State Watcher — monitors ~/.omc/state/{team,session,hud} (no mkdir; chokidar picks up when OMC creates them)
 */
export class StateWatcher {
  constructor(wsHub, sessionStore = null, getActiveSessionId = null) {
    this.wsHub = wsHub;
    this.sessionStore = sessionStore;
    this.getActiveSessionId = typeof getActiveSessionId === 'function' ? getActiveSessionId : () => null;
    this._persistThrottle = {};
    this.watcher = null;
    this.omcRoot = join(homedir(), '.omc');
    this.watchRoots = [
      join(this.omcRoot, 'state', 'team'),
      join(this.omcRoot, 'state', 'session'),
      join(this.omcRoot, 'state', 'hud'),
    ];
  }

  start() {
    this.watcher = watch(this.watchRoots, {
      ignoreInitial: true,
      persistent: true,
      depth: 6,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    this.watcher.on('change', (filePath) => this.handleChange(filePath));
    this.watcher.on('add', (filePath) => this.handleChange(filePath));

    console.log('[StateWatcher] Watching ~/.omc/state/{team,session,hud}');
  }

  handleChange(filePath) {
    try {
      const rel = relative(this.omcRoot, filePath);
      const norm = rel.split(sep).join('/');

      if (norm.startsWith('state/team/')) {
        this.broadcastTeamState(filePath, rel);
        return;
      }
      if (norm.startsWith('state/session/')) {
        this.broadcastSessionState(filePath, rel);
        return;
      }
      if (norm.startsWith('state/hud/')) {
        this.broadcastHudState(filePath, rel);
        return;
      }

      this.wsHub.broadcastChannel('state', {
        type: 'file_changed',
        path: rel,
      });
    } catch {
      // deleted mid-read, etc.
    }
  }

  broadcastTeamState(filePath, relPath) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      const payload = {
        type: 'team_state',
        path: relPath,
        data,
      };
      this.wsHub.broadcastChannel('state', payload);
      this.persistStateSnapshot(payload);
    } catch {
      this.wsHub.broadcastChannel('state', {
        type: 'team_file_changed',
        path: relPath,
      });
    }
  }

  broadcastSessionState(filePath, relPath) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      const payload = {
        type: 'session_state',
        path: relPath,
        data,
      };
      this.wsHub.broadcastChannel('state', payload);
      this.persistStateSnapshot(payload);
    } catch {
      this.wsHub.broadcastChannel('state', {
        type: 'session_file_changed',
        path: relPath,
      });
    }
  }

  broadcastHudState(filePath, relPath) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      let data;
      try {
        data = JSON.parse(content);
      } catch {
        data = { raw: content };
      }
      this.wsHub.broadcastChannel('hud', {
        type: 'hud_update',
        path: relPath,
        data,
      });
    } catch {
      // ignore
    }
  }

  persistStateSnapshot(payload) {
    const sid = this.getActiveSessionId();
    if (!sid || !this.sessionStore) return;
    const key = `${sid}:${payload.type}`;
    const now = Date.now();
    if (now - (this._persistThrottle[key] || 0) < 1500) return;
    this._persistThrottle[key] = now;
    try {
      this.sessionStore.saveEvent(sid, {
        ...payload,
        channel: 'state',
        severity: 'info',
        message: `${payload.type} (${payload.path || ''})`,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // ignore
    }
  }

  stop() {
    if (this.watcher) {
      this.watcher.close();
      console.log('[StateWatcher] Stopped');
    }
  }
}
