/**
 * 百度云 OCR 服务
 *
 * - PDF 文件直接传 pdf_file 参数，无需本地转图片
 * - 图片文件传 image 参数
 * - 增值税发票专用识别 + 通用文字识别（含位置信息，用于溯源高亮并降级 basic）
 */

const BAIDU_TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token";
const VAT_INVOICE_URL = "https://aip.baidubce.com/rest/2.0/ocr/v1/vat_invoice";
const GENERAL_OCR_URL = "https://aip.baidubce.com/rest/2.0/ocr/v1/general";
const GENERAL_BASIC_URL = "https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic";
const ACCURATE_BASIC_URL = "https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic";

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const apiKey = process.env.BAIDU_OCR_API_KEY!;
  const secretKey = process.env.BAIDU_OCR_SECRET_KEY!;

  const res = await fetch(
    `${BAIDU_TOKEN_URL}?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`
  );
  const data = await res.json();

  if (data.error) {
    throw new Error(`百度 OCR 认证失败: ${data.error_description}`);
  }

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 300) * 1000,
  };

  return cachedToken.token;
}

function stripBase64Prefix(base64: string): string {
  return base64.replace(/^data:[^;]+;base64,/, "");
}

/**
 * 增值税发票识别 — PDF 直接传，图片传 image
 */
export async function recognizeVatInvoice(
  base64: string,
  fileType: string
): Promise<BaiduVatInvoiceResult> {
  const token = await getAccessToken();
  const raw = stripBase64Prefix(base64);

  const body =
    fileType === "pdf"
      ? `pdf_file=${encodeURIComponent(raw)}`
      : `image=${encodeURIComponent(raw)}`;

  const res = await fetch(`${VAT_INVOICE_URL}?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await res.json();
  if (data.error_code) {
    throw new Error(`百度 OCR 错误 [${data.error_code}]: ${data.error_msg}`);
  }

  return data.words_result || {};
}

/**
 * 通用文字识别 — 优先带位置信息(general)，降级(general_basic)
 */
export async function recognizeGeneral(
  base64: string,
  fileType: string
): Promise<GeneralOcrResult> {
  const token = await getAccessToken();
  const raw = stripBase64Prefix(base64);

  const body =
    fileType === "pdf"
      ? `pdf_file=${encodeURIComponent(raw)}`
      : `image=${encodeURIComponent(raw)}`;

  // 优先 general（含位置）
  let res = await fetch(`${GENERAL_OCR_URL}?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  let data = await res.json();

  // 降级 general_basic（无位置信息）
  if (data.error_code) {
    res = await fetch(`${GENERAL_BASIC_URL}?access_token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    data = await res.json();
  }

  if (data.error_code) {
    throw new Error(`百度 OCR 错误 [${data.error_code}]: ${data.error_msg}`);
  }

  const wordsResult: WordResult[] = (data.words_result || []).map(
    (w: { words: string; location?: WordLocation }) => ({
      words: w.words,
      location: w.location || { left: 0, top: 0, width: 0, height: 0 },
    })
  );

  return {
    wordsResult,
    wordsText: wordsResult.map((w) => w.words).join("\n"),
    wordsNum: data.words_result_num || wordsResult.length,
  };
}

/**
 * 高精度通用文字识别 — accurate_basic，识别精度更高
 */
export async function recognizeAccurateBasic(
  base64: string,
  fileType: string
): Promise<{ wordsResult: WordResult[]; wordsText: string; wordsNum: number }> {
  const token = await getAccessToken();
  const raw = stripBase64Prefix(base64);

  const body =
    fileType === "pdf"
      ? `pdf_file=${encodeURIComponent(raw)}`
      : `image=${encodeURIComponent(raw)}`;

  const res = await fetch(`${ACCURATE_BASIC_URL}?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();

  if (data.error_code) {
    throw new Error(`百度 OCR 错误 [${data.error_code}]: ${data.error_msg}`);
  }

  const wordsResult: WordResult[] = (data.words_result || []).map(
    (w: { words: string; location?: WordLocation }) => ({
      words: w.words,
      location: w.location || { left: 0, top: 0, width: 0, height: 0 },
    })
  );

  return {
    wordsResult,
    wordsText: wordsResult.map((w) => w.words).join("\n"),
    wordsNum: data.words_result_num || wordsResult.length,
  };
}

/** 字段置信度 */
export interface FieldConfidence {
  documentCode: number;   // 0-1
  orderNo: number;
  receiptDate: number;
  recipient: number;
}

/**
 * 直接从 OCR 词条中按关键词提取字段（无需 LLM）
 * 同时返回每个字段的置信度评分
 */
export function extractReceiptFieldsFromWords(
  wordsResult: WordResult[]
): {
  documentCode: string | null;
  orderNo: string | null;
  receiptDate: string | null;
  recipient: string | null;
  fieldConfidence: FieldConfidence;
} {
  const allWords = wordsResult.map((w) => w.words);
  const allText = allWords.join("\n");

  /** 计算置信度 0-1 */
  function score(mt: MatchType, val: unknown): number {
    if (mt === "none" || val == null) return 0;
    if (mt === "exact") return 0.95;
    if (mt === "fuzzy") return 0.65;
    return 0.35;
  }

  type MatchType = "exact" | "fuzzy" | "fallback" | "none";
  let codeConf: [MatchType, unknown] = ["none", null];
  let orderConf: [MatchType, unknown] = ["none", null];
  let dateConf: [MatchType, unknown] = ["none", null];
  let recvConf: [MatchType, unknown] = ["none", null];

  // ── 出库单号 ──
  let documentCode: string | null = null;
  const exactCodePatterns = [/出库单号\s*[：:]\s*(\S+)/, /发货单号\s*[：:]\s*(\S+)/, /单据号\s*[：:]\s*(\S+)/];
  const fuzzyCodePatterns = [/出鞋话象\s*[：:]\s*(\S+)/, /发饭各\s*[：:]\s*(\S+)/, /单号\s*[：:]\s*(\S+)/, /编号\s*[：:]\s*(\S+)/, /NO[．.:]\s*(\S+)/i];

  // 先精确匹配
  for (const re of exactCodePatterns) {
    const m = allText.match(re);
    if (m) {
      const raw = m[1].replace(/[^\d]/g, "");
      if (raw.length >= 3) { documentCode = raw; codeConf = ["exact", raw]; break; }
    }
  }
  // 模糊匹配
  if (!documentCode) {
    for (const re of fuzzyCodePatterns) {
      const m = allText.match(re);
      if (m) {
        const raw = m[1].replace(/[^\d]/g, "");
        if (raw.length >= 3) { documentCode = raw; codeConf = ["fuzzy", raw]; break; }
      }
    }
  }
  // 退而求其次：纯数字 5-10 位
  if (!documentCode) {
    for (let i = 0; i < allWords.length; i++) {
      const w = allWords[i];
      const n = w.replace(/[^\d]/g, "");
      if (n.length >= 5 && n.length <= 10 && /^\d+$/.test(n)) {
        const prev = i > 0 ? allWords[i - 1] : "";
        const next = i < allWords.length - 1 ? allWords[i + 1] : "";
        if (!/[¥￥元]/.test(prev) && !/[¥￥元]/.test(next)) {
          documentCode = n; codeConf = ["fallback", n]; break;
        }
      }
    }
  }

  // ── 订单号 ──
  let orderNo: string | null = null;
  const exactOrderPatterns = [/订单号\s*[：:]\s*(\S+)/, /合同号\s*[：:]\s*(\S+)/];
  const fuzzyOrderPatterns = [/PO[#＃]?\s*[：:]?\s*(\S+)/i, /采购单号\s*[：:]\s*(\S+)/];
  for (const re of exactOrderPatterns) {
    const m = allText.match(re);
    if (m && m[1].length >= 3) { orderNo = m[1]; orderConf = ["exact", m[1]]; break; }
  }
  if (!orderNo) {
    for (const re of fuzzyOrderPatterns) {
      const m = allText.match(re);
      if (m && m[1].length >= 3) { orderNo = m[1]; orderConf = ["fuzzy", m[1]]; break; }
    }
  }

  // ── 日期 ──
  let receiptDate: string | null = null;
  const exactDatePatterns = [/日期\s*[：:]\s*(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日]?)/, /发货日期\s*[：:]\s*(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日]?)/];
  const fuzzyDatePatterns = [/(\d{4}[-/]\d{1,2}[-/]\d{1,2})/];
  for (const re of exactDatePatterns) {
    const m = allText.match(re);
    if (m) { receiptDate = m[1].replace(/[年月]/g, "-").replace(/日$/, ""); dateConf = ["exact", m[1]]; break; }
  }
  if (!receiptDate) {
    for (const re of fuzzyDatePatterns) {
      const m = allText.match(re);
      if (m) { receiptDate = m[1]; dateConf = ["fuzzy", m[1]]; break; }
    }
  }

  // ── 收货单位/签收人 ──
  let recipient: string | null = null;
  const exactRecvPatterns = [/收货单位\s*[：:]\s*(\S+)/, /收货人\s*[：:]\s*(\S+)/, /签收人\s*[：:]\s*(\S+)/, /客户名称\s*[：:]\s*(\S+)/];
  const fuzzyRecvPatterns = [/谢货[^\n]{0,4}\s*[：:]\s*(\S+)/, /发货单位\s*[：:]\s*(\S+)/, /发饭各\s*[：:]\s*(\S+)/];
  for (const re of exactRecvPatterns) {
    const m = allText.match(re);
    if (m && m[1].length >= 2 && !/^\d+$/.test(m[1])) {
      recipient = m[1].replace(/[^一-龥a-zA-Z()（）]/g, "").slice(0, 40);
      recvConf = ["exact", recipient]; break;
    }
  }
  if (!recipient) {
    for (const re of fuzzyRecvPatterns) {
      const m = allText.match(re);
      if (m && m[1].length >= 2 && !/^\d+$/.test(m[1])) {
        recipient = m[1].replace(/[^一-龥a-zA-Z()（）]/g, "").slice(0, 40);
        recvConf = ["fuzzy", recipient]; break;
      }
    }
  }
  if (!recipient) {
    for (const w of allWords) {
      if (/公司|医药|药房/.test(w) && w.length > 2) {
        recipient = w.replace(/[^一-龥a-zA-Z()（）]/g, "").slice(0, 40);
        recvConf = ["fallback", recipient]; break;
      }
    }
  }

  return {
    documentCode,
    orderNo,
    receiptDate,
    recipient,
    fieldConfidence: {
      documentCode: score(codeConf[0], codeConf[1]),
      orderNo: score(orderConf[0], orderConf[1]),
      receiptDate: score(dateConf[0], dateConf[1]),
      recipient: score(recvConf[0], recvConf[1]),
    },
  };
}

// ─── 类型定义 ───

export interface BaiduVatInvoiceResult {
  InvoiceNum?: string;
  InvoiceCode?: string;
  InvoiceDate?: string;
  TotalAmount?: string;
  AmountInWords?: string;
  TotalTax?: string;
  AmountInFiguers?: string;
  SellerName?: string;
  BuyerName?: string;
  PurchaserName?: string;
  Remarks?: string;
  [key: string]: unknown;
}

export interface WordLocation {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface WordResult {
  words: string;
  location: WordLocation;
}

export interface GeneralOcrResult {
  wordsResult: WordResult[];
  wordsText: string;
  wordsNum: number;
}
