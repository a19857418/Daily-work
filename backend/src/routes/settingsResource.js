const express = require('express');
const { requireRole } = require('../auth');
const { listHistory, getHistorySnapshot, VersionConflictError } = require('../repositories/historyMeta');

// 建立一組共用的「整包設定資源」路由：GET（任何已登入帳號）／PUT・history・restore（僅 admin）
function makeSettingsRouter(repo) {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      const result = await repo.getCatalog ? await repo.getCatalog() : await repo.getSettings();
      if (!result) return res.status(404).json({ error: '尚無資料' });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.put('/', requireRole('admin'), async (req, res, next) => {
    try {
      const { expectedVersion, data } = req.body || {};
      if (data === undefined) return res.status(400).json({ error: '缺少 data 欄位' });
      const replaceFn = repo.replaceCatalog || repo.replaceSettings;
      const result = await replaceFn(data, req.user.username, expectedVersion ?? null);
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

  router.post('/restore/:version', requireRole('admin'), async (req, res, next) => {
    try {
      const version = parseInt(req.params.version, 10);
      const snapshot = await getHistorySnapshot(repo.APP_KEY, version);
      if (!snapshot) return res.status(404).json({ error: '找不到指定版本' });
      const replaceFn = repo.replaceCatalog || repo.replaceSettings;
      const result = await replaceFn(snapshot, req.user.username, null);
      res.json({ restoredFrom: version, ...result });
    } catch (err) {
      next(err);
    }
  });

  router.post('/import', requireRole('admin'), async (req, res, next) => {
    try {
      const { data } = req.body || {};
      if (data === undefined) return res.status(400).json({ error: '缺少 data 欄位' });
      const replaceFn = repo.replaceCatalog || repo.replaceSettings;
      const result = await replaceFn(data, req.user.username, null);
      res.json({ imported: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { makeSettingsRouter };
