/**
 * Session routes — start, stop, and manage OMC sessions
 */
export async function sessionRoutes(fastify) {
  const { cliCommander } = fastify;

  /** Start a new session */
  fastify.post('/start', async (req, reply) => {
    try {
      const { mode = 'autopilot', prompt, workdir } = req.body || {};

      if (!prompt) {
        return reply.code(400).send({ error: 'prompt is required' });
      }

      const session = await cliCommander.startSession({ mode, prompt, workdir });
      return { status: 'started', session };
    } catch (err) {
      return reply.code(409).send({ error: err.message });
    }
  });

  /** Start a team session */
  fastify.post('/team', async (req, reply) => {
    try {
      const { workers = 3, role = 'executor', prompt, workdir } = req.body || {};

      if (!prompt) {
        return reply.code(400).send({ error: 'prompt is required' });
      }

      const teamPrompt = `team ${workers}:${role} ${prompt}`;
      const session = await cliCommander.startSession({
        mode: 'team',
        prompt: teamPrompt,
        workdir,
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
