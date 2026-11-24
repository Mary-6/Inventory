ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS returned_qty INT NOT NULL DEFAULT 0 CHECK (returned_qty >= 0);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS returned_amount BIGINT NOT NULL DEFAULT 0 CHECK (returned_amount >= 0);
