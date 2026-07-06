#!/usr/bin/env bash
# HK_Judge C# 채점 러너 → Cloud Run 배포 (한 번 실행).
#   필요: gcloud CLI 로그인(gcloud auth login) + 프로젝트 hk-chess-betting 권한(+ 결제=Blaze).
#   Cloud Build 로 Dockerfile 을 빌드/배포하므로 로컬 Docker 불필요.
#
#   실행:  cd cloud-run && bash deploy.sh
#   출력:  서비스 URL 과 공유 시크릿 → 이 둘을 functions/.env 에 넣고 함수 재배포.
set -euo pipefail

PROJECT="${PROJECT:-hk-chess-betting}"
REGION="${REGION:-asia-northeast3}"
SERVICE="${SERVICE:-hk-judge-runner}"

# 공유 시크릿(없으면 생성). 함수와 러너가 같은 값을 써야 한다.
SECRET="${JUDGE_SHARED_SECRET:-$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')}"

echo "▶ 배포: $SERVICE ($REGION, $PROJECT)"
gcloud run deploy "$SERVICE" \
  --source . \
  --project "$PROJECT" \
  --region "$REGION" \
  --allow-unauthenticated \
  --memory 1Gi --cpu 1 \
  --timeout 60 \
  --concurrency 4 \
  --max-instances 6 \
  --set-env-vars "JUDGE_SHARED_SECRET=$SECRET"

URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)')

cat <<EOF

────────────────────────────────────────────────────────
✅ 배포 완료

  JUDGE_URL=$URL
  JUDGE_SHARED_SECRET=$SECRET

다음: functions/.env 에 위 두 줄을 넣고 함수 재배포하면
      채점이 Cloud Run(1차) → 실패 시 Wandbox(폴백) 로 동작합니다.

  (repo 루트에서)
  printf 'JUDGE_URL=%s\nJUDGE_SHARED_SECRET=%s\n' "$URL" "$SECRET" >> functions/.env
  firebase deploy --only functions --project $PROJECT

빠른 점검:
  curl -s -X POST "$URL/run" -H "Content-Type: application/json" \\
    -H "X-Judge-Secret: $SECRET" \\
    -d '{"code":"using System;public class Program{public static void Main(){Console.WriteLine(\"짝수\");}}","stdin":""}'
  → {"compileError":false,"compileOutput":"","stdout":"짝수\n",...}
────────────────────────────────────────────────────────
EOF
