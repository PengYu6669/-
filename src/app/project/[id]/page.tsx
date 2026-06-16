"use client";

import { useEffect, useState, use, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FolderUpload } from "@/components/upload/folder-upload";
import { TemplateUpload } from "@/components/upload/template-upload";
import { FieldMapping } from "@/components/upload/field-mapping";
import { ExcelPreview } from "@/components/table/excel-preview";
import { InvoiceTable } from "@/components/table/invoice-table";
import {
  ArrowLeft, FileText, Receipt, RefreshCw, Loader2,
  Upload, Table2, FileSpreadsheet, Eye, Play
} from "lucide-react";
import { toast } from "sonner";

interface FieldMappingData {
  id: string;
  columnIndex: number;
  headerName: string;
  sourceType: string | null;
  sourceField: string | null;
  suggestedBy: string;
  staticValue: string | null;
}

interface ProjectDetail {
  id: string;
  name: string;
  status: string;
  fileCount: number;
  createdAt: string;
  _count: { files: number; invoices: number; receipts: number; links: number };
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState("files");

  // 模板相关
  const [templateHeaders, setTemplateHeaders] = useState<string[]>([]);
  const [fieldMappings, setFieldMappings] = useState<FieldMappingData[]>([]);

  const fetchProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${id}`);
      if (!res.ok) throw new Error("项目不存在");
      setProject(await res.json());

      // 加载已有模板
      const tRes = await fetch(`/api/projects/${id}/template`);
      const tData = await tRes.json();
      if (tData.headers?.length) {
        setTemplateHeaders(tData.headers);
        setFieldMappings(tData.mappings || []);
      }
    } catch {
      toast.error("加载项目失败");
      router.push("/");
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => { fetchProject(); }, [fetchProject]);

  const triggerProcess = async () => {
    setProcessing(true);
    try {
      const res = await fetch(`/api/projects/${id}/process`, { method: "POST" });
      if (!res.ok) throw new Error("启动失败");
      toast.success("识别处理已启动，正在后台运行...");

      // 轮询项目状态
      const poll = setInterval(async () => {
        try {
          const r = await fetch(`/api/projects/${id}`);
          const p = await r.json();
          setProject(p);
          if (p.status === "completed" || p.status === "failed") {
            clearInterval(poll);
            setProcessing(false);
            toast.success(p.status === "completed" ? "✅ 识别处理完成！" : "⚠️ 处理完成，部分文件失败");
            fetchProject();
          }
        } catch { /* ignore poll errors */ }
      }, 3000);

      // 超时停止轮询
      setTimeout(() => { clearInterval(poll); setProcessing(false); }, 120000);
    } catch {
      toast.error("启动处理失败");
      setProcessing(false);
    }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      pending: { label: "待处理", variant: "secondary" },
      processing: { label: "处理中", variant: "default" },
      completed: { label: "已完成", variant: "outline" },
      failed: { label: "有失败", variant: "destructive" },
    };
    const s = map[status] || { label: status, variant: "secondary" as const };
    return <Badge variant={s.variant}>{s.label}</Badge>;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!project) return null;

  const hasMappings = fieldMappings.length > 0 && fieldMappings.some(m => m.sourceField);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-950 dark:to-slate-900">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm dark:bg-slate-950/80 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push("/")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1 flex items-center gap-3">
            <h1 className="text-xl font-bold">{project.name}</h1>
            {statusBadge(project.status)}
          </div>
          <Button variant="outline" size="sm" onClick={fetchProject}>
            <RefreshCw className="w-4 h-4 mr-2" />刷新
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* 统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">文件总数</CardTitle>
              <FileText className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold">{project._count.files}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">发票</CardTitle>
              <FileText className="w-4 h-4 text-blue-500" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold">{project._count.invoices}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">签收单</CardTitle>
              <Receipt className="w-4 h-4 text-green-500" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold">{project._count.receipts}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">已关联</CardTitle>
              <Receipt className="w-4 h-4 text-purple-500" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold">{project._count.links}</p></CardContent>
          </Card>
        </div>

        {/* 工作流 Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-4 w-full max-w-2xl">
            <TabsTrigger value="files" className="gap-2">
              <Upload className="w-4 h-4" /> ① 上传文件
            </TabsTrigger>
            <TabsTrigger value="template" className="gap-2">
              <FileSpreadsheet className="w-4 h-4" /> ② 模板映射
            </TabsTrigger>
            <TabsTrigger value="preview" className="gap-2">
              <Eye className="w-4 h-4" /> ③ 预览
            </TabsTrigger>
            <TabsTrigger value="data" className="gap-2">
              <Table2 className="w-4 h-4" /> ④ 数据表
            </TabsTrigger>
          </TabsList>

          {/* ① 上传文件 */}
          <TabsContent value="files" className="mt-4 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">📤 上传发票与签收单</CardTitle>
              </CardHeader>
              <CardContent>
                <FolderUpload projectId={id} onUploadComplete={fetchProject} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">🚀 开始识别</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-4">
                <Button
                  onClick={triggerProcess}
                  disabled={processing || project.status === "processing"}
                  size="lg"
                >
                  {(processing || project.status === "processing") ? (
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  ) : (
                    <Play className="w-5 h-5 mr-2" />
                  )}
                  {project.status === "processing" ? "识别处理中..." : "开始 OCR + LLM 识别"}
                </Button>
                <div className="text-sm text-muted-foreground">
                  {project.status === "pending" && "上传文件后点击此处，系统将自动进行OCR识别和字段提取"}
                  {project.status === "processing" && "⏳ 系统正在处理文件，请稍候...（完成后自动刷新）"}
                  {project.status === "completed" && "✅ 识别完成！切换到「预览」或「数据表」查看结果"}
                  {project.status === "failed" && "⚠️ 部分文件处理失败，可点击重试"}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ② 模板映射 */}
          <TabsContent value="template" className="mt-4 space-y-4">
            <TemplateUpload
              projectId={id}
              headers={templateHeaders}
              mappings={fieldMappings}
              onTemplateReady={(headers, mappings) => {
                setTemplateHeaders(headers);
                setFieldMappings(mappings);
              }}
            />
            {templateHeaders.length > 0 && (
              <FieldMapping
                projectId={id}
                headers={templateHeaders}
                mappings={fieldMappings}
                onMappingsUpdated={setFieldMappings}
              />
            )}
          </TabsContent>

          {/* ③ Excel 预览 */}
          <TabsContent value="preview" className="mt-4">
            <ExcelPreview projectId={id} hasMappings={hasMappings} />
          </TabsContent>

          {/* ④ 数据表 */}
          <TabsContent value="data" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">📊 提取结果列表</CardTitle>
              </CardHeader>
              <CardContent>
                <InvoiceTable projectId={id} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
