import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Clock, AlertTriangle, CheckCircle, GitCommit, Activity, Zap, Filter, Search,
  MessageSquare, Rocket,
} from 'lucide-react';
import { useStore } from '../stores/useStore';

const SEVERITY_CONFIG = {
  high: { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', dot: 'bg-red-400', label: 'Error' },
  success: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', dot: 'bg-emerald-400', label: 'Success' },
  medium: { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', dot: 'bg-amber-400', label: 'Warning' },
  info: { color: 'text-[#5a7a70]', bg: 'bg-[#12221e]', border: 'border-[#1a2e28]', dot: 'bg-[#4a6a60]', label: 'Info' },
};

const TYPE_FILTERS = ['all', 'keyword', 'stale', 'git', 'github', 'state', 'clawhip'];

export default function EventTimeline() {
  const { workerEvents, stateEvents } = useStore();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);

  const allEvents = useMemo(() => {
    const combined = [
      ...workerEvents.map((e) => ({ ...e, source: 'clawhip' })),
      ...stateEvents.map((e) => ({ ...e, source: 'state' })),
    ].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

    let filtered = combined;
    if (filter !== 'all') {
      filtered = filtered.filter((e) => {
        const t = (e.type || '').toLowerCase();
        if (filter === 'keyword') return t.includes('keyword');
        if (filter === 'stale') return t.includes('stale');
        if (filter === 'git') return t.includes('git_commit') || t === 'git_commit';
        if (filter === 'github') return t.includes('github');
        if (filter === 'state') return t.includes('state') || t.includes('file_changed');
        if (filter === 'clawhip') return t.includes('clawhip') || e.source === 'clawhip';
        return true;
      });
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          (e.message || '').toLowerCase().includes(q) ||
          (e.keyword || '').toLowerCase().includes(q) ||
          (e.summary || '').toLowerCase().includes(q) ||
          (e.context || '').toLowerCase().includes(q) ||
          (e.type || '').toLowerCase().includes(q)
      );
    }

    return filtered;
  }, [workerEvents, stateEvents, filter, search]);

  return (
    <div className="p-6 h-screen flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <Clock className="w-5 h-5 text-cyan-400" />
            Event timeline
          </h1>
          <p className="mt-0.5 text-[15px] text-[#5a7a70]">Chronological view of all events</p>
        </div>
        <span className="text-[14px] text-[#3a5a50]">{allEvents.length} events</span>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-1.5 rounded-lg border border-[#1a2e28] bg-[#0f1e1a] p-1">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-2.5 py-1 text-[14px] font-medium capitalize transition-colors ${
                filter === f
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'text-[#5a7a70] hover:text-[#8aaa9f] hover:bg-[#12221e]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex-1 max-w-xs relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#3a5a50]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events..."
            className="w-full rounded-lg border border-[#1a2e28] bg-[#0f1e1a] py-1.5 pl-8 pr-3 text-[15px] text-[#c8d6d0] placeholder-[#2a4e40] focus:border-emerald-500/30 focus:outline-none"
          />
        </div>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-auto">
        {allEvents.length > 0 ? (
          <div className="relative pl-6">
            {/* Vertical line */}
            <div className="absolute left-[9px] top-2 bottom-2 w-[2px] bg-[#1a2e28]" />

            {allEvents.map((event, i) => {
              const sev = SEVERITY_CONFIG[event.severity] || SEVERITY_CONFIG.info;
              const isExpanded = expanded === i;

              return (
                <div key={`${event.timestamp}-${i}`} className="relative mb-1">
                  {/* Timeline dot */}
                  <div className={`absolute left-[-18px] top-3 w-2.5 h-2.5 rounded-full border-2 border-[#0c1614] ${sev.dot}`} />

                  <button
                    type="button"
                    onClick={() => setExpanded(isExpanded ? null : i)}
                    className={`w-full text-left rounded-lg border p-3 transition-all ${
                      isExpanded ? `${sev.border} ${sev.bg}` : 'border-transparent hover:bg-[#0f1e1a]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <EventTypeIcon type={event.type} />
                      <span className={`text-[13px] font-medium ${sev.color}`}>
                        {formatEventType(event.type)}
                      </span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[12px] ${sev.bg} ${sev.color}`}>
                        {sev.label}
                      </span>
                      <span className="flex-1" />
                      <span className="tabular-nums text-[13px] text-[#3a5a50]">
                        {event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : '—'}
                      </span>
                    </div>
                    <p className="ml-5 mt-1 line-clamp-2 text-[13px] text-[#8aaa9f]">
                      {event.keyword ? `"${event.keyword}" · ` : ''}
                      {event.message || event.summary || event.context || '—'}
                    </p>

                    {isExpanded && event.data && (
                      <pre className="ml-5 mt-2 max-h-40 overflow-auto rounded border border-[#1a2e28] bg-[#0a1210] p-2 font-mono text-[13px] text-[#5a7a70]">
                        {typeof event.data === 'string' ? event.data : JSON.stringify(event.data, null, 2)}
                      </pre>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex h-56 items-center justify-center">
            <div className="max-w-sm text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-[#1a3530] bg-[#12221e]">
                <Clock className="h-12 w-12 text-[#6a8a80]" aria-hidden />
              </div>
              <p className="text-[15px] text-[#8aaa9f]">No events recorded yet</p>
              <p className="mt-2 text-[14px] text-[#6a8a80]">Events will appear during active sessions.</p>
              <Link
                to="/launch"
                className="mt-5 inline-flex items-center gap-2 rounded-lg border border-[#1a3530] bg-[#12221e] px-4 py-2.5 text-[15px] font-medium text-[#a0c0b5] transition-colors hover:border-emerald-500/30 hover:bg-[#162a25] hover:text-emerald-300"
              >
                <Rocket className="h-4 w-4" aria-hidden />
                Go to Mission Control
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EventTypeIcon({ type }) {
  const t = (type || '').toLowerCase();
  if (t.includes('git')) return <GitCommit className="w-3.5 h-3.5 text-[#5a7a70]" />;
  if (t.includes('keyword')) return <Zap className="w-3.5 h-3.5 text-amber-400" />;
  if (t.includes('stale')) return <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />;
  if (t.includes('clawhip')) return <Activity className="w-3.5 h-3.5 text-cyan-400" />;
  return <MessageSquare className="w-3.5 h-3.5 text-[#4a6a60]" />;
}

function formatEventType(type) {
  if (!type) return 'Event';
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
