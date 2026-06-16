import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { downloadFromTOS } from "@/lib/storage";

// GET /api/files/[id] — 代理 TOS 文件（保证 inline 显示，不触发下载）
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const file = await prisma.file.findUnique({ where: { id } });
  if (!file) return NextResponse.json({ error: "文件不存在" }, { status: 404 });

  try {
    const buffer = await downloadFromTOS(file.storedPath);

    const mimeMap: Record<string, string> = {
      pdf: "application/pdf",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
    };
    const mime = mimeMap[file.fileType] || "application/octet-stream";

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err: any) {
    console.error("❌ files API TOS:", file.storedPath, err?.message || err);
    return NextResponse.json({ error: `获取文件失败: ${err?.message || err}` }, { status: 500 });
  }
}
