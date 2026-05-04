import React, { useEffect, useState } from 'react';
import { FileText, FolderOpen, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { agentServiceV2 } from '../../services/AgentServiceV2';
import { useGoalSessionStore } from '../../stores/goalSessionStore';

interface DocumentListProps {
  teamId: string;
  goalId: string;
  onSelectDoc: (path: string) => void;
}

interface DocEntry {
  id: string;
  name: string;
  type: 'plan' | 'task' | 'report' | 'custom' | 'workspace';
  status?: string;
  role?: string;
  taskTitle?: string;
}

function classifyDoc(docName: string, tasks: any[]): DocEntry {
  if (docName === 'plan') {
    return { id: `crdt:plan`, name: 'Plan Document', type: 'plan' };
  }
  if (docName === 'goal') {
    return { id: `crdt:goal`, name: 'Goal', type: 'custom' };
  }

  // task docs: {taskId}/task or {taskId}/report
  const taskMatch = docName.match(/^(.+)\/(task|report)$/);
  if (taskMatch) {
    const [, taskId, docType] = taskMatch;
    const task = tasks.find(t => t.id === taskId);
    return {
      id: `crdt:${docName}`,
      name: task ? `${task.title || taskId}` : taskId,
      type: docType === 'report' ? 'report' : 'task',
      status: task?.status,
      role: task?.assignedRole,
      taskTitle: task?.title,
    };
  }

  return { id: `crdt:${docName}`, name: docName, type: 'custom' };
}

const statusIcon: Record<string, string> = {
  completed: '✅',
  in_progress: '⏳',
  ready: '○',
  pending: '○',
  failed: '❌',
};

const DocumentList: React.FC<DocumentListProps> = ({ teamId, goalId, onSelectDoc }) => {
  const tasks = useGoalSessionStore(s => s.tasks);
  const [crdtDocs, setCrdtDocs] = useState<string[]>([]);
  const [workspaceFiles, setWorkspaceFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDocs = async () => {
    setLoading(true);
    try {
      const [docs, files] = await Promise.all([
        agentServiceV2.listCrdtDocs(teamId),
        agentServiceV2.listWorkspaceFiles(teamId, goalId),
      ]);
      // Filter CRDT docs to this goal's prefix
      const goalPrefix = `${goalId}/`;
      const goalDocs = docs
        .filter(d => d.startsWith(goalPrefix))
        .map(d => d.slice(goalPrefix.length));
      // Also include docs without prefix that are known system docs
      if (docs.includes('plan') || docs.includes(`${goalId}/plan`)) {
        if (!goalDocs.includes('plan')) goalDocs.unshift('plan');
      }
      setCrdtDocs(goalDocs);
      setWorkspaceFiles(files);
    } catch {
      // Silent — empty lists
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDocs(); }, [teamId, goalId]);

  const entries = crdtDocs.map(d => classifyDoc(d, tasks));
  const planDocs = entries.filter(e => e.type === 'plan');
  const taskDocs = entries.filter(e => e.type === 'task');
  const reportDocs = entries.filter(e => e.type === 'report');
  const customDocs = entries.filter(e => e.type === 'custom');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
        <Loader2 size={16} className="animate-spin" />
        Loading documents...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-sm font-medium text-foreground">Documents</span>
        <Button variant="ghost" size="sm" onClick={loadDocs} className="h-6 w-6 p-0">
          <RefreshCw size={12} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
        {/* Plan */}
        {planDocs.length > 0 && (
          <Section title="📋 Plan">
            {planDocs.map(doc => (
              <DocRow key={doc.id} doc={doc} onClick={() => onSelectDoc(doc.id)} />
            ))}
          </Section>
        )}

        {/* Tasks */}
        {taskDocs.length > 0 && (
          <Section title={`📝 Tasks (${taskDocs.length})`}>
            {taskDocs.map(doc => (
              <DocRow key={doc.id} doc={doc} onClick={() => onSelectDoc(doc.id)} />
            ))}
          </Section>
        )}

        {/* Reports */}
        {reportDocs.length > 0 && (
          <Section title={`📄 Reports (${reportDocs.length})`}>
            {reportDocs.map(doc => (
              <DocRow key={doc.id} doc={doc} onClick={() => onSelectDoc(doc.id)} />
            ))}
          </Section>
        )}

        {/* Custom docs */}
        {customDocs.length > 0 && (
          <Section title="📎 Other">
            {customDocs.map(doc => (
              <DocRow key={doc.id} doc={doc} onClick={() => onSelectDoc(doc.id)} />
            ))}
          </Section>
        )}

        {/* Workspace files */}
        {workspaceFiles.length > 0 && (
          <Section title={`📁 Workspace Files (${workspaceFiles.length})`}>
            {workspaceFiles.map((f, i) => (
              <button
                key={`ws-${i}`}
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors text-left"
                onClick={() => onSelectDoc(`workspace:${f.path}|${f.taskId}`)}
              >
                <FolderOpen size={12} className="flex-shrink-0 text-blue-400" />
                <span className="truncate">{f.path}</span>
              </button>
            ))}
          </Section>
        )}

        {entries.length === 0 && workspaceFiles.length === 0 && (
          <div className="text-center text-muted-foreground text-xs py-8">
            No documents yet. Documents appear when agents start working.
          </div>
        )}
      </div>
    </div>
  );
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function DocRow({ doc, onClick }: { doc: DocEntry; onClick: () => void }) {
  return (
    <button
      className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs hover:bg-accent hover:text-foreground transition-colors text-left group"
      onClick={onClick}
    >
      <FileText size={12} className="flex-shrink-0 text-primary" />
      <span className="truncate flex-1 text-foreground">{doc.name}</span>
      {doc.status && (
        <span className="text-[10px] flex-shrink-0">{statusIcon[doc.status] || doc.status}</span>
      )}
      {doc.role && (
        <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">{doc.role}</Badge>
      )}
      <ChevronRight size={12} className="flex-shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
    </button>
  );
}

export default DocumentList;
export { DocumentList };
