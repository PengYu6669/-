/**
 * 后台任务队列
 * 控制并发数 + 防重复，避免多项目同时处理时资源耗尽
 */

import { processProject } from "@/lib/pipeline";

const MAX_CONCURRENT = 3;

interface Task {
  projectId: string;
  status: "queued" | "running" | "done" | "failed";
  force?: boolean;
  error?: string;
  startedAt?: number;
  progress?: { step: string; done: number; total: number };
}

const tasks = new Map<string, Task>();
let running = 0;
const waitQueue: string[] = [];

/** 提交处理任务。force=true 时即使已在队列中也允许重新入队 */
export function enqueueProcess(projectId: string, force = false): { status: string; position: number } {
  if (!force) {
    const existing = tasks.get(projectId);
    if (existing && (existing.status === "queued" || existing.status === "running")) {
      const pos = waitQueue.indexOf(projectId);
      return { status: existing.status, position: pos >= 0 ? pos + 1 : 0 };
    }
  }

  tasks.set(projectId, { projectId, status: "queued", force });
  waitQueue.push(projectId);
  tick();

  return { status: "queued", position: waitQueue.indexOf(projectId) + 1 };
}

/** 查询任务状态（含进度） */
export function getTaskStatus(projectId: string): Task | null {
  return tasks.get(projectId) || null;
}

/** 更新处理进度（由 pipeline 调用） */
export function updateProgress(projectId: string, progress: { step: string; done: number; total: number }) {
  const task = tasks.get(projectId);
  if (task) task.progress = progress;
}

function tick() {
  while (running < MAX_CONCURRENT && waitQueue.length > 0) {
    const projectId = waitQueue.shift()!;
    const task = tasks.get(projectId);
    if (!task || task.status !== "queued") continue;

    task.status = "running";
    task.startedAt = Date.now();
    running++;

    processProject(projectId, (p) => updateProgress(projectId, p), task.force)
      .then(() => {
        task.status = "done";
      })
      .catch((err: Error) => {
        task.status = "failed";
        task.error = err.message;
        console.error(`❌ processProject ${projectId} failed:`, err.message);
      })
      .finally(() => {
        running--;
        tick(); // 处理下一个
      });
  }
}
