import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import OpenAI from "openai";

const AVAILABLE_FIELDS = [
  { key: "invoice.invoiceNo", label: "发票号码", type: "invoice" },
  { key: "invoice.invoiceCode", label: "发票代码", type: "invoice" },
  { key: "invoice.amountExclTax", label: "不含税金额", type: "invoice" },
  { key: "invoice.taxAmount", label: "税额", type: "invoice" },
  { key: "invoice.amountInclTax", label: "含税金额", type: "invoice" },
  { key: "invoice.invoiceDate", label: "开票日期", type: "invoice" },
  { key: "invoice.sellerName", label: "销售方名称", type: "invoice" },
  { key: "invoice.buyerName", label: "购买方名称", type: "invoice" },
  { key: "invoice.orderNo", label: "订单号", type: "invoice" },
  { key: "receipt.documentCode", label: "签收单编码", type: "receipt" },
  { key: "receipt.orderNo", label: "签收单订单号", type: "receipt" },
  { key: "receipt.receiptDate", label: "签收日期", type: "receipt" },
  { key: "receipt.recipient", label: "签收人", type: "receipt" },
];

// POST — AI 字段映射
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const template = await prisma.template.findFirst({
    where: { projectId: id },
    orderBy: { createdAt: "desc" },
  });
  if (!template) return NextResponse.json({ error: "请先上传模板" }, { status: 400 });

  const headers = template.headers as string[];

  const deepseek = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY!,
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  });

  const fieldsText = AVAILABLE_FIELDS.map((f) => `- "${f.label}" → ${f.key}`).join("\n");
  const prompt = `你是Excel字段映射专家。模板表头：${JSON.stringify(headers)}

可选字段：
${fieldsText}

将每个表头映射到最合适的字段，找不到的为null。static=固定值列。
只返回JSON: {"mappings":[{"header":"表头名","sourceType":"invoice|receipt|static","sourceField":"invoice.xxx或receipt.xxx或null","confidence":0.5}]}`;

  const response = await deepseek.chat.completions.create({
    model: "deepseek-chat",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.1,
  });

  const content = response.choices[0].message.content || "{}";
  const parsed = JSON.parse(content);
  const suggestions: Array<{
    header: string;
    sourceType: string | null;
    sourceField: string | null;
    confidence: number;
  }> = parsed.mappings || [];

  // 删旧映射，建新的
  await prisma.fieldMapping.deleteMany({ where: { templateId: template.id } });

  const mappings = [];
  for (let i = 0; i < headers.length; i++) {
    const s = suggestions.find((s) => s.header === headers[i]);
    const m = await prisma.fieldMapping.create({
      data: {
        templateId: template.id,
        columnIndex: i,
        headerName: headers[i],
        sourceType: s?.sourceType || null,
        sourceField: s?.sourceField || null,
        suggestedBy: "ai",
        staticValue: null,
      },
    });
    mappings.push(m);
  }

  return NextResponse.json({
    mappings,
    aiRaw: { suggestions, model: response.model },
  });
}

// PUT — 手动更新映射（没有id则创建）
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  const template = await prisma.template.findFirst({
    where: { projectId: id },
    orderBy: { createdAt: "desc" },
  });
  if (!template) return NextResponse.json({ error: "模板不存在" }, { status: 404 });

  const updated = [];
  for (const m of body.mappings) {
    if (m.id) {
      // 更新已有映射
      const result = await prisma.fieldMapping.update({
        where: { id: m.id },
        data: {
          sourceType: m.sourceType ?? null,
          sourceField: m.sourceField ?? null,
          staticValue: m.staticValue ?? null,
          suggestedBy: "user",
        },
      });
      updated.push(result);
    } else if (m.columnIndex !== undefined) {
      // 新建映射（用户手动映射时还没有AI生成的记录）
      const result = await prisma.fieldMapping.create({
        data: {
          templateId: template.id,
          columnIndex: m.columnIndex,
          headerName: m.headerName || `列${m.columnIndex + 1}`,
          sourceType: m.sourceType ?? null,
          sourceField: m.sourceField ?? null,
          staticValue: m.staticValue ?? null,
          suggestedBy: "user",
        },
      });
      updated.push(result);
    }
  }

  return NextResponse.json({ mappings: updated });
}
