// Wandbox 공개 컴파일 API 클라이언트 (wandbox.org).
//   - 키 불필요. C#(mono) + stdin 지원. 동기 응답(compile+run 한 번에).
//   - 공개 커뮤니티 서비스라 호출당 지연이 크고(mono ~5-8s) 과도한 병렬은 예의에 어긋남.
//     대규모/저지연이 필요하면 자체 호스팅(Wandbox 또는 Judge0/Piston)으로 URL만 교체.
//
//   ※ Piston 공개 API는 2026-02-15부터 화이트리스트 전용이 되어 사용 불가 → Wandbox로 대체.

const WANDBOX_URL = process.env.WANDBOX_URL || 'https://wandbox.org/api/compile.json';
// mono 가 dotnetcore 보다 공개 인스턴스에서 안정적(dotnetcore-8 은 build 단계에서 간헐 실패).
const CSHARP_COMPILER = process.env.WANDBOX_CSHARP || 'mono-6.12.0.199';

// 코드 1회 컴파일+실행. 결과를 판정용 형태로 정규화.
//   returns { compileCode, compileOutput, stdout, stderr, code, signal, timedOut }
export async function runOnce({ code, stdin = '' }) {
  const res = await fetch(WANDBOX_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      compiler: CSHARP_COMPILER,
      code: String(code ?? ''),
      stdin: String(stdin ?? ''),
    }),
  });
  if (res.status === 429) throw new Error('채점 서버가 혼잡합니다(rate limit). 잠시 후 다시 시도하세요.');
  if (!res.ok) throw new Error(`Wandbox 실행 실패 (${res.status})`);
  const d = await res.json();

  const compilerErr = d.compiler_error || '';
  const stdout = d.program_output || '';
  const stderr = d.program_error || '';
  const status = Number(d.status);
  const signal = d.signal || '';

  // 컴파일 실패 판정: 컴파일러 에러가 있고 프로그램이 전혀 실행되지 않음(출력 없음) & 종료코드 비정상.
  const compileFailed = !!compilerErr && stdout === '' && stderr === '' && status !== 0;
  // 시간 초과 판정: 시그널로 강제 종료(KILL/XCPU 등).
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

// 출력 비교용 정규화: CRLF 통일 → 각 줄 오른쪽 공백 제거 → 끝 빈 줄 제거.
export function normalizeOutput(s) {
  return String(s ?? '')
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
