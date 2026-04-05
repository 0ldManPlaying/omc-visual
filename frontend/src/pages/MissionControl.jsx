import { useState, useEffect, useRef, useCallback } from 'react';
import { apiUrl, useStore } from '../stores/useStore';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Rocket,
  Play,
  Sparkles,
  FolderOpen,
  Paperclip,
  ChevronDown,
  X,
  AlertTriangle,
} from 'lucide-react';

const MODES = [
  { id: 'autopilot', label: 'Autopilot', desc: 'Full autonomous execution', dot: 'bg-emerald-500' },
  { id: 'ralph', label: 'Ralph', desc: 'Persist until verified complete', dot: 'bg-amber-500' },
  { id: 'ulw', label: 'Ultrawork', desc: 'Maximum parallelism', dot: 'bg-blue-500' },
  { id: 'team', label: 'Team', desc: 'Coordinated agent teams', dot: 'bg-purple-500' },
  { id: 'plan', label: 'Plan', desc: 'Strategic planning first', dot: 'bg-cyan-500' },
  { id: 'eco', label: 'Ecomode', desc: 'Token-efficient, 30-50% cheaper', dot: 'bg-green-500' },
];

const PROMPT_TEMPLATES = [
  'Build a REST API with...',
  'Refactor and add tests for...',
  'Fix bugs in...',
  'Create documentation for...',
];

const MODEL_TIERS = [
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
];

function joinWorkdirAndFileName(workdir, fileName) {
  const base = (workdir || '~').trim().replace(/\/+$/, '') || '~';
  const name = fileName.replace(/^\/+/, '');
  if (base === '~') return `~/${name}`;
  return `${base}/${name}`.replace(/\/+/g, '/');
}

export default function MissionControl() {
  const activeServer = useStore((s) => s.activeServer);
  const [searchParams] = useSearchParams();
  const [selectedMode, setSelectedMode] = useState(searchParams.get('mode') || 'autopilot');
  const [prompt, setPrompt] = useState('');
  const [workdir, setWorkdir] = useState('~');
  const [contextFiles, setContextFiles] = useState([]);
  const [pathDraft, setPathDraft] = useState('');
  const [teamWorkers, setTeamWorkers] = useState(3);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState(null);
  const [sessionConflict, setSessionConflict] = useState(null);
  const [recentPrompts, setRecentPrompts] = useState([]);
  const [dragOver, setDragOver] = useState(false);

  const [modelTier, setModelTier] = useState('sonnet');
  const [maxTokens, setMaxTokens] = useState(8192);
  const [clawhipMonitoring, setClawhipMonitoring] = useState(true);
  const [keywords, setKeywords] = useState('error,complete,failed,success');
  const [staleMinutes, setStaleMinutes] = useState(5);

  const fileInputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const mode = searchParams.get('mode');
    if (mode && MODES.find((m) => m.id === mode)) {
      setSelectedMode(mode);
    }
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl('/api/status/'));
        const data = await res.json();
        if (cancelled || !data?.paths) return;
        const { suggestedWorkdir, homeDir } = data.paths;
        if (suggestedWorkdir) {
          setWorkdir(suggestedWorkdir);
        } else if (homeDir) {
          setWorkdir('~');
        }
      } catch {
        /* keep default */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeServer]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl('/api/history/recent-prompts?limit=5'));
        const data = await res.json();
        if (cancelled || !data?.prompts) return;
        setRecentPrompts(data.prompts);
      } catch {
        setRecentPrompts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeServer]);

  const addContextPath = useCallback((raw) => {
    const p = String(raw).trim();
    if (!p) return;
    setContextFiles((prev) => (prev.includes(p) ? prev : [...prev, p]));
  }, []);

  const removeContextPath = useCallback((p) => {
    setContextFiles((prev) => prev.filter((x) => x !== p));
  }, []);

  const handlePathSubmit = (e) => {
    e?.preventDefault();
    addContextPath(pathDraft);
    setPathDraft('');
  };

  const handleFileInputChange = (e) => {
    const { files } = e.target;
    if (!files?.length) return;
    Array.from(files).forEach((f) => {
      addContextPath(joinWorkdirAndFileName(workdir, f.name));
    });
    e.target.value = '';
  };

  const onDropFiles = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const { files } = e.dataTransfer;
    if (files?.length) {
      Array.from(files).forEach((f) => {
        addContextPath(joinWorkdirAndFileName(workdir, f.name));
      });
      return;
    }
    const text = e.dataTransfer.getData('text/plain')?.trim();
    if (text) addContextPath(text);
  };

  const buildOptions = () => ({
    model: modelTier,
    maxTokens: Number(maxTokens) || 8192,
    keywords: keywords.trim() || 'error,complete,failed,success',
    staleMinutes: Number(staleMinutes) || 5,
    clawhipMonitoring,
  });

  const performLaunch = async (force = false) => {
    if (!prompt.trim()) return;
    setLaunching(true);
    setError(null);
    setSessionConflict(null);

    const wd = workdir.trim() || '~';
    const options = buildOptions();

    try {
      const endpoint =
        selectedMode === 'team' ? apiUrl('/api/session/team') : apiUrl('/api/session/start');
      const body =
        selectedMode === 'team'
          ? {
              workers: teamWorkers,
              role: 'executor',
              prompt: prompt.trim(),
              workdir: wd,
              files: contextFiles,
              options,
              force,
            }
          : {
              mode: selectedMode,
              prompt: prompt.trim(),
              workdir: wd,
              files: contextFiles,
              options,
              force,
            };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === 'session_active') {
          setSessionConflict({
            sessionId: data.sessionId,
            message: data.message || 'Er draait al een sessie',
          });
          setLaunching(false);
          return;
        }
        setError(
          typeof data.error === 'string' ? data.error : data.message || 'Failed to start session'
        );
        setLaunching(false);
        return;
      }
      navigate('/monitor');
    } catch {
      setError('Could not connect to server');
    } finally {
      setLaunching(false);
    }
  };

  const handleLaunch = () => void performLaunch(false);

  const handleForceLaunch = () => void performLaunch(true);

  return (
    <div className="p-6 max-w-4xl relative">
      {sessionConflict && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="session-conflict-title"
        >
          <div className="w-full max-w-md rounded-xl border border-amber-500/25 bg-[#0f1e1a] p-5 shadow-xl shadow-black/40">
            <div className="flex items-start gap-3">
              <div className="shrink-0 rounded-lg bg-amber-500/15 p-2">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="session-conflict-title" className="text-[16px] font-semibold text-white">
                  Sessie actief
                </h2>
                <p className="mt-2 text-[14px] text-[#8aaa9f] leading-relaxed">
                  {sessionConflict.message}. Wil je de actieve sessie stoppen en een nieuwe starten?
                </p>
                {sessionConflict.sessionId && (
                  <p className="mt-2 text-[12px] font-mono text-[#3a5a50] truncate">
                    {sessionConflict.sessionId}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSessionConflict(null)}
                className="shrink-0 rounded-lg p-1 text-[#5a7a70] hover:bg-[#1a2e28] hover:text-white"
                aria-label="Sluiten"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mt-5 flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                onClick={() => setSessionConflict(null)}
                className="rounded-lg border border-[#1a3530] px-4 py-2 text-[14px] text-[#9abaae] hover:bg-[#12221e]"
              >
                Annuleren
              </button>
              <button
                type="button"
                onClick={handleForceLaunch}
                disabled={launching}
                className="rounded-lg bg-amber-600 px-4 py-2 text-[14px] font-medium text-white hover:bg-amber-500 disabled:opacity-50"
              >
                {launching ? 'Starten…' : 'Force launch'}
              </button>
            </div>
          </div>
        </div>
      )}

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

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <div className="text-[13px] font-medium text-[#8aaa9f] mb-2">Recent prompts</div>
            <div className="flex flex-wrap gap-1.5 min-h-[1.75rem]">
              {recentPrompts.length === 0 ? (
                <span className="text-[13px] text-[#3a5a50]">No history yet</span>
              ) : (
                recentPrompts.map((p) => (
                  <button
                    key={p}
                    type="button"
                    title={p}
                    onClick={() => setPrompt(p)}
                    className="max-w-full truncate rounded-md border border-[#1a3530] bg-[#0a1612] px-2.5 py-1 text-left text-[12px] text-[#9abaae] hover:border-emerald-500/25 hover:bg-[#12221e] transition-colors"
                  >
                    {p.length > 44 ? `${p.slice(0, 41)}…` : p}
                  </button>
                ))
              )}
            </div>
          </div>
          <div>
            <div className="text-[13px] font-medium text-[#8aaa9f] mb-2">Templates</div>
            <div className="flex flex-wrap gap-1.5">
              {PROMPT_TEMPLATES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setPrompt(t)}
                  className="rounded-md border border-[#1a3530] bg-[#0a1612] px-2.5 py-1 text-[12px] text-[#9abaae] hover:border-emerald-500/25 hover:bg-[#12221e] transition-colors"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mt-3">
          <span className="text-[13px] text-[#2a4e40]">Ctrl+Enter to launch</span>
          <div className="flex items-center gap-1 text-[13px] text-[#3a5a50]">
            <Sparkles className="w-3 h-3" />
            AI-powered orchestration
          </div>
        </div>
      </div>

      {/* Working directory */}
      <div className="rounded-xl border border-[#1a2e28] bg-[#0f1e1a] p-5 mb-4">
        <label
          htmlFor="mc-workdir"
          className="text-[15px] text-[#8aaa9f] mb-2 block font-medium"
        >
          Where should the agents work?
        </label>
        <div className="relative">
          <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4a6a60] pointer-events-none" />
          <input
            id="mc-workdir"
            type="text"
            value={workdir}
            onChange={(e) => setWorkdir(e.target.value)}
            placeholder="~"
            className="w-full rounded-lg border border-[#1a3530] bg-[#0a1612] pl-10 pr-4 py-2.5 text-[14px] text-[#c8d6d0] placeholder-[#2a4e40] focus:outline-none focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/20"
          />
        </div>
        <p className="text-[12px] text-[#3a5a50] mt-1.5">
          Use <code className="text-[#5a7a70]">~</code> for your home directory. Context file paths are combined with this folder when you pick files by name.
        </p>
      </div>

      {/* Attach context files */}
      <div className="rounded-xl border border-[#1a2e28] bg-[#0f1e1a] p-5 mb-4">
        <div className="flex items-center gap-2 text-[15px] text-[#8aaa9f] font-medium mb-3">
          <Paperclip className="w-4 h-4 text-[#5a8a78]" />
          Attach context files
        </div>
        <p className="text-[13px] text-[#4a6a60] mb-3">
          Paths are sent to the server (absolute or <code className="text-[#5a7a70]">~/…</code>). Drag files here or browse — file names are joined with the working directory above; adjust the path if needed.
        </p>
        <div
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragOver(false);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDropFiles}
          className={`rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
            dragOver
              ? 'border-emerald-500/40 bg-emerald-500/5'
              : 'border-[#2a4e40] bg-[#0a1612]/50'
          }`}
        >
          <p className="text-[14px] text-[#8aaa9f] mb-3">Drop files here or</p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg border border-[#2a5a48] bg-[#12221e] px-4 py-2 text-[14px] text-emerald-300/90 hover:bg-[#1a322c] transition-colors"
          >
            Browse files
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
          />
        </div>
        <form onSubmit={handlePathSubmit} className="flex gap-2 mt-3">
          <input
            type="text"
            value={pathDraft}
            onChange={(e) => setPathDraft(e.target.value)}
            placeholder="/absolute/path/to/file or ~/project/notes.md"
            className="flex-1 rounded-lg border border-[#1a3530] bg-[#0a1612] px-3 py-2 text-[13px] text-[#c8d6d0] placeholder-[#2a4e40] focus:outline-none focus:border-emerald-500/40"
          />
          <button
            type="submit"
            className="rounded-lg border border-[#2a5a48] px-3 py-2 text-[13px] text-[#9abaae] hover:bg-[#12221e]"
          >
            Add path
          </button>
        </form>
        {contextFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {contextFiles.map((p) => (
              <span
                key={p}
                className="inline-flex items-center gap-1 max-w-full rounded-md border border-[#1a3530] bg-[#0a1612] pl-2.5 pr-1 py-1 text-[12px] text-[#b0ccc0]"
              >
                <span className="truncate" title={p}>
                  {p}
                </span>
                <button
                  type="button"
                  onClick={() => removeContextPath(p)}
                  className="p-0.5 rounded hover:bg-[#1a2e28] text-[#6a8a80] hover:text-white shrink-0"
                  aria-label={`Remove ${p}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
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
              <div
                className={`w-2.5 h-2.5 rounded-full ${mode.dot} shrink-0 ${selectedMode === mode.id ? 'ring-2 ring-offset-1 ring-offset-[#0f1e1a]' : 'opacity-50'}`}
              />
              <div>
                <div
                  className={`text-[15px] font-medium ${selectedMode === mode.id ? 'text-white' : 'text-[#8aaa9f]'}`}
                >
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
            <span>2</span>
            <span>5</span>
            <span>8</span>
          </div>
        </div>
      )}

      {/* Advanced options */}
      <details className="rounded-xl border border-[#1a2e28] bg-[#0f1e1a] mb-4 group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-5 text-[15px] font-medium text-[#8aaa9f] hover:text-[#b0ccc0]">
          <span>Advanced options</span>
          <ChevronDown className="w-4 h-4 shrink-0 transition-transform group-open:rotate-180 text-[#5a7a70]" />
        </summary>
        <div className="px-5 pb-5 pt-0 space-y-4 border-t border-[#1a2e28] mt-0">
          <div className="pt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="mc-model" className="text-[13px] text-[#6a8a80] block mb-1.5">
                Model tier preference
              </label>
              <select
                id="mc-model"
                value={modelTier}
                onChange={(e) => setModelTier(e.target.value)}
                className="w-full rounded-lg border border-[#1a3530] bg-[#0a1612] px-3 py-2 text-[14px] text-[#c8d6d0] focus:outline-none focus:border-emerald-500/40"
              >
                {MODEL_TIERS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="mc-max-tok" className="text-[13px] text-[#6a8a80] block mb-1.5">
                Max tokens (guidance)
              </label>
              <input
                id="mc-max-tok"
                type="number"
                min={1024}
                max={200000}
                step={1024}
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
                className="w-full rounded-lg border border-[#1a3530] bg-[#0a1612] px-3 py-2 text-[14px] text-[#c8d6d0] focus:outline-none focus:border-emerald-500/40"
              />
            </div>
          </div>
          <label className="flex items-center justify-between gap-3 cursor-pointer rounded-lg border border-[#1a3530] bg-[#0a1612] px-3 py-2.5">
            <span className="text-[14px] text-[#9abaae]">Clawhip monitoring</span>
            <input
              type="checkbox"
              checked={clawhipMonitoring}
              onChange={(e) => setClawhipMonitoring(e.target.checked)}
              className="w-4 h-4 accent-emerald-600 rounded border-[#1a3530]"
            />
          </label>
          <div>
            <label htmlFor="mc-keywords" className="text-[13px] text-[#6a8a80] block mb-1.5">
              Keywords (Clawhip tmux pane)
            </label>
            <input
              id="mc-keywords"
              type="text"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="error,complete,failed,success"
              className="w-full rounded-lg border border-[#1a3530] bg-[#0a1612] px-3 py-2 text-[14px] text-[#c8d6d0] focus:outline-none focus:border-emerald-500/40"
            />
          </div>
          <div>
            <label htmlFor="mc-stale" className="text-[13px] text-[#6a8a80] block mb-1.5">
              Stale timeout (minutes)
            </label>
            <input
              id="mc-stale"
              type="number"
              min={1}
              max={120}
              value={staleMinutes}
              onChange={(e) => setStaleMinutes(Number(e.target.value))}
              className="w-full max-w-[12rem] rounded-lg border border-[#1a3530] bg-[#0a1612] px-3 py-2 text-[14px] text-[#c8d6d0] focus:outline-none focus:border-emerald-500/40"
            />
          </div>
        </div>
      </details>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-[14px] text-red-400">
          {error}
        </div>
      )}

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
