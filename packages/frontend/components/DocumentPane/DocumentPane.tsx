import React from 'react';
import { ArrowLeft, FileText, X, CheckCircle, RotateCcw } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { DocumentList } from './DocumentList';
import { CrdtDocViewer } from './CrdtDocViewer';
import { WorkspaceFileViewer } from './WorkspaceFileViewer';
import { useUiStore } from '../../stores/uiStore';
import { useGoalSessionStore } from '../../stores/goalSessionStore';

interface DocumentPaneProps {
  teamId: string;
  goalId: string;
}

const DocumentPane: React.FC<DocumentPaneProps> = ({ teamId, goalId }) => {
  const documentPanePath = useUiStore(s => s.documentPanePath);
  const setDocumentPane = useUiStore(s => s.setDocumentPane);
  const sessionState = useGoalSessionStore(s => s.sessionState);

  const handleClose = () => setDocumentPane(null);
  const handleBack = () => useUiStore.setState({ documentPanePath: null });

  // Parse the path to determine what to render
  const renderContent = () => {
    if (!documentPanePath) {
      return <DocumentList teamId={teamId} goalId={goalId} onSelectDoc={setDocumentPane} />;
    }

    if (documentPanePath.startsWith('crdt:')) {
      const docName = documentPanePath.slice(5); // remove "crdt:"
      return <CrdtDocViewer docName={docName} teamId={teamId} goalId={goalId} />;
    }

    if (documentPanePath.startsWith('workspace:')) {
      // Format: "workspace:{path}|{taskId}"
      const rest = documentPanePath.slice(10);
      const separatorIdx = rest.lastIndexOf('|');
      const filePath = rest.slice(0, separatorIdx);
      const taskId = rest.slice(separatorIdx + 1);
      return <WorkspaceFileViewer filePath={filePath} taskId={taskId} teamId={teamId} goalId={goalId} />;
    }

    return <DocumentList teamId={teamId} goalId={goalId} onSelectDoc={setDocumentPane} />;
  };

  // Derive header from current path
  const getTitle = () => {
    if (!documentPanePath) return 'Documents';
    if (documentPanePath === 'crdt:plan') return 'Plan Document';
    if (documentPanePath.includes('/report')) return 'Completion Report';
    if (documentPanePath.includes('/task')) return 'Task Document';
    if (documentPanePath.startsWith('workspace:')) {
      const rest = documentPanePath.slice(10);
      const separatorIdx = rest.lastIndexOf('|');
      return rest.slice(0, separatorIdx);
    }
    return documentPanePath.replace('crdt:', '');
  };

  return (
    <div className="flex flex-col h-full border-l border-border bg-background" style={{ width: 480, minWidth: 320, maxWidth: 640 }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        {documentPanePath ? (
          <Button variant="ghost" size="sm" onClick={handleBack} className="h-6 w-6 p-0">
            <ArrowLeft size={14} />
          </Button>
        ) : (
          <FileText size={14} className="text-primary" />
        )}
        <span className="text-sm font-medium text-foreground truncate flex-1">
          {getTitle()}
        </span>
        {documentPanePath && (
          <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4">
            {documentPanePath.startsWith('crdt:') ? 'CRDT' : 'File'}
          </Badge>
        )}
        <Button variant="ghost" size="sm" onClick={handleClose} className="h-6 w-6 p-0">
          <X size={14} />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {renderContent()}
      </div>

      {/* Approve/Reject footer when viewing plan doc during awaiting_approval */}
      {documentPanePath === 'crdt:plan' && sessionState === 'awaiting_approval' && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-border shrink-0 bg-muted/30">
          <span className="text-[10px] text-muted-foreground">Review the plan above, then approve or request changes</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-7 text-xs"
              onClick={() => {
                useGoalSessionStore.getState().rejectPlan();
              }}
            >
              <RotateCcw size={12} />
              Request Changes
            </Button>
            <Button
              size="sm"
              className="gap-1.5 h-7 text-xs"
              onClick={() => {
                // Show the PlanApproval dialog for final review + approve
                import('../../stores/goalSessionStore').then(({ useGoalSessionStore: store }) => {
                  // Dispatch a custom event to reset the dismissed flag in App.tsx
                  window.dispatchEvent(new CustomEvent('ping:showPlanDialog'));
                });
              }}
            >
              <CheckCircle size={12} />
              Approve Plan
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DocumentPane;
export { DocumentPane };
