-- 後台設定資料庫 — 方案 B：正規化 Schema（PostgreSQL）
-- 對應 docs/backend-database-spec.md 第 5.3 節

-- =========================================================
-- 共用：使用者、版本中繼資料、歷史快照
-- =========================================================
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','staff')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 每個「整份設定」資源（app_key）目前版本；用於樂觀鎖與跨裝置偵測衝突
CREATE TABLE IF NOT EXISTS settings_meta (
  app_key    TEXT PRIMARY KEY,
  version    INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by TEXT
);

-- 每次寫入都留一份整包快照，供備份／還原（不是唯一資料來源，正規化資料表才是）
CREATE TABLE IF NOT EXISTS settings_history (
  id         SERIAL PRIMARY KEY,
  app_key    TEXT NOT NULL,
  data       JSONB NOT NULL,
  version    INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_history_app_key ON settings_history(app_key, version DESC);

-- =========================================================
-- 車款大小查詢工具（app_key = 'vehicle-catalog'）
-- =========================================================
CREATE TABLE IF NOT EXISTS vehicle_brands (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicles (
  id          TEXT PRIMARY KEY,
  brand_id    INTEGER NOT NULL REFERENCES vehicle_brands(id) ON DELETE CASCADE,
  model       TEXT NOT NULL,
  length_text TEXT,
  category    TEXT NOT NULL CHECK (category IN ('小車','一般車','大車','商用車'))
);
CREATE INDEX IF NOT EXISTS idx_vehicles_brand ON vehicles(brand_id);

-- =========================================================
-- 犀牛皮貼膜報價系統 v14（app_key = 'quote-settings'）
-- =========================================================
CREATE TABLE IF NOT EXISTS qs_system_settings (
  id                  INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  hourly_wage         NUMERIC NOT NULL DEFAULT 220,
  tax_rate            NUMERIC NOT NULL DEFAULT 0.05,
  parts_ratio_percent NUMERIC NOT NULL DEFAULT 70, -- 內部資訊「零件／工資拆分」，零件佔比(%)，工資=100-此值
  biz_quote_seq       JSONB NOT NULL DEFAULT '{}' -- 對業務版報價編號：{"YYYYMMDD": 當日已用序號}，跨裝置共用同一份累加序號
);
-- CREATE TABLE IF NOT EXISTS 對已存在的資料庫是no-op，不會補上新欄位；
-- 已部署過的環境要補這個新欄位，需要 ALTER TABLE（新環境第一次跑 migrate 不受影響，這行也是安全的no-op）
ALTER TABLE qs_system_settings ADD COLUMN IF NOT EXISTS biz_quote_seq JSONB NOT NULL DEFAULT '{}';

-- 全車使用米數依產品類別分別存（v16 起：犀牛皮類／改色膜類可以不同值）；工時仍是不分類別的單一值
CREATE TABLE IF NOT EXISTS qs_vehicle_groups (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  sort_order   INTEGER NOT NULL,
  usage_rhino  NUMERIC,  -- 犀牛皮類 全車使用米數
  usage_color  NUMERIC,  -- 改色膜類 全車使用米數
  hours        NUMERIC
);

-- 部位清單；"全車"（整台車模式專用）也存在這張表，sort_order 為 NULL 代表不列入局部部位清單
CREATE TABLE IF NOT EXISTS qs_parts (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  sort_order    INTEGER,
  usage_m       NUMERIC,
  hours         NUMERIC,
  install_bonus NUMERIC
);

CREATE TABLE IF NOT EXISTS qs_brands (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS qs_materials (
  id         SERIAL PRIMARY KEY,
  brand_id   INTEGER NOT NULL REFERENCES qs_brands(id) ON DELETE CASCADE,
  category   TEXT NOT NULL CHECK (category IN ('犀牛皮類','改色膜類')),
  name       TEXT NOT NULL,
  piece_rate NUMERIC,
  sort_order INTEGER NOT NULL,
  UNIQUE (brand_id, category, name)
);

CREATE TABLE IF NOT EXISTS qs_material_rolls (
  id          SERIAL PRIMARY KEY,
  material_id INTEGER NOT NULL REFERENCES qs_materials(id) ON DELETE CASCADE,
  unit_m      NUMERIC,
  cost        NUMERIC
);
CREATE INDEX IF NOT EXISTS idx_rolls_material ON qs_material_rolls(material_id);

CREATE TABLE IF NOT EXISTS qs_whole_car_price (
  material_id INTEGER NOT NULL REFERENCES qs_materials(id) ON DELETE CASCADE,
  group_id    INTEGER NOT NULL REFERENCES qs_vehicle_groups(id) ON DELETE CASCADE,
  price       NUMERIC,
  PRIMARY KEY (material_id, group_id)
);

CREATE TABLE IF NOT EXISTS qs_local_part_price (
  part_id  INTEGER NOT NULL REFERENCES qs_parts(id) ON DELETE CASCADE,
  brand_id INTEGER NOT NULL REFERENCES qs_brands(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('犀牛皮類','改色膜類')),
  price    NUMERIC,
  PRIMARY KEY (part_id, brand_id, category)
);

-- id 是前端產生的字串，只在「同一 mode + 同一廠商」的清單裡保證唯一（不同廠商可能巧合出現相同 id），
-- 所以主鍵用 (mode, brand_id, id) 複合鍵，不用單一 id 全域唯一。
CREATE TABLE IF NOT EXISTS qs_discount_rules (
  id          TEXT NOT NULL,
  mode        TEXT NOT NULL CHECK (mode IN ('whole','local')),
  brand_id    INTEGER NOT NULL REFERENCES qs_brands(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  rate        NUMERIC NOT NULL,
  bonus_type  TEXT NOT NULL CHECK (bonus_type IN ('fixed','percent')),
  bonus_value NUMERIC NOT NULL,
  sort_order  INTEGER NOT NULL,
  PRIMARY KEY (mode, brand_id, id)
);
CREATE INDEX IF NOT EXISTS idx_rules_mode_brand ON qs_discount_rules(mode, brand_id, sort_order);

CREATE TABLE IF NOT EXISTS qs_overrides (
  key            TEXT PRIMARY KEY,
  business_price NUMERIC,
  bonus          NUMERIC
);

-- OP代碼設定（v16 新增）：報價輸出時自動組出施工說明文字用的三組代碼
CREATE TABLE IF NOT EXISTS qs_op_codes (
  scope       TEXT PRIMARY KEY CHECK (scope IN ('wholeCar','localSpecific','localOther')),
  code        TEXT,
  description TEXT
);

-- "局部貼膜－指定部位用" OP代碼適用的部位清單
CREATE TABLE IF NOT EXISTS qs_op_code_specific_parts (
  part_id INTEGER PRIMARY KEY REFERENCES qs_parts(id) ON DELETE CASCADE
);
