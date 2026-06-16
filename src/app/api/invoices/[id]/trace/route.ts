import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET /api/invoices/[id]/trace — 发票溯源
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      file: { select: { id: true, originalName: true, storedPath: true, fileType: true } },
    },
  });
  if (!invoice) return NextResponse.json({ error: "发票不存在" }, { status: 404 });

  const auditLogs = await prisma.auditLog.findMany({
    where: { fileId: invoice.fileId },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    invoice: {
      ...invoice,
      amountExclTax: invoice.amountExclTax ? Number(invoice.amountExclTax) : null,
      taxAmount: invoice.taxAmount ? Number(invoice.taxAmount) : null,
      amountInclTax: invoice.amountInclTax ? Number(invoice.amountInclTax) : null,
    },
    auditLogs,
    sourceFile: {
      id: invoice.file.id,
      name: invoice.file.originalName,
      path: invoice.file.storedPath,
      type: invoice.file.fileType,
    },
  });
}
