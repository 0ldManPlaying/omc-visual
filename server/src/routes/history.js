/**
 * History routes — session archive and replay
 */
export async function historyRoutes(fastify) {
  const { sessionStore } = fastify;

  /** List sessions with pagination */
  fastify.get('/sessions', async (req) => {
    const { limit = 50, offset = 0, mode } = req.query;
    return sessionStore.getSessions({
      limit: Math.min(Number(limit), 100),
      offset: Number(offset),
      mode: mode || undefined,
    });
  });

  /** Get single session detail */
  fastify.get('/sessions/:id', async (req, reply) => {
    const session = sessionStore.getSession(req.params.id);
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const events = sessionStore.getSessionEvents(req.params.id);
    const metrics = sessionStore.getSessionMetrics(req.params.id);
    return { session, events, metrics };
  });

  /** Get session events for replay */
  fastify.get('/sessions/:id/events', async (req, reply) => {
    const session = sessionStore.getSession(req.params.id);
    if (!session) return reply.code(404).send({ error: 'Session not found' });
    return { events: sessionStore.getSessionEvents(req.params.id) };
  });

  /** Delete a session */
  fastify.delete('/sessions/:id', async (req) => {
    sessionStore.deleteSession(req.params.id);
    return { status: 'deleted' };
  });

  /** Aggregate metrics across all sessions */
  fastify.get('/metrics', async () => {
    return sessionStore.getAggregateMetrics();
  });
}
