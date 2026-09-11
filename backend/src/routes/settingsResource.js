const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const { listHistory, getHistorySnapshot, VersionConflictError } = require('../repositories/historyMeta');

// 建立一組共用的「整包設定資源」路由：GET 一律公開（任何有連結的人都能查詢）；
// PUT・restore・import 預設需要密碼解鎖（requireAuth 驗證 JWT + requireRole 限定 admin）。
// 傳入 { publicWrite: true } 可讓寫入也完全公開、不需密碼——目前只有車型查詢小模組
// （vehicleCatalog）使用這個選項，因為它是現場人員隨時要能直接修改的小工具，
// 跟需要密碼保護的貼膜報價系統設定（quoteSettings）性質不同，見 server.js 的路由註冊。
function makeSettingsRouter(repo, options = {}) {
  const router = express.Router();
  const writeGuards = options.publicWrite ? [] : [requireAuth, requireRole('admin')];
  const updatedByOf = (req) => req.user?.username || 'anonymous';

  router.get('/', async (req, res, next) => {
    try {
      const result = await repo.getCatalog ? await repo.getCatalog() : await repo.getSettings();
      if (!result) return res.status(404).json({ error: '尚無資料' });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.put('/', ...writeGuards, async (req, res, next) => {
    try {
      const { expectedVersion, data } = req.body || {};
      if (data === undefined) return res.status(400).json({ error: '缺少 data 欄位' });
      const replaceFn = repo.replaceCatalog || repo.replaceSettings;
      const result = await replaceFn(data, updatedByOf(req), expectedVersion ?? null);
      res.json(result);
    } catch (err) {
      if (err instanceof VersionConflictError) {
        const current = repo.getCatalog ? await repo.getCatalog() : await repo.getSettings();
        return res.status(409).json({ error: err.message, currentVersion: err.currentVersion, data: current?.data });
      }
      next(err);
    }
  });

  router.get('/history', async (req, res, next) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
      const history = await listHistory(repo.APP_KEY, limit);
      res.json({ appKey: repo.APP_KEY, history });
    } catch (err) {
      next(err);
    }
  });

  router.post('/restore/:version', ...writeGuards, async (req, res, next) => {
    try {
      const version = parseInt(req.params.version, 10);
      const snapshot = await getHistorySnapshot(repo.APP_KEY, version);
      if (!snapshot) return res.status(404).json({ error: '找不到指定版本' });
      const replaceFn = repo.replaceCatalog || repo.replaceSettings;
      const result = await replaceFn(snapshot, updatedByOf(req), null);
      res.json({ restoredFrom: version, ...result });
    } catch (err) {
      next(err);
    }
  });

  router.post('/import', ...writeGuards, async (req, res, next) => {
    try {
      const { data } = req.body || {};
      if (data === undefined) return res.status(400).json({ error: '缺少 data 欄位' });
      const replaceFn = repo.replaceCatalog || repo.replaceSettings;
      const result = await replaceFn(data, updatedByOf(req), null);
      res.json({ imported: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { makeSettingsRouter };
