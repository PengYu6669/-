import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sha256 } from "@/lib/pdf";
import { uploadToTOS } from "@/lib/storage";
import crypto from "crypto";
import JSZip from "jszip";

// POST /api/projects/[id]/upload
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  try {
    const formData = await req.formData();

    const allFiles = formData.getAll("files");
    const allPaths = formData.getAll("files_path") as string[];

    const createdFiles: unknown[] = [];
    const errors: string[] = [];

    for (let i = 0; i < allFiles.length; i++) {
      const entry = allFiles[i];
      const relativePath = allPaths[i] || `file_${i}`;

      if (!entry || typeof entry === "string") {
        errors.push(`无效文件: ${relativePath}`);
        continue;
      }

      try {
        const file = entry as File;
        const ext = relativePath.split(".").pop()?.toLowerCase() || "";
        if (!["pdf", "jpg", "jpeg", "png", "docx"].includes(ext)) {
          errors.push(`不支持的文件类型: ${relativePath}`);
          continue;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const buffer = Buffer.from(await (file as any).arrayBuffer());

        // ── .docx 文档：提取嵌入的图片 ──
        if (ext === "docx") {
          try {
            const zip = await JSZip.loadAsync(buffer);
            const mediaFiles = Object.keys(zip.files).filter((f) =>
              f.startsWith("word/media/") && !f.endsWith("/")
            );

            if (mediaFiles.length === 0) {
              errors.push(`Word 文档中未找到图片: ${relativePath}`);
            }

            for (const mediaPath of mediaFiles) {
              const imgData = await zip.files[mediaPath].async("nodebuffer");
              const imgExt = mediaPath.split(".").pop()?.toLowerCase() || "png";
              if (!["jpg", "jpeg", "png"].includes(imgExt)) continue;

              const imgHash = sha256(imgData);
              const imgExisting = await prisma.file.findFirst({
                where: { projectId: id, hashSha256: imgHash },
              });
              if (imgExisting) {
                errors.push(`文档内图片已存在: ${relativePath}/${mediaPath}`);
                continue;
              }

              // 文件名：文档基础名 + 图片序号
              const docBase = relativePath.replace(/\.docx$/i, "");
              const imgName = `${docBase}_图${mediaFiles.indexOf(mediaPath) + 1}.${imgExt}`;
              const storedKey = `projects/${id}/files/${crypto.randomUUID()}.${imgExt}`;
              const mime = imgExt === "png" ? "image/png" : "image/jpeg";
              const tosKey = await uploadToTOS(imgData, storedKey, mime);

              // 分类：根据文档路径判断
              const catFileName = relativePath.toLowerCase().replace(/\\/g, "/");
              let category = "unknown";
              if (catFileName.includes("发票")) category = "invoice";
              else if (catFileName.includes("签收") || catFileName.includes("发货")) category = "receipt";

              const record = await prisma.file.create({
                data: {
                  projectId: id,
                  originalName: imgName,
                  storedPath: tosKey,
                  fileType: imgExt === "png" ? "png" : "jpg",
                  fileSize: imgData.length,
                  category,
                  parentDir: relativePath.substring(0, relativePath.lastIndexOf("/") || undefined) || null,
                  pageCount: 1,
                  hashSha256: imgHash,
                },
              });
              createdFiles.push({ id: record.id, name: record.originalName });
            }
          } catch (zipErr: any) {
            errors.push(`Word 文档解析失败 ${relativePath}: ${zipErr.message}`);
          }
          continue; // docx 本身不存，继续下一个文件
        }

        const hash = sha256(buffer);

        // 去重检查
        const existing = await prisma.file.findFirst({
          where: { projectId: id, hashSha256: hash },
        });
        if (existing) {
          errors.push(`文件已存在，跳过: ${relativePath}`);
          continue;
        }

        // 存储到 TOS
        const storedKey = `projects/${id}/files/${crypto.randomUUID()}.${ext}`;
        const mimeMap: Record<string, string> = {
          pdf: "application/pdf",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          png: "image/png",
        };
        const contentType = mimeMap[ext] || "application/octet-stream";
        const tosKey = await uploadToTOS(buffer, storedKey, contentType);

        // 智能分类
        const fileName = relativePath.toLowerCase().replace(/\\/g, "/");
        const parts = fileName.split("/");
        const baseName = parts[parts.length - 1];
        let category = "unknown";

        if (fileName.includes("发票")) {
          category = "invoice";
        } else if (
          fileName.includes("签收") ||
          fileName.includes("发货") ||
          fileName.includes("货物签收单") ||
          (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 2])) ||
          (parts.length === 1 && /^\d+/.test(baseName))
        ) {
          category = "receipt";
        }

        const fileType = ext === "pdf" ? "pdf" : (["jpg", "jpeg"].includes(ext) ? "jpg" : "png");
        const parentDir = relativePath.includes("/")
          ? relativePath.substring(0, relativePath.lastIndexOf("/"))
          : null;

        const record = await prisma.file.create({
          data: {
            projectId: id,
            originalName: relativePath.split("/").pop() || relativePath,
            storedPath: tosKey,  // 存 TOS key
            fileType,
            fileSize: buffer.length,
            category,
            parentDir,
            pageCount: 1,
            hashSha256: hash,
          },
        });

        createdFiles.push({ id: record.id, name: record.originalName });

        await prisma.auditLog.create({
          data: {
            projectId: id,
            fileId: record.id,
            step: "upload",
            action: `上传文件到 TOS: ${relativePath}`,
            status: "success",
          },
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "未知错误";
        errors.push(`上传失败 ${relativePath}: ${message}`);
        console.error("Upload error for", relativePath, err);
      }
    }

    const fileCount = await prisma.file.count({ where: { projectId: id } });
    await prisma.project.update({
      where: { id },
      data: { fileCount },
    });

    return NextResponse.json({
      created: createdFiles.length,
      errors,
      files: createdFiles,
    });
  } catch (err: unknown) {
    console.error("Upload route error:", err);
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json(
      { error: message, created: 0, errors: [message] },
      { status: 500 }
    );
  }
}
