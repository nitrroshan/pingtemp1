/**
 * CommandPalette — Cmd+K global command overlay
 *
 * Actions: navigate agents, switch views, create team, search tasks
 */

import React, { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, LayoutDashboard, FileCode2, Plus, Bot } from 'lucide-react';
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
import type { ViewMode } from './Sidebar';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: Agent[];
  onSelectAgent: (agent: Agent) => void;
  onSelectView: (view: ViewMode) => void;
  onNewTeam: () => void;
}

const VIEW_ITEMS: { id: ViewMode; label: string; icon: React.ReactNode; shortcut?: string }[] = [
  { id: 'chat',        label: 'Go to Chat',         icon: <MessageSquare size={14} />,   shortcut: '1' },
  { id: 'tasks',       label: 'Go to Tasks',         icon: <LayoutDashboard size={14} />, shortcut: '2' },
  { id: 'collaborate', label: 'Go to Collaborate',   icon: <FileCode2 size={14} />,       shortcut: '3' },
];

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onOpenChange,
  agents,
  onSelectAgent,
  onSelectView,
  onNewTeam,
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

        <CommandGroup heading="Navigation">
          {VIEW_ITEMS.map(item => (
            <CommandItem key={item.id} onSelect={() => handleSelect(() => onSelectView(item.id))}>
              {item.icon}
              {item.label}
              {item.shortcut && <CommandShortcut>⌘{item.shortcut}</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => handleSelect(onNewTeam)}>
            <Plus size={14} />
            New Team
          </CommandItem>
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
