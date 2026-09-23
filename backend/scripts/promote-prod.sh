#!/usr/bin/env bash
# 把目前標記為 uat 的 Revision 切換成正式 100% 流量。
# 用法：確認 UAT 測試通過後，於 backend/ 目錄下執行 `bash scripts/promote-prod.sh`
#
# 會自動找出目前掛著 uat 標籤的 Revision，不需要手動複製貼上 Revision 名稱；
# 實際切換前會要求輸入 yes 才會執行，避免手滑誤觸正式流量切換。
set -euo pipefail

PROJECT=ammanage
REGION=asia-east1
SERVICE=body-craft-management-system

if ! DESCRIBE_JSON=$(gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" --region="${REGION}" --format=json); then
  echo "讀取服務狀態失敗，請確認：已用 gcloud 登入、專案是 ${PROJECT}、服務名稱/區域正確"
  exit 1
fi

REVISION=$(echo "${DESCRIBE_JSON}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for t in data.get('status', {}).get('traffic', []):
    if t.get('tag') == 'uat':
        print(t['revisionName'])
        break
")

if [ -z "${REVISION}" ]; then
  echo "找不到目前標記為 uat 的 Revision，請先執行過 scripts/deploy-uat.sh"
  exit 1
fi

echo "即將把正式流量 100% 切到：${REVISION}"
read -r -p "確定要繼續嗎？（輸入 yes 才會執行）: " CONFIRM
if [ "${CONFIRM}" != "yes" ]; then
  echo "已取消，沒有做任何變更"
  exit 0
fi

gcloud run services update-traffic "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --to-revisions="${REVISION}=100"

echo ""
echo "=================================================="
echo "完成！正式網址："
echo "  https://${SERVICE}-208869870497.${REGION}.run.app"
echo "目前 100% 流量的 Revision：${REVISION}"
echo "=================================================="
