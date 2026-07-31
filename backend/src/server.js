require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { requireApiKey } = require('./auth');
const storeRoutes = require('./routes/store');

const app = express();
app.use(express.json({ limit: '2mb' }));

const allowedOrigins = (process.env.ALLOWED_ORIGIN || '*').split(',').map((s) => s.trim());
app.use(
  cors({
    origin: allowedOrigins.includes('*') ? true : allowedOrigins,
  })
);

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/store', requireApiKey, storeRoutes);

app.use((req, res) => res.status(404).json({ error: '找不到此路徑' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`後台設定資料庫 API 已啟動，port ${PORT}`);
  if (!process.env.API_KEY) {
    console.warn('⚠ 尚未設定 API_KEY，所有需要驗證的請求都會被拒絕，請參考 .env.example 設定。');
  }
});
