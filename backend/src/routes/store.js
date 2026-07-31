const express = require('express');
const db = require('../db');

const router = express.Router();

const APP_KEY_RE = /^[a-zA-Z0-9_-]{1,100}$/;

function nowIso() {
  return new Date().toISOString();
}

function checkAppKey(req, res, next) {
  if (!APP_KEY_RE.test(req.params.appKey)) {
    return res.status(400).json({ error: '不合法的 appKey' });
  }
  next();
}

const getRow = db.prepare('SELECT * FROM settings_store WHERE app_key = ?');
const insertRow = db.prepare(`
  INSERT INTO settings_store (app_key, data, version, updated_at, updated_by)
  VALUES (@appKey, @data, @version, @updatedAt, @updatedBy)
`);
const updateRow = db.prepare(`
  UPDATE settings_store SET data=@data, version=@version, updated_at=@updatedAt, updated_by=@updatedBy
  WHERE app_key=@appKey
`);
const insertHistory = db.prepare(`
  INSERT INTO settings_history (app_key, data, version, created_at, created_by)
  VALUES (@appKey, @data, @version, @createdAt, @createdBy)
`);
const listHistory = db.prepare(`
  SELECT version, created_at as createdAt, created_by as createdBy
  FROM settings_history WHERE app_key = ? ORDER BY version DESC LIMIT ?
`);
const getHistoryVersion = db.prepare(`
  SELECT * FROM settings_history WHERE app_key = ? AND version = ?
`);

// 寫入設定：存在就 version+1、不存在就建立 version=1；每次寫入同時留一筆歷史紀錄
function writeStore(appKey, data, updatedBy) {
  const existing = getRow.get(appKey);
  const version = existing ? existing.version + 1 : 1;
  const updatedAt = nowIso();
  const payload = { appKey, data: JSON.stringify(data), version, updatedAt, updatedBy: updatedBy || null };

  const tx = db.transaction(() => {
    if (existing) updateRow.run(payload);
    else insertRow.run(payload);
    insertHistory.run({ appKey, data: payload.data, version, createdAt: updatedAt, createdBy: updatedBy || null });
  });
  tx();

  return { version, updatedAt };
}

// 取得整份設定
router.get('/:appKey', checkAppKey, (req, res) => {
  const row = getRow.get(req.params.appKey);
  if (!row) return res.status(404).json({ error: '尚無資料', appKey: req.params.appKey });
  res.json({
    appKey: row.app_key,
    version: row.version,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    data: JSON.parse(row.data),
  });
});

// 覆蓋整份設定（樂觀鎖：帶 expectedVersion，跟目前版本不符會回 409）
router.put('/:appKey', checkAppKey, (req, res) => {
  const { expectedVersion, data } = req.body || {};
  if (data === undefined) return res.status(400).json({ error: '缺少 data 欄位' });

  const existing = getRow.get(req.params.appKey);
  if (existing && expectedVersion != null && expectedVersion !== existing.version) {
    return res.status(409).json({
      error: '版本衝突，資料已被其他裝置更新',
      currentVersion: existing.version,
      data: JSON.parse(existing.data),
    });
  }

  const updatedBy = req.get('X-Client-Id') || null;
  const result = writeStore(req.params.appKey, data, updatedBy);
  res.json({ appKey: req.params.appKey, ...result });
});

// 列出最近 N 筆歷史版本摘要
router.get('/:appKey/history', checkAppKey, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const rows = listHistory.all(req.params.appKey, limit);
  res.json({ appKey: req.params.appKey, history: rows });
});

// 還原到指定歷史版本（會以該版本內容建立一筆「新」版本，不覆寫歷史本身）
router.post('/:appKey/restore/:version', checkAppKey, (req, res) => {
  const version = parseInt(req.params.version, 10);
  const hist = getHistoryVersion.get(req.params.appKey, version);
  if (!hist) return res.status(404).json({ error: '找不到指定版本' });

  const updatedBy = req.get('X-Client-Id') || null;
  const result = writeStore(req.params.appKey, JSON.parse(hist.data), updatedBy);
  res.json({ appKey: req.params.appKey, restoredFrom: version, ...result });
});

// 一次性資料匯入（初始遷移用）：略過樂觀鎖，直接覆蓋
router.post('/:appKey/import', checkAppKey, (req, res) => {
  const { data } = req.body || {};
  if (data === undefined) return res.status(400).json({ error: '缺少 data 欄位' });

  const updatedBy = req.get('X-Client-Id') || 'import';
  const result = writeStore(req.params.appKey, data, updatedBy);
  res.json({ appKey: req.params.appKey, imported: true, ...result });
});

module.exports = router;
