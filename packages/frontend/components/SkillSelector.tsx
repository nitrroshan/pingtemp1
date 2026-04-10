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
import { API_BASE_URL } from '../constants';

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

const API_BASE = API_BASE_URL;

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
        const assignedData = assignedRes.ok ? await assignedRes.json() : { skills: [] };

        const all: Skill[] = (allData.data || allData.skills || []).map((s: any) => ({
          skillId: s.skillId,
          name: s.name,
          description: s.description || '',
          tags: s.tags || [],
        }));

        const assigned: string[] = (assignedData.data?.skills || assignedData.skills || []).map((s: any) =>
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
    <div className="flex flex-col h-full bg-background border-l border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Skills</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-1.5">
          <Search size={13} className="text-muted-foreground flex-shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search skills…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder-muted-foreground focus:outline-none"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading && (
          <div className="flex items-center justify-center h-32">
            <Loader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs">
            {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-8">
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
                isAssigned ? 'bg-primary/10' : 'hover:bg-accent'
              }`}
            >
              {/* Checkbox */}
              <div className="flex-shrink-0 mt-0.5">
                {isToggling ? (
                  <Loader2 size={14} className="animate-spin text-primary" />
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
                <p className={`text-xs font-medium truncate ${isAssigned ? 'text-foreground' : 'text-foreground/80'}`}>
                  {skill.name}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                  {skill.description}
                </p>
                {skill.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {skill.tags.slice(0, 3).map(tag => (
                      <span key={tag} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground">
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
      <div className="px-4 py-2 border-t border-border text-[11px] text-muted-foreground">
        {assignedIds.size} skill{assignedIds.size !== 1 ? 's' : ''} assigned
      </div>
    </div>
  );
};

export default SkillSelector;
