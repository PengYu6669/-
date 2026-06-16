import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET /api/projects — 项目列表
export async function GET() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { files: true, invoices: true, receipts: true } },
    },
  });
  return NextResponse.json(projects);
}

// POST /api/projects — 创建项目
export async function POST(req: NextRequest) {
  const { name } = await req.json();
  const project = await prisma.project.create({
    data: { name: name || `项目 ${new Date().toLocaleDateString("zh-CN")}` },
  });
  return NextResponse.json(project, { status: 201 });
}
