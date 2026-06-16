import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET /api/audit-logs?projectId=xxx&step=ocr&page=1
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  const step = url.searchParams.get("step");
  const page = parseInt(url.searchParams.get("page") || "1");
  const pageSize = parseInt(url.searchParams.get("pageSize") || "50");

  const where: Record<string, unknown> = {};
  if (projectId) where.projectId = projectId;
  if (step) where.step = step;

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return NextResponse.json({ logs, total, page, pageSize });
}
