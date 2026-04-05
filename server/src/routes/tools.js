/**
 * CLI-Anything tool discovery and execution (streamed via WebSocket channel `tools`)
 */
import { spawn } from 'child_process';

let activeToolProcess = null;

export async function toolsRoutes(fastify) {
  const { wsHub, toolManager } = fastify;

  function broadcastTools(payload) {
    wsHub.broadcastChannel('tools', {
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }

  /** List installed cli-anything-* tools (cached; ?refresh=1 to rescan) */
  fastify.get('/installed', async (req) => {
    const r = req.query?.refresh;
    if (r === '1' || r === 'true') {
      return toolManager.refresh();
    }
    return toolManager.getInstalled();
  });

  /** Placeholder for future registry / hub browser */
  fastify.get('/hub', async () => ({
    status: 'placeholder',
    message:
      'CLI-Anything PyPI/registry browser is not wired yet. Use Tool Library for locally installed cli-anything-* binaries.',
    registryUrl: 'https://pypi.org/search/?q=cli-anything',
    items: [],
  }));

  /**
   * Start tool execution; output streams on WebSocket channel `tools`.
   * Body: { binary: "cli-anything-gimp", args: string[], jsonMode?: boolean }
   */
  fastify.post('/execute', async (req, reply) => {
    const body = req.body || {};
    let { binary, args = [], jsonMode = false } = body;

    if (!binary || typeof binary !== 'string') {
      return reply.code(400).send({ error: 'binary is required (e.g. cli-anything-gimp)' });
    }

    if (typeof args === 'string') {
      args = splitArgs(args);
    }
    if (!Array.isArray(args)) {
      return reply.code(400).send({ error: 'args must be an array of strings or a single shell-like string' });
    }
    args = args.map((a) => String(a));

    const tool = toolManager.getToolByBinary(binary);
    if (!tool) {
      return reply.code(400).send({
        error: 'Unknown or unlisted tool',
        hint: 'Run GET /api/tools/installed?refresh=1 and use an exact binary name from the list',
      });
    }

    if (activeToolProcess) {
      try {
        activeToolProcess.kill('SIGTERM');
      } catch {
        // ignore
      }
      activeToolProcess = null;
    }

    const proc = spawn(tool.path, args, {
      env: { ...process.env },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    activeToolProcess = proc;

    let stdoutBuf = '';

    broadcastTools({
      type: 'started',
      binary,
      args,
      path: tool.path,
    });

    proc.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      stdoutBuf += text;
      broadcastTools({ type: 'stdout', binary, text });
      if (jsonMode) {
        for (const line of text.split('\n')) {
          const t = line.trim();
          if (t.startsWith('{') && t.endsWith('}')) {
            try {
              broadcastTools({ type: 'json', binary, value: JSON.parse(t) });
            } catch {
              // not JSON
            }
          }
        }
      }
    });

    proc.stderr?.on('data', (chunk) => {
      broadcastTools({ type: 'stderr', binary, text: chunk.toString() });
    });

    proc.on('close', (code, signal) => {
      if (activeToolProcess === proc) activeToolProcess = null;

      let parsedJson = null;
      if (jsonMode && stdoutBuf.trim()) {
        const trimmed = stdoutBuf.trim();
        try {
          parsedJson = JSON.parse(trimmed);
        } catch {
          const lines = trimmed.split('\n').filter(Boolean);
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              parsedJson = JSON.parse(lines[i]);
              break;
            } catch {
              // continue
            }
          }
        }
      }

      broadcastTools({
        type: 'exit',
        binary,
        code,
        signal: signal || null,
        json: parsedJson,
      });
    });

    proc.on('error', (err) => {
      if (activeToolProcess === proc) activeToolProcess = null;
      broadcastTools({ type: 'error', binary, message: err.message });
    });

    return { status: 'started', binary, args };
  });

  /** Stop the currently running cli-anything process (if any) */
  fastify.post('/stop', async () => {
    if (!activeToolProcess) {
      return { status: 'idle' };
    }
    try {
      activeToolProcess.kill('SIGTERM');
    } catch {
      // ignore
    }
    activeToolProcess = null;
    broadcastTools({ type: 'stopped', message: 'Tool process terminated' });
    return { status: 'stopped' };
  });
}

function splitArgs(s) {
  const out = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      continue;
    }
    if (/\s/.test(c)) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      continue;
    }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}
