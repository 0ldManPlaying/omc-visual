import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Save, RefreshCw, Server, Zap, Eye, Check, AlertCircle } from 'lucide-react';

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [clawhipConfig, setClawhipConfig] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings');
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
    setTimeout(() => setMessage(null), 3000);
  };

  const saveClawhipConfig = async () => {
    setSaving('clawhip');
    try {
      const res = await fetch('/api/settings/clawhip', {
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
          onClick={fetchSettings}
          className="flex items-center gap-1.5 text-[14px] text-[#5a7a70] transition-colors hover:text-[#8aaa9f]"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Toast message */}
      {message && (
        <div className={`mb-4 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[14px] ${
          message.type === 'error'
            ? 'border-red-500/20 bg-red-500/5 text-red-400'
            : 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400'
        }`}>
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
