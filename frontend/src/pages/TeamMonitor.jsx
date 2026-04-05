import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Users, AlertTriangle, CheckCircle, Clock, Zap, Circle, Rocket, Monitor } from 'lucide-react';
import { AnsiUp } from 'ansi_up';
import DOMPurify from 'dompurify';
import { useStore, apiUrl } from '../stores/useStore';
import PipelineProgress from '../components/PipelineProgress';

export default function TeamMonitor() {
  const { session, stateEvents, workerEvents, teamPanes, activeServer } = useStore();
  const [now, setNow] = useState(Date.now());
  const [pollState, setPollState] = useState({ teamActive: false, workers: 0, panes: [] });
  const [paneOutputs, setPaneOutputs] = useState({});

  const ansiUp = useMemo(() => {
    const a = new AnsiUp();
    a.use_classes = false;
    return a;
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!session) {
      setPollState({ teamActive: false, workers: 0, panes: [] });
      setPaneOutputs({});
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(apiUrl('/api/session/team-panes'));
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const panes = Array.isArray(data.panes) ? data.panes : [];
        setPollState({
          teamActive: Boolean(data.teamActive),
          workers: typeof data.workers === 'number' ? data.workers : Math.max(0, panes.length - 1),
          panes,
        });
        const outs = {};
        await Promise.all(
          panes.map(async (p) => {
            const idx = p.index;
            try {
              const r = await fetch(apiUrl(`/api/session/team-panes/${idx}/output`));
              if (!r.ok) return;
              const body = await r.json();
              if (!cancelled) outs[idx] = body.output || '';
            } catch {
              /* ignore */
            }
          })
        );
        if (!cancelled) setPaneOutputs((prev) => ({ ...prev, ...outs }));
      } catch {
        if (!cancelled) {
          setPollState({ teamActive: false, workers: 0, panes: [] });
        }
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [session, activeServer]);

  const teamState = stateEvents
    .filter((e) => e.type === 'team_state')
    .reduce((acc, e) => {
      if (e.data) return e.data;
      return acc;
    }, null);

  const legacyWorkers = buildWorkerList(teamState, workerEvents);

  const mergedPanes =
    pollState.panes.length > 0 ? pollState.panes : teamPanes?.panes?.length ? teamPanes.panes : [];

  const leadOutput = paneOutputs[0] ?? '';

  const pipelineFromState = extractPipelineState(stateEvents);
  const pipelineFromLead = extractPipelineFromLeadOutput(leadOutput);
  const pipelineState = mergePipeline(pipelineFromLead, pipelineFromState);

  const headerWorkerCount =
    session?.mode === 'team'
      ? Math.max(
          pollState.workers,
          teamPanes?.workers ?? 0,
          mergedPanes.length > 1 ? mergedPanes.length - 1 : 0,
          legacyWorkers.length
        )
      : legacyWorkers.length;

  const showPaneGrid = session && mergedPanes.length > 0;
  const showLegacyGrid = session && !showPaneGrid && legacyWorkers.length > 0;

  return (
    <div className="p-6 h-screen flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-purple-400" />
            Team monitor
          </h1>
          <p className="mt-0.5 text-[15px] text-[#5a7a70]">
            Tmux panes in the active session (lead + workers) and pipeline progress
          </p>
        </div>
        {session && (
          <div className="flex items-center gap-2 rounded-lg bg-purple-500/10 border border-purple-500/20 px-3 py-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
            <span className="text-[14px] font-medium text-purple-400">
              {session.mode} · {headerWorkerCount} workers
            </span>
          </div>
        )}
      </div>

      <div className="mb-6 rounded-xl border border-[#1a2e28] bg-[#0f1e1a] p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold text-white">Pipeline progress</h2>
          {pipelineState.currentStep && (
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[13px] text-emerald-400">
              {pipelineState.currentStep}
            </span>
          )}
        </div>
        <p className="text-[13px] text-[#5a7a70] mb-3">
          Stages inferred from lead pane output (team-plan, team-prd, team-exec, team-verify, team-fix) and OMC
          state files when present.
        </p>
        <PipelineProgress
          currentStep={pipelineState.currentStep}
          completedSteps={pipelineState.completedSteps}
          failedSteps={pipelineState.failedSteps}
        />
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        {showPaneGrid ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
            {mergedPanes.map((pane) => (
              <PanePanel
                key={pane.index}
                pane={pane}
                output={paneOutputs[pane.index] ?? ''}
                ansiUp={ansiUp}
              />
            ))}
          </div>
        ) : showLegacyGrid ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {legacyWorkers.map((worker) => (
              <WorkerPanel key={worker.id} worker={worker} now={now} />
            ))}
          </div>
        ) : (
          <div className="flex h-64 items-center justify-center">
            <div className="max-w-sm text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-[#1a3530] bg-[#12221e]">
                <Users className="h-12 w-12 text-[#6a8a80]" aria-hidden />
              </div>
              <p className="text-[15px] text-[#8aaa9f]">No team panes detected yet</p>
              <p className="mt-2 text-[14px] text-[#6a8a80]">
                Start a team session from Mission Control. When Claude Code splits the tmux window, panes appear
                here with live output.
              </p>
              <Link
                to="/launch"
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-[15px] font-medium text-white transition-colors hover:bg-emerald-500"
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

function PanePanel({ pane, output, ansiUp }) {
  const role = pane.role || (pane.index === 0 ? 'lead' : `worker-${pane.index}`);
  const html = useMemo(() => {
    if (!output) return '';
    return DOMPurify.sanitize(ansiUp.ansi_to_html(output));
  }, [ansiUp, output]);

  return (
    <div className="rounded-xl border border-[#1a2e28] bg-[#0f1e1a] flex flex-col min-h-[220px] max-h-[480px]">
      <div className="flex items-center justify-between gap-2 border-b border-[#1a2e28] px-3 py-2 bg-[#0d1816] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Monitor className="w-4 h-4 text-purple-400 shrink-0" />
          <div className="min-w-0">
            <div className="text-[14px] font-medium text-white truncate">
              Pane {pane.index} · {role}
            </div>
            <div className="text-[11px] text-[#5a7a70] font-mono truncate" title={pane.command || ''}>
              {pane.command || '—'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {pane.active ? (
            <span className="text-[11px] text-emerald-400/90">active</span>
          ) : (
            <span className="text-[11px] text-[#3a5a50]">idle</span>
          )}
          <span className="w-1.5 h-1.5 rounded-full bg-purple-400/80" />
        </div>
      </div>
      <div className="flex-1 overflow-auto p-3 font-mono text-[12px] leading-relaxed text-[#c8e0d4] bg-[#0a0f0d] whitespace-pre-wrap break-words">
        {html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <span className="text-[#2a4e40]">No output yet…</span>
        )}
      </div>
      <div className="text-[11px] text-[#2a4e40] px-3 py-1 border-t border-[#1a2e28] shrink-0 tabular-nums">
        pid {pane.pid != null ? pane.pid : '—'} · ~2s refresh
      </div>
    </div>
  );
}

function WorkerPanel({ worker, now }) {
  const statusColor = {
    running: 'bg-emerald-400',
    idle: 'bg-amber-400',
    completed: 'bg-blue-400',
    error: 'bg-red-400',
    stale: 'bg-amber-400',
  };

  const borderColor = {
    running: 'border-emerald-500/20',
    error: 'border-red-500/20',
    stale: 'border-amber-500/20',
  };

  const elapsed = worker.startedAt
    ? formatDuration(now - new Date(worker.startedAt).getTime())
    : null;

  return (
    <div
      className={`rounded-xl border bg-[#0f1e1a] p-5 transition-all ${
        borderColor[worker.status] || 'border-[#1a2e28]'
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
            <span className="text-[13px] font-bold text-purple-400">{worker.id}</span>
          </div>
          <div>
            <div className="text-[14px] font-medium text-white">
              {worker.name || `Worker ${worker.id}`}
            </div>
            <div className="text-[13px] text-[#5a7a70]">{worker.role || 'executor'}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${statusColor[worker.status] || 'bg-[#2a3e38]'} ${worker.status === 'running' ? 'animate-pulse' : ''}`}
          />
          <span className="text-[13px] capitalize text-[#5a7a70]">{worker.status}</span>
        </div>
      </div>

      {worker.task && (
        <div className="rounded-lg bg-[#0a1612] border border-[#162a25] p-2.5 mb-3">
          <p className="line-clamp-2 text-[13px] text-[#a0b8b0]">{worker.task}</p>
        </div>
      )}

      <div className="space-y-1.5 max-h-[120px] overflow-auto">
        {(worker.events || []).slice(-5).map((event, i) => (
          <div key={i} className="flex items-start gap-2">
            <EventIcon type={event.type} severity={event.severity} />
            <div className="flex-1 min-w-0">
              <p className="truncate text-[13px] text-[#8aaa9f]">{event.message}</p>
              {event.timestamp && (
                <span className="text-[12px] text-[#2a4e40]">
                  {new Date(event.timestamp).toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>
        ))}
        {(!worker.events || worker.events.length === 0) && (
          <p className="py-2 text-center text-[15px] text-[#6a8a80]">No events yet</p>
        )}
      </div>

      {elapsed && (
        <div className="mt-3 flex items-center gap-1 border-t border-[#162a25] pt-2 text-[13px] text-[#3a5a50]">
          <Clock className="w-3 h-3" />
          {elapsed}
        </div>
      )}
    </div>
  );
}

function EventIcon({ type, severity }) {
  if (severity === 'high' || type === 'error')
    return <AlertTriangle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />;
  if (severity === 'success' || type === 'completed')
    return <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />;
  if (type === 'keyword_detected')
    return <Zap className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />;
  return <Circle className="w-2.5 h-2.5 text-[#3a5a50] shrink-0 mt-0.5" />;
}

function buildWorkerList(teamState, workerEvents) {
  if (teamState?.workers) {
    return teamState.workers.map((w, i) => ({
      id: w.id || `W${i + 1}`,
      name: w.name || w.agentName || `Worker ${i + 1}`,
      role: w.role || w.subagentType || 'executor',
      status: w.status || 'running',
      task: w.task || w.currentTask || null,
      startedAt: w.startedAt || null,
      events: matchEventsToWorker(w, workerEvents),
    }));
  }

  const workerMap = new Map();
  for (const event of workerEvents) {
    if (event.type === 'team_panes_update') continue;
    const sess = event.session || 'unknown';
    if (!workerMap.has(sess)) {
      workerMap.set(sess, {
        id: `W${workerMap.size + 1}`,
        name: sess,
        role: 'executor',
        status: event.type === 'worker_stale' ? 'stale' : 'running',
        task: null,
        startedAt: event.timestamp,
        events: [],
      });
    }
    workerMap.get(sess).events.push(event);
  }

  return Array.from(workerMap.values());
}

function matchEventsToWorker(worker, workerEvents) {
  const name = worker.name || worker.id || '';
  return workerEvents.filter(
    (e) => e.type !== 'team_panes_update' && (e.session === name || e.session?.includes(name) || false)
  );
}

function extractPipelineFromLeadOutput(text) {
  const lower = (text || '').toLowerCase();
  const STEPS = [
    { keys: ['team-plan', 'team-prd'], step: 'plan' },
    { keys: ['team-exec'], step: 'exec' },
    { keys: ['team-verify'], step: 'verify' },
    { keys: ['team-fix'], step: 'fix' },
  ];
  const completedSteps = [];
  let currentStep = null;
  for (const { keys, step } of STEPS) {
    if (keys.some((k) => lower.includes(k))) {
      if (!completedSteps.includes(step)) completedSteps.push(step);
      currentStep = step;
    }
  }
  return { currentStep, completedSteps, failedSteps: [] };
}

function extractPipelineState(stateEvents) {
  const result = { currentStep: null, completedSteps: [], failedSteps: [] };

  for (const event of stateEvents) {
    if (event.type === 'session_state' && event.data) {
      const d = event.data;
      if (d.phase || d.currentPhase) {
        const phase = (d.phase || d.currentPhase || '').toLowerCase();
        if (phase.includes('plan')) result.currentStep = 'plan';
        else if (phase.includes('exec') || phase.includes('implement')) result.currentStep = 'exec';
        else if (phase.includes('verif') || phase.includes('qa') || phase.includes('test')) result.currentStep = 'verify';
        else if (phase.includes('fix') || phase.includes('correct')) result.currentStep = 'fix';
      }
      if (d.completedPhases) {
        result.completedSteps = d.completedPhases.map((p) => {
          const lp = p.toLowerCase();
          if (lp.includes('plan')) return 'plan';
          if (lp.includes('exec')) return 'exec';
          if (lp.includes('verif') || lp.includes('qa')) return 'verify';
          if (lp.includes('fix')) return 'fix';
          return p;
        });
      }
    }
  }

  return result;
}

function mergePipeline(fromLead, fromState) {
  const completed = [...new Set([...fromState.completedSteps, ...fromLead.completedSteps])];
  const failed = fromState.failedSteps?.length ? fromState.failedSteps : fromLead.failedSteps;
  return {
    currentStep: fromState.currentStep || fromLead.currentStep,
    completedSteps: completed,
    failedSteps: failed || [],
  };
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
