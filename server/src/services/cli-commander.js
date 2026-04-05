import { spawn, execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CLAWHIP_FALLBACK = '/home/admincaku/.cargo/bin/clawhip';

function resolveClawhipBin() {
  const cargo = join(homedir(), '.cargo', 'bin', 'clawhip');
  if (existsSync(cargo)) return cargo;
  if (existsSync(CLAWHIP_FALLBACK)) return CLAWHIP_FALLBACK;
  return null;
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

  async startSession({ mode, prompt, workdir }) {
    if (this.activeProcess || this.tmuxSessionName) {
      throw new Error('A session is already running. Stop it first.');
    }

    const sessionId = `omc-${Date.now()}`;
    const cwd = workdir || homedir();
    const fullPrompt = this.buildFullPrompt(mode, prompt);
    const tmuxSession = `omc-session-${sessionId.replace(/^omc-/, '')}`;

    this.session = {
      id: sessionId,
      mode,
      prompt,
      fullPrompt,
      startedAt: new Date().toISOString(),
      cwd,
      tmuxSession,
    };

    this.sessionStore?.saveSession(this.session);

    const clawhip = resolveClawhipBin();
    if (clawhip) {
      this.startWithClawhip({ clawhip, cwd, tmuxSession, sessionId, fullPrompt });
    } else {
      this.startDirectClaude({ cwd, sessionId, fullPrompt });
    }

    this.wsHub.broadcastChannel('session', {
      type: 'started',
      session: this.getSession(),
    });

    return this.getSession();
  }

  startWithClawhip({ clawhip, cwd, tmuxSession, sessionId, fullPrompt }) {
    const keywords = 'error,FAILED,complete,PR created,test passed,build failed,success';
    const bashCmd = `claude ${JSON.stringify(fullPrompt)}`;

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
        '5',
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

  startDirectClaude({ cwd, sessionId, fullPrompt }) {
    this.tmuxSessionName = null;
    this.activeProcess = spawn('claude', [fullPrompt], {
      cwd,
      env: {
        ...process.env,
        FORCE_COLOR: '1',
        TERM: 'xterm-256color',
      },
      shell: true,
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
}
