import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET /api/receipts/[id]/trace — 签收单溯源
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const receipt = await prisma.receipt.findUnique({
    where: { id },
    include: {
      file: { select: { id: true, originalName: true, storedPath: true, fileType: true } },
    },
  });
  if (!receipt) return NextResponse.json({ error: "签收单不存在" }, { status: 404 });

  const auditLogs = await prisma.auditLog.findMany({
    where: { fileId: receipt.fileId },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    receipt,
    auditLogs,
    sourceFile: {
      id: receipt.file.id,
      name: receipt.file.originalName,
      path: receipt.file.storedPath,
      type: receipt.file.fileType,
    },
  });
}
