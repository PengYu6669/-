import { NextRequest, NextResponse } from "next/server";
import { processProject } from "@/lib/pipeline";

// POST /api/projects/[id]/process — 触发处理
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // 异步处理，不阻塞响应
  processProject(id).catch(console.error);

  return NextResponse.json({ message: "处理已启动", projectId: id });
}
