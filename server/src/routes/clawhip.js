/**
 * Clawhip routes — webhook endpoint + install/manage Clawhip daemon
 */
import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/** Preferred Clawhip binary (v0.5.x cargo install location) */
const CLAWHIP_BIN = '/home/admincaku/.cargo/bin/clawhip';

export async function clawhipRoutes(fastify) {
  const { wsHub } = fastify;

  function persistIfActive(payload) {
    const sid = fastify.cliCommander?.getSession?.()?.id;
    if (!sid || !fastify.sessionStore) return;
    try {
      fastify.sessionStore.saveEvent(sid, {
        ...payload,
        timestamp: payload.timestamp || new Date().toISOString(),
      });
    } catch (err) {
      fastify.log.warn({ err }, '[Clawhip] session persist failed');
    }
  }

  // ─── Event ingestion (from Clawhip daemon → OMC Visual) ───

  /** Receive events from Clawhip daemon */
  fastify.post('/events', async (req, reply) => {
    const event = normalizeInboundEvent(req.body);

    if (!event || !event.event) {
      return reply.code(400).send({ error: 'Invalid event format' });
    }

    console.log(`[Clawhip] Event received: ${event.event}`);

    switch (true) {
      case event.event.startsWith('tmux.keyword'): {
        const msg = {
          type: 'keyword_detected',
          session: event.session,
          keyword: event.keyword,
          context: event.context,
          message: event.context || event.keyword,
          severity: classifySeverity(event.keyword || ''),
        };
        wsHub.broadcastChannel('workers', msg);
        persistIfActive({ ...msg, channel: 'workers' });
        break;
      }

      case event.event.startsWith('tmux.stale'): {
        const msg = {
          type: 'worker_stale',
          session: event.session,
          idleMinutes: event.idle_minutes,
          message: `Stale tmux session (${event.idle_minutes ?? '?'} min idle)`,
          severity: 'medium',
        };
        wsHub.broadcastChannel('workers', msg);
        persistIfActive({ ...msg, channel: 'workers' });
        break;
      }

      case event.event.startsWith('git.commit'): {
        const msg = {
          type: 'git_commit',
          repo: event.repo,
          message: event.message,
          hash: event.hash,
          summary: event.message || event.hash,
          severity: 'success',
        };
        wsHub.broadcastChannel('state', msg);
        persistIfActive({ ...msg, channel: 'state' });
        break;
      }

      case event.event.startsWith('github.'): {
        const msg = {
          type: 'github_event',
          eventType: event.event,
          repo: event.repo,
          number: event.number,
          title: event.title,
          message: event.title || event.event,
          severity: 'info',
        };
        wsHub.broadcastChannel('state', msg);
        persistIfActive({ ...msg, channel: 'state' });
        break;
      }

      case event.event.startsWith('session.'): {
        const msg = {
          type: 'session_event',
          eventType: event.event,
          data: event,
          message: event.event,
          severity: 'info',
        };
        wsHub.broadcastChannel('workers', msg);
        persistIfActive({ ...msg, channel: 'workers' });
        break;
      }

      default: {
        const msg = {
          type: 'clawhip_feed',
          clawhipEvent: event.event,
          message: event.context || event.message || event.event,
          summary: event.context || event.message,
          severity: classifySeverity(String(event.context || event.message || '')),
          data: event,
        };
        wsHub.broadcastChannel('state', msg);
        persistIfActive({ ...msg, channel: 'state' });
        break;
      }
    }

    return { status: 'received' };
  });

  // ─── Installation ───

  /** Install Clawhip from GitHub releases (pre-built binary) */
  fastify.post('/install', async (req, reply) => {
    const existingBin = findClawhipBinary();
    if (existingBin) {
      try {
        execSync(`"${existingBin}" --version`, { encoding: 'utf-8' });
        return reply.code(409).send({ error: 'Clawhip is already installed. Use /api/clawhip/update to update.' });
      } catch {
        // Binary present but not runnable — allow reinstall flow
      }
    }

    // Send initial progress
    wsHub.broadcastChannel('install', {
      type: 'clawhip_install',
      status: 'started',
      message: 'Downloading Clawhip binary from GitHub...',
      progress: 10,
    });

    // Run the installer in background
    const installerUrl = 'https://github.com/Yeachan-Heo/clawhip/releases/latest/download/clawhip-installer.sh';
    const child = spawn('bash', ['-c', `
      export CLAWHIP_SKIP_STAR_PROMPT=1
      curl --proto '=https' --tlsv1.2 -LsSf ${installerUrl} | sh 2>&1
    `], {
      env: {
        ...process.env,
        CLAWHIP_SKIP_STAR_PROMPT: '1',
        CARGO_HOME: process.env.CARGO_HOME || join(homedir(), '.cargo'),
      },
    });

    let output = '';

    child.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      console.log(`[Clawhip Install] ${text.trim()}`);
      wsHub.broadcastChannel('install', {
        type: 'clawhip_install',
        status: 'progress',
        message: text.trim(),
        progress: estimateProgress(output),
      });
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      console.log(`[Clawhip Install stderr] ${text.trim()}`);
      wsHub.broadcastChannel('install', {
        type: 'clawhip_install',
        status: 'progress',
        message: text.trim(),
        progress: estimateProgress(output),
      });
    });

    child.on('close', (code) => {
      if (code === 0) {
        // Verify installation
        try {
          const vbin = findClawhipBinary();
          const version = vbin
            ? execSync(`"${vbin}" --version`, { encoding: 'utf-8' }).trim()
            : 'unknown';

          wsHub.broadcastChannel('install', {
            type: 'clawhip_install',
            status: 'complete',
            message: `Clawhip installed successfully: ${version}`,
            version,
            progress: 100,
          });

          console.log(`[Clawhip] Installed: ${version}`);
        } catch {
          wsHub.broadcastChannel('install', {
            type: 'clawhip_install',
            status: 'complete',
            message: 'Clawhip binary installed. You may need to add ~/.cargo/bin to your PATH.',
            progress: 100,
          });
        }
      } else {
        wsHub.broadcastChannel('install', {
          type: 'clawhip_install',
          status: 'error',
          message: `Installation failed (exit code ${code}). Check server logs.`,
          output: output.slice(-500),
          progress: 0,
        });
      }
    });

    // Respond immediately — progress streams via WebSocket
    return { status: 'installing', message: 'Installation started. Watch the dashboard for progress.' };
  });

  // ─── Daemon management ───

  /** Start the Clawhip daemon */
  fastify.post('/start', async (req, reply) => {
    try {
      const clawhipBin = findClawhipBinary();
      if (!clawhipBin) {
        return reply.code(404).send({ error: 'Clawhip not found. Install it first.' });
      }

      // Ensure config exists
      ensureDefaultConfig();

      const child = spawn(clawhipBin, ['start'], {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });
      child.unref();

      // Wait a moment then check status
      await new Promise((r) => setTimeout(r, 1500));

      const status = getDaemonStatus(clawhipBin);

      wsHub.broadcastChannel('state', {
        type: 'clawhip_daemon',
        status: 'started',
        ...status,
      });

      return { status: 'started', ...status };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  /** Stop the Clawhip daemon */
  fastify.post('/stop', async (req, reply) => {
    try {
      const clawhipBin = findClawhipBinary();
      if (!clawhipBin) {
        return reply.code(404).send({ error: 'Clawhip not found.' });
      }

      execSync(`${clawhipBin} stop 2>/dev/null || true`, { encoding: 'utf-8' });

      wsHub.broadcastChannel('state', {
        type: 'clawhip_daemon',
        status: 'stopped',
      });

      return { status: 'stopped' };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  /** Check Clawhip status */
  fastify.get('/status', async () => {
    const clawhipBin = findClawhipBinary();
    if (!clawhipBin) {
      return { installed: false, daemonRunning: false };
    }

    const status = getDaemonStatus(clawhipBin);
    return status;
  });

  /** Get or update Clawhip config */
  fastify.get('/config', async () => {
    const configPath = join(homedir(), '.clawhip', 'config.toml');
    if (!existsSync(configPath)) {
      return { exists: false, hint: 'Run POST /api/clawhip/scaffold-config to create default config' };
    }
    const content = readFileSync(configPath, 'utf-8');
    return { exists: true, path: configPath, content };
  });

  /** Create default config pointing events to OMC Visual */
  fastify.post('/scaffold-config', async (req, reply) => {
    try {
      const config = ensureDefaultConfig();
      return { status: 'created', path: config.path, content: config.content };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });
}

// ─── Helpers ───

/**
 * Clawhip v0.5.x only ships discord + slack sinks. For HTTP → OMC Visual, routes use
 * sink = "discord" with webhook = dashboard URL; the body is a Discord-style JSON payload.
 */
function normalizeInboundEvent(body) {
  if (!body || typeof body !== 'object') return null;
  if (typeof body.event === 'string') return body;

  const content = typeof body.content === 'string' ? body.content : '';
  const embedText = Array.isArray(body.embeds)
    ? body.embeds
        .map((e) =>
          [e.title, e.description, e.footer?.text, e.author?.name].filter(Boolean).join(' — ')
        )
        .join('\n')
    : '';
  const text = [content, embedText].filter(Boolean).join('\n').trim();

  if (!text) return null;

  return {
    event: 'sink.discord.delivered',
    context: text,
    message: text,
    _raw: body,
  };
}

function classifySeverity(keyword) {
  const high = ['error', 'FAILED', 'fatal', 'crash', 'panic'];
  const medium = ['warning', 'warn', 'timeout', 'retry'];
  const success = ['complete', 'passed', 'success', 'done', 'PR created'];

  if (high.some((k) => keyword.toLowerCase().includes(k.toLowerCase()))) return 'high';
  if (success.some((k) => keyword.toLowerCase().includes(k.toLowerCase()))) return 'success';
  if (medium.some((k) => keyword.toLowerCase().includes(k.toLowerCase()))) return 'medium';
  return 'info';
}

function findClawhipBinary() {
  if (existsSync(CLAWHIP_BIN)) return CLAWHIP_BIN;

  const paths = [
    join(homedir(), '.cargo', 'bin', 'clawhip'),
    '/usr/local/bin/clawhip',
    '/usr/bin/clawhip',
  ];

  for (const p of paths) {
    if (existsSync(p)) return p;
  }

  // Try PATH
  try {
    const which = execSync('which clawhip 2>/dev/null', { encoding: 'utf-8' }).trim();
    if (which) return which;
  } catch {
    // not found
  }

  return null;
}

function getDaemonStatus(clawhipBin) {
  try {
    const version = execSync(`${clawhipBin} --version 2>/dev/null`, { encoding: 'utf-8' }).trim();
    let daemonRunning = false;

    try {
      execSync(`${clawhipBin} status 2>/dev/null`, { encoding: 'utf-8' });
      daemonRunning = true;
    } catch {
      // daemon not running
    }

    return { installed: true, version, daemonRunning };
  } catch {
    return { installed: true, version: 'unknown', daemonRunning: false };
  }
}

function estimateProgress(output) {
  const lower = output.toLowerCase();
  if (lower.includes('installing')) return 30;
  if (lower.includes('downloading')) return 40;
  if (lower.includes('unpacking') || lower.includes('extracting')) return 60;
  if (lower.includes('installed') || lower.includes('everything')) return 90;
  return 20;
}

function ensureDefaultConfig() {
  const configDir = join(homedir(), '.clawhip');
  const configPath = join(configDir, 'config.toml');

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  // Get the OMC Visual server port from env or default
  const omcVisualPort = process.env.OMC_VISUAL_PORT || 3200;

  const defaultConfig = `# Clawhip — auto-generated by OMC Visual
# Valid sinks: discord | slack. For HTTP POST to this dashboard use sink "discord" + webhook URL.
# Message formats: compact | alert | inline | raw (not "json").
# Binary: ${CLAWHIP_BIN}

[dispatch]
ci_batch_window_secs = 30
routine_batch_window_secs = 5

[daemon]
bind_host = "127.0.0.1"
port = 25294
base_url = "http://127.0.0.1:25294"

[defaults]
format = "compact"

[[routes]]
event = "*"
sink = "discord"
webhook = "http://127.0.0.1:${omcVisualPort}/api/clawhip/events"
allow_dynamic_tokens = false
format = "compact"

[routes.filter]

[[routes]]
event = "tmux.*"
sink = "discord"
webhook = "http://127.0.0.1:${omcVisualPort}/api/clawhip/events"
allow_dynamic_tokens = true
format = "compact"

[routes.filter]

[[routes]]
event = "git.*"
sink = "discord"
webhook = "http://127.0.0.1:${omcVisualPort}/api/clawhip/events"
allow_dynamic_tokens = false
format = "compact"

[routes.filter]

[[routes]]
event = "session.*"
sink = "discord"
webhook = "http://127.0.0.1:${omcVisualPort}/api/clawhip/events"
allow_dynamic_tokens = false
format = "compact"

[routes.filter]

[monitors]
poll_interval_secs = 5

[monitors.git]
repos = []

# Rename session "omc" to your tmux session name; keywords drive tmux pane monitoring
[monitors.tmux]
sessions = [{ session = "omc", keywords = ["error", "complete", "success", "failed", "PR created"] }]
`;

  if (!existsSync(configPath)) {
    writeFileSync(configPath, defaultConfig, 'utf-8');
    console.log(`[Clawhip] Default config created at ${configPath}`);
  }

  return { path: configPath, content: readFileSync(configPath, 'utf-8') };
}
