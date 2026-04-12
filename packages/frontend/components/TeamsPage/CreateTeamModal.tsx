/**
 * CreateTeamModal — form for creating a new team
 */

import React, { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { agentServiceV2 } from '../../services/AgentServiceV2';

interface CreateTeamModalProps {
  onClose: () => void;
  onConfirm: (name: string, goal: string, description: string, pluginName?: string) => Promise<void>;
}

export function CreateTeamModal({ onClose, onConfirm }: CreateTeamModalProps) {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [description, setDescription] = useState('');
  const [pluginName, setPluginName] = useState('');
  const [plugins, setPlugins] = useState<Array<{ name: string; description: string }>>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load available plugins on mount
  useEffect(() => {
    agentServiceV2.getPlugins().then(({ plugins: loaded }) => {
      setPlugins(loaded);
    }).catch(() => { /* registry unavailable — hide plugin selector */ });
  }, []);

  // Auto-fill name when plugin selected
  const handlePluginChange = (selected: string) => {
    setPluginName(selected);
    if (selected) {
      const plugin = plugins.find(p => p.name === selected);
      if (plugin) {
        if (!name) setName(plugin.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));
        if (!goal) setGoal(plugin.description);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !goal.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await onConfirm(name.trim(), goal.trim(), description.trim(), pluginName || undefined);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create team');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    /* Overlay */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Create New Team</h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Plugin selector */}
          {plugins.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground" htmlFor="team-plugin">
                Plugin Template
              </label>
              <select
                id="team-plugin"
                value={pluginName}
                onChange={e => handlePluginChange(e.target.value)}
                className={cn(
                  'w-full px-3 py-2 rounded-md text-sm bg-input border border-border text-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring'
                )}
              >
                <option value="">Custom (LLM discovers roles)</option>
                {plugins.map(p => (
                  <option key={p.name} value={p.name}>
                    {p.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} — {p.description}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {pluginName ? 'Agents loaded from plugin .md files' : 'LLM will discover roles (requires API key)'}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground" htmlFor="team-name">
              Team Name <span className="text-destructive">*</span>
            </label>
            <input
              id="team-name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Engineering Team"
              className={cn(
                'w-full px-3 py-2 rounded-md text-sm bg-input border border-border text-foreground',
                'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
              )}
              autoFocus
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground" htmlFor="team-goal">
              Goal <span className="text-destructive">*</span>
            </label>
            <input
              id="team-goal"
              type="text"
              value={goal}
              onChange={e => setGoal(e.target.value)}
              placeholder="e.g. Build and maintain our core product"
              className={cn(
                'w-full px-3 py-2 rounded-md text-sm bg-input border border-border text-foreground',
                'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
              )}
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground" htmlFor="team-desc">
              Description
            </label>
            <textarea
              id="team-desc"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional — briefly describe this team's responsibilities"
              rows={3}
              className={cn(
                'w-full px-3 py-2 rounded-md text-sm bg-input border border-border text-foreground resize-none',
                'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
              )}
            />
          </div>

          {error && (
            <p className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-md">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim() || !goal.trim()}
              className="flex items-center gap-2 px-4 py-1.5 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting && <Loader2 size={13} className="animate-spin" />}
              {isSubmitting ? 'Creating…' : 'Create Team'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
