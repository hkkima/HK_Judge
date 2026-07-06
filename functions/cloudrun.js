// Cloud Run C# 채점 러너 클라이언트(1차 채점 백엔드).
//   JUDGE_URL 이 설정돼 있을 때만 사용. 공유 시크릿(JUDGE_SHARED_SECRET) 헤더로 인증.
//   러너 응답 { compileError, compileOutput, stdout, stderr, timedOut, exitCode } →
//   내부 판정 형태 { compileCode, compileOutput, stdout, stderr, code, signal, timedOut } 로 변환.

const JUDGE_URL = (process.env.JUDGE_URL || '').replace(/\/$/, '');
const SECRET = process.env.JUDGE_SHARED_SECRET || '';

export function cloudRunConfigured() {
  return !!JUDGE_URL;
}

export async function cloudRunRun({ code, stdin = '', runTimeoutMs = 8000 }) {
  const res = await fetch(`${JUDGE_URL}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(SECRET ? { 'X-Judge-Secret': SECRET } : {}),
    },
    body: JSON.stringify({ code: String(code ?? ''), stdin: String(stdin ?? ''), runTimeoutMs }),
  });
  if (!res.ok) throw new Error(`judge runner ${res.status}`);
  const d = await res.json();
  return {
    compileCode: d.compileError ? 1 : 0,
    compileOutput: d.compileOutput || '',
    stdout: d.stdout || '',
    stderr: d.stderr || '',
    code: Number.isFinite(Number(d.exitCode)) ? Number(d.exitCode) : 0,
    signal: d.timedOut ? 'KILL' : '',
    timedOut: !!d.timedOut,
  };
}
