"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Plus, FolderOpen, FileText, Receipt, ArrowRight, Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface Project {
  id: string;
  name: string;
  status: string;
  fileCount: number;
  createdAt: string;
  _count: { files: number; invoices: number; receipts: number };
}

export default function HomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // 新建弹窗
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");

  // 重命名弹窗
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");

  // 删除确认
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; projectId: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchProjects = async () => {
    try {
      const res = await fetch("/api/projects");
      setProjects(await res.json());
    } catch {
      toast.error("加载项目列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchProjects(); }, []);

  // 新建
  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const project = await res.json();
      toast.success("项目创建成功");
      setNewDialogOpen(false);
      setNewName("");
      router.push(`/project/${project.id}`);
    } catch {
      toast.error("创建项目失败");
    } finally {
      setCreating(false);
    }
  };

  // 重命名
  const handleRename = async () => {
    if (!renameId || !renameName.trim()) return;
    try {
      await fetch(`/api/projects/${renameId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameName.trim() }),
      });
      toast.success("已重命名");
      setRenameId(null);
      fetchProjects();
    } catch {
      toast.error("重命名失败");
    }
  };

  // 删除
  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await fetch(`/api/projects/${deleteId}`, { method: "DELETE" });
      toast.success("项目已删除");
      setDeleteId(null);
      fetchProjects();
    } catch {
      toast.error("删除失败");
    } finally {
      setDeleting(false);
    }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      pending: { label: "待处理", variant: "secondary" },
      processing: { label: "处理中", variant: "default" },
      completed: { label: "已完成", variant: "outline" },
      failed: { label: "失败", variant: "destructive" },
    };
    const s = map[status] || { label: status, variant: "secondary" as const };
    return <Badge variant={s.variant}>{s.label}</Badge>;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-950 dark:to-slate-900">
      <header className="border-b bg-white/80 backdrop-blur-sm dark:bg-slate-950/80 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              📄 发票识别与审计溯源系统
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              OCR + LLM 驱动 · 智能提取 · 全程可追溯
            </p>
          </div>
          <Button onClick={() => { setNewName(""); setNewDialogOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" />
            新建项目
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FolderOpen className="w-16 h-16 text-muted-foreground/40 mb-4" />
            <h2 className="text-xl font-semibold mb-2">还没有项目</h2>
            <p className="text-muted-foreground mb-6 max-w-md">
              创建一个项目，上传包含发票和签收单的文件夹，系统将自动识别、提取字段并建立关联。
            </p>
            <Button size="lg" onClick={() => { setNewName(""); setNewDialogOpen(true); }}>
              <Plus className="w-5 h-5 mr-2" />创建第一个项目
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p) => (
              <Card
                key={p.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => router.push(`/project/${p.id}`)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, projectId: p.id, name: p.name });
                }}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start">
                    <CardTitle className="text-lg truncate w-[70%]" title={p.name}>{p.name}</CardTitle>
                    <div className="flex items-center gap-1 ml-auto">
                      {statusBadge(p.status)}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1"><FileText className="w-4 h-4" />{p._count.invoices} 发票</span>
                    <span className="flex items-center gap-1"><Receipt className="w-4 h-4" />{p._count.receipts} 签收单</span>
                    <ArrowRight className="w-4 h-4 ml-auto" />
                  </div>
                  <p className="text-xs text-muted-foreground/60 mt-2">
                    创建于 {new Date(p.createdAt).toLocaleString("zh-CN")}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* 新建项目弹窗 */}
      <Dialog open={newDialogOpen} onOpenChange={setNewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
            <DialogDescription>输入项目名称，例如「安丘市市立医院 2024」</DialogDescription>
          </DialogHeader>
          <Input
            placeholder="请输入项目名称"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewDialogOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              确认创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重命名弹窗 */}
      <Dialog open={!!renameId} onOpenChange={(v) => { if (!v) setRenameId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名项目</DialogTitle>
          </DialogHeader>
          <Input
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleRename(); }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameId(null)}>取消</Button>
            <Button onClick={handleRename} disabled={!renameName.trim()}>确认</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 右键菜单 */}
      {contextMenu && (
        <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}>
          <div
            className="absolute bg-popover border rounded-lg shadow-lg py-1 min-w-[140px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left"
              onClick={() => { setRenameId(contextMenu.projectId); setRenameName(contextMenu.name); setContextMenu(null); }}
            >
              <Pencil className="w-4 h-4" />重命名
            </button>
            <button
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left text-destructive"
              onClick={() => { setDeleteId(contextMenu.projectId); setContextMenu(null); }}
            >
              <Trash2 className="w-4 h-4" />删除
            </button>
          </div>
        </div>
      )}

      {/* 删除确认弹窗 */}
      <Dialog open={!!deleteId} onOpenChange={(v) => { if (!v) setDeleteId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              删除后项目及所有关联数据将永久移除，不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>取消</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
