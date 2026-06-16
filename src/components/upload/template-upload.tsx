"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileSpreadsheet, Upload, Loader2, Check, X } from "lucide-react";
import { toast } from "sonner";

interface Props {
  projectId: string;
  headers: string[];
  mappings: FieldMapping[];
  onTemplateReady: (headers: string[], mappings: FieldMapping[]) => void;
}

interface FieldMapping {
  id: string;
  columnIndex: number;
  headerName: string;
  sourceType: string | null;
  sourceField: string | null;
  suggestedBy: string;
  staticValue: string | null;
}

export function TemplateUpload({ projectId, headers, mappings, onTemplateReady }: Props) {
  const [uploading, setUploading] = useState(false);
  const [hasTemplate, setHasTemplate] = useState(headers.length > 0);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch(`/api/projects/${projectId}/template`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();

      if (data.error) {
        toast.error(data.error);
        return;
      }

      toast.success(`模板已上传，识别到 ${data.headers.length} 列`);
      setHasTemplate(true);
      onTemplateReady(data.headers, []);
    } catch {
      toast.error("上传失败");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-green-600" />
          {hasTemplate ? "📋 Excel 模板" : "📤 上传 Excel 模板"}
          {hasTemplate && (
            <Badge variant="outline" className="ml-2">
              {headers.length} 列
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasTemplate ? (
          <label className="flex flex-col items-center gap-3 py-8 border-2 border-dashed rounded-xl cursor-pointer hover:border-primary/50 transition-colors">
            <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              {uploading ? (
                <Loader2 className="w-6 h-6 animate-spin text-green-600" />
              ) : (
                <Upload className="w-6 h-6 text-green-600" />
              )}
            </div>
            <div className="text-center">
              <p className="font-medium">点击上传 Excel 模板</p>
              <p className="text-sm text-muted-foreground">
                第一行为表头，系统会自动分析并匹配字段
              </p>
            </div>
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleUpload}
              disabled={uploading}
            />
          </label>
        ) : (
          <div className="flex flex-wrap gap-2">
            {headers.map((h, i) => {
              const mapping = mappings.find((m) => m.columnIndex === i);
              return (
                <Badge
                  key={i}
                  variant={mapping?.sourceField ? "default" : "secondary"}
                  className="text-xs py-1.5"
                >
                  {h}
                  {mapping?.sourceField ? (
                    <Check className="w-3 h-3 ml-1 text-green-300" />
                  ) : mapping ? (
                    <X className="w-3 h-3 ml-1 text-red-300" />
                  ) : null}
                </Badge>
              );
            })}
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={async () => {
                setUploading(true);
                try {
                  await fetch(`/api/projects/${projectId}/template`, { method: "DELETE" });
                  setHasTemplate(false);
                  onTemplateReady([], []);
                } finally {
                  setUploading(false);
                }
              }}
            >
              重新上传
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
