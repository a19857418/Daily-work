const express = require('express');
const { createQuote, listQuotes, getQuoteByNo, nextQuoteNumber } = require('../repositories/quoteHistory');

// 歷史報價查詢：GET 查詢（清單/單筆）跟 POST 新增都公開，不需要密碼——
// 跟整台車報價/局部貼膜估價頁面本身一樣，任何有連結的人都能直接使用，見 docs/gcp-deploy.md。
const router = express.Router();

// 報價單編號配號：獨立路徑（放在 /:quoteNo 之前避免路由混淆），公開不需密碼
router.post('/next-number', async (req, res, next) => {
  try {
    const quoteNo = await nextQuoteNumber();
    res.json({ quoteNo });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const { q, dateFrom, dateTo, limit, offset } = req.query;
    const quotes = await listQuotes({ q, dateFrom, dateTo, limit, offset });
    res.json({ quotes });
  } catch (err) {
    next(err);
  }
});

router.get('/:quoteNo', async (req, res, next) => {
  try {
    const row = await getQuoteByNo(req.params.quoteNo);
    if (!row) return res.status(404).json({ error: '找不到此報價單編號' });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { quoteNo, quoteType, licensePlate, salesStaff, customerModel, quoteDate, validUntil, snapshot } = req.body || {};
    if (!quoteNo || !quoteType || !snapshot) {
      return res.status(400).json({ error: '缺少必要欄位（quoteNo/quoteType/snapshot）' });
    }
    if (!['wholecar', 'local'].includes(quoteType)) {
      return res.status(400).json({ error: 'quoteType 只能是 wholecar 或 local' });
    }
    const row = await createQuote({ quoteNo, quoteType, licensePlate, salesStaff, customerModel, quoteDate, validUntil, snapshot });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
