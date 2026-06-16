import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSignedUrl } from "@/lib/storage";

// GET /api/files/[id] — 获取原始文件（重定向到 TOS 预签名 URL）
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const file = await prisma.file.findUnique({ where: { id } });
  if (!file) return NextResponse.json({ error: "文件不存在" }, { status: 404 });

  try {
    const url = await getSignedUrl(file.storedPath, 86400); // 24h 有效期
    return NextResponse.redirect(url);
  } catch (err) {
    console.error("❌ files API: TOS 签名失败:", file.storedPath, err);
    return NextResponse.json({ error: "获取文件失败" }, { status: 500 });
  }
}
