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
      });
      return { status: 'started', session };
    } catch (err) {
      return reply.code(409).send({ error: err.message });
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
      });
      return { status: 'started', session };
    } catch (err) {
      return reply.code(409).send({ error: err.message });
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

  /** Get current session status */
  fastify.get('/current', async (req, reply) => {
    const session = cliCommander.getSession();
    return { session };
  });

  /** Send input to the running session */
  fastify.post('/input', async (req, reply) => {
    const { text } = req.body || {};
    if (!text) {
      return reply.code(400).send({ error: 'text is required' });
    }
    cliCommander.sendInput(text);
    return { status: 'sent' };
  });
}
