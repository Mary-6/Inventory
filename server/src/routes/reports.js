const express = require('express');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { q } = require('../db');
const { ah, bad } = require('../util');
const { requireAuth } = require('../middleware');

const r = express.Router();
r.use(requireAuth);

const rng = (req) => [req.query.from || null, req.query.to || null];
const saleWhere = `($1::date IS NULL OR s.sale_date::date >= $1) AND ($2::date IS NULL OR s.sale_date::date <= $2)`;

async function reportData(type, req) {
  const [from, to] = rng(req);
  switch (type) {
    case 'sales': {
      const rows = (await q(`SELECT s.sale_date::date::text date, s.receipt_no, c.name customer, s.total, s.paid_amount, s.balance_due, s.payment_method, s.payment_status, s.status
        FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE ${saleWhere} ORDER BY s.sale_date`, [from, to])).rows;
      const live = rows.filter(x => x.status !== 'voided');
      return { title: `Sales Report`, columns: ['Date','Receipt','Customer','Total','Paid','Balance','Method','Status','State'],
        rows: rows.map(x => [x.date, x.receipt_no, x.customer || 'Walk-in', +x.total, +x.paid_amount, +x.balance_due, x.payment_method, x.payment_status, x.status]),
        summary: { 'Total revenue': live.reduce((a, x) => a + +x.total, 0), 'Transactions': live.length, 'Outstanding': live.reduce((a, x) => a + +x.balance_due, 0), 'Voided': rows.length - live.length } };
    }
    case 'profitability': {
      const rows = (await q(`SELECT si.product_name, SUM(si.base_qty)::int bottles, SUM(si.line_total) revenue, SUM(si.line_cost) cogs, SUM(si.line_total-si.line_cost) profit
        FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE ${saleWhere} AND s.status='completed' GROUP BY si.product_name ORDER BY profit DESC`, [from, to])).rows;
      return { title: 'Product Profitability', columns: ['Product','Bottles sold','Revenue','COGS','Gross profit'],
        rows: rows.map(x => [x.product_name, x.bottles, +x.revenue, +x.cogs, +x.profit]),
        summary: { Revenue: rows.reduce((a,x)=>a+ +x.revenue,0), 'Gross profit': rows.reduce((a,x)=>a+ +x.profit,0) } };
    }
    case 'purchases': {
      const rows = (await q(`SELECT p.purchase_date::date::text date, p.reference, s.name supplier, p.total, p.paid_amount, p.balance_due, p.payment_status, p.status
        FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE ($1::date IS NULL OR p.purchase_date::date >= $1) AND ($2::date IS NULL OR p.purchase_date::date <= $2) ORDER BY p.purchase_date`, [from, to])).rows;
      return { title: 'Purchase History', columns: ['Date','Reference','Supplier','Total','Paid','Balance','Pay status','Status'],
        rows: rows.map(x => [x.date, x.reference, x.supplier || '—', +x.total, +x.paid_amount, +x.balance_due, x.payment_status, x.status]),
        summary: { 'Total purchases': rows.reduce((a,x)=>a+ +x.total,0) } };
    }
    case 'purchase-register': {
      const rows = (await q(`SELECT p.purchase_date::date::text date, p.reference, s.name supplier,
          (SELECT string_agg(pi.product_name || ' ×' || pi.quantity || ' ' || pi.unit_label, ', ') FROM purchase_items pi WHERE pi.purchase_id=p.id) products,
          p.total, p.paid_amount, p.balance_due, COALESCE(p.payment_method,'cash') method, p.status
        FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id
        WHERE p.status='received' AND ($1::date IS NULL OR p.purchase_date::date >= $1) AND ($2::date IS NULL OR p.purchase_date::date <= $2)
        ORDER BY p.purchase_date, p.id`, [from, to])).rows;
      return { title: 'Daily Purchase Register', columns: ['Date','Reference','Supplier','Products','Total','Paid','Outstanding','Method'],
        rows: rows.map(x => [x.date, x.reference, x.supplier || '—', x.products || '', +x.total, +x.paid_amount, +x.balance_due, x.method]),
        summary: { 'Purchases': rows.length, 'Total value': rows.reduce((a,x)=>a+ +x.total,0),
          'Total paid': rows.reduce((a,x)=>a+ +x.paid_amount,0), 'Outstanding': rows.reduce((a,x)=>a+ +x.balance_due,0) } };
    }
    case 'expenses': {
      const rows = (await q(`SELECT expense_date::text date, category, description, amount FROM expenses e
        WHERE ($1::date IS NULL OR e.expense_date >= $1) AND ($2::date IS NULL OR e.expense_date <= $2) ORDER BY e.expense_date`, [from, to])).rows;
      return { title: 'Expense Report', columns: ['Date','Category','Description','Amount'],
        rows: rows.map(x => [x.date, x.category, x.description || '', +x.amount]),
        summary: { 'Total expenses': rows.reduce((a,x)=>a+ +x.amount,0) } };
    }
    case 'stock': {
      const rows = (await q(`SELECT p.name, p.type, p.stock_bottles, p.bottles_per_pallet, p.cost_price, p.min_stock,
        p.stock_bottles * p.cost_price value FROM products p WHERE p.is_active ORDER BY p.name`)).rows;
      return { title: 'Stock / Inventory Report', columns: ['Product','Pack','Bottles','Cost/btl','Stock value','Min stock','Status'],
        rows: rows.map(x => [x.name, x.bottles_per_pallet > 1 ? `${Math.floor(x.stock_bottles/x.bottles_per_pallet)} ${x.type==='wine'?'ctn':'pal'} + ${x.stock_bottles%x.bottles_per_pallet} btl` : '—',
          x.stock_bottles, +x.cost_price, +x.value, x.min_stock, x.stock_bottles===0?'OUT':x.stock_bottles<=x.min_stock?'LOW':'OK']),
        summary: { 'Total stock value': rows.reduce((a,x)=>a+ +x.value,0), 'Total bottles': rows.reduce((a,x)=>a+x.stock_bottles,0), 'Products': rows.length } };
    }
    case 'debts': {
      const cust = (await q(`SELECT 'Customer' party_type, name, phone, balance FROM customers WHERE balance>0`)).rows;
      const supp = (await q(`SELECT 'Supplier' party_type, name, phone, balance FROM suppliers WHERE balance>0`)).rows;
      const rows = [...cust, ...supp];
      return { title: 'Outstanding Debts', columns: ['Type','Name','Phone','Balance'],
        rows: rows.map(x => [x.party_type, x.name, x.phone || '', +x.balance]),
        summary: { 'Owed by customers': cust.reduce((a,x)=>a+ +x.balance,0), 'Owed to suppliers': supp.reduce((a,x)=>a+ +x.balance,0) } };
    }
    case 'closing': {
      const day = req.query.date || req.query.to || new Date().toISOString().slice(0, 10);
      const [s, pay, sup, pur, exp, openCash] = await Promise.all([
        q(`SELECT COALESCE(SUM(total),0) total,
             COALESCE(SUM(paid_amount) FILTER (WHERE payment_method='cash'),0) cash_sales,
             COALESCE(SUM(paid_amount) FILTER (WHERE payment_method='mobile_money'),0) momo,
             COALESCE(SUM(paid_amount) FILTER (WHERE payment_method='bank_transfer'),0) bank,
             COALESCE(SUM(total-paid_amount),0) credit
           FROM sales WHERE status='completed' AND sale_date::date=$1`, [day]),
        q(`SELECT COALESCE(SUM(amount),0) total, COALESCE(SUM(amount) FILTER (WHERE method='cash'),0) cash
           FROM customer_payments WHERE paid_at::date=$1`, [day]),
        q(`SELECT COALESCE(SUM(amount),0) total FROM supplier_payments WHERE paid_at::date=$1`, [day]),
        q(`SELECT COALESCE(SUM(paid_amount),0) total FROM purchases WHERE status='received' AND purchase_date::date=$1`, [day]),
        q(`SELECT COALESCE(SUM(amount),0) total FROM expenses WHERE expense_date=$1`, [day]),
        // Opening cash = all cash inflows minus outflows BEFORE this day.
        q(`SELECT COALESCE((SELECT SUM(paid_amount) FROM sales WHERE status='completed' AND payment_method='cash' AND sale_date::date<$1),0)
             + COALESCE((SELECT SUM(amount) FROM customer_payments WHERE method='cash' AND paid_at::date<$1),0)
             - COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE method='cash' AND paid_at::date<$1),0)
             - COALESCE((SELECT SUM(paid_amount) FROM purchases WHERE status='received' AND purchase_date::date<$1),0)
             - COALESCE((SELECT SUM(amount) FROM expenses WHERE expense_date<$1),0) opening`, [day]),
      ]);
      const d = s.rows[0], opening = +openCash.rows[0].opening;
      const cashIn = +d.cash_sales + +pay.rows[0].cash;
      const cashOut = +sup.rows[0].total + +pur.rows[0].total + +exp.rows[0].total;
      const rows = [
        ['Opening cash balance', opening],
        ['Total sales', +d.total],
        ['Cash sales', +d.cash_sales],
        ['Mobile money received', +d.momo],
        ['Bank transfers received', +d.bank],
        ['Credit sales (outstanding)', +d.credit],
        ['Customer debt repayments', +pay.rows[0].total],
        ['Expenses', -+exp.rows[0].total],
        ['Supplier payments', -(+sup.rows[0].total + +pur.rows[0].total)],
        ['Closing cash balance', opening + cashIn - cashOut],
      ];
      return { title: `Daily Closing Report — ${day}`, columns: ['Item', 'Amount (FCFA)'],
        rows, summary: { 'Closing cash': opening + cashIn - cashOut, 'Total sales': +d.total } };
    }
    case 'net-profit': {
      const s = (await q(`SELECT COALESCE(SUM(s.total),0) revenue, COALESCE(SUM(i.cogs),0) cogs
        FROM sales s LEFT JOIN (SELECT sale_id, SUM(line_cost) cogs FROM sale_items GROUP BY sale_id) i ON i.sale_id=s.id WHERE ${saleWhere} AND s.status='completed'`, [from, to])).rows[0];
      const e = (await q(`SELECT COALESCE(SUM(amount),0) total FROM expenses e WHERE ($1::date IS NULL OR e.expense_date >= $1) AND ($2::date IS NULL OR e.expense_date <= $2)`, [from, to])).rows[0];
      const gross = +s.revenue - +s.cogs;
      return { title: 'Net Profit Report', columns: ['Metric','Amount'],
        rows: [['Sales revenue', +s.revenue], ['Cost of goods sold', +s.cogs], ['Gross profit', gross], ['Operating expenses', +e.total], ['Net profit', gross - +e.total]],
        summary: { 'Net profit': gross - +e.total } };
    }
    default: throw bad('Unknown report type');
  }
}

r.get('/:type', ah(async (req, res) => {
  const data = await reportData(req.params.type, req);
  const format = req.query.format || 'json';
  const biz = Object.fromEntries((await q('SELECT key,value FROM settings')).rows.map(x => [x.key, x.value]));
  const fname = `${req.params.type}-${req.query.from || 'all'}-${req.query.to || 'all'}`;

  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(req.params.type);
    ws.addRow([biz.business_name || "ROMARICK'S VINTAGE"]); ws.addRow([data.title]);
    ws.addRow([]); ws.addRow(data.columns).font = { bold: true };
    data.rows.forEach(row => ws.addRow(row));
    ws.addRow([]); Object.entries(data.summary).forEach(([k, v]) => ws.addRow([k, v]).font = { bold: true });
    ws.columns.forEach(c => c.width = 20);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}.xlsx"`);
    return wb.xlsx.write(res).then(() => res.end());
  }

  if (format === 'pdf') {
    const doc = new PDFDocument({ margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}.pdf"`);
    doc.pipe(res);
    doc.fontSize(16).fillColor('#1e293b').text(biz.business_name || "ROMARICK'S VINTAGE", { align: 'center' });
    doc.fontSize(11).fillColor('#65a30d').text(data.title, { align: 'center' }).moveDown(0.5);
    if (req.query.from || req.query.to) doc.fontSize(9).fillColor('#555').text(`Period: ${req.query.from || 'start'} — ${req.query.to || 'today'}`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(9).fillColor('#000');
    doc.font('Helvetica-Bold').text(data.columns.join('  |  '));
    doc.font('Helvetica').moveDown(0.3);
    data.rows.forEach(row => doc.text(row.join('  |  ')));
    doc.moveDown().font('Helvetica-Bold');
    Object.entries(data.summary).forEach(([k, v]) => doc.text(`${k}: ${Number(v).toLocaleString()} ${biz.currency_symbol || 'FCFA'}`));
    return doc.end();
  }

  res.json(data);
}));

module.exports = r;
