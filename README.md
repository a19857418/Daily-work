# Daily-work

車款查詢 / 犀牛皮貼膜報價 兩套門市工具，共用同一個後台設定資料庫。規劃來源見 [`docs/backend-database-spec.md`](docs/backend-database-spec.md)。

> **架構決策**：依實際需求（單一門市、需要角色權限、已有 GCP、要長期用正規化資料庫）採用**方案 B**——PostgreSQL 正規化 Schema、JWT 帳號登入＋角色權限（`admin`／`staff`），部署目標為 **GCP Cloud Run + Cloud SQL**。

## 專案結構

```
backend/    後台設定資料庫 API（Node.js + Express + PostgreSQL，JWT 登入＋角色權限）
frontend/   兩套獨立前端工具（純 HTML/JS，改接後端儲存，含登入畫面）
deploy/     GCP 部署步驟（Cloud Run + Cloud SQL）
docs/       規劃規格書
```

## 快速開始（本機開發）

1. 準備一個 PostgreSQL（本機安裝、Docker 或 Cloud SQL 皆可），啟動後端：

   ```bash
   cd backend
   npm install
   cp .env.example .env        # 編輯 .env，至少要改 JWT_SECRET 與 DATABASE_URL
   npm run migrate              # 建立資料表
   npm run create-user -- boss  你的密碼 admin   # 建立第一個管理者帳號
   npm start                    # 預設監聽 http://localhost:4000
   ```

2. 打開前端工具：`frontend/vehicle-lookup.html`、`frontend/quote-system-v14.html`。

   兩個檔案最上方都有一段「後端連線設定」：

   ```js
   const API_BASE = "http://localhost:4000/api";
   ```

   請改成你實際部署的後端網址，再把這兩個 HTML 檔案放到瀏覽器可開啟的地方（本機開啟、內部網頁伺服器、或任何靜態網站託管皆可）。開啟後會先看到登入畫面，用剛剛建立的帳號登入即可。

## 運作方式

- 兩套工具的設定資料（車款清單、廠牌材質成本、售價、折扣規則⋯）不再只存在瀏覽器裡，而是集中存在 PostgreSQL 正規化資料表，門市內任一台電腦登入都會看到同一份最新資料。
- **帳號分兩種角色**：`admin`（可讀寫、可還原歷史版本）、`staff`（可查詢/報價，但無法寫入設定，嘗試寫入會被拒絕並提示）。用 `backend/scripts/create-user.js` 建立帳號，沒有管理介面。
- 若暫時連不到後端，工具會自動退回瀏覽器本機快取的最後一份資料繼續使用，並在畫面右上角顯示「離線快取中」。
- 系統設定頁（報價系統，僅 admin 可見）與主頁面（車款查詢工具）都提供「匯出設定 JSON／從檔案匯入」，可作備份或手動搬移資料。

## 部署到 GCP

見 [`deploy/gcp-deploy.md`](deploy/gcp-deploy.md)：Cloud SQL for PostgreSQL + Cloud Run，密鑰放 Secret Manager，含完整 gcloud 指令。

詳細架構、資料表設計、API 規格請見 [`docs/backend-database-spec.md`](docs/backend-database-spec.md) 與 [`backend/README.md`](backend/README.md)。
