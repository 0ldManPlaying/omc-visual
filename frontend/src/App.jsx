import { useEffect } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Rocket,
  Monitor,
  Users,
  ChevronDown,
  Clock,
  BarChart3,
  History,
  Settings as SettingsIcon,
  Package,
} from 'lucide-react';
import { useStore } from './stores/useStore';
import Dashboard from './pages/Dashboard';
import MissionControl from './pages/MissionControl';
import LiveMonitor from './pages/LiveMonitor';
import AgentRoster from './pages/AgentRoster';
import TeamMonitor from './pages/TeamMonitor';
import EventTimeline from './pages/EventTimeline';
import SessionHistory from './pages/SessionHistory';
import HudDashboard from './pages/HudDashboard';
import Settings from './pages/Settings';
import ToolLibrary from './pages/ToolLibrary';

export default function App() {
  const { connect, connected, fetchStatus, serverStatus } = useStore();

  useEffect(() => {
    connect();
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Home' },
    { to: '/launch', icon: Rocket, label: 'Mission control' },
    { to: '/monitor', icon: Monitor, label: 'Live monitor' },
    { to: '/team', icon: Users, label: 'Team monitor' },
    { to: '/timeline', icon: Clock, label: 'Event timeline' },
    { to: '/agents', icon: Users, label: 'Agents' },
    { to: '/tools', icon: Package, label: 'Tool library' },
    { to: '/history', icon: History, label: 'Session history' },
    { to: '/metrics', icon: BarChart3, label: 'HUD metrics' },
    { to: '/settings', icon: SettingsIcon, label: 'Settings' },
  ];

  const omcVersion = serverStatus?.omc?.version || '—';

  return (
    <div className="min-h-screen bg-[#0a1210] text-[#c8d6d0] flex font-[system-ui,sans-serif]">
      {/* Sidebar */}
      <nav className="relative w-[220px] border-r border-[#1a2e28] flex flex-col bg-[#0d1816] shrink-0 overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-[0.15]"
          style={{ backgroundImage: "url('/bgimage.png')" }}
        />
        <div className="relative z-10 flex min-h-0 flex-1 flex-col">
          <div className="p-5 pb-4 flex justify-center">
            <NavLink
              to="/"
              end
              className="flex justify-center max-w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1816]"
            >
              <img
                src="/logo.png"
                alt="OMG Tasks"
                className="h-[89.44px] w-auto max-w-full object-contain object-center"
              />
            </NavLink>
          </div>

          <div className="mx-3 mb-4">
            <button className="w-full flex items-center justify-between rounded-lg bg-[#12221e] border border-[#1a3530] px-3 py-2.5 text-[15px] hover:bg-[#162a25] transition-colors">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-emerald-600 flex items-center justify-center text-[10px] font-bold text-white">AI</div>
                <span className="text-[15px] text-[#a0b8b0] font-medium">AiLab Server</span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-[#5a7a70]" />
            </button>
          </div>

          <div className="flex-1 px-2">
            {navItems.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-lg text-[15px] mb-0.5 transition-all ${
                    isActive
                      ? 'bg-emerald-500/10 text-emerald-400 font-medium'
                      : 'text-[#7a9a90] hover:text-[#a0c0b5] hover:bg-[#12221e]'
                  }`
                }
              >
                <Icon className="w-[18px] h-[18px]" />
                {label}
              </NavLink>
            ))}
          </div>

          <div className="p-4 border-t border-[#1a2e28]">
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
              <span className="text-[13px] text-[#5a7a70]">{connected ? 'Connected' : 'Disconnected'}</span>
            </div>
            <div className="text-[13px] text-[#3a5a50] space-y-0.5">
              <div>OMC Visual v0.1.0</div>
              <div>oh-my-claudecode {omcVersion}</div>
            </div>
          </div>
        </div>
      </nav>

      <main className="relative flex-1 overflow-auto bg-[#0c1614]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-[0.025]"
          style={{ backgroundImage: "url('/achtergrondmain.jpg')" }}
        />
        <div className="relative z-10 min-h-full">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/launch" element={<MissionControl />} />
            <Route path="/monitor" element={<LiveMonitor />} />
            <Route path="/team" element={<TeamMonitor />} />
            <Route path="/timeline" element={<EventTimeline />} />
            <Route path="/agents" element={<AgentRoster />} />
            <Route path="/tools" element={<ToolLibrary />} />
            <Route path="/history" element={<SessionHistory />} />
            <Route path="/metrics" element={<HudDashboard />} />
            <Route path="/hud" element={<HudDashboard />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
