const { pool, withTransaction } = require('../db');
const { getMeta, lockCurrentVersion, bumpMeta, snapshotHistory, VersionConflictError } = require('./historyMeta');

const APP_KEY = 'vehicle-catalog';

async function getCatalog() {
  const meta = await getMeta(APP_KEY);
  if (!meta) return null;

  const brandsRes = await pool.query('SELECT name FROM vehicle_brands ORDER BY sort_order');
  const vehiclesRes = await pool.query(`
    SELECT v.id, b.name AS brand, v.model, v.length_text AS length, v.category AS cat
    FROM vehicles v
    JOIN vehicle_brands b ON b.id = v.brand_id
    ORDER BY b.sort_order, v.model
  `);

  return {
    version: meta.version,
    updatedAt: meta.updated_at,
    updatedBy: meta.updated_by,
    data: {
      brandOrder: brandsRes.rows.map((r) => r.name),
      vehicles: vehiclesRes.rows,
    },
  };
}

// 整包替換（交易內）：刪除全部車款/廠牌再依傳入資料重建，並寫入版本＋歷史快照
async function replaceCatalog(data, updatedBy, expectedVersion) {
  return withTransaction(async (client) => {
    const currentVersion = await lockCurrentVersion(client, APP_KEY);
    if (currentVersion > 0 && expectedVersion != null && expectedVersion !== currentVersion) {
      throw new VersionConflictError(currentVersion);
    }

    await client.query('DELETE FROM vehicles');
    await client.query('DELETE FROM vehicle_brands');

    const brandOrder = data.brandOrder || [];
    const brandIdByName = {};
    for (let i = 0; i < brandOrder.length; i++) {
      const res = await client.query(
        'INSERT INTO vehicle_brands (name, sort_order) VALUES ($1, $2) RETURNING id',
        [brandOrder[i], i]
      );
      brandIdByName[brandOrder[i]] = res.rows[0].id;
    }

    for (const v of data.vehicles || []) {
      let brandId = brandIdByName[v.brand];
      if (brandId == null) {
        // 保護：車款引用了不在 brandOrder 內的廠牌時，補上該廠牌避免整批寫入失敗
        const res = await client.query(
          'INSERT INTO vehicle_brands (name, sort_order) VALUES ($1, $2) RETURNING id',
          [v.brand, brandOrder.length]
        );
        brandId = res.rows[0].id;
        brandIdByName[v.brand] = brandId;
        brandOrder.push(v.brand);
      }
      await client.query(
        'INSERT INTO vehicles (id, brand_id, model, length_text, category) VALUES ($1, $2, $3, $4, $5)',
        [v.id, brandId, v.model, v.length || null, v.cat]
      );
    }

    const newVersion = currentVersion + 1;
    const { updatedAt } = await bumpMeta(client, APP_KEY, newVersion, updatedBy);
    await snapshotHistory(client, APP_KEY, data, newVersion, updatedAt, updatedBy);
    return { version: newVersion, updatedAt };
  });
}

module.exports = { APP_KEY, getCatalog, replaceCatalog };
