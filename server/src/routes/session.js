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
      return reply.code(409).send({ error: err.message || 'start failed' });
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
      return reply.code(409).send({ error: err.message || 'start failed' });
    }
  });

  /** Stop the current session */
  fastify.post('/stop', async (req, reply) => {
    const result = cliCommander.stopSession();
    return result;
  });

  /** Force kill: tmux kill-session + SIGKILL child + reset state + WS + SQLite status killed */
  fastify.post('/kill', async (req, reply) => {
    const result = cliCommander.killSession();
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
    cliCommander.sendInput(body.text == null ? '' : String(body.text));
    return { status: 'sent' };
  });
}
