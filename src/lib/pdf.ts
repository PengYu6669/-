/**
 * 文件处理服务
 * 从 TOS 下载文件转 base64，图片增强后传百度 OCR
 */

import { downloadFromTOS } from "@/lib/storage";
import crypto from "crypto";

/** MIME 映射 */
const MIME_MAP: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

/** 从 TOS 读文件 → base64（百度 OCR 内部已做图像优化，无需本地预处理） */
export async function fileToBase64(
  storedPath: string
): Promise<{ base64: string; fileType: string }> {
  const buffer = await downloadFromTOS(storedPath);
  const ext = storedPath.split(".").pop()?.toLowerCase() || "png";
  const mime = MIME_MAP[ext] || "image/png";
  return {
    base64: `data:${mime};base64,${buffer.toString("base64")}`,
    fileType: ext === "pdf" ? "pdf" : "jpg",
  };
}

/** 计算文件 SHA256 */
export function sha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** 获取存储相对路径（已废弃，现在用 TOS key） */
export function getStoredPath(projectId: string, relativePath: string): string {
  return `projects/${projectId}/files/${relativePath}`;
}
