const { pool, withTransaction } = require('../db');
const { getMeta, lockCurrentVersion, bumpMeta, snapshotHistory, VersionConflictError } = require('./historyMeta');

const APP_KEY = 'quote-settings';

function numOrNull(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isNaN(n) ? null : n;
}

// =========================================================
// 讀取：把正規化資料表組回前端 factoryDB() 的整包 JSON 形狀
// =========================================================
async function getSettings() {
  const meta = await getMeta(APP_KEY);
  if (!meta) return null;

  const sysRes = await pool.query('SELECT hourly_wage, parts_ratio_percent FROM qs_system_settings WHERE id=1');
  const hourlyWage = sysRes.rows[0] ? numOrNull(sysRes.rows[0].hourly_wage) : 220;
  const partsRatioPercent = sysRes.rows[0] ? numOrNull(sysRes.rows[0].parts_ratio_percent) : 70;

  const groupsRes = await pool.query('SELECT name, sort_order, usage_rhino, usage_color, hours FROM qs_vehicle_groups ORDER BY sort_order');
  const groupOrder = groupsRes.rows.map((r) => r.name);
  const usage = {};
  const hours = {};
  groupsRes.rows.forEach((r) => {
    usage[r.name] = { 犀牛皮類: numOrNull(r.usage_rhino), 改色膜類: numOrNull(r.usage_color) };
    hours[r.name] = numOrNull(r.hours);
  });

  const partsRes = await pool.query('SELECT name, sort_order, usage_m, hours, install_bonus FROM qs_parts ORDER BY sort_order NULLS LAST');
  const partOrder = partsRes.rows.filter((r) => r.sort_order != null).map((r) => r.name);
  const installBonus = {};
  const localParts = {};
  partsRes.rows.forEach((r) => {
    installBonus[r.name] = numOrNull(r.install_bonus);
    if (r.sort_order != null) {
      localParts[r.name] = { usage: numOrNull(r.usage_m), hours: numOrNull(r.hours) };
    }
  });

  const brandsRes = await pool.query('SELECT id, name FROM qs_brands ORDER BY sort_order');
  const brandOrder = brandsRes.rows.map((r) => r.name);
  const brandNameById = {};
  brandsRes.rows.forEach((r) => { brandNameById[r.id] = r.name; });

  const materialsRes = await pool.query('SELECT id, brand_id, category, name, piece_rate FROM qs_materials ORDER BY sort_order');
  const rollsRes = await pool.query('SELECT material_id, unit_m, cost FROM qs_material_rolls ORDER BY id');
  const priceRes = await pool.query(`
    SELECT wcp.material_id, g.name AS group_name, wcp.price
    FROM qs_whole_car_price wcp
    JOIN qs_vehicle_groups g ON g.id = wcp.group_id
  `);

  const rollsByMaterial = {};
  rollsRes.rows.forEach((r) => {
    (rollsByMaterial[r.material_id] ||= []).push({ unit: numOrNull(r.unit_m), cost: numOrNull(r.cost) });
  });
  const priceByMaterial = {};
  priceRes.rows.forEach((r) => {
    (priceByMaterial[r.material_id] ||= {})[r.group_name] = numOrNull(r.price);
  });

  const brands = {};
  brandOrder.forEach((bn) => {
    brands[bn] = { categories: { 犀牛皮類: { materialOrder: [], materials: {} }, 改色膜類: { materialOrder: [], materials: {} } } };
  });
  materialsRes.rows.forEach((m) => {
    const bn = brandNameById[m.brand_id];
    if (!bn || !brands[bn].categories[m.category]) return;
    const catObj = brands[bn].categories[m.category];
    catObj.materialOrder.push(m.name);
    const priceByGroup = {};
    groupOrder.forEach((g) => { priceByGroup[g] = (priceByMaterial[m.id] || {})[g] ?? null; });
    const matObj = { rolls: rollsByMaterial[m.id] || [], priceByGroup };
    if (m.category === '改色膜類') matObj.pieceRate = numOrNull(m.piece_rate);
    catObj.materials[m.name] = matObj;
  });

  const localPriceRes = await pool.query(`
    SELECT p.name AS part_name, b.name AS brand_name, lp.category, lp.price
    FROM qs_local_part_price lp
    JOIN qs_parts p ON p.id = lp.part_id
    JOIN qs_brands b ON b.id = lp.brand_id
  `);
  const localPrice = {};
  localPriceRes.rows.forEach((r) => {
    localPrice[r.part_name] = localPrice[r.part_name] || {};
    localPrice[r.part_name][r.brand_name] = localPrice[r.part_name][r.brand_name] || {};
    localPrice[r.part_name][r.brand_name][r.category] = numOrNull(r.price);
  });

  const rulesRes = await pool.query('SELECT id, mode, brand_id, name, rate, bonus_type, bonus_value FROM qs_discount_rules ORDER BY sort_order');
  const wholeDiscountRules = {};
  const localDiscountRules = {};
  rulesRes.rows.forEach((r) => {
    const bn = brandNameById[r.brand_id];
    if (!bn) return;
    const target = r.mode === 'whole' ? wholeDiscountRules : localDiscountRules;
    (target[bn] ||= []).push({ id: r.id, name: r.name, rate: numOrNull(r.rate), bonusType: r.bonus_type, bonusValue: numOrNull(r.bonus_value) });
  });

  const overridesRes = await pool.query('SELECT key, business_price, bonus FROM qs_overrides');
  const overrides = {};
  overridesRes.rows.forEach((r) => {
    overrides[r.key] = { businessPrice: numOrNull(r.business_price), bonus: numOrNull(r.bonus) };
  });

  const opCodesRes = await pool.query('SELECT scope, code, description FROM qs_op_codes');
  const specificPartsRes = await pool.query(`
    SELECT p.name FROM qs_op_code_specific_parts sp JOIN qs_parts p ON p.id = sp.part_id
  `);
  const opCodesByScope = {};
  opCodesRes.rows.forEach((r) => { opCodesByScope[r.scope] = { code: r.code || '', desc: r.description || '' }; });
  const opCodes = {
    wholeCar: opCodesByScope.wholeCar || { code: '', desc: '' },
    localSpecific: { ...(opCodesByScope.localSpecific || { code: '', desc: '' }), parts: specificPartsRes.rows.map((r) => r.name) },
    localOther: opCodesByScope.localOther || { code: '', desc: '' },
  };

  return {
    version: meta.version,
    updatedAt: meta.updated_at,
    updatedBy: meta.updated_by,
    data: {
      groupOrder,
      partOrder,
      installBonus,
      hourlyWage,
      partsRatioPercent,
      wholeCar: { usage, hours, discountRules: wholeDiscountRules },
      local: { parts: localParts, price: localPrice, discountRules: localDiscountRules },
      brandOrder,
      brands,
      overrides,
      opCodes,
    },
  };
}

// =========================================================
// 寫入：整包替換（交易內，子表先刪再依傳入資料重建）
// =========================================================
async function replaceSettings(data, updatedBy, expectedVersion) {
  return withTransaction(async (client) => {
    const currentVersion = await lockCurrentVersion(client, APP_KEY);
    if (currentVersion > 0 && expectedVersion != null && expectedVersion !== currentVersion) {
      throw new VersionConflictError(currentVersion);
    }

    await client.query('DELETE FROM qs_op_code_specific_parts');
    await client.query('DELETE FROM qs_op_codes');
    await client.query('DELETE FROM qs_local_part_price');
    await client.query('DELETE FROM qs_whole_car_price');
    await client.query('DELETE FROM qs_material_rolls');
    await client.query('DELETE FROM qs_materials');
    await client.query('DELETE FROM qs_discount_rules');
    await client.query('DELETE FROM qs_overrides');
    await client.query('DELETE FROM qs_parts');
    await client.query('DELETE FROM qs_brands');
    await client.query('DELETE FROM qs_vehicle_groups');

    await client.query(
      `INSERT INTO qs_system_settings (id, hourly_wage, parts_ratio_percent) VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE SET hourly_wage = $1, parts_ratio_percent = $2`,
      [data.hourlyWage ?? 220, data.partsRatioPercent ?? 70]
    );

    // 車型群組（全車使用米數依產品類別分開存；相容舊格式「單一數字」，套用到兩個類別）
    const groupOrder = data.groupOrder || [];
    const groupIdByName = {};
    for (let i = 0; i < groupOrder.length; i++) {
      const g = groupOrder[i];
      const u = data.wholeCar?.usage?.[g];
      const usageRhino = u != null && typeof u === 'object' ? u['犀牛皮類'] ?? null : u ?? null;
      const usageColor = u != null && typeof u === 'object' ? u['改色膜類'] ?? null : u ?? null;
      const res = await client.query(
        'INSERT INTO qs_vehicle_groups (name, sort_order, usage_rhino, usage_color, hours) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [g, i, usageRhino, usageColor, data.wholeCar?.hours?.[g] ?? null]
      );
      groupIdByName[g] = res.rows[0].id;
    }

    // 部位（partOrder 依序寫入；只出現在 installBonus 裡的特殊部位如「全車」sort_order 為 NULL）
    const partOrder = data.partOrder || [];
    const extraPartNames = new Set(Object.keys(data.installBonus || {}));
    partOrder.forEach((p) => extraPartNames.delete(p));
    const partIdByName = {};
    for (let i = 0; i < partOrder.length; i++) {
      const p = partOrder[i];
      const localPart = data.local?.parts?.[p] || {};
      const res = await client.query(
        'INSERT INTO qs_parts (name, sort_order, usage_m, hours, install_bonus) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [p, i, localPart.usage ?? null, localPart.hours ?? null, data.installBonus?.[p] ?? null]
      );
      partIdByName[p] = res.rows[0].id;
    }
    for (const p of extraPartNames) {
      const res = await client.query(
        'INSERT INTO qs_parts (name, sort_order, usage_m, hours, install_bonus) VALUES ($1,NULL,NULL,NULL,$2) RETURNING id',
        [p, data.installBonus?.[p] ?? null]
      );
      partIdByName[p] = res.rows[0].id;
    }

    // 廠商
    const brandOrder = data.brandOrder || [];
    const brandIdByName = {};
    for (let i = 0; i < brandOrder.length; i++) {
      const b = brandOrder[i];
      const res = await client.query('INSERT INTO qs_brands (name, sort_order) VALUES ($1,$2) RETURNING id', [b, i]);
      brandIdByName[b] = res.rows[0].id;
    }

    // 材質、捲成本、整台車售價
    for (const bn of brandOrder) {
      const brandObj = data.brands?.[bn];
      if (!brandObj) continue;
      for (const cat of Object.keys(brandObj.categories || {})) {
        const catObj = brandObj.categories[cat];
        const materialOrder = catObj.materialOrder || [];
        for (let i = 0; i < materialOrder.length; i++) {
          const mn = materialOrder[i];
          const m = catObj.materials[mn] || {};
          const res = await client.query(
            'INSERT INTO qs_materials (brand_id, category, name, piece_rate, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id',
            [brandIdByName[bn], cat, mn, m.pieceRate ?? null, i]
          );
          const materialId = res.rows[0].id;

          for (const roll of m.rolls || []) {
            await client.query('INSERT INTO qs_material_rolls (material_id, unit_m, cost) VALUES ($1,$2,$3)', [
              materialId,
              roll.unit ?? null,
              roll.cost ?? null,
            ]);
          }
          for (const g of groupOrder) {
            if (m.priceByGroup && g in m.priceByGroup) {
              await client.query('INSERT INTO qs_whole_car_price (material_id, group_id, price) VALUES ($1,$2,$3)', [
                materialId,
                groupIdByName[g],
                m.priceByGroup[g] ?? null,
              ]);
            }
          }
        }
      }
    }

    // 局部售價（部位 x 廠商 x 類別）
    for (const partName of Object.keys(data.local?.price || {})) {
      const partId = partIdByName[partName];
      if (partId == null) continue;
      const byBrand = data.local.price[partName] || {};
      for (const bn of Object.keys(byBrand)) {
        const brandId = brandIdByName[bn];
        if (brandId == null) continue;
        const byCat = byBrand[bn] || {};
        for (const cat of Object.keys(byCat)) {
          await client.query('INSERT INTO qs_local_part_price (part_id, brand_id, category, price) VALUES ($1,$2,$3,$4)', [
            partId,
            brandId,
            cat,
            byCat[cat] ?? null,
          ]);
        }
      }
    }

    // 折扣／業務獎金規則
    for (const mode of ['whole', 'local']) {
      const rulesByBrand = mode === 'whole' ? data.wholeCar?.discountRules || {} : data.local?.discountRules || {};
      for (const bn of Object.keys(rulesByBrand)) {
        const brandId = brandIdByName[bn];
        if (brandId == null) continue;
        const rules = rulesByBrand[bn] || [];
        for (let i = 0; i < rules.length; i++) {
          const r = rules[i];
          await client.query(
            `INSERT INTO qs_discount_rules (id, mode, brand_id, name, rate, bonus_type, bonus_value, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [r.id, mode, brandId, r.name, r.rate, r.bonusType, r.bonusValue, i]
          );
        }
      }
    }

    // 業務/接待覆寫值
    for (const key of Object.keys(data.overrides || {})) {
      const ov = data.overrides[key] || {};
      await client.query('INSERT INTO qs_overrides (key, business_price, bonus) VALUES ($1,$2,$3)', [
        key,
        ov.businessPrice ?? null,
        ov.bonus ?? null,
      ]);
    }

    // OP代碼設定
    if (data.opCodes) {
      const oc = data.opCodes;
      await client.query('INSERT INTO qs_op_codes (scope, code, description) VALUES ($1,$2,$3)', [
        'wholeCar',
        oc.wholeCar?.code ?? null,
        oc.wholeCar?.desc ?? null,
      ]);
      await client.query('INSERT INTO qs_op_codes (scope, code, description) VALUES ($1,$2,$3)', [
        'localSpecific',
        oc.localSpecific?.code ?? null,
        oc.localSpecific?.desc ?? null,
      ]);
      await client.query('INSERT INTO qs_op_codes (scope, code, description) VALUES ($1,$2,$3)', [
        'localOther',
        oc.localOther?.code ?? null,
        oc.localOther?.desc ?? null,
      ]);
      for (const partName of oc.localSpecific?.parts || []) {
        const partId = partIdByName[partName];
        if (partId != null) {
          await client.query('INSERT INTO qs_op_code_specific_parts (part_id) VALUES ($1) ON CONFLICT DO NOTHING', [partId]);
        }
      }
    }

    const newVersion = currentVersion + 1;
    const { updatedAt } = await bumpMeta(client, APP_KEY, newVersion, updatedBy);
    await snapshotHistory(client, APP_KEY, data, newVersion, updatedAt, updatedBy);
    return { version: newVersion, updatedAt };
  });
}

module.exports = { APP_KEY, getSettings, replaceSettings };
