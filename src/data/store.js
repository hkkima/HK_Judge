// Firestore 데이터 계층 (코딩 문제판).
//   읽기: problems(문제 메타·공개 예제) / users(리더보드) / solved(내 해결 표식) 실시간 구독.
//   쓰기(출제·삭제)·실행·채점: 전부 Cloud Functions(callable) 경유 — store 에선 래퍼만.
//   계정 생성/조회: users 는 베팅·주식판과 공유.

import {
  doc, collection, getDoc, getDocs, setDoc, onSnapshot, query, where, orderBy,
} from 'firebase/firestore';
import { getFirebase, callable } from './firebase.js';

const userRef = (id) => doc(getFirebase().db, 'users', id);

// ── 구독 ────────────────────────────────────────────────
export function subscribeProblems(cb) {
  return onSnapshot(
    query(collection(getFirebase().db, 'problems'), orderBy('order', 'asc')),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => cb([]),
  );
}
export function subscribeUsers(cb) {
  return onSnapshot(collection(getFirebase().db, 'users'), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );
}
// 내가 푼 문제 표식(solved/{userId__problemId}) — 본인 것만 구독.
export function subscribeSolvedFor(userId, cb) {
  return onSnapshot(
    query(collection(getFirebase().db, 'solved'), where('userId', '==', userId)),
    (snap) => cb(snap.docs.map((d) => d.data().problemId)),
    () => cb([]),
  );
}

// 전체 해결 표식 구독(리더보드용). userId 별 해결 수 집계에 사용.
export function subscribeAllSolved(cb) {
  return onSnapshot(
    collection(getFirebase().db, 'solved'),
    (snap) => cb(snap.docs.map((d) => d.data())),
    () => cb([]),
  );
}

// 운영자: 특정 문제의 채점용 전체 케이스(정답 포함) 조회 — problemTests 는 운영자만 read.
export async function getProblemTests(problemId) {
  const snap = await getDoc(doc(getFirebase().db, 'problemTests', problemId));
  return snap.exists() ? (snap.data().cases || []) : [];
}

// ── 계정 (베팅·주식판과 공유) ───────────────────────────
export async function getUser(userId) {
  const snap = await getDoc(userRef(userId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
export async function getUserByName(name) {
  const { db } = getFirebase();
  const q = query(collection(db, 'users'), where('name', '==', String(name).trim()));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}
export async function createUser({ userId, name, pinHash, balance = 0 }) {
  await setDoc(userRef(userId), { name, pinHash, balance: Math.floor(balance) });
}

// ── 실행/채점/출제 (Cloud Functions) ────────────────────
export async function runCode({ code, stdin }) {
  return (await callable('runCode')({ code, stdin })).data;
}
export async function submitSolution({ userId, pinHash, problemId, code }) {
  return (await callable('submitSolution')({ userId, pinHash, problemId, code })).data;
}
export async function upsertProblem(payload) {
  return (await callable('upsertProblem')(payload)).data;
}
export async function deleteProblem(id) {
  return (await callable('deleteProblem')({ id })).data;
}
