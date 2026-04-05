/**
 * Tool Manager — discover cli-anything-* binaries on PATH and cache --help output
 */
import { readdirSync, accessSync, constants } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

const PREFIX = 'cli-anything-';

export class ToolManager {
  constructor() {
    this.cache = {
      tools: [],
      python3: null,
      refreshedAt: null,
    };
  }

  resolvePython3() {
    try {
      const p = execFileSync('which', ['python3'], { encoding: 'utf-8', timeout: 5000 }).trim();
      return p || null;
    } catch {
      return null;
    }
  }

  /** Scan PATH directories for executable names starting with cli-anything- */
  scanPathForBins() {
    const pathDirs = (process.env.PATH || '').split(':').filter(Boolean);
    const found = new Map();
    for (const dir of pathDirs) {
      try {
        for (const name of readdirSync(dir)) {
          if (!name.startsWith(PREFIX)) continue;
          if (name.includes('/') || name.includes('\\')) continue;
          const full = join(dir, name);
          try {
            accessSync(full, constants.X_OK);
            if (!found.has(name)) found.set(name, full);
          } catch {
            // not executable
          }
        }
      } catch {
        // unreadable dir
      }
    }
    return found;
  }

  fetchHelp(binaryPath) {
    try {
      return execFileSync(binaryPath, ['--help'], {
        encoding: 'utf-8',
        timeout: 15000,
        maxBuffer: 2 * 1024 * 1024,
      });
    } catch (e) {
      const out = e.stdout?.toString?.() ?? '';
      const err = e.stderr?.toString?.() ?? '';
      return (out + err).trim() || String(e.message || '');
    }
  }

  /** Heuristic extraction of subcommand names from --help text */
  extractCommands(helpText) {
    const commands = new Set();
    const lines = helpText.split('\n');
    let inSection = false;

    for (const line of lines) {
      const t = line.trim();
      if (/^(commands|subcommands|positional arguments?):/i.test(t)) {
        inSection = true;
        continue;
      }
      if (inSection && /^\S/.test(line) && !line.startsWith(' ')) {
        inSection = false;
      }
      if (inSection) {
        const m = line.match(/^\s{2,}([a-z][a-z0-9_.-]*)\b/);
        if (m && !['usage', 'options', 'optional', 'arguments'].includes(m[1].toLowerCase())) {
          commands.add(m[1]);
        }
      }
      const indented = line.match(/^\s{2}([a-z][a-z0-9_.-]*)\s{2,}/);
      if (indented && indented[1].length < 32) {
        commands.add(indented[1]);
      }
    }

    const usage = helpText.match(/usage:\s*\S+\s+([A-Z_]+|\{[^}]+\}|\S+)/i);
    if (usage && !usage[1].includes('{')) {
      const u = usage[1].replace(/[[\]]/g, '');
      if (u.length < 24 && /^[a-z][a-z0-9_-]*$/i.test(u)) commands.add(u);
    }

    return [...commands].sort();
  }

  /** Full rescan + help fetch; synchronous */
  refresh() {
    this.cache.python3 = this.resolvePython3();
    const found = this.scanPathForBins();
    const tools = [];

    for (const [binary, binaryPath] of found) {
      const helpText = this.fetchHelp(binaryPath);
      let commands = this.extractCommands(helpText);
      if (commands.length === 0) {
        commands = ['--help'];
      }

      tools.push({
        id: binary,
        binary,
        path: binaryPath,
        commands,
        helpPreview: helpText.slice(0, 4000),
        helpChars: helpText.length,
      });
    }

    tools.sort((a, b) => a.binary.localeCompare(b.binary));
    this.cache.tools = tools;
    this.cache.refreshedAt = new Date().toISOString();
    return this.getInstalled();
  }

  getInstalled() {
    return {
      tools: this.cache.tools,
      python3: this.cache.python3,
      refreshedAt: this.cache.refreshedAt,
    };
  }

  getToolByBinary(binary) {
    if (!binary || typeof binary !== 'string') return null;
    if (!binary.startsWith(PREFIX)) return null;
    return this.cache.tools.find((t) => t.binary === binary);
  }
}
