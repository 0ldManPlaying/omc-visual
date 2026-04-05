import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Package,
  Search,
  RefreshCw,
  Play,
  Square,
  Trash2,
  Terminal,
  ChevronRight,
  ExternalLink,
  Wrench,
  AlertCircle,
  Box,
  Image as ImageIcon,
  FileText,
  PenLine,
  Video,
  Music,
  ChevronDown,
} from 'lucide-react';
import { AnsiUp } from 'ansi_up';
import { useStore } from '../stores/useStore';

const CLI_ANYTHING_GITHUB = 'https://github.com/HKUDS/CLI-Anything';

const EXAMPLE_TOOLS = [
  { name: 'Blender', description: '3D modeling & rendering', Icon: Box },
  { name: 'GIMP', description: 'Image editing & manipulation', Icon: ImageIcon },
  { name: 'LibreOffice', description: 'Documents & spreadsheets', Icon: FileText },
  { name: 'Inkscape', description: 'Vector graphics & SVG', Icon: PenLine },
  { name: 'OBS Studio', description: 'Screen recording & streaming', Icon: Video },
  { name: 'Audacity', description: 'Audio editing & processing', Icon: Music },
];

export default function ToolLibrary() {
  const {
    installedTools,
    toolsMeta,
    toolEvents,
    fetchTools,
    executeTool,
    stopToolExecution,
    clearToolOutput,
  } = useStore();

  const [search, setSearch] = useState('');
  const [selectedBinary, setSelectedBinary] = useState(null);
  const [argsInput, setArgsInput] = useState('--help');
  const [jsonMode, setJsonMode] = useState(false);
  const [lastError, setLastError] = useState(null);
  const outRef = useRef(null);

  const ansiUp = useMemo(() => {
    const a = new AnsiUp();
    a.use_classes = false;
    return a;
  }, []);

  useEffect(() => {
    fetchTools(false);
  }, [fetchTools]);

  useEffect(() => {
    if (outRef.current) {
      outRef.current.scrollTop = outRef.current.scrollHeight;
    }
  }, [toolEvents]);

  const hasTools = installedTools.length > 0;
  const selected = installedTools.find((t) => t.binary === selectedBinary) || null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return installedTools;
    return installedTools.filter(
      (t) =>
        t.binary.toLowerCase().includes(q) ||
        (t.commands || []).some((c) => c.toLowerCase().includes(q)) ||
        (t.helpPreview || '').toLowerCase().includes(q)
    );
  }, [installedTools, search]);

  const handleRescan = async () => {
    setLastError(null);
    await fetchTools(true);
  };

  const handleRun = async () => {
    if (!selected) return;
    setLastError(null);
    const args = splitArgs(argsInput.trim() || '');
    const res = await executeTool(selected.binary, args, jsonMode);
    if (!res.ok) {
      setLastError(res.error || res.hint || 'Execution request failed');
    }
  };

  const handleStop = async () => {
    await stopToolExecution();
  };

  const appendArg = (token) => {
    setArgsInput((prev) => (prev.trim() ? `${prev.trim()} ${token}` : token));
  };

  return (
    <div className="flex h-screen min-h-0 flex-col p-6">
      <div className="mb-4 flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {hasTools ? (
            <>
              <h1 className="flex items-center gap-2 text-xl font-semibold text-white">
                <Package className="h-5 w-5 text-emerald-400" />
                Tool library
              </h1>
              <p className="mt-0.5 text-[15px] text-[#5a7a70]">
                Run commands for apps your agents can control — pick a tool, then press Run.
              </p>
            </>
          ) : (
            <>
              <h1 className="flex items-center gap-2 text-xl font-semibold text-white">
                <Package className="h-5 w-5 text-emerald-400" />
                Extend your AI workspace with external tools
              </h1>
              <p className="mt-0.5 text-[15px] text-[#5a7a70]">
                No tools detected yet. Read below to see what becomes possible once you add them.
              </p>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-md border px-2 py-1 text-[13px] ${
              toolsMeta.python3
                ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-400/90'
                : 'border-amber-500/25 bg-amber-500/5 text-amber-400/80'
            }`}
            title="Python 3 (recommended for pip-installed tools)"
          >
            python3: {toolsMeta.python3 || 'not found'}
          </span>
          <button
            type="button"
            onClick={handleRescan}
            className="flex items-center gap-1.5 rounded-lg border border-[#1a2e28] bg-[#0f1e1a] px-3 py-1.5 text-[14px] text-[#8aaa9f] transition-colors hover:border-emerald-500/30 hover:text-emerald-400"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Rescan PATH
          </button>
        </div>
      </div>

      {!hasTools ? (
        <ToolLibraryOnboarding />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
          {/* Catalog */}
          <div className="flex min-h-[200px] shrink-0 flex-col overflow-hidden rounded-xl border border-[#1a2e28] bg-[#0f1e1a] lg:w-[340px]">
            <div className="border-b border-[#1a2e28] p-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#3a5a50]" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter tools…"
                  className="w-full rounded-lg border border-[#1a2e28] bg-[#0a1210] py-1.5 pl-8 pr-3 text-[15px] text-[#c8d6d0] placeholder-[#2a4e40] focus:border-emerald-500/30 focus:outline-none"
                />
              </div>
            </div>
            <div className="flex-1 space-y-1 overflow-auto p-2">
              {filtered.length === 0 ? (
                <div className="px-3 py-8 text-center text-[15px] text-[#5a7a70]">No tools match your search.</div>
              ) : (
                filtered.map((t) => {
                  const active = selectedBinary === t.binary;
                  return (
                    <button
                      key={t.binary}
                      type="button"
                      onClick={() => {
                        setSelectedBinary(t.binary);
                        setArgsInput('--help');
                        setLastError(null);
                      }}
                      className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        active
                          ? 'border-emerald-500/35 bg-emerald-500/10'
                          : 'border-transparent hover:border-[#1a3530] hover:bg-[#12221e]'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Wrench className="h-3.5 w-3.5 shrink-0 text-emerald-500/80" />
                        <span className="truncate font-mono text-[14px] font-medium text-white">{t.binary}</span>
                        <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-[#3a5a50]" />
                      </div>
                      <div className="mt-0.5 truncate text-[13px] text-[#3a5a50]">
                        {(t.commands || []).slice(0, 4).join(', ')}
                        {(t.commands || []).length > 4 ? '…' : ''}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
            {toolsMeta.refreshedAt && (
              <div className="border-t border-[#1a2e28] px-3 py-1.5 text-[12px] text-[#2a4e40]">
                Last scan: {new Date(toolsMeta.refreshedAt).toLocaleString()}
              </div>
            )}
          </div>

          {/* Detail + run */}
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {selected ? (
              <div className="shrink-0 rounded-xl border border-[#1a2e28] bg-[#0f1e1a] p-4">
                <h2 className="mb-2 font-mono text-[16px] font-semibold text-white">{selected.binary}</h2>
                <p className="mb-3 break-all text-[13px] text-[#5a7a70]">{selected.path}</p>

                <div className="mb-3">
                  <div className="mb-1.5 text-[13px] uppercase tracking-wide text-[#3a5a50]">Suggested commands</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(selected.commands || []).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => appendArg(c)}
                        className="rounded-md border border-[#1a2e28] bg-[#0a1210] px-2 py-0.5 text-[13px] text-[#8aaa9f] hover:border-emerald-500/30 hover:text-emerald-400"
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="mb-1 block text-[14px] text-[#5a7a70]">Arguments (space-separated; quotes supported)</label>
                <textarea
                  value={argsInput}
                  onChange={(e) => setArgsInput(e.target.value)}
                  rows={2}
                  className="mb-2 w-full resize-y rounded-lg border border-[#1a2e28] bg-[#0a1210] p-2.5 font-mono text-[14px] text-[#c8d6d0] focus:border-emerald-500/30 focus:outline-none"
                  spellCheck={false}
                />

                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[#7a9a90]">
                    <input
                      type="checkbox"
                      checked={jsonMode}
                      onChange={(e) => setJsonMode(e.target.checked)}
                      className="rounded border-[#1a2e28] bg-[#0a1210] text-emerald-600"
                    />
                    Try parse JSON output
                  </label>
                  <div className="ml-auto flex gap-2">
                    <button
                      type="button"
                      onClick={handleStop}
                      className="flex items-center gap-1.5 rounded-lg border border-amber-500/25 px-3 py-1.5 text-[14px] text-amber-400/90 hover:bg-amber-500/5"
                    >
                      <Square className="h-3 w-3" />
                      Stop
                    </button>
                    <button
                      type="button"
                      onClick={handleRun}
                      className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[14px] font-medium text-white hover:bg-emerald-500"
                    >
                      <Play className="h-3.5 w-3.5" />
                      Run
                    </button>
                  </div>
                </div>

                {lastError && (
                  <div className="mt-3 flex items-start gap-2 text-[13px] text-red-400/90">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {lastError}
                  </div>
                )}

                {selected.helpPreview && (
                  <details className="mt-3 rounded-lg border border-[#1a2e28] bg-[#0a1210]">
                    <summary className="cursor-pointer px-3 py-2 text-[13px] text-[#5a7a70] hover:text-[#8aaa9f]">
                      Full --help preview ({selected.helpChars ?? selected.helpPreview.length} chars)
                    </summary>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap border-t border-[#1a2e28] p-3 pt-0 font-mono text-[13px] text-[#6a8a80]">
                      {selected.helpPreview}
                    </pre>
                  </details>
                )}
              </div>
            ) : (
              <div className="shrink-0 rounded-xl border border-dashed border-[#1a2e28] bg-[#0a1210]/50 p-8 text-center text-[15px] text-[#5a7a70]">
                Select a tool from the list to view commands and run it.
              </div>
            )}

            <div className="flex min-h-[160px] flex-1 flex-col overflow-hidden rounded-xl border border-[#1a2e28] bg-[#0a1210]">
              <div className="flex items-center justify-between border-b border-[#1a2e28] bg-[#0d1816] px-3 py-2">
                <div className="flex items-center gap-2 text-[14px] text-[#8aaa9f]">
                  <Terminal className="h-3.5 w-3.5 text-emerald-500/80" />
                  Tool output <span className="text-[#3a5a50]">(WebSocket · tools)</span>
                </div>
                <button
                  type="button"
                  onClick={() => clearToolOutput()}
                  className="flex items-center gap-1 text-[13px] text-[#5a7a70] hover:text-red-400/80"
                >
                  <Trash2 className="h-3 w-3" />
                  Clear
                </button>
              </div>
              <div ref={outRef} className="flex-1 space-y-1 overflow-auto p-3 font-mono text-[13px] leading-relaxed">
                {toolEvents.length === 0 ? (
                  <p className="text-[14px] text-[#3a5a50]">No output yet. Run a command to stream stdout/stderr here.</p>
                ) : (
                  toolEvents.map((ev, i) => <ToolEventLine key={`${ev.timestamp}-${i}`} ev={ev} ansiUp={ansiUp} />)
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolLibraryOnboarding() {
  return (
    <div className="min-h-0 flex-1 overflow-auto pb-6">
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="rounded-xl border border-[#1a3530] bg-[#0f1e1a] p-6 shadow-sm">
          <p className="text-[16px] leading-relaxed text-[#a0b8b0]">
            <strong className="font-semibold text-[#c8d6d0]">Tool Library</strong> connects professional software to your
            OMC agents. Imagine telling your AI team: &quot;Create a product render in Blender&quot; or &quot;Generate a
            report in LibreOffice&quot; — and it just works.
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-[#6a8a80]">
            This is powered by{' '}
            <strong className="font-medium text-[#8aaa9f]">CLI-Anything</strong>, an open-source framework that turns any
            desktop application into an AI-controllable tool.
          </p>
        </div>

        <div>
          <h2 className="mb-4 text-[16px] font-semibold text-white">What you can connect</h2>
          <p className="mb-4 text-[14px] text-[#5a7a70]">
            Examples of the kind of programs that can work with your agents (each needs its own CLI-Anything package when
            available):
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {EXAMPLE_TOOLS.map(({ name, description, Icon }) => (
              <div
                key={name}
                className="rounded-xl border border-[#1a2e28] bg-[#0f1e1a] p-4"
                role="group"
                aria-label={`${name}: ${description}`}
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[#12221e] border border-[#1a3530]">
                  <Icon className="h-5 w-5 text-emerald-400/90" aria-hidden />
                </div>
                <h3 className="text-[15px] font-semibold text-white">{name}</h3>
                <p className="mt-1 text-[14px] leading-snug text-[#6a8a80]">{description}</p>
                <a
                  href={CLI_ANYTHING_GITHUB}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-[13px] text-emerald-400/90 hover:text-emerald-400 hover:underline"
                >
                  Learn more
                  <ExternalLink className="h-3 w-3 opacity-80" aria-hidden />
                </a>
              </div>
            ))}
          </div>
        </div>

        <details className="group rounded-xl border border-[#1a2e28] bg-[#0a1210]/80">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-[15px] font-medium text-[#a0b8b0] hover:text-white [&::-webkit-details-marker]:hidden">
            <span>How to install</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-[#5a7a70] transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-3 border-t border-[#1a2e28] px-4 py-4 text-[14px] text-[#6a8a80]">
            <p className="text-[#8aaa9f]">To add a tool, run in your terminal:</p>
            <code className="block rounded-lg border border-[#1a3530] bg-[#0f1e1a] px-3 py-2.5 font-mono text-[13px] text-[#c8d6d0]">
              pip install cli-anything-blender
            </code>
            <p className="text-[14px] text-[#5a7a70]">
              Use the package name for the app you want (for example <code className="text-[#6a9a88]">cli-anything-gimp</code>
              ). Then click <strong className="text-[#8aaa9f]">Rescan PATH</strong> above so this app can find the new command.
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}

function ToolEventLine({ ev, ansiUp }) {
  const b = ev.binary ? `[${ev.binary}] ` : '';
  if (ev.type === 'stdout' && ev.text) {
    const html = ansiUp.ansi_to_html(ev.text);
    return (
      <div
        className="break-words whitespace-pre-wrap text-[#b8ccc4]"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  if (ev.type === 'stderr' && ev.text) {
    return (
      <div className="break-words whitespace-pre-wrap text-red-400/90">
        {b}
        {ev.text}
      </div>
    );
  }
  if (ev.type === 'started') {
    return <div className="text-emerald-400/90">▶ started {(ev.args || []).join(' ')}</div>;
  }
  if (ev.type === 'exit') {
    return (
      <div className="text-[#6a8a80]">
        ◼ exit code {ev.code}
        {ev.json != null && (
          <pre className="mt-1 max-h-32 overflow-auto text-[13px] text-[#8aaa9f]">{JSON.stringify(ev.json, null, 2)}</pre>
        )}
      </div>
    );
  }
  if (ev.type === 'json' && ev.value != null) {
    return <pre className="overflow-auto text-[13px] text-cyan-400/90">{JSON.stringify(ev.value, null, 2)}</pre>;
  }
  if (ev.type === 'error') {
    return (
      <div className="text-red-400">
        {b}
        {ev.message}
      </div>
    );
  }
  if (ev.type === 'stopped') {
    return <div className="text-amber-400/90">{ev.message || 'Stopped'}</div>;
  }
  return <pre className="overflow-auto text-[13px] text-[#4a6a60]">{JSON.stringify(ev, null, 2)}</pre>;
}

function splitArgs(s) {
  const out = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      continue;
    }
    if (/\s/.test(c)) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      continue;
    }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}
