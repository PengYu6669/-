# 发票识别与审计溯源系统 — PRD

## 1. 项目概述

### 1.1 背景
安丘市市立医院项目涉及大量发票 PDF 和货物签收单（PDF/JPG），需要自动化提取关键字段、建立发票与签收单的关联，并提供审计级别的数据溯源能力。

### 1.2 核心目标
- 上传包含发票和签收单的文件夹（支持嵌套目录）
- 自动识别发票 → 提取 发票号码、不含税金额、订单号
- 通过订单号匹配对应签收单 → 提取单据编码
- Web 端表格预览，支持点击单元格查看原始文件和提取链路
- 全流程审计日志，每一步处理都可追溯

---

## 2. 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 框架 | Next.js 15 (App Router) | 全栈框架，前后端一体 |
| 语言 | TypeScript | 类型安全 |
| UI | shadcn/ui + Tailwind CSS | 组件化，暗色模式支持 |
| 数据库 | PostgreSQL (本地) | 审计日志、提取记录 |
| ORM | Prisma | 类型安全的数据访问 |
| OCR | 百度云 OCR API | 增值税发票专用 + 通用识别 |
| LLM | DeepSeek API | 非标准字段结构化提取 |
| 文件处理 | sharp + pdf2pic | 图片处理和 PDF 转图片 |
| 表格导出 | exceljs | 生成 .xlsx |
| 文件存储 | 本地文件系统 + 数据库索引 | `uploads/` 目录 |

---

## 3. 功能需求

### 3.1 上传模块
**FR-1.1** 支持拖拽上传整个文件夹（包含子文件夹、PDF、JPG、PNG）
**FR-1.2** 保留原始目录结构，自动识别文件夹层级关系
**FR-1.3** 上传前校验：拒绝非 PDF/图片文件，提示用户
**FR-1.4** 显示上传进度条（单个文件 + 总体进度）
**FR-1.5** 智能分类：文件名含"发票"归入发票组，签收单文件夹按编号分组

### 3.2 发票识别模块
**FR-2.1** PDF 发票自动转为图片（1页1张）
**FR-2.2** 调用百度增值税发票识别 API，获取结构化字段：
  - 发票号码 (invoice_no)
  - 发票代码 (invoice_code)
  - 不含税金额 (amount_excl_tax)
  - 税额 (tax_amount)
  - 含税金额 (amount_incl_tax)
  - 开票日期 (invoice_date)
  - 销售方名称 (seller_name)
  - 购买方名称 (buyer_name)
**FR-2.3** 若百度发票识别失败，降级为通用 OCR + DeepSeek 提取
**FR-2.4** 调用 DeepSeek 从备注栏提取订单号 (order_no)
**FR-2.5** 记录每一步的原始输入、API响应、最终结果

### 3.3 签收单识别模块
**FR-3.1** 签收单 PDF 转图片，JPG 直接使用
**FR-3.2** 调用百度通用 OCR 获取全文
**FR-3.3** 调用 DeepSeek 从 OCR 文本中提取：
  - 单据编码 (document_code)
  - 订单号 (order_no)
  - 签收日期 (receipt_date)
  - 签收人 (recipient)
**FR-3.4** 多页签收单自动合并为一个文档处理

### 3.4 匹配关联模块
**FR-4.1** 用发票中提取的订单号匹配签收单的订单号
**FR-4.2** 支持模糊匹配（处理 OCR 识别误差）
**FR-4.3** 标记未匹配的发票和签收单
**FR-4.4** 手动关联功能：用户可拖拽建立发票与签收单的关联

### 3.5 表格预览模块
**FR-5.1** 数据表格展示所有提取结果
**FR-5.2** 列：第三方询证函索引 | 公司名称 | 客商名称 | 发票号码 | 不含税金额 | 签收单编码 | 状态 | 操作
**FR-5.3** 支持排序、筛选、搜索
**FR-5.4** 支持行内编辑（修正 OCR/LLM 错误）
**FR-5.5** 分页加载（大数据量场景）
**FR-5.6** 导出 Excel（含所有字段）

### 3.6 审计溯源模块（核心）
**FR-6.1** 点击表格任意单元格 → 弹出溯源侧边面板
**FR-6.2** 面板包含四个区域：

```
┌──────────────────────────────────┐
│ 🔍 溯源：发票号码 "01363950"      │
├──────────────────────────────────┤
│ 📄 原始文件                      │
│ ┌────────────────────────────┐   │
│ │ [发票图片预览 / PDF 查看器] │   │
│ │ 高亮标注当前字段在图片中    │   │
│ │ 的位置（如百度API返回坐标） │   │
│ └────────────────────────────┘   │
│                                  │
│ 🤖 OCR 原始输出                  │
│ ┌────────────────────────────┐   │
│ │ {                           │   │
│ │   "InvoiceNum": "01363950",│   │
│ │   "Amount": "37772.66",    │   │
│ │   ...                      │   │
│ │ }                           │   │
│ └────────────────────────────┘   │
│                                  │
│ 🧠 LLM 提取过程                  │
│ ┌────────────────────────────┐   │
│ │ Prompt: "从以下文本提取..." │   │
│ │ Response: { "order_no":..} │   │
│ │ Tokens: 342 | 耗时: 1.2s   │   │
│ └────────────────────────────┘   │
│                                  │
│ 📋 处理时间线                    │
│ ┌────────────────────────────┐   │
│ │ 10:23:01  文件上传完成      │   │
│ │ 10:23:05  PDF→图片转换      │   │
│ │ 10:23:08  百度OCR识别完成   │   │
│ │ 10:23:12  DeepSeek提取完成  │   │
│ │ 10:23:12  字段入库          │   │
│ └────────────────────────────┘   │
└──────────────────────────────────┘
```

**FR-6.3** 溯源面板支持：
  - 原始图片放大/缩小/旋转
  - OCR 原始 JSON 格式化展示
  - LLM 请求/响应完整展示
  - 时间线点击跳转到对应处理步骤

**FR-6.4** 审计日志表记录所有操作（谁、什么时候、做了什么、结果、是否成功）

### 3.7 项目管理模块
**FR-7.1** 新建/打开/删除处理项目
**FR-7.2** 每个项目独立存储（独立的文件目录 + 数据库记录）
**FR-7.3** 项目列表页：名称、文件数、提取进度、创建时间

---

## 4. 数据库设计 (PostgreSQL)

```sql
-- 项目/批次
CREATE TABLE projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  status        VARCHAR(20) DEFAULT 'pending', -- pending|processing|completed|failed
  file_count    INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 原始文件
CREATE TABLE files (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  original_name VARCHAR(500) NOT NULL,
  stored_path   VARCHAR(1000) NOT NULL,   -- 相对 uploads/ 的路径
  file_type     VARCHAR(10) NOT NULL,      -- pdf|jpg|png
  file_size     BIGINT,
  category      VARCHAR(20),               -- invoice|receipt|unknown
  parent_dir    VARCHAR(500),              -- 保留原始目录结构
  page_count    INT DEFAULT 1,             -- PDF页数
  hash_sha256   VARCHAR(64),               -- 文件去重
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 发票提取结果
CREATE TABLE invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID REFERENCES projects(id) ON DELETE CASCADE,
  file_id         UUID REFERENCES files(id),
  invoice_no      VARCHAR(50),
  invoice_code    VARCHAR(50),
  amount_excl_tax DECIMAL(15,2),
  tax_amount      DECIMAL(15,2),
  amount_incl_tax DECIMAL(15,2),
  invoice_date    DATE,
  seller_name     VARCHAR(300),
  buyer_name      VARCHAR(300),
  order_no        VARCHAR(100),            -- 从备注栏提取的订单号
  raw_ocr_json    JSONB,                   -- 百度API原始响应
  raw_llm_json    JSONB,                   -- DeepSeek提取结果
  confidence      DECIMAL(3,2),            -- 置信度 0-1
  status          VARCHAR(20) DEFAULT 'pending',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 签收单提取结果
CREATE TABLE receipts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID REFERENCES projects(id) ON DELETE CASCADE,
  file_id         UUID REFERENCES files(id),
  document_code   VARCHAR(100),            -- 单据编码
  order_no        VARCHAR(100),            -- 订单号（用于匹配）
  receipt_date    DATE,
  recipient       VARCHAR(100),
  raw_ocr_text    TEXT,                    -- 通用OCR原始文本
  raw_llm_json    JSONB,                   -- DeepSeek提取结果
  confidence      DECIMAL(3,2),
  status          VARCHAR(20) DEFAULT 'pending',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 发票-签收单关联
CREATE TABLE invoice_receipt_links (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  invoice_id    UUID REFERENCES invoices(id),
  receipt_id    UUID REFERENCES receipts(id),
  match_type    VARCHAR(20) DEFAULT 'auto',  -- auto|manual
  match_key     VARCHAR(200),                -- 匹配所用的订单号
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 审计日志
CREATE TABLE audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  file_id       UUID REFERENCES files(id),
  step          VARCHAR(50) NOT NULL,        -- upload|pdf_convert|ocr|llm_extract|match|export|manual_edit
  action        VARCHAR(200),
  input_data    JSONB,
  output_data   JSONB,
  status        VARCHAR(20),                 -- success|failed|warning
  error_message TEXT,
  duration_ms   INT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 5. API 设计

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/projects` | 创建项目 |
| GET | `/api/projects` | 项目列表 |
| GET | `/api/projects/[id]` | 项目详情 |
| POST | `/api/projects/[id]/upload` | 上传文件夹（FormData + 目录结构） |
| POST | `/api/projects/[id]/process` | 触发批量处理 |
| GET | `/api/projects/[id]/invoices` | 发票列表（分页+筛选） |
| GET | `/api/projects/[id]/receipts` | 签收单列表 |
| GET | `/api/projects/[id]/links` | 关联关系列表 |
| GET | `/api/invoices/[id]/trace` | 单个发票溯源信息 |
| GET | `/api/receipts/[id]/trace` | 单个签收单溯源信息 |
| PUT | `/api/invoices/[id]` | 手动修正发票字段 |
| GET | `/api/projects/[id]/export` | 导出 Excel |
| GET | `/api/audit-logs?project_id=` | 审计日志查询 |

---

## 6. 处理流水线

```
用户上传文件夹
       │
       ▼
  ┌──────────────┐
  │ 1. 文件扫描   │ 遍历目录树，识别文件类型
  │    入库files表 │ 计算SHA256，去重
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐
  │ 2. 智能分类   │ 文件名规则 + 目录名规则
  │               │ "发票" → invoice
  │               │ 数字文件夹名 → receipt
  └──────┬───────┘
         │
    ┌────┴────┐
    ▼         ▼
  ┌─────┐  ┌─────┐
  │发票  │  │签收单│
  │处理  │  │处理  │  并行处理
  └──┬──┘  └──┬──┘
     │        │
     ▼        ▼
  百度增值税  百度通用OCR
  发票识别    + DeepSeek
     │        │
     ▼        ▼
  DeepSeek   提取单据编码
  提取订单号  + 订单号
     │        │
     └───┬────┘
         ▼
  ┌──────────────┐
  │ 3. 订单号匹配 │ 发票.order_no ↔ 签收单.order_no
  │    建立关联    │ 模糊匹配 + 人工兜底
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐
  │ 4. 生成表格   │ 合并发票+签收单字段
  │    入库       │ 所有中间结果入库
  └──────────────┘
```

---

## 7. 前端页面结构

```
/                       项目列表页（卡片网格）
/project/[id]           处理详情页
  ├─ 上传区域（拖拽文件夹）
  ├─ 文件树（保留目录结构）
  ├─ 数据表格（发票+签收单合并视图）
  └─ 溯源面板（右侧滑出 Sheet）
/settings               配置页（API Key、数据库连接）
```

---

## 8. 非功能需求

- **NFR-1** 单文件处理时间 < 10 秒（OCR + LLM）
- **NFR-2** 支持断点续传（已处理文件标记状态，重试时跳过）
- **NFR-3** 所有 API 调用有重试机制（3次，指数退避）
- **NFR-4** 敏感数据（API Key）存储在 `.env`，不提交到代码仓库
- **NFR-5** 暗色模式支持（shadcn/ui 内置）

---

## 9. 里程碑

| 阶段 | 内容 | 预计 |
|------|------|------|
| M1 | Next.js 初始化 + Prisma + PG 建表 + shadcn/ui | 即刻 |
| M2 | 文件上传模块（文件夹拖拽） | — |
| M3 | 百度OCR + DeepSeek 集成 | — |
| M4 | 数据表格 + 溯源面板 | — |
| M5 | Excel 导出 + 手动修正 | — |
| M6 | 审计日志完善 + 测试 | — |

---

> 📌 **当前状态**：M0 — 项目初始化阶段
