# 当前问题清单 & 涉及文件

## 问题 1：溯源面板图片加载失败

**现象**：面板「原始文件」标签页显示"图片加载失败"

**原因**：`/api/files/[id]` 从数据库查 `fileId`，但当前 trace API 返回的 record 里 `fileId` 可能不存在或格式不匹配。

**涉及文件**：
- `src/app/api/files/[id]/route.ts` — 文件服务 API
- `src/components/trace/trace-panel.tsx` — 获取 fileId 并构造 `<img src>` 
- `src/app/api/cells/trace/route.ts` — 单元格溯源返回数据中需包含 fileId
- `src/app/api/invoices/[id]/trace/route.ts` — 发票溯源需返回 fileId
- `src/app/api/receipts/[id]/trace/route.ts` — 签收单溯源需返回 fileId

---

## 问题 2：面板右上角两个 ✕ 按钮

**现象**：shadcn Sheet 自带一个 ✕，我们又手动加了一个 ✕

**原因**：`SheetContent` 自带 `showCloseButton` 默认 true

**涉及文件**：
- `src/components/trace/trace-panel.tsx` — 需去掉手动加的 ✕，用 shadcn 自带的

---

## 问题 3：点击单元格后行/列高亮，无法选取其他数据单元格

**现象**：Handsontable 点击单元格 → 整行整列高亮选中 → 无法点击相邻单元格切换溯源

**原因**：Handsontable 默认 `selectionMode: 'multiple'` 导致点击即选中扩展区域，加上 `readOnly: true` 时 selection 行为未优化。需要改为 `selectionMode: 'single'` 或完全禁用 selection，只保留 click 事件用于溯源切换。

**涉及文件**：
- `src/components/table/excel-preview.tsx` — Handsontable 配置

---

## 问题 4：Excel 导出疑似仍不可用

**现象**：点击导出按钮无反应或下载的文件打不开

**原因**：需验证 `Buffer.from(buffer)` 在 Next.js 环境是否正常，以及 `ExcelJS` 与 Turbopack 的兼容性

**涉及文件**：
- `src/app/api/projects/[id]/export/route.ts`

---

## 问题 5：OCR 处理完成后项目状态不更新

**现象**：处理中状态一直是 `processing`，不会变成 `completed`

**原因**：`processProject()` 是 fire-and-forget 异步调用，处理完成后 `prisma.project.update({ status: "completed" })` 可能因为前面的异常而被跳过

**涉及文件**：
- `src/lib/pipeline.ts` — `processProject()` 函数末尾的状态更新

---

## 问题 6：预览数据需先有模板映射才能显示

**现象**：没有上传 Excel 模板时，预览标签页显示空

**原因**：`preview-data` API 依赖 `templates` 表 + `field_mappings` 表，如果没做映射就返回 error

**涉及文件**：
- `src/app/api/projects/[id]/preview-data/route.ts`
- `src/components/table/excel-preview.tsx` — hasMappings 判断

---

## 完整文件清单

### API 路由 (12个)
```
src/app/api/
├── projects/
│   ├── route.ts                    # 项目 CRUD
│   └── [id]/
│       ├── route.ts                # 项目详情/重命名/删除
│       ├── upload/route.ts         # 文件上传
│       ├── process/route.ts        # 触发OCR处理
│       ├── invoices/route.ts       # 发票列表
│       ├── export/route.ts         # Excel导出 ⚠️
│       ├── preview-data/route.ts   # 预览数据生成
│       └── template/
│           ├── route.ts            # 模板上传/解析
│           └── mapping/route.ts    # AI字段映射
├── invoices/[id]/
│   ├── route.ts                    # 手动修正
│   └── trace/route.ts              # 发票溯源
├── receipts/[id]/trace/route.ts    # 签收单溯源
├── cells/trace/route.ts            # 单元格溯源
├── files/[id]/route.ts             # 原始文件服务 ⚠️
└── audit-logs/route.ts             # 审计日志
```

### 核心库 (5个)
```
src/lib/
├── db.ts          # Prisma + PG adapter
├── ocr.ts         # 百度OCR（增值税+通用+位置）
├── llm.ts         # DeepSeek 字段提取
├── pdf.ts         # 文件→base64
└── pipeline.ts    # 处理流水线 ⚠️
```

### 前端组件 (5个)
```
src/components/
├── upload/
│   ├── folder-upload.tsx     # 文件夹拖拽上传
│   ├── template-upload.tsx   # Excel模板上传
│   └── field-mapping.tsx     # 字段映射UI
├── table/
│   ├── invoice-table.tsx     # 数据表格
│   └── excel-preview.tsx     # Handsontable预览 ⚠️
└── trace/
    └── trace-panel.tsx       # 溯源面板 ⚠️
```

### 页面 (2个)
```
src/app/
├── page.tsx                   # 首页（项目列表）
└── project/[id]/page.tsx      # 项目详情（4标签页）
```

### 数据库
```
prisma/schema.prisma           # 8张表
```

---

## 建议重做方案

### 1. 去掉 Handsontable，改用简单方案
Handsontable 太重（~2MB），selection 行为难控制，CDN 加载不稳定。
**替代**：用 shadcn Table 实现只读数据表格，每个单元格可点击触发溯源。或者保留 Handsontable 但彻底简化配置。

### 2. 溯源面板用独立 Drawer/Sheet
- 单 ✕ 按钮（用 shadcn 自带）
- `modal={false}` 不遮挡交互
- 点击单元格 → 直接更新面板状态
- 默认显示原始图片
- 图片加载失败时显示友好提示

### 3. 预览数据不依赖模板映射
默认生成发票+签收单的所有字段，用户上传模板后才按模板格式展示。

### 4. 去掉 pdf2pic/mupdf 等冗余依赖
PDF 直接传百度 OCR，本地无需转图片。

### 5. 简化 pipeline 错误处理
- 每个文件独立 try-catch
- 处理完更新计数器
- 最后统一更新项目状态
