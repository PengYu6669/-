import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET /api/projects/[id]/preview-data — 生成填充后的表格数据
// 有模板时按模板列生成；无模板时自动生成默认列（所有发票+签收单字段）
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // 获取所有发票+关联签收单
  const invoices = await prisma.invoice.findMany({
    where: { projectId: id },
    include: {
      links: {
        include: { receipt: true },
      },
    },
    orderBy: { invoiceNo: "asc" },
  });

  // 尝试获取模板映射
  const template = await prisma.template.findFirst({
    where: { projectId: id },
    include: { mappings: { orderBy: { columnIndex: "asc" } } },
    orderBy: { createdAt: "desc" },
  });

  let headers: string[];
  let rows: RowData[];
  let mappingsOutput: MappingOutput[];

  if (template && template.mappings.length > 0) {
    // ─── 有模板：按模板映射生成 ───
    const tmplHeaders = template.headers as string[];
    headers = tmplHeaders;
    mappingsOutput = template.mappings.map((m) => ({
      id: m.id,
      index: m.columnIndex,
      header: m.headerName,
      sourceType: m.sourceType,
      sourceField: m.sourceField,
    }));

    rows = invoices.map((inv) => {
      const cells: CellData[] = template.mappings.map((m) => {
        let value: unknown = null;
        let traceSource: TraceSource | null = null;

        if (m.sourceType === "invoice" && m.sourceField) {
          const field = m.sourceField.replace("invoice.", "");
          value = (inv as unknown as Record<string, unknown>)[field];
          if (value && typeof value === "object" && "constructor" in value === false) {
            value = Number(value);
          }
          traceSource = {
            type: "invoice",
            id: inv.id,
            field: m.sourceField,
            fileName: inv.invoiceNo || "发票",
          };
        } else if (m.sourceType === "receipt" && m.sourceField) {
          const receipts = inv.links.map((l) => l.receipt).filter(Boolean);
          if (receipts.length > 0) {
            const field = m.sourceField.replace("receipt.", "");
            const vals = receipts.map((r) => {
              let v = (r as unknown as Record<string, unknown>)[field];
              if (r.receiptDate && field === "receiptDate") {
                v = new Date(r.receiptDate as unknown as string).toLocaleDateString("zh-CN");
              }
              return v != null ? String(v) : "";
            }).filter((v) => v !== "");
            value = vals.length > 0 ? [...new Set(vals)].join("、") : null;
            traceSource = {
              type: "receipt",
              id: receipts[0].id,
              field: m.sourceField,
              fileName: receipts.map((r) => r.documentCode || "").filter(Boolean).join("、") || "签收单",
            };
          }
        } else if (m.sourceType === "static") {
          value = m.staticValue || "";
          traceSource = { type: "static", id: "", field: "", fileName: "" };
        }

        if (value instanceof Date) {
          value = (value as Date).toLocaleDateString("zh-CN");
        }

        let confidence: number | null = null;
        if (m.sourceType === "invoice") {
          confidence = inv.confidence ? Number(inv.confidence) : 0.9;
        } else if (m.sourceType === "receipt") {
          const receipts = inv.links.map((l) => l.receipt).filter(Boolean);
          if (receipts.length > 0) {
            const field = (m.sourceField || "").replace("receipt.", "");
            // 多签收单取最低置信度
            const confs = receipts.map((r) => (r.rawLlmJson as any)?.fieldConfidence?.[field]).filter((c) => c != null);
            confidence = confs.length > 0 ? Math.min(...confs) : null;
          }
        } else {
          confidence = 1;
        }

        return { value, traceSource, confidence };
      });
      return { cells };
    });
  } else {
    // ─── 无模板：生成默认列 ───
    const defaultColumns: { header: string; sourceType: string; sourceField: string }[] = [
      { header: "发票号码", sourceType: "invoice", sourceField: "invoice.invoiceNo" },
      { header: "发票代码", sourceType: "invoice", sourceField: "invoice.invoiceCode" },
      { header: "不含税金额", sourceType: "invoice", sourceField: "invoice.amountExclTax" },
      { header: "税额", sourceType: "invoice", sourceField: "invoice.taxAmount" },
      { header: "含税金额", sourceType: "invoice", sourceField: "invoice.amountInclTax" },
      { header: "开票日期", sourceType: "invoice", sourceField: "invoice.invoiceDate" },
      { header: "销售方", sourceType: "invoice", sourceField: "invoice.sellerName" },
      { header: "购买方", sourceType: "invoice", sourceField: "invoice.buyerName" },
      { header: "订单号", sourceType: "invoice", sourceField: "invoice.orderNo" },
      { header: "出库单号/单据号", sourceType: "receipt", sourceField: "receipt.documentCode" },
      { header: "关联订单号", sourceType: "receipt", sourceField: "receipt.orderNo" },
      { header: "单据日期", sourceType: "receipt", sourceField: "receipt.receiptDate" },
      { header: "签收人/收货单位", sourceType: "receipt", sourceField: "receipt.recipient" },
    ];

    headers = defaultColumns.map((c) => c.header);
    mappingsOutput = defaultColumns.map((c, i) => ({
      id: `default-${i}`,
      index: i,
      header: c.header,
      sourceType: c.sourceType,
      sourceField: c.sourceField,
    }));

    rows = invoices.map((inv) => {
      const cells: CellData[] = defaultColumns.map((col) => {
        let value: unknown = null;
        let traceSource: TraceSource | null = null;

        if (col.sourceType === "invoice") {
          const field = col.sourceField.replace("invoice.", "");
          value = (inv as unknown as Record<string, unknown>)[field];
          if (value && typeof value === "object" && "constructor" in value === false) {
            value = Number(value);
          }
          if (inv.invoiceDate && field === "invoiceDate") {
            value = new Date(inv.invoiceDate as unknown as string)
              .toLocaleDateString("zh-CN");
          }
          traceSource = {
            type: "invoice",
            id: inv.id,
            field: col.sourceField,
            fileName: inv.invoiceNo || "发票",
          };
        } else if (col.sourceType === "receipt") {
          const receipts = inv.links.map((l) => l.receipt).filter(Boolean);
          if (receipts.length > 0) {
            const field = col.sourceField.replace("receipt.", "");
            const vals = receipts.map((r) => {
              let v = (r as unknown as Record<string, unknown>)[field];
              if (r.receiptDate && field === "receiptDate") {
                v = new Date(r.receiptDate as unknown as string).toLocaleDateString("zh-CN");
              }
              return v != null ? String(v) : "";
            }).filter((v) => v !== "");
            value = vals.length > 0 ? [...new Set(vals)].join("、") : null;
            traceSource = {
              type: "receipt",
              id: receipts[0].id,
              field: col.sourceField,
              fileName: receipts.map((r) => r.documentCode || "").filter(Boolean).join("、") || "签收单",
            };
          }
        }

        if (value instanceof Date) {
          value = (value as Date).toLocaleDateString("zh-CN");
        }

        let confidence: number | null = null;
        if (col.sourceType === "invoice") {
          confidence = inv.confidence ? Number(inv.confidence) : 0.9;
        } else if (col.sourceType === "receipt") {
          const receipt = inv.links[0]?.receipt;
          if (receipt) {
            const field = col.sourceField.replace("receipt.", "");
            const fc = (receipt.rawLlmJson as any)?.fieldConfidence;
            confidence = fc?.[field] ?? null;
          }
        } else {
          confidence = 1;
        }

        return { value, traceSource, confidence };
      });
      return { cells };
    });
  }

  return NextResponse.json({
    headers,
    mappings: mappingsOutput,
    rows,
    rowCount: rows.length,
  });
}

// ─── 类型 ───
interface TraceSource {
  type: "invoice" | "receipt" | "static";
  id: string;
  field: string;
  fileName: string;
}

interface CellData {
  value: unknown;
  traceSource: TraceSource | null;
  confidence: number | null; // 0-1，越低越不可信
}

interface RowData {
  cells: CellData[];
}

interface MappingOutput {
  id: string;
  index: number;
  header: string;
  sourceType: string | null;
  sourceField: string | null;
}
