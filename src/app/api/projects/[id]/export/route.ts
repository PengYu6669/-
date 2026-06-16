import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import ExcelJS from "exceljs";

// GET /api/projects/[id]/export — 按预览字段导出 Excel，低置信度单元格黄色高亮
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const project = await prisma.project.findUnique({ where: { id }, select: { name: true } });
  const projectName = project?.name || "发票核对表";

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

  // ── 列定义：值 + 置信度 ──
  type ColDef = {
    header: string;
    extract: (inv: (typeof invoices)[number]) => { value: string; confidence: number | null };
  };
  let columns: ColDef[];

  if (template && template.mappings.length > 0) {
    columns = template.mappings.map((m): ColDef => ({
      header: m.headerName,
      extract: (inv) => {
        if (m.sourceType === "invoice" && m.sourceField) {
          const field = m.sourceField.replace("invoice.", "");
          return { value: fmtVal((inv as any)[field]), confidence: inv.confidence ? Number(inv.confidence) : 0.9 };
        }
        if (m.sourceType === "receipt" && m.sourceField) {
          const receipt = inv.links[0]?.receipt;
          if (!receipt) return { value: "", confidence: null };
          const field = m.sourceField.replace("receipt.", "");
          const fc = (receipt.rawLlmJson as any)?.fieldConfidence;
          return {
            value: fmtVal((receipt as any)[field]),
            confidence: fc?.[field] ?? null,
          };
        }
        if (m.sourceType === "static") {
          return { value: m.staticValue || "", confidence: 1 };
        }
        return { value: "", confidence: null };
      },
    }));
  } else {
    const defaults: { header: string; source: "invoice" | "receipt"; field: string }[] = [
      { header: "发票号码", source: "invoice", field: "invoiceNo" },
      { header: "发票代码", source: "invoice", field: "invoiceCode" },
      { header: "不含税金额", source: "invoice", field: "amountExclTax" },
      { header: "税额", source: "invoice", field: "taxAmount" },
      { header: "含税金额", source: "invoice", field: "amountInclTax" },
      { header: "开票日期", source: "invoice", field: "invoiceDate" },
      { header: "销售方", source: "invoice", field: "sellerName" },
      { header: "购买方", source: "invoice", field: "buyerName" },
      { header: "订单号", source: "invoice", field: "orderNo" },
      { header: "出库单号/单据号", source: "receipt", field: "documentCode" },
      { header: "关联订单号", source: "receipt", field: "orderNo" },
      { header: "单据日期", source: "receipt", field: "receiptDate" },
      { header: "签收人/收货单位", source: "receipt", field: "recipient" },
    ];
    columns = defaults.map((d): ColDef => ({
      header: d.header,
      extract: (inv) => {
        if (d.source === "invoice") {
          return { value: fmtVal((inv as any)[d.field]), confidence: inv.confidence ? Number(inv.confidence) : 0.9 };
        }
        const receipt = inv.links[0]?.receipt;
        if (!receipt) return { value: "", confidence: null };
        const fc = (receipt.rawLlmJson as any)?.fieldConfidence;
        return {
          value: fmtVal((receipt as any)[d.field]),
          confidence: fc?.[d.field] ?? null,
        };
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
  // 表头加一行"低可信度提示"
  const LOW_CONF = 0.6;
  const YELLOW_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };

  for (let rowIdx = 0; rowIdx < invoices.length; rowIdx++) {
    const inv = invoices[rowIdx];
    const rowValues: Record<string, string> = {};
    for (const col of columns) {
      const r = col.extract(inv);
      rowValues[col.header] = r.value;
    }
    const dataRow = sheet.addRow(rowValues);

    // 低置信度单元格黄色高亮
    for (let ci = 0; ci < columns.length; ci++) {
      const r = columns[ci].extract(inv);
      if (r.confidence !== null && r.confidence < LOW_CONF) {
        const cell = dataRow.getCell(ci + 1); // ExcelJS 列号从1开始
        cell.fill = YELLOW_FILL;
        cell.note = {
          texts: [{ text: `⚠️ 识别可信度 ${Math.round(r.confidence * 100)}%，请人工核对`, font: { size: 10 } }],
        };
      }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(projectName + ".xlsx")}`,
    },
  });
}

function fmtVal(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toLocaleDateString("zh-CN");
  if (typeof v === "object" && "constructor" in (v as object) === false) return String(Number(v));
  return String(v);
}
