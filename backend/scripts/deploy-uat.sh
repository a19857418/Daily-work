#!/usr/bin/env bash
# 部署測試版（UAT，--no-traffic --tag=uat，不影響正式流量）。
# 用法：在 Cloud Shell 裡，於 backend/ 目錄下執行 `bash scripts/deploy-uat.sh`
#
# 每次都用「當下 git commit 短碼」當作映像檔標籤，保證每次建置都是全新、獨一無二的標籤，
# 不會重複用到舊的映像檔（這是之前用 `gcloud run deploy --source .` 時遇到過的問題：
# 有時候會誤判成「原始碼沒變」而沿用舊映像檔）。
set -euo pipefail

PROJECT=ammanage
REGION=asia-east1
SERVICE=body-craft-management-system
BRANCH=claude/gallant-galileo-13hq4t
IMAGE_BASE="asia-east1-docker.pkg.dev/${PROJECT}/cloud-run-source-deploy/${SERVICE}"

cd "$(dirname "$0")/.."

echo "==> git pull 最新程式碼（分支：${BRANCH}）"
git pull origin "${BRANCH}"

TAG="$(git rev-parse --short HEAD)"
IMAGE="${IMAGE_BASE}:${TAG}"

echo "==> 建置全新映像檔：${IMAGE}"
gcloud builds submit --tag "${IMAGE}" --project "${PROJECT}" .

echo "==> 部署到 UAT（--no-traffic，不影響正式流量）"
gcloud run deploy "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --image="${IMAGE}" \
  --no-traffic \
  --tag=uat

echo ""
echo "=================================================="
echo "完成！請打開下面網址測試："
echo "  https://uat---${SERVICE}-mjl2csjnxq-de.a.run.app"
echo "本次映像檔標籤（commit 短碼）：${TAG}"
echo "測試通過後，執行 scripts/promote-prod.sh 切換正式流量"
echo "=================================================="
