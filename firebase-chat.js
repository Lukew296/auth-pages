// firebase-chat.js
// Initializes Firebase app for the CHAT messages database (DB #2).
// Exports: chatDb (Realtime Database instance)

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

/*
  DB #2 config (chat)
*/
const firebaseConfigChat = {
  apiKey: "AIzaSyDFN3SVxLU5OFl3ki2H4qeFYvm2rT47dQk",
  authDomain: "lukew96-82bb6.firebaseapp.com",
  databaseURL: "https://lukew96-82bb6-default-rtdb.firebaseio.com",
  projectId: "lukew96-82bb6",
  storageBucket: "lukew96-82bb6.firebasestorage.app",
  messagingSenderId: "1041074415159",
  appId: "1:1041074415159:web:d9a8d1330673d3ad9781b2"
};

const appChat = initializeApp(firebaseConfigChat, 'chatApp');
export const chatDb = getDatabase(appChat);
