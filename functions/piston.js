// Piston 공개 실행 API 클라이언트 (emkc.org).
//   - 키 불필요. C#(mono) + stdin 지원. 공개 인스턴스는 대략 초당 5건 rate limit.
//   - Node 20 전역 fetch 사용(함수 런타임 nodejs20).
//   자체 호스팅 Piston 으로 바꾸려면 PISTON_URL 환경변수만 교체하면 된다.

const PISTON_URL = process.env.PISTON_URL || 'https://emkc.org/api/v2/piston';

let cachedRuntime = null; // { language, version }

// C# 런타임 하나를 골라 캐시. mono('csharp')를 우선, 없으면 .NET.
async function resolveCsharpRuntime() {
  if (cachedRuntime) return cachedRuntime;
  const res = await fetch(`${PISTON_URL}/runtimes`);
  if (!res.ok) throw new Error(`Piston runtimes 조회 실패 (${res.status})`);
  const list = await res.json();
  const isCs = (r) =>
    r.language === 'csharp' ||
    (Array.isArray(r.aliases) && (r.aliases.includes('csharp') || r.aliases.includes('cs')));
  const pick =
    list.find((r) => r.language === 'csharp') ||
    list.find(isCs) ||
    list.find((r) => r.language === 'csharp.net') ||
    list.find((r) => String(r.language).includes('csharp'));
  if (!pick) throw new Error('Piston 에서 C# 런타임을 찾지 못했습니다.');
  cachedRuntime = { language: pick.language, version: pick.version };
  return cachedRuntime;
}

// 코드 1회 실행. { compile, run } 형태의 Piston 결과를 정규화해 돌려준다.
//   returns { compileOutput, stdout, stderr, code, signal, timedOut }
export async function pistonRun({ code, stdin = '', runTimeoutMs = 3000, compileTimeoutMs = 10000 }) {
  const rt = await resolveCsharpRuntime();
  const body = {
    language: rt.language,
    version: rt.version,
    files: [{ name: 'main.cs', content: String(code ?? '') }],
    stdin: String(stdin ?? ''),
    compile_timeout: compileTimeoutMs,
    run_timeout: runTimeoutMs,
  };
  const res = await fetch(`${PISTON_URL}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 429) throw new Error('채점 서버가 잠시 혼잡합니다(rate limit). 잠시 후 다시 시도하세요.');
  if (!res.ok) throw new Error(`Piston 실행 실패 (${res.status})`);
  const data = await res.json();
  const compile = data.compile || null;
  const run = data.run || {};
  return {
    compileOutput: compile ? `${compile.stdout || ''}${compile.stderr || ''}`.trim() : '',
    compileCode: compile ? compile.code : 0,
    stdout: run.stdout || '',
    stderr: run.stderr || '',
    code: run.code,
    signal: run.signal || null,
    // Piston 은 run_timeout 초과 시 signal 'SIGKILL' 등을 준다.
    timedOut: run.signal === 'SIGKILL' && (run.stdout || '') === '',
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

// ms 단위 대기 (rate limit 완화용).
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
