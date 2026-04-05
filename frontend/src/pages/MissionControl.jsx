import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Rocket, Play, Sparkles } from 'lucide-react';

const MODES = [
  { id: 'autopilot', label: 'Autopilot', desc: 'Full autonomous execution', dot: 'bg-emerald-500' },
  { id: 'ralph', label: 'Ralph', desc: 'Persist until verified complete', dot: 'bg-amber-500' },
  { id: 'ulw', label: 'Ultrawork', desc: 'Maximum parallelism', dot: 'bg-blue-500' },
  { id: 'team', label: 'Team', desc: 'Coordinated agent teams', dot: 'bg-purple-500' },
  { id: 'plan', label: 'Plan', desc: 'Strategic planning first', dot: 'bg-cyan-500' },
  { id: 'eco', label: 'Ecomode', desc: 'Token-efficient, 30-50% cheaper', dot: 'bg-green-500' },
];

export default function MissionControl() {
  const [searchParams] = useSearchParams();
  const [selectedMode, setSelectedMode] = useState(searchParams.get('mode') || 'autopilot');
  const [prompt, setPrompt] = useState('');
  const [teamWorkers, setTeamWorkers] = useState(3);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const mode = searchParams.get('mode');
    if (mode && MODES.find(m => m.id === mode)) {
      setSelectedMode(mode);
    }
  }, [searchParams]);

  const handleLaunch = async () => {
    if (!prompt.trim()) return;
    setLaunching(true);
    setError(null);

    try {
      const endpoint = selectedMode === 'team' ? '/api/session/team' : '/api/session/start';
      const body = selectedMode === 'team'
        ? { workers: teamWorkers, role: 'executor', prompt: prompt.trim() }
        : { mode: selectedMode, prompt: prompt.trim() };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to start session');
        setLaunching(false);
        return;
      }
      navigate('/monitor');
    } catch (err) {
      setError('Could not connect to server');
      setLaunching(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white flex items-center gap-2">
          <Rocket className="w-5 h-5 text-emerald-400" />
          Mission control
        </h1>
        <p className="text-[15px] text-[#5a7a70] mt-0.5">Configure and launch an OMC session</p>
      </div>

      {/* Prompt input */}
      <div className="rounded-xl border border-[#1a2e28] bg-[#0f1e1a] p-5 mb-4">
        <label className="text-[15px] text-[#8aaa9f] mb-2 block font-medium">What do you want to build?</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe your task... e.g., Build a REST API with authentication and tests"
          rows={4}
          className="w-full rounded-lg border border-[#1a3530] bg-[#0a1612] px-4 py-3 text-[15px] text-[#c8d6d0] placeholder-[#2a4e40] focus:outline-none focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/20 resize-none transition-all"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleLaunch();
          }}
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-[13px] text-[#2a4e40]">Ctrl+Enter to launch</span>
          <div className="flex items-center gap-1 text-[13px] text-[#3a5a50]">
            <Sparkles className="w-3 h-3" />
            AI-powered orchestration
          </div>
        </div>
      </div>

      {/* Mode selector */}
      <div className="rounded-xl border border-[#1a2e28] bg-[#0f1e1a] p-5 mb-4">
        <label className="text-[15px] text-[#8aaa9f] mb-3 block font-medium">Execution mode</label>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {MODES.map((mode) => (
            <button
              key={mode.id}
              onClick={() => setSelectedMode(mode.id)}
              className={`flex items-center gap-2.5 rounded-lg border p-3 text-left transition-all ${
                selectedMode === mode.id
                  ? 'border-emerald-500/30 bg-emerald-500/5 ring-1 ring-emerald-500/10'
                  : 'border-[#1a2e28] hover:border-[#2a4e40] hover:bg-[#12221e]'
              }`}
            >
              <div className={`w-2.5 h-2.5 rounded-full ${mode.dot} shrink-0 ${selectedMode === mode.id ? 'ring-2 ring-offset-1 ring-offset-[#0f1e1a]' : 'opacity-50'}`} />
              <div>
                <div className={`text-[15px] font-medium ${selectedMode === mode.id ? 'text-white' : 'text-[#8aaa9f]'}`}>
                  {mode.label}
                </div>
                <div className="text-[13px] text-[#4a6a60]">{mode.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Team config */}
      {selectedMode === 'team' && (
        <div className="rounded-xl border border-[#1a2e28] bg-[#0f1e1a] p-5 mb-4">
          <label className="text-[15px] text-[#8aaa9f] mb-3 block font-medium">
            Team size: <span className="text-purple-400">{teamWorkers} agents</span>
          </label>
          <input
            type="range"
            min="2"
            max="8"
            value={teamWorkers}
            onChange={(e) => setTeamWorkers(Number(e.target.value))}
            className="w-full accent-purple-500"
          />
          <div className="flex justify-between text-[13px] text-[#3a5a50] mt-1">
            <span>2</span><span>5</span><span>8</span>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-[14px] text-red-400">
          {error}
        </div>
      )}

      {/* Launch */}
      <button
        onClick={handleLaunch}
        disabled={!prompt.trim() || launching}
        className={`flex items-center gap-2 rounded-lg px-6 py-3 text-[15px] font-medium transition-all ${
          prompt.trim() && !launching
            ? 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-lg shadow-emerald-900/30 cursor-pointer'
            : 'bg-[#12221e] text-[#3a5a50] cursor-not-allowed'
        }`}
      >
        <Play className="w-4 h-4" />
        {launching ? 'Launching...' : 'Launch session'}
      </button>
    </div>
  );
}
