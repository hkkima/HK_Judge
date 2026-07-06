import { useState } from 'react';
import { useApp } from './state/AppContext.jsx';
import ProblemListPage from './pages/ProblemListPage.jsx';
import SolvePage from './pages/SolvePage.jsx';
import LeaderboardPage from './pages/LeaderboardPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import LoginPage from './pages/LoginPage.jsx';

export default function App() {
  const { configured, session, myUser, logout, adminReauthNeeded, loginAdmin } = useApp();
  const [tab, setTab] = useState('problems');
  const [selectedId, setSelectedId] = useState(null); // 풀이 중인 문제 id

  async function reauth() {
    try { await loginAdmin(); } catch (e) { window.alert(e.message); }
  }

  const isAdmin = session.role === 'admin';
  const isParticipant = session.role === 'participant';
  const who =
    isParticipant ? session.name
    : isAdmin ? `운영자 (${session.email})`
    : '게스트';

  function openProblem(id) { setSelectedId(id); setTab('problems'); }
  function goList() { setSelectedId(null); }

  return (
    <div>
      <header className="top">
        <h1>💻 C# 코딩 문제판</h1>
        <nav className="tabs">
          <button className={tab === 'problems' ? 'active' : ''} onClick={() => { setTab('problems'); }}>문제</button>
          <button className={tab === 'rank' ? 'active' : ''} onClick={() => setTab('rank')}>리더보드</button>
          {isAdmin && <button className={tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}>출제</button>}
          <button className={tab === 'login' ? 'active' : ''} onClick={() => setTab('login')}>
            {session.role === 'guest' ? '로그인' : '계정'}
          </button>
        </nav>
        <div className="spacer" />
        {isParticipant && myUser && <span className="balance mono">{(myUser.balance || 0).toLocaleString()} P</span>}
        <span className="muted">{who}</span>
        {session.role !== 'guest' && <button className="ghost" onClick={logout}>로그아웃</button>}
      </header>

      <div className="wrap">
        {adminReauthNeeded && (
          <div className="banner" style={{ background: '#3a0a0a', borderColor: 'var(--down)', color: 'var(--down)' }}>
            🔑 운영자 구글 인증이 만료됐습니다(출제·삭제가 안 됩니다).
            <button className="primary" style={{ marginLeft: 8 }} onClick={reauth}>Google로 다시 로그인</button>
          </div>
        )}
        {!configured && (
          <div className="banner">
            ⚙️ Firebase가 아직 설정되지 않았어요. <code>.env</code>에 <code>VITE_FIREBASE_*</code> 값(베팅·주식판과 동일 프로젝트)을
            채우면 실제 데이터·채점이 동작합니다. 지금은 UI 미리보기만 가능.
          </div>
        )}

        {tab === 'problems' && (
          selectedId
            ? <SolvePage problemId={selectedId} onBack={goList} />
            : <ProblemListPage onOpen={openProblem} />
        )}
        {tab === 'rank' && <LeaderboardPage />}
        {tab === 'admin' && isAdmin && <AdminPage />}
        {tab === 'login' && <LoginPage />}
      </div>
    </div>
  );
}
