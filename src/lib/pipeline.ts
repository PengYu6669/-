/**
 * 核心处理流水线
 * OCR + LLM：发票识别 → 签收单识别 → 订单号匹配
 * PDF 直接传百度 OCR，无需本地转换
 */

import { prisma } from "@/lib/db";
import {
  recognizeVatInvoice,
  recognizeGeneral,
  recognizeAccurateBasic,
  recognizePdfMultiPage,
  extractReceiptFieldsFromWords,
  type BaiduVatInvoiceResult,
} from "@/lib/ocr";
import { extractOrderNo } from "@/lib/llm";
import { fileToBase64 } from "@/lib/pdf";

/** 安全序列化 JSON */
function sanitizeJson(obj: unknown): any {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return undefined;
  }
}

/** 限制并发数执行异步任务 */
async function runWithConcurrency<T>(
  items: T[],
  fn: (item: T) => Promise<unknown>,
  concurrency: number
): Promise<void> {
  const queue = [...items];
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift()!;
      try { await fn(item); } catch { /* skip failed */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

/** 解析中文日期格式 "2021年06月25日" → Date */
function parseChineseDate(str: string): Date | null {
  const match = str.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (match) {
    return new Date(`${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`);
  }
  // 试试标准格式
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

// ─── 处理单个发票 ───
export async function processInvoice(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { file: true, project: true },
  });
  if (!invoice) throw new Error("发票记录不存在");

  try {
    // Step 1: 读文件转 base64（PDF 不转换）
    const { base64, fileType } = await fileToBase64(invoice.file.storedPath);

    // Step 2: 增值税发票识别（PDF直接传）
    let ocrResult: BaiduVatInvoiceResult;
    let ocrSuccess = true;
    try {
      ocrResult = await recognizeVatInvoice(base64, fileType);
    } catch {
      // 降级：通用 OCR
      ocrSuccess = false;
      const generalResult = await recognizeGeneral(base64, fileType);
      ocrResult = { Remarks: generalResult.wordsText } as BaiduVatInvoiceResult;
    }

    // 审计：OCR
    await prisma.auditLog.create({
      data: {
        projectId: invoice.projectId,
        fileId: invoice.fileId,
        step: "ocr",
        action: ocrSuccess ? "增值税发票识别" : "降级通用OCR识别",
        outputData: ocrResult as any,
        status: ocrSuccess ? "success" : "warning",
      },
    });

    // Step 3: 从备注提取订单号。VAT 发票 API 可能漏掉末页备注，补 accurate_basic
    let remarks = (ocrResult.Remarks || "") as string;
    if (!remarks || remarks.length < 10) {
      try {
        const supplement = await recognizePdfMultiPage(base64, fileType);
        remarks = supplement.wordsText;
      } catch { /* 忽略 */ }
    }
    let orderNo: string | null = null;
    let llmRaw: unknown = null;

    // 按优先级匹配：订单号 → 合同号 → 采购单号 → 结算单号
    const reOrderPatterns = [
      /订单号\s*[\[【]\s*(\S+?)\s*[\]】]/,     // 方括号格式 订单号[xxx]
      /订单号\s*[：:]\s*(\S+)/,                // 冒号格式 订单号：xxx
      /合同号\s*[\[【]\s*(\S+?)\s*[\]】]/,
      /合同号\s*[：:]\s*(\S+)/,
      /采购单号\s*[\[【]\s*(\S+?)\s*[\]】]/,
      /采购单号\s*[：:]\s*(\S+)/,
      /结算单号\s*[\[【]\s*(\S+?)\s*[\]】]/,
      /结算单号\s*[：:]\s*(\S+)/,
    ];
    for (const re of reOrderPatterns) {
      const m = remarks.match(re);
      if (m) {
        const raw = m[1].replace(/[^\w-]/g, "").trim();
        if (raw.length >= 3) { orderNo = raw; break; }
      }
    }

    // 正则没找到再调 LLM
    if (!orderNo) {
      const llmResult = await extractOrderNo(remarks);
      orderNo = llmResult.orderNo;
      llmRaw = llmResult.raw;
    } else {
      llmRaw = { source: "regex", orderNo };
    }

    // 审计：LLM
    await prisma.auditLog.create({
      data: {
        projectId: invoice.projectId,
        fileId: invoice.fileId,
        step: "llm_extract",
        action: "提取订单号",
        inputData: { ocrRemarks: remarks } as any,
        outputData: llmRaw as any,
        status: "success",
      },
    });

    // Step 4: 更新发票记录
    const updated = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        invoiceNo: (ocrResult.InvoiceNum as string) || null,
        invoiceCode: (ocrResult.InvoiceCode as string) || null,
        amountExclTax: parseFloat((ocrResult.TotalAmount as string) || "0") || null,
        taxAmount: parseFloat((ocrResult.TotalTax as string) || "0") || null,
        amountInclTax: parseFloat((ocrResult.AmountInFiguers as string) || "0") || null,
        invoiceDate: ocrResult.InvoiceDate
          ? parseChineseDate(ocrResult.InvoiceDate as string)
          : null,
        sellerName: (ocrResult.SellerName as string) || null,
        buyerName: (ocrResult.BuyerName as string) || null,
        orderNo: orderNo,
        rawOcrJson: sanitizeJson(ocrResult),
        rawLlmJson: sanitizeJson(llmRaw),
        confidence: ocrSuccess ? 0.95 : 0.6,
        status: "completed",
      },
    });

    return updated;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "未知错误";
    console.error("Invoice processing failed:", invoiceId, message);
    try {
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { status: "failed" },
      });
    } catch { /* ignore update failure */ }
    await prisma.auditLog.create({
      data: {
        projectId: invoice.projectId,
        fileId: invoice.fileId,
        step: "ocr",
        action: "发票处理失败",
        status: "failed",
        errorMessage: message,
      },
    });
    throw err;
  }
}

// ─── 处理单个签收单 ───
export async function processReceipt(receiptId: string) {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    include: { file: true, project: true },
  });
  if (!receipt) throw new Error("签收单记录不存在");

  try {
    // Step 1: 读文件转 base64
    const { base64, fileType } = await fileToBase64(receipt.file.storedPath);

    // Step 2: 高精度通用文字识别
    const ocrResult = await recognizeAccurateBasic(base64, fileType);

    // 审计：OCR
    await prisma.auditLog.create({
      data: {
        projectId: receipt.projectId,
        fileId: receipt.fileId,
        step: "ocr",
        action: "高精度通用文字识别 (accurate_basic)",
        outputData: {
          wordsNum: ocrResult.wordsNum,
          wordsText: ocrResult.wordsText.substring(0, 2000),
        } as any,
        status: "success",
      },
    });

    // Step 3: 直接关键词提取（无需 LLM），含置信度
    const {
      documentCode,
      orderNo,
      receiptDate,
      recipient,
      fieldConfidence,
    } = extractReceiptFieldsFromWords(ocrResult.wordsResult);

    console.log("📦 receipt extract:", { documentCode, orderNo, receiptDate, recipient, fieldConfidence });

    // 审计：字段提取
    await prisma.auditLog.create({
      data: {
        projectId: receipt.projectId,
        fileId: receipt.fileId,
        step: "field_extract",
        action: "关键词提取签收单字段",
        inputData: { wordsText: ocrResult.wordsText.substring(0, 2000) } as any,
        outputData: { documentCode, orderNo, receiptDate, recipient } as any,
        status: "success",
      },
    });

    // Step 4: 更新签收单
    const updated = await prisma.receipt.update({
      where: { id: receiptId },
      data: {
        documentCode,
        orderNo,
        receiptDate: receiptDate ? parseChineseDate(receiptDate) : null,
        recipient,
        rawOcrText: ocrResult.wordsText,
        rawLlmJson: sanitizeJson({ documentCode, orderNo, receiptDate, recipient, fieldConfidence }),
        confidence: Math.round(
          (fieldConfidence.documentCode + fieldConfidence.orderNo +
           fieldConfidence.receiptDate + fieldConfidence.recipient) / 4 * 100
        ) / 100,
        status: "completed",
      },
    });

    return updated;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "未知错误";
    console.error("Receipt processing failed:", receiptId, message);
    try {
      await prisma.receipt.update({
        where: { id: receiptId },
        data: { status: "failed" },
      });
    } catch { /* ignore update failure */ }
    await prisma.auditLog.create({
      data: {
        projectId: receipt.projectId,
        fileId: receipt.fileId,
        step: "ocr",
        action: "签收单处理失败",
        status: "failed",
        errorMessage: message,
      },
    });
    throw err;
  }
}

// ─── 自动匹配发票与签收单 ───
export async function autoMatch(projectId: string) {
  // 加载所有发票和签收单（不限于有 orderNo 的）
  const invoices = await prisma.invoice.findMany({
    where: { projectId, status: "completed" },
    include: { file: { select: { originalName: true } } },
  });
  const receipts = await prisma.receipt.findMany({
    where: { projectId, status: "completed" },
    include: { file: { select: { originalName: true } } },
  });

  /** 去掉扩展名的文件名 */
  const baseName = (name: string) => name.replace(/\.[^.]+$/, "");

  const links = [];

  /**
   * 从发票备注中提取候选编号
   * 取分号分隔的纯数字 5-15 位 + 字母数字组合 6-20 位（排除银行账号、金额）
   */
  function extractCandidateCodes(invoice: (typeof invoices)[number]): string[] {
    const remarks: string = (invoice.rawOcrJson as any)?.Remarks || "";
    if (!remarks) return [];
    const codes: string[] = [];
    // 按分号切分，每段取 `：:` 后面的值
    for (const seg of remarks.split(/[;；]/)) {
      const m = seg.match(/[：:]\s*(.+)/);
      if (m) {
        const val = m[1].trim();
        // 排除银行账号（包含"银行"前缀或纯16位以上数字）
        if (seg.includes("银行") && /^\d{16,}$/.test(val)) continue;
        // 纯数字 5-15 位（如订单号、单号）
        if (/^\d{5,15}$/.test(val)) codes.push(val);
        // 字母数字组合 6-20 位（如 XSAZDA00117421）
        else if (/^[A-Za-z0-9]{6,20}$/.test(val)) codes.push(val);
      }
    }
    return codes;
  }

  for (const invoice of invoices) {
    let matchedIds: string[] = [];
    let strategyUsed = "";

    /**
     * 尝试一个策略：如果找到匹配则以该策略为准，不再尝试后续策略。
     * 同一策略内的多个匹配是合理的（如一个订单号关联多张发货单）。
     */
    function tryStrategy(name: string, candidates: (typeof receipts)[number][]): boolean {
      if (matchedIds.length > 0 || candidates.length === 0) return false;
      matchedIds = candidates.map((r) => r.id);
      strategyUsed = name;
      return true;
    }

    // 策略1: orderNo 精确匹配（可一对多）
    if (invoice.orderNo) {
      const exact = receipts.filter(
        (r) => r.orderNo?.toLowerCase() === invoice.orderNo?.toLowerCase()
      );
      if (exact.length > 0) {
        tryStrategy("订单号精确匹配", exact);
      }
    }

    // 策略2: orderNo 模糊匹配（互相包含）
    if (!strategyUsed && invoice.orderNo) {
      const fuzzy = receipts.filter((r) => {
        if (!r.orderNo) return false;
        const ro = r.orderNo.toLowerCase();
        const io = invoice.orderNo!.toLowerCase();
        return ro.includes(io) || io.includes(ro);
      });
      tryStrategy("订单号模糊匹配", fuzzy);
    }

    // 策略2.5: 发票 orderNo = 签收单文件名（精确匹配，不需要签收单有 orderNo）
    if (!strategyUsed && invoice.orderNo && invoice.orderNo.length >= 5) {
      const on = invoice.orderNo.toLowerCase();
      tryStrategy("订单号↔签收单文件名", receipts.filter((r) =>
        baseName(r.file.originalName).toLowerCase() === on
      ));
    }

    // 策略3: 发票文件名 = 签收单文件名
    if (!strategyUsed) {
      const invBase = baseName(invoice.file.originalName);
      tryStrategy("文件名精确匹配", receipts.filter((r) => baseName(r.file.originalName) === invBase));
    }

    // 策略4: 发票备注中的编号 = 签收单文件名（只精确匹配）
    if (!strategyUsed) {
      const codes = extractCandidateCodes(invoice);
      for (const code of codes) {
        const found = receipts.filter((r) => baseName(r.file.originalName) === code);
        if (tryStrategy("备注编号↔文件名精确匹配", found)) break;
      }
    }

    // 为每个匹配到的签收单创建关联
    for (const receiptId of matchedIds) {
      const matched = receipts.find((r) => r.id === receiptId)!;
      const existing = await prisma.invoiceReceiptLink.findFirst({
        where: { invoiceId: invoice.id, receiptId: matched!.id },
      });
      if (!existing) {
        const matchKey = invoice.orderNo || baseName(invoice.file.originalName);

        const link = await prisma.invoiceReceiptLink.create({
          data: {
            projectId,
            invoiceId: invoice.id,
            receiptId: matched!.id,
            matchType: "auto",
            matchKey,
          },
        });
        links.push(link);

        await prisma.auditLog.create({
          data: {
            projectId,
            step: "match",
            action: `[${strategyUsed}] 发票 ${invoice.invoiceNo || baseName(invoice.file.originalName)} ↔ 签收单 ${matched!.documentCode || baseName(matched!.file.originalName)}`,
            inputData: {
              strategy: strategyUsed,
              matchKey,
              invoiceFile: invoice.file.originalName,
              receiptFile: matched!.file.originalName,
            } as any,
            status: "success",
          },
        });
      }
    }
  }

  return links;
}

// ─── 批量处理项目 ───
export async function processProject(
  projectId: string,
  onProgress?: (p: { step: string; done: number; total: number }) => void,
  force = false
) {
  try {
    // force 模式：重置所有已完成项；卡死自动恢复
    const prevStatus = await prisma.project.findUnique({ where: { id: projectId }, select: { status: true } });
    if (force || prevStatus?.status === "processing") {
      await prisma.invoice.updateMany({ where: { projectId, status: "completed" }, data: { status: "pending" } });
      await prisma.receipt.updateMany({ where: { projectId, status: "completed" }, data: { status: "pending" } });
      await prisma.invoiceReceiptLink.deleteMany({ where: { projectId } });
    }

    await prisma.project.update({
      where: { id: projectId },
      data: { status: "processing" },
    });

    // 创建待处理记录（并行）
    const [invoiceFiles, receiptFiles] = await Promise.all([
      prisma.file.findMany({ where: { projectId, category: "invoice" } }),
      prisma.file.findMany({ where: { projectId, category: "receipt" } }),
    ]);

    await Promise.all([
      ...invoiceFiles.map(async (file) => {
        const existing = await prisma.invoice.findFirst({ where: { fileId: file.id } });
        if (!existing) await prisma.invoice.create({ data: { projectId, fileId: file.id, status: "pending" } });
      }),
      ...receiptFiles.map(async (file) => {
        const existing = await prisma.receipt.findFirst({ where: { fileId: file.id } });
        if (!existing) await prisma.receipt.create({ data: { projectId, fileId: file.id, status: "pending" } });
      }),
    ]);

    // 处理发票（并发 2 个）
    const pendingInvoices = await prisma.invoice.findMany({
      where: { projectId, status: "pending" },
    });
    let doneInv = 0;
    onProgress?.({ step: "识别发票", done: 0, total: pendingInvoices.length });
    await runWithConcurrency(pendingInvoices, async (inv) => {
      await processInvoice(inv.id);
      doneInv++;
      onProgress?.({ step: "识别发票", done: doneInv, total: pendingInvoices.length });
    }, 2);

    // 处理签收单（并发 2 个）
    const pendingReceipts = await prisma.receipt.findMany({
      where: { projectId, status: "pending" },
    });
    let doneRec = 0;
    onProgress?.({ step: "识别发货单", done: 0, total: pendingReceipts.length });
    await runWithConcurrency(pendingReceipts, async (rec) => {
      await processReceipt(rec.id);
      doneRec++;
      onProgress?.({ step: "识别发货单", done: doneRec, total: pendingReceipts.length });
    }, 2);

    // 自动匹配（外层 try-catch 保护）
    try {
      await autoMatch(projectId);
    } catch (err) {
      console.error("autoMatch failed:", err);
      // 匹配失败不阻止状态更新
    }

    await prisma.project.update({
      where: { id: projectId },
      data: { status: "completed" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "未知错误";
    console.error("processProject failed:", projectId, message);
    // 确保项目状态更新为失败
    try {
      await prisma.project.update({
        where: { id: projectId },
        data: { status: "failed" },
      });
    } catch { /* 状态更新失败也不应再抛异常 */ }
    throw err;
  }
}
