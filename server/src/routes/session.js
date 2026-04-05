/**
 * Session routes — start, stop, and manage OMC sessions
 */
export async function sessionRoutes(fastify) {
  const { cliCommander } = fastify;

  /** Start a new session */
  fastify.post('/start', async (req, reply) => {
    try {
      const {
        mode = 'autopilot',
        prompt,
        workdir,
        files,
        options,
        force,
      } = req.body || {};

      if (!prompt || !String(prompt).trim()) {
        return reply.code(400).send({ error: 'prompt is required' });
      }

      const session = await cliCommander.startSession({
        mode,
        prompt: String(prompt).trim(),
        workdir,
        files: Array.isArray(files) ? files : [],
        options: options && typeof options === 'object' ? options : {},
        force: Boolean(force),
      });
      return { status: 'started', session };
    } catch (err) {
      if (err.code === 'session_active') {
        return reply.code(409).send({
          error: 'session_active',
          message: 'Er draait al een sessie',
          sessionId: err.sessionId ?? null,
        });
      }
      req.log.error(err);
      return reply.code(500).send({ error: err.message || 'start failed' });
    }
  });

  /** Start a team session */
  fastify.post('/team', async (req, reply) => {
    try {
      const {
        workers = 3,
        role = 'executor',
        prompt,
        workdir,
        files,
        options,
        force,
      } = req.body || {};

      if (!prompt || !String(prompt).trim()) {
        return reply.code(400).send({ error: 'prompt is required' });
      }

      const task = String(prompt).trim();
      const teamPrompt = `team ${workers}:${role} ${task}`;
      const session = await cliCommander.startSession({
        mode: 'team',
        prompt: teamPrompt,
        userPrompt: task,
        workdir,
        files: Array.isArray(files) ? files : [],
        options: options && typeof options === 'object' ? options : {},
        force: Boolean(force),
      });
      return { status: 'started', session };
    } catch (err) {
      if (err.code === 'session_active') {
        return reply.code(409).send({
          error: 'session_active',
          message: 'Er draait al een sessie',
          sessionId: err.sessionId ?? null,
        });
      }
      req.log.error(err);
      return reply.code(500).send({ error: err.message || 'start failed' });
    }
  });

  /** Stop the current session */
  fastify.post('/stop', async (req, reply) => {
    const result = cliCommander.stopSession();
    if (result.status === 'no_session') {
      return reply.code(404).send({ error: 'no_session', message: 'No active session' });
    }
    return result;
  });

  /** Force kill: tmux kill-session + SIGKILL child + reset state + WS + SQLite status killed */
  fastify.post('/kill', async (req, reply) => {
    const result = cliCommander.killSession();
    if (result.status === 'no_session') {
      return reply.code(404).send({ error: 'no_session', message: 'No active session' });
    }
    return result;
  });

  /** Kill all omc-session-* tmux sessions and reconcile DB */
  fastify.post('/cleanup', async (req, reply) => {
    const result = cliCommander.cleanupOmcTmuxSessions();
    return result;
  });

  /** List all tmux sessions (name, created, attached) */
  fastify.get('/tmux-list', async () => {
    const sessions = cliCommander.listTmuxSessions();
    return { sessions };
  });

  /** Tmux panes in window 0 of the active session (native team splits) */
  fastify.get('/team-panes', async () => {
    const panes = cliCommander.getTeamPanes();
    const enriched = panes.map((p) => ({
      ...p,
      role: p.index === 0 ? 'lead' : `worker-${p.index}`,
    }));
    return {
      teamActive: panes.length > 1,
      workers: Math.max(0, panes.length - 1),
      panes: enriched,
    };
  });

  /** Raw pane text for a specific pane index (window 0) */
  fastify.get('/team-panes/:index/output', async (req, reply) => {
    const idx = Number(req.params.index);
    if (!Number.isFinite(idx) || idx < 0) {
      return reply.code(400).send({ error: 'invalid pane index' });
    }
    const output = cliCommander.captureTeamPaneOutput(idx);
    return { paneIndex: idx, output };
  });

  /** Get current session status */
  fastify.get('/current', async (req, reply) => {
    const session = cliCommander.getSession();
    return { session };
  });

  /** Send input to the running session (empty string = Enter only, for trust prompts) */
  fastify.post('/input', async (req, reply) => {
    const body = req.body || {};
    if (!('text' in body)) {
      return reply
        .code(400)
        .send({ error: 'text is required (use empty string to send Enter only)' });
    }
    const tmuxSession =
      typeof body.tmuxSession === 'string' && body.tmuxSession.trim() ? body.tmuxSession.trim() : undefined;
    const hasTmuxTarget = Boolean(tmuxSession || cliCommander.tmuxSessionName);
    const hasStdin = Boolean(cliCommander.activeProcess?.stdin?.writable);
    if (!hasTmuxTarget && !hasStdin) {
      return reply.code(404).send({ error: 'no_session', message: 'No active session or input target' });
    }
    cliCommander.sendInput(body.text == null ? '' : String(body.text), { tmuxSession });
    return { status: 'sent' };
  });
}
