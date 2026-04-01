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
      <div className="mb-6 flex items-center gap-3 p-4 rounded-xl bg-nexus-900/50 border border-nexus-800 border-dashed text-slate-400">
        <div className="p-2 bg-nexus-800 rounded-lg text-nexus-cyan">
          <Sparkles size={18} />
        </div>
        <p className="text-sm">
          To add new tasks, switch to <strong>Chat</strong> and ask {agentName} to create them.
        </p>
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto space-y-2 scrollbar-thin pb-4">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-slate-600">
            <ListTodo size={32} className="mb-2 opacity-50" />
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
