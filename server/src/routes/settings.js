/**
 * Settings routes — OMC + Clawhip configuration management
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export async function settingsRoutes(fastify) {
  /** Get all settings */
  fastify.get('/', async () => {
    return {
      omc: getOMCSettings(),
      clawhip: getClawhipSettings(),
      visual: getVisualSettings(),
    };
  });

  /** Update OMC settings */
  fastify.put('/omc', async (req, reply) => {
    try {
      const configPath = join(homedir(), '.claude', 'settings.json');
      let config = {};
      if (existsSync(configPath)) {
        config = JSON.parse(readFileSync(configPath, 'utf-8'));
      }

      if (req.body.omc) {
        config.omc = { ...config.omc, ...req.body.omc };
      }

      writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      return { status: 'updated', config: config.omc };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  /** Update Clawhip config */
  fastify.put('/clawhip', async (req, reply) => {
    try {
      const configPath = join(homedir(), '.clawhip', 'config.toml');
      if (!req.body.content) {
        return reply.code(400).send({ error: 'content is required' });
      }
      writeFileSync(configPath, req.body.content, 'utf-8');
      return { status: 'updated' };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  /** Update visual server settings */
  fastify.put('/visual', async (req, reply) => {
    try {
      const settingsPath = join(homedir(), '.omc-visual', 'settings.json');
      let current = {};
      if (existsSync(settingsPath)) {
        current = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      }
      const updated = { ...current, ...req.body };
      writeFileSync(settingsPath, JSON.stringify(updated, null, 2), 'utf-8');
      return { status: 'updated', settings: updated };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });
}

function getOMCSettings() {
  try {
    const configPath = join(homedir(), '.claude', 'settings.json');
    if (!existsSync(configPath)) return { exists: false };
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    return { exists: true, config };
  } catch {
    return { exists: false };
  }
}

function getClawhipSettings() {
  try {
    const configPath = join(homedir(), '.clawhip', 'config.toml');
    if (!existsSync(configPath)) return { exists: false };
    const content = readFileSync(configPath, 'utf-8');
    return { exists: true, path: configPath, content };
  } catch {
    return { exists: false };
  }
}

function getVisualSettings() {
  try {
    const settingsPath = join(homedir(), '.omc-visual', 'settings.json');
    if (!existsSync(settingsPath)) return { exists: false, settings: {} };
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    return { exists: true, settings };
  } catch {
    return { exists: false, settings: {} };
  }
}
