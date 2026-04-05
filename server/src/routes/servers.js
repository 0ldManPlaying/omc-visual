/**
 * Multi-server registry — ~/.omc-visual/servers.json
 */
import { loadServersConfig, saveServersConfig } from '../services/servers-registry.js';

function normalizeUrl(url) {
  const u = String(url || '').trim().replace(/\/+$/, '');
  if (!u) return null;
  try {
    const parsed = new URL(u.startsWith('http') ? u : `http://${u}`);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

export async function serversRoutes(fastify) {
  fastify.get('/', async () => {
    const cfg = loadServersConfig();
    return { servers: cfg.servers || [] };
  });

  fastify.post('/', async (req, reply) => {
    const { name, url } = req.body || {};
    const n = String(name || '').trim();
    const u = normalizeUrl(url);
    if (!n) return reply.code(400).send({ error: 'name is required' });
    if (!u) return reply.code(400).send({ error: 'valid url is required' });

    const cfg = loadServersConfig();
    const servers = Array.isArray(cfg.servers) ? [...cfg.servers] : [];
    if (servers.some((s) => s.name === n)) {
      return reply.code(409).send({ error: 'server name already exists' });
    }
    servers.push({ name: n, url: u, default: false });
    saveServersConfig({ ...cfg, servers });
    return { servers };
  });

  fastify.delete('/:name', async (req, reply) => {
    const name = decodeURIComponent(String(req.params.name || ''));
    const cfg = loadServersConfig();
    const servers = Array.isArray(cfg.servers) ? cfg.servers : [];
    const next = servers.filter((s) => s.name !== name);
    if (next.length === servers.length) {
      return reply.code(404).send({ error: 'server not found' });
    }
    if (next.length === 0) {
      return reply.code(400).send({ error: 'cannot remove the last server' });
    }
    const hadDefault = servers.find((s) => s.name === name)?.default;
    if (hadDefault && !next.some((s) => s.default)) {
      next[0].default = true;
    }
    saveServersConfig({ ...cfg, servers: next });
    return { servers: next };
  });

  fastify.get('/:name/status', async (req, reply) => {
    const name = decodeURIComponent(String(req.params.name || ''));
    const cfg = loadServersConfig();
    const servers = Array.isArray(cfg.servers) ? cfg.servers : [];
    const s = servers.find((x) => x.name === name);
    if (!s?.url) return reply.code(404).send({ error: 'server not found' });

    const statusUrl = new URL('/api/status', `${s.url.replace(/\/$/, '')}/`);
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 8000);
      const r = await fetch(statusUrl.href, { signal: controller.signal });
      clearTimeout(t);
      const data = await r.json().catch(() => ({}));
      return { online: r.ok, name: s.name, url: s.url, status: data };
    } catch (err) {
      return { online: false, name: s.name, url: s.url, error: err.message || 'unreachable' };
    }
  });
}
