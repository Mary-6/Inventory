ALTER TABLE sales ADD COLUMN IF NOT EXISTS due_date DATE;
UPDATE sales SET due_date = sale_date::date + 30 WHERE due_date IS NULL AND balance_due > 0;
