# HK_Judge C# 채점 러너 (Cloud Run)

채점 컴파일러를 **운영자 통제 하의 Cloud Run 서비스**로 돌려, 무료 공개 컴파일러(Wandbox)의
간헐 장애에서 벗어나기 위한 백엔드. `.NET SDK` 컨테이너가 학생 C# 코드를 `dotnet build` 후
격리된 자식 프로세스로 실행(월클럭 타임아웃·출력 제한)하고 결과를 JSON으로 돌려준다.

- 진짜 .NET(리눅스) → **UTF-8 기본**이라 한글 출력이 정상(모노용 인코딩 주입 불필요).
- `InvariantGlobalization` → 소수점 `.` 고정(기존 문제 기대값과 일치).
- 채점 함수(`submitSolution`/`runCode`)는 **Cloud Run 1차 → 실패 시 Wandbox 폴백**.
  즉 이 서비스가 없거나 죽어도 채점은 계속된다(가용성 우선).

## API
```
POST /run   (헤더 X-Judge-Secret: <시크릿>)
  body: { "code": "...", "stdin": "...", "runTimeoutMs": 8000 }
  resp: { "compileError": false, "compileOutput": "", "stdout": "...", "stderr": "", "timedOut": false, "exitCode": 0 }
GET  /      → "hk-judge runner ok"  (헬스체크)
```

## 배포 (한 번, gcloud 필요)

전제: `gcloud` CLI 설치 + 로그인(`gcloud auth login`), 프로젝트 `hk-chess-betting` 권한, 결제(Blaze).
로컬 Docker 불필요 — Cloud Build 가 Dockerfile 을 빌드한다.

```bash
cd cloud-run
bash deploy.sh          # 또는: PROJECT=... REGION=... SERVICE=... bash deploy.sh
```

끝에 출력되는 `JUDGE_URL`, `JUDGE_SHARED_SECRET` 두 값을 함수에 연결:

```bash
# repo 루트에서
printf 'JUDGE_URL=%s\nJUDGE_SHARED_SECRET=%s\n' "<URL>" "<SECRET>" >> functions/.env
firebase deploy --only functions --project hk-chess-betting
```

재배포 후부터 채점이 Cloud Run 을 1차로 쓴다(로그에서 확인). 되돌리려면 functions/.env 에서
두 줄을 지우고 함수 재배포 → Wandbox 전용으로 복귀.

## 운영 메모
- 인증: 기본은 공유 시크릿 헤더(`--allow-unauthenticated` + `JUDGE_SHARED_SECRET`). 더 강하게는
  `--no-allow-unauthenticated` + 함수 SA 에 `roles/run.invoker` 부여 + ID 토큰 방식으로 전환 가능.
- 리소스: `--memory 1Gi --cpu 1 --concurrency 4 --max-instances 6 --timeout 60`. 반 규모엔 충분,
  Cloud Run 무료 티어 안(≈$0). 트래픽 급증 시 max-instances 조정.
- 보안: 학생 코드를 실행하므로 신뢰된 수업용 전제. 강화하려면 egress 제한(VPC egress),
  더 낮은 리소스, seccomp 등을 검토.
- 이미지가 SDK(빌드 필요)라 큰 편(~700MB+). 첫 요청은 워밍으로 완화.
