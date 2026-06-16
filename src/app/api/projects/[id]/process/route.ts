import { NextRequest, NextResponse } from "next/server";
import { enqueueProcess, getTaskStatus } from "@/lib/queue";

// POST /api/projects/[id]/process — 提交处理任务到后台队列
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = enqueueProcess(id);

  return NextResponse.json({
    message: result.status === "queued"
      ? `已加入队列（第 ${result.position} 位）`
      : result.status === "running"
      ? "正在处理中"
      : "处理中",
    projectId: id,
    status: result.status,
    queuePosition: result.position,
  });
}

// GET /api/projects/[id]/process — 查询处理任务状态
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const task = getTaskStatus(id);
  if (!task) {
    return NextResponse.json({ status: "none", message: "无处理任务" });
  }
  return NextResponse.json({
    status: task.status,
    error: task.error,
    startedAt: task.startedAt,
  });
}
