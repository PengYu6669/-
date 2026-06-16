"use client";

import { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Image as ImageIcon, FileText, Clock, Maximize2, X } from "lucide-react";

interface TraceData {
  recordType?: string;
  record?: Record<string, unknown>;
  sourceFile?: { id?: string; name?: string; originalName?: string; type?: string; fileType?: string };
  auditLogs?: { id: string; step: string; action: string; status: string; createdAt: string; errorMessage?: string }[];
  highlightedField?: string;
  invoice?: Record<string, unknown>;
  receipt?: Record<string, unknown>;
}

interface Props {
  type: "invoice" | "receipt";
  recordId: string | null;
  open: boolean;
  onClose: () => void;
  highlightField?: string;
  cellInfo?: { header: string; value: unknown; sourceType: string; sourceFile: string } | null;
}

export function TracePanel({ type, recordId, open, onClose, highlightField, cellInfo }: Props) {
  const [data, setData] = useState<TraceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [fileId, setFileId] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);
  const [imgZoom, setImgZoom] = useState(false);

  useEffect(() => {
    if (!recordId || !open) {
      setData(null);
      setFileId(null);
      setImgError(false);
      setImgZoom(false);
      return;
    }

    setLoading(true);
    const apiUrl = cellInfo
      ? `/api/cells/trace?type=${type}&id=${recordId}&field=${encodeURIComponent(highlightField || "")}`
      : `/api/${type}s/${recordId}/trace`;

    fetch(apiUrl)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        const record = d.record || d.invoice || d.receipt || {};
        const fid = (record.fileId as string) || d.sourceFile?.id;
        if (fid) setFileId(fid);
      })
      .finally(() => setLoading(false));
  }, [recordId, open, type, highlightField, cellInfo]);

  if (!open) return null;

  const record = data?.record || data?.invoice || data?.receipt || {};
  const sourceFile = data?.sourceFile;
  const fileType = (sourceFile?.type || sourceFile?.fileType || "").toLowerCase();
  const isPdf = fileType === "pdf";
  const isImage = fileType === "jpg" || fileType === "jpeg" || fileType === "png";
  const displayName = sourceFile?.name || sourceFile?.originalName || "";

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header */}
      <div className="px-4 py-3 border-b shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            🔍 {type === "invoice" ? "发票" : "签收单"} 溯源
            {displayName && (
              <Badge variant="outline" className="text-xs font-normal">
                {displayName}
              </Badge>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
            aria-label="关闭"
          >
            <svg width="14" height="14" viewBox="0 0 15 15" fill="none"><path d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z" fill="currentColor"/></svg>
          </button>
        </div>
        {cellInfo && (
          <div className="mt-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs">
            📌 列「{cellInfo.header}」= {String(cellInfo.value)}
            <br />来源: {cellInfo.sourceFile}
          </div>
        )}
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : data ? (
        <Tabs defaultValue="image" className="flex-1 flex flex-col min-h-0">
          <TabsList className="mx-3 mt-2 grid grid-cols-3 shrink-0">
            <TabsTrigger value="image" className="gap-1 text-xs"><ImageIcon className="w-3 h-3" />原始文件</TabsTrigger>
            <TabsTrigger value="fields" className="gap-1 text-xs"><FileText className="w-3 h-3" />提取字段</TabsTrigger>
            <TabsTrigger value="timeline" className="gap-1 text-xs"><Clock className="w-3 h-3" />处理记录</TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 px-3 py-2 min-h-0">
            {/* 原始文件 */}
            <TabsContent value="image" className="mt-0 h-full">
              {!fileId ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  <ImageIcon className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p>无法预览</p>
                </div>
              ) : isPdf ? (
                <iframe
                  src={`/api/files/${fileId}`}
                  className="w-full rounded-lg border"
                  style={{ height: "75vh", minHeight: "500px" }}
                  title="PDF 预览"
                />
              ) : isImage && !imgError ? (
                <div className="space-y-2">
                  <div className="relative group cursor-pointer" onClick={() => setImgZoom(true)}>
                    <img
                      src={`/api/files/${fileId}`}
                      alt="原始文件"
                      className="w-full rounded-lg border hover:ring-2 hover:ring-primary/30 transition-all"
                      onError={() => setImgError(true)}
                      style={{ maxHeight: "55vh", objectFit: "contain" }}
                    />
                    <div className="absolute top-2 right-2 bg-black/60 text-white rounded-md p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Maximize2 className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground text-center">💡 点击图片可放大查看</p>
                </div>
              ) : imgError ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  <ImageIcon className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p>图片加载失败</p>
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  <ImageIcon className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p>不支持的文件类型</p>
                </div>
              )}
            </TabsContent>

            {/* 提取字段 */}
            <TabsContent value="fields" className="mt-0">
              <div className="space-y-0.5">
                {Object.entries(record).filter(([k]) =>
                  !k.startsWith("raw") && !k.startsWith("_") && k !== "id" && k !== "projectId" && k !== "fileId"
                ).map(([key, val]) => (
                  <div key={key} className={`flex justify-between py-1 px-2 rounded text-sm ${
                    highlightField && (key === highlightField || `invoice.${key}` === highlightField || `receipt.${key}` === highlightField)
                      ? "bg-amber-100 dark:bg-amber-900/30 font-medium" : ""
                  }`}>
                    <span className="text-muted-foreground">{key}</span>
                    <span className="font-mono text-xs">{val != null ? String(val) : "-"}</span>
                  </div>
                ))}
              </div>
            </TabsContent>

            {/* 处理记录 */}
            <TabsContent value="timeline" className="mt-0">
              {data.auditLogs && data.auditLogs.length > 0 ? (
                <div className="space-y-3">
                  {data.auditLogs.map((log, i) => (
                    <div key={log.id || i} className="flex gap-2 text-sm">
                      <div className="flex flex-col items-center">
                        <div className={`w-2 h-2 rounded-full mt-1.5 ${
                          log.status === "success" ? "bg-green-500" : log.status === "failed" ? "bg-red-500" : "bg-yellow-500"
                        }`} />
                        {i < (data.auditLogs?.length || 0) - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                      </div>
                      <div className="flex-1 pb-3">
                        <p className="font-medium text-xs">{log.action}</p>
                        <p className="text-xs text-muted-foreground">{new Date(log.createdAt).toLocaleTimeString("zh-CN")}</p>
                        {log.errorMessage && (
                          <p className="text-xs text-red-500 mt-1 bg-red-50 dark:bg-red-950/20 p-1.5 rounded">{log.errorMessage}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">无处理记录</p>
              )}
            </TabsContent>
          </ScrollArea>
        </Tabs>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">无数据</div>
      )}

      {/* 图片全屏放大 */}
      {imgZoom && fileId && (
        <div className="fixed inset-0 z-[10000] bg-black/90 flex items-center justify-center p-4" onClick={() => setImgZoom(false)}>
          <button className="absolute top-4 right-4 text-white/80 hover:text-white p-2 rounded-full hover:bg-white/10" onClick={() => setImgZoom(false)}>
            <X className="w-6 h-6" />
          </button>
          <img src={`/api/files/${fileId}`} alt="放大" className="max-w-full max-h-full object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
