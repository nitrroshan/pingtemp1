/**
 * CommandPalette — Cmd+K global command overlay
 *
 * Actions: navigate agents, create team
 */

import React, { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Bot, ListTodo } from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from './ui/command';
import type { Agent } from '../types';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: Agent[];
  onSelectAgent: (agent: Agent) => void;
  onNewTeam: () => void;
  onViewPlans?: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onOpenChange,
  agents,
  onSelectAgent,
  onNewTeam,
  onViewPlans,
}) => {
  const handleSelect = useCallback((fn: () => void) => {
    fn();
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => handleSelect(onNewTeam)}>
            <Plus size={14} />
            New Team
          </CommandItem>
          {onViewPlans && (
            <CommandItem onSelect={() => handleSelect(onViewPlans)}>
              <ListTodo size={14} />
              View All Plans
              <CommandShortcut>Global</CommandShortcut>
            </CommandItem>
          )}
        </CommandGroup>

        {agents.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Teams">
              {agents.map(agent => (
                <CommandItem key={agent.id} onSelect={() => handleSelect(() => onSelectAgent(agent))}>
                  <Bot size={14} />
                  {agent.name}
                  {agent.role && <CommandShortcut>{agent.role}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
};
