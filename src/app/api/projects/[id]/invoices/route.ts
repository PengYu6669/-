import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET /api/projects/[id]/invoices — 项目下的发票列表（含关联签收单）
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const pageSize = parseInt(url.searchParams.get("pageSize") || "20");
  const search = url.searchParams.get("search") || "";

  const where: Record<string, unknown> = { projectId: id };
  if (search) {
    where.OR = [
      { invoiceNo: { contains: search, mode: "insensitive" } },
      { orderNo: { contains: search, mode: "insensitive" } },
    ];
  }

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: {
        file: { select: { originalName: true, storedPath: true } },
        links: {
          include: {
            receipt: {
              include: { file: { select: { originalName: true, storedPath: true } } },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.invoice.count({ where }),
  ]);

  return NextResponse.json({ invoices, total, page, pageSize });
}
