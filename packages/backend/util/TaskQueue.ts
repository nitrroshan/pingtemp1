export interface Task {
  task: () => Promise<any>;
  resolve: (value: any | PromiseLike<any>) => void;
  reject: (reason?: any) => void;
}

class TaskQueue {
  private queue: Task[];
  private isProcessing: boolean;
  constructor() {
    this.queue = [];
    this.isProcessing = false;
  }
  async enqueue(task: () => Promise<any>): Promise<any> {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.processQueue();
    });
  }
  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    while (this.queue.length > 0) {
      const { task, resolve, reject } = this.queue.shift()!;

      if (task) {
        try {
          const result = await task();
          resolve(result);
        } catch (error) {
          console.error("Error processing task:", error);
          reject(error);
        }
      }
    }
    this.isProcessing = false;
  }
}
export { TaskQueue };
