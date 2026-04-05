import { spawn, execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join, normalize } from 'path';

const CLAWHIP_FALLBACK = '/home/admincaku/.cargo/bin/clawhip';

function resolveClawhipBin() {
  const cargo = join(homedir(), '.cargo', 'bin', 'clawhip');
  if (existsSync(cargo)) return cargo;
  if (existsSync(CLAWHIP_FALLBACK)) return CLAWHIP_FALLBACK;
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
 */
export class CLICommander {
  constructor(wsHub, sessionStore = null) {
    this.wsHub = wsHub;
    this.sessionStore = sessionStore;
    this.activeProcess = null;
    this.session = null;
    this.tmuxSessionName = null;
    this.tmuxPollTimer = null;
    this.lastPaneText = '';
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
    };
    this.tmuxSessionName = tmuxSession;
    this.activeProcess = null;
    this.lastPaneText = '';

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

    return { status: 'cleaned', killed: names.length };
  }

  getSession() {
    if (!this.session) return null;
    const running = this.activeProcess != null || this.tmuxSessionName != null;
    return {
      id: this.session.id,
      mode: this.session.mode,
      prompt: this.session.prompt,
      startedAt: this.session.startedAt,
      status: running ? 'running' : 'stopped',
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

  async startSession({ mode, prompt, workdir, files = [], options = {}, userPrompt }) {
    if (this.activeProcess || this.tmuxSessionName) {
      throw new Error('A session is already running. Stop it first.');
    }

    const sessionId = `omc-${Date.now()}`;
    const cwd = expandUserPath(workdir ?? '');
    const expandedFiles = (Array.isArray(files) ? files : [])
      .map((f) => expandUserPath(String(f)))
      .filter(Boolean);

    let cliBody = String(prompt).trim();
    if (expandedFiles.length) {
      cliBody += `\n\nContext files: ${expandedFiles.join(', ')}`;
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
      this.activeProcess = null;
      this.wsHub.broadcastChannel('output', {
        type: 'stderr',
        sessionId,
        text: `\n[clawhip] launcher exited (code ${code}). Pane output continues below; tmux session: ${tmuxSession}\n`,
      });
    });

    this.activeProcess.on('error', (err) => {
      const id = this.session?.id;
      this.wsHub.broadcastChannel('output', {
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

    setTimeout(() => this.startTmuxPolling(sessionId), 900);
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
      this.wsHub.broadcastChannel('output', {
        type: 'stderr',
        sessionId,
        text: `\n[tmux] launcher exited (code ${code}). Session: ${tmuxSession}\n`,
      });
    });

    this.activeProcess.on('error', (err) => {
      const id = this.session?.id;
      this.wsHub.broadcastChannel('output', {
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

    setTimeout(() => this.startTmuxPolling(sessionId), 900);
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
      this.wsHub.broadcastChannel('output', {
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
      this.wsHub.broadcastChannel('output', {
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

  attachProcessStreams(sessionId) {
    if (!this.activeProcess) return;
    this.activeProcess.stdout?.on('data', (data) => {
      this.wsHub.broadcastChannel('output', {
        type: 'stdout',
        sessionId,
        text: data.toString(),
      });
    });
    this.activeProcess.stderr?.on('data', (data) => {
      this.wsHub.broadcastChannel('output', {
        type: 'stderr',
        sessionId,
        text: data.toString(),
      });
    });
  }

  startTmuxPolling(sessionId) {
    if (!this.tmuxSessionName) return;
    this.clearTmuxPoll();

    this.tmuxPollTimer = setInterval(() => {
      if (!this.tmuxSessionName) {
        this.clearTmuxPoll();
        return;
      }
      try {
        const text = execFileSync(
          'tmux',
          ['capture-pane', '-t', this.tmuxSessionName, '-p', '-S', '-400'],
          { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 }
        );
        if (text === this.lastPaneText) return;
        let delta = '';
        if (text.startsWith(this.lastPaneText)) {
          delta = text.slice(this.lastPaneText.length);
        } else {
          delta = text;
        }
        this.lastPaneText = text;
        if (delta) {
          this.wsHub.broadcastChannel('output', {
            type: 'stdout',
            sessionId,
            text: delta,
          });
        }
      } catch {
        // Session ended or tmux unavailable
      }
    }, 700);
  }

  clearTmuxPoll() {
    if (this.tmuxPollTimer) {
      clearInterval(this.tmuxPollTimer);
      this.tmuxPollTimer = null;
    }
  }

  sendInput(text) {
    if (this.tmuxSessionName) {
      try {
        execFileSync('tmux', ['send-keys', '-t', this.tmuxSessionName, '-l', text], { stdio: 'ignore' });
        execFileSync('tmux', ['send-keys', '-t', this.tmuxSessionName, 'Enter'], { stdio: 'ignore' });
      } catch {
        // ignore
      }
      return;
    }
    if (this.activeProcess?.stdin?.writable) {
      this.activeProcess.stdin.write(`${text}\n`);
    }
  }

  stopSession() {
    if (!this.session && !this.activeProcess && !this.tmuxSessionName) {
      return { status: 'no_session' };
    }

    const prevId = this.session?.id;

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
      this.wsHub.broadcastChannel('output', {
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
      this.wsHub.broadcastChannel('output', {
        type: 'exit',
        sessionId: prevId,
        code: 'killed',
      });
    }

    return { status: 'killed' };
  }
}
