import { useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { upsertProblem, deleteProblem, getProblemTests } from '../data/store.js';
import { Markdown } from '../lib/markdown.jsx';

const DEFAULT_TEMPLATE = `using System;

public class Program
{
    public static void Main()
    {
        // 입력 받기
    }
}
`;

const DEFAULT_STATEMENT = `## 문제 설명

두 정수 A와 B를 입력받아 더한 값을 출력하세요.

## 입력 형식

- 첫 줄에 A, 둘째 줄에 B가 주어집니다.

## 출력 형식

- A와 B를 더한 값을 한 줄에 출력합니다.

## 예제 입력

\`\`\`
3
5
\`\`\`

## 예제 출력

\`\`\`
8
\`\`\`
`;

const emptyDraft = () => ({
  id: '',
  title: '',
  statement: DEFAULT_STATEMENT,
  templateCode: DEFAULT_TEMPLATE,
  timeLimitSec: 1,
  memoryLimitMb: 128,
  reward: 100,
  order: Date.now(),
  tests: [{ input: '', expected: '', hidden: false }],
});

export default function AdminPage() {
  const { problems } = useApp();
  const [draft, setDraft] = useState(emptyDraft());
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const setTest = (i, k, v) => setDraft((d) => ({
    ...d, tests: d.tests.map((t, j) => (j === i ? { ...t, [k]: v } : t)),
  }));
  const addTest = () => setDraft((d) => ({ ...d, tests: [...d.tests, { input: '', expected: '', hidden: true }] }));
  const removeTest = (i) => setDraft((d) => ({ ...d, tests: d.tests.filter((_, j) => j !== i) }));

  function newProblem() {
    setDraft(emptyDraft()); setPreview(false); setMsg(''); setErr('');
  }

  async function editProblem(p) {
    setErr(''); setMsg('');
    try {
      const cases = await getProblemTests(p.id); // 운영자만 read 가능
      setDraft({
        id: p.id,
        title: p.title || '',
        statement: p.statement || '',
        templateCode: p.templateCode || DEFAULT_TEMPLATE,
        timeLimitSec: p.timeLimitSec || 1,
        memoryLimitMb: p.memoryLimitMb || 128,
        reward: p.reward || 0,
        order: p.order || Date.now(),
        tests: cases.length ? cases.map((c) => ({ input: c.input || '', expected: c.expected || '', hidden: !!c.hidden })) : [{ input: '', expected: '', hidden: false }],
      });
      setPreview(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { setErr('테스트케이스를 불러오지 못했습니다: ' + e.message); }
  }

  async function save() {
    setErr(''); setMsg(''); setBusy(true);
    try {
      const res = await upsertProblem(draft);
      setMsg('저장되었습니다.');
      setDraft((d) => ({ ...d, id: res.id }));
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function remove(p) {
    if (!window.confirm(`"${p.title}" 문제를 삭제할까요? (되돌릴 수 없음)`)) return;
    setErr(''); setMsg('');
    try {
      await deleteProblem(p.id);
      if (draft.id === p.id) newProblem();
    } catch (e) { setErr(e.message); }
  }

  const pubCount = draft.tests.filter((t) => !t.hidden).length;

  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>{draft.id ? '문제 수정' : '새 문제 출제'}</h3>
        <div className="spacer" />
        <button className="ghost" onClick={newProblem}>+ 새 문제</button>
      </div>

      <div className="admin-layout">
        {/* 좌: 문제 설명 (마크다운) */}
        <div className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <b>문제 설명 (Markdown)</b>
            <div className="spacer" />
            <nav className="tabs">
              <button className={!preview ? 'active' : ''} onClick={() => setPreview(false)}>편집</button>
              <button className={preview ? 'active' : ''} onClick={() => setPreview(true)}>미리보기</button>
            </nav>
          </div>
          <input placeholder="문제 제목" value={draft.title} onChange={(e) => set('title', e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
          {preview
            ? <div className="statement preview"><Markdown source={draft.statement} /></div>
            : <textarea className="md-editor mono" value={draft.statement} onChange={(e) => set('statement', e.target.value)} />}
        </div>

        {/* 우: 템플릿 코드 */}
        <div className="card">
          <b>기본 템플릿 코드 (C#)</b>
          <p className="muted" style={{ margin: '4px 0 8px' }}>학습자에게 제공될 시작 코드입니다.</p>
          <textarea className="code-editor mono" value={draft.templateCode} onChange={(e) => set('templateCode', e.target.value)} />
        </div>
      </div>

      {/* 제한/보상 */}
      <div className="card">
        <div className="row">
          <label>⏱ 시간 제한 <input type="number" min="1" max="10" value={draft.timeLimitSec} onChange={(e) => set('timeLimitSec', e.target.value)} /> 초</label>
          <label>💾 메모리 <input type="number" min="16" max="512" value={draft.memoryLimitMb} onChange={(e) => set('memoryLimitMb', e.target.value)} /> MB</label>
          <label>🏅 보상 <input type="number" min="0" value={draft.reward} onChange={(e) => set('reward', e.target.value)} /> P</label>
          <label>정렬 <input type="number" value={draft.order} onChange={(e) => set('order', e.target.value)} /></label>
        </div>
        <p className="muted" style={{ marginTop: 6 }}>최초 정답 시 보상 포인트가 <b>한 번만</b> 지급됩니다(하우스 풀에서 정산 → 총 포인트 보존).</p>
      </div>

      {/* 테스트 케이스 */}
      <div className="card">
        <div className="row" style={{ marginBottom: 6 }}>
          <b>테스트 케이스</b>
          <span className="muted">공개 {pubCount}개 · 비공개 {draft.tests.length - pubCount}개</span>
          <div className="spacer" />
          <button className="ghost" onClick={addTest}>+ 추가</button>
        </div>
        <p className="muted" style={{ margin: '0 0 10px' }}>비공개 케이스는 학습자에게 보이지 않습니다. 공개 케이스는 문제 화면에 예제로 노출됩니다.</p>
        {draft.tests.map((t, i) => (
          <div key={i} className="testcase">
            <div className="row" style={{ marginBottom: 6 }}>
              <b>테스트 케이스 {i + 1}</b>
              <label className="chk"><input type="checkbox" checked={t.hidden} onChange={(e) => setTest(i, 'hidden', e.target.checked)} /> 비공개</label>
              <div className="spacer" />
              <button className="ghost danger" onClick={() => removeTest(i)} disabled={draft.tests.length <= 1}>🗑</button>
            </div>
            <div className="tc-grid">
              <div>
                <div className="sample-lbl">입력값</div>
                <textarea className="tc-io mono" value={t.input} onChange={(e) => setTest(i, 'input', e.target.value)} placeholder="예) 3&#10;5" />
              </div>
              <div>
                <div className="sample-lbl">기댓값 *</div>
                <textarea className="tc-io mono" value={t.expected} onChange={(e) => setTest(i, 'expected', e.target.value)} placeholder="예) 8" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="row">
        <button className="primary" onClick={save} disabled={busy}>{busy ? '저장 중…' : (draft.id ? '수정 저장' : '문제 저장')}</button>
        {msg && <span className="ok">{msg}</span>}
        {err && <span className="err">{err}</span>}
      </div>

      {/* 기존 문제 목록 */}
      <div className="section-title">출제된 문제 ({problems.length})</div>
      <div className="card">
        {problems.length === 0 && <p className="muted">아직 없습니다.</p>}
        {problems.map((p, idx) => (
          <div key={p.id} className="admin-row">
            <span className="pc-no">#{idx + 1}</span>
            <b>{p.title}</b>
            <span className="muted">🏅 {(p.reward || 0).toLocaleString()}P · 테스트 {p.testCount || 0}개</span>
            <div className="spacer" />
            <button className="ghost" onClick={() => editProblem(p)}>수정</button>
            <button className="ghost danger" onClick={() => remove(p)}>삭제</button>
          </div>
        ))}
      </div>
    </div>
  );
}
