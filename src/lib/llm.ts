/**
 * DeepSeek LLM 服务
 * 从 OCR 文本中提取结构化字段
 */

import OpenAI from "openai";

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY!,
  baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
});

/** 从发票备注栏 / OCR 文本中提取订单号 */
export async function extractOrderNo(
  ocrText: string
): Promise<{ orderNo: string | null; raw: unknown }> {
  const prompt = `你是一个发票数据提取助手。从以下发票OCR文本中提取"订单号"或"合同号"。

规则：
1. 订单号通常出现在备注栏，也可能是数字+字母组合
2. 合同号、PO号、采购单号都算订单号
3. 如果找不到，返回 null
4. 只返回 JSON，不要任何其他文字

OCR文本：
${ocrText}

请返回 JSON 格式：{"orderNo": "提取到的订单号" 或 null}`;

  const response = await deepseek.chat.completions.create({
    model: "deepseek-chat",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.1,
  });

  const content = response.choices[0].message.content || "{}";
  const parsed = JSON.parse(content);

  return {
    orderNo: parsed.orderNo || null,
    raw: {
      model: response.model,
      usage: response.usage,
      prompt,
      response: content,
    },
  };
}

/** 从签收单 OCR 文本中提取单据编码和订单号 */
export async function extractReceiptData(
  ocrText: string
): Promise<{
  documentCode: string | null;
  orderNo: string | null;
  receiptDate: string | null;
  recipient: string | null;
  raw: unknown;
}> {
  const prompt = `你是发货单/签收单/出库单 OCR 数据提取助手。下面是从图片 OCR 得到的文本（可能有错别字），请提取关键字段。

⚠️ OCR 常见错误（帮助理解乱码）：
- "出库单号" → 可能识别为 "出鞋话象"、"出库单"、"出库号"
- "发货单号" → 可能识别为 "发饭各"、"发贷单号"
- "收货单位" → 可能识别为 "谢货桃放"、"收货单位"
- 数字 7 → 可能识别为 2、9；数字 5 → 可能识别为 6、8

提取规则：
1. **单据编码 (documentCode)**：发货单/出库单右上角或顶部显眼位置的编号。
   关键词线索："出库单号"、"发货单号"、"单号"、"NO."、"编号"、"单据号"、"出货单号"。
   通常是 5~10 位纯数字，不含字母。注意和批号（含字母如 250903A）区分！
   优先取"出库单号"/"发货单号"紧邻的数字，而不是批号。

2. **订单号 (orderNo)**：关联的订单号、合同号、PO号、采购单号。
   通常是纯数字或字母+数字组合。可能出现在"订单号"、"合同号"、"PO"、"采购单号"后面。

3. **日期 (receiptDate)**：格式 YYYY-MM-DD。取最新的日期（通常在最上方或签字附近）。

4. **签收人/收货单位 (recipient)**：签收人姓名 或 收货单位名称。
   优先取人名，没有人名则取收货单位全称（如"XX医药有限公司"）。

5. 找不到返回 null。只返回 JSON。

OCR文本：
${ocrText}

返回 JSON：{"documentCode": "单据编码或null", "orderNo": "订单号或null", "receiptDate": "YYYY-MM-DD或null", "recipient": "签收人或null"}`;

  const response = await deepseek.chat.completions.create({
    model: "deepseek-chat",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.1,
  });

  const content = response.choices[0].message.content || "{}";
  const parsed = JSON.parse(content);

  return {
    documentCode: parsed.documentCode || null,
    orderNo: parsed.orderNo || null,
    receiptDate: parsed.receiptDate || null,
    recipient: parsed.recipient || null,
    raw: {
      model: response.model,
      usage: response.usage,
      prompt,
      response: content,
    },
  };
}
