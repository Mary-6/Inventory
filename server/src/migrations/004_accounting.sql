CREATE TABLE IF NOT EXISTS accounts (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense'))
);
INSERT INTO accounts(code,name,type) VALUES
  ('1000','Cash on Hand','asset'), ('1010','Bank Account','asset'), ('1020','Mobile Money','asset'),
  ('1100','Accounts Receivable','asset'), ('1200','Inventory','asset'),
  ('2000','Accounts Payable','liability'),
  ('3000','Owner''s Capital','equity'), ('3100','Owner''s Drawings','equity'),
  ('4000','Sales Revenue','revenue'), ('4100','Sales Returns','revenue'),
  ('5000','Cost of Goods Sold','expense'), ('6000','Operating Expenses','expense'), ('6100','Stock Adjustments','expense')
ON CONFLICT(code) DO NOTHING;

CREATE TABLE IF NOT EXISTS journal_entries (
  id SERIAL PRIMARY KEY,
  entry_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  description TEXT NOT NULL,
  ref_type TEXT,
  ref_id INT,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_je_date ON journal_entries(entry_date);

CREATE TABLE IF NOT EXISTS journal_lines (
  id SERIAL PRIMARY KEY,
  entry_id INT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_code TEXT NOT NULL REFERENCES accounts(code),
  debit BIGINT NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit BIGINT NOT NULL DEFAULT 0 CHECK (credit >= 0)
);
CREATE INDEX IF NOT EXISTS idx_jl_account ON journal_lines(account_code);
CREATE INDEX IF NOT EXISTS idx_jl_entry ON journal_lines(entry_id);

CREATE TABLE IF NOT EXISTS daily_closings (
  id SERIAL PRIMARY KEY,
  close_date DATE NOT NULL UNIQUE,
  expected_cash BIGINT NOT NULL DEFAULT 0,
  actual_cash BIGINT NOT NULL DEFAULT 0,
  difference BIGINT NOT NULL DEFAULT 0,
  total_sales BIGINT NOT NULL DEFAULT 0,
  total_received BIGINT NOT NULL DEFAULT 0,
  total_paid BIGINT NOT NULL DEFAULT 0,
  notes TEXT,
  closed_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash';
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS reference TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash';
