"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TracePanel } from "@/components/trace/trace-panel";
import { Loader2, Download, Eye, Table2, ArrowUpDown } from "lucide-react";
import { toast } from "sonner";

interface CellData {
  value: unknown;
  traceSource: {
    type: "invoice" | "receipt" | "static";
    id: string;
    field: string;
    fileName: string;
  } | null;
  confidence?: number | null;
}

interface PreviewData {
  headers: string[];
  mappings: { id: string; index: number; header: string; sourceType: string | null; sourceField: string | null }[];
  rows: { cells: CellData[] }[];
  rowCount: number;
}

interface Props {
  projectId: string;
  hasMappings?: boolean;
}

export function ExcelPreview({ projectId }: Props) {
  const [data, setData] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);

  // Trace panel
  const [traceOpen, setTraceOpen] = useState(false);
  const [traceType, setTraceType] = useState<"invoice" | "receipt">("invoice");
  const [traceId, setTraceId] = useState<string | null>(null);
  const [traceField, setTraceField] = useState("");
  const [selectedCellInfo, setSelectedCellInfo] = useState<{
    header: string;
    value: unknown;
    sourceType: string;
    sourceFile: string;
  } | null>(null);

  // Selection highlight state
  const [selRow, setSelRow] = useState<number | null>(null);
  const [selCol, setSelCol] = useState<number | null>(null);

  // Column sorting
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/preview-data`);
      const d = await res.json();
      if (d.error) {
        toast.warning(d.error);
      } else {
        setData(d);
      }
    } catch {
      toast.error("加载预览数据失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const exportExcel = () => {
    window.open(`/api/projects/${projectId}/export`, "_blank");
  };

  // Sort rows
  const sortedRows = (() => {
    if (!data || sortCol === null) return data?.rows || [];
    const rows = [...data.rows];
    rows.sort((a, b) => {
      const va = a.cells[sortCol]?.value;
      const vb = b.cells[sortCol]?.value;
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return sortAsc ? va - vb : vb - va;
      }
      const sa = String(va);
      const sb = String(vb);
      return sortAsc ? sa.localeCompare(sb, "zh-CN") : sb.localeCompare(sa, "zh-CN");
    });
    return rows;
  })();

  const handleSort = (colIdx: number) => {
    if (sortCol === colIdx) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(colIdx);
      setSortAsc(true);
    }
  };

  const handleCellClick = (rowIdx: number, colIdx: number) => {
    if (!data) return;
    const cell = data.rows[rowIdx]?.cells[colIdx];
    if (!cell?.traceSource || cell.traceSource.type === "static") return;

    setSelRow(rowIdx);
    setSelCol(colIdx);

    setSelectedCellInfo({
      header: data.headers[colIdx],
      value: cell.value,
      sourceType: cell.traceSource.type,
      sourceFile: cell.traceSource.fileName,
    });
    setTraceType(cell.traceSource.type as "invoice" | "receipt");
    setTraceId(cell.traceSource.id);
    setTraceField(cell.traceSource.field);
    setTraceOpen(true);
  };

  // Inline format value
  const fmtVal = (v: unknown) => {
    if (v == null) return "";
    if (v instanceof Date) return v.toLocaleDateString("zh-CN");
    return String(v);
  };

  // Trace cell class
  const getTraceClass = (cell: CellData) => {
    if (!cell.traceSource || cell.traceSource.type === "static") return "";
    return cell.traceSource.type === "invoice"
      ? "bg-blue-50 dark:bg-blue-950/30 border-b-2 border-b-blue-300 dark:border-b-blue-700"
      : "bg-green-50 dark:bg-green-950/30 border-b-2 border-b-green-300 dark:border-b-green-700";
  };

  // Selection classes
  const getCellClass = (r: number, c: number, cell: CellData) => {
    const classes: string[] = [];
    if (r === selRow && c === selCol) classes.push("outline outline-2 outline-[#1677ff] outline-offset-[-2px] bg-[rgba(22,119,255,0.1)]");
    else if (r === selRow || c === selCol) classes.push("bg-[rgba(22,119,255,0.05)]");
    // Trace indicator
    if (cell.traceSource && cell.traceSource.type !== "static") {
      classes.push("cursor-pointer font-medium");
    }
    // Column header highlight
    if (c === selCol) classes.push("");
    return classes.join(" ");
  };

  return (
    <div className="flex gap-3 items-start">
      <div className="flex-1 min-w-0">
        <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Table2 className="w-5 h-5 text-blue-600" />
              📊 Excel 预览
              {data && (
                <Badge variant="outline">
                  {data.rowCount} 行 × {data.headers.length} 列
                </Badge>
              )}
            </CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
                <Loader2 className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                刷新
              </Button>
              <Button variant="outline" size="sm" onClick={exportExcel}>
                <Download className="w-4 h-4 mr-2" />
                导出 Excel
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-12">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : !data || data.rows.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Eye className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>请先完成文件上传和 OCR 识别</p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Legend */}
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded inline-block bg-blue-50 dark:bg-blue-950/30 border-b-2 border-blue-300" />
                  发票来源
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded inline-block bg-green-50 dark:bg-green-950/30 border-b-2 border-green-300" />
                  签收单来源
                </span>
                <span>💡 点击带色单元格 → 溯源面板</span>
              </div>

              {/* Table */}
              <div className="border rounded-lg overflow-auto max-h-[600px]">
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-muted">
                    <tr>
                      <th className="px-2 py-2 text-center text-xs text-muted-foreground border-r border-b w-10">
                        #
                      </th>
                      {data.headers.map((h, ci) => (
                        <th
                          key={ci}
                          className={`px-3 py-2 text-left text-xs font-medium border-r border-b cursor-pointer hover:bg-accent select-none whitespace-nowrap ${
                            ci === selCol
                              ? "bg-[rgba(22,119,255,0.1)] border-b-2 border-b-[#1677ff]"
                              : ""
                          }`}
                          onClick={() => handleSort(ci)}
                        >
                          <span className="flex items-center gap-1">
                            {h}
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((row, ri) => (
                      <tr
                        key={ri}
                        className={
                          ri === selRow
                            ? "bg-[rgba(22,119,255,0.04)]"
                            : ri % 2 === 0
                            ? "bg-card"
                            : "bg-muted/30"
                        }
                      >
                        <td
                          className={`px-2 py-1.5 text-center text-xs text-muted-foreground border-r select-none ${
                            ri === selRow ? "bg-[rgba(22,119,255,0.08)]" : ""
                          }`}
                        >
                          {ri + 1}
                        </td>
                        {row.cells.map((cell, ci) => {
                          const lowConfidence =
                            cell.confidence != null && cell.confidence < 0.6 &&
                            cell.traceSource && cell.traceSource.type !== "static";
                          return (
                            <td
                              key={ci}
                              className={`px-3 py-1.5 border-r text-xs whitespace-nowrap ${getCellClass(ri, ci, cell)} ${getTraceClass(cell)} ${
                                lowConfidence
                                  ? "bg-amber-100 dark:bg-amber-950/40 border border-amber-400"
                                  : ""
                              }`}
                              onClick={() => handleCellClick(ri, ci)}
                              title={
                                (cell.traceSource && cell.traceSource.type !== "static"
                                  ? `📌 来源: ${cell.traceSource.fileName}\n字段: ${cell.traceSource.field}\n🔍 点击查看溯源`
                                  : "") +
                                (lowConfidence
                                  ? `\n\n⚠️ 识别可信度低 (${Math.round(cell.confidence! * 100)}%)，请人工核对`
                                  : "")
                              }
                            >
                              <span className="flex items-center gap-1">
                                {lowConfidence && <span className="text-amber-600 text-xs">⚠️</span>}
                                {fmtVal(cell.value)}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      </div>

      {/* 内联溯源面板 — 推开表格共享宽度，无遮罩无模糊 */}
      {traceOpen && (
        <div className="w-[420px] shrink-0 rounded-lg border bg-card overflow-hidden" style={{ maxHeight: "calc(100vh - 200px)" }}>
          <TracePanel
            type={traceType}
            recordId={traceId}
            open={traceOpen}
            onClose={() => {
              setTraceOpen(false);
              setSelectedCellInfo(null);
            }}
            highlightField={traceField}
            cellInfo={selectedCellInfo}
          />
        </div>
      )}
    </div>
  );
}
