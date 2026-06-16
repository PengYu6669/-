-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "file_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "original_name" VARCHAR(500) NOT NULL,
    "stored_path" VARCHAR(1000) NOT NULL,
    "file_type" VARCHAR(10) NOT NULL,
    "file_size" BIGINT,
    "category" VARCHAR(20),
    "parent_dir" VARCHAR(500),
    "page_count" INTEGER NOT NULL DEFAULT 1,
    "hash_sha256" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "invoice_no" VARCHAR(50),
    "invoice_code" VARCHAR(50),
    "amount_excl_tax" DECIMAL(15,2),
    "tax_amount" DECIMAL(15,2),
    "amount_incl_tax" DECIMAL(15,2),
    "invoice_date" DATE,
    "seller_name" VARCHAR(300),
    "buyer_name" VARCHAR(300),
    "order_no" VARCHAR(100),
    "raw_ocr_json" JSONB,
    "raw_llm_json" JSONB,
    "confidence" DECIMAL(3,2),
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "document_code" VARCHAR(100),
    "order_no" VARCHAR(100),
    "receipt_date" DATE,
    "recipient" VARCHAR(100),
    "raw_ocr_text" TEXT,
    "raw_llm_json" JSONB,
    "confidence" DECIMAL(3,2),
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_receipt_links" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "match_type" VARCHAR(20) NOT NULL DEFAULT 'auto',
    "match_key" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_receipt_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "file_id" UUID,
    "step" VARCHAR(50) NOT NULL,
    "action" VARCHAR(200),
    "input_data" JSONB,
    "output_data" JSONB,
    "status" VARCHAR(20),
    "error_message" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_receipt_links" ADD CONSTRAINT "invoice_receipt_links_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_receipt_links" ADD CONSTRAINT "invoice_receipt_links_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_receipt_links" ADD CONSTRAINT "invoice_receipt_links_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
