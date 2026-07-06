import { useMemo, useState, useEffect } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { runCode, submitSolution } from '../data/store.js';
import { Markdown } from '../lib/markdown.jsx';

const VERDICT_KO = {
  accepted: '정답',
  wrong_answer: '오답',
  compile_error: '컴파일 에러',
  runtime_error: '런타임 에러',
  time_limit: '시간 초과',
};

// 코드 편집 textarea — Tab 키로 들여쓰기(스페이스 4칸).
function CodeEditor({ value, onChange }) {
  function onKeyDown(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.target;
      const s = el.selectionStart; const en = el.selectionEnd;
      const next = value.slice(0, s) + '    ' + value.slice(en);
      onChange(next);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 4; });
    }
  }
  return (
    <textarea
      className="code-editor mono"
      spellCheck={false}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}

export default function SolvePage({ problemId, onBack }) {
  const { problems, session, solvedSet } = useApp();
  const problem = useMemo(() => problems.find((p) => p.id === problemId), [problems, problemId]);
  const isParticipant = session.role === 'participant';
  const alreadySolved = isParticipant && solvedSet.has(problemId);

  const [code, setCode] = useState('');
  const [stdin, setStdin] = useState('');
  const [runOut, setRunOut] = useState(null); // { stdout, stderr, compileOutput, compileError, timedOut }
  const [submitRes, setSubmitRes] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  // 문제가 로드되면 템플릿 코드로 초기화(사용자가 아직 안 건드렸을 때).
  useEffect(() => {
    if (problem) setCode(problem.templateCode || '');
    setRunOut(null); setSubmitRes(null); setErr('');
    // 첫 공개 예제 입력을 stdin 기본값으로.
    setStdin(problem?.samples?.[0]?.input || '');
  }, [problemId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!problem) {
    return (
      <div className="card">
        <button className="ghost" onClick={onBack}>← 목록</button>
        <p className="muted" style={{ marginTop: 10 }}>문제를 찾을 수 없습니다.</p>
      </div>
    );
  }

  async function doRun() {
    setErr(''); setRunOut(null); setBusy('run');
    try {
      const res = await runCode({ code, stdin });
      setRunOut(res);
    } catch (e) { setErr(e.message); }
    finally { setBusy(''); }
  }

  async function doSubmit() {
    setErr(''); setSubmitRes(null); setBusy('submit');
    try {
      const res = await submitSolution({
        userId: session.userId, pinHash: session.pinHash, problemId, code,
      });
      setSubmitRes(res);
    } catch (e) { setErr(e.message); }
    finally { setBusy(''); }
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="ghost" onClick={onBack}>← 목록</button>
        <h3 style={{ margin: 0 }}>{problem.title}</h3>
        {alreadySolved && <span className="pill solved-pill">✓ 해결함</span>}
        <div className="spacer" />
        <span className="reward mono">🏅 {(problem.reward || 0).toLocaleString()} P</span>
        <span className="muted">· {problem.timeLimitSec || 1}초 · {problem.memoryLimitMb || 128}MB</span>
      </div>

      <div className="solve-layout">
        {/* 좌: 문제 설명 + 공개 예제 */}
        <div className="card statement">
          <Markdown source={problem.statement} />
          {Array.isArray(problem.samples) && problem.samples.length > 0 && (
            <div className="samples">
              <div className="section-title">공개 예제</div>
              {problem.samples.map((s, i) => (
                <div key={i} className="sample">
                  <div className="sample-col">
                    <div className="sample-lbl">입력</div>
                    <pre className="io">{s.input || '(없음)'}</pre>
                  </div>
                  <div className="sample-col">
                    <div className="sample-lbl">기대 출력</div>
                    <pre className="io">{s.expected}</pre>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 우: 코드 에디터 + 실행/제출 */}
        <div className="card editor-col">
          <div className="section-title" style={{ marginTop: 0 }}>C# 코드</div>
          <CodeEditor value={code} onChange={setCode} />

          <div className="section-title">표준 입력 (실행 테스트용)</div>
          <textarea
            className="stdin-box mono"
            value={stdin}
            spellCheck={false}
            onChange={(e) => setStdin(e.target.value)}
            placeholder="여기에 입력값을 넣고 [실행]으로 테스트"
          />

          <div className="row" style={{ marginTop: 10 }}>
            <button className="ghost" onClick={doRun} disabled={!!busy}>
              {busy === 'run' ? '실행 중…' : '▶ 실행'}
            </button>
            <button className="primary" onClick={doSubmit} disabled={!!busy || !isParticipant}>
              {busy === 'submit' ? '채점 중…' : '제출하고 채점'}
            </button>
            {!isParticipant && <span className="muted">제출은 [로그인] 후 가능합니다.</span>}
          </div>

          {err && <p className="err" style={{ marginTop: 8 }}>{err}</p>}

          {/* 실행 결과 */}
          {runOut && (
            <div className="out-panel">
              <div className="section-title">실행 결과</div>
              {runOut.compileError ? (
                <pre className="io err-io">{runOut.compileOutput || '컴파일 에러'}</pre>
              ) : (
                <>
                  <pre className="io">{runOut.stdout || '(출력 없음)'}</pre>
                  {runOut.stderr && <pre className="io err-io">{runOut.stderr}</pre>}
                  {runOut.timedOut && <p className="err">시간 초과</p>}
                </>
              )}
            </div>
          )}

          {/* 채점 결과 */}
          {submitRes && (
            <div className="out-panel">
              <div className="section-title">채점 결과</div>
              <div className={`verdict ${submitRes.allPassed ? 'ok' : 'err'}`}>
                {submitRes.allPassed ? '🎉 전부 통과!' : '아쉬워요'} — {submitRes.passed}/{submitRes.total} 통과
              </div>
              {submitRes.awarded && (
                <div className="award">🏅 +{(submitRes.reward || 0).toLocaleString()} P 지급! (현재 {(submitRes.newBalance || 0).toLocaleString()} P)</div>
              )}
              {submitRes.allPassed && submitRes.alreadySolved && (
                <div className="muted">이미 해결한 문제라 포인트는 지급되지 않았습니다.</div>
              )}
              <table className="tbl case-tbl">
                <thead>
                  <tr><th>#</th><th>결과</th><th>비고</th></tr>
                </thead>
                <tbody>
                  {submitRes.results.map((r) => (
                    <tr key={r.index}>
                      <td>{r.index + 1}{r.hidden ? ' 🔒' : ''}</td>
                      <td className={r.verdict === 'accepted' ? 'ok' : 'err'}>{VERDICT_KO[r.verdict] || r.verdict}</td>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {r.verdict === 'compile_error' && (r.compileOutput ? r.compileOutput.split('\n')[0] : '')}
                        {!r.hidden && r.verdict === 'wrong_answer' && (
                          <span>기대 <code className="md-code">{r.expected}</code> / 출력 <code className="md-code">{r.got || '∅'}</code></span>
                        )}
                        {r.hidden && r.verdict !== 'accepted' && r.verdict !== 'compile_error' && '숨은 케이스'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
