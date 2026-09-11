require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

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

// 讀取（GET）公開，任何有連結的人都能查詢/報價
// 車型查詢小模組：連寫入也完全公開、不需密碼——現場人員要能隨時直接修改車款資料
app.use('/api/vehicle-catalog', makeSettingsRouter(vehicleCatalogRepo, { publicWrite: true }));
// 貼膜報價系統設定：寫入/還原/匯入需要密碼解鎖（見 settingsResource.js）
app.use('/api/quote-settings', makeSettingsRouter(quoteSettingsRepo));

// 前端靜態檔案：與 API 部署在同一個 Cloud Run service，同源（frontend 的 API_BASE 固定用 "/api" 相對路徑）
app.use(express.static(path.join(__dirname, '../public')));

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
