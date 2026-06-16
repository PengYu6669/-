import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET /api/projects/[id] — 项目详情
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      _count: { select: { files: true, invoices: true, receipts: true, links: true } },
    },
  });
  if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  return NextResponse.json(project);
}

// PUT /api/projects/[id] — 重命名项目
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { name } = await req.json();
  const project = await prisma.project.update({
    where: { id },
    data: { name },
  });
  return NextResponse.json(project);
}

// DELETE /api/projects/[id] — 删除项目
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.project.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
