/**
 * 后台任务队列
 * 控制并发数 + 防重复，避免多项目同时处理时资源耗尽
 */

import { processProject } from "@/lib/pipeline";

const MAX_CONCURRENT = 3;

interface Task {
  projectId: string;
  status: "queued" | "running" | "done" | "failed";
  error?: string;
  startedAt?: number;
}

const tasks = new Map<string, Task>();
let running = 0;
const waitQueue: string[] = [];

/** 提交处理任务，返回当前状态。如果已在队列中则跳过 */
export function enqueueProcess(projectId: string): { status: string; position: number } {
  const existing = tasks.get(projectId);
  if (existing && (existing.status === "queued" || existing.status === "running")) {
    const pos = waitQueue.indexOf(projectId);
    return { status: existing.status, position: pos >= 0 ? pos + 1 : 0 };
  }

  tasks.set(projectId, { projectId, status: "queued" });
  waitQueue.push(projectId);
  tick();

  return { status: "queued", position: waitQueue.indexOf(projectId) + 1 };
}

/** 查询任务状态 */
export function getTaskStatus(projectId: string): Task | null {
  return tasks.get(projectId) || null;
}

function tick() {
  while (running < MAX_CONCURRENT && waitQueue.length > 0) {
    const projectId = waitQueue.shift()!;
    const task = tasks.get(projectId);
    if (!task || task.status !== "queued") continue;

    task.status = "running";
    task.startedAt = Date.now();
    running++;

    processProject(projectId)
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
