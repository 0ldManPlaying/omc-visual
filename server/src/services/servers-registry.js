/**
 * ~/.omc-visual/servers.json — multi-server UI configuration
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const DATA_DIR = join(homedir(), '.omc-visual');
const SERVERS_PATH = join(DATA_DIR, 'servers.json');

function ensureDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadServersConfig() {
  ensureDir();
  if (!existsSync(SERVERS_PATH)) {
    const port = Number(process.env.OMC_VISUAL_PORT) || 3200;
    const defaultUrl = `http://127.0.0.1:${port}`;
    const cfg = { servers: [{ name: 'Local', url: defaultUrl.replace(/\/$/, ''), default: true }] };
    writeFileSync(SERVERS_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
    return cfg;
  }
  const raw = readFileSync(SERVERS_PATH, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch {
    const port = Number(process.env.OMC_VISUAL_PORT) || 3200;
    return { servers: [{ name: 'Local', url: `http://127.0.0.1:${port}`, default: true }] };
  }
}

export function saveServersConfig(cfg) {
  ensureDir();
  writeFileSync(SERVERS_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
}
