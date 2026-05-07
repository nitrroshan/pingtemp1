import React, { Suspense, lazy, Component, type ReactNode } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';

// Lazy-load CollaborativeEditor to avoid loading BlockNote/Hocuspocus upfront
const CollaborativeEditor = lazy(() => import('../CollaborativeEditor'));

// Error boundary that catches ProseMirror/Yjs crashes and shows fallback instead of black screen
class CrdtErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error?: string }> {
  state = { hasError: false, error: undefined as string | undefined };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }

  componentDidCatch(error: Error) {
    console.warn('[CrdtDocViewer] Editor crashed, showing fallback:', error.message);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground p-6">
          <AlertTriangle size={24} className="text-yellow-500" />
          <div className="text-sm font-medium">Editor failed to load</div>
          <div className="text-xs text-center max-w-[300px] text-muted-foreground">
            {this.state.error || 'Unknown error'}
          </div>
          <button
            className="text-xs text-primary hover:underline"
            onClick={() => this.setState({ hasError: false, error: undefined })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

interface CrdtDocViewerProps {
  docName: string;
  teamId: string;
  goalId: string;
}

const CrdtDocViewer: React.FC<CrdtDocViewerProps> = ({ docName, teamId, goalId }) => {
  // Construct full Hocuspocus docId: {teamId}/{goalId}/{docName}
  const docId = `${teamId}/${goalId}/${docName}`;

  return (
    <div className="flex flex-col h-full">
      <CrdtErrorBoundary>
        <Suspense fallback={
          <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
            <Loader2 size={16} className="animate-spin" />
            Loading editor...
          </div>
        }>
          <CollaborativeEditor
            docId={docId}
            userName="user"
          />
        </Suspense>
      </CrdtErrorBoundary>
    </div>
  );
};

export default CrdtDocViewer;
export { CrdtDocViewer };
