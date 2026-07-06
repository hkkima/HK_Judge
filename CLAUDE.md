# HK_Judge — 에이전트/개발자 우선 컨텍스트

C# 코딩 문제 풀이판. 운영자가 출제 → 학습자가 풀이 → **최초 정답 시 포인트 지급**.
Vite+React+Firebase(Cloud Functions, 서울 `asia-northeast3`), GitHub Pages.
백엔드 프로젝트 `hk-chess-betting`(★베팅판·주식판과 `users`/포인트 공유★).

## 절대 깨면 안 되는 불변식
1. **포인트 증가는 Cloud Functions(Admin SDK)만**. 클라 읽기 전용, `firestore.rules`가 차단.
   보상은 `submitSolution` 안에서 `users.balance += reward` + `meta/stockBoard.housePool -= reward`
   (배당과 동일한 회계 → **총 포인트 보존**) + `ledger`(type:`quiz_reward`) 기록.
2. **채점은 서버에서만**. 클라의 실행 결과로 포인트 주면 조작 가능 → `submitSolution`이
   `problemTests`(운영자만 read)를 읽어 Wandbox로 직접 실행/비교하고 지급한다.
3. **정답 정보 숨김**: 채점용 전체 케이스는 `problemTests/{id}`(운영자만 read). 공개 예제만
   `problems/{id}.samples`로 노출. 숨은 케이스의 입출력은 채점 응답에도 넣지 않는다.
4. **중복 보상 방지**: `solved/{userId__problemId}` 문서를 트랜잭션에서 확인 → 최초 정답만 지급(멱등).
5. **`firestore.rules`는 베팅+주식+코딩 통합본**. 진실 원천은 `HK_Stock/firestore.rules`.
   여기 규칙은 그 상위 집합이어야 하며, 코딩 블록을 HK_Stock 쪽에도 동일하게 반영해 둘 것.
6. **운영자 이메일 3곳 일치**: 프론트 `VITE_ADMIN_EMAILS` · 함수 `ADMIN_EMAILS` · `firestore.rules`.

## 배포 (★ 공유 프로젝트 주의 ★)
- 프로젝트당 함수/규칙은 한 벌. 아무 필터 없이 `firebase deploy --only functions` 하면
  **주식판 함수가 삭제된다**. 반드시 함수명을 지정:
  ```
  firebase deploy \
    --only functions:runCode,functions:submitSolution,functions:upsertProblem,functions:deleteProblem,firestore:rules \
    --project hk-chess-betting
  ```
- 규칙 배포는 전체 교체 → 이 리포의 `firestore.rules`가 반드시 3판 통합본이어야 함.
- 프론트: `main` 푸시 → GitHub Actions가 GitHub Pages 배포. 리포명이 `HK_Judge`가 아니면
  `vite.config.js`의 base 수정.
- 셸은 PowerShell(`&&` 미지원).

## 컴파일러 (채점 엔진) — 2단(공급자 계층 `functions/judge.js`)
- **1차: Cloud Run 러너**(`cloud-run/`, .NET SDK 컨테이너) — `JUDGE_URL`+`JUDGE_SHARED_SECRET`(functions/.env)
  설정 시 사용. 진짜 .NET(리눅스)=UTF-8 기본이라 한글 정상·인코딩 주입 불필요, 실제 시간 제한 강제,
  운영자 통제. `cloud-run/deploy.sh`로 배포. 미설정이면 이 단계 건너뜀.
- **폴백: Wandbox 공개 API** — Cloud Run 미설정/일시 실패 시 자동 전환(가용성 우선). 아래 특성 그대로.
  ⚠️ Wandbox 공개 인스턴스는 수십 초짜리 장애가 잦다(그래서 Cloud Run을 1차로 두는 것).
- 학생 코드 실행은 두 경로 다 같은 반환형태 → `index.js`의 `judgeOne`이 그대로 판정. `judge.js`가 라우팅.

### Wandbox 폴백 세부
- **Wandbox 공개 API**(`https://wandbox.org/api/compile.json`) — 키 불필요, C# `mono-6.12.0.199`, stdin 지원.
  동기 응답(compile+run 한 번). 호출당 ~5-8s로 느려서 `submitSolution`은 첫 케이스로 컴파일 확인 후
  나머지를 동시성 4로 병렬 채점. 함수 `timeoutSeconds: 300`.
- **한글 출력 주의**: 컨테이너 로케일이 C라 mono가 비ASCII를 `?`로 바꾼다. → `wandbox.js`의 `prepareCode()`가
  학생 코드의 `Main` 진입 직후에 `Console.OutputEncoding=new UTF8Encoding(false)`(BOM 없이)를 **주입**한다.
  학생은 인코딩을 신경 쓸 필요 없음. `normalizeOutput`은 방어적으로 앞 BOM도 제거.
- **일시 실패 재시도**: Wandbox 공개 인스턴스는 컨테이너 스폰 실패(OCI "Resource temporarily unavailable",
  status 126)·504가 간헐 발생 → `runOnce`가 최대 4회 백오프 재시도(코드 결과가 아닌 인프라 오류만).
- ※ Piston 공개 API는 2026-02-15부터 화이트리스트 전용 → 사용 불가. dotnetcore-8/Paiza.IO는 불안정해 mono 채택.
  안정성/저지연이 필요하면 자체 호스팅으로 `WANDBOX_URL`/`WANDBOX_CSHARP` 교체(그러면 인코딩 주입도 불필요할 수 있음).

## 문제 일괄 등록 도구/스킬
- `tools/import-problems.mjs` — "# 문제 N." 양식 마크다운(여러 문제)을 파싱해 problems/problemTests에 업서트.
  `node tools/import-problems.mjs --file <md> --prefix <접두> --reward <P> --start-order <N> [--dry-run]`.
  `tools/`는 독립 의존성(`firebase-admin`) — 프론트/함수 번들과 분리. 서비스 계정 키로 직접 기록(upsertProblem과 동일 형태).
- `.claude/skills/hk-judge-import-problems/SKILL.md` — 위 도구를 쓰는 절차(양식 계약·dry-run·한글/실수 사전검증·검증&정리).
  현재 id 접두: 연산자편 `op-01~05`(order 1~5), 조건문편 `cond-11~15`(order 11~15).

## 코드 지도
`functions/`: index.js(runCode·submitSolution·upsertProblem·deleteProblem), judge.js(공급자 라우팅: Cloud Run 1차→Wandbox 폴백),
cloudrun.js(러너 클라이언트), wandbox.js(폴백: 실행+UTF8주입+재시도+정규화+병렬풀).
`cloud-run/`: Program.cs(.NET 채점 러너)·Dockerfile·deploy.sh(Cloud Run 배포)·README(런북).
`tools/`: import-problems.mjs(마크다운 일괄 임포터).  `examples/`: 등록에 쓴 문제 마크다운 원본.
환경변수(functions/.env): `JUDGE_URL`,`JUDGE_SHARED_SECRET` 설정 시 Cloud Run 사용, 없으면 Wandbox.
`src/`: data/firebase.js·store.js, auth/auth.js(베팅판과 동일 해시), state/AppContext.jsx,
lib/markdown.jsx(경량 렌더러), pages/(ProblemList·Solve·Admin·Leaderboard·Login).

## 데이터 모델
- `problems/{id}`: title, statement(md), templateCode, timeLimitSec, memoryLimitMb, reward, order, testCount, samples[].
- `problemTests/{id}`: cases:[{input, expected, hidden}]  ← 운영자만 read.
- `solved/{userId__problemId}`: userId, problemId, reward, ts.
- `submissions/{auto}`: userId, problemId, passed, total, verdict, code, ts.
