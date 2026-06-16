-- CreateTable
CREATE TABLE "templates" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "original_name" VARCHAR(500) NOT NULL,
    "stored_path" VARCHAR(1000) NOT NULL,
    "headers" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_mappings" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "column_index" INTEGER NOT NULL,
    "header_name" VARCHAR(200) NOT NULL,
    "source_type" VARCHAR(20),
    "source_field" VARCHAR(100),
    "suggested_by" VARCHAR(20) NOT NULL DEFAULT 'ai',
    "static_value" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_mappings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_mappings" ADD CONSTRAINT "field_mappings_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
