import { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon,
  Save,
  RefreshCw,
  Server,
  Zap,
  Eye,
  Check,
  AlertCircle,
  Brush,
  List,
  Plus,
  Trash2,
  PlugZap,
} from 'lucide-react';
import { useStore, apiUrl } from '../stores/useStore';

export default function Settings() {
  const cleanupSessions = useStore((s) => s.cleanupSessions);
  const addServerEntry = useStore((s) => s.addServerEntry);
  const removeServerEntry = useStore((s) => s.removeServerEntry);
  const testServerConnection = useStore((s) => s.testServerConnection);
  const servers = useStore((s) => s.servers);
  const fetchServers = useStore((s) => s.fetchServers);
  const activeServer = useStore((s) => s.activeServer);

  const [settings, setSettings] = useState(null);
  const [clawhipConfig, setClawhipConfig] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [message, setMessage] = useState(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [tmuxBusy, setTmuxBusy] = useState(false);
  const [tmuxSessions, setTmuxSessions] = useState(null);

  const [newServerName, setNewServerName] = useState('');
  const [newServerUrl, setNewServerUrl] = useState('');
  const [serverBusy, setServerBusy] = useState(false);
  const [testingName, setTestingName] = useState(null);

  useEffect(() => {
    fetchSettings();
    fetchServers();
  }, [activeServer]);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl('/api/settings'));
      const data = await res.json();
      setSettings(data);
      if (data.clawhip?.content) {
        setClawhipConfig(data.clawhip.content);
      }
    } catch {
      setSettings(null);
    }
    setLoading(false);
  };

  const showMessage = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  };

  const handleCleanupOrphans = async () => {
    setCleanupBusy(true);
    try {
      const result = await cleanupSessions();
      const n = typeof result.cleaned === 'number' ? result.cleaned : result.killed;
      if (result.ok && typeof n === 'number') {
        if (n === 0) showMessage('No orphan sessions found');
        else showMessage(`Cleaned ${n} orphan session${n === 1 ? '' : 's'}`);
      } else if (result.ok) {
        showMessage('Cleanup completed');
      } else {
        showMessage(result.error || 'Cleanup failed', 'error');
      }
    } catch {
      showMessage('Cleanup failed', 'error');
    }
    setCleanupBusy(false);
  };

  const handleTmuxList = async () => {
    setTmuxBusy(true);
    setTmuxSessions(null);
    try {
      const res = await fetch(apiUrl('/api/session/tmux-list'));
      const data = await res.json();
      setTmuxSessions(Array.isArray(data.sessions) ? data.sessions : []);
      if (!res.ok) showMessage('Could not list tmux sessions', 'error');
    } catch {
      setTmuxSessions([]);
      showMessage('Could not list tmux sessions', 'error');
    }
    setTmuxBusy(false);
  };

  const handleAddServer = async () => {
    const name = newServerName.trim();
    const url = newServerUrl.trim();
    if (!name || !url) {
      showMessage('Name and URL required', 'error');
      return;
    }
    setServerBusy(true);
    const r = await addServerEntry(name, url);
    setServerBusy(false);
    if (r.ok) {
      setNewServerName('');
      setNewServerUrl('');
      showMessage(`Server “${name}” added`);
      fetchServers();
    } else {
      showMessage(r.error || 'Add failed', 'error');
    }
  };

  const handleRemoveServer = async (name) => {
    if (!window.confirm(`Remove server “${name}”?`)) return;
    setServerBusy(true);
    const r = await removeServerEntry(name);
    setServerBusy(false);
    if (r.ok) {
      showMessage(`Removed “${name}”`);
      fetchServers();
    } else {
      showMessage(r.error || 'Remove failed', 'error');
    }
  };

  const handleTestServer = async (name) => {
    setTestingName(name);
    const r = await testServerConnection(name);
    setTestingName(null);
    if (r.online) showMessage(`“${name}” is online`);
    else showMessage(`“${name}”: offline — ${r.error || 'unreachable'}`, 'error');
  };

  const saveClawhipConfig = async () => {
    setSaving('clawhip');
    try {
      const res = await fetch(apiUrl('/api/settings/clawhip'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: clawhipConfig }),
      });
      if (res.ok) showMessage('Clawhip config saved');
      else showMessage('Failed to save', 'error');
    } catch {
      showMessage('Failed to save', 'error');
    }
    setSaving(null);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center p-6 text-[15px] text-[#3a5a50]">
        <RefreshCw className="mr-2 h-5 w-5 animate-spin" /> Loading settings...
      </div>
    );
  }

  return (
    <div className="p-6 overflow-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <SettingsIcon className="w-5 h-5 text-[#8aaa9f]" />
            Settings
          </h1>
          <p className="mt-0.5 text-[15px] text-[#5a7a70]">OMC, Clawhip, and Visual server configuration</p>
        </div>
        <button
          onClick={() => {
            fetchSettings();
            fetchServers();
          }}
          className="flex items-center gap-1.5 text-[14px] text-[#5a7a70] transition-colors hover:text-[#8aaa9f]"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Toast message */}
      {message && (
        <div
          className={`mb-4 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[14px] ${
            message.type === 'error'
              ? 'border-red-500/20 bg-red-500/5 text-red-400'
              : 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400'
          }`}
        >
          {message.type === 'error' ? <AlertCircle className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
          {message.text}
        </div>
      )}

      <div className="space-y-6 max-w-4xl">
        {/* OMC Status */}
        <Section
          icon={Eye}
          title="oh-my-claudecode"
          description="OMC plugin status and configuration"
          iconColor="text-emerald-400"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <InfoField label="Installed" value={settings?.omc?.exists ? 'Yes' : 'No'} />
            <InfoField label="Config path" value="~/.claude/settings.json" mono />
          </div>
          {settings?.omc?.config && (
            <div className="mt-3">
              <label className="mb-1.5 block text-[14px] text-[#5a7a70]">Current configuration</label>
              <pre className="max-h-48 overflow-auto rounded-lg border border-[#1a2e28] bg-[#0a1210] p-3 font-mono text-[13px] text-[#8aaa9f]">
                {JSON.stringify(settings.omc.config, null, 2)}
              </pre>
            </div>
          )}
        </Section>

        {/* Servers registry */}
        <Section
          icon={Server}
          title="Servers"
          description="Remote OMC Visual backends (stored in ~/.omc-visual/servers.json on this host)"
          iconColor="text-sky-400"
        >
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <input
              type="text"
              placeholder="Name (e.g. AiLab)"
              value={newServerName}
              onChange={(e) => setNewServerName(e.target.value)}
              className="flex-1 rounded-lg border border-[#1a2e28] bg-[#0a1210] px-3 py-2 text-[14px] text-[#c8d6d0] placeholder-[#2a4e40] focus:border-emerald-500/30 focus:outline-none"
            />
            <input
              type="text"
              placeholder="URL (e.g. http://192.168.178.51:3200)"
              value={newServerUrl}
              onChange={(e) => setNewServerUrl(e.target.value)}
              className="flex-[2] rounded-lg border border-[#1a2e28] bg-[#0a1210] px-3 py-2 text-[14px] text-[#c8d6d0] placeholder-[#2a4e40] font-mono focus:border-emerald-500/30 focus:outline-none"
            />
            <button
              type="button"
              disabled={serverBusy}
              onClick={handleAddServer}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-[14px] font-medium text-white hover:bg-emerald-500 disabled:opacity-50 shrink-0"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>
          <ul className="space-y-2">
            {servers.length === 0 ? (
              <li className="text-[14px] text-[#3a5a50]">No servers in registry yet.</li>
            ) : (
              servers.map((s) => (
                <li
                  key={s.name}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-[#1a2e28] bg-[#0a1612] px-3 py-2.5"
                >
                  <span className="font-medium text-[#a0b8b0]">{s.name}</span>
                  <span className="text-[13px] text-[#5a7a70] font-mono truncate flex-1 min-w-[8rem]">{s.url}</span>
                  {s.default && (
                    <span className="text-[11px] uppercase text-emerald-500/80 border border-emerald-500/20 rounded px-1.5 py-0.5">
                      default
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={testingName === s.name}
                    onClick={() => handleTestServer(s.name)}
                    className="flex items-center gap-1 text-[13px] text-sky-400/90 hover:text-sky-300 disabled:opacity-50"
                  >
                    <PlugZap className="w-3.5 h-3.5" />
                    {testingName === s.name ? '…' : 'Test connection'}
                  </button>
                  <button
                    type="button"
                    disabled={serverBusy}
                    onClick={() => handleRemoveServer(s.name)}
                    className="flex items-center gap-1 text-[13px] text-red-400/70 hover:text-red-400 disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </li>
              ))
            )}
          </ul>
        </Section>

        {/* Maintenance / Onderhoud */}
        <Section
          icon={Brush}
          title="Maintenance"
          description="Tmux sessions on the machine running this OMC Visual server"
          iconColor="text-amber-400"
        >
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleCleanupOrphans}
              disabled={cleanupBusy}
              className="flex items-center gap-2 rounded-lg border border-amber-500/35 bg-amber-500/5 px-4 py-2.5 text-[14px] text-amber-200/90 transition-colors hover:bg-amber-500/10 disabled:opacity-50 disabled:pointer-events-none"
            >
              <Brush className="w-4 h-4 shrink-0" />
              {cleanupBusy ? 'Cleaning up…' : 'Clean up orphan tmux sessions'}
            </button>
            <button
              type="button"
              onClick={handleTmuxList}
              disabled={tmuxBusy}
              className="flex items-center gap-2 rounded-lg border border-[#1a3530] bg-[#0a1612] px-4 py-2.5 text-[14px] text-[#8aaa9f] transition-colors hover:bg-[#12221e] disabled:opacity-50"
            >
              <List className="w-4 h-4 shrink-0" />
              {tmuxBusy ? 'Loading…' : 'View active tmux sessions'}
            </button>
          </div>
          <p className="mt-3 text-[13px] text-[#3a5a50]">
            Cleanup kills every <span className="font-mono text-[#5a7a70]">omc-session-*</span> tmux session and
            reconciles the database.
          </p>
          {tmuxSessions && (
            <div className="mt-4 rounded-lg border border-[#1a2e28] bg-[#0a1210] max-h-56 overflow-auto">
              {tmuxSessions.length === 0 ? (
                <p className="p-3 text-[14px] text-[#5a7a70]">No tmux sessions (or tmux not running).</p>
              ) : (
                <ul className="divide-y divide-[#1a2e28]">
                  {tmuxSessions.map((row) => (
                    <li key={row.name} className="px-3 py-2 flex flex-wrap items-center gap-2 text-[13px]">
                      <span className="font-mono text-[#a0b8b0]">{row.name}</span>
                      <span className="text-[#3a5a50]">
                        {row.attached ? (
                          <span className="text-emerald-400/80">attached</span>
                        ) : (
                          <span>detached</span>
                        )}
                      </span>
                      {row.created ? (
                        <span className="text-[#5a7a70] text-[12px]">{row.created}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Section>

        {/* Clawhip Config */}
        <Section
          icon={Zap}
          title="Clawhip daemon"
          description="Edit the Clawhip config.toml for event routing"
          iconColor="text-amber-400"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <InfoField label="Installed" value={settings?.clawhip?.exists ? 'Yes' : 'No'} />
            <InfoField label="Config path" value={settings?.clawhip?.path || '~/.clawhip/config.toml'} mono />
          </div>
          {settings?.clawhip?.exists && (
            <div>
              <label className="mb-1.5 block text-[14px] text-[#5a7a70]">config.toml</label>
              <textarea
                value={clawhipConfig}
                onChange={(e) => setClawhipConfig(e.target.value)}
                rows={16}
                className="w-full resize-y rounded-lg border border-[#1a2e28] bg-[#0a1210] p-3 font-mono text-[14px] leading-relaxed text-[#c8d6d0] focus:border-emerald-500/30 focus:outline-none"
                spellCheck={false}
              />
              <div className="flex justify-end mt-2">
                <button
                  onClick={saveClawhipConfig}
                  disabled={saving === 'clawhip'}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-[14px] font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  {saving === 'clawhip' ? 'Saving...' : 'Save config'}
                </button>
              </div>
            </div>
          )}
        </Section>

        {/* Visual Server */}
        <Section
          icon={Server}
          title="OMC Visual server"
          description="Server settings and information"
          iconColor="text-blue-400"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <InfoField label="Version" value="0.1.0" />
            <InfoField label="Port" value="3200" mono />
            <InfoField label="Data directory" value="~/.omc-visual/" mono />
          </div>
          {settings?.visual?.settings && Object.keys(settings.visual.settings).length > 0 && (
            <div className="mt-3">
              <label className="mb-1.5 block text-[14px] text-[#5a7a70]">Custom settings</label>
              <pre className="max-h-32 overflow-auto rounded-lg border border-[#1a2e28] bg-[#0a1210] p-3 font-mono text-[13px] text-[#8aaa9f]">
                {JSON.stringify(settings.visual.settings, null, 2)}
              </pre>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, description, iconColor, children }) {
  return (
    <div className="rounded-xl border border-[#1a2e28] bg-[#0f1e1a] p-5">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${iconColor || 'text-[#5a7a70]'}`} />
        <h2 className="text-[16px] font-semibold text-white">{title}</h2>
      </div>
      <p className="mb-4 text-[14px] text-[#5a7a70]">{description}</p>
      {children}
    </div>
  );
}

function InfoField({ label, value, mono }) {
  return (
    <div className="rounded-lg bg-[#0a1612] border border-[#162a25] p-2.5">
      <div className="mb-0.5 text-[14px] text-[#3a5a50]">{label}</div>
      <div className={`truncate text-[14px] text-[#a0b8b0] ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}
