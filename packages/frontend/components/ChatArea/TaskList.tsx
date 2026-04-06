import React from 'react';
import { ListTodo, Sparkles } from 'lucide-react';
import { Task } from '../../types';
import TaskItem from './TaskItem';

interface TaskListProps {
  tasks: Task[];
  agentId: string;
  agentName: string;
  onToggleTask: (agentId: string, taskId: string) => void;
  onDeleteTask: (agentId: string, taskId: string) => void;
  onStartTask?: (taskId: string) => void;
  onCompleteTask?: (taskId: string) => void;
  onCancelTask?: (taskId: string) => void;
}

const TaskList: React.FC<TaskListProps> = ({
  tasks,
  agentId,
  agentName,
  onToggleTask,
  onDeleteTask,
  onStartTask,
  onCompleteTask,
  onCancelTask
}) => {
  return (
    <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full p-4 sm:p-8">
      
      {/* Read Only Header / Prompt */}
      <div className="mb-6 flex items-center gap-3 p-4 rounded-xl bg-muted/50 border border-border border-dashed text-muted-foreground">
        <div className="p-2 bg-primary/10 rounded-lg text-primary">
          <Sparkles size={18} />
        </div>
        <p className="text-sm">
          To add new tasks, switch to <strong>Chat</strong> and ask {agentName} to create them.
        </p>
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto space-y-2 scrollbar-thin pb-4">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-56 text-muted-foreground gap-3">
            <div className="w-44 h-28 rounded-2xl border border-border bg-card/50 p-3">
              <svg viewBox="0 0 240 140" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                <rect x="20" y="16" width="200" height="108" rx="14" className="fill-muted/20 stroke-border" />
                <circle cx="48" cy="46" r="8" className="fill-primary/30 stroke-primary/60" />
                <path d="M44 46l3 3 5-6" className="stroke-primary" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <rect x="64" y="40" width="96" height="10" rx="5" className="fill-muted" />
                <circle cx="48" cy="72" r="8" className="fill-muted/40 stroke-muted-foreground/50" />
                <rect x="64" y="66" width="132" height="10" rx="5" className="fill-muted/70" />
                <circle cx="48" cy="98" r="8" className="fill-muted/30 stroke-muted-foreground/40" />
                <rect x="64" y="92" width="84" height="10" rx="5" className="fill-muted/60" />
              </svg>
            </div>
            <ListTodo size={18} className="opacity-70" />
            <p className="text-sm">No tasks assigned to {agentName} yet.</p>
          </div>
        ) : (
          tasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              onToggle={() => onToggleTask(agentId, task.id)}
              onDelete={() => onDeleteTask(agentId, task.id)}
              onStart={onStartTask}
              onComplete={onCompleteTask}
              onCancel={onCancelTask}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default TaskList;
