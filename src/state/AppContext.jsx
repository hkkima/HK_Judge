import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { isConfigured, ensureAnonAuth, signInWithGoogle, isAdminEmail, watchAuth } from '../data/firebase.js';
import {
  subscribeProblems, subscribeUsers, subscribeSolvedFor,
  getUser, getUserByName, createUser,
} from '../data/store.js';
import { nameToUserId, verifyPin, hashPin } from '../auth/auth.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const SESSION_KEY = 'hkjudge.session';

export function AppProvider({ children }) {
  const configured = isConfigured();
  const [problems, setProblems] = useState([]);
  const [users, setUsers] = useState([]);
  const [solvedIds, setSolvedIds] = useState([]); // 내가 푼 문제 id
  const [fbUser, setFbUser] = useState(undefined); // undefined=초기화 전, null=미인증, obj=인증됨
  const [session, setSession] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || { role: 'guest' }; }
    catch { return { role: 'guest' }; }
  });

  useEffect(() => {
    if (!configured) return undefined;
    return watchAuth(setFbUser);
  }, [configured]);

  // 전역 구독. 참가자는 익명 인증 확보(함수 호출용).
  useEffect(() => {
    if (!configured) return undefined;
    if (session.role !== 'admin') ensureAnonAuth();
    const unsubs = [subscribeProblems(setProblems), subscribeUsers(setUsers)];
    if (session.role === 'participant' && session.userId) {
      unsubs.push(subscribeSolvedFor(session.userId, setSolvedIds));
    } else {
      setSolvedIds([]);
    }
    return () => unsubs.forEach((u) => u && u());
  }, [configured, session.role, session.userId]);

  const persist = useCallback((s) => {
    setSession(s);
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  }, []);

  const loginParticipant = useCallback(async (name, pin) => {
    if (!configured) throw new Error('Firebase 설정이 필요합니다 (.env).');
    const user = (await getUserByName(name)) || (await getUser(nameToUserId(name)));
    if (!user) throw new Error('등록되지 않은 참가자입니다. [가입] 탭에서 계정을 만드세요.');
    if (!verifyPin(pin, user.pinHash)) throw new Error('PIN이 일치하지 않습니다.');
    await ensureAnonAuth();
    persist({ role: 'participant', userId: user.id, name: user.name, pinHash: user.pinHash });
  }, [configured, persist]);

  const registerParticipant = useCallback(async (name, pin) => {
    if (!configured) throw new Error('Firebase 설정이 필요합니다 (.env).');
    if (!name?.trim() || !pin?.trim()) throw new Error('이름과 PIN을 입력하세요.');
    if (!/^\d{4,}$/.test(String(pin).trim())) throw new Error('PIN은 숫자 4자리 이상이어야 합니다.');
    const userId = nameToUserId(name);
    await ensureAnonAuth();
    const existing = await getUser(userId);
    if (existing) throw new Error('이미 사용 중인 이름입니다. 다른 이름을 쓰거나 로그인하세요.');
    const pinHash = hashPin(pin);
    await createUser({ userId, name: name.trim(), pinHash, balance: 0 });
    persist({ role: 'participant', userId, name: name.trim(), pinHash });
  }, [configured, persist]);

  const loginAdmin = useCallback(async () => {
    if (!configured) throw new Error('Firebase 설정이 필요합니다 (.env).');
    const u = await signInWithGoogle();
    if (!isAdminEmail(u.email)) throw new Error(`운영자 권한이 없는 계정입니다: ${u.email}`);
    persist({ role: 'admin', email: u.email });
  }, [configured, persist]);

  const logout = useCallback(() => persist({ role: 'guest' }), [persist]);

  const myUser = useMemo(
    () => (session.role === 'participant' ? users.find((u) => u.id === session.userId) : null),
    [users, session],
  );
  const solvedSet = useMemo(() => new Set(solvedIds), [solvedIds]);

  // 운영자 세션인데 Firebase 구글 인증이 끊김 → 함수 호출 불가, 재로그인 필요.
  const adminReauthNeeded = configured && session.role === 'admin' && fbUser === null;

  const value = {
    configured, problems, users, session, myUser, solvedSet, adminReauthNeeded,
    loginParticipant, registerParticipant, loginAdmin, logout,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
