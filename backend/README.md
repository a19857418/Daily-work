# 後台設定資料庫 API（方案 B）

依照 [`docs/backend-database-spec.md`](../docs/backend-database-spec.md) 方案 B（正規化關聯式資料庫）實作，使用 **PostgreSQL**，帳號採 **JWT 登入 + 角色權限**（`admin` 可讀寫、`staff` 唯讀），可部署到 **GCP Cloud Run + Cloud SQL**（見 [`../deploy/gcp-deploy.md`](../deploy/gcp-deploy.md)）。

供 `frontend/vehicle-lookup.html` 與 `frontend/quote-system-v14.html` 兩套工具集中存放設定資料。

## 本機開發

需要一個可連線的 PostgreSQL（本機安裝、Docker、或 Cloud SQL 皆可）。

```bash
cd backend
npm install
cp .env.example .env        # 編輯 .env，至少要改 JWT_SECRET 與 DATABASE_URL
npm run migrate             # 建立資料表（可重複執行，不會清空既有資料）
npm run create-user -- boss    yourpassword admin   # 建立第一個管理者帳號
npm run create-user -- sales   yourpassword staff    # 視需要建立唯讀帳號
npm start                   # 預設監聽 http://localhost:4000
```

## 環境變數（`.env`）

| 變數 | 說明 |
|---|---|
| `PORT` | API 監聽的埠號（預設 4000） |
| `JWT_SECRET` | JWT 簽章密鑰，**務必修改**，可用 `openssl rand -base64 48` 產生 |
| `TOKEN_TTL` | 登入憑證有效期限（預設 `12h`） |
| `ALLOWED_ORIGIN` | 允許跨網域呼叫的來源，逗號分隔；內部使用可先留 `*` |
| `DATABASE_URL` | 完整連線字串（本機開發最簡單） |
| `INSTANCE_UNIX_SOCKET` / `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | 部署到 Cloud Run 時的替代連線方式，見 `.env.example` 註解 |

## 帳號與權限

只有兩種角色：

- **admin**：可讀寫所有設定資料、還原歷史版本、匯入資料
- **staff**：可讀取所有設定資料（查詢車款、報價計算都正常），但無法寫入 / 還原 / 匯入——嘗試寫入會收到 `403`

帳號管理沒有做管理介面，用 CLI 建立/更新：

```bash
npm run create-user -- <username> <password> <admin|staff>
```

## API

先呼叫 `POST /api/auth/login` 取得 JWT，之後所有請求都帶 `Authorization: Bearer <token>`。

| 方法 | 路徑 | 權限 | 說明 |
|---|---|---|---|
| GET | `/api/health` | 公開 | 健康檢查 |
| POST | `/api/auth/login` | 公開 | `{username, password}` → `{token, username, role}` |
| GET | `/api/vehicle-catalog` | 已登入 | 取得車款查詢工具整包資料；尚無資料回傳 `404` |
| PUT | `/api/vehicle-catalog` | **admin** | 覆蓋整包資料，body：`{ expectedVersion, data }`；版本衝突回傳 `409` |
| GET | `/api/vehicle-catalog/history?limit=20` | 已登入 | 最近 N 筆版本摘要 |
| POST | `/api/vehicle-catalog/restore/:version` | **admin** | 還原到指定版本 |
| POST | `/api/vehicle-catalog/import` | **admin** | 一次性匯入（略過樂觀鎖） |
| GET／PUT／history／restore／import | `/api/quote-settings...` | 同上 | 犀牛皮貼膜報價系統 v14 的整包設定，路徑規則相同 |

底層資料已正規化到 PostgreSQL 資料表（見 `sql/schema.sql`：`vehicle_brands`/`vehicles`、`qs_brands`/`qs_materials`/`qs_material_rolls`/`qs_whole_car_price`/`qs_local_part_price`/`qs_discount_rules`/`qs_parts`/`qs_vehicle_groups`/`qs_overrides`/`qs_system_settings` 等），API 對前端仍呈現「整包 JSON 讀寫」的形狀，讓兩套前端工具維持原本簡單的 `loadDB()`/`saveDB()` 心智模型；每次寫入同時會在 `settings_history` 留一份快照供備份／還原。

## 部署到 GCP

見 [`../deploy/gcp-deploy.md`](../deploy/gcp-deploy.md)：Cloud SQL for PostgreSQL + Cloud Run，透過 Secret Manager 管理 `JWT_SECRET`／資料庫密碼。
