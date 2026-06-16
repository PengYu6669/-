import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET /api/cells/trace?type=invoice&id=xxx&field=invoice.invoiceNo
// 单元格级溯源：返回对应记录的完整溯源信息
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const id = url.searchParams.get("id");
  const field = url.searchParams.get("field") || "";

  if (!type || !id) {
    return NextResponse.json({ error: "缺少参数" }, { status: 400 });
  }

  if (type === "invoice") {
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
      recordType: "invoice",
      record: {
        ...invoice,
        amountExclTax: invoice.amountExclTax ? Number(invoice.amountExclTax) : null,
        taxAmount: invoice.taxAmount ? Number(invoice.taxAmount) : null,
        amountInclTax: invoice.amountInclTax ? Number(invoice.amountInclTax) : null,
      },
      sourceFile: {
        id: invoice.file.id,
        name: invoice.file.originalName,
        type: invoice.file.fileType,
      },
      auditLogs,
      highlightedField: field,
    });
  }

  if (type === "receipt") {
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
      recordType: "receipt",
      record: receipt,
      sourceFile: {
        id: receipt.file.id,
        name: receipt.file.originalName,
        type: receipt.file.fileType,
      },
      auditLogs,
      highlightedField: field,
    });
  }

  return NextResponse.json({ error: "未知类型" }, { status: 400 });
}
