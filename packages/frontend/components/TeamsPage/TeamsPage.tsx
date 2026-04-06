/**
 * TeamsPage — full-page team management UI
 *
 * Shows a card grid of all teams with create / delete actions.
 * Route: /manage-teams
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Plus, Trash2, Users, Loader2, RefreshCw,
} from 'lucide-react';
import { agentServiceV2, type TeamResponse } from '../../services/AgentServiceV2';
import { cn } from '../../lib/utils';
import { CreateTeamModal } from './CreateTeamModal';
import type { Agent } from '../../types';

interface TeamsPageProps {
  onBack: () => void;
  /** Called after a new team is successfully created — lets App.tsx merge it into the tree */
  onTeamCreated?: (team: Agent) => void;
}

export function TeamsPage({ onBack, onTeamCreated }: TeamsPageProps) {
  const [teams, setTeams] = useState<TeamResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadTeams = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { teams: loaded } = await agentServiceV2.getTeams();
      setTeams(loaded);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load teams');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadTeams(); }, [loadTeams]);

  const handleCreate = useCallback(async (name: string, goal: string, description: string) => {
    const { team } = await agentServiceV2.createTeam(name, goal, description);
    setTeams(prev => [...prev, team]);
    if (onTeamCreated) {
      const agentTeam: Agent = {
        id: team.id,
        name: team.name,
        role: 'Manager',
        description: team.description ?? goal,
        icon: 'Cpu',
        subAgents: [],
        collapsed: false,
      };
      onTeamCreated(agentTeam);
    }
  }, [onTeamCreated]);

  const handleDelete = useCallback(async (teamId: string) => {
    setDeletingId(teamId);
    try {
      await agentServiceV2.deleteTeam(teamId);
      setTeams(prev => prev.filter(t => t.id !== teamId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete team');
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }, []);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 h-12 border-b border-border shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <span className="text-muted-foreground">·</span>
        <h1 className="text-sm font-semibold text-foreground">Manage Teams</h1>
        <div className="flex-1" />
        <button
          onClick={loadTeams}
          disabled={isLoading}
          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50 cursor-pointer"
          title="Refresh"
        >
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={() => setIsCreateOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
        >
          <Plus size={13} />
          New Team
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          {error && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-36 rounded-xl bg-card border border-border animate-pulse" />
              ))}
            </div>
          ) : teams.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
              <Users size={32} className="opacity-30" />
              <p className="text-sm">No teams yet</p>
              <button
                onClick={() => setIsCreateOpen(true)}
                className="text-sm text-primary hover:underline cursor-pointer"
              >
                Create your first team
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {teams.map(team => (
                <div
                  key={team.id}
                  className="flex flex-col bg-card border border-border rounded-xl p-4 gap-3 hover:border-primary/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Users size={14} className="text-primary" />
                    </div>
                    <button
                      onClick={() => setConfirmDeleteId(team.id)}
                      disabled={deletingId === team.id}
                      className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer disabled:opacity-50"
                      title="Delete team"
                    >
                      {deletingId === team.id
                        ? <Loader2 size={13} className="animate-spin" />
                        : <Trash2 size={13} />}
                    </button>
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-foreground truncate">{team.name}</h3>
                    {team.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{team.description}</p>
                    )}
                    {!team.description && team.goal && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 italic">{team.goal}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Users size={11} />
                    <span>{team.memberCount} {team.memberCount === 1 ? 'agent' : 'agents'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation dialog */}
      {confirmDeleteId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmDeleteId(null); }}
        >
          <div className={cn(
            'bg-card border border-border rounded-xl shadow-2xl w-full max-w-sm mx-4 p-5 space-y-4 animate-fade-in'
          )}>
            <h3 className="text-sm font-semibold text-foreground">Delete Team</h3>
            <p className="text-xs text-muted-foreground">
              Are you sure you want to delete{' '}
              <span className="font-medium text-foreground">
                {teams.find(t => t.id === confirmDeleteId)?.name}
              </span>
              ? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-4 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDeleteId)}
                className="px-4 py-1.5 rounded-md text-sm bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {isCreateOpen && (
        <CreateTeamModal onClose={() => setIsCreateOpen(false)} onConfirm={handleCreate} />
      )}
    </div>
  );
}
