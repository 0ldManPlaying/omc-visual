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

/** OMC CLI on PATH — used to start real `omc team` sessions (tmux + `.omc/state/team/`). */
function resolveOmcBin() {
  try {
    const which = execSync('which omc 2>/dev/null', { encoding: 'utf-8' }).trim();
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

/** Print mode (`-p`): one-shot run, process exits when done. Team stays interactive (no `-p`). */
function useClaudePrintMode(mode) {
  return mode !== 'team';
}

/**
 * Shell one-liner for tmux/bash: `claude` + optional `-p` + `--dangerously-skip-permissions` when print mode.
 * Non-interactive `-p` cannot answer permission prompts; skip is required for all -p modes (not only autopilot).
 */
function buildClaudeBashInvocation(mode, fullPrompt, { model } = {}) {
  const quoted = JSON.stringify(fullPrompt);
  const modelPart = model ? ` --model ${JSON.stringify(model)}` : '';
  const printPart = useClaudePrintMode(mode) ? ' -p' : '';
  const skipPart = useClaudePrintMode(mode) ? ' --dangerously-skip-permissions' : '';
  return `claude${printPart}${skipPart}${modelPart} ${quoted}`;
}

/**
 * argv for direct spawn (no shell).
 * Print modes: `-p --verbose --output-format stream-json --include-partial-messages` for real-time NDJSON
 * (Claude requires `--verbose` with stream-json). Team mode unchanged (not used here).
 */
function buildClaudeSpawnArgs(mode, fullPrompt, { model } = {}) {
  const args = [];
  if (useClaudePrintMode(mode)) {
    args.push(
      '-p',
      '--verbose',
      '--output-format',
      'stream-json',
      '--include-partial-messages'
    );
  }
  if (model) {
    args.push('--model', model);
  }
  if (useClaudePrintMode(mode)) {
    args.push('--dangerously-skip-permissions', fullPrompt);
  } else {
    args.push(fullPrompt);
  }
  return args;
}

function formatToolUseForStream(name, input) {
  try {
    const short =
      typeof input === 'object' && input !== null ? JSON.stringify(input) : String(input ?? '');
    const trimmed = short.length > 500 ? `${short.slice(0, 500)}…` : short;
    return `\n▶ ${name} ${trimmed}\n`;
  } catch {
    return `\n▶ ${name}\n`;
  }
}

/**
 * Map one NDJSON object from `claude -p --output-format stream-json` to UI chunks.
 * @param {object} obj
 * @param {{ sawTextDelta: boolean }} ctx
 * @returns {Array<{ kind: 'stdout' | 'stderr', text: string }>}
 */
function streamJsonEventToUiChunks(obj, ctx) {
  if (!obj || typeof obj !== 'object') return [];
  const chunks = [];
  const t = obj.type;

  if (t === 'stream_event' && obj.event?.type === 'content_block_delta') {
    const d = obj.event.delta;
    if (d?.type === 'text_delta' && typeof d.text === 'string' && d.text) {
      chunks.push({ kind: 'stdout', text: d.text });
    }
    return chunks;
  }

  if (t === 'assistant' && Array.isArray(obj.message?.content)) {
    for (const block of obj.message.content) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text) {
        if (!ctx.sawTextDelta) {
          chunks.push({ kind: 'stdout', text: block.text });
        }
      } else if (block.type === 'tool_use' && block.name) {
        chunks.push({ kind: 'stdout', text: formatToolUseForStream(block.name, block.input) });
      }
    }
    return chunks;
  }

  if (t === 'user' && Array.isArray(obj.message?.content)) {
    for (const block of obj.message.content) {
      if (block.type === 'tool_result') {
        const body =
          typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '');
        const prefix = block.is_error ? '[tool error] ' : '[tool] ';
        chunks.push({
          kind: block.is_error ? 'stderr' : 'stdout',
          text: `${prefix}${body}\n`,
        });
      }
    }
    return chunks;
  }

  if (t === 'result') {
    const sub = obj.is_error ? 'error' : obj.subtype || 'done';
    const cost =
      typeof obj.total_cost_usd === 'number' ? ` ~$${obj.total_cost_usd.toFixed(4)}` : '';
    const dur = typeof obj.duration_ms === 'number' ? ` ${obj.duration_ms}ms` : '';
    chunks.push({
      kind: 'stdout',
      text: `\n\x1b[2m── ${sub}${dur}${cost} ──\x1b[0m\n`,
    });
    return chunks;
  }

  if (t === 'system' && obj.subtype === 'init') {
    const cwd = obj.cwd != null ? String(obj.cwd) : '';
    const m = obj.model != null ? String(obj.model) : '';
    chunks.push({ kind: 'stdout', text: `[init] cwd=${cwd} model=${m}\n` });
    return chunks;
  }

  return chunks;
}

/**
 * CLI Commander — print modes: direct `claude` with NDJSON stream-json (parsed) + stderr → WebSocket.
 * Team mode: prefer `omc team N:claude:role` (OMC-native tmux + state); else Clawhip/tmux + Claude prompt.
 * Session end: process exit (direct), pane_gone (tmux), or Stop/Kill.
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
    /** Last full tmux capture-pane buffer (lead pane); used only for delta / replace in polling. */
    this._lastPaneText = '';
    this.completionFinalizeTimer = null;
  }

  /**
   * tmux window target for list-panes / layout: OMC returns `session:window`; legacy Visual used session-only.
   */
  tmuxWindowTargetForListPanes() {
    if (!this.tmuxSessionName) return null;
    return this.tmuxSessionName.includes(':') ? this.tmuxSessionName : `${this.tmuxSessionName}:0`;
  }

  /** Lead pane `.0` for capture-pane polling */
  tmuxLeadPaneTarget() {
    const w = this.tmuxWindowTargetForListPanes();
    return w ? `${w}.0` : null;
  }

  /** `kill-session -t` wants session name only */
  tmuxKillSessionTarget() {
    if (!this.tmuxSessionName) return null;
    return this.tmuxSessionName.split(':')[0];
  }

  /** Persist terminal output for replay, then broadcast to WebSocket clients */
  emitOutput(sessionId, payload) {
    if (this.sessionStore && sessionId) {
      try {
        const { type, text, message, code } = payload;
        if (type === 'stderr' && text != null && String(text)) {
          this.sessionStore.saveOutputChunk(sessionId, String(text), 'stderr');
        } else if (type === 'error') {
          const t = message != null ? String(message) : '';
          if (t) this.sessionStore.saveOutputChunk(sessionId, t, 'error');
        } else if (type === 'exit') {
          this.sessionStore.saveOutputChunk(sessionId, `[exit] ${String(code)}`, 'error');
        } else if (text != null && String(text) && !payload.replacePane) {
          this.sessionStore.saveOutputChunk(sessionId, String(text), 'output');
        }
      } catch (e) {
        console.warn('[emitOutput] sessionStore save failed (still broadcasting to WS):', e.message);
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
    this._lastPaneText = '';

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
      this._lastPaneText = '';
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

    const omcBin = resolveOmcBin();
    const teamLaunch = options.teamLaunch;

    const fullPromptForStore =
      mode === 'team' && teamLaunch && typeof teamLaunch === 'object'
        ? cliBody
        : this.buildFullPrompt(mode, cliBody);

    let launchPrompt = fullPromptForStore;
    if (mode === 'team' && teamLaunch && typeof teamLaunch === 'object') {
      const w = Number(teamLaunch.workers) || 3;
      const r = String(teamLaunch.role || 'executor').trim() || 'executor';
      launchPrompt = `team ${w}:${r} ${cliBody}`;
    }

    const storedPrompt = String(userPrompt ?? prompt).trim();
    const tmuxSession = `omc-session-${sessionId.replace(/^omc-/, '')}`;

    const useOmcTeamCli = mode === 'team' && teamLaunch && typeof teamLaunch === 'object' && omcBin;

    this.session = {
      id: sessionId,
      mode,
      prompt: storedPrompt,
      fullPrompt: fullPromptForStore,
      startedAt: new Date().toISOString(),
      cwd,
      tmuxSession:
        useClaudePrintMode(mode) ? null : useOmcTeamCli ? null : tmuxSession,
      keywords,
      completionUiStatus: null,
    };

    this.sessionStore?.saveSession(this.session);

    const clawhip = resolveClawhipBin();
    if (useClaudePrintMode(mode)) {
      this.startDirectSpawn({ cwd, sessionId, fullPrompt: fullPromptForStore, mode, model });
    } else if (useOmcTeamCli) {
      const w = Number(teamLaunch.workers) || 3;
      const r = String(teamLaunch.role || 'executor').trim() || 'executor';
      const agent = String(teamLaunch.agentType || 'claude').trim() || 'claude';
      const teamSpec = `${w}:${agent}:${r}`;
      this.startTeamViaOmcCli({ omcBin, cwd, sessionId, teamSpec, taskText: cliBody, model });
    } else if (clawhip && clawhipMonitoring) {
      this.startWithClawhip({
        clawhip,
        cwd,
        tmuxSession,
        sessionId,
        fullPrompt: launchPrompt,
        mode,
        keywords,
        staleMinutes,
        model,
      });
    } else if (clawhip && !clawhipMonitoring) {
      this.startWithBareTmux({ cwd, tmuxSession, sessionId, fullPrompt: launchPrompt, mode, model });
    } else {
      this.startWithBareTmux({ cwd, tmuxSession, sessionId, fullPrompt: launchPrompt, mode, model });
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
    this._lastPaneText = '';

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
    const tmuxName = this.tmuxKillSessionTarget();
    if (tmuxName) {
      try {
        execFileSync('tmux', ['kill-session', '-t', tmuxName], { stdio: 'ignore' });
      } catch {
        /* ignore */
      }
    }
    this.tmuxSessionName = null;
    this._lastPaneText = '';
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

  /** After direct `claude` process exits (-p modes): DB + WS completed/ended (no tmux). */
  finalizeDirectProcessSession(sessionId, exitCode) {
    if (!this.session || this.session.id !== sessionId) return;
    this.clearCompletionFinalizeTimer();
    this.clearTmuxPoll();
    this.tmuxSessionName = null;
    this._lastPaneText = '';
    this.activeProcess = null;
    const snap = {
      id: this.session.id,
      mode: this.session.mode,
      prompt: this.session.prompt,
      startedAt: this.session.startedAt,
      status: 'completed',
      tmuxSession: null,
    };
    const ec =
      typeof exitCode === 'number' && !Number.isNaN(exitCode) ? exitCode : 0;
    if (this.sessionStore) {
      this.sessionStore.endSession(sessionId, ec);
    }
    this.session = null;
    this.wsHub.broadcastChannel('session', {
      type: 'completed',
      session: snap,
      reason: 'process_exit',
    });
    this.wsHub.broadcastChannel('session', { type: 'ended', session: null });
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
    this._lastPaneText = '';

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

  /** NDJSON lines from `claude -p --output-format stream-json` → human-readable WS chunks. */
  attachStreamJsonStdout(sessionId, stream) {
    let buf = '';
    const ctx = { sawTextDelta: false };
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const trimmed = line.trim();
        if (!trimmed) continue;
        let obj;
        try {
          obj = JSON.parse(trimmed);
        } catch {
          this.emitOutput(sessionId, {
            type: 'stdout',
            sessionId,
            text: `${trimmed}\n`,
          });
          continue;
        }
        if (
          obj.type === 'stream_event' &&
          obj.event?.type === 'content_block_delta' &&
          obj.event.delta?.type === 'text_delta' &&
          obj.event.delta.text
        ) {
          ctx.sawTextDelta = true;
        }
        const parts = streamJsonEventToUiChunks(obj, ctx);
        for (const p of parts) {
          this.emitOutput(sessionId, {
            type: p.kind === 'stderr' ? 'stderr' : 'stdout',
            sessionId,
            text: p.text,
          });
        }
      }
    });
    stream.on('end', () => {
      const tail = buf.trim();
      if (!tail) return;
      try {
        const obj = JSON.parse(tail);
        if (
          obj.type === 'stream_event' &&
          obj.event?.type === 'content_block_delta' &&
          obj.event.delta?.type === 'text_delta' &&
          obj.event.delta.text
        ) {
          ctx.sawTextDelta = true;
        }
        for (const p of streamJsonEventToUiChunks(obj, ctx)) {
          this.emitOutput(sessionId, {
            type: p.kind === 'stderr' ? 'stderr' : 'stdout',
            sessionId,
            text: p.text,
          });
        }
      } catch {
        this.emitOutput(sessionId, { type: 'stdout', sessionId, text: `${tail}\n` });
      }
      buf = '';
    });
  }

  /** Direct `claude` child: parsed stream-json on stdout; raw stderr (no tmux). */
  startDirectSpawn({ cwd, sessionId, fullPrompt, mode, model }) {
    this.tmuxSessionName = null;
    this._lastPaneText = '';
    const claudeArgs = buildClaudeSpawnArgs(mode, fullPrompt, { model });
    this.activeProcess = spawn('claude', claudeArgs, {
      cwd,
      env: {
        ...process.env,
        FORCE_COLOR: '1',
        TERM: 'xterm-256color',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    if (this.activeProcess.stdout) {
      this.attachStreamJsonStdout(sessionId, this.activeProcess.stdout);
    }
    this.activeProcess.stderr?.on('data', (data) => {
      this.emitOutput(sessionId, {
        type: 'stderr',
        sessionId,
        text: data.toString(),
      });
    });

    this.activeProcess.on('close', (code) => {
      if (!this.session || this.session.id !== sessionId) return;
      this.activeProcess = null;
      const exitCode = code === null ? 0 : code;
      this.emitOutput(sessionId, {
        type: 'exit',
        sessionId,
        code: exitCode,
      });
      this.finalizeDirectProcessSession(sessionId, exitCode);
    });

    this.activeProcess.on('error', (err) => {
      if (!this.session || this.session.id !== sessionId) return;
      this.emitOutput(sessionId, {
        type: 'error',
        sessionId,
        message: err.message,
      });
      this.activeProcess = null;
      const id = this.session.id;
      this.clearTmuxPoll();
      this.tmuxSessionName = null;
      this.session = null;
      if (id && this.sessionStore) this.sessionStore.endSession(id, 'error');
      this.wsHub.broadcastChannel('session', { type: 'ended', session: null });
    });
  }

  /**
   * Run `omc team N:claude:role "<task>" --json` — matches OMC CLI team start (runtime-v2, tmux topology).
   * Parses sessionName from JSON line on stdout, then attaches tmux polling to that target.
   */
  startTeamViaOmcCli({ omcBin, cwd, sessionId, teamSpec, taskText, model }) {
    this.tmuxSessionName = null;
    this._lastPaneText = '';
    let stdoutBuf = '';
    const args = ['team', teamSpec, taskText, '--json'];
    const env = {
      ...process.env,
      FORCE_COLOR: '1',
      TERM: 'xterm-256color',
    };
    if (model) {
      env.CLAUDE_MODEL = model;
    }

    this.activeProcess = spawn(omcBin, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    this.activeProcess.stdout?.on('data', (data) => {
      const text = data.toString();
      stdoutBuf += text;
      this.emitOutput(sessionId, { type: 'stdout', sessionId, text });
    });
    this.activeProcess.stderr?.on('data', (data) => {
      const text = data.toString();
      stdoutBuf += text;
      this.emitOutput(sessionId, { type: 'stderr', sessionId, text });
    });

    this.activeProcess.on('close', (code) => {
      this.activeProcess = null;
      if (!this.session || this.session.id !== sessionId) return;

      let sessionName = null;
      let teamName = null;
      try {
        const lines = stdoutBuf.split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim();
          if (!line.startsWith('{')) continue;
          const j = JSON.parse(line);
          if (j.sessionName) {
            sessionName = j.sessionName;
            teamName = j.teamName ?? null;
            break;
          }
        }
      } catch {
        /* ignore */
      }
      if (!sessionName) {
        const m = stdoutBuf.match(/tmux session:\s*(\S+)/);
        if (m) sessionName = m[1].trim();
      }

      if (code !== 0 || !sessionName) {
        console.error('[CLICommander] omc team failed', { code, sessionName });
        this.emitOutput(sessionId, {
          type: 'error',
          sessionId,
          message: `omc team failed (exit ${code ?? 'null'})${sessionName ? '' : ' — no sessionName in JSON'}`,
        });
        const id = this.session.id;
        this.clearTmuxPoll();
        this.tmuxSessionName = null;
        this.session = null;
        if (id && this.sessionStore) this.sessionStore.endSession(id, 'error');
        this.wsHub.broadcastChannel('session', { type: 'ended', session: null });
        return;
      }

      this.tmuxSessionName = sessionName;
      if (teamName && this.session) {
        this.session.omcTeamName = teamName;
      }
      console.log('[CLICommander] omc team tmux:', sessionName, 'team:', teamName);
      this.wsHub.broadcastChannel('session', {
        type: 'started',
        session: this.getSession(),
      });
      this.scheduleDeferredTmuxPolling(sessionId);
    });

    this.activeProcess.on('error', (err) => {
      if (!this.session || this.session.id !== sessionId) return;
      this.emitOutput(sessionId, {
        type: 'error',
        sessionId,
        message: err.message,
      });
      this.activeProcess = null;
      const id = this.session.id;
      this.clearTmuxPoll();
      this.tmuxSessionName = null;
      this.session = null;
      if (id && this.sessionStore) this.sessionStore.endSession(id, 'error');
      this.wsHub.broadcastChannel('session', { type: 'ended', session: null });
    });
  }

  /** List panes in window 0 of the active tmux session (team splits live here). */
  getTeamPanes() {
    const windowTarget = this.tmuxWindowTargetForListPanes();
    if (!windowTarget) return [];
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
    const base = this.tmuxWindowTargetForListPanes();
    if (!base) return '';
    const idx = Number(paneIndex);
    if (!Number.isFinite(idx) || idx < 0) return '';
    const target = `${base}.${idx}`;
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
    // Fresh baseline so we never skip the first emit because of a stale buffer from a prior poll/session.
    this._lastPaneText = '';

    const leadPaneTarget = this.tmuxLeadPaneTarget();
    if (!leadPaneTarget) {
      console.log('[tmux-poll] No lead pane target; abort polling.');
      return;
    }
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
          ['capture-pane', '-t', leadPaneTarget, '-p', '-S', '-500'],
          { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 }
        );
        console.log('[tmux-poll] Capture result:', text.length, 'chars');
        console.log(
          '[tmux-poll] Delta check — current length:',
          text.length,
          'previous length:',
          (this._lastPaneText || '').length,
          'changed:',
          text !== this._lastPaneText
        );

        if (text === this._lastPaneText) {
          return;
        }

        this._lastPaneText = text;
        this.emitOutput(sessionId, {
          type: 'stdout',
          sessionId,
          text,
          replacePane: true,
        });
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

    const killTmux = this.tmuxKillSessionTarget();
    if (killTmux) {
      try {
        execFileSync('tmux', ['kill-session', '-t', killTmux], { stdio: 'ignore' });
      } catch {
        // ignore
      }
      this.tmuxSessionName = null;
      this._lastPaneText = '';
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
    const tmuxName = this.tmuxKillSessionTarget();

    this.clearCompletionFinalizeTimer();
    this.clearTmuxPoll();

    if (tmuxName) {
      try {
        execFileSync('tmux', ['kill-session', '-t', tmuxName], { stdio: 'ignore' });
      } catch {
        /* ignore */
      }
      this.tmuxSessionName = null;
      this._lastPaneText = '';
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
