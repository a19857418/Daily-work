# Daily-work

車款查詢 / 犀牛皮貼膜報價 兩套門市工具，共用同一個後台設定資料庫。規劃來源見 [`docs/backend-database-spec.md`](docs/backend-database-spec.md)（方案 A：Key-Value 儲存，已實作）。

## 專案結構

```
backend/    後台設定資料庫 API（Node.js + Express + SQLite）
frontend/   兩套獨立前端工具（純 HTML/JS，改接後端儲存）
docs/       規劃規格書
```

## 快速開始

1. 啟動後端：

   ```bash
   cd backend
   npm install
   cp .env.example .env   # 編輯 .env，至少要改 API_KEY
   npm start               # 預設監聽 http://localhost:4000
   ```

2. 打開前端工具：`frontend/vehicle-lookup.html`、`frontend/quote-system-v14.html`。

   兩個檔案最上方都有一段「後端連線設定」：

   ```js
   const API_BASE = "http://localhost:4000/api";
   const API_KEY  = "change-me-to-a-long-random-secret";
   ```

   請改成你實際部署的後端網址，以及跟 `backend/.env` 裡 `API_KEY` 相同的值，再把這兩個 HTML 檔案放到瀏覽器可開啟的地方（本機開啟、內部網頁伺服器、或任何靜態網站託管皆可）。

## 運作方式

- 兩套工具的設定資料（車款清單、廠牌材質成本、售價、折扣規則⋯）不再只存在瀏覽器裡，而是集中存在後端資料庫，門市內任一台電腦開啟都會看到同一份最新資料。
- 若暫時連不到後端，工具會自動退回瀏覽器本機快取的最後一份資料繼續使用，並在畫面右上角顯示「離線快取中」。
- 系統設定頁（報價系統）與主頁面（車款查詢工具）都提供「匯出設定 JSON／從檔案匯入」，可作備份或手動搬移資料。

詳細架構、資料表設計、API 規格請見 [`docs/backend-database-spec.md`](docs/backend-database-spec.md) 與 [`backend/README.md`](backend/README.md)。
