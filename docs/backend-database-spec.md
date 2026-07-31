# 後台資料庫規劃規格書

車款大小查詢工具 / 犀牛皮貼膜報價系統 v14 — 後台資料庫建置規格

- 文件版本：v1.0
- 日期：2026-07-31
- 涵蓋工具：2 套獨立前端工具
- 現有儲存：`window.storage` / `localStorage`

## 1. 現況分析

兩套工具目前都是「完全獨立、單一 HTML 檔案」的前端應用，沒有任何後端伺服器或資料庫；所有設定資料都序列化成一份 JSON，存進瀏覽器端的儲存空間。

### 1.1 現有工具總覽

| 工具 | 儲存 Key | 資料內容 | 資料量體（目前） |
|---|---|---|---|
| 車款大小查詢工具 | `vehicle-size-lookup-db` | 廠牌排序 `brandOrder`、車款清單 `vehicles[]`（品牌/車款/車長/歸類） | 25 廠牌、189 筆車款 |
| 犀牛皮貼膜報價系統 v14 | `rhino-wrap-quote-db-v14` | 車型群組、部位清單、施工獎金、時薪、整台車與局部模式的售價/折扣規則、廠商材質成本（含捲料反推）、業務覆寫值 | 2 廠商 × 2 產品類別 × 多規格，欄位深度巢狀 |

### 1.2 現有儲存機制

兩個檔案的 `loadDB()` / `saveDB()` 邏輯完全相同的模式：優先呼叫執行環境提供的 `window.storage`，若不存在則退回瀏覽器 `localStorage`。

```js
// 兩份檔案共通的存取模式（簡化）
async function loadDB(){
  if(window.storage){ // 執行環境提供的 KV 儲存
    const res = await window.storage.get(STORAGE_KEY, false);
    if(res?.value){ DB = JSON.parse(res.value); return; }
  } else {
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){ DB = JSON.parse(raw); return; }
  }
  DB = factoryDB(); await saveDB(); // 出廠預設值
}
```

### 1.3 侷限與風險

- **綁定單一瀏覽器**：資料存在使用者當下的瀏覽器/裝置裡，換電腦、換瀏覽器、清除快取都會遺失，也無法在門市多台電腦間共用同一份車款或報價設定。
- **沒有備份與版本歷史**：一旦誤刪車款、改錯售價，沒有「上一版」可以復原。
- **無法多人協作**：老闆在電腦 A 調整折扣規則，店員在電腦 B 看到的仍是舊資料。
- **無存取控管**：目前任何開啟頁面的人都能直接修改成本、售價等敏感設定。
- **`TAX_RATE=0.05`（犀牛皮系統）為程式碼寫死值**，未來若稅率調整需要改程式碼而非改設定。

## 2. 目標與範圍

### 2.1 目標

- 新增一個集中式後台資料庫，取代 `window.storage`/`localStorage` 作為「唯一真實來源」（source of truth）。
- 兩套工具的設定資料可跨裝置、跨瀏覽器讀寫，門市多台電腦看到同一份資料。
- 具備備份、還原與操作歷史，降低誤刪誤改的風險。
- **維持現有前端 UI 與計算邏輯完全不變**——只抽換「儲存層」，不重寫畫面或商業邏輯，降低導入風險與開發成本。

### 2.2 範圍界定

**包含**
- 後台 API 與資料庫的設計與建置
- 兩套工具的 `loadDB`/`saveDB` 改接後端
- 離線快取、儲存狀態提示、失敗重試
- 既有 localStorage 資料一次性遷移到後端

**不包含**
- 不更動任何計算公式（材料成本反推、毛利計算等）
- 不更動畫面版型、配色、互動流程
- 「局部貼膜」「鈑烤估價」的暫存工單（本來就設計成不留底）維持前端暫存，不落地資料庫

## 3. 需求規格

### 3.1 功能需求

| 編號 | 需求 | 說明 | 優先級 |
|---|---|---|---|
| F1 | 集中儲存 | 兩套工具的設定資料存放於後端資料庫，而非瀏覽器 | 必要 |
| F2 | 跨裝置同步 | 任一裝置修改後，其他裝置重新整理即可看到最新資料 | 必要 |
| F3 | 備份/還原 | 定期備份，可還原到指定時間點 | 必要 |
| F4 | 操作歷史 | 記錄「誰、何時、改了什麼」，至少保留最近 N 筆 | 建議 |
| F5 | 存取控管 | 簡易 API Key 或帳號登入，避免任意人修改成本／售價 | 建議 |
| F6 | 離線容錯 | 後端暫時無法連線時，前端仍可用最後一次快取的資料繼續查詢／估價 | 必要 |
| F7 | 一次性資料遷移 | 將目前已存在瀏覽器裡的資料匯出，匯入後端作為初始值 | 必要 |

### 3.2 非功能需求

| 面向 | 要求 |
|---|---|
| 效能 | 單次讀取／寫入 < 300ms（門市內網或近端伺服器情境） |
| 可用性 | 後端離線時前端不可白屏，需優雅降級為唯讀快取 |
| 安全性 | 全程 HTTPS；寫入操作需驗證身份 |
| 可維護性 | Phase 1 上線後，Phase 2 演進不應要求前端大改 |
| 相容性 | 不影響現有列印/PDF（`window.print()`）流程 |

## 4. 系統架構總覽

維持「前端不變」原則，新增一層薄薄的 API 服務與資料庫，兩套工具共用同一個後端，但各自的資料以獨立 Key／資料表隔離，互不影響（延續兩套工具目前「彼此無關」的設計）。

```
前端（不變）              API 服務（新增）           資料庫（新增）
車款查詢工具・報價系統v14  →  REST API：讀取/寫入設定   →  Phase1：KV JSON 儲存
單一 HTML/JS，瀏覽器執行     身份驗證・操作紀錄            Phase2：正規化關聯表
```

前端仍保留 `localStorage` 作為「最後一次成功讀取」的離線快取，API 連線失敗時自動退回快取並顯示提示，而不是空白畫面。

## 5. 資料庫方案設計

### 5.1 方案比較

**方案 A — 輕量 Key-Value 儲存**：1:1 對應現有 `window.storage.get/set(key, value)` 介面，整份 DB 仍是一個 JSON 欄位。前端幾乎不用改資料結構，只是把儲存目的地換成 API。
- 優點：開發最快、風險最低、與現有程式碼相容度最高。
- 缺點：無法在資料庫層做欄位級查詢／報表（例如「哪些車款屬於大車」需先整包撈出再用程式篩選）。

**方案 B — 正規化關聯式資料庫**：把 JSON 拆解成車款、廠牌、材質、售價、折扣規則等資料表，符合傳統「資料庫」的樣貌，利於未來報表、多人協作編輯、欄位級歷史紀錄。
- 優點：可查詢、可擴充、適合長期成長。
- 缺點：前端需要改寫資料存取層（把「整包讀寫」改成「多支 API 組合」），工程量較大。

**建議**：採漸進式路線，先上線方案 A 取得「集中儲存＋跨裝置」的立即效益；待實際使用需求明朗（例如真的需要報表或多人同時編輯不同廠牌）再演進到方案 B。

### 5.2 方案 A：Key-Value 儲存 Schema

| 欄位 | 型別 | 說明 |
|---|---|---|
| id | INTEGER/UUID | 主鍵 |
| app_key | TEXT | 對應各工具的 `STORAGE_KEY`，如 `vehicle-size-lookup-db`、`rhino-wrap-quote-db-v14` |
| data | JSON/TEXT | 整份 DB 物件序列化後的 JSON 字串（結構與現在 `factoryDB()`/`factoryVehicleDB()` 產出完全一致） |
| version | INTEGER | 每次寫入遞增，供樂觀鎖與歷史比對 |
| updated_at | TIMESTAMP | 最後更新時間 |
| updated_by | TEXT | 操作者（帳號或裝置識別，若採 F5 存取控管） |

```sql
-- app_key 唯一，一個工具對應一列
CREATE TABLE settings_store (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  app_key     TEXT UNIQUE NOT NULL,
  data        TEXT NOT NULL,        -- JSON
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);

CREATE TABLE settings_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  app_key     TEXT NOT NULL,
  data        TEXT NOT NULL,
  version     INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  created_by  TEXT
);
```

### 5.3 方案 B：正規化 Schema

**5.3.1 車款大小查詢工具**

| 資料表 | 欄位 | 說明 |
|---|---|---|
| brands | `id`, `name`, `sort_order` | 對應目前 `brandOrder[]` |
| vehicles | `id`, `brand_id`, `model`, `length_text`, `category` | 對應目前 `vehicles[]`；`category` 為 小車/一般車/大車/商用車 |

**5.3.2 犀牛皮貼膜報價系統 v14**

| 資料表 | 欄位 | 對應現有結構 |
|---|---|---|
| system_settings | `hourly_wage`, `tax_rate` | `DB.hourlyWage`；`TAX_RATE` 由寫死常數改為可設定欄位 |
| vehicle_groups | `id`, `name`, `sort_order`, `usage_m`, `hours` | `DB.groupOrder` + `DB.wholeCar.usage/hours` |
| parts | `id`, `name`, `sort_order`, `usage_m`, `hours`, `install_bonus` | `DB.partOrder` + `DB.local.parts` + `DB.installBonus`（含「全車」列） |
| brands | `id`, `name`, `sort_order` | `DB.brandOrder` |
| materials | `id`, `brand_id`, `category`, `name`, `piece_rate`, `sort_order` | `materialOrder` + `materials{}`（`category`＝犀牛皮類/改色膜類） |
| material_rolls | `id`, `material_id`, `unit_m`, `cost` | `material.rolls[]` |
| whole_car_price | `material_id`, `group_id`, `price` | `material.priceByGroup{}` |
| local_part_price | `part_id`, `brand_id`, `category`, `price` | `DB.local.price{}` |
| discount_rules | `id`, `mode`, `brand_id`, `name`, `rate`, `bonus_type`, `bonus_value`, `sort_order` | `DB.wholeCar.discountRules`/`DB.local.discountRules`（`mode`＝whole/local） |
| overrides | `key`, `business_price`, `bonus` | `DB.overrides{}`（僅整台車報價使用） |

局部貼膜與鈑烤估價頁面的「工單列」（`localState.rows`/`bodyshopState.rows`）本來就是暫存、離開頁面即清空的設計，**不建議落地資料庫**，維持現況即可，除非未來要新增「報價紀錄查詢」需求。

## 6. API 規格

### 6.1 認證方式（建議）

門市內部工具，建議先採最簡單的共用 API Key（放在 request header），待有多人權限分級需求再升級為帳號登入：

```
Header: X-Api-Key: <secret>
```

### 6.2 Endpoint 一覽（對應方案 A，Phase 1）

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/store/:appKey` | 取得整份設定 JSON（對應 `loadDB()`） |
| PUT | `/api/store/:appKey` | 覆蓋整份設定 JSON（對應 `saveDB()`），需帶 `version` 做樂觀鎖 |
| GET | `/api/store/:appKey/history` | 列出最近 N 筆歷史版本（摘要） |
| POST | `/api/store/:appKey/restore/:version` | 還原到指定歷史版本 |

### 6.3 範例

`GET /api/store/vehicle-size-lookup-db`

```json
{
  "appKey": "vehicle-size-lookup-db",
  "version": 12,
  "updatedAt": "2026-07-31T02:10:00Z",
  "data": {
    "brandOrder": ["Toyota", "Lexus", "..."],
    "vehicles": [
      { "id": "v1", "brand": "Toyota", "model": "Yaris Cross", "length": "4.3米", "cat": "小車" }
    ]
  }
}
```

`PUT /api/store/vehicle-size-lookup-db`

```json
{
  "expectedVersion": 12,
  "data": { "brandOrder": [ "..." ], "vehicles": [ "..." ] }
}
// 回應 409 若 expectedVersion 與伺服器目前版本不符（代表被別的裝置改過）
```

## 7. 前端整合計畫

### 7.1 改動範圍

兩份檔案只需要改 `loadDB()` 與 `saveDB()` 兩個函式（車款工具約在第 147–165 行；報價系統 v14 約在第 333–351 行），其餘畫面、狀態、計算邏輯完全不動。

```js
// 修改後示意（兩份檔案共通）
const API_BASE = "https://your-backend.example.com/api";
const APP_KEY  = "vehicle-size-lookup-db"; // 依檔案而定
let dbVersion = null;

async function loadDB(){
  try{
    const res = await fetch(`${API_BASE}/store/${APP_KEY}`, { headers:{ 'X-Api-Key': API_KEY } });
    if(res.ok){
      const json = await res.json();
      DB = json.data; dbVersion = json.version;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DB)); // 更新離線快取
      return;
    }
  }catch(e){ /* 連線失敗，往下退回快取 */ }
  const raw = localStorage.getItem(STORAGE_KEY);
  DB = raw ? JSON.parse(raw) : factoryDB();
  toast('⚠ 無法連線到後端，目前使用離線快取資料');
}

async function saveDB(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(DB)); // 先寫本地，確保不遺失
  try{
    const res = await fetch(`${API_BASE}/store/${APP_KEY}`, {
      method:'PUT', headers:{ 'Content-Type':'application/json', 'X-Api-Key': API_KEY },
      body: JSON.stringify({ expectedVersion: dbVersion, data: DB })
    });
    if(res.status===409){ toast('⚠ 資料已被其他裝置更新，請重新整理'); return; }
    const json = await res.json(); dbVersion = json.version;
  }catch(e){ toast('⚠ 儲存失敗，已存於本機，恢復連線後會重試'); }
}
```

### 7.2 離線與容錯策略

- **本機快取優先寫入**：每次 `saveDB()` 一律先寫 `localStorage`，API 失敗也不會遺失剛才的操作。
- **樂觀鎖提示**：偵測到 `409`（版本衝突）時提示使用者重新整理，避免覆蓋別人剛存的資料。
- **儲存狀態指示**：畫面角落可加一個小型狀態列，如「已同步 · 02:14」／「離線快取中」，沿用既有 `toast()` 機制即可。
- **失敗重試**：可加入簡單的背景重試（例如每 30 秒嘗試把待同步的變更補送一次）。

## 8. 資料遷移計畫

上線當下，門市電腦的瀏覽器裡可能已經累積了實際使用中的車款清單／售價設定，需要一次性搬到後端，避免「上線等於資料歸零」。

1. 在兩套工具的「系統設定」頁暫時加一顆「匯出目前資料」按鈕，把 `JSON.stringify(DB)` 存成檔案下載。
2. 後端提供一支一次性 `POST /api/store/:appKey/import`，直接把匯出的 JSON 寫入資料庫作為初始版本（`version=1`）。
3. 確認資料一致後，將前端的 `API_BASE` 指向正式後端，正式切換。
4. 保留一份遷移前的 `localStorage` 匯出檔備查，直到確認新流程穩定運作至少一週。

## 9. 安全與備份

| 項目 | 建議做法 |
|---|---|
| 傳輸安全 | 全程 HTTPS，Cloudflare／反向代理提供憑證 |
| 寫入驗證 | API Key（起步）→ 帳號登入＋角色權限（成長期，例如「業務」唯讀、「店長」可改成本） |
| 備份頻率 | 資料量小，建議每次寫入即寫入 `settings_history`，另加每日排程備份整個資料庫檔案 |
| 還原機制 | `POST /restore/:version`，介面上在系統設定頁提供「歷史版本」列表可一鍵還原 |
| 操作紀錄 | `updated_by` 記錄裝置代號或帳號，異常變動可追查 |

## 10. 部署方案建議

| 方案 | 技術組合 | 適合情境 |
|---|---|---|
| **建議起步** | Node.js + Express + SQLite（單檔資料庫），部署於一台小型 VPS 或門市內網主機 | 單店／小規模使用，設定簡單、免額外月費、備份就是複製一個檔案 |
| Serverless | Cloudflare Workers + D1/KV | 不想維運伺服器、未來多分店可全球低延遲存取 |
| BaaS | Supabase／Firebase（內建資料庫＋驗證＋即時同步） | 想減少後端開發工作量，直接用現成 SDK 取代 6.2 節自建 API |

以目前規模（單店、兩套工具、資料量小）評估，**Node.js + Express + SQLite** 最符合「花最少力氣拿到最大效益」；若未來展店或需要多人同時在線編輯，再評估遷移到 Serverless 或 BaaS。

## 11. 導入時程規劃

| 階段 | 工作項目 | 預估工時 |
|---|---|---|
| Phase 1a | 後端 API＋方案 A（KV）資料庫建置、API Key 驗證 | 2–3 天 |
| Phase 1b | 兩套工具 `loadDB`/`saveDB` 改接 API＋離線容錯 | 1–2 天 |
| Phase 1c | 資料遷移（匯出／匯入既有瀏覽器資料）＋上線切換 | 0.5 天 |
| Phase 1d | 備份排程、歷史版本還原介面 | 1 天 |
| Phase 2（視需求） | 演進為正規化關聯式資料庫（方案 B） | 依實際需求另估 |

## 12. 風險與應對

| 風險 | 應對方式 |
|---|---|
| 高：上線瞬間資料遺失或不一致 | 第 8 節遷移流程先在測試環境驗證，正式切換前保留完整匯出備份 |
| 中：後端故障導致無法報價 | 7.2 節離線容錯：連線失敗自動退回本機快取，不影響現場作業 |
| 中：多裝置同時修改互相覆蓋 | 6.3 節樂觀鎖（`expectedVersion`）＋ 409 衝突提示 |
| 低：API Key 外洩 | Key 僅存於內部裝置，之後升級帳號登入時汰換 |

## 13. 待確認事項

開工前建議先跟您確認以下幾點，會直接影響方案 A/B 的選擇與部署方式：

1. 後端要架在哪裡？自有主機／VPS、或希望完全不用自己維運伺服器（傾向 Serverless／BaaS）？
2. 是否只有單一門市使用，還是未來會有多分店、需要各分店資料是否要分開？
3. 是否需要區分「誰能改成本／售價」「誰只能查詢」的權限，或目前門市內部互信、不需要分權限？
4. 是否需要一開始就採用方案 B（正規化資料庫），還是接受先上方案 A 快速上線？
