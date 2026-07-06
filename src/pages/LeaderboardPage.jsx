import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { subscribeAllSolved } from '../data/store.js';

export default function LeaderboardPage() {
  const { users, session } = useApp();
  const [solved, setSolved] = useState([]);

  useEffect(() => subscribeAllSolved(setSolved), []);

  const solvedCount = useMemo(() => {
    const m = {};
    solved.forEach((s) => { m[s.userId] = (m[s.userId] || 0) + 1; });
    return m;
  }, [solved]);

  const ranked = useMemo(
    () => [...users]
      .map((u) => ({ ...u, solved: solvedCount[u.id] || 0 }))
      .sort((a, b) => (b.balance || 0) - (a.balance || 0) || b.solved - a.solved),
    [users, solvedCount],
  );

  return (
    <div className="card">
      <h3>리더보드 <span className="muted">(포인트는 베팅·주식판과 공유)</span></h3>
      <table className="tbl">
        <thead>
          <tr><th>순위</th><th>이름</th><th className="num">해결</th><th className="num">포인트</th></tr>
        </thead>
        <tbody>
          {ranked.map((u, i) => (
            <tr key={u.id} className={session.userId === u.id ? 'me-row' : ''}>
              <td>{i + 1}</td>
              <td>{u.name}{session.userId === u.id ? ' (나)' : ''}</td>
              <td className="num">{u.solved}</td>
              <td className="num mono">{(u.balance || 0).toLocaleString()}</td>
            </tr>
          ))}
          {ranked.length === 0 && <tr><td colSpan={4} className="muted">아직 참가자가 없습니다.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
