# 後台設定資料庫 API

依照 [`docs/backend-database-spec.md`](../docs/backend-database-spec.md) 方案 A（Key-Value 儲存）實作，供 `frontend/vehicle-lookup.html` 與 `frontend/quote-system-v14.html` 兩套工具集中存放設定資料。

## 安裝與啟動

```bash
cd backend
npm install
cp .env.example .env
# 編輯 .env，至少要改 API_KEY 為一組長且隨機的字串
npm start
```

預設監聽 `http://localhost:4000`，資料存在同目錄的 `data.db`（SQLite 檔案，會自動建立）。

## 環境變數（`.env`）

| 變數 | 說明 | 預設 |
|---|---|---|
| `PORT` | API 監聽的埠號 | `4000` |
| `API_KEY` | 前端呼叫時需帶的 `X-Api-Key`，**務必修改** | 無，未設定時所有請求都會被拒絕 |
| `ALLOWED_ORIGIN` | 允許跨網域呼叫的來源，逗號分隔；內部使用可先留 `*` | `*` |
| `DB_PATH` | SQLite 檔案位置 | `./data.db` |

## API

所有 `/api/store/*` 路徑都需要帶 header `X-Api-Key: <你的 API_KEY>`，另外建議帶 `X-Client-Id: <裝置代號>` 供 `updated_by` 稽核紀錄使用（前端已內建自動產生並記住裝置代號）。

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/health` | 健康檢查，不需要 API Key |
| GET | `/api/store/:appKey` | 取得整份設定；尚無資料回傳 `404` |
| PUT | `/api/store/:appKey` | 覆蓋整份設定，body：`{ expectedVersion, data }`；版本衝突回傳 `409` |
| GET | `/api/store/:appKey/history?limit=20` | 列出最近 N 筆歷史版本摘要 |
| POST | `/api/store/:appKey/restore/:version` | 還原到指定版本（會產生一筆新版本，不覆寫歷史） |
| POST | `/api/store/:appKey/import` | 一次性匯入，略過樂觀鎖（用於初次資料搬遷） |

兩套前端工具目前使用的 `appKey`：

- `vehicle-size-lookup-db`（車款大小查詢工具）
- `rhino-wrap-quote-db-v14`（犀牛皮貼膜報價系統 v14）

## 部署建議

單店、資料量小的情境下，一台小型 VPS 或門市內網主機上用 `pm2`／systemd 常駐執行 `npm start` 即可；資料庫備份就是定期複製一份 `data.db`。若未來要多分店或需要更高可用性，可參考規格書第 10 節評估 Serverless／BaaS 方案。
