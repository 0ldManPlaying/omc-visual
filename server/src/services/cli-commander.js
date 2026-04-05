import { spawn, execFileSync, execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, normalize } from 'path';

function resolveClawhipBin() {
  const cargo = join(homedir(), '.cargo', 'bin', 'clawhip');
  if (existsSync(cargo)) return cargo;
  try {
    const which = execSync('which clawhip 2>/dev/null', { encoding: 'utf-8' }).trim();
    if (which && existsSync(which)) return which;
  } catch {
    /* not on PATH */
  }
  return null;
}

function expandUserPath(p) {
  if (typeof p !== 'string') return homedir();
  const t = p.trim();
  if (!t) return homedir();
  if (t === '~') return homedir();
  if (t.startsWith('~/')) return normalize(join(homedir(), t.slice(2)));
  return normalize(t);
}

/**
 * Shell one-liner for tmux/bash: `claude` + optional --dangerously-skip-permissions (autopilot only).
 * Matches oh-my-claudecode's claude contract (see bridge runtime-cli buildLaunchArgs).
 */
function buildClaudeBashInvocation(mode, fullPrompt, { model } = {}) {
  const quoted = JSON.stringify(fullPrompt);
  const modelPart = model ? ` --model ${JSON.stringify(model)}` : '';
  if (mode === 'autopilot') {
    return `claude --dangerously-skip-permissions${modelPart} ${quoted}`;
  }
  return `claude${modelPart} ${quoted}`;
}

/** argv for direct spawn (no shell) — skip permissions only in autopilot */
function buildClaudeSpawnArgs(mode, fullPrompt, { model } = {}) {
  const args = [];
  if (model) {
    args.push('--model', model);
  }
  if (mode === 'autopilot') {
    args.push('--dangerously-skip-permissions', fullPrompt);
  } else {
    args.push(fullPrompt);
  }
  return args;
}

/**
 * CLI Commander — spawns OMC sessions via Clawhip tmux wrapper when available,
 * else direct `claude`. Tmux pane output is polled to WebSocket `output` channel.
 * Auto-completion: only when tmux capture-pane fails (pane/session gone), not heuristics.
 */
export class CLICommander {
  constructor(wsHub, sessionStore = null) {
    this.wsHub = wsHub;
    this.sessionStore = sessionStore;
    this.activeProcess = null;
    this.session = null;
    this.tmuxSessionName = null;
    this.tmuxPollTimer = null;
    this._pollStartTimeout = null;
    this._lastTeamPaneSig = null;
    this.lastPaneText = '';
    this.completionFinalizeTimer = null;
  }

  /** Persist terminal output for replay, then broadcast to WebSocket clients */
  emitOutput(sessionId, payload) {
    if (this.sessionStore && sessionId) {
      const { type, text, message, code } = payload;
      if (type === 'stderr' && text != null && String(text)) {
        this.sessionStore.saveOutputChunk(sessionId, String(text), 'stderr');
      } else if (type === 'error') {
        const t = message != null ? String(message) : '';
        if (t) this.sessionStore.saveOutputChunk(sessionId, t, 'error');
      } else if (type === 'exit') {
        this.sessionStore.saveOutputChunk(sessionId, `[exit] ${String(code)}`, 'error');
      } else if (text != null && String(text)) {
        this.sessionStore.saveOutputChunk(sessionId, String(text), 'output');
      }
    }
    this.wsHub.broadcastChannel('output', payload);
  }

  /** All tmux sessions (for Settings → view active sessions) */
  listTmuxSessions() {
    try {
      const out = execFileSync(
        'tmux',
        ['list-sessions', '-F', '#{session_name}\t#{session_created}\t#{session_attached}'],
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
      );
      return out
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const parts = line.split('\t');
          const name = parts[0] || line;
          const createdRaw = parts[1] || '';
          const attachedRaw = parts[2] || '0';
          let created = '';
          if (createdRaw && /^\d+$/.test(createdRaw)) {
            created = new Date(Number(createdRaw) * 1000).toISOString();
          } else if (createdRaw) {
            created = createdRaw;
          }
          const attached = attachedRaw === '1' || attachedRaw === 'true';
          return { name, created, attached };
        });
    } catch {
      return [];
    }
  }

  clearCompletionFinalizeTimer() {
    if (this.completionFinalizeTimer) {
      clearTimeout(this.completionFinalizeTimer);
      this.completionFinalizeTimer = null;
    }
  }

  /** Log orphan tmux sessions; reconnect polling if one omc-session-* is still alive */
  initializeOnServerStart() {
    const orphans = this.listOmcTmuxSessionNames();
    if (orphans.length > 0) {
      console.log('[CLICommander] Orphan omc tmux sessions:', orphans.join(', '));
    }
    this.tryReconnectExistingTmux();
  }

  listOmcTmuxSessionNames() {
    try {
      const out = execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return out
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((name) => name.startsWith('omc-session-'));
    } catch {
      return [];
    }
  }

  tryReconnectExistingTmux() {
    if (this.session || this.activeProcess || this.tmuxSessionName) return;

    const names = this.listOmcTmuxSessionNames();
    if (names.length === 0) return;

    const sorted = [...names].sort((a, b) => {
      const ta = Number.parseInt(a.replace(/^omc-session-/, ''), 10) || 0;
      const tb = Number.parseInt(b.replace(/^omc-session-/, ''), 10) || 0;
      return tb - ta;
    });
    const tmuxSession = sorted[0];
    const sessionId = `omc-${tmuxSession.replace(/^omc-session-/, '')}`;

    const row = this.sessionStore?.getSession(sessionId);
    const mode = row?.mode || 'autopilot';
    const prompt = row?.prompt || '(reconnected session)';
    const cwd = row?.cwd || homedir();
    const startedAt = row?.started_at || new Date().toISOString();

    this.session = {
      id: sessionId,
      mode,
      prompt,
      fullPrompt: this.buildFullPrompt(mode, prompt),
      startedAt,
      cwd,
      tmuxSession,
      completionUiStatus: null,
    };
    this.tmuxSessionName = tmuxSession;
    this.activeProcess = null;
    this.lastPaneText = '';

    this.session.keywords =
      typeof row?.keywords === 'string' && row.keywords.trim()
        ? row.keywords.trim()
        : 'error,complete,failed,success';
    this.startTmuxPolling(sessionId);
    this.wsHub.broadcastChannel('session', {
      type: 'started',
      session: this.getSession(),
    });
    console.log(`[CLICommander] Reattached to tmux session ${tmuxSession} (${sessionId})`);
  }

  cleanupOmcTmuxSessions() {
    const names = this.listOmcTmuxSessionNames();
    console.log('[CLICommander] cleanup: omc tmux sessions:', names.join(', ') || '(none)');

    for (const name of names) {
      try {
        execFileSync('tmux', ['kill-session', '-t', name], { stdio: 'ignore' });
      } catch {
        /* ignore */
      }
    }

    const touchesCurrent = this.tmuxSessionName && names.includes(this.tmuxSessionName);
    if (touchesCurrent) {
      this.clearCompletionFinalizeTimer();
      this.clearTmuxPoll();
      if (this.activeProcess) {
        const proc = this.activeProcess;
        this.activeProcess = null;
        try {
          proc.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }
      const prevId = this.session?.id;
      if (prevId && this.sessionStore) {
        this.sessionStore.endSession(prevId, 'killed');
      }
      this.session = null;
      this.tmuxSessionName = null;
      this.lastPaneText = '';
      this.wsHub.broadcastChannel('session', { type: 'ended', session: null });
    }

    for (const name of names) {
      const id = `omc-${name.replace(/^omc-session-/, '')}`;
      const row = this.sessionStore?.getSession(id);
      if (row && row.status === 'running') {
        this.sessionStore.endSession(id, 'killed');
      }
    }

    return { cleaned: names.length, sessions: names };
  }

  getSession() {
    if (!this.session) return null;
    const tmuxSession = this.tmuxSessionName || null;
    if (this.session.completionUiStatus === 'completed') {
      return {
        id: this.session.id,
        mode: this.session.mode,
        prompt: this.session.prompt,
        startedAt: this.session.startedAt,
        status: 'completed',
        tmuxSession,
      };
    }
    const running = this.activeProcess != null || this.tmuxSessionName != null;
    return {
      id: this.session.id,
      mode: this.session.mode,
      prompt: this.session.prompt,
      startedAt: this.session.startedAt,
      status: running ? 'running' : 'stopped',
      tmuxSession,
    };
  }

  buildFullPrompt(mode, prompt) {
    switch (mode) {
      case 'autopilot':
        return `autopilot: ${prompt}`;
      case 'ralph':
        return `ralph: ${prompt}`;
      case 'ultrawork':
      case 'ulw':
        return `ulw: ${prompt}`;
      case 'team':
        return prompt;
      case 'plan':
        return `plan: ${prompt}`;
      case 'eco':
        return `eco: ${prompt}`;
      default:
        return prompt;
    }
  }

  isSessionOccupied() {
    return (
      this.tmuxSessionName != null ||
      this.activeProcess != null ||
      (this.session != null && this.session.completionUiStatus !== 'completed')
    );
  }

  async startSession({ mode, prompt, workdir, files = [], options = {}, userPrompt, force = false }) {
    if (this.isSessionOccupied()) {
      if (force) {
        this.clearCompletionFinalizeTimer();
        this.killSession();
        await new Promise((r) => setTimeout(r, 1000));
      } else {
        const err = new Error('SESSION_ACTIVE');
        err.code = 'session_active';
        err.sessionId = this.session?.id ?? null;
        throw err;
      }
    }

    if (this.session?.completionUiStatus === 'completed') {
      this.clearCompletionFinalizeTimer();
      this.session = null;
    }

    const sessionId = `omc-${Date.now()}`;
    const cwd = expandUserPath(workdir ?? '');
    const expandedFiles = (Array.isArray(files) ? files : [])
      .map((f) => expandUserPath(String(f)))
      .filter(Boolean);

    let cliBody = String(prompt).trim();
    if (expandedFiles.length) {
      const fileContents = expandedFiles
        .map((f) => {
          try {
            const content = readFileSync(f, 'utf-8');
            const name = f.split(/[/\\]/).pop();
            return `\n--- File: ${name} (${f}) ---\n${content}\n--- End ${name} ---`;
          } catch (err) {
            return `\n--- File: ${f} --- (could not read: ${err.message}) ---`;
          }
        })
        .join('\n');
      cliBody += `\n\nAttached context files:${fileContents}`;
    }
    const maxTok = options.maxTokens;
    if (maxTok != null && Number.isFinite(Number(maxTok))) {
      cliBody += `\n\n(OMC Visual: prefer responses under ~${Number(maxTok)} output tokens where practical.)`;
    }

    const model =
      typeof options.model === 'string' && options.model.trim()
        ? options.model.trim().toLowerCase()
        : undefined;
    const keywords =
      typeof options.keywords === 'string' && options.keywords.trim()
        ? options.keywords.trim()
        : 'error,complete,failed,success';
    const staleRaw = Number(options.staleMinutes);
    const staleMinutes = Number.isFinite(staleRaw) && staleRaw > 0 ? staleRaw : 5;
    const clawhipMonitoring = options.clawhipMonitoring !== false;

    const fullPrompt = this.buildFullPrompt(mode, cliBody);
    const storedPrompt = String(userPrompt ?? prompt).trim();
    const tmuxSession = `omc-session-${sessionId.replace(/^omc-/, '')}`;

    this.session = {
      id: sessionId,
      mode,
      prompt: storedPrompt,
      fullPrompt,
      startedAt: new Date().toISOString(),
      cwd,
      tmuxSession,
      keywords,
      completionUiStatus: null,
    };

    this.sessionStore?.saveSession(this.session);

    const clawhip = resolveClawhipBin();
    if (clawhip && clawhipMonitoring) {
      this.startWithClawhip({
        clawhip,
        cwd,
        tmuxSession,
        sessionId,
        fullPrompt,
        mode,
        keywords,
        staleMinutes,
        model,
      });
    } else if (clawhip && !clawhipMonitoring) {
      this.startWithBareTmux({ cwd, tmuxSession, sessionId, fullPrompt, mode, model });
    } else {
      this.startDirectClaude({ cwd, sessionId, fullPrompt, mode, model });
    }

    this.wsHub.broadcastChannel('session', {
      type: 'started',
      session: this.getSession(),
    });

    return this.getSession();
  }

  startWithClawhip({ clawhip, cwd, tmuxSession, sessionId, fullPrompt, mode, keywords, staleMinutes, model }) {
    const bashCmd = buildClaudeBashInvocation(mode, fullPrompt, { model });

    this.activeProcess = spawn(
      clawhip,
      [
        'tmux',
        'new',
        '--session',
        tmuxSession,
        '--channel',
        'omc-visual',
        '--keywords',
        keywords,
        '--stale-minutes',
        String(staleMinutes),
        '--cwd',
        cwd,
        '--',
        'bash',
        '-lc',
        bashCmd,
      ],
      {
        cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          FORCE_COLOR: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    this.tmuxSessionName = tmuxSession;
    this.lastPaneText = '';

    this.attachProcessStreams(sessionId);

    this.activeProcess.on('close', (code) => {
      // Launcher exit is normal; tmux session + polling keep running — do not stop polling.
      this.activeProcess = null;
      console.log(
        '[clawhip] Launcher exited with code',
        code,
        '— polling continues for tmux session:',
        this.tmuxSessionName
      );
      this.emitOutput(sessionId, {
        type: 'stderr',
        sessionId,
        text: `\n[clawhip] launcher exited (code ${code}). Pane output continues below; tmux session: ${tmuxSession}\n`,
      });
    });

    this.activeProcess.on('error', (err) => {
      const id = this.session?.id;
      this.emitOutput(sessionId, {
        type: 'error',
        sessionId,
        message: err.message,
      });
      this.clearTmuxPoll();
      this.tmuxSessionName = null;
      this.activeProcess = null;
      this.session = null;
      if (id && this.sessionStore) this.sessionStore.endSession(id, 'error');
      this.wsHub.broadcastChannel('session', { type: 'ended', session: null });
    });

    console.log(
      '[clawhip] Scheduling tmux poll start in 2s for session:',
      tmuxSession,
      'sessionId:',
      sessionId
    );
    // Defer polling until tmux session exists (launcher often exits within ~1s).
    this.scheduleDeferredTmuxPolling(sessionId);
  }

  finalizeCompletedSession(sessionId) {
    if (!this.session || this.session.id !== sessionId) {
      this.clearCompletionFinalizeTimer();
      return;
    }
    this.clearCompletionFinalizeTimer();
    this.clearTmuxPoll();
    const tmuxName = this.tmuxSessionName;
    if (tmuxName) {
      try {
        execFileSync('tmux', ['kill-session', '-t', tmuxName], { stdio: 'ignore' });
      } catch {
        /* ignore */
      }
    }
    this.tmuxSessionName = null;
    this.lastPaneText = '';
    this.activeProcess = null;
    const id = this.session.id;
    if (this.sessionStore) {
      this.sessionStore.endSession(id, 0);
    }
    this.session = null;
    this.wsHub.broadcastChannel('session', { type: 'ended', session: null });
  }

  scheduleSessionCompletion(sessionId, reason) {
    if (!this.session || this.session.id !== sessionId) return;
    if (this.session.completionUiStatus === 'completed') return;
    if (this.completionFinalizeTimer) return;

    this.session.completionUiStatus = 'completed';
    this.wsHub.broadcastChannel('session', {
      type: 'completed',
      session: this.getSession(),
      reason,
    });

    this.completionFinalizeTimer = setTimeout(() => {
      this.completionFinalizeTimer = null;
      this.finalizeCompletedSession(sessionId);
    }, 5000);
  }

  /** Tmux + claude without Clawhip keyword/stale monitoring (pane capture only) */
  startWithBareTmux({ cwd, tmuxSession, sessionId, fullPrompt, mode, model }) {
    const bashCmd = buildClaudeBashInvocation(mode, fullPrompt, { model });
    this.activeProcess = spawn(
      'tmux',
      ['new-session', '-d', '-s', tmuxSession, '-c', cwd, 'bash', '-lc', bashCmd],
      {
        cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          FORCE_COLOR: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    this.tmuxSessionName = tmuxSession;
    this.lastPaneText = '';

    this.attachProcessStreams(sessionId);

    this.activeProcess.on('close', (code) => {
      this.activeProcess = null;
      console.log(
        '[tmux] Launcher exited with code',
        code,
        '— polling continues for tmux session:',
        this.tmuxSessionName
      );
      this.emitOutput(sessionId, {
        type: 'stderr',
        sessionId,
        text: `\n[tmux] launcher exited (code ${code}). Session: ${tmuxSession}\n`,
      });
    });

    this.activeProcess.on('error', (err) => {
      const id = this.session?.id;
      this.emitOutput(sessionId, {
        type: 'error',
        sessionId,
        message: err.message,
      });
      this.clearTmuxPoll();
      this.tmuxSessionName = null;
      this.activeProcess = null;
      this.session = null;
      if (id && this.sessionStore) this.sessionStore.endSession(id, 'error');
      this.wsHub.broadcastChannel('session', { type: 'ended', session: null });
    });

    console.log(
      '[tmux] Scheduling tmux poll start in 2s for session:',
      tmuxSession,
      'sessionId:',
      sessionId
    );
    this.scheduleDeferredTmuxPolling(sessionId);
  }

  scheduleDeferredTmuxPolling(sessionId) {
    if (this._pollStartTimeout) {
      clearTimeout(this._pollStartTimeout);
      this._pollStartTimeout = null;
    }
    const capturedSessionId = sessionId;
    const capturedTmuxName = this.tmuxSessionName;
    console.log(
      '[tmux-poll] Scheduling deferred start in 2s for tmux:',
      this.tmuxSessionName,
      'sessionId:',
      sessionId
    );
    this._pollStartTimeout = setTimeout(() => {
      this._pollStartTimeout = null;
      if (this.tmuxSessionName !== capturedTmuxName) return;
      if (this.session?.id !== capturedSessionId) return;
      this.startTmuxPolling(capturedSessionId);
    }, 2000);
  }

  startDirectClaude({ cwd, sessionId, fullPrompt, mode, model }) {
    this.tmuxSessionName = null;
    const claudeArgs = buildClaudeSpawnArgs(mode, fullPrompt, { model });
    this.activeProcess = spawn('claude', claudeArgs, {
      cwd,
      env: {
        ...process.env,
        FORCE_COLOR: '1',
        TERM: 'xterm-256color',
      },
      shell: false,
    });

    this.attachProcessStreams(sessionId);

    this.activeProcess.on('close', (code) => {
      if (this.session?.id && this.sessionStore) {
        this.sessionStore.endSession(this.session.id, code ?? 0);
      }
      this.emitOutput(sessionId, {
        type: 'exit',
        sessionId,
        code,
      });
      this.activeProcess = null;
      this.session = null;
      this.wsHub.broadcastChannel('session', { type: 'ended', session: null });
    });

    this.activeProcess.on('error', (err) => {
      const id = this.session?.id;
      this.emitOutput(sessionId, {
        type: 'error',
        sessionId,
        message: err.message,
      });
      this.activeProcess = null;
      this.session = null;
      if (id && this.sessionStore) this.sessionStore.endSession(id, 'error');
      this.wsHub.broadcastChannel('session', { type: 'ended', session: null });
    });
  }

  /** List panes in window 0 of the active tmux session (team splits live here). */
  getTeamPanes() {
    if (!this.tmuxSessionName) return [];
    const windowTarget = `${this.tmuxSessionName}:0`;
    try {
      const out = execFileSync(
        'tmux',
        [
          'list-panes',
          '-t',
          windowTarget,
          '-F',
          '#{pane_index}\t#{pane_pid}\t#{pane_active}\t#{pane_current_command}',
        ],
        { encoding: 'utf-8', maxBuffer: 1024 * 1024 }
      );
      return out
        .split('\n')
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map((line) => {
          const parts = line.split('\t');
          const index = Number(parts[0]);
          const pid = Number(parts[1]);
          const active = parts[2] === '1';
          const command = parts.slice(3).join('\t') || '';
          return { index, pid, active, command };
        })
        .filter((p) => Number.isFinite(p.index));
    } catch {
      return [];
    }
  }

  captureTeamPaneOutput(paneIndex) {
    if (!this.tmuxSessionName) return '';
    const idx = Number(paneIndex);
    if (!Number.isFinite(idx) || idx < 0) return '';
    const target = `${this.tmuxSessionName}:0.${idx}`;
    try {
      return execFileSync(
        'tmux',
        ['capture-pane', '-t', target, '-p', '-S', '-200'],
        { encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 }
      );
    } catch {
      return '';
    }
  }

  maybeBroadcastTeamPaneUpdate() {
    if (!this.tmuxSessionName) return;
    try {
      const panes = this.getTeamPanes();
      const sig = panes.map((p) => `${p.index}:${p.pid}:${p.active}`).join('|');
      if (sig === this._lastTeamPaneSig) return;
      this._lastTeamPaneSig = sig;
      const workerCount = Math.max(0, panes.length - 1);
      this.wsHub.broadcastChannel('workers', {
        type: 'team_panes_update',
        teamActive: panes.length > 1,
        workers: workerCount,
        panes: panes.map((p) => ({
          index: p.index,
          pid: p.pid,
          active: p.active,
          command: p.command,
          role: p.index === 0 ? 'lead' : `worker-${p.index}`,
        })),
        timestamp: new Date().toISOString(),
      });
    } catch {
      /* ignore */
    }
  }

  attachProcessStreams(sessionId) {
    if (!this.activeProcess) return;
    this.activeProcess.stdout?.on('data', (data) => {
      this.emitOutput(sessionId, {
        type: 'stdout',
        sessionId,
        text: data.toString(),
      });
    });
    this.activeProcess.stderr?.on('data', (data) => {
      this.emitOutput(sessionId, {
        type: 'stderr',
        sessionId,
        text: data.toString(),
      });
    });
  }

  startTmuxPolling(sessionId) {
    console.log(
      '[tmux-poll] startTmuxPolling called. tmuxSessionName:',
      this.tmuxSessionName,
      'sessionId:',
      sessionId
    );
    if (!this.tmuxSessionName) {
      console.log('[tmux-poll] PROBLEM: tmuxSessionName is null! Cannot start polling.');
      return;
    }
    this.clearTmuxPoll();
    this._lastTeamPaneSig = null;

    const tmuxSession = this.tmuxSessionName;
    const leadPaneTarget = `${tmuxSession}:0.0`;
    console.log('[tmux-poll] Starting polling for lead pane:', leadPaneTarget, 'omc sessionId:', sessionId);

    this.tmuxPollTimer = setInterval(() => {
      if (!this.tmuxSessionName) {
        console.log('[tmux-poll] Stopping poll loop: tmuxSessionName became null');
        this.clearTmuxPoll();
        return;
      }
      this.maybeBroadcastTeamPaneUpdate();
      try {
        const text = execFileSync(
          'tmux',
          ['capture-pane', '-t', leadPaneTarget, '-p', '-S', '-400'],
          { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 }
        );
        console.log('[tmux-poll] Capture result:', text.length, 'chars');
        if (text === this.lastPaneText) {
          return;
        }
        let delta = '';
        if (text.startsWith(this.lastPaneText)) {
          delta = text.slice(this.lastPaneText.length);
        } else {
          delta = text;
        }
        this.lastPaneText = text;
        if (delta) {
          this.emitOutput(sessionId, {
            type: 'stdout',
            sessionId,
            text: delta,
          });
        }
      } catch (err) {
        const msg = err && typeof err.message === 'string' ? err.message : String(err);
        console.log('[tmux-poll] Capture failed:', msg);
        if (this.tmuxSessionName && this.session?.id === sessionId) {
          this.scheduleSessionCompletion(sessionId, 'pane_gone');
        }
      }
    }, 700);
  }

  clearTmuxPoll() {
    if (this._pollStartTimeout) {
      clearTimeout(this._pollStartTimeout);
      this._pollStartTimeout = null;
    }
    if (this.tmuxPollTimer) {
      const name = this.tmuxSessionName;
      clearInterval(this.tmuxPollTimer);
      this.tmuxPollTimer = null;
      this._lastTeamPaneSig = null;
      if (name) console.log('[tmux-poll] Polling stopped for session:', name);
    }
  }

  /**
   * @param {string} text
   * @param {{ tmuxSession?: string }} [opts] — optional target when client still has tmux name but in-memory session was cleared
   */
  sendInput(text, opts = {}) {
    if (text === undefined || text === null) {
      return;
    }
    const payload = String(text);
    const override =
      typeof opts.tmuxSession === 'string' && opts.tmuxSession.trim()
        ? opts.tmuxSession.trim()
        : null;
    const tmuxTarget = override || this.tmuxSessionName;
    if (tmuxTarget) {
      try {
        if (payload === '') {
          execFileSync('tmux', ['send-keys', '-t', tmuxTarget, 'Enter'], { stdio: 'ignore' });
        } else {
          execFileSync('tmux', ['send-keys', '-t', tmuxTarget, '-l', payload], {
            stdio: 'ignore',
          });
          execFileSync('tmux', ['send-keys', '-t', tmuxTarget, 'Enter'], { stdio: 'ignore' });
        }
      } catch {
        // ignore
      }
      return;
    }
    if (this.activeProcess?.stdin?.writable) {
      this.activeProcess.stdin.write(payload === '' ? '\n' : `${payload}\n`);
    }
  }

  stopSession() {
    if (!this.session && !this.activeProcess && !this.tmuxSessionName) {
      return { status: 'no_session' };
    }

    const prevId = this.session?.id;

    this.clearCompletionFinalizeTimer();
    this.clearTmuxPoll();

    if (this.tmuxSessionName) {
      try {
        execFileSync('tmux', ['kill-session', '-t', this.tmuxSessionName], { stdio: 'ignore' });
      } catch {
        // ignore
      }
      this.tmuxSessionName = null;
      this.lastPaneText = '';
    }

    if (this.activeProcess) {
      const proc = this.activeProcess;
      this.activeProcess = null;
      try {
        proc.kill('SIGINT');
      } catch {
        // ignore
      }
      setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // ignore
        }
      }, 4000);
    }

    if (prevId && this.sessionStore) {
      this.sessionStore.endSession(prevId, 'stopped');
    }

    this.session = null;

    this.wsHub.broadcastChannel('session', {
      type: 'stopped',
      session: null,
    });

    if (prevId) {
      this.emitOutput(prevId, {
        type: 'exit',
        sessionId: prevId,
        code: 'stopped',
      });
    }

    return { status: 'stopped' };
  }

  killSession() {
    if (!this.session && !this.activeProcess && !this.tmuxSessionName) {
      return { status: 'no_session' };
    }

    const prevId = this.session?.id;
    const tmuxName = this.tmuxSessionName;

    this.clearCompletionFinalizeTimer();
    this.clearTmuxPoll();

    if (tmuxName) {
      try {
        execFileSync('tmux', ['kill-session', '-t', tmuxName], { stdio: 'ignore' });
      } catch {
        /* ignore */
      }
      this.tmuxSessionName = null;
      this.lastPaneText = '';
    }

    if (this.activeProcess) {
      const proc = this.activeProcess;
      this.activeProcess = null;
      try {
        proc.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }

    if (prevId && this.sessionStore) {
      this.sessionStore.endSession(prevId, 'killed');
    }

    this.session = null;

    this.wsHub.broadcastChannel('session', {
      type: 'killed',
      session: null,
    });

    if (prevId) {
      this.emitOutput(prevId, {
        type: 'exit',
        sessionId: prevId,
        code: 'killed',
      });
    }

    return { status: 'killed' };
  }
}
