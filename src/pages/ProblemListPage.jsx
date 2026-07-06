import { useApp } from '../state/AppContext.jsx';

export default function ProblemListPage({ onOpen }) {
  const { problems, session, solvedSet } = useApp();
  const isParticipant = session.role === 'participant';

  if (problems.length === 0) {
    return (
      <div className="card">
        <h3>문제 목록</h3>
        <p className="muted">아직 출제된 문제가 없습니다. {session.role === 'admin' ? '[출제] 탭에서 문제를 만들어 보세요.' : ''}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>문제 목록 <span className="muted">({problems.length})</span></h3>
        <div className="spacer" />
        {!isParticipant && session.role !== 'admin' && <span className="muted">풀이하려면 [로그인]하세요.</span>}
      </div>
      <div className="grid">
        {problems.map((p, idx) => {
          const solved = isParticipant && solvedSet.has(p.id);
          return (
            <button key={p.id} className={`problem-card ${solved ? 'solved' : ''}`} onClick={() => onOpen(p.id)}>
              <div className="pc-hd">
                <span className="pc-no">#{idx + 1}</span>
                {solved && <span className="pill solved-pill">✓ 해결</span>}
              </div>
              <div className="pc-title">{p.title}</div>
              <div className="pc-meta">
                <span className="reward">🏅 {(p.reward || 0).toLocaleString()} P</span>
                <span className="muted"> · 테스트 {p.testCount || 0}개 · {p.timeLimitSec || 1}초</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
