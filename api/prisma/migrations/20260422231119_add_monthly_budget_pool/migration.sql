-- DropIndex
DROP INDEX "documents_latest_active_idx";

-- CreateTable
CREATE TABLE "monthly_budgets" (
    "id" SERIAL NOT NULL,
    "kind" "BudgetKind" NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdBy" INTEGER,
    "updatedBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monthly_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "monthly_budgets_kind_year_month_key" ON "monthly_budgets"("kind", "year", "month");
