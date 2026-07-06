# HK_Judge C# 채점 러너 → Cloud Run 배포 (PowerShell, 한 번 실행).
#   필요: gcloud CLI 로그인(gcloud auth login) + 프로젝트 hk-chess-betting 권한(+ 결제=Blaze), firebase CLI.
#   Cloud Build 로 Dockerfile 을 빌드/배포하므로 로컬 Docker 불필요.
#
#   실행:  cd C:\HK_Bot\HK_Judge\cloud-run ;  powershell -ExecutionPolicy Bypass -File .\deploy.ps1
#   동작:  Cloud Run 배포 → functions/.env 에 JUDGE_URL/SECRET 기록 → 함수 재배포까지.

$ErrorActionPreference = 'Stop'

$PROJECT = if ($env:PROJECT) { $env:PROJECT } else { 'hk-chess-betting' }
$REGION  = if ($env:REGION)  { $env:REGION }  else { 'asia-northeast3' }
$SERVICE = if ($env:SERVICE) { $env:SERVICE } else { 'hk-judge-runner' }

# 사전 점검
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  Write-Host "❌ gcloud CLI 가 없습니다. 설치: https://cloud.google.com/sdk/docs/install-sdk" -ForegroundColor Red
  Write-Host "   설치 후:  gcloud auth login  ;  gcloud config set project $PROJECT" -ForegroundColor Yellow
  exit 1
}
if (-not (Get-Command firebase -ErrorAction SilentlyContinue)) {
  Write-Host "❌ firebase CLI 가 없습니다 (함수 재배포에 필요)." -ForegroundColor Red; exit 1
}

# 공유 시크릿(없으면 생성). 함수와 러너가 같은 값을 써야 한다.
$SECRET = if ($env:JUDGE_SHARED_SECRET) { $env:JUDGE_SHARED_SECRET } else {
  -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 28 | ForEach-Object { [char]$_ })
}

Write-Host "▶ Cloud Run 배포: $SERVICE ($REGION, $PROJECT)" -ForegroundColor Cyan
gcloud run deploy $SERVICE `
  --source . `
  --project $PROJECT `
  --region $REGION `
  --allow-unauthenticated `
  --memory 1Gi --cpu 1 `
  --timeout 60 `
  --concurrency 4 `
  --max-instances 6 `
  --set-env-vars "JUDGE_SHARED_SECRET=$SECRET"
if ($LASTEXITCODE -ne 0) { Write-Host "❌ Cloud Run 배포 실패" -ForegroundColor Red; exit 1 }

$URL = (gcloud run services describe $SERVICE --project $PROJECT --region $REGION --format 'value(status.url)').Trim()
Write-Host "`n✅ URL: $URL" -ForegroundColor Green

# functions/.env 에 JUDGE_URL/SECRET 기록(기존 동일 키는 제거 후 재기록, UTF-8 BOM 없이).
$envPath = Join-Path $PSScriptRoot '..\functions\.env'
$envPath = [System.IO.Path]::GetFullPath($envPath)
$lines = @()
if (Test-Path $envPath) {
  $lines = Get-Content $envPath | Where-Object { $_ -notmatch '^\s*(JUDGE_URL|JUDGE_SHARED_SECRET)\s*=' }
}
$lines += "JUDGE_URL=$URL"
$lines += "JUDGE_SHARED_SECRET=$SECRET"
[System.IO.File]::WriteAllText($envPath, ($lines -join "`n") + "`n")
Write-Host "✅ functions/.env 갱신: $envPath" -ForegroundColor Green

# 헬스/기능 점검
Write-Host "`n▶ 러너 점검(한글 출력)..." -ForegroundColor Cyan
try {
  $body = @{ code = 'using System;public class Program{public static void Main(){Console.WriteLine("짝수");}}'; stdin = '' } | ConvertTo-Json
  $r = Invoke-RestMethod -Uri "$URL/run" -Method Post -ContentType 'application/json' -Headers @{ 'X-Judge-Secret' = $SECRET } -Body $body
  Write-Host ("   stdout=" + ($r.stdout | ConvertTo-Json) + " compileError=" + $r.compileError) -ForegroundColor Gray
} catch { Write-Host "   (점검 호출 실패 — 콜드스타트일 수 있음, 무시 가능): $_" -ForegroundColor Yellow }

# 함수 재배포 (repo 루트에서)
Write-Host "`n▶ 함수 재배포..." -ForegroundColor Cyan
Push-Location (Join-Path $PSScriptRoot '..')
firebase deploy --only functions --project $PROJECT --force
Pop-Location

Write-Host "`n────────────────────────────────────────" -ForegroundColor Green
Write-Host "완료. 이제 채점이 Cloud Run(1차) → Wandbox(폴백) 로 동작합니다." -ForegroundColor Green
Write-Host "  JUDGE_URL=$URL"
Write-Host "  JUDGE_SHARED_SECRET=$SECRET"
Write-Host "되돌리려면 functions/.env 의 두 줄을 지우고 함수 재배포하세요." -ForegroundColor Green
