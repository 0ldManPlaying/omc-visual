import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { AnsiUp } from 'ansi_up';
import {
  History, Clock, Trash2, ChevronDown, ChevronRight, Activity,
  AlertTriangle, CheckCircle, Zap, Filter, Rocket, Play, X,
} from 'lucide-react';
import { apiUrl, useStore } from '../stores/useStore';

const MODE_COLORS = {
  autopilot: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  ralph: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
  ultrawork: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
  ulw: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
  team: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/20' },
  plan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20' },
  eco: { bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/20' },
};

const SEVERITY_STYLES = {
  high: { icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-500/10' },
  success: { icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  medium: { icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  info: { icon: Activity, color: 'text-[#5a7a70]', bg: 'bg-[#12221e]' },
};

export default function SessionHistory() {
  const activeServer = useStore((s) => s.activeServer);
  const [sessions, setSessions] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [modeFilter, setModeFilter] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [replayFor, setReplayFor] = useState(null);
  const [replayChunks, setReplayChunks] = useState([]);
  const [replayLoading, setReplayLoading] = useState(false);
  const replayScrollRef = useRef(null);
  const limit = 20;

  const fetchSessions = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit, offset: page * limit });
      if (modeFilter) params.set('mode', modeFilter);
      const res = await fetch(apiUrl(`/api/history/sessions?${params}`));
      const data = await res.json();
      setSessions(data.sessions || []);
      setTotal(data.total || 0);
    } catch {
      setSessions([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchSessions();
  }, [page, modeFilter, activeServer]);

  const handleExpand = async (id) => {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(id);
    try {
      const res = await fetch(apiUrl(`/api/history/sessions/${id}`));
      const data = await res.json();
      setDetail(data);
    } catch {
      setDetail(null);
    }
  };

  const handleDelete = async (id) => {
    await fetch(apiUrl(`/api/history/sessions/${id}`), { method: 'DELETE' });
    fetchSessions();
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
    }
  };

  const openReplay = async (session) => {
    setReplayFor(session);
    setReplayLoading(true);
    setReplayChunks([]);
    try {
      const res = await fetch(apiUrl(`/api/sessions/${session.id}/output`));
      const data = await res.json().catch(() => ({}));
      setReplayChunks(Array.isArray(data.chunks) ? data.chunks : []);
    } catch {
      setReplayChunks([]);
    }
    setReplayLoading(false);
  };

  const closeReplay = () => {
    setReplayFor(null);
    setReplayChunks([]);
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="p-6 h-screen flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <History className="w-5 h-5 text-blue-400" />
            Session history
          </h1>
          <p className="mt-0.5 text-[15px] text-[#5a7a70]">Browse past sessions with replay and events</p>
        </div>
        <span className="text-[14px] text-[#3a5a50]">{total} sessions</span>
      </div>

      {/* Mode filter */}
      <div className="flex items-center gap-2 mb-4">
        <Filter className="w-3.5 h-3.5 text-[#3a5a50]" />
        <div className="flex gap-1">
          {['', 'autopilot', 'ralph', 'ultrawork', 'team', 'plan'].map((m) => (
            <button
              key={m}
              onClick={() => { setModeFilter(m); setPage(0); }}
              className={`rounded-md px-2.5 py-1 text-[14px] font-medium transition-colors ${
                modeFilter === m
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'text-[#5a7a70] hover:text-[#8aaa9f] hover:bg-[#12221e]'
              }`}
            >
              {m || 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-auto space-y-2">
        {loading ? (
          <div className="py-12 text-center text-[15px] text-[#3a5a50]">Loading sessions...</div>
        ) : sessions.length === 0 ? (
          <div className="flex h-56 items-center justify-center">
            <div className="max-w-sm text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-[#1a3530] bg-[#12221e]">
                <History className="h-12 w-12 text-[#6a8a80]" aria-hidden />
              </div>
              <p className="text-[15px] text-[#8aaa9f]">No sessions recorded yet</p>
              <p className="mt-2 text-[14px] text-[#6a8a80]">Sessions are saved automatically when you start one from Mission Control.</p>
              <Link
                to="/launch"
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-[15px] font-medium text-white transition-colors hover:bg-emerald-500"
              >
                <Rocket className="h-4 w-4" aria-hidden />
                Go to Mission Control
              </Link>
            </div>
          </div>
        ) : (
          sessions.map((session) => {
            const mc = MODE_COLORS[session.mode] || MODE_COLORS.autopilot;
            const isExpanded = expandedId === session.id;

            return (
              <div key={session.id} className="rounded-xl border border-[#1a2e28] bg-[#0f1e1a] overflow-hidden">
                <button
                  type="button"
                  onClick={() => handleExpand(session.id)}
                  className="w-full p-5 text-left transition-colors hover:bg-[#12221e]"
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-[#5a7a70] shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-[#3a5a50] shrink-0" />
                    )}
                    <span className={`rounded-full border px-2 py-0.5 text-[12px] font-medium ${mc.bg} ${mc.text} ${mc.border}`}>
                      {session.mode}
                    </span>
                    <p className="flex-1 truncate text-[14px] text-[#a0b8b0]">{session.prompt}</p>
                    <div className="flex items-center gap-3 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void openReplay(session);
                        }}
                        className="flex items-center gap-1 rounded-md border border-[#1a3530] bg-[#0a1612] px-2 py-1 text-[12px] text-sky-400/90 hover:bg-[#12221e] hover:text-sky-300 transition-colors"
                      >
                        <Play className="w-3 h-3" />
                        Replay
                      </button>
                      {session.duration_ms != null && (
                        <span className="tabular-nums text-[13px] text-[#5a7a70]">
                          {formatDuration(session.duration_ms)}
                        </span>
                      )}
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        session.status === 'running' ? 'bg-emerald-400 animate-pulse' :
                        session.status === 'completed' ? 'bg-blue-400' :
                        session.status === 'stopped' ? 'bg-amber-400' :
                        session.status === 'failed' ? 'bg-red-400' : 'bg-[#2a3e38]'
                      }`} />
                      <span className="w-[70px] text-right tabular-nums text-[13px] text-[#3a5a50]">
                        {new Date(session.started_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-[#1a2e28] bg-[#0a1612] p-5">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                      <InfoCard label="Session ID" value={session.id} mono />
                      <InfoCard label="Started" value={new Date(session.started_at).toLocaleString()} />
                      <InfoCard label="Duration" value={session.duration_ms != null ? formatDuration(session.duration_ms) : 'Running'} />
                      <InfoCard label="Exit code" value={session.exit_code ?? '—'} mono />
                    </div>

                    <div className="mb-3 rounded-lg bg-[#0f1e1a] border border-[#1a2e28] p-3">
                      <p className="text-[14px] text-[#a0b8b0]">{session.prompt}</p>
                    </div>

                    {/* Events replay */}
                    {detail?.events && detail.events.length > 0 && (
                      <div>
                        <h3 className="mb-2 flex items-center gap-2 text-[16px] font-semibold text-white">
                          <Zap className="w-3.5 h-3.5 text-amber-400" />
                          Events ({detail.events.length})
                        </h3>
                        <div className="space-y-1 max-h-60 overflow-auto">
                          {detail.events.map((event, i) => {
                            const sev = SEVERITY_STYLES[event.severity] || SEVERITY_STYLES.info;
                            const SevIcon = sev.icon;
                            return (
                              <div key={i} className="flex items-start gap-2 py-1.5 px-2 rounded hover:bg-[#12221e]">
                                <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${sev.bg}`}>
                                  <SevIcon className={`w-3 h-3 ${sev.color}`} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className={`text-[13px] font-medium ${sev.color}`}>{event.type}</span>
                                    <span className="text-[12px] text-[#2a4e40]">
                                      {new Date(event.timestamp).toLocaleTimeString()}
                                    </span>
                                  </div>
                                  <p className="truncate text-[13px] text-[#6a8a80]">{event.message || '—'}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-3 mt-4 pt-3 border-t border-[#1a2e28]">
                      <button
                        type="button"
                        onClick={() => void openReplay(session)}
                        className="flex items-center gap-1.5 text-[13px] text-sky-400/80 transition-colors hover:text-sky-300"
                      >
                        <Play className="w-3 h-3" />
                        Replay output
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(session.id)}
                        className="flex items-center gap-1.5 text-[13px] text-red-400/70 transition-colors hover:text-red-400"
                      >
                        <Trash2 className="w-3 h-3" />
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4 pt-3 border-t border-[#1a2e28]">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className="rounded-md px-3 py-1 text-[13px] text-[#5a7a70] transition-colors hover:bg-[#12221e] disabled:opacity-30"
          >
            Previous
          </button>
          <span className="text-[13px] text-[#3a5a50]">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            className="rounded-md px-3 py-1 text-[13px] text-[#5a7a70] transition-colors hover:bg-[#12221e] disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}

      {replayFor && (
        <ReplayModal
          session={replayFor}
          chunks={replayChunks}
          loading={replayLoading}
          onClose={closeReplay}
          scrollRef={replayScrollRef}
        />
      )}
    </div>
  );
}

function ReplayModal({ session, chunks, loading, onClose, scrollRef }) {
  const ansiUp = useMemo(() => {
    const a = new AnsiUp();
    a.use_classes = false;
    return a;
  }, []);

  useEffect(() => {
    if (!loading && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [loading, chunks, scrollRef]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="replay-title"
      onClick={onClose}
    >
      <div
        className="flex h-[min(88vh,820px)] min-h-0 w-full max-w-5xl flex-col rounded-xl border border-[#1a2e28] bg-[#0a1210] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[#1a2e28] bg-[#0d1816] px-4 py-3">
          <div className="min-w-0">
            <h2 id="replay-title" className="text-[16px] font-semibold text-white truncate">
              Session replay
            </h2>
            <p className="text-[13px] text-[#5a7a70] font-mono truncate">{session.id}</p>
            <p className="text-[13px] text-[#8aaa9f] line-clamp-2 mt-0.5">{session.prompt}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#1a3530] p-2 text-[#8aaa9f] hover:bg-[#12221e] hover:text-white shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-4 py-2 border-b border-[#1a2e28] bg-[#0f1e1a] text-[13px] text-[#5a7a70]">
          {loading
            ? 'Loading saved output…'
            : chunks.length === 0
              ? 'No output chunks stored for this session yet (only sessions started after this update capture pane output).'
              : `${chunks.length} chunk${chunks.length === 1 ? '' : 's'} · scrollable log`}
        </div>
        <div
          ref={scrollRef}
          className="flex-1 overflow-auto p-4 font-mono text-[13px] leading-[1.7] bg-[#0a0f0d]"
        >
          {loading ? (
            <div className="text-[#3a5a50] text-center py-12">Loading…</div>
          ) : (
            chunks.map((c, i) => (
              <ReplayLine key={`${c.timestamp}-${i}`} chunk={c} ansiUp={ansiUp} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ReplayLine({ chunk, ansiUp }) {
  const ts = chunk.timestamp
    ? new Date(chunk.timestamp).toLocaleTimeString(undefined, { hour12: false })
    : '';
  const text = chunk.text ?? '';
  const isExit = chunk.type === 'error' && /^\[exit\]/i.test(text);

  let body;
  if (isExit) {
    body = (
      <div className="text-amber-400/90 whitespace-pre-wrap break-words border-t border-[#1a2e28] pt-2 mt-2 first:mt-0 first:pt-0 first:border-0">
        {text}
      </div>
    );
  } else if (chunk.type === 'error') {
    body = (
      <div className="text-red-400 whitespace-pre-wrap break-words">{text}</div>
    );
  } else if (chunk.type === 'stderr') {
    body = (
      <div
        className="whitespace-pre-wrap break-words text-red-300/80 opacity-90"
        dangerouslySetInnerHTML={{ __html: ansiUp.ansi_to_html(text) }}
      />
    );
  } else {
    body = (
      <div
        className="whitespace-pre-wrap break-words text-[#c8e0d4]"
        dangerouslySetInnerHTML={{ __html: ansiUp.ansi_to_html(text) }}
      />
    );
  }

  return (
    <div className="flex gap-3 py-1 border-b border-[#12221e]/80 last:border-0">
      <div className="w-[88px] shrink-0 text-[11px] text-[#2a5a48] tabular-nums pt-0.5 select-none">{ts}</div>
      <div className="min-w-0 flex-1">{body}</div>
    </div>
  );
}

function InfoCard({ label, value, mono }) {
  return (
    <div className="rounded-lg border border-[#1a2e28] bg-[#0f1e1a] p-4">
      <div className="mb-0.5 text-[14px] text-[#3a5a50]">{label}</div>
      <div className={`truncate text-[14px] text-[#a0b8b0] ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
