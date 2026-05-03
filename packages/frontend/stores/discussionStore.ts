import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { DiscussionThread } from '../hooks/useDiscussion';

interface DiscussionStoreState {
  threads: DiscussionThread[];
  recordActivity: (data: { docName: string; taskId?: string; blockCount: number; timestamp: number | string }) => void;
  markThreadRead: (docName: string) => void;
  reset: () => void;
}

export const useDiscussionStore = create<DiscussionStoreState>()(devtools((set) => ({
  threads: [],

  recordActivity: (data) => {
    const timestamp = new Date(data.timestamp).toISOString();
    set((prev) => {
      const idx = prev.threads.findIndex((thread) => thread.docName === data.docName);
      if (idx >= 0) {
        const threads = [...prev.threads];
        threads[idx] = {
          ...threads[idx],
          blockCount: data.blockCount,
          lastActivity: timestamp,
          unreadCount: threads[idx].unreadCount + 1,
        };
        return { threads };
      }

      return {
        threads: [...prev.threads, {
          docName: data.docName,
          taskId: data.taskId ?? '',
          title: `Discussion: ${data.taskId ?? data.docName}`,
          participants: [],
          blockCount: data.blockCount,
          status: 'active',
          unreadCount: 1,
          lastActivity: timestamp,
        }],
      };
    });
  },

  markThreadRead: (docName) => {
    set((prev) => ({
      threads: prev.threads.map((thread) =>
        thread.docName === docName ? { ...thread, unreadCount: 0 } : thread,
      ),
    }));
  },

  reset: () => set({ threads: [] }),
}), { name: 'DiscussionStore' }));