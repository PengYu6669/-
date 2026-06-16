import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// PUT /api/invoices/[id] — 手动修正发票字段
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) return NextResponse.json({ error: "发票不存在" }, { status: 404 });

  // 允许修改的字段
  const allowedFields = [
    "invoiceNo",
    "invoiceCode",
    "amountExclTax",
    "taxAmount",
    "amountInclTax",
    "invoiceDate",
    "sellerName",
    "buyerName",
    "orderNo",
  ];

  const data: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in body) {
      data[key] = body[key];
    }
  }

  const updated = await prisma.invoice.update({ where: { id }, data });

  // 审计日志
  await prisma.auditLog.create({
    data: {
      projectId: invoice.projectId,
      fileId: invoice.fileId,
      step: "manual_edit",
      action: "手动修正发票字段",
      inputData: body as any,
      outputData: data as any,
      status: "success",
    },
  });

  return NextResponse.json(updated);
}
