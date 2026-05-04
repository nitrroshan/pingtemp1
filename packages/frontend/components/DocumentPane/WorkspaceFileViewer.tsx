import React, { useEffect, useState } from 'react';
import { FileCode, Loader2, AlertCircle } from 'lucide-react';
import { agentServiceV2 } from '../../services/AgentServiceV2';

interface WorkspaceFileViewerProps {
  filePath: string;
  taskId: string;
  teamId: string;
  goalId: string;
}

const WorkspaceFileViewer: React.FC<WorkspaceFileViewerProps> = ({ filePath, taskId, teamId, goalId }) => {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    agentServiceV2.readWorkspaceFile(teamId, goalId, filePath, taskId)
      .then(c => { setContent(c); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [teamId, goalId, filePath, taskId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
        <Loader2 size={16} className="animate-spin" />
        Loading file...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <AlertCircle size={20} className="text-destructive" />
        <span className="text-sm">{error}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
        <FileCode size={14} className="text-blue-400" />
        <span className="text-xs font-mono text-foreground truncate">{filePath}</span>
      </div>
      <div className="flex-1 overflow-auto p-3">
        <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed">
          {content}
        </pre>
      </div>
    </div>
  );
};

export default WorkspaceFileViewer;
export { WorkspaceFileViewer };
