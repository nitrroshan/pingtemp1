import React, { Suspense, lazy } from 'react';
import { Loader2 } from 'lucide-react';

// Lazy-load CollaborativeEditor to avoid loading BlockNote/Hocuspocus upfront
const CollaborativeEditor = lazy(() => import('../CollaborativeEditor'));

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
    </div>
  );
};

export default CrdtDocViewer;
export { CrdtDocViewer };
