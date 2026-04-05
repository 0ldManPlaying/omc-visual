import { useStore } from '../stores/useStore';
import { useState } from 'react';
import { Bot, Cpu, Activity, Clock, Zap, ArrowUp, ArrowDown, Minus, Eye, Server, GitCommit, MessageSquare, Rocket, Download, Play, Pause, Square, Check, AlertCircle, Loader } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Dashboard() {
  const {
    serverStatus, connected, session, workerEvents, stateEvents,
    clawhipInstall, installClawhip, startClawhipDaemon, stopClawhipDaemon, scaffoldClawhipConfig,
  } = useStore();
  const navigate = useNavigate();
  const omc = serverStatus?.omc;
  const clawhip = serverStatus?.clawhip;

  const stats = [
    {
      label: 'Active agents',
      value: session ? '32' : '0',
      trend: session ? 'up' : 'neutral',
      trendValue: session ? 'Running' : 'Idle',
    },
    {
      label: 'Sessions today',
      value: '1',
      trend: 'up',
      trendValue: '+1',
    },
    {
      label: 'Exec mode',
      value: omc?.config?.defaultExecMode || 'ultrawork',
      trend: 'neutral',
      trendValue: 'Default',
    },
    {
      label: 'Server uptime',
      value: serverStatus ? formatUptime(serverStatus.server?.uptime) : '—',
      trend: connected ? 'up' : 'down',
      trendValue: connected ? 'Online' : 'Offline',
    },
  ];

  const recentEvents = [...workerEvents, ...stateEvents]
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
    .slice(0, 8);

  // Clawhip action handlers
  const handleInstallClawhip = async () => {
    await installClawhip();
  };

  const handleStartDaemon = async () => {
    await scaffoldClawhipConfig();
    await startClawhipDaemon();
  };

  const handleStopDaemon = async () => {
    await stopClawhipDaemon();
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white">Home</h1>
          <p className="text-[15px] text-[#5a7a70] mt-0.5">Monitor your agents and orchestration</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/launch')}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-[15px] font-medium text-white transition-colors"
          >
            <Zap className="w-4 h-4" />
            New session
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-[#1a2e28] bg-[#0f1e1a] p-5">
            <div className="text-[14px] text-[#5a7a70] mb-1">{stat.label}</div>
            <div className="flex items-end justify-between">
              <span className="text-2xl font-bold text-white">{stat.value}</span>
              <div className="flex items-center gap-1">
                {stat.trend === 'up' && <ArrowUp className="w-3 h-3 text-emerald-400" />}
                {stat.trend === 'down' && <ArrowDown className="w-3 h-3 text-red-400" />}
                {stat.trend === 'neutral' && <Minus className="w-3 h-3 text-[#5a7a70]" />}
                <span className={`text-[13px] ${
                  stat.trend === 'up' ? 'text-emerald-400' : stat.trend === 'down' ? 'text-red-400' : 'text-[#5a7a70]'
                }`}>
                  {stat.trendValue}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Current session - 2 col span */}
        <div className="lg:col-span-2 rounded-xl border border-[#1a2e28] bg-[#0f1e1a] p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[16px] font-semibold text-white">Current session</h2>
            {session && (
              <button
                onClick={() => navigate('/monitor')}
                className="flex items-center gap-1 text-[14px] text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                <Eye className="w-3.5 h-3.5" />
                View live
              </button>
            )}
          </div>

          {session ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <Activity className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-medium text-white">{session.mode}</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  </div>
                  <p className="text-[14px] text-[#5a7a70] font-mono">{session.id}</p>
                </div>
              </div>
              <div className="rounded-lg bg-[#0a1612] border border-[#162a25] p-3">
                <p className="text-[14px] text-[#a0b8b0]">{session.prompt}</p>
              </div>
              <div className="flex items-center gap-1 text-[13px] text-[#3a5a50]">
                <Clock className="w-3 h-3" />
                Started: {new Date(session.startedAt).toLocaleTimeString()}
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="w-12 h-12 rounded-xl bg-[#12221e] border border-[#1a3530] flex items-center justify-center mx-auto mb-3">
                <Rocket className="w-6 h-6 text-[#3a5a50]" />
              </div>
              <p className="text-[15px] text-[#5a7a70] mb-3">No active session</p>
              <button
                onClick={() => navigate('/launch')}
                className="text-[14px] text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                Start a new session →
              </button>
            </div>
          )}
        </div>

        {/* Quick launch */}
        <div className="rounded-xl border border-[#1a2e28] bg-[#0f1e1a] p-5">
          <h2 className="text-[16px] font-semibold text-white mb-4">Quick launch</h2>
          <div className="space-y-2">
            {[
              { mode: 'autopilot', label: 'Autopilot', desc: 'Full autonomous', color: 'bg-emerald-500', textColor: 'text-emerald-400' },
              { mode: 'ralph', label: 'Ralph', desc: 'Persist until done', color: 'bg-amber-500', textColor: 'text-amber-400' },
              { mode: 'ulw', label: 'Ultrawork', desc: 'Max parallel', color: 'bg-blue-500', textColor: 'text-blue-400' },
              { mode: 'team', label: 'Team', desc: 'Coordinated agents', color: 'bg-purple-500', textColor: 'text-purple-400' },
            ].map(({ mode, label, desc, color, textColor }) => (
              <button
                key={mode}
                onClick={() => navigate(`/launch?mode=${mode}`)}
                className="w-full flex items-center gap-3 rounded-lg border border-[#1a2e28] hover:border-[#2a4e40] bg-[#0a1612] hover:bg-[#12221e] p-3 transition-all text-left group"
              >
                <div className={`w-2 h-2 rounded-full ${color}`} />
                <div className="flex-1">
                  <div className={`text-[15px] font-medium ${textColor} group-hover:brightness-125`}>{label}</div>
                  <div className="text-[13px] text-[#4a6a60]">{desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        {/* System status */}
        <div className="rounded-xl border border-[#1a2e28] bg-[#0f1e1a] p-5">
          <h2 className="text-[16px] font-semibold text-white mb-4">System</h2>
          <div className="space-y-3">
            <SystemRow
              icon={Server}
              label="Node.js server"
              value={serverStatus?.server?.nodeVersion || '—'}
              status={connected}
            />
            <SystemRow
              icon={Bot}
              label="oh-my-claudecode"
              value={omc?.version || 'Not found'}
              status={omc?.installed}
            />
            <SystemRow
              icon={Cpu}
              label="Claude Code CLI"
              value={omc?.claudeVersion || 'Not found'}
              status={!!omc?.claudeVersion}
            />

            {/* Clawhip row with actions */}
            <ClawhipRow
              clawhip={clawhip}
              clawhipInstall={clawhipInstall}
              onInstall={handleInstallClawhip}
              onStart={handleStartDaemon}
              onStop={handleStopDaemon}
            />
          </div>
        </div>

        {/* Event feed */}
        <div className="rounded-xl border border-[#1a2e28] bg-[#0f1e1a] p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[16px] font-semibold text-white">Event feed</h2>
            <span className="text-[13px] text-[#3a5a50]">{recentEvents.length} events</span>
          </div>

          {recentEvents.length > 0 ? (
            <div className="space-y-2">
              {recentEvents.map((event, i) => (
                <div key={i} className="flex items-start gap-2.5 py-1.5">
                  <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${
                    event.severity === 'high' ? 'bg-red-500/10' :
                    event.severity === 'success' ? 'bg-emerald-500/10' :
                    'bg-[#12221e]'
                  }`}>
                    {event.type?.includes('git') ? (
                      <GitCommit className="w-3.5 h-3.5 text-[#5a7a70]" />
                    ) : (
                      <MessageSquare className="w-3.5 h-3.5 text-[#5a7a70]" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] text-[#a0b8b0] truncate">
                      {event.type === 'clawhip_feed' ? 'Clawhip' : event.type}
                    </div>
                    <div className="text-[13px] text-[#3a5a50] truncate">
                      {event.summary || event.message || event.context || '—'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6">
              <p className="text-[14px] text-[#3a5a50]">Events will appear here during sessions</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Clawhip system row with inline daemon controls */
function ClawhipRow({ clawhip, clawhipInstall, onInstall, onStart, onStop }) {
  const [daemonBusy, setDaemonBusy] = useState(false);
  const isInstalled = clawhip?.installed || clawhipInstall?.status === 'complete';
  const isRunning = clawhip?.daemonRunning;
  const isInstalling = clawhipInstall?.installing;

  const runStart = async () => {
    setDaemonBusy(true);
    try {
      await onStart();
    } finally {
      setDaemonBusy(false);
    }
  };

  const runStop = async () => {
    setDaemonBusy(true);
    try {
      await onStop();
    } finally {
      setDaemonBusy(false);
    }
  };

  return (
    <div className="py-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <Zap className="w-4 h-4 text-[#4a6a60] shrink-0" />
          <span className="text-[15px] text-[#8aaa9f]">Clawhip daemon</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[14px] text-[#a0b8b0] font-mono truncate max-w-[140px] sm:max-w-[200px]">
            {isInstalling ? 'Installing...' : isInstalled ? (clawhip?.version || clawhipInstall?.version || 'Installed') : 'Not installed'}
          </span>
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              isRunning ? 'bg-emerald-400' : isInstalled ? 'bg-amber-400' : 'bg-[#2a3e38]'
            }`}
          />
          {isInstalled && !isInstalling && (
            <div className="flex items-center gap-1">
              {!isRunning && (
                <button
                  type="button"
                  title="Start daemon"
                  onClick={runStart}
                  disabled={daemonBusy}
                  className="w-5 h-5 flex items-center justify-center rounded hover:bg-[#1a2e28] transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Play className="w-[14px] h-[14px] text-emerald-400" strokeWidth={2} />
                </button>
              )}
              {isRunning && (
                <>
                  <button
                    type="button"
                    title="Pause daemon"
                    onClick={runStop}
                    disabled={daemonBusy}
                    className="w-5 h-5 flex items-center justify-center rounded hover:bg-[#1a2e28] transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <Pause className="w-[14px] h-[14px] text-amber-400" strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    title="Stop daemon"
                    onClick={runStop}
                    disabled={daemonBusy}
                    className="w-5 h-5 flex items-center justify-center rounded hover:bg-[#1a2e28] transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <Square className="w-[14px] h-[14px] text-red-400" strokeWidth={2} />
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Install progress bar */}
      {isInstalling && (
        <div className="mt-2.5 ml-[26px]">
          <div className="flex items-center gap-2 mb-1.5">
            <Loader className="w-3 h-3 text-emerald-400 animate-spin" />
            <span className="text-[13px] text-emerald-400">{clawhipInstall.message}</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-[#12221e] overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500 ease-out"
              style={{ width: `${clawhipInstall.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Install error */}
      {clawhipInstall?.status === 'error' && (
        <div className="mt-2 ml-[26px] flex items-center gap-1.5 text-[13px] text-red-400">
          <AlertCircle className="w-3 h-3 shrink-0" />
          {clawhipInstall.message}
        </div>
      )}

      {/* Install success */}
      {clawhipInstall?.status === 'complete' && !clawhip?.installed && (
        <div className="mt-2 ml-[26px] flex items-center gap-1.5 text-[13px] text-emerald-400">
          <Check className="w-3 h-3 shrink-0" />
          {clawhipInstall.message}
        </div>
      )}

      {!isInstalled && !isInstalling && (
        <div className="mt-2 ml-[26px]">
          <button
            type="button"
            onClick={onInstall}
            className="flex items-center gap-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 px-2.5 py-1 text-[13px] text-emerald-400 font-medium transition-colors"
          >
            <Download className="w-3 h-3" />
            Install Clawhip
          </button>
        </div>
      )}
    </div>
  );
}

function SystemRow({ icon: Icon, label, value, status, optional }) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-2.5">
        <Icon className="w-4 h-4 text-[#4a6a60]" />
        <span className="text-[15px] text-[#8aaa9f]">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[14px] text-[#a0b8b0] font-mono">{value}</span>
        <span className={`w-1.5 h-1.5 rounded-full ${
          status ? 'bg-emerald-400' : optional ? 'bg-[#2a3e38]' : 'bg-red-400'
        }`} />
      </div>
    </div>
  );
}

function formatUptime(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
