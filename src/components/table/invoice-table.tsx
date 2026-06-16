"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TracePanel } from "@/components/trace/trace-panel";
import {
  Search,
  Download,
  Play,
  Loader2,
  Eye,
  Edit3,
  X,
  Check,
  Link2,
  Link2Off,
} from "lucide-react";
import { toast } from "sonner";

interface LinkedReceipt {
  id: string;
  documentCode: string | null;
  orderNo: string | null;
  receiptDate: string | null;
  recipient: string | null;
  file: { originalName: string; storedPath: string };
}

interface Invoice {
  id: string;
  invoiceNo: string | null;
  invoiceCode: string | null;
  amountExclTax: number | null;
  taxAmount: number | null;
  amountInclTax: number | null;
  invoiceDate: string | null;
  sellerName: string | null;
  buyerName: string | null;
  orderNo: string | null;
  confidence: number | null;
  status: string;
  file: { originalName: string; storedPath: string };
  links: {
    receipt: LinkedReceipt;
  }[];
}

interface Props {
  projectId: string;
}

export function InvoiceTable({ projectId }: Props) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  // 溯源面板
  const [traceOpen, setTraceOpen] = useState(false);
  const [traceType, setTraceType] = useState<"invoice" | "receipt">("invoice");
  const [traceId, setTraceId] = useState<string | null>(null);

  // 行内编辑
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/invoices?page=${page}&pageSize=20&search=${search}`
      );
      const data = await res.json();
      setInvoices(data.invoices);
      setTotal(data.total);
    } catch {
      toast.error("加载数据失败");
    } finally {
      setLoading(false);
    }
  }, [projectId, page, search]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const triggerProcess = async () => {
    setProcessing(true);
    try {
      await fetch(`/api/projects/${projectId}/process`, { method: "POST" });
      toast.success("处理已启动，请稍后刷新查看结果");
      setTimeout(fetchInvoices, 5000);
    } catch {
      toast.error("启动处理失败");
    } finally {
      setProcessing(false);
    }
  };

  const exportExcel = () => {
    window.open(`/api/projects/${projectId}/export`, "_blank");
  };

  const startEdit = (inv: Invoice) => {
    setEditingId(inv.id);
    setEditValue(inv.orderNo || "");
  };

  const saveEdit = async (id: string) => {
    try {
      await fetch(`/api/invoices/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNo: editValue }),
      });
      toast.success("已保存");
      setEditingId(null);
      fetchInvoices();
    } catch {
      toast.error("保存失败");
    }
  };

  const openTrace = (type: "invoice" | "receipt", id: string) => {
    setTraceType(type);
    setTraceId(id);
    setTraceOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索发票号、订单号..."
            className="pl-9"
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>

        <Button variant="outline" onClick={triggerProcess} disabled={processing}>
          {processing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
          开始识别
        </Button>

        <Button variant="outline" onClick={exportExcel}>
          <Download className="w-4 h-4 mr-2" />
          导出 Excel
        </Button>
      </div>

      {/* 表格 */}
      <div className="border rounded-lg overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-[110px]">发票号码</TableHead>
                <TableHead className="w-[100px] text-right">不含税金额</TableHead>
                <TableHead className="w-[100px] text-right">税额</TableHead>
                <TableHead className="w-[120px]">订单号</TableHead>
                <TableHead className="w-[100px]">签收单编码</TableHead>
                <TableHead className="w-[80px]">签收人</TableHead>
                <TableHead className="w-[80px]">状态</TableHead>
                <TableHead className="w-[140px]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : invoices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                    暂无数据，请先上传文件
                  </TableCell>
                </TableRow>
              ) : (
                invoices.map((inv) => {
                  const receipt = inv.links[0]?.receipt;
                  return (
                    <TableRow key={inv.id} className="group">
                      <TableCell className="font-mono text-sm">
                        {inv.invoiceNo || "-"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {inv.amountExclTax != null
                          ? Number(inv.amountExclTax).toLocaleString("zh-CN", {
                              minimumFractionDigits: 2,
                            })
                          : "-"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {inv.taxAmount != null
                          ? Number(inv.taxAmount).toLocaleString("zh-CN", {
                              minimumFractionDigits: 2,
                            })
                          : "-"}
                      </TableCell>
                      <TableCell>
                        {editingId === inv.id ? (
                          <div className="flex items-center gap-1">
                            <Input
                              className="h-7 w-28 text-sm"
                              value={editValue}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditValue(e.target.value)}
                              autoFocus
                            />
                            <button onClick={() => saveEdit(inv.id)}>
                              <Check className="w-4 h-4 text-green-500" />
                            </button>
                            <button onClick={() => setEditingId(null)}>
                              <X className="w-4 h-4 text-muted-foreground" />
                            </button>
                          </div>
                        ) : (
                          <span className="font-mono text-sm">
                            {inv.orderNo || "-"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {receipt ? (
                          <span className="flex items-center gap-1 text-green-600">
                            <Link2 className="w-3 h-3" />
                            {receipt.documentCode || receipt.orderNo || "已关联"}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Link2Off className="w-3 h-3" />
                            未匹配
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{receipt?.recipient || "-"}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            inv.status === "completed"
                              ? "outline"
                              : inv.status === "failed"
                              ? "destructive"
                              : "secondary"
                          }
                          className="text-xs"
                        >
                          {inv.status === "completed"
                            ? "已完成"
                            : inv.status === "failed"
                            ? "失败"
                            : inv.status === "pending"
                            ? "待处理"
                            : inv.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => openTrace("invoice", inv.id)}
                          >
                            <Eye className="w-3.5 h-3.5 mr-1" />
                            溯源
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => startEdit(inv)}
                          >
                            <Edit3 className="w-3.5 h-3.5 mr-1" />
                            编辑
                          </Button>
                          {receipt && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => openTrace("receipt", receipt.id)}
                            >
                              📋
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* 分页 */}
        {total > 20 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <span className="text-sm text-muted-foreground">
              共 {total} 条
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page * 20 >= total}
                onClick={() => setPage(page + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 溯源面板 */}
      <TracePanel
        type={traceType}
        recordId={traceId}
        open={traceOpen}
        onClose={() => setTraceOpen(false)}
      />
    </div>
  );
}
