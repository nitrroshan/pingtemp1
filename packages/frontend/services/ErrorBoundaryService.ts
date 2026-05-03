import type { AgentServiceV2 } from './AgentServiceV2';

export interface ErrorBoundaryServiceOptions {
  showToast: (message: string, type: 'success' | 'warning' | 'error' | 'info') => void;
}

export function bindErrorBoundaryService(
  agentService: AgentServiceV2,
  options: ErrorBoundaryServiceOptions,
): () => void {
  return agentService.onHttpError((message, status) => {
    if (status === 401) {
      options.showToast(message, 'error');
      return;
    }

    options.showToast(message, 'error');
  });
}