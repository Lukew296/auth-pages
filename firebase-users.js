// firebase-users.js
// Initializes Firebase app for the USERS database (DB #1).
// Exports: getDbRef() -> returns initialized Realtime Database instance.

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

/*
  DB #1 config (users)
*/
const firebaseConfigUsers = {
  apiKey: "AIzaSyDBx_i5hxcnhUx-_g8behhNkSeS7mFHMDE",
  authDomain: "bloodvine-auth.firebaseapp.com",
  databaseURL: "https://bloodvine-auth-default-rtdb.firebaseio.com",
  projectId: "bloodvine-auth",
  storageBucket: "bloodvine-auth.firebasestorage.app",
  messagingSenderId: "733317481270",
  appId: "1:733317481270:web:c84833fe0c2d8f8bd82997"
};

// initialize with a name to allow a second app for chat
const appUsers = initializeApp(firebaseConfigUsers, 'usersApp');
export const usersDb = getDatabase(appUsers);
