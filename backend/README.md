# 後台設定資料庫 API（方案 B）

依照 [`docs/backend-database-spec.md`](../docs/backend-database-spec.md) 方案 B（正規化關聯式資料庫）實作，使用 **PostgreSQL**，已部署在 **GCP Cloud Run + Cloud SQL**（正式環境唯一基準見 [`../docs/gcp-deploy.md`](../docs/gcp-deploy.md)）。

前端 `public/index.html`（單一入口 html，內含常用系統首頁、貼膜報價系統、車型查詢小模組）跟這個 API **部署在同一個 Cloud Run service**（`express.static` 直接服務這個資料夾，見 `src/server.js`），同源共用設定資料。車型查詢小模組已接後端（`/api/vehicle-catalog`），資料存在 `vehicle_brands`/`vehicles` 資料表，跟貼膜報價系統的設定資料互不影響。

## 存取模式：查詢公開、設定要密碼

初期採「單純化」設計：

- **查詢／報價完全公開**——任何拿到連結的人都能直接打開使用，不需要登入。
- **只有「寫入」（新增/編輯/刪除車款、系統設定裡的成本售價/折扣規則等）需要密碼**：前端點下「系統設定」或編輯功能時會跳出密碼框，輸入正確密碼後才解鎖；密碼錯誤或沒輸入一律無法寫入。
- 密碼共用一組即可（`backend/scripts/create-user.js` 建立的帳號，密碼比對時不需輸入帳號名稱，只要密碼對得上任一 admin 帳號就會解鎖）。

## 本機開發

需要一個可連線的 PostgreSQL（本機安裝、Docker、或 Cloud SQL 皆可）。

```bash
cd backend
npm install
cp .env.example .env        # 編輯 .env，至少要改 JWT_SECRET 與 DATABASE_URL
npm run migrate             # 建立資料表（可重複執行，不會清空既有資料）
npm run create-user -- admin 你想要的密碼 admin   # 建立系統設定密碼
npm start                   # 預設監聽 http://localhost:4000
```

啟動後瀏覽器打開 `http://localhost:4000/` 就會看到前端（`public/index.html`），前後端同源，`API_BASE = "/api"` 相對路徑會自動生效。**不要**直接雙擊 `public/index.html` 用 `file://` 開啟測試——相對路徑在 `file://` 底下解析不到。

## 環境變數（`.env`）

| 變數 | 說明 |
|---|---|
| `PORT` | API 監聽的埠號（預設 4000） |
| `JWT_SECRET` | 憑證簽章密鑰，**務必修改**，可用 `openssl rand -base64 48` 產生 |
| `TOKEN_TTL` | 解鎖後的憑證有效期限（預設 `12h`） |
| `ALLOWED_ORIGIN` | 允許跨網域呼叫的來源，逗號分隔；內部使用可先留 `*` |
| `DATABASE_URL` | 完整連線字串（本機開發最簡單） |
| `INSTANCE_UNIX_SOCKET` / `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | 部署到 Cloud Run 時的替代連線方式，見 `.env.example` 註解 |

## 密碼管理

沒有做管理介面，用 CLI 建立/更新：

```bash
npm run create-user -- <帳號名稱，隨意> <密碼> admin
```

帳號名稱只是資料庫內部欄位，前端「解鎖」畫面只會問密碼，不會問帳號。若要日後演進成多人多密碼、分不同權限層級，`role` 欄位已支援 `staff`（唯讀）角色，只是目前前端沒有對應的登入介面——先留著方便未來擴充。

## API

| 方法 | 路徑 | 權限 | 說明 |
|---|---|---|---|
| GET | `/api/health` | 公開 | 健康檢查 |
| POST | `/api/auth/unlock-settings` | 公開 | `{password}` → `{token, username, role}`；前端目前使用這一支解鎖 |
| POST | `/api/auth/login` | 公開 | `{username, password}` → 同上，保留給未來需要區分多帳號時使用 |
| GET | `/api/vehicle-catalog` | **公開** | 取得車款查詢工具整包資料；尚無資料回傳 `404` |
| PUT | `/api/vehicle-catalog` | 需帶解鎖後的 token | 覆蓋整包資料，body：`{ expectedVersion, data }`；版本衝突回傳 `409` |
| GET | `/api/vehicle-catalog/history?limit=20` | **公開** | 最近 N 筆版本摘要 |
| POST | `/api/vehicle-catalog/restore/:version` | 需帶解鎖後的 token | 還原到指定版本 |
| POST | `/api/vehicle-catalog/import` | 需帶解鎖後的 token | 一次性匯入（略過樂觀鎖） |
| GET／PUT／history／restore／import | `/api/quote-settings...` | 同上 | 犀牛皮貼膜報價系統 v14 的整包設定，路徑規則相同 |

底層資料已正規化到 PostgreSQL 資料表（見 `sql/schema.sql`：`vehicle_brands`/`vehicles`、`qs_brands`/`qs_materials`/`qs_material_rolls`/`qs_whole_car_price`/`qs_local_part_price`/`qs_discount_rules`/`qs_parts`/`qs_vehicle_groups`/`qs_overrides`/`qs_system_settings`（含 `parts_ratio_percent` 零件/工資拆分比例）/`qs_op_codes`/`qs_op_code_specific_parts` 等），API 對前端仍呈現「整包 JSON 讀寫」的形狀，讓前端維持原本簡單的 `loadDB()`/`saveDB()` 心智模型；每次寫入同時會在 `settings_history` 留一份快照供備份／還原。

> `public/index.html` 目前包含：全車使用米數依產品類別（犀牛皮類／改色膜類）分開儲存（`qs_vehicle_groups.usage_rhino`/`usage_color`）、OP代碼設定（`qs_op_codes`/`qs_op_code_specific_parts`）、零件/工資拆分比例（`qs_system_settings.parts_ratio_percent`）、對業務版報價編號（`qs_system_settings.biz_quote_seq`）。之後若在這份檔案上繼續加新欄位，記得同步更新 `sql/schema.sql`（新表用 `CREATE TABLE IF NOT EXISTS`、既有表新欄位另外加 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`，見 `docs/gcp-deploy.md`「Schema 異動規則」）與 `src/repositories/quoteSettings.js` 的組裝/拆解邏輯，否則新欄位不會被存進資料庫。

## 部署到 GCP

正式環境已經建立並在運作中，唯一基準見 [`../docs/gcp-deploy.md`](../docs/gcp-deploy.md)：資源清單、標準版更流程、Schema 異動規則。**版更時不得重建 Cloud SQL、Secret Manager 或 Service Account**，只需要 `gcloud run deploy body-craft-management-system --source .`。
