// auth.js
import { usersDb } from './firebase-users.js';
import { ref, push, set, get } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

/*
 Minimal custom auth using Realtime DB for demo/testing.
 WARNING: stores plain-text passwords (as requested) — DO NOT use this in production.
*/

/**
 * createUser({username, email, password})
 */
export async function createUser({ username, email, password }) {
  if (!email || !password) throw new Error('Email and password required.');
  const usersRef = ref(usersDb, 'users');
  const snapshot = await get(usersRef);
  const val = snapshot.val();
  if (val) {
    const exists = Object.values(val).some(u => u.email === email);
    if (exists) throw new Error('Email already exists.');
  }

  const newUserRef = push(usersRef);
  const now = Date.now();
  await set(newUserRef, {
    username: username || email.split('@')[0],
    email,
    password, // plain text (insecure)
    createdAt: now
  });

  const uid = newUserRef.key;
  const session = { uid, username: username || email.split('@')[0], email, createdAt: now };
  localStorage.setItem('bv_session', JSON.stringify(session));
  return session;
}

/**
 * signIn({email, password})
 */
export async function signIn({ email, password }) {
  if (!email || !password) throw new Error('Email and password required.');
  const usersRef = ref(usersDb, 'users');
  const snapshot = await get(usersRef);
  const val = snapshot.val();
  if (!val) throw new Error('No users found.');

  const matchEntry = Object.entries(val).find(([uid, u]) => u.email === email && u.password === password);
  if (!matchEntry) throw new Error('Invalid credentials.');

  const [uid, user] = matchEntry;
  const session = { uid, username: user.username, email: user.email, createdAt: user.createdAt };
  localStorage.setItem('bv_session', JSON.stringify(session));
  return session;
}

/**
 * requireAuth()
 */
export function requireAuth() {
  const s = localStorage.getItem('bv_session');
  if (!s) {
    location.href = 'login.html';
    throw new Error('Not authenticated');
  }
  return JSON.parse(s);
}

/**
 * logout()
 */
export function logout() {
  localStorage.removeItem('bv_session');
  location.href = 'index.html';
}
