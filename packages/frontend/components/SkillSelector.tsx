/**
 * SkillSelector — Per-agent skill management UI
 *
 * Displays a list of available skills with checkboxes.
 * Toggling a skill calls the backend to assign/remove it.
 *
 * Props:
 *   agentId   — The agent ID (from team/agent model)
 *   teamId    — Team context (for the skills API path)
 *   onClose   — Close the selector panel
 */

import React, { useState, useEffect, useCallback } from 'react';
import { X, Search, Tag, Loader2 } from 'lucide-react';

interface Skill {
  skillId: string;
  name: string;
  description: string;
  tags: string[];
  assigned?: boolean;
}

interface SkillSelectorProps {
  agentId: string;
  teamId: string;
  onClose: () => void;
}

const API_BASE = 'http://localhost:3002';

const SkillSelector: React.FC<SkillSelectorProps> = ({ agentId, teamId, onClose }) => {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Load all available skills + currently assigned skills
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [allRes, assignedRes] = await Promise.all([
          fetch(`${API_BASE}/api/skills?limit=100`),
          fetch(`${API_BASE}/api/v2/teams/${teamId}/agents/${agentId}/skills`),
        ]);

        const allData = await allRes.json();
        const assignedData = assignedRes.ok ? await assignedRes.json() : { data: { skills: [] } };

        const all: Skill[] = (allData.data || []).map((s: any) => ({
          skillId: s.skillId,
          name: s.name,
          description: s.description || '',
          tags: s.tags || [],
        }));

        const assigned: string[] = (assignedData.data?.skills || []).map((s: any) =>
          s.skillId || s
        );

        setSkills(all);
        setAssignedIds(new Set(assigned));
      } catch (e: any) {
        setError(`Failed to load skills: ${e.message}`);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [agentId, teamId]);

  const toggleSkill = useCallback(async (skillId: string, isAssigned: boolean) => {
    setToggling(prev => new Set([...prev, skillId]));
    try {
      const url = `${API_BASE}/api/v2/teams/${teamId}/agents/${agentId}/skills${isAssigned ? `/${skillId}` : ''}`;
      const method = isAssigned ? 'DELETE' : 'POST';
      const body = isAssigned ? undefined : JSON.stringify({ skillId });

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body } : {}),
      });

      if (res.ok) {
        setAssignedIds(prev => {
          const next = new Set(prev);
          if (isAssigned) next.delete(skillId);
          else next.add(skillId);
          return next;
        });
      } else {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        setError(err.error || 'Failed to update skill');
      }
    } catch (e: any) {
      setError(`Error: ${e.message}`);
    } finally {
      setToggling(prev => {
        const next = new Set(prev);
        next.delete(skillId);
        return next;
      });
    }
  }, [agentId, teamId]);

  const filtered = skills.filter(s =>
    !search ||
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.description.toLowerCase().includes(search.toLowerCase()) ||
    s.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="flex flex-col h-full bg-nexus-950 border-l border-nexus-800">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-nexus-800">
        <h3 className="text-sm font-semibold text-slate-200">Skills</h3>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-200 cursor-pointer transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-nexus-800">
        <div className="flex items-center gap-2 bg-nexus-900 rounded-lg px-3 py-1.5">
          <Search size={13} className="text-slate-500 flex-shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search skills…"
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-600 focus:outline-none"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading && (
          <div className="flex items-center justify-center h-32">
            <Loader2 size={20} className="animate-spin text-slate-500" />
          </div>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-red-900/20 border border-red-800 text-red-300 text-xs">
            {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="text-center text-xs text-slate-500 py-8">
            {search ? 'No skills match your search' : 'No skills installed'}
          </div>
        )}

        {!loading && filtered.map(skill => {
          const isAssigned = assignedIds.has(skill.skillId);
          const isToggling = toggling.has(skill.skillId);

          return (
            <label
              key={skill.skillId}
              className={`flex items-start gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors group ${
                isAssigned ? 'bg-nexus-800/60' : 'hover:bg-nexus-900'
              }`}
            >
              {/* Checkbox */}
              <div className="flex-shrink-0 mt-0.5">
                {isToggling ? (
                  <Loader2 size={14} className="animate-spin text-nexus-cyan" />
                ) : (
                  <input
                    type="checkbox"
                    checked={isAssigned}
                    onChange={() => toggleSkill(skill.skillId, isAssigned)}
                    className="w-3.5 h-3.5 accent-teal-400 cursor-pointer"
                  />
                )}
              </div>

              {/* Skill info */}
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium truncate ${isAssigned ? 'text-slate-100' : 'text-slate-300'}`}>
                  {skill.name}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">
                  {skill.description}
                </p>
                {skill.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {skill.tags.slice(0, 3).map(tag => (
                      <span key={tag} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-nexus-800 text-slate-400">
                        <Tag size={8} />
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </label>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-nexus-800 text-[11px] text-slate-500">
        {assignedIds.size} skill{assignedIds.size !== 1 ? 's' : ''} assigned
      </div>
    </div>
  );
};

export default SkillSelector;
