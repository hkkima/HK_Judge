#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// HK_Judge 문제 일괄 임포트 도구
//   마크다운(여러 문제) → Firestore(problems/{id} + problemTests/{id}) 로 업서트.
//   운영자가 upsertProblem 함수로 하나씩 넣는 것과 동일한 문서 형태를 Admin SDK로 직접 기록.
//
// 마크다운 양식(문제마다 반복):
//   # 문제 N. 제목
//   ## 문제 설명 ... / ## 입력 형식 / ## 출력 형식 / ## 예제 입력 / ## 예제 출력 / ## 힌트
//   ### 템플릿 코드            ← 바로 뒤 ```csharp ... ``` 코드블록이 템플릿
//   ### 테스트 케이스          ← 바로 뒤 | # | 입력 | 출력 | 표. 셀은 <br>=줄바꿈, 백틱은 제거.
//   (표의 첫 행 = 공개 예제, 나머지 = 비공개)
//   문제 사이 `---` 나 상단 소개 블록은 무시(# 문제 로 시작하는 블록만 인식).
//
// 사용:
//   node tools/import-problems.mjs --file <md> --prefix <id접두> --reward <P> [--start-order N] [--time N] [--mem N] [--dry-run] [--key <sa.json>]
// 예:
//   node tools/import-problems.mjs --file examples/set2-conditionals.md --prefix cond --reward 1000 --start-order 11
// ─────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';

const BOOL_FLAGS = new Set(['dry-run', 'dot-as-space']);

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t.startsWith('--')) continue;
    const key = t.slice(2);
    if (BOOL_FLAGS.has(key)) a[key] = true;
    else { a[key] = argv[i + 1]; i += 1; }
  }
  return a;
}

// 셀 정리: <br> 로 줄 분리 후, 각 줄이 백틱으로 감싸였으면 그 '안쪽'을 그대로 취한다
//   (선행/후행 공백 보존 — 별찍기 등 공백이 유의미한 출력에 필수). 백틱이 없으면 트림.
//   dotAsSpace=true 면 가운뎃점(·, U+00B7) 을 실제 공백으로 치환(표에서 공백을 ·로 표기한 경우).
function cell(s, dotAsSpace = false) {
  const out = String(s)
    .split(/<br\s*\/?>/gi)
    .map((part) => {
      const m = part.match(/`([^`]*)`/); // 첫 백틱 구간의 내용(내부 공백 보존)
      return m ? m[1] : part.trim();
    })
    .join('\n');
  return dotAsSpace ? out.replace(/·/g, ' ') : out;
}

// # 문제 N. 제목  →  "제목"
function parseTitle(line) {
  return line.replace(/^#+\s*/, '').replace(/^문제\s*\d+\s*[.)．]?\s*/, '').trim();
}

// 헤딩 텍스트에 keyword 가 포함된 첫 줄 index(블록 내 상대). 없으면 -1.
function findHeading(lines, keyword, from = 0) {
  for (let i = from; i < lines.length; i += 1) {
    if (/^#{1,6}\s/.test(lines[i]) && lines[i].includes(keyword)) return i;
  }
  return -1;
}

// idx 이후 첫 ``` 코드블록 내용. 없으면 ''.
function fencedAfter(lines, idx) {
  let i = idx;
  while (i < lines.length && !/^\s*```/.test(lines[i])) i += 1;
  if (i >= lines.length) return '';
  const buf = [];
  i += 1;
  while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i += 1; }
  return buf.join('\n').replace(/\s+$/, '') + '\n';
}

// idx 이후 첫 마크다운 표 → [{input, expected}] (행 순서 유지).
function tableAfter(lines, idx, dotAsSpace = false) {
  const rows = [];
  let i = idx;
  // 표 시작(| 로 시작하는 줄)까지 이동
  while (i < lines.length && !/^\s*\|/.test(lines[i])) i += 1;
  for (; i < lines.length; i += 1) {
    const ln = lines[i];
    if (!/^\s*\|/.test(ln)) { if (rows.length) break; else continue; }
    const cells = ln.split('|').slice(1, -1).map((c) => c.trim());
    // 구분선(---) 스킵
    if (cells.every((c) => /^:?-+:?$/.test(c) || c === '')) continue;
    // 헤더행 스킵(입력/출력 헤더)
    if (cells.some((c) => c === '입력' || c === '출력' || c === '#')) continue;
    if (cells.length < 3) continue;
    rows.push({ input: cell(cells[1], dotAsSpace), expected: cell(cells[2], dotAsSpace) });
  }
  return rows;
}

function parseProblems(md, dotAsSpace = false) {
  const all = md.replace(/\r\n/g, '\n').split('\n');
  // 문제 시작 줄 인덱스(# 문제 …)
  const starts = [];
  for (let i = 0; i < all.length; i += 1) if (/^#\s+문제\s*\d+/.test(all[i])) starts.push(i);
  const problems = [];
  for (let s = 0; s < starts.length; s += 1) {
    const from = starts[s];
    const to = s + 1 < starts.length ? starts[s + 1] : all.length;
    const block = all.slice(from, to);
    const title = parseTitle(block[0]);

    const tplIdx = findHeading(block, '템플릿 코드');
    const tcIdx = findHeading(block, '테스트 케이스');
    const stmtEnd = tplIdx !== -1 ? tplIdx : (tcIdx !== -1 ? tcIdx : block.length);
    const statement = block.slice(1, stmtEnd).join('\n').trim() + '\n';

    const templateCode = tplIdx !== -1 ? fencedAfter(block, tplIdx) : '';
    const tests = tcIdx !== -1 ? tableAfter(block, tcIdx, dotAsSpace) : [];

    problems.push({ title, statement, templateCode, tests });
  }
  return problems;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file || !args.prefix || args.reward === undefined) {
    console.error('필수 인자: --file <md> --prefix <id접두> --reward <P> [--start-order N] [--time N] [--mem N] [--dry-run] [--key <sa.json>]');
    process.exit(1);
  }
  const reward = Math.max(0, Math.floor(Number(args.reward)));
  const startOrder = Number.isFinite(Number(args['start-order'])) ? Number(args['start-order']) : 1;
  const timeLimitSec = Math.min(10, Math.max(1, Math.floor(Number(args.time) || 1)));
  const memoryLimitMb = Math.min(512, Math.max(16, Math.floor(Number(args.mem) || 128)));

  const md = readFileSync(args.file, 'utf8');
  const parsed = parseProblems(md, !!args['dot-as-space']);
  if (parsed.length === 0) { console.error('문제를 찾지 못했습니다(“# 문제 N. …” 헤딩 필요).'); process.exit(1); }

  // 유효성 점검
  const prepared = parsed.map((p, i) => {
    const order = startOrder + i;
    const id = `${args.prefix}-${String(order).padStart(2, '0')}`;
    const tests = p.tests.map((t, k) => ({ input: t.input, expected: t.expected, hidden: k !== 0 }));
    return { id, order, ...p, tests };
  });

  console.log(`파싱된 문제: ${prepared.length}개 (reward=${reward}, order ${startOrder}~${startOrder + prepared.length - 1})`);
  for (const p of prepared) {
    const problem = p.tests.length === 0 ? '  ⚠️ 테스트케이스 없음' : '';
    console.log(`  ${p.id}  "${p.title}"  tests=${p.tests.length} (공개 ${p.tests.filter((t) => !t.hidden).length})  tpl=${p.templateCode ? 'O' : 'X'}${problem}`);
  }
  const bad = prepared.filter((p) => p.tests.length === 0);
  if (bad.length) { console.error('테스트케이스가 없는 문제가 있어 중단합니다.'); process.exit(1); }

  if (args['dry-run']) {
    console.log('\n--dry-run: 쓰지 않고 종료. 각 문제의 테스트케이스(공백은 JSON 이스케이프로 확인):');
    for (const p of prepared) {
      console.log(`\n### ${p.id} "${p.title}"`);
      p.tests.forEach((t) => console.log(`  ${t.hidden ? '비공개' : '공개  '} in=${JSON.stringify(t.input)}  out=${JSON.stringify(t.expected)}`));
    }
    process.exit(0);
  }

  const KEY = args.key || process.env.FIREBASE_SA_KEY || 'C:/HK_Bot/hk-chess-betting-firebase-adminsdk-fbsvc-018b7a64ea.json';
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  initializeApp({ credential: cert(JSON.parse(readFileSync(KEY, 'utf8'))) });
  const db = getFirestore();

  for (const p of prepared) {
    const samples = p.tests.filter((t) => !t.hidden).map((t) => ({ input: t.input, expected: t.expected }));
    const now = FieldValue.serverTimestamp();
    const pRef = db.doc(`problems/${p.id}`);
    const exists = (await pRef.get()).exists;
    await pRef.set({
      title: p.title,
      statement: p.statement,
      templateCode: p.templateCode,
      timeLimitSec, memoryLimitMb, reward,
      order: p.order,
      testCount: p.tests.length,
      samples,
      updatedAt: now,
      ...(exists ? {} : { createdAt: now }),
    }, { merge: true });
    await db.doc(`problemTests/${p.id}`).set({ cases: p.tests }, { merge: false });
    console.log(`${exists ? 'updated' : 'created'}: ${p.id}  "${p.title}"`);
  }
  console.log('done');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
