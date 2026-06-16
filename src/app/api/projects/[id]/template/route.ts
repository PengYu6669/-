import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import ExcelJS from "exceljs";

const UPLOAD_DIR =
  process.env.UPLOAD_DIR || join(process.cwd(), "uploads");

// POST /api/projects/[id]/template — 上传Excel模板并解析表头
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "请上传文件" }, { status: 400 });

  // 保存模板文件
  const storedName = `template_${Date.now()}.xlsx`;
  const storedPath = join("projects", id, "templates", storedName);
  const fullPath = join(UPLOAD_DIR, storedPath);
  await mkdir(join(fullPath, ".."), { recursive: true });

  const arrayBuf = await file.arrayBuffer();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = Buffer.from(arrayBuf as any);
  await writeFile(fullPath, buffer);

  // 解析表头
  const workbook = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);
  const sheet = workbook.worksheets[0];
  const headers: string[] = [];

  sheet.getRow(1).eachCell((cell) => {
    const val = cell.value?.toString().trim();
    if (val) headers.push(val);
  });

  // 删旧模板
  await prisma.template.deleteMany({ where: { projectId: id } });

  // 存新模板
  const template = await prisma.template.create({
    data: {
      projectId: id,
      originalName: file.name,
      storedPath,
      headers: headers,
    },
  });

  return NextResponse.json({ template, headers });
}

// GET /api/projects/[id]/template — 获取项目模板
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const template = await prisma.template.findFirst({
    where: { projectId: id },
    include: { mappings: { orderBy: { columnIndex: "asc" } } },
    orderBy: { createdAt: "desc" },
  });

  if (!template) return NextResponse.json({ template: null, headers: [], mappings: [] });

  return NextResponse.json({
    template,
    headers: template.headers as string[],
    mappings: template.mappings,
  });
}
