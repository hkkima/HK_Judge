// Wandbox 공개 컴파일 API 클라이언트 (wandbox.org).
//   - 키 불필요. C# `mono-6.12.0.199` + stdin 지원. 동기 응답(compile+run 한 번에).
//   - 공개 커뮤니티 서비스라 (a) 호출당 지연이 크고(~5-8s), (b) 컨테이너 스폰 실패(OCI
//     "Resource temporarily unavailable", status 126 등)가 간헐 발생 → 재시도로 흡수.
//   - mono 는 컨테이너 로케일이 C 라 비ASCII 출력을 '?'로 바꿔버림 → Main 진입 직후
//     Console.OutputEncoding 을 UTF-8(BOM 없음)로 강제 주입해 한글 등 정상 출력.
//
//   ※ Piston 공개 API는 2026-02-15부터 화이트리스트 전용 → 사용 불가. dotnetcore/Paiza.IO는
//     Wandbox에서 불안정(build 실패/504) → mono 채택. 대규모/저지연은 자체 호스팅 권장.

const WANDBOX_URL = process.env.WANDBOX_URL || 'https://wandbox.org/api/compile.json';
const CSHARP_COMPILER = process.env.WANDBOX_CSHARP || 'mono-6.12.0.199';

// 인프라성(일시적) 실패 신호 — 코드 결과가 아니라 컨테이너/게이트웨이 문제.
const TRANSIENT = /OCI runtime|Resource temporarily|crun:|runc:|cannot allocate|too many open files|error code:\s*5\d\d|clone:|no space left|not create|failed to/i;
// Wandbox 공개 인스턴스는 수십 초짜리 불안정 구간이 생김 → 지수 백오프+지터로 그 구간을 넘긴다.
const MAX_ATTEMPTS = 6;
function backoffMs(attempt) {
  return Math.min(8000, 2 ** (attempt - 1) * 800) + Math.floor(Math.random() * 400);
}

// mono 한글 깨짐 방지: Main 진입 직후 출력 인코딩을 UTF-8(BOM 없이)로 설정.
//   같은 줄에 삽입하므로 컴파일 에러 줄번호는 보존된다. Main 을 못 찾으면 원본 유지(ASCII 문제엔 무해).
function prepareCode(src) {
  const s = String(src ?? '');
  const inject = 'try{System.Console.OutputEncoding=new System.Text.UTF8Encoding(false);}catch{}';
  const re = /(static\s+(?:async\s+)?(?:void|int|System\.Threading\.Tasks\.Task)\s+Main\s*\([^)]*\)\s*)\{/;
  return re.test(s) ? s.replace(re, `$1{${inject}`) : s;
}

// 코드 1회 컴파일+실행(일시 실패는 재시도). 결과를 판정용 형태로 정규화.
//   returns { compileCode, compileOutput, stdout, stderr, code, signal, timedOut }
export async function runOnce({ code, stdin = '' }) {
  const body = JSON.stringify({
    compiler: CSHARP_COMPILER,
    code: prepareCode(code),
    stdin: String(stdin ?? ''),
  });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let res;
    try {
      res = await fetch(WANDBOX_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch (e) {
      if (attempt === MAX_ATTEMPTS) throw new Error('채점 서버(Wandbox)에 연결하지 못했습니다.');
      await sleep(backoffMs(attempt)); continue;
    }

    if (res.status >= 500 || res.status === 429) {
      if (attempt === MAX_ATTEMPTS) throw new Error(`채점 서버가 혼잡합니다 (${res.status}). 잠시 후 다시 시도하세요.`);
      await sleep(backoffMs(attempt)); continue;
    }
    if (!res.ok) throw new Error(`Wandbox 실행 실패 (${res.status})`);

    const d = await res.json();
    const compilerErr = d.compiler_error || '';
    const stdout = d.program_output || '';
    const stderr = d.program_error || '';
    const status = Number(d.status);
    const signal = d.signal || '';

    // 인프라성 실패면 재시도(코드 결과가 아님).
    if (TRANSIENT.test(compilerErr) && stdout === '') {
      if (attempt === MAX_ATTEMPTS) throw new Error('채점 서버(Wandbox)가 일시적으로 불안정합니다. 잠시 후 다시 시도해 주세요.');
      await sleep(backoffMs(attempt)); continue;
    }

    // 컴파일 실패 판정: 컴파일러 에러가 있고 실행 흔적이 전혀 없음 & 종료코드 비정상.
    const compileFailed = !!compilerErr && stdout === '' && stderr === '' && status !== 0;
    const timedOut = /kill|xcpu|term|cpu/i.test(signal);

    return {
      compileCode: compileFailed ? 1 : 0,
      compileOutput: compilerErr,
      stdout,
      stderr,
      code: Number.isFinite(status) ? status : (stderr || signal ? 1 : 0),
      signal,
      timedOut,
    };
  }
  throw new Error('채점 서버(Wandbox)가 일시적으로 불안정합니다. 잠시 후 다시 시도해 주세요.');
}

// 출력 비교용 정규화: 앞 BOM 제거 → CRLF 통일 → 각 줄 오른쪽 공백 제거 → 끝 빈 줄 제거.
export function normalizeOutput(s) {
  return String(s ?? '')
    .replace(/^﻿/, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
}

// 배열을 동시성 제한(limit)으로 순서 보존 실행. fn(item, index) → 결과.
export async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next; next += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return out;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
