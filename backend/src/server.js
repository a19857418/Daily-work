require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { requireAuth } = require('./auth');
const authRoutes = require('./routes/auth');
const { makeSettingsRouter } = require('./routes/settingsResource');
const vehicleCatalogRepo = require('./repositories/vehicleCatalog');
const quoteSettingsRepo = require('./repositories/quoteSettings');

const app = express();
app.use(express.json({ limit: '2mb' }));

const allowedOrigins = (process.env.ALLOWED_ORIGIN || '*').split(',').map((s) => s.trim());
app.use(
  cors({
    origin: allowedOrigins.includes('*') ? true : allowedOrigins,
  })
);

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);

// 以下路徑都需要登入（任何角色皆可讀取；寫入/還原/匯入限 admin，見 settingsResource.js）
app.use('/api/vehicle-catalog', requireAuth, makeSettingsRouter(vehicleCatalogRepo));
app.use('/api/quote-settings', requireAuth, makeSettingsRouter(quoteSettingsRepo));

app.use((req, res) => res.status(404).json({ error: '找不到此路徑' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '伺服器發生錯誤' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`後台設定資料庫 API 已啟動，port ${PORT}`);
  if (!process.env.JWT_SECRET) {
    console.warn('⚠ 尚未設定 JWT_SECRET，所有需要登入的請求都會被拒絕，請參考 .env.example 設定。');
  }
});
