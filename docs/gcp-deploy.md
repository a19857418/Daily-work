# GCP 正式環境部署基準（車體工藝中心系統 / Body Craft Management System）

> **這份文件是後續所有 Claude session 與人工部署的唯一基準。**
> 舊文件 `deploy/gcp-deploy.md` 已停用（內容是「首次建立全新環境」用的範例資源名稱，跟下面實際正式環境的資源名稱不同，繼續使用會建立出重複/衝突的資源）。

## 核心原則：這是既有正式系統的版更，不是首次建立環境

從現在起，任何一次程式碼異動，最終目的都是讓下面這行指令能正確更新「既有」的 Cloud Run service：

```bash
cd backend
gcloud run deploy body-craft-management-system \
  --project=ammanage \
  --region=asia-east1 \
  --source .
```

**這行指令只會建置新版映像檔、換掉 Cloud Run service 現在跑的程式碼，不會動到下面任何一項：**

- ❌ 不得重建 Cloud SQL Instance
- ❌ 不得重建 PostgreSQL Database
- ❌ 不得重建 Secret Manager Secret
- ❌ 不得重建 Runtime Service Account
- ❌ 不得重新建立 Admin（系統設定密碼）
- ❌ 不得清除既有正式資料、不得覆蓋既有資料庫內容
- ⚠️ 若 DB schema 有異動，一律用「安全 migration」（見下方「Schema 異動規則」），不得下 destructive migration（例如 `DROP COLUMN`、改型別導致資料流失、`TRUNCATE` 等）
- ⚠️ 新增 table / column / index 時，要同步確認 repository 組裝邏輯（`backend/src/repositories/*.js`）跟前端使用到的欄位名稱都對得起來，避免新增的欄位悄悄地讀不到/存不進去

## 正式環境資源清單

| 項目 | 值 |
|---|---|
| GCP Project | `ammanage` |
| Region | `asia-east1` |
| Cloud Run Service | `body-craft-management-system` |
| 正式網址 | `https://body-craft-management-system-208869870497.asia-east1.run.app/` |
| Cloud SQL Instance | `body-craft-management-system-db` |
| PostgreSQL Database | `body_craft_management_system` |
| DB User | `app_user` |
| Runtime Service Account | `body-craft-management-system@ammanage.iam.gserviceaccount.com` |
| Secret（DB 密碼） | `body-craft-management-system-db-password` |
| Secret（JWT） | `body-craft-management-system-jwt-secret` |

> 這裡只記錄 Secret **名稱**，不記錄實際密碼、JWT Secret、Admin 密碼、Service Account Key 或任何其他敏感憑證。這些值只存在 Secret Manager 跟資料庫本身，不應該出現在 git 歷史、程式碼、或任何文件裡。

## 系統架構

```text
Cloud Run（body-craft-management-system）
├─ 前端（Express 靜態檔案）
│  └─ backend/public/index.html
│
└─ Node.js / Express API
   └─ /api/*
        │
        ▼
Cloud SQL PostgreSQL（body-craft-management-system-db）
```

前端與後端部署在**同一個** Cloud Run service（同源），不是分開兩個服務。

## Repository 結構（本次重構後）

```
backend/                     ← Cloud Run 的部署來源目錄（gcloud run deploy --source . 要在這裡執行）
├── public/
│   └── index.html           ← 前端（原 frontend/quote-system-v14.html 搬過來，改用相對路徑 API_BASE）
├── src/
│   ├── server.js            ← Express app：/api/* 路由 + 靜態檔案服務 public/
│   ├── db.js
│   ├── auth.js
│   ├── migrate.js
│   ├── repositories/
│   └── routes/
├── sql/
│   └── schema.sql
├── scripts/
│   └── create-user.js
├── Dockerfile                ← 已加入 COPY public ./public
├── package.json
└── .env.example

docs/
├── gcp-deploy.md              ← 這份文件（正式環境唯一基準）
└── backend-database-spec.md   ← 原始規劃規格書（歷史記錄，非即時狀態）

deploy/
└── gcp-deploy.md               ← 已停用，內容改成指向這份文件
```

**變更重點**：`frontend/` 目錄已移除。原本 `frontend/quote-system-v14.html`（獨立 html 檔，本機用 `file://` 直接雙擊開啟測試）現在搬到 `backend/public/index.html`，並且 `API_BASE` 從寫死的 `http://localhost:4000/api` 改成相對路徑 `/api`。這是因為正式環境前後端同源，相對路徑不管部署到哪個網域都直接可用，不用每次部署都手動改網址；但這也代表**這個檔案不能再用 `file://` 雙擊開啟測試**（相對路徑 `/api` 在 `file://` 底下解析不到），本機測試方式見下方「本機開發測試」。

## 前端正式環境設定（不得改回）

```js
const API_BASE = "/api";
```

**不得改回**：

```js
const API_BASE = "http://localhost:4000/api";
```

## Express 靜態網站設定（`backend/src/server.js` 必須保留）

```js
const path = require('path');
// ...
app.use(express.static(path.join(__dirname, '../public')));
```

這一段要放在 `/api/*` 路由註冊之後、404 handler 之前——順序錯了不會壞掉（因為靜態檔案不會跟 `/api/*` 路徑衝突），但保持這個順序方便閱讀程式碼時理解「API優先、靜態檔案其次、都沒對到才是真的404」的邏輯。

## Dockerfile（必須包含）

```dockerfile
COPY public ./public
```

沒有這行會發生「API 正常運作，但網站首頁 `/` 回傳 404」的狀況——因為容器裡根本沒有把 `public/` 資料夾複製進去。

## 本機開發測試（結構變更後的新流程）

因為前端現在用相對路徑 `/api`，**不能再直接雙擊 `index.html` 用 `file://` 開啟測試**，要改成本機啟動整個 Express 服務、用瀏覽器連 `http://localhost:PORT/`：

```bash
cd backend
npm install
cp .env.example .env      # 編輯 .env，至少要設定 DATABASE_URL 跟 JWT_SECRET（本機測試可用本機 PostgreSQL）
npm run migrate
npm run create-user -- admin 你的測試密碼 admin
npm start                 # 預設監聽 http://localhost:4000
```

啟動後瀏覽器打開 `http://localhost:4000/`，這時前端跟後端是同一個服務、同一個 origin，`API_BASE = "/api"` 會正確解析成 `http://localhost:4000/api`，跟正式環境的相對路徑行為完全一致。

## Schema 異動規則（安全 migration）

`backend/sql/schema.sql` 目前全部用 `CREATE TABLE IF NOT EXISTS`，這對「表已經存在」的正式資料庫是 no-op——加新欄位到某個 `CREATE TABLE` 陳述式裡，對已經跑過一次 migrate 的正式環境**不會生效**。往後每次新增欄位，除了改 `CREATE TABLE` 的定義（讓全新環境第一次建表就對），**一定要另外加一行 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`** 讓已存在的正式資料庫也能補上新欄位，兩者都要有、都要測過。範例（`qs_system_settings.biz_quote_seq` 的做法）：

```sql
CREATE TABLE IF NOT EXISTS qs_system_settings (
  ...
  biz_quote_seq JSONB NOT NULL DEFAULT '{}'
);
ALTER TABLE qs_system_settings ADD COLUMN IF NOT EXISTS biz_quote_seq JSONB NOT NULL DEFAULT '{}';
```

絕對不要用 `DROP COLUMN`、改變既有欄位型別、或任何會讓既有資料遺失/改變意義的寫法。如果真的需要移除某個欄位，先確認沒有任何程式碼還在讀寫它，並且是在充分溝通、確認不需要保留資料的前提下才進行，且優先考慮「保留欄位但停止使用」而非直接刪除。

## 標準版更流程（之後每次改功能都照這個做）

1. 在 `backend/` 或 `backend/public/index.html` 改程式碼（前端）
2. 如果動到 `backend/sql/schema.sql`，照上面「Schema 異動規則」加對應的 `ALTER TABLE ... IF NOT EXISTS`，並確認 `backend/src/repositories/*.js` 的組裝/拆解邏輯有同步更新
3. 本機測試（見上面「本機開發測試」）：至少要驗證 `npm run migrate` 對一個全新資料庫跟一個「已經跑過舊版 migrate」的資料庫都不會出錯，且新舊資料都讀寫正確
4. 確認沒問題後，commit + push 到 GitHub
5. 部署：

   ```bash
   cd backend
   gcloud run deploy body-craft-management-system \
     --project=ammanage \
     --region=asia-east1 \
     --source .
   ```

6. 部署完，跑健康檢查跟基本功能確認：

   ```bash
   curl https://body-craft-management-system-208869870497.asia-east1.run.app/api/health
   ```

   並用瀏覽器打開正式網址，確認首頁、查詢、報價功能正常。

**不需要、也不應該**在版更時重新執行「首次建置」流程（建立 Cloud SQL instance、建立 database、建立 secret、建立 service account、`--allow-unauthenticated` 這類初次才需要的設定）——這些都已經存在，`gcloud run deploy --source .` 預設會沿用 Cloud Run service 上次部署時的環境變數、密鑰綁定、Cloud SQL 連線設定，不需要每次都重新指定。
