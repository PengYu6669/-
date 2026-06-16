"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Brain, Loader2, Check, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface FieldMapping {
  id: string;
  columnIndex: number;
  headerName: string;
  sourceType: string | null;
  sourceField: string | null;
  suggestedBy: string;
  staticValue: string | null;
}

interface Props {
  projectId: string;
  headers: string[];
  mappings: FieldMapping[];
  onMappingsUpdated: (mappings: FieldMapping[]) => void;
}

const AVAILABLE_FIELDS = [
  { group: "📄 发票", key: "invoice.invoiceNo", label: "发票号码" },
  { group: "📄 发票", key: "invoice.invoiceCode", label: "发票代码" },
  { group: "📄 发票", key: "invoice.amountExclTax", label: "不含税金额" },
  { group: "📄 发票", key: "invoice.taxAmount", label: "税额" },
  { group: "📄 发票", key: "invoice.amountInclTax", label: "含税金额" },
  { group: "📄 发票", key: "invoice.invoiceDate", label: "开票日期" },
  { group: "📄 发票", key: "invoice.sellerName", label: "销售方名称" },
  { group: "📄 发票", key: "invoice.buyerName", label: "购买方名称" },
  { group: "📄 发票", key: "invoice.orderNo", label: "订单号" },
  { group: "📋 签收单", key: "receipt.documentCode", label: "签收单编码" },
  { group: "📋 签收单", key: "receipt.orderNo", label: "签收单订单号" },
  { group: "📋 签收单", key: "receipt.receiptDate", label: "签收日期" },
  { group: "📋 签收单", key: "receipt.recipient", label: "签收人" },
];

export function FieldMapping({ projectId, headers, mappings, onMappingsUpdated }: Props) {
  const [loading, setLoading] = useState(false);
  const [localMappings, setLocalMappings] = useState<FieldMapping[]>(mappings);

  const hasMappings = localMappings.length > 0;

  const runAIMapping = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/template/mapping`, {
        method: "POST",
      });
      const data = await res.json();
      setLocalMappings(data.mappings);
      onMappingsUpdated(data.mappings);
      toast.success("AI 字段映射完成");
    } catch {
      toast.error("AI映射失败");
    } finally {
      setLoading(false);
    }
  };

  const updateMapping = async (index: number, updates: Partial<FieldMapping>) => {
    // 如果还没有映射记录，先在本地创建
    const current = localMappings[index] || {
      id: "",
      columnIndex: index,
      headerName: headers[index],
      sourceType: null,
      sourceField: null,
      suggestedBy: "user",
      staticValue: null,
    };

    const merged = { ...current, ...updates, suggestedBy: "user" as const };
    const updated = localMappings.map((m, i) =>
      i === index ? merged : m
    );
    setLocalMappings(updated);

    // 保存到服务器
    try {
      const res = await fetch(`/api/projects/${projectId}/template/mapping`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mappings: [{
            id: merged.id || undefined,
            columnIndex: merged.columnIndex,
            headerName: merged.headerName,
            sourceType: merged.sourceType,
            sourceField: merged.sourceField,
            staticValue: merged.staticValue,
          }],
        }),
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
        return;
      }
      // 用服务器返回的 id 更新本地状态
      if (data.mappings?.length) {
        const serverMapping = data.mappings[0];
        const synced = localMappings.map((m, i) =>
          i === index ? { ...merged, id: serverMapping.id } : m
        );
        setLocalMappings(synced);
        onMappingsUpdated(synced);
      } else {
        onMappingsUpdated(updated);
      }
    } catch {
      toast.error("保存失败");
    }
  };

  if (headers.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            🔗 字段映射
            {hasMappings && (
              <Badge variant="outline">
                {localMappings.filter((m) => m.sourceField).length}/{localMappings.length} 已映射
              </Badge>
            )}
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={runAIMapping}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Brain className="w-4 h-4 mr-2" />
            )}
            AI 自动映射
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {headers.map((header, i) => {
            const mapping = localMappings[i];
            const sourceType = mapping?.sourceType || "";
            const sourceField = mapping?.sourceField || "";
            const isMapped = !!sourceField;

            return (
              <div
                key={i}
                className={`flex items-center gap-3 p-2 rounded-lg border ${
                  isMapped
                    ? "border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20"
                    : "border-muted"
                }`}
              >
                <div className="w-8 h-8 rounded bg-muted flex items-center justify-center text-xs font-mono shrink-0">
                  {i + 1}
                </div>
                <span className="font-medium text-sm min-w-[100px]">{header}</span>
                <span className="text-muted-foreground">→</span>

                <Select
                  value={
                    sourceType === "static"
                      ? "static"
                      : sourceType && sourceField
                        ? `${sourceType}|${sourceField}`
                        : "none"
                  }
                  onValueChange={(val) => {
                    if (val === "none" || !val) {
                      updateMapping(i, { sourceType: null, sourceField: null });
                    } else if (val === "static") {
                      updateMapping(i, { sourceType: "static", sourceField: null });
                    } else {
                      const [type, field] = val.split("|");
                      updateMapping(i, { sourceType: type, sourceField: field });
                    }
                  }}
                >
                  <SelectTrigger className="h-8 text-sm min-w-[200px]">
                    <SelectValue placeholder="选择字段..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— 不映射 —</SelectItem>
                    <SelectItem value="static">✏️ 固定值</SelectItem>
                    {AVAILABLE_FIELDS.map((f) => (
                      <SelectItem key={f.key} value={`${f.key.split(".")[0]}|${f.key}`}>
                        {f.group} {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {sourceType === "static" && (
                  <Input
                    className="h-8 text-sm w-32"
                    placeholder="固定值"
                    value={mapping?.staticValue || ""}
                    onChange={(e) => updateMapping(i, { staticValue: e.target.value })}
                  />
                )}

                <div className="ml-auto shrink-0">
                  {isMapped ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-amber-500" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
