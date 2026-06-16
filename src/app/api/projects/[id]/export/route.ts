import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import ExcelJS from "exceljs";

// GET /api/projects/[id]/export — 按预览字段导出 Excel
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const template = await prisma.template.findFirst({
    where: { projectId: id },
    include: { mappings: { orderBy: { columnIndex: "asc" } } },
    orderBy: { createdAt: "desc" },
  });

  const invoices = await prisma.invoice.findMany({
    where: { projectId: id },
    include: { links: { include: { receipt: true } } },
    orderBy: { invoiceNo: "asc" },
  });

  // ── 确定列定义（与 preview-data 一致）──
  let columns: { header: string; extract: (inv: typeof invoices[number]) => string }[];

  if (template && template.mappings.length > 0) {
    columns = template.mappings.map((m) => {
      const header = m.headerName;
      return {
        header,
        extract: (inv) => {
          if (m.sourceType === "invoice" && m.sourceField) {
            const field = m.sourceField.replace("invoice.", "");
            return fmtVal((inv as unknown as Record<string, unknown>)[field]);
          }
          if (m.sourceType === "receipt" && m.sourceField) {
            const receipt = inv.links[0]?.receipt;
            if (!receipt) return "";
            const field = m.sourceField.replace("receipt.", "");
            return fmtVal((receipt as unknown as Record<string, unknown>)[field]);
          }
          if (m.sourceType === "static") {
            return m.staticValue || "";
          }
          return "";
        },
      };
    });
  } else {
    const defaults: [string, string, string][] = [
      ["发票号码", "invoice", "invoiceNo"],
      ["发票代码", "invoice", "invoiceCode"],
      ["不含税金额", "invoice", "amountExclTax"],
      ["税额", "invoice", "taxAmount"],
      ["含税金额", "invoice", "amountInclTax"],
      ["开票日期", "invoice", "invoiceDate"],
      ["销售方", "invoice", "sellerName"],
      ["购买方", "invoice", "buyerName"],
      ["订单号", "invoice", "orderNo"],
      ["出库单号/单据号", "receipt", "documentCode"],
      ["关联订单号", "receipt", "orderNo"],
      ["单据日期", "receipt", "receiptDate"],
      ["签收人/收货单位", "receipt", "recipient"],
    ];
    columns = defaults.map(([header, sourceType, sourceField]) => ({
      header,
      extract: (inv) => {
        if (sourceType === "invoice") {
          return fmtVal((inv as unknown as Record<string, unknown>)[sourceField]);
        }
        const receipt = inv.links[0]?.receipt;
        if (!receipt) return "";
        return fmtVal((receipt as unknown as Record<string, unknown>)[sourceField]);
      },
    }));
  }

  // ── 生成 Excel ──
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("发票核对表");

  sheet.columns = columns.map((c) => ({ header: c.header, key: c.header, width: 18 }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };

  for (const inv of invoices) {
    const row: Record<string, string> = {};
    for (const col of columns) {
      row[col.header] = col.extract(inv);
    }
    sheet.addRow(row);
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("发票核对表.xlsx")}`,
    },
  });
}

function fmtVal(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toLocaleDateString("zh-CN");
  if (typeof v === "object" && "constructor" in (v as object) === false) return String(Number(v));
  return String(v);
}
