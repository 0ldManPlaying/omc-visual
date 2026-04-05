import { useState, useEffect, useRef, useMemo } from 'react';
import { Monitor, Square, Send, AlertTriangle, CheckCircle, Clock, GitCommit, Activity, Zap } from 'lucide-react';
import { AnsiUp } from 'ansi_up';
import { useStore } from '../stores/useStore';

export default function LiveMonitor() {
  const { session, outputLines, workerEvents, stateEvents, sendInput, fetchStatus } = useStore();
  const [inputText, setInputText] = useState('');
  const [now, setNow] = useState(Date.now());
  const outputRef = useRef(null);

  const ansiUp = useMemo(() => {
    const a = new AnsiUp();
    a.use_classes = false;
    return a;
  }, []);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [outputLines]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [session]);

  const handleSend = () => {
    if (inputText.trim()) {
      sendInput(inputText.trim());
      setInputText('');
    }
  };

  const handleStop = async () => {
    await fetch('/api/session/stop', { method: 'POST' });
    await fetchStatus();
  };

  const allEvents = [...workerEvents, ...stateEvents]
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
    .slice(0, 50);

  const duration =
    session?.startedAt != null ? formatDuration(now - new Date(session.startedAt).getTime()) : null;

  return (
    <div className="p-6 h-screen flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <Monitor className="w-5 h-5 text-emerald-400" />
            Live monitor
          </h1>
          <p className="text-[15px] text-[#5a7a70] mt-0.5">Real-time session output and events</p>
        </div>

        {session && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[14px] text-emerald-400 font-medium">{session.mode}</span>
            </div>
            <button
              type="button"
              onClick={handleStop}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/20 px-3 py-1.5 text-[14px] text-red-400 hover:bg-red-500/5 transition-colors"
            >
              <Square className="w-3 h-3" />
              Stop
            </button>
          </div>
        )}
      </div>

      {session && (
        <div className="mb-4 rounded-xl border border-[#1a2e28] bg-[#0f1e1a] px-4 py-3 grid grid-cols-1 md:grid-cols-[auto_1fr_auto] gap-2 md:gap-4 items-start">
          <div className="flex items-center gap-2 text-[14px] text-[#8aaa9f]">
            <Activity className="w-3.5 h-3.5 text-emerald-500/80 shrink-0" />
            <span className="font-medium text-emerald-400/90">{session.mode}</span>
            <span className="text-[#3a5a50] hidden sm:inline">·</span>
            <span className="text-[#5a7a70] tabular-nums">{duration ?? '—'}</span>
          </div>
          <p className="text-[14px] text-[#a0b8b0] leading-snug line-clamp-2 md:line-clamp-3" title={session.prompt}>
            {session.prompt}
          </p>
          <span className="text-[13px] text-[#3a5a50] font-mono truncate md:text-right">{session.id}</span>
        </div>
      )}

      <div className="flex-1 flex gap-4 min-h-0">
        <div className="flex-1 flex flex-col rounded-xl border border-[#1a2e28] bg-[#0a1210] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#1a2e28] flex items-center justify-between bg-[#0d1816]">
            <div className="flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-[#4a6a60]" />
              <span className="text-[14px] text-[#5a7a70] font-medium">Output</span>
            </div>
            <span className="text-[13px] text-[#2a4e40]">{outputLines.length} chunks</span>
          </div>

          <div
            ref={outputRef}
            className="flex-1 overflow-auto p-4 font-mono text-[13px] leading-[1.7] bg-[#0a0f0d]"
          >
            {outputLines.length === 0 ? (
              <div className="text-[14px] text-[#2a4e40] text-center mt-12">
                <div className="w-12 h-12 rounded-xl bg-[#12221e] border border-[#1a3530] flex items-center justify-center mx-auto mb-3">
                  <Monitor className="w-6 h-6 text-[#2a4e40]" />
                </div>
                {session ? 'Waiting for output…' : 'No active session'}
              </div>
            ) : (
              outputLines.map((line, i) => (
                <OutputChunk key={`${line.timestamp || ''}-${i}`} line={line} ansiUp={ansiUp} />
              ))
            )}
          </div>

          {session && (
            <div className="border-t border-[#1a2e28] p-3 flex gap-2 bg-[#0d1816]">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Send input to session…"
                className="flex-1 bg-[#0a1612] border border-[#1a3530] rounded-lg px-3 py-2 text-[14px] text-[#c8d6d0] placeholder-[#2a4e40] focus:outline-none focus:border-emerald-500/30"
              />
              <button
                type="button"
                onClick={handleSend}
                className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-2 text-white transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        <div className="w-[280px] flex flex-col rounded-xl border border-[#1a2e28] bg-[#0a1210] overflow-hidden shrink-0">
          <div className="px-4 py-2.5 border-b border-[#1a2e28] bg-[#0d1816] flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-[#5a7a70]" />
            <span className="text-[14px] text-[#5a7a70] font-medium">Events</span>
          </div>

          <div className="flex-1 overflow-auto">
            {allEvents.length > 0 ? (
              allEvents.map((event, i) => <EventItem key={`${event.timestamp || ''}-${i}`} event={event} />)
            ) : (
              <div className="text-[14px] text-[#2a4e40] text-center mt-8 px-4">
                Clawhip (keywords, stale), git, and OMC state events appear here
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function OutputChunk({ line, ansiUp }) {
  if (line.type === 'exit') {
    return (
      <div className="text-amber-400/90 my-2 border-t border-[#1a2e28] pt-2">
        — Session ended (code {String(line.code)}) —
      </div>
    );
  }
  if (line.type === 'error') {
    return <div className="text-red-400 whitespace-pre-wrap break-words">{line.message}</div>;
  }
  const raw = line.text ?? '';
  const html = ansiUp.ansi_to_html(raw);
  const dim = line.type === 'stderr';
  return (
    <div
      className={`whitespace-pre-wrap break-words ${dim ? 'opacity-80' : ''} ${
        line.type === 'stderr' ? 'text-red-300/80' : 'text-[#c8e0d4]'
      }`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function EventItem({ event }) {
  const severityStyles = {
    high: { icon: AlertTriangle, bg: 'bg-red-500/10', color: 'text-red-400' },
    success: { icon: CheckCircle, bg: 'bg-emerald-500/10', color: 'text-emerald-400' },
    medium: { icon: Clock, bg: 'bg-amber-500/10', color: 'text-amber-400' },
    info: { icon: Activity, bg: 'bg-[#12221e]', color: 'text-[#5a7a70]' },
  };

  const sev = event.severity || 'info';
  const style = severityStyles[sev] || severityStyles.info;
  const label =
    event.type === 'clawhip_feed'
      ? 'Clawhip'
      : event.type === 'keyword_detected'
        ? 'Keyword'
        : event.type === 'worker_stale'
          ? 'Stale'
          : event.type === 'git_commit'
            ? 'Git'
            : event.type === 'github_event'
              ? 'GitHub'
              : event.type || 'event';
  const Icon =
    event.type?.includes('git') || event.type === 'git_commit' ? GitCommit : style.icon;

  return (
    <div className="px-3 py-2.5 border-b border-[#12221e] hover:bg-[#0d1816] transition-colors">
      <div className="flex items-center gap-2">
        <div className={`w-5 h-5 rounded-md flex items-center justify-center ${style.bg}`}>
          <Icon className={`w-3 h-3 ${style.color}`} />
        </div>
        <span className={`text-[13px] font-medium ${style.color}`}>{label}</span>
      </div>
      {(event.keyword || event.summary || event.message || event.context) && (
        <p className="text-[13px] text-[#6a8a80] mt-1 ml-7 line-clamp-4">
          {event.keyword ? `“${event.keyword}” · ` : ''}
          {event.summary || event.message || event.context || ''}
        </p>
      )}
      {event.timestamp && (
        <div className="text-[12px] text-[#2a4e40] mt-0.5 ml-7">{event.timestamp}</div>
      )}
    </div>
  );
}

function formatDuration(ms) {
  if (ms < 0 || Number.isNaN(ms)) return '0s';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
