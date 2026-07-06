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

## 컴파일러 (채점 엔진)
- **Wandbox 공개 API**(`https://wandbox.org/api/compile.json`) — 키 불필요, C# `mono-6.12.0.199`, stdin 지원.
  동기 응답(compile+run 한 번). 호출당 ~5-8s로 느려서 `submitSolution`은 첫 케이스로 컴파일 확인 후
  나머지를 동시성 4로 병렬 채점. 함수 `timeoutSeconds: 300`.
- ※ Piston 공개 API는 2026-02-15부터 화이트리스트 전용 → 사용 불가. dotnetcore-8/Paiza.IO는 불안정해 mono 채택.
- 바꾸려면 `functions/wandbox.js`의 `WANDBOX_URL`/`WANDBOX_CSHARP`만 교체(자체 호스팅 등).

## 코드 지도
`functions/`: index.js(runCode·submitSolution·upsertProblem·deleteProblem), wandbox.js(실행+출력정규화+병렬풀).
`src/`: data/firebase.js·store.js, auth/auth.js(베팅판과 동일 해시), state/AppContext.jsx,
lib/markdown.jsx(경량 렌더러), pages/(ProblemList·Solve·Admin·Leaderboard·Login).

## 데이터 모델
- `problems/{id}`: title, statement(md), templateCode, timeLimitSec, memoryLimitMb, reward, order, testCount, samples[].
- `problemTests/{id}`: cases:[{input, expected, hidden}]  ← 운영자만 read.
- `solved/{userId__problemId}`: userId, problemId, reward, ts.
- `submissions/{auto}`: userId, problemId, passed, total, verdict, code, ts.
