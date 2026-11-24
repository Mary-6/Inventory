CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  category_id INT REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  brand TEXT,
  type TEXT NOT NULL CHECK (type IN ('wholesale_drink','wine')) DEFAULT 'wholesale_drink',
  bottles_per_pallet INT NOT NULL DEFAULT 12 CHECK (bottles_per_pallet > 0),
  cost_price BIGINT NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  selling_price BIGINT NOT NULL DEFAULT 0 CHECK (selling_price >= 0),
  pallet_price BIGINT CHECK (pallet_price IS NULL OR pallet_price >= 0),
  stock_bottles INT NOT NULL DEFAULT 0 CHECK (stock_bottles >= 0),
  min_stock INT NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  image_path TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  notes TEXT,
  balance BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  notes TEXT,
  balance BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name);

CREATE TABLE IF NOT EXISTS sales (
  id SERIAL PRIMARY KEY,
  receipt_no TEXT NOT NULL UNIQUE,
  customer_id INT REFERENCES customers(id) ON DELETE SET NULL,
  sale_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  subtotal BIGINT NOT NULL DEFAULT 0,
  discount BIGINT NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total BIGINT NOT NULL DEFAULT 0,
  paid_amount BIGINT NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  balance_due BIGINT NOT NULL DEFAULT 0 CHECK (balance_due >= 0),
  payment_method TEXT NOT NULL DEFAULT 'cash',
  payment_status TEXT NOT NULL CHECK (payment_status IN ('paid','partial','unpaid')),
  notes TEXT,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);

CREATE TABLE IF NOT EXISTS sale_items (
  id SERIAL PRIMARY KEY,
  sale_id INT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INT REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  unit_label TEXT NOT NULL,
  unit_factor INT NOT NULL CHECK (unit_factor > 0),
  quantity INT NOT NULL CHECK (quantity > 0),
  base_qty INT NOT NULL CHECK (base_qty > 0),
  unit_price BIGINT NOT NULL CHECK (unit_price >= 0),
  unit_cost BIGINT NOT NULL DEFAULT 0,
  line_total BIGINT NOT NULL,
  line_cost BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);

CREATE TABLE IF NOT EXISTS customer_payments (
  id SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL DEFAULT 'cash',
  note TEXT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id INT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_cust_pay_customer ON customer_payments(customer_id);

CREATE TABLE IF NOT EXISTS customer_payment_allocations (
  id SERIAL PRIMARY KEY,
  payment_id INT NOT NULL REFERENCES customer_payments(id) ON DELETE CASCADE,
  sale_id INT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL CHECK (amount > 0)
);

CREATE TABLE IF NOT EXISTS purchases (
  id SERIAL PRIMARY KEY,
  reference TEXT NOT NULL,
  supplier_id INT REFERENCES suppliers(id) ON DELETE SET NULL,
  purchase_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  total BIGINT NOT NULL DEFAULT 0,
  paid_amount BIGINT NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  balance_due BIGINT NOT NULL DEFAULT 0 CHECK (balance_due >= 0),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('paid','partial','unpaid')),
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','voided')),
  notes TEXT,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(reference, supplier_id)
);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(purchase_date);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);

CREATE TABLE IF NOT EXISTS purchase_items (
  id SERIAL PRIMARY KEY,
  purchase_id INT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id INT REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  unit_label TEXT NOT NULL,
  unit_factor INT NOT NULL CHECK (unit_factor > 0),
  quantity INT NOT NULL CHECK (quantity > 0),
  base_qty INT NOT NULL CHECK (base_qty > 0),
  unit_cost BIGINT NOT NULL CHECK (unit_cost >= 0),
  line_total BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product ON purchase_items(product_id);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id SERIAL PRIMARY KEY,
  supplier_id INT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL DEFAULT 'cash',
  note TEXT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id INT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_sup_pay_supplier ON supplier_payments(supplier_id);

CREATE TABLE IF NOT EXISTS supplier_payment_allocations (
  id SERIAL PRIMARY KEY,
  payment_id INT NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
  purchase_id INT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL CHECK (amount > 0)
);

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  description TEXT,
  amount BIGINT NOT NULL CHECK (amount > 0),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);

CREATE TABLE IF NOT EXISTS stock_movements (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('purchase','sale','damage','missing','adjustment','return','void_purchase')),
  quantity INT NOT NULL,
  stock_after INT NOT NULL,
  note TEXT,
  ref_type TEXT,
  ref_id INT,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_mov_product ON stock_movements(product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  subject_type TEXT,
  subject_id INT,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
