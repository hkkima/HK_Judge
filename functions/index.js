// ─────────────────────────────────────────────────────────────
// 코딩 문제판 권위(authoritative) Cloud Functions.
//   - runCode        : 학습자 코드 1회 실행(테스트용, 포인트 없음)
//   - submitSolution : 채점(숨은 테스트케이스) + 최초 정답 시 포인트 지급
//   - upsertProblem  : 운영자 문제 출제/수정
//   - deleteProblem  : 운영자 문제 삭제
//   모든 포인트 변동은 여기서만(Admin SDK → 규칙 우회). 클라는 읽기만.
//
//   ★ 배포 주의(공유 프로젝트) ★
//   같은 프로젝트에 주식판 함수가 이미 있으므로 반드시 함수명을 지정해 배포한다.
//   (아무 필터 없이 `--only functions` 하면 주식판 함수가 삭제됨.)
//     firebase deploy \
//       --only functions:runCode,functions:submitSolution,functions:upsertProblem,functions:deleteProblem,firestore:rules \
//       --project hk-chess-betting
// ─────────────────────────────────────────────────────────────
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { runOnce, normalizeOutput, mapPool } from './wandbox.js';

// ★ 프론트 VITE_FUNCTIONS_REGION 및 주식판과 일치(서울 리전) ★
setGlobalOptions({ region: 'asia-northeast3' });

initializeApp();
const db = getFirestore();

// 운영자 이메일 — ★ 프론트 VITE_ADMIN_EMAILS 및 firestore.rules 와 일치 ★
const ADMIN_EMAILS = ['jetsomk22@gmail.com'];

const boardRef = () => db.doc('meta/stockBoard'); // 베팅·주식판과 공유하는 하우스 풀
const solvedId = (userId, problemId) => `${userId}__${problemId}`;

function assertAuth(req) {
  if (!req.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
}
function assertAdmin(req) {
  const t = req.auth?.token || {};
  if (t.admin === true) return;
  const email = t.email;
  if (!email || !ADMIN_EMAILS.includes(String(email).toLowerCase())) {
    throw new HttpsError('permission-denied', '운영자만 가능합니다.');
  }
}

// 코드 안전 상한(악성/무한 페이로드 방지).
const MAX_CODE_LEN = 20000;
function checkCode(code) {
  const s = String(code ?? '');
  if (!s.trim()) throw new HttpsError('invalid-argument', '코드가 비어 있습니다.');
  if (s.length > MAX_CODE_LEN) throw new HttpsError('invalid-argument', '코드가 너무 깁니다.');
  return s;
}

// 한 케이스 실행 결과를 판정으로 변환.
function judgeOne(result, expected) {
  if (result.compileCode !== 0) {
    return { verdict: 'compile_error', ok: false };
  }
  if (result.timedOut) return { verdict: 'time_limit', ok: false };
  if (result.code !== 0 || result.signal) return { verdict: 'runtime_error', ok: false };
  const ok = normalizeOutput(result.stdout) === normalizeOutput(expected);
  return { verdict: ok ? 'accepted' : 'wrong_answer', ok };
}

// ── 학습자: 코드 1회 실행 (테스트, 포인트 없음) ─────────────
export const runCode = onCall({ timeoutSeconds: 120 }, async (req) => {
  assertAuth(req);
  const { code, stdin } = req.data || {};
  const src = checkCode(code);
  const r = await runOnce({ code: src, stdin: String(stdin ?? '') });
  return {
    compileOutput: r.compileOutput,
    compileError: r.compileCode !== 0,
    stdout: r.stdout,
    stderr: r.stderr,
    timedOut: r.timedOut,
    exitCode: r.code,
  };
});

// ── 학습자: 제출 → 채점 → 최초 정답 시 포인트 지급 ──────────
//   Wandbox 는 호출당 수 초가 걸리므로 timeout 을 넉넉히(케이스 병렬 채점).
export const submitSolution = onCall({ timeoutSeconds: 300, memory: '512MiB' }, async (req) => {
  assertAuth(req);
  const { userId, pinHash, problemId, code } = req.data || {};
  const src = checkCode(code);
  if (!userId || !problemId) throw new HttpsError('invalid-argument', 'userId/problemId 누락.');

  // 신원 확인(다른 사람 대신 제출 방지). users 는 공개 read 라 완전하진 않으나
  //   자기 이득(포인트)은 이 검증 + solved 표식으로 통제.
  const uSnap = await db.doc(`users/${userId}`).get();
  if (!uSnap.exists) throw new HttpsError('not-found', '계정을 찾을 수 없습니다.');
  const user = uSnap.data();
  if (user.pinHash && pinHash !== user.pinHash) {
    throw new HttpsError('permission-denied', 'PIN이 일치하지 않습니다.');
  }

  const pSnap = await db.doc(`problems/${problemId}`).get();
  if (!pSnap.exists) throw new HttpsError('not-found', '문제를 찾을 수 없습니다.');
  const problem = pSnap.data();
  const tSnap = await db.doc(`problemTests/${problemId}`).get();
  const cases = (tSnap.exists && Array.isArray(tSnap.data().cases)) ? tSnap.data().cases : [];
  if (cases.length === 0) throw new HttpsError('failed-precondition', '이 문제에는 테스트케이스가 없습니다.');

  // 한 케이스 실행 결과 → 응답 객체(숨은 케이스는 입출력 미포함).
  const toResult = (r, c, i) => {
    const j = judgeOne(r, c.expected);
    return {
      index: i,
      verdict: j.verdict,
      hidden: !!c.hidden,
      // 정보 노출 최소화: 숨은 케이스는 입출력 미포함, 공개 케이스만 상세 제공.
      ...(c.hidden ? {} : {
        input: String(c.input ?? ''),
        expected: normalizeOutput(c.expected),
        got: normalizeOutput(r.stdout),
      }),
      ...(j.verdict === 'compile_error' ? { compileOutput: r.compileOutput } : {}),
    };
  };

  // 첫 케이스 먼저 실행 → 컴파일 에러면 나머지 실행 없이 즉시 종료(같은 코드라 결과 동일).
  //   그 외에는 나머지 케이스를 동시성 4로 병렬 채점(Wandbox 지연 상쇄).
  let results;
  const first = await runOnce({ code: src, stdin: String(cases[0].input ?? '') });
  if (first.compileCode !== 0) {
    results = [toResult(first, cases[0], 0)];
  } else {
    const rest = await mapPool(cases.slice(1), 4, async (c, k) => {
      const r = await runOnce({ code: src, stdin: String(c.input ?? '') });
      return toResult(r, c, k + 1);
    });
    results = [toResult(first, cases[0], 0), ...rest];
  }
  const passed = results.filter((r) => r.verdict === 'accepted').length;

  const total = cases.length;
  const allPassed = passed === total;
  const reward = Math.max(0, Math.floor(Number(problem.reward) || 0));

  let awarded = false;
  let alreadySolved = false;
  let newBalance = user.balance || 0;

  if (allPassed) {
    // 최초 정답만 지급(멱등). solved 문서 유무를 트랜잭션에서 원자적으로 확인.
    const outcome = await db.runTransaction(async (tx) => {
      const sRef = db.doc(`solved/${solvedId(userId, problemId)}`);
      const uRef = db.doc(`users/${userId}`);
      const [sSnap2, uSnap2] = await Promise.all([tx.get(sRef), tx.get(uRef)]);
      const bal = (uSnap2.data()?.balance) || 0;
      if (sSnap2.exists) return { awarded: false, alreadySolved: true, newBalance: bal };
      const newBal = bal + reward;
      tx.set(sRef, { userId, problemId, reward, ts: FieldValue.serverTimestamp() });
      if (reward > 0) {
        tx.update(uRef, { balance: newBal });
        // 하우스 풀에서 지급(총량 보존 — 배당과 동일한 회계).
        tx.set(boardRef(), { housePool: FieldValue.increment(-reward) }, { merge: true });
        tx.set(db.collection('ledger').doc(), {
          userId, problemId, type: 'quiz_reward', delta: reward, ts: FieldValue.serverTimestamp(),
        });
      }
      return { awarded: reward > 0, alreadySolved: false, newBalance: newBal };
    });
    awarded = outcome.awarded;
    alreadySolved = outcome.alreadySolved;
    newBalance = outcome.newBalance;
  }

  // 제출 이력 기록(감사용). 코드 원문도 보관(운영자 확인).
  await db.collection('submissions').add({
    userId, problemId, passed, total,
    verdict: allPassed ? 'accepted' : (results[0]?.verdict === 'compile_error' ? 'compile_error' : 'failed'),
    code: src.slice(0, MAX_CODE_LEN),
    ts: FieldValue.serverTimestamp(),
  });

  return { passed, total, allPassed, results, awarded, alreadySolved, reward, newBalance };
});

// ── 운영자: 문제 출제/수정 ──────────────────────────────────
//   problems/{id}         : 공개 메타(제목·설명·템플릿·공개 예제)
//   problemTests/{id}     : 채점용 전체 케이스(정답 포함) — 운영자만 read
export const upsertProblem = onCall(async (req) => {
  assertAdmin(req);
  const d = req.data || {};
  const id = String(d.id || '').trim() || db.collection('problems').doc().id;
  const title = String(d.title || '').trim();
  if (!title) throw new HttpsError('invalid-argument', '제목이 필요합니다.');

  const tests = Array.isArray(d.tests) ? d.tests : [];
  const cleanTests = tests
    .map((t) => ({
      input: String(t.input ?? ''),
      expected: String(t.expected ?? ''),
      hidden: !!t.hidden,
    }))
    .filter((t) => t.expected.length > 0 || t.input.length > 0);
  if (cleanTests.length === 0) {
    throw new HttpsError('invalid-argument', '테스트케이스가 최소 1개 필요합니다.');
  }

  const timeLimitSec = Math.min(10, Math.max(1, Math.floor(Number(d.timeLimitSec) || 1)));
  const memoryLimitMb = Math.min(512, Math.max(16, Math.floor(Number(d.memoryLimitMb) || 128)));
  const reward = Math.max(0, Math.floor(Number(d.reward) || 0));
  const order = Number.isFinite(Number(d.order)) ? Number(d.order) : Date.now();

  // 공개 예제(비공개=false 인 케이스)만 학습자에게 노출.
  const samples = cleanTests
    .filter((t) => !t.hidden)
    .map((t) => ({ input: t.input, expected: t.expected }));

  const now = FieldValue.serverTimestamp();
  const pRef = db.doc(`problems/${id}`);
  const exists = (await pRef.get()).exists;
  await pRef.set({
    title,
    statement: String(d.statement || ''),
    templateCode: String(d.templateCode || ''),
    timeLimitSec, memoryLimitMb, reward, order,
    testCount: cleanTests.length,
    samples,
    updatedAt: now,
    ...(exists ? {} : { createdAt: now }),
  }, { merge: true });

  // 정답이 담긴 전체 케이스는 분리 컬렉션(운영자만 read).
  await db.doc(`problemTests/${id}`).set({ cases: cleanTests }, { merge: false });

  return { id };
});

// ── 운영자: 문제 삭제 ───────────────────────────────────────
export const deleteProblem = onCall(async (req) => {
  assertAdmin(req);
  const id = String(req.data?.id || '').trim();
  if (!id) throw new HttpsError('invalid-argument', 'id가 필요합니다.');
  await Promise.all([
    db.doc(`problems/${id}`).delete(),
    db.doc(`problemTests/${id}`).delete(),
  ]);
  return { id };
});
