"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Upload, FolderUp, X, FileText, Image, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface UploadFile {
  path: string;
  file: File;
}

interface Props {
  projectId: string;
  onUploadComplete: () => void;
}

export function FolderUpload({ projectId, onUploadComplete }: Props) {
  const [dragActive, setDragActive] = useState(false);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  // 递归读取文件夹
  const readDirectory = useCallback(
    async (
      entry: FileSystemEntry,
      basePath = ""
    ): Promise<UploadFile[]> => {
      const results: UploadFile[] = [];

      if (entry.isFile) {
        const fileEntry = entry as FileSystemFileEntry;
        const file = await new Promise<File>((resolve) =>
          fileEntry.file(resolve)
        );
        const ext = file.name.split(".").pop()?.toLowerCase() || "";
        if (["pdf", "jpg", "jpeg", "png"].includes(ext)) {
          results.push({ path: basePath + file.name, file });
        }
      } else if (entry.isDirectory) {
        const dirEntry = entry as FileSystemDirectoryEntry;
        const reader = dirEntry.createReader();
        const entries = await new Promise<FileSystemEntry[]>((resolve) => {
          reader.readEntries((entries) => resolve(entries));
        });
        for (const child of entries) {
          const childFiles = await readDirectory(
            child,
            basePath + dirEntry.name + "/"
          );
          results.push(...childFiles);
        }
      }

      return results;
    },
    []
  );

  // 处理拖拽
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);

      const items = e.dataTransfer.items;
      if (!items) return;

      const allFiles: UploadFile[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "file") {
          const entry =
            (item as unknown as { webkitGetAsEntry?: () => FileSystemEntry }).webkitGetAsEntry?.() ||
            null;
          if (entry) {
            const entryFiles = await readDirectory(entry);
            allFiles.push(...entryFiles);
          }
        }
      }

      if (allFiles.length === 0) {
        toast.warning("未找到支持的 PDF、JPG 或 PNG 文件");
        return;
      }

      setFiles((prev) => [...prev, ...allFiles]);
      toast.success(`已添加 ${allFiles.length} 个文件`);
    },
    [readDirectory]
  );

  // 上传
  const handleUpload = async () => {
    if (files.length === 0) return;

    setUploading(true);
    setProgress(0);

    const formData = new FormData();
    for (const f of files) {
      formData.append("files", f.file);
      formData.append("files_path", f.path);
    }

    try {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/projects/${projectId}/upload`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      const result = await new Promise<{ created: number; errors: string[] }>(
        (resolve, reject) => {
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(JSON.parse(xhr.responseText));
            } else {
              reject(new Error(xhr.statusText));
            }
          };
          xhr.onerror = () => reject(new Error("上传失败"));
          xhr.send(formData);
        }
      );

      toast.success(`上传完成：${result.created} 个文件`);
      if (result.errors.length > 0) {
        result.errors.slice(0, 3).forEach((e: string) => toast.warning(e));
      }
      setFiles([]);
      onUploadComplete();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "上传失败";
      toast.error(message);
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const getIcon = (name: string) => {
    const ext = name.split(".").pop()?.toLowerCase();
    if (ext === "pdf") return <FileText className="w-4 h-4 text-red-500" />;
    return <Image className="w-4 h-4 text-blue-500" />;
  };

  return (
    <div className="space-y-4">
      {/* 拖拽区域 */}
      <div
        className={`relative border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer
          ${dragActive
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-muted-foreground/50"
          }
          ${uploading ? "pointer-events-none opacity-50" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onClick={() => {
          const input = document.createElement("input");
          input.type = "file";
          input.multiple = true;
          input.webkitdirectory = true;
          input.onchange = async (e) => {
            const fileList = (e.target as HTMLInputElement).files;
            if (!fileList) return;
            const allFiles: UploadFile[] = Array.from(fileList).map((f) => ({
              path: (f as unknown as { webkitRelativePath?: string }).webkitRelativePath || f.name,
              file: f,
            }));
            setFiles((prev) => [...prev, ...allFiles]);
          };
          input.click();
        }}
      >
        <div className="flex flex-col items-center gap-2">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
            <FolderUp className="w-7 h-7 text-primary" />
          </div>
          <p className="text-lg font-medium">
            拖拽文件夹到这里，或点击选择
          </p>
          <p className="text-sm text-muted-foreground">
            支持 PDF、JPG、PNG · 保留目录结构 · 自动识别发票和签收单
          </p>
        </div>
      </div>

      {/* 文件列表 */}
      {files.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium">
              待上传文件 ({files.length})
            </h3>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setFiles([])} disabled={uploading}>
                清空
              </Button>
              <Button size="sm" onClick={handleUpload} disabled={uploading}>
                {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                开始上传
              </Button>
            </div>
          </div>

          {uploading && <Progress value={progress} className="mb-3" />}

          <div className="max-h-60 overflow-y-auto space-y-1">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-sm py-1.5 px-2 rounded hover:bg-muted/50 group">
                {getIcon(f.file.name)}
                <span className="flex-1 truncate">{f.path}</span>
                <span className="text-xs text-muted-foreground">
                  {(f.file.size / 1024).toFixed(0)} KB
                </span>
                {!uploading && (
                  <button onClick={() => removeFile(i)} className="opacity-0 group-hover:opacity-100">
                    <X className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
