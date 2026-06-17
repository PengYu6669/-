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
    (w: { words: string; location?: WordLocation; probability?: { average?: number } }) => ({
      words: w.words,
      location: w.location || { left: 0, top: 0, width: 0, height: 0 },
      probability: w.probability?.average,
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
  fileType: string,
  pdfPageNum?: number
): Promise<{ wordsResult: WordResult[]; wordsText: string; wordsNum: number; pdfFileSize?: number }> {
  const token = await getAccessToken();
  const raw = stripBase64Prefix(base64);

  let body: string;
  if (fileType === "pdf") {
    body = `pdf_file=${encodeURIComponent(raw)}`;
    if (pdfPageNum) body += `&pdf_file_num=${pdfPageNum}`;
  } else {
    body = `image=${encodeURIComponent(raw)}`;
  }

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
    (w: { words: string; location?: WordLocation; probability?: { average?: number } }) => ({
      words: w.words,
      location: w.location || { left: 0, top: 0, width: 0, height: 0 },
      probability: w.probability?.average,
    })
  );

  return {
    wordsResult,
    wordsText: wordsResult.map((w) => w.words).join("\n"),
    wordsNum: data.words_result_num || wordsResult.length,
    pdfFileSize: data.pdf_file_size ? Number(data.pdf_file_size) : undefined,
  };
}

/** PDF 多页 OCR：返回第一页+最后一页合并文本 */
export async function recognizePdfMultiPage(
  base64: string,
  fileType: string
): Promise<{ wordsText: string; wordsNum: number }> {
  if (fileType !== "pdf") {
    const r = await recognizeAccurateBasic(base64, fileType);
    return { wordsText: r.wordsText, wordsNum: r.wordsNum };
  }
  const page1 = await recognizeAccurateBasic(base64, "pdf", 1);
  let allText = page1.wordsText;
  const totalPages = page1.pdfFileSize || 1;
  if (totalPages > 1) {
    const lastPage = await recognizeAccurateBasic(base64, "pdf", totalPages);
    allText += "\n" + lastPage.wordsText;
    return { wordsText: allText, wordsNum: page1.wordsNum + lastPage.wordsNum };
  }
  return { wordsText: allText, wordsNum: page1.wordsNum };
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
  amount: string | null;
  recipient: string | null;
  fieldConfidence: FieldConfidence;
} {
  const allWords = wordsResult.map((w) => w.words);
  const allText = allWords.join("\n");
  // 用空格拼接，让跨词条的正则也能匹配（关键词和值可能在不同词条）
  const allTextFlat = allWords.join(" ");

  // 整张图 OCR 平均置信度（百度 accurate_basic 词条级 probability）
  const ocrProbs = wordsResult.map((w) => w.probability).filter((p): p is number => p != null);
  const avgOcrProb = ocrProbs.length > 0
    ? ocrProbs.reduce((a, b) => a + b, 0) / ocrProbs.length
    : 0.9; // 没有 probability 数据时默认 0.9

  /** 计算字段置信度 = 匹配方式系数 × OCR 词条质量系数 */
  function score(mt: MatchType, val: unknown): number {
    if (mt === "none" || val == null) return 0;
    const base = mt === "exact" ? 0.95 : mt === "fuzzy" ? 0.60 : 0.30;
    return Math.round(base * avgOcrProb * 100) / 100;
  }

  type MatchType = "exact" | "fuzzy" | "fallback" | "none";
  let codeConf: [MatchType, unknown] = ["none", null];
  let orderConf: [MatchType, unknown] = ["none", null];
  let dateConf: [MatchType, unknown] = ["none", null];
  let recvConf: [MatchType, unknown] = ["none", null];

  /** 判断一个纯数字是否像日期（YYYYMMDD / YYMMDD / YYYYMM / YYYY） */
  function isDateLike(num: string): boolean {
    if (num.length === 8 && /^20\d{6}$/.test(num)) {
      // 20241226 → 检查月和日是否合理
      const m = parseInt(num.slice(4, 6)), d = parseInt(num.slice(6, 8));
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return true;
    }
    if (num.length === 6 && /^\d{6}$/.test(num)) {
      const m = parseInt(num.slice(2, 4)), d = parseInt(num.slice(4, 6));
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return true;
    }
    return false;
  }

  /** 判断候选数字是否合法：非日期、非年份、长度合理 */
  function isValidCode(num: string): boolean {
    if (num.length < 5 || num.length > 12) return false; // 至少5位，排除4位年份
    if (isDateLike(num)) return false;
    if (num.length === 4 && /^(19|20)\d{2}$/.test(num)) return false; // 年份
    return true;
  }

  // ── 出库单号 → 发货单号 → 订单号 → 单据编码 ──
  let documentCode: string | null = null;
  const exactCodePatterns = [
    /出库单号\s*[：:]\s*(\S+)/,
    /发货单号\s*[：:]\s*(\S+)/,
    /订单号\s*[：:]\s*([A-Za-z0-9\-]+)/,
    /单据编码\s*[：:]\s*(\S+)/,
    /单据号\s*[：:]\s*(\S+)/,
  ];
  const fuzzyCodePatterns = [
    /出鞋话象\s*[：:]\s*(\S+)/, /发饭各\s*[：:]\s*(\S+)/,
    /单号\s*[：:]\s*(\S+)/, /编号\s*[：:]\s*(\S+)/,
    /NO[．.:]\s*(\S+)/i, /编码\s*[：:]\s*(\S+)/,
  ];

  // 先精确匹配
  for (const re of exactCodePatterns) {
    let m = allTextFlat.match(re) || allText.match(re);
    if (m) {
      const raw = m[1].replace(/[^\d]/g, "");
      if (isValidCode(raw)) { documentCode = raw; codeConf = ["exact", raw]; break; }
    }
  }
  // 模糊匹配
  if (!documentCode) {
    for (const re of fuzzyCodePatterns) {
      let m = allTextFlat.match(re) || allText.match(re);
      if (m) {
        const raw = m[1].replace(/[^\d]/g, "");
        if (isValidCode(raw)) { documentCode = raw; codeConf = ["fuzzy", raw]; break; }
      }
    }
  }
  // 退而求其次：纯数字 5-10 位
  if (!documentCode) {
    for (let i = 0; i < allWords.length; i++) {
      const w = allWords[i];
      const n = w.replace(/[^\d]/g, "");
      if (isValidCode(n) && /^\d+$/.test(n)) {
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
  const exactOrderPatterns = [/订单号\s*[：:]\s*([A-Za-z0-9\-]+)/, /合同号\s*[：:]\s*(\S+)/];
  const fuzzyOrderPatterns = [/PO[#＃]?\s*[：:]?\s*(\S+)/i, /采购单号\s*[：:]\s*(\S+)/];
  for (const re of exactOrderPatterns) {
    let m = allTextFlat.match(re) || allText.match(re);
    if (m && m[1].length >= 3) { orderNo = m[1]; orderConf = ["exact", m[1]]; break; }
  }
  if (!orderNo) {
    for (const re of fuzzyOrderPatterns) {
      let m = allTextFlat.match(re) || allText.match(re);
      if (m && m[1].length >= 3) { orderNo = m[1]; orderConf = ["fuzzy", m[1]]; break; }
    }
  }

  // ── 日期 ──
  let receiptDate: string | null = null;
  const exactDatePatterns = [/日期\s*[：:]\s*(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日]?)/, /发货日期\s*[：:]\s*(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日]?)/];
  const fuzzyDatePatterns = [/(\d{4}[-/]\d{1,2}[-/]\d{1,2})/];
  for (const re of exactDatePatterns) {
    let m = allTextFlat.match(re) || allText.match(re);
    if (m) { receiptDate = m[1].replace(/[年月]/g, "-").replace(/日$/, ""); dateConf = ["exact", m[1]]; break; }
  }
  if (!receiptDate) {
    for (const re of fuzzyDatePatterns) {
      let m = allTextFlat.match(re) || allText.match(re);
      if (m) { receiptDate = m[1]; dateConf = ["fuzzy", m[1]]; break; }
    }
  }

  // ── 收货单位/签收人 ──
  let recipient: string | null = null;
  const exactRecvPatterns = [/收货单位\s*[：:]\s*(\S+)/, /收货人\s*[：:]\s*(\S+)/, /签收人\s*[：:]\s*(\S+)/, /客户名称\s*[：:]\s*(\S+)/];
  const fuzzyRecvPatterns = [/谢货[^\n]{0,4}\s*[：:]\s*(\S+)/, /发货单位\s*[：:]\s*(\S+)/, /发饭各\s*[：:]\s*(\S+)/];
  for (const re of exactRecvPatterns) {
    let m = allTextFlat.match(re) || allText.match(re);
    if (m && m[1].length >= 2 && !/^\d+$/.test(m[1])) {
      recipient = m[1].replace(/[^一-龥a-zA-Z()（）]/g, "").slice(0, 40);
      recvConf = ["exact", recipient]; break;
    }
  }
  if (!recipient) {
    for (const re of fuzzyRecvPatterns) {
      let m = allTextFlat.match(re) || allText.match(re);
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

  // ── 金额 ──
  let amount: string | null = null;
  // 先找合计行
  // 先找总合计（排除"本页"），再降级到本页合计、金额合计
  const amountPatterns = [
    /(?<!本页)合计金额[（(]?[^)）]*[)）]?\s*[：:]\s*([\d,.]+)/g,
    /(?<!本页)金额合计[（(]?[^)）]*[)）]?\s*[：:]\s*([\d,.]+)/g,
    /总金额[（(]?[^)）]*[)）]?\s*[：:]\s*([\d,.]+)/g,
    /价税合计\s*[：:]\s*([\d,.]+)/g,
    /本页合计金额[（(]?[^)）]*[)）]?\s*[：:]\s*([\d,.]+)/g,
    /[（(]?[^)）]*[)）]?\s*合计\s*[：:]\s*([\d,.]+)/g,
  ];
  for (const re of amountPatterns) {
    const matches = [...allTextFlat.matchAll(re), ...allText.matchAll(re)];
    let best: number | null = null;
    for (const m of matches) {
      if (m[1] && /^\d/.test(m[1])) {
        const v = parseFloat(m[1].replace(/,/g, ""));
        if (!isNaN(v) && (best === null || v > best)) best = v;
      }
    }
    if (best !== null) { amount = best.toFixed(2); console.log("[金额] 匹配成功:", amount); break; }
  }
  if (!amount) {
    const idx = allTextFlat.indexOf("合计");
    console.log("[金额] 未匹配! allTextFlat含'合计'处:", allTextFlat.slice(Math.max(0,idx-10), idx+80));
    console.log("[金额] allWords总数:", allWords.length, "前10:", allWords.slice(0,10));
  } else {
    // 金额提取成功也输出结果
  }
  console.log("[字段] 提取结果:", JSON.stringify({documentCode, orderNo, receiptDate, amount, recipient}));
  // 没合计行则智能累加：收集所有数字，按"单价+金额"模式隔项取金额
  if (!amount) {
    const nums: number[] = [];
    for (const w of allWords) {
      const n = parseFloat(w);
      if (!isNaN(n) && n > 0.01 && n < 500000) nums.push(n);
    }
    // 数字成对出现：奇数位=单价，偶数位=金额。取所有偶数位（index 1,3,5...）
    const amounts: number[] = [];
    for (let i = 1; i < nums.length; i += 2) {
      if (nums[i] >= nums[i-1] * 0.05) amounts.push(nums[i]);
    }
    if (amounts.length >= 2) {
      const total = amounts.reduce((s, n) => s + Math.round(n * 100) / 100, 0);
      if (total > 10) amount = total.toFixed(2);
    }
  }

  return {
    documentCode,
    orderNo,
    receiptDate,
    amount,
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
  probability?: number; // 百度 OCR 词条平均置信度
}

export interface GeneralOcrResult {
  wordsResult: WordResult[];
  wordsText: string;
  wordsNum: number;
}
