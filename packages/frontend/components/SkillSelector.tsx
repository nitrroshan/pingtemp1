/**
 * SkillSelector — Per-agent skill viewer
 *
 * Displays the team's available skills from the registry plugin.
 * Highlights which skills are assigned to this specific agent
 * (from defaultSkills in the agent's .md file).
 *
 * Read-only — skills are defined in SKILL.md files and agent .md defaultSkills.
 *
 * Props:
 *   agentId   — The agent ID (from team/agent model)
 *   teamId    — Team context (for the skills API path)
 *   onClose   — Close the selector panel
 */

import React, { useState, useEffect } from 'react';
import { X, Search, Tag, Loader2, CheckCircle2 } from 'lucide-react';
import { agentServiceV2 } from '../services/AgentServiceV2';

interface SkillInfo {
  id: string;
  name: string;
  description: string;
}

interface SkillSelectorProps {
  agentId: string;
  teamId: string;
  onClose: () => void;
}

const SkillSelector: React.FC<SkillSelectorProps> = ({ agentId, teamId, onClose }) => {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [agentSkillIds, setAgentSkillIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        // Fetch team's available skills and agents in parallel
        const [skillsRes, agentsRes] = await Promise.all([
          agentServiceV2.getTeamSkills(teamId),
          agentServiceV2.getAgents(teamId),
        ]);

        setSkills(skillsRes.skills);

        // Find this agent's defaultSkills from the agents response
        const agent = agentsRes.agents.find(
          (a: any) => a.id === agentId || a.role === agentId
        );
        setAgentSkillIds(new Set(agent?.skills ?? []));
      } catch (e: any) {
        setError(`Failed to load skills: ${e.message}`);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [agentId, teamId]);

  const filtered = skills.filter(s =>
    !search ||
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.description.toLowerCase().includes(search.toLowerCase())
  );

  const assignedCount = skills.filter(s => agentSkillIds.has(s.id)).length;

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
            {search ? 'No skills match your search' : 'No skills defined for this team'}
          </div>
        )}

        {!loading && filtered.map(skill => {
          const isAssigned = agentSkillIds.has(skill.id);

          return (
            <div
              key={skill.id}
              className={`flex items-start gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                isAssigned ? 'bg-primary/10' : 'bg-muted/30'
              }`}
            >
              {/* Assignment indicator */}
              <div className="flex-shrink-0 mt-0.5">
                {isAssigned ? (
                  <CheckCircle2 size={14} className="text-primary" />
                ) : (
                  <div className="w-3.5 h-3.5 rounded-full border border-muted-foreground/30" />
                )}
              </div>

              {/* Skill info */}
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium truncate ${isAssigned ? 'text-foreground' : 'text-foreground/60'}`}>
                  {skill.name}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                  {skill.description}
                </p>
                {isAssigned && (
                  <span className="inline-flex items-center gap-0.5 mt-1 px-1.5 py-0.5 rounded text-[10px] bg-primary/15 text-primary">
                    <Tag size={8} />
                    assigned
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-border text-[11px] text-muted-foreground">
        {assignedCount} of {skills.length} skill{skills.length !== 1 ? 's' : ''} assigned · Defined in agent .md
      </div>
    </div>
  );
};

export default SkillSelector;
