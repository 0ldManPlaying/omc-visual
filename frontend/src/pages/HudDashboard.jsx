import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Coins, Cpu, TrendingUp, Clock, Zap, Activity, Rocket } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useStore } from '../stores/useStore';

const CHART_COLORS = ['#10b981', '#3b82f6', '#a855f7', '#f59e0b', '#06b6d4', '#22c55e'];

export default function HudDashboard() {
  const { hudData } = useStore();
  const [aggregate, setAggregate] = useState(null);
  const [sessionHistory, setSessionHistory] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [mRes, sRes] = await Promise.all([
          fetch('/api/history/metrics'),
          fetch('/api/history/sessions?limit=50'),
        ]);
        const metrics = await mRes.json().catch(() => ({}));
        const sessBody = await sRes.json().catch(() => ({}));
        if (!cancelled) {
          setAggregate(metrics);
          setSessionHistory(Array.isArray(sessBody.sessions) ? sessBody.sessions : []);
        }
      } catch {
        if (!cancelled) {
          setAggregate(null);
          setSessionHistory([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Derive chart data from sessions
  const durationData = useMemo(() => {
    return sessionHistory
      .filter((s) => s?.duration_ms != null && s?.started_at)
      .slice(0, 20)
      .reverse()
      .map((s) => {
        const d = new Date(s.started_at);
        return {
          name: s.mode,
          duration: Math.round(s.duration_ms / 1000),
          date: Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(),
        };
      });
  }, [sessionHistory]);

  const modeDistribution = useMemo(() => {
    const counts = {};
    sessionHistory.forEach((s) => {
      counts[s.mode] = (counts[s.mode] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [sessionHistory]);

  // HUD live metrics from WebSocket (skip empty objects)
  const liveMetrics = hudData && typeof hudData === 'object' && !Array.isArray(hudData) ? hudData : {};
  const hasLiveHud = Object.keys(liveMetrics).length > 0;

  const totalSessions =
    typeof aggregate?.total_sessions === 'number'
      ? aggregate.total_sessions
      : Number(aggregate?.total_sessions) || 0;
  const hasHistoricalSessions = totalSessions > 0 || sessionHistory.length > 0;
  const showHudPageEmpty = !hasLiveHud && !hasHistoricalSessions;

  const stats = [
    {
      label: 'Total sessions',
      value: aggregate?.total_sessions ?? '—',
      icon: Activity,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
    },
    {
      label: 'Total duration',
      value: aggregate?.total_duration_ms ? formatDuration(aggregate.total_duration_ms) : '—',
      icon: Clock,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
    },
    {
      label: 'Avg duration',
      value: aggregate?.avg_duration_ms ? formatDuration(Math.round(aggregate.avg_duration_ms)) : '—',
      icon: TrendingUp,
      color: 'text-purple-400',
      bg: 'bg-purple-500/10',
    },
    {
      label: 'Total tokens',
      value: formatNumber((aggregate?.total_tokens_in || 0) + (aggregate?.total_tokens_out || 0)),
      icon: Cpu,
      color: 'text-cyan-400',
      bg: 'bg-cyan-500/10',
    },
    {
      label: 'Total cost',
      value: aggregate?.total_cost_usd != null ? `$${aggregate.total_cost_usd.toFixed(2)}` : '$0.00',
      icon: Coins,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
    },
    {
      label: 'Completed',
      value: aggregate?.completed ?? '—',
      icon: Zap,
      color: 'text-green-400',
      bg: 'bg-green-500/10',
    },
  ];

  return (
    <div className="p-6 overflow-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-white">
            <BarChart3 className="h-5 w-5 text-amber-400" />
            HUD metrics
          </h1>
          <p className="mt-0.5 text-[15px] text-[#5a7a70]">Token usage, costs, and session analytics</p>
        </div>
      </div>

      {showHudPageEmpty ? (
        <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-[#1a2e28] bg-[#0f1e1a] p-8">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-[#1a3530] bg-[#12221e]">
            <BarChart3 className="h-12 w-12 text-[#6a8a80]" aria-hidden />
          </div>
          <p className="max-w-md text-center text-[15px] text-[#8aaa9f]">No HUD data available yet</p>
          <p className="mt-2 max-w-md text-center text-[14px] text-[#6a8a80]">
            Start a session to see token usage and cost metrics
          </p>
          <Link
            to="/launch"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-[15px] font-medium text-white transition-colors hover:bg-emerald-500"
          >
            <Rocket className="h-4 w-4" aria-hidden />
            Go to Mission Control
          </Link>
        </div>
      ) : (
        <>
      {/* Live HUD metrics from WebSocket */}
      {hasLiveHud && (
        <div className="mb-6 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
          <h2 className="mb-3 flex items-center gap-2 text-[16px] font-semibold text-emerald-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            Live HUD
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Object.entries(liveMetrics).map(([key, value]) => (
              <div key={key} className="rounded-lg border border-[#1a2e28] bg-[#0f1e1a] p-3">
                <div className="mb-0.5 text-[13px] text-[#3a5a50]">{formatKey(key)}</div>
                <div className="font-mono text-[13px] text-[#c8d6d0]">{formatValue(value)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="rounded-xl border border-[#1a2e28] bg-[#0f1e1a] p-5">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-7 h-7 rounded-lg ${stat.bg} flex items-center justify-center`}>
                  <Icon className={`w-3.5 h-3.5 ${stat.color}`} />
                </div>
              </div>
              <div className="mb-0.5 text-[13px] text-[#5a7a70]">{stat.label}</div>
              <div className="text-lg font-bold text-white">{stat.value}</div>
            </div>
          );
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Session duration chart */}
        <div className="rounded-xl border border-[#1a2e28] bg-[#0f1e1a] p-5">
          <h2 className="mb-4 text-[16px] font-semibold text-white">Session duration (seconds)</h2>
          {durationData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={durationData}>
                <XAxis dataKey="date" tick={{ fill: '#3a5a50', fontSize: 12 }} axisLine={{ stroke: '#1a2e28' }} tickLine={false} />
                <YAxis tick={{ fill: '#3a5a50', fontSize: 12 }} axisLine={{ stroke: '#1a2e28' }} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f1e1a', border: '1px solid #1a2e28', borderRadius: 8, fontSize: 13 }}
                  labelStyle={{ color: '#5a7a70' }}
                  itemStyle={{ color: '#c8d6d0' }}
                />
                <Bar dataKey="duration" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmptyState message="No session duration data yet — complete a session to see bars here." />
          )}
        </div>

        {/* Mode distribution */}
        <div className="rounded-xl border border-[#1a2e28] bg-[#0f1e1a] p-5">
          <h2 className="mb-4 text-[16px] font-semibold text-white">Mode distribution</h2>
          {modeDistribution.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={220}>
                <PieChart>
                  <Pie data={modeDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={40}>
                    {modeDistribution.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f1e1a', border: '1px solid #1a2e28', borderRadius: 8, fontSize: 13 }}
                    labelStyle={{ color: '#5a7a70' }}
                    itemStyle={{ color: '#c8d6d0' }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2">
                {modeDistribution.map((item, i) => (
                  <div key={item.name} className="flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                    <span className="flex-1 text-[13px] text-[#8aaa9f]">{item.name}</span>
                    <span className="font-mono text-[13px] text-[#5a7a70]">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <ChartEmptyState message="No modes recorded yet — session mix will appear after you run different modes." />
          )}
        </div>
      </div>
        </>
      )}
    </div>
  );
}

function ChartEmptyState({ message }) {
  return (
    <div className="flex h-[220px] flex-col items-center justify-center px-4">
      <BarChart3 className="mb-3 h-12 w-12 text-[#6a8a80]" aria-hidden />
      <p className="max-w-xs text-center text-[15px] text-[#8aaa9f]">{message}</p>
    </div>
  );
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function formatNumber(n) {
  if (n == null || n === 0) return '0';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function formatKey(key) {
  return key.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(value) {
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
