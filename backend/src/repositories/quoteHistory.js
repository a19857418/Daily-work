const { pool } = require('../db');

// 建立/覆寫一筆歷史報價（quote_no 唯一；同一編號重複送出視為更新同一筆，
// 對應「使用者在防呆通過後多按了一次列印/PDF」的情況，不會產生重複列）
async function createQuote({ quoteNo, quoteType, licensePlate, salesStaff, customerModel, quoteDate, validUntil, snapshot }) {
  const res = await pool.query(
    `INSERT INTO qs_quotes (quote_no, quote_type, license_plate, sales_staff, customer_model, quote_date, valid_until, snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (quote_no) DO UPDATE SET
       quote_type = EXCLUDED.quote_type,
       license_plate = EXCLUDED.license_plate,
       sales_staff = EXCLUDED.sales_staff,
       customer_model = EXCLUDED.customer_model,
       quote_date = EXCLUDED.quote_date,
       valid_until = EXCLUDED.valid_until,
       snapshot = EXCLUDED.snapshot
     RETURNING id, quote_no, created_at`,
    [quoteNo, quoteType, licensePlate || null, salesStaff || null, customerModel || null, quoteDate || null, validUntil || null, snapshot]
  );
  return res.rows[0];
}

async function listQuotes({ q, dateFrom, dateTo, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`quote_no ILIKE $${params.length}`);
  }
  if (dateFrom) {
    params.push(dateFrom);
    conditions.push(`quote_date >= $${params.length}`);
  }
  if (dateTo) {
    params.push(dateTo);
    conditions.push(`quote_date <= $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200));
  const limitIdx = params.length;
  params.push(Math.max(parseInt(offset, 10) || 0, 0));
  const offsetIdx = params.length;

  const res = await pool.query(
    `SELECT id, quote_no, quote_type, license_plate, sales_staff, customer_model,
            to_char(quote_date,'YYYY-MM-DD') AS quote_date,
            to_char(valid_until,'YYYY-MM-DD') AS valid_until,
            created_at
     FROM qs_quotes
     ${where}
     ORDER BY created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );
  return res.rows;
}

// 報價單編號：日期+當日流水序號，原子遞增（INSERT ... ON CONFLICT），公開不需密碼即可配號
async function nextQuoteNumber() {
  const d = new Date();
  const dateKey = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const res = await pool.query(
    `INSERT INTO qs_quote_seq (date_key, seq) VALUES ($1, 1)
     ON CONFLICT (date_key) DO UPDATE SET seq = qs_quote_seq.seq + 1
     RETURNING seq`,
    [dateKey]
  );
  const seq = res.rows[0].seq;
  return `${dateKey}-${String(seq).padStart(2, '0')}`;
}

async function getQuoteByNo(quoteNo) {
  const res = await pool.query(
    `SELECT id, quote_no, quote_type, license_plate, sales_staff, customer_model,
            to_char(quote_date,'YYYY-MM-DD') AS quote_date,
            to_char(valid_until,'YYYY-MM-DD') AS valid_until,
            snapshot, created_at
     FROM qs_quotes WHERE quote_no = $1`,
    [quoteNo]
  );
  return res.rows[0] || null;
}

module.exports = { createQuote, listQuotes, getQuoteByNo, nextQuoteNumber };
