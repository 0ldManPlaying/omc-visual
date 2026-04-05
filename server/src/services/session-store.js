/**
 * Session Store — SQLite persistence for session history
 * Uses better-sqlite3 for synchronous, fast access
 */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';

export class SessionStore {
  constructor() {
    const dataDir = join(homedir(), '.omc-visual');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    this.dbPath = join(dataDir, 'sessions.db');
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.init();
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        prompt TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        duration_ms INTEGER,
        exit_code TEXT,
        status TEXT DEFAULT 'running',
        cwd TEXT,
        tmux_session TEXT
      );

      CREATE TABLE IF NOT EXISTS session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        channel TEXT,
        severity TEXT DEFAULT 'info',
        message TEXT,
        data TEXT,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS session_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        tokens_in INTEGER DEFAULT 0,
        tokens_out INTEGER DEFAULT 0,
        cost_usd REAL DEFAULT 0,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_events_session ON session_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON session_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_metrics_session ON session_metrics(session_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
    `);
  }

  saveSession(session) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sessions (id, mode, prompt, started_at, status, cwd, tmux_session)
      VALUES (?, ?, ?, ?, 'running', ?, ?)
    `);
    stmt.run(
      session.id,
      session.mode,
      session.prompt,
      session.startedAt,
      session.cwd || null,
      session.tmuxSession || null
    );
  }

  endSession(sessionId, exitCode) {
    const session = this.db.prepare('SELECT started_at FROM sessions WHERE id = ?').get(sessionId);
    const endedAt = new Date().toISOString();
    const durationMs = session
      ? new Date(endedAt).getTime() - new Date(session.started_at).getTime()
      : 0;

    const ec = exitCode ?? 0;
    const status =
      ec === 'stopped' ? 'stopped' : ec === 'error' ? 'failed' : 'completed';

    this.db.prepare(`
      UPDATE sessions SET ended_at = ?, duration_ms = ?, exit_code = ?, status = ?
      WHERE id = ?
    `).run(endedAt, durationMs, String(ec), status, sessionId);
  }

  saveEvent(sessionId, event) {
    this.db.prepare(`
      INSERT INTO session_events (session_id, type, channel, severity, message, data, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      event.type || 'unknown',
      event.channel || null,
      event.severity || 'info',
      event.message || event.summary || event.context || null,
      JSON.stringify(event),
      event.timestamp || new Date().toISOString()
    );
  }

  saveMetrics(sessionId, metrics) {
    this.db.prepare(`
      INSERT INTO session_metrics (session_id, tokens_in, tokens_out, cost_usd, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      sessionId,
      metrics.tokensIn || 0,
      metrics.tokensOut || 0,
      metrics.costUsd || 0,
      new Date().toISOString()
    );
  }

  getSessions({ limit = 50, offset = 0, mode } = {}) {
    let query = 'SELECT * FROM sessions';
    const params = [];
    if (mode) {
      query += ' WHERE mode = ?';
      params.push(mode);
    }
    query += ' ORDER BY started_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const sessions = this.db.prepare(query).all(...params);
    const countQuery = mode
      ? 'SELECT COUNT(*) as total FROM sessions WHERE mode = ?'
      : 'SELECT COUNT(*) as total FROM sessions';
    const { total } = mode
      ? this.db.prepare(countQuery).get(mode)
      : this.db.prepare(countQuery).get();

    return { sessions, total };
  }

  getSession(sessionId) {
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  }

  getSessionEvents(sessionId, { limit = 200 } = {}) {
    return this.db.prepare(
      'SELECT * FROM session_events WHERE session_id = ? ORDER BY timestamp ASC LIMIT ?'
    ).all(sessionId, limit);
  }

  getSessionMetrics(sessionId) {
    return this.db.prepare(
      'SELECT * FROM session_metrics WHERE session_id = ? ORDER BY timestamp ASC'
    ).all(sessionId);
  }

  getAggregateMetrics() {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total_sessions,
        SUM(duration_ms) as total_duration_ms,
        AVG(duration_ms) as avg_duration_ms,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running
      FROM sessions
    `).get();

    const metrics = this.db.prepare(`
      SELECT
        SUM(tokens_in) as total_tokens_in,
        SUM(tokens_out) as total_tokens_out,
        SUM(cost_usd) as total_cost_usd
      FROM session_metrics
    `).get();

    return { ...row, ...metrics };
  }

  deleteSession(sessionId) {
    this.db.prepare('DELETE FROM session_events WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM session_metrics WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  close() {
    this.db.close();
  }
}
