const express = require('express');
const { q } = require('../db');
const { ah } = require('../util');
const { requireAuth } = require('../middleware');

const r = express.Router();
r.use(requireAuth);

r.get('/', ah(async (req, res) => {
  const from = req.query.from || null;
  const to = req.query.to || null;
  const period = ['weekly', 'monthly'].includes(req.query.period) ? req.query.period : 'daily';
  const rng = `($1::date IS NULL OR s.sale_date::date >= $1) AND ($2::date IS NULL OR s.sale_date::date <= $2) AND s.status='completed'`;

  // Series aggregation: daily buckets, or week/month truncation.
  let seriesSql, seriesParams;
  if (period === 'daily') {
    seriesSql = `SELECT TO_CHAR(d, 'YYYY-MM-DD') label, COALESCE(SUM(s.total),0) total, COUNT(s.id)::int count
       FROM generate_series(COALESCE($1::date, CURRENT_DATE - 29), COALESCE($2::date, CURRENT_DATE), '1 day') d
       LEFT JOIN sales s ON s.sale_date::date = d AND s.status='completed' GROUP BY d ORDER BY d`;
    seriesParams = [from, to];
  } else {
    const unit = period === 'weekly' ? 'week' : 'month';
    seriesSql = `SELECT TO_CHAR(date_trunc('${unit}', s.sale_date::date), 'YYYY-MM-DD') label, SUM(s.total) total, COUNT(*)::int count
       FROM sales s WHERE s.status='completed'
         AND ($1::date IS NULL OR s.sale_date::date >= $1) AND ($2::date IS NULL OR s.sale_date::date <= $2)
       GROUP BY 1 ORDER BY 1`;
    seriesParams = [from, to];
  }

  const [salesAgg, expenseAgg, stockAgg, debts, lowStock, recent, series, byMethod, topProducts, cashIn, cashOut, movSum] = await Promise.all([
    q(`SELECT COALESCE(SUM(s.total),0) revenue, COALESCE(SUM(i.cogs),0) cogs, COUNT(*)::int count
       FROM sales s LEFT JOIN (SELECT sale_id, SUM(line_cost) cogs FROM sale_items GROUP BY sale_id) i ON i.sale_id=s.id
       WHERE ${rng}`, [from, to]),
    q(`SELECT COALESCE(SUM(amount),0) total FROM expenses e
       WHERE ($1::date IS NULL OR e.expense_date >= $1) AND ($2::date IS NULL OR e.expense_date <= $2)`, [from, to]),
    q(`SELECT COUNT(*)::int products, COALESCE(SUM(stock_bottles * cost_price),0) stock_value,
              COALESCE(SUM(stock_bottles),0) total_bottles,
              COUNT(*) FILTER (WHERE stock_bottles = 0)::int out_count,
              COUNT(*) FILTER (WHERE stock_bottles <= min_stock AND stock_bottles > 0)::int low_count,
              COUNT(*) FILTER (WHERE stock_bottles <= min_stock * 1.5 AND stock_bottles > min_stock)::int approaching_count
       FROM products WHERE is_active`),
    q(`SELECT (SELECT COALESCE(SUM(balance),0) FROM customers) cust_debt,
              (SELECT COALESCE(SUM(balance),0) FROM suppliers) supp_debt`),
    q(`SELECT id,name,stock_bottles,min_stock,bottles_per_pallet,type,
        CASE WHEN stock_bottles=0 THEN 'out' WHEN stock_bottles<=min_stock THEN 'low' ELSE 'approaching' END alert
       FROM products WHERE is_active AND stock_bottles <= min_stock * 1.5 ORDER BY stock_bottles LIMIT 12`),
    q(`SELECT s.id,s.receipt_no,s.sale_date,s.total,s.payment_status,s.status,c.name customer_name
       FROM sales s LEFT JOIN customers c ON c.id=s.customer_id ORDER BY s.sale_date DESC LIMIT 8`),
    q(seriesSql, seriesParams),
    q(`SELECT s.payment_method method, COALESCE(SUM(s.paid_amount),0) amount, COUNT(*)::int count
       FROM sales s WHERE ${rng} GROUP BY s.payment_method`, [from, to]),
    q(`SELECT si.product_name name, SUM(si.base_qty)::int bottles, SUM(si.line_total) revenue, SUM(si.line_total - si.line_cost) profit
       FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE ${rng}
       GROUP BY si.product_name ORDER BY revenue DESC LIMIT 5`, [from, to]),
    // Actual payments received: money in from sale payments + customer debt repayments.
    q(`SELECT COALESCE((SELECT SUM(paid_amount) FROM sales s WHERE ${rng}),0)
        + COALESCE((SELECT SUM(amount) FROM customer_payments p
            WHERE ($1::date IS NULL OR p.paid_at::date >= $1) AND ($2::date IS NULL OR p.paid_at::date <= $2)),0) received`, [from, to]),
    // Money out: supplier debt payments + purchase down payments + expenses.
    q(`SELECT COALESCE((SELECT SUM(amount) FROM supplier_payments p
            WHERE ($1::date IS NULL OR p.paid_at::date >= $1) AND ($2::date IS NULL OR p.paid_at::date <= $2)),0)
        + COALESCE((SELECT SUM(paid_amount) FROM purchases p
            WHERE p.status='received' AND ($1::date IS NULL OR p.purchase_date::date >= $1) AND ($2::date IS NULL OR p.purchase_date::date <= $2)),0) paid`, [from, to]),
    q(`SELECT type, COALESCE(SUM(quantity),0)::int qty, COUNT(*)::int n FROM stock_movements
       WHERE created_at >= now() - interval '7 days' GROUP BY type`),
  ]);

  const revenue = +salesAgg.rows[0].revenue;
  const cogs = +salesAgg.rows[0].cogs;
  const gross = revenue - cogs;
  const expenses = +expenseAgg.rows[0].total;
  const received = +cashIn.rows[0].received;
  const cashOutV = +cashOut.rows[0].paid + expenses;

  res.json({
    revenue, cogs, gross_profit: gross, expenses, net_profit: gross - expenses,
    sale_count: salesAgg.rows[0].count,
    products: stockAgg.rows[0].products,
    stock_value: +stockAgg.rows[0].stock_value,
    total_bottles: +stockAgg.rows[0].total_bottles,
    low_count: stockAgg.rows[0].low_count, out_count: stockAgg.rows[0].out_count,
    approaching_count: stockAgg.rows[0].approaching_count,
    customer_debt: +debts.rows[0].cust_debt, supplier_debt: +debts.rows[0].supp_debt,
    payments_received: received, payments_made: +cashOut.rows[0].paid,
    net_cash_flow: received - cashOutV,
    low_stock: lowStock.rows, recent_sales: recent.rows,
    series: series.rows, payment_methods: byMethod.rows, top_products: topProducts.rows,
    movement_summary: movSum.rows,
  });
}));

module.exports = r;
