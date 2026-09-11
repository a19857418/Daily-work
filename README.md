# Daily-work

車體工藝中心系統：單一 html 前端（`backend/public/index.html`），內含常用系統首頁、貼膜報價系統、車型查詢小模組（依廠牌／關鍵字查詢車款大小歸類），跟後端 API 部署在同一個 Cloud Run service（同源），共用同一個後台設定資料庫。規劃來源見 [`docs/backend-database-spec.md`](docs/backend-database-spec.md)。

> **架構決策**：PostgreSQL 正規化 Schema（方案 B），已部署在 **GCP Cloud Run + Cloud SQL**（正式環境，非規劃中）。存取模式採單純化設計——**查詢/報價完全公開**（任何人有連結就能用），**只有系統設定/編輯功能需要密碼解鎖**。

## 專案結構

```
backend/            後端 API + 前端靜態檔案，兩者部署成同一個 Cloud Run service
├── public/index.html   前端入口（單一 html，純 HTML/JS，改接後端儲存）
├── src/                Express app（/api/* 路由 + 靜態檔案服務）
└── sql/                資料庫 schema
docs/                規劃規格書 + GCP 正式環境部署基準（唯一基準見 docs/gcp-deploy.md）
deploy/              已停用，內容改指向 docs/gcp-deploy.md
```

## 快速開始（本機開發）

```bash
cd backend
npm install
cp .env.example .env         # 編輯 .env，至少要改 JWT_SECRET 與 DATABASE_URL
npm run migrate               # 建立資料表
npm run create-user -- admin 你想要的密碼 admin   # 建立系統設定的密碼
npm start                     # 預設監聽 http://localhost:4000
```

啟動後瀏覽器打開 `http://localhost:4000/`——前端跟後端現在是同一個服務、同源，前端的 `API_BASE = "/api"` 相對路徑會自動解析正確，**不能再用 `file://` 直接雙擊 `index.html` 開啟測試**（相對路徑在 `file://` 底下解析不到）。**打開就能直接查詢/報價，不需要登入**；點貼膜報價系統裡的「系統設定」時才會跳出密碼框。

## 運作方式

- 貼膜報價系統的設定資料（廠牌材質成本、售價、折扣規則⋯）集中存在 PostgreSQL 正規化資料表，門市內任一台電腦打開都會看到同一份最新資料。
- **查詢/報價任何人都能用，不需登入**；只有「系統設定」需要輸入密碼解鎖（見 `backend/scripts/create-user.js` 建立的密碼），解鎖狀態存在瀏覽器裡，可隨時點一下鎖頭圖示再次鎖上。
- 若暫時連不到後端，工具會自動退回瀏覽器本機快取的最後一份資料繼續使用，並在畫面右上角顯示「離線快取中」。
- 系統設定頁提供「匯出設定 JSON／從檔案匯入」，可作備份或手動搬移資料。
- 車型查詢小模組：可依廠牌分頁或關鍵字搜尋車款，顯示車長與大小歸類（小車／一般車／大車／商用車）；查詢任何人都能用，新增／編輯／刪除廠牌與車款需先解鎖系統設定密碼。資料同樣存在後台資料庫（`vehicle_brands`/`vehicles`），跟貼膜報價系統的資料互不影響。

## 部署到 GCP

**正式環境已經建立並在運作中**（Cloud Run service `body-craft-management-system`），見 [`docs/gcp-deploy.md`](docs/gcp-deploy.md)：完整資源清單、系統架構、標準版更流程。**任何部署/更新指令都需要你自己用有權限的 GCP 帳號執行**（沙盒環境沒有安裝 gcloud、也沒有雲端憑證，無法代為操作）。

⚠️ 這是既有正式系統，版更時**不得**重建 Cloud SQL、Secret Manager、Service Account 或清除既有資料——細節見 `docs/gcp-deploy.md` 開頭的規則列表。

詳細架構、資料表設計、API 規格請見 [`docs/backend-database-spec.md`](docs/backend-database-spec.md) 與 [`backend/README.md`](backend/README.md)。
