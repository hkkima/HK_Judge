# 💻 HK_Judge — C# 코딩 문제 풀이판

운영자가 문제를 출제하고, 학습자가 브라우저에서 C# 코드를 작성·**실행**·**제출**하면
서버가 채점하고 **최초 정답 시 포인트를 지급**하는 웹앱.

- 프론트: Vite + React 18 → GitHub Pages
- 백엔드: **베팅판(HK_Betting)·주식판(HK_Stock)과 같은 Firebase 프로젝트**(`hk-chess-betting`)
  → `users.balance`(포인트)를 세 앱이 공유
- 컴파일/실행: **Wandbox 공개 API**(무료, 키 불필요, C# mono+stdin). 채점은 전부 Cloud Functions에서.
  (Piston 공개 API는 2026-02 화이트리스트 전용이 되어 Wandbox로 대체.)

## 핵심 흐름

```
[운영자] Google 로그인 → 출제 탭에서 문제 작성(설명 Markdown + 템플릿 + 테스트케이스 + 보상)
[학습자] 이름·PIN 로그인(베팅·주식판과 동일 계정) → 문제 선택 → 코드 작성
         ▶ 실행: 내가 넣은 입력으로 결과 확인(포인트 없음)
         제출: 서버가 숨은 테스트케이스로 채점 → 전부 통과 & 최초면 포인트 지급
```

포인트는 **하우스 풀에서 정산**(배당과 동일)되어 세 앱 전체의 총 포인트가 보존된다.
포인트 증가는 오직 Cloud Functions(Admin SDK)만 가능 — 클라이언트 조작은 규칙이 차단.

## 로컬 실행

```bash
cp .env.example .env      # 베팅·주식판과 같은 Firebase 값 + 운영자 이메일
npm install
npm run dev               # http://localhost:5300
```

`.env`가 비어 있으면 UI 미리보기만 되고 실데이터·채점은 안 붙는다.
채점(runCode/submitSolution)은 Cloud Functions가 배포돼 있어야 동작한다.

## 배포

### 1) Cloud Functions + 규칙 (★ 공유 프로젝트 — 반드시 함수명 지정 ★)

같은 프로젝트에 주식판 함수가 이미 있다. 필터 없이 배포하면 그 함수들이 삭제되므로:

```bash
cd functions && npm install && cd ..
firebase use hk-chess-betting
firebase deploy \
  --only functions:runCode,functions:submitSolution,functions:upsertProblem,functions:deleteProblem,firestore:rules \
  --project hk-chess-betting
```

- 함수 사용에는 **Blaze 요금제** 필요(외부 Wandbox 호출 = 아웃바운드 네트워크). 24명 규모면 실비 ≈ $0.
- `functions/index.js`의 `ADMIN_EMAILS`, 프론트 `VITE_ADMIN_EMAILS`, `firestore.rules`의 이메일 **세 곳 일치**.
- `firestore.rules`는 **베팅+주식+코딩 3판 통합본**이다. 이걸 배포하면 세 앱 모두 동작한다.
  (진실 원천은 `HK_Stock/firestore.rules`. 코딩 블록을 그쪽에도 동일하게 반영해 둘 것.)

### 2) 프론트 (GitHub Pages)

리포 이름이 `HK_Judge`가 아니면 `vite.config.js`의 base를 맞춘다.
GitHub → Settings → Secrets에 `VITE_FIREBASE_*`, `VITE_ADMIN_EMAILS`, `VITE_FUNCTIONS_REGION`
등록 후 `main` 푸시 → Actions가 자동 배포.

Firebase Console → Authentication → **익명 로그인 켜기**(학습자 함수 호출용),
**Google 로그인 켜기**(운영자), 승인된 도메인에 GitHub Pages 도메인 추가.

## 문제 일괄 등록 (마크다운 → 문제)

"# 문제 N. 제목 / 설명 / 입출력 / 예제 / 힌트 / 템플릿 코드 / 테스트 케이스 표" 양식의
마크다운을 그대로 문제로 넣을 수 있다.

```bash
cd tools && npm install && cd ..     # 최초 1회 (firebase-admin)
# 파싱만 확인
node tools/import-problems.mjs --file examples/set2-conditionals.md --prefix cond --reward 1000 --start-order 11 --dry-run
# 실제 등록
node tools/import-problems.mjs --file examples/set2-conditionals.md --prefix cond --reward 1000 --start-order 11
```

- 테스트 표의 **첫 행 = 공개 예제**, 나머지는 비공개(정답 숨김).
- 서비스 계정 키(리포 밖, 기본 `C:/HK_Bot/...adminsdk...json`, 또는 `--key`)로 Firestore에 직접 기록.
- 한글 출력은 서버가 UTF-8 인코딩을 자동 주입하므로 학생 코드 수정 없이 정상 채점된다.
- Claude Code 스킬 `hk-judge-import-problems`(`.claude/skills/`)이 이 절차(양식 검증·사전 점검·검증)를 감싼다.

## 보안 모델 (솔직히)

- ✅ **포인트 조작 불가**: 채점·지급은 서버(Admin SDK)만. 클라 실행 결과는 표시용일 뿐.
- ✅ **정답 숨김**: 채점 케이스는 `problemTests`(운영자만 read), 숨은 케이스 입출력은 응답에도 없음.
- ✅ **중복 보상 방지**: `solved` 표식 + 트랜잭션으로 최초 1회만 지급.
- ⚠️ **신원 경량**: `submitSolution`이 `pinHash` 일치를 확인하지만 `users`가 공개 read라
  남 대신 제출(그리핑)은 완전 차단되지 않는다(베팅·주식판과 동일 한계). 자기 이득은 막힌다.
- 전 제출은 `submissions`, 지급은 `ledger`에 남아 사후 감사 가능.
