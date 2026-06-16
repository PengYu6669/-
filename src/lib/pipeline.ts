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

    // Step 3: DeepSeek 从备注提取订单号
    const remarks = (ocrResult.Remarks || "") as string;
    const { orderNo, raw: llmRaw } = await extractOrderNo(remarks);

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

  for (const invoice of invoices) {
    let matched: (typeof receipts)[number] | undefined;

    // 策略1: orderNo 精确匹配
    if (invoice.orderNo) {
      matched = receipts.find(
        (r) => r.orderNo?.toLowerCase() === invoice.orderNo?.toLowerCase()
      );
      if (!matched) {
        matched = receipts.find(
          (r) =>
            r.orderNo?.toLowerCase().includes(invoice.orderNo!.toLowerCase()) ||
            invoice.orderNo?.toLowerCase().includes(r.orderNo?.toLowerCase() || "")
        );
      }
    }

    // 策略2: 文件名匹配（去掉扩展名后一致）
    if (!matched) {
      const invBase = baseName(invoice.file.originalName);
      matched = receipts.find((r) => baseName(r.file.originalName) === invBase);
    }

    if (matched) {
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
            action: `自动匹配: 发票 ${invoice.invoiceNo || baseName(invoice.file.originalName)} ↔ 签收单 ${matched!.documentCode || baseName(matched!.file.originalName)}`,
            inputData: {
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
export async function processProject(projectId: string) {
  try {
    await prisma.project.update({
      where: { id: projectId },
      data: { status: "processing" },
    });

    // 创建待处理记录
    const invoiceFiles = await prisma.file.findMany({
      where: { projectId, category: "invoice" },
    });
    for (const file of invoiceFiles) {
      const existing = await prisma.invoice.findFirst({ where: { fileId: file.id } });
      if (!existing) {
        await prisma.invoice.create({
          data: { projectId, fileId: file.id, status: "pending" },
        });
      }
    }

    const receiptFiles = await prisma.file.findMany({
      where: { projectId, category: "receipt" },
    });
    for (const file of receiptFiles) {
      const existing = await prisma.receipt.findFirst({ where: { fileId: file.id } });
      if (!existing) {
        await prisma.receipt.create({
          data: { projectId, fileId: file.id, status: "pending" },
        });
      }
    }

    // 处理发票
    const pendingInvoices = await prisma.invoice.findMany({
      where: { projectId, status: "pending" },
    });
    for (const inv of pendingInvoices) {
      try {
        await processInvoice(inv.id);
      } catch { /* 单个失败不影响整体 */ }
    }

    // 处理签收单
    const pendingReceipts = await prisma.receipt.findMany({
      where: { projectId, status: "pending" },
    });
    for (const rec of pendingReceipts) {
      try {
        await processReceipt(rec.id);
      } catch { /* 单个失败不影响整体 */ }
    }

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
