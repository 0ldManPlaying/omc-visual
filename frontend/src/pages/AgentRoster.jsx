import { useState, useEffect } from 'react';
import { Users, Search, Cpu, Shield, Code, FileText, Microscope, Palette, Bug } from 'lucide-react';

const MODEL_STYLES = {
  opus: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/20', dot: 'bg-purple-500' },
  sonnet: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20', dot: 'bg-blue-500' },
  haiku: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', dot: 'bg-emerald-500' },
};

const CATEGORY_ICONS = {
  architect: Cpu, planner: Cpu, analyst: Cpu, executor: Code, debugger: Bug,
  explore: Search, 'code-simplifier': Code, 'security-reviewer': Shield,
  'code-reviewer': Code, critic: Shield, 'test-engineer': FileText,
  designer: Palette, writer: FileText, 'document-specialist': FileText,
  'qa-tester': FileText, scientist: Microscope, 'git-master': Code, tracer: Bug,
};

const FALLBACK_AGENTS = [
  { name: 'architect', model: 'opus', description: 'System architecture and high-level design', category: 'build' },
  { name: 'planner', model: 'opus', description: 'Strategic planning and task decomposition', category: 'build' },
  { name: 'analyst', model: 'opus', description: 'Deep analysis and research', category: 'build' },
  { name: 'executor', model: 'sonnet', description: 'Code implementation and execution', category: 'build' },
  { name: 'debugger', model: 'sonnet', description: 'Bug finding and fixing', category: 'build' },
  { name: 'explore', model: 'haiku', description: 'Quick codebase exploration', category: 'build' },
  { name: 'code-simplifier', model: 'sonnet', description: 'Simplify and refine code', category: 'build' },
  { name: 'security-reviewer', model: 'opus', description: 'Security audit and vulnerability detection', category: 'review' },
  { name: 'code-reviewer', model: 'sonnet', description: 'Comprehensive code review', category: 'review' },
  { name: 'critic', model: 'opus', description: 'Critical evaluation and feedback', category: 'review' },
  { name: 'test-engineer', model: 'sonnet', description: 'Test writing and QA', category: 'specialist' },
  { name: 'designer', model: 'sonnet', description: 'UI/UX design and frontend', category: 'specialist' },
  { name: 'writer', model: 'sonnet', description: 'Documentation and content', category: 'specialist' },
  { name: 'document-specialist', model: 'sonnet', description: 'Technical documentation', category: 'specialist' },
  { name: 'qa-tester', model: 'sonnet', description: 'Quality assurance testing', category: 'specialist' },
  { name: 'scientist', model: 'opus', description: 'Research and experimentation', category: 'specialist' },
  { name: 'git-master', model: 'sonnet', description: 'Git operations and branching', category: 'specialist' },
  { name: 'tracer', model: 'haiku', description: 'Execution tracing and debugging', category: 'specialist' },
];

export default function AgentRoster() {
  const [agents, setAgents] = useState(FALLBACK_AGENTS);
  const [search, setSearch] = useState('');
  const [filterModel, setFilterModel] = useState(null);

  useEffect(() => {
    fetch('/api/status/agents')
      .then((r) => r.json())
      .then((data) => {
        if (data.agents?.length > 0) setAgents(data.agents);
      })
      .catch(() => {});
  }, []);

  const filtered = agents.filter((a) => {
    if (search && !a.name.includes(search.toLowerCase()) && !a.description?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterModel && !a.model?.includes(filterModel)) return false;
    return true;
  });

  const counts = {
    opus: agents.filter((a) => a.model?.includes('opus')).length,
    sonnet: agents.filter((a) => a.model?.includes('sonnet')).length,
    haiku: agents.filter((a) => a.model?.includes('haiku')).length,
  };

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white flex items-center gap-2">
          <Users className="w-5 h-5 text-emerald-400" />
          Agents
        </h1>
        <p className="text-[15px] text-[#5a7a70] mt-0.5">{agents.length} specialized agents across 3 model tiers</p>
      </div>

      {/* Model tier cards */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {Object.entries(counts).map(([model, count]) => {
          const s = MODEL_STYLES[model];
          const isActive = filterModel === model;
          return (
            <button
              key={model}
              onClick={() => setFilterModel(isActive ? null : model)}
              className={`rounded-xl border p-4 transition-all text-left ${
                isActive
                  ? `${s.border} ${s.bg} ring-1 ring-emerald-500/10`
                  : 'border-[#1a2e28] hover:border-[#2a4e40] bg-[#0f1e1a]'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-2.5 h-2.5 rounded-full ${s.dot} ${isActive ? '' : 'opacity-40'}`} />
                <span className={`text-[14px] capitalize font-medium ${isActive ? s.text : 'text-[#5a7a70]'}`}>{model}</span>
              </div>
              <div className={`text-2xl font-bold ${isActive ? 'text-white' : 'text-[#8aaa9f]'}`}>{count}</div>
              <div className="text-[13px] text-[#3a5a50]">
                {model === 'opus' ? 'Complex reasoning' : model === 'sonnet' ? 'Standard work' : 'Quick lookups'}
              </div>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#3a5a50]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search agents..."
          className="w-full rounded-xl border border-[#1a2e28] bg-[#0f1e1a] pl-10 pr-4 py-2.5 text-[15px] text-[#c8d6d0] placeholder-[#2a4e40] focus:outline-none focus:border-emerald-500/30"
        />
      </div>

      {/* Agent grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {filtered.map((agent) => {
          const modelKey = agent.model?.includes('opus') ? 'opus' : agent.model?.includes('haiku') ? 'haiku' : 'sonnet';
          const s = MODEL_STYLES[modelKey];
          const Icon = CATEGORY_ICONS[agent.name] || Cpu;

          return (
            <div
              key={agent.name}
              className="rounded-xl border border-[#1a2e28] bg-[#0f1e1a] p-3.5 hover:border-[#2a4e40] hover:bg-[#12221e] transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#12221e] border border-[#1a3530] flex items-center justify-center group-hover:border-[#2a4e40] transition-colors">
                    <Icon className="w-4 h-4 text-[#5a7a70]" />
                  </div>
                  <div>
                    <span className="text-[15px] font-medium text-white">{agent.name}</span>
                    {agent.description && (
                      <p className="text-[13px] text-[#4a6a60] mt-0.5">{agent.description}</p>
                    )}
                  </div>
                </div>
                <span className={`text-[12px] px-2 py-0.5 rounded-full ${s.bg} ${s.text} ${s.border} border font-medium`}>
                  {modelKey}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="mt-8 text-center text-[15px] text-[#3a5a50]">No agents match your search</div>
      )}
    </div>
  );
}
