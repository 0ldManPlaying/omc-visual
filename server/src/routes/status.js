import { execSync, execFileSync } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/**
 * Status routes — system health, OMC detection, and environment info
 */
export async function statusRoutes(fastify) {
  const { cliCommander } = fastify;

  /** Full system status */
  fastify.get('/', async (req, reply) => {
    return {
      server: {
        version: '0.1.0',
        uptime: process.uptime(),
        nodeVersion: process.version,
      },
      paths: {
        homeDir: homedir(),
        suggestedWorkdir: process.cwd(),
      },
      omc: getOMCStatus(),
      clawhip: getClawhipStatus(),
      session: cliCommander.getSession(),
      websocket: {
        clients: fastify.wsHub.clients.size,
      },
    };
  });

  /** Quick health check */
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  /** OMC agents list */
  fastify.get('/agents', async () => {
    return { agents: getAgentList() };
  });
}

/** Check if OMC is installed and get version */
function getOMCStatus() {
  try {
    const version = execSync('omc --version 2>/dev/null', { encoding: 'utf-8' }).trim();
    const claudeVersion = execSync('claude --version 2>/dev/null', { encoding: 'utf-8' }).trim();

    const configPath = join(homedir(), '.claude', '.omc-config.json');
    let config = null;
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
    }

    return {
      installed: true,
      version,
      claudeVersion,
      config,
    };
  } catch {
    return { installed: false };
  }
}

function resolveClawhipBin() {
  const cargo = join(homedir(), '.cargo', 'bin', 'clawhip');
  if (existsSync(cargo)) return cargo;
  return 'clawhip';
}

/** Check if Clawhip daemon is running */
function getClawhipStatus() {
  const bin = resolveClawhipBin();
  try {
    const version = execFileSync(bin, ['--version'], { encoding: 'utf-8' }).trim();
    try {
      execFileSync(bin, ['status'], { encoding: 'utf-8', stdio: 'pipe' });
      return { installed: true, version, daemonRunning: true };
    } catch {
      return { installed: true, version, daemonRunning: false };
    }
  } catch {
    return { installed: false, daemonRunning: false };
  }
}

/** Read agent definitions from ~/.claude/agents/ */
function getAgentList() {
  const agentsDir = join(homedir(), '.claude', 'agents');
  if (!existsSync(agentsDir)) return [];

  try {
    const files = readdirSync(agentsDir).filter((f) => f.endsWith('.md'));

    return files.map((file) => {
      const content = readFileSync(join(agentsDir, file), 'utf-8');
      const name = file.replace('.md', '');

      const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
      let model = 'sonnet';
      let description = '';
      if (frontmatter) {
        const modelMatch = frontmatter[1].match(/model:\s*(.+)/);
        const descMatch = frontmatter[1].match(/description:\s*(.+)/);
        if (modelMatch) model = modelMatch[1].trim();
        if (descMatch) description = descMatch[1].trim();
      }

      return { name, model, description, file };
    });
  } catch {
    return [];
  }
}
