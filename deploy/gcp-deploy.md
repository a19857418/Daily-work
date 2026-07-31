# 部署到 GCP（Cloud Run + Cloud SQL）

目標架構：**Cloud Run**（跑 `backend/`，HTTPS 自帶、無流量時可縮到 0）＋ **Cloud SQL for PostgreSQL**（正規化資料庫），密鑰放 **Secret Manager**。單店規模用最小規格即可，之後流量變大再調整。

以下指令請在已安裝並登入 `gcloud` CLI 的環境執行（Cloud Shell 最省事，瀏覽器打開 GCP 主控台按右上角 `>_` 圖示即可，已內建 gcloud）。把 `YOUR_PROJECT_ID` 換成你的專案 ID。

## 0. 基本設定

```bash
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com sqladmin.googleapis.com \
  secretmanager.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com
```

## 1. 建立 Cloud SQL for PostgreSQL

```bash
# 建立最小規格的執行個體（單店用量足夠；region 請選離門市最近的，例如 asia-east1）
gcloud sql instances create shop-settings-db \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region=asia-east1 \
  --storage-size=10GB \
  --storage-auto-increase

# 設定 postgres 超級使用者密碼（先自己記住，等等會用到）
gcloud sql users set-password postgres \
  --instance=shop-settings-db \
  --password="請換成一組長且隨機的密碼"

# 建立實際使用的資料庫與帳號
gcloud sql databases create shop_settings --instance=shop-settings-db

gcloud sql users create app_user \
  --instance=shop-settings-db \
  --password="請換成另一組長且隨機的密碼"
```

記下你的「連線名稱」（後面會一直用到）：

```bash
gcloud sql instances describe shop-settings-db --format='value(connectionName)'
# 輸出格式類似：YOUR_PROJECT_ID:asia-east1:shop-settings-db
```

## 2. 建立資料表（首次部署時執行一次）

用 Cloud SQL Auth Proxy 從本機（或 Cloud Shell）連到剛建立的資料庫，執行 migration 與建立「系統設定密碼」：

```bash
# 下載 Cloud SQL Auth Proxy（Cloud Shell 已內建，本機需自行下載）
# https://cloud.google.com/sql/docs/postgres/sql-proxy

cloud-sql-proxy YOUR_PROJECT_ID:asia-east1:shop-settings-db --port=5433 &

cd backend
DATABASE_URL="postgres://app_user:你在上一步設定的密碼@127.0.0.1:5433/shop_settings" npm run migrate
DATABASE_URL="postgres://app_user:你在上一步設定的密碼@127.0.0.1:5433/shop_settings" npm run create-user -- admin 你想給系統設定用的密碼 admin
```

> 這個「密碼」就是前端「系統設定」跳出的密碼框要輸入的東西；帳號名稱（這裡用 `admin`）只是資料庫內部欄位，前端不會問帳號，只問密碼。

## 3. 把密鑰放進 Secret Manager

```bash
printf '%s' "請換成一組長且隨機的字串（openssl rand -base64 48）" | \
  gcloud secrets create jwt-secret --data-file=-

printf '%s' "app_user 的密碼（跟步驟 1 一致）" | \
  gcloud secrets create db-password --data-file=-
```

## 4. 部署到 Cloud Run

在 `backend/` 目錄下，用原始碼直接建置部署（Cloud Build 會自動用 `Dockerfile` 建置映像檔）：

```bash
cd backend

gcloud run deploy shop-settings-api \
  --source . \
  --region asia-east1 \
  --allow-unauthenticated \
  --add-cloudsql-instances YOUR_PROJECT_ID:asia-east1:shop-settings-db \
  --set-env-vars "INSTANCE_UNIX_SOCKET=/cloudsql/YOUR_PROJECT_ID:asia-east1:shop-settings-db,DB_USER=app_user,DB_NAME=shop_settings,ALLOWED_ORIGIN=*,TOKEN_TTL=12h" \
  --set-secrets "JWT_SECRET=jwt-secret:latest,DB_PASSWORD=db-password:latest"
```

> `--allow-unauthenticated` 是指「任何人都能打到這個 Cloud Run 服務」——這沒問題，因為 API 本身還是要求 JWT 登入才能存取資料（見 `backend/README.md`）。真正的存取控制在應用層，不是 Cloud Run 層。
>
> `ALLOWED_ORIGIN=*` 先求可用；等前端實際部署的網址確定後，建議改成該網址（例如 `https://your-shop-tools.example.com`），降低被其他網站盜用 API 的風險。

部署完成後會印出服務網址，類似：

```
Service URL: https://shop-settings-api-xxxxxxxxxx-de.a.run.app
```

確認健康檢查：

```bash
curl https://shop-settings-api-xxxxxxxxxx-de.a.run.app/api/health
```

## 5. 前端指向正式後端

把 `frontend/vehicle-lookup.html` 與 `frontend/quote-system-v14.html` 最上方的：

```js
const API_BASE = "http://localhost:4000/api";
```

改成：

```js
const API_BASE = "https://shop-settings-api-xxxxxxxxxx-de.a.run.app/api";
```

兩個 HTML 檔案本身可以放在任何靜態網站託管（GCS 靜態網站、Firebase Hosting、Cloud Storage + 負載平衡器，或單純放公司內部網站伺服器）；它們只是純 HTML/JS，沒有伺服器端渲染需求。

## 6. 之後更新程式碼

改完 `backend/` 程式碼後，重新部署只需要：

```bash
cd backend
gcloud run deploy shop-settings-api --source . --region asia-east1
```

Cloud Run 會自動建置新版映像檔並切換流量，設定值（環境變數、密鑰、Cloud SQL 連線）會沿用上次部署的設定。

## 費用概念

- Cloud Run：沒有流量時可縮到 0 個執行個體，幾乎不計費；有流量才計費，單店用量每月成本很低。
- Cloud SQL：`db-f1-micro` 是持續運作的執行個體，即使沒人使用也會計費（約每月數美元起，依區域/儲存空間而定）——這是目前架構裡唯一「常態性」的費用來源，之後若要進一步省錢可考慮 Cloud SQL 的自動啟停或改用更小的方案。
