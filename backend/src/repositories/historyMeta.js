const { pool } = require('../db');

async function getMeta(appKey) {
  const res = await pool.query('SELECT version, updated_at, updated_by FROM settings_meta WHERE app_key=$1', [appKey]);
  return res.rows[0] || null;
}

// 在交易中鎖定目前版本列（若存在），回傳目前版本號（不存在則為 0）
async function lockCurrentVersion(client, appKey) {
  const res = await client.query('SELECT version FROM settings_meta WHERE app_key=$1 FOR UPDATE', [appKey]);
  return res.rows[0]?.version ?? 0;
}

async function bumpMeta(client, appKey, newVersion, updatedBy) {
  const updatedAt = new Date().toISOString();
  await client.query(
    `INSERT INTO settings_meta (app_key, version, updated_at, updated_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (app_key) DO UPDATE SET version=$2, updated_at=$3, updated_by=$4`,
    [appKey, newVersion, updatedAt, updatedBy || null]
  );
  return { version: newVersion, updatedAt };
}

async function snapshotHistory(client, appKey, dataObj, version, updatedAt, updatedBy) {
  await client.query(
    `INSERT INTO settings_history (app_key, data, version, created_at, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [appKey, JSON.stringify(dataObj), version, updatedAt, updatedBy || null]
  );
}

async function listHistory(appKey, limit) {
  const res = await pool.query(
    `SELECT version, created_at as "createdAt", created_by as "createdBy"
     FROM settings_history WHERE app_key = $1 ORDER BY version DESC LIMIT $2`,
    [appKey, limit]
  );
  return res.rows;
}

async function getHistorySnapshot(appKey, version) {
  const res = await pool.query('SELECT data FROM settings_history WHERE app_key=$1 AND version=$2', [appKey, version]);
  return res.rows[0]?.data || null;
}

class VersionConflictError extends Error {
  constructor(currentVersion) {
    super('版本衝突，資料已被其他裝置更新');
    this.name = 'VersionConflictError';
    this.currentVersion = currentVersion;
  }
}

module.exports = { getMeta, lockCurrentVersion, bumpMeta, snapshotHistory, listHistory, getHistorySnapshot, VersionConflictError };
