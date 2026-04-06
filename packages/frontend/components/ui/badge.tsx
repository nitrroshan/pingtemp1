import * as React from 'react';
import { cn } from '../../lib/utils';

const Badge = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement> & {
    variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info';
  }
>(({ className, variant = 'default', ...props }, ref) => {
  const variantClasses: Record<string, string> = {
    default: 'bg-primary/20 text-primary border-primary/30',
    secondary: 'bg-secondary text-secondary-foreground border-border',
    destructive: 'bg-destructive/20 text-destructive border-destructive/30',
    outline: 'bg-transparent border-border text-foreground',
    success: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
    warning: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30',
    info: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30',
  };

  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        variantClasses[variant],
        className
      )}
      {...props}
    />
  );
});
Badge.displayName = 'Badge';

export { Badge };
