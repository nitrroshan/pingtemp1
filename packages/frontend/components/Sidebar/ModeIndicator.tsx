/**
 * ModeIndicator — agent autonomy mode icon.
 *
 * 🟢 auto, 🟡 review, ⚪ manual
 * v1.1: static display only (no click — backend doesn't support mode changes yet)
 * v2.0: click-to-cycle wired via POST /api/v2/teams/{id}/roles/{role}/mode
 */

import React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

type Mode = 'auto' | 'review' | 'manual';

interface ModeIndicatorProps {
  mode?: Mode;
}

const MODE_CONFIG: Record<Mode, { icon: string; label: string; tooltip: string }> = {
  auto:   { icon: '🟢', label: 'auto',   tooltip: 'Auto mode — workers dispatch immediately' },
  review: { icon: '🟡', label: 'review', tooltip: 'Review mode — approve before dispatch' },
  manual: { icon: '⚪', label: 'manual', tooltip: 'Manual mode — you say go' },
};

export const ModeIndicator: React.FC<ModeIndicatorProps> = ({ mode = 'auto' }) => {
  const config = MODE_CONFIG[mode] ?? MODE_CONFIG.auto;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-[10px] shrink-0 cursor-default select-none" aria-label={config.tooltip}>
          {config.icon}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-[10px]">
        {config.tooltip}
      </TooltipContent>
    </Tooltip>
  );
};
