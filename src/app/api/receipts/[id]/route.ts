import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// PUT /api/receipts/[id] — 手动修正签收单字段
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  const receipt = await prisma.receipt.findUnique({ where: { id } });
  if (!receipt) return NextResponse.json({ error: "签收单不存在" }, { status: 404 });

  const allowedFields = [
    "documentCode", "orderNo", "receiptDate", "recipient",
  ];

  const data: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in body) {
      if (key === "receiptDate" && body[key]) {
        data[key] = new Date(body[key]);
      } else {
        data[key] = body[key];
      }
    }
  }

  const updated = await prisma.receipt.update({ where: { id }, data });

  await prisma.auditLog.create({
    data: {
      projectId: receipt.projectId,
      fileId: receipt.fileId,
      step: "manual_edit",
      action: "手动修正签收单字段",
      inputData: body as any,
      outputData: data as any,
      status: "success",
    },
  });

  return NextResponse.json(updated);
}
