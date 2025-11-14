// chat.js
import { chatDb } from './firebase-chat.js';
import {
  ref, push, set, onChildAdded, query, limitToLast, onChildChanged,
  orderByChild, onValue, update, get
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

/*
 Data structure (Realtime DB - DB #2)
 /rooms/{roomId} -> { name, createdAt }
 /rooms/{roomId}/channels/{channelId} -> { name, createdAt }
 /rooms/{roomId}/channels/{channelId}/messages/{messageId} -> {
    uid, username, text, ts, editedAt?, parentId?
 }
*/

/* ---------- Small utilities ---------- */
function escapeHtml(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function renderMarkdown(text) {
  const esc = escapeHtml;
  let out = esc(text || '');

  out = out.replace(/`([^`]+)`/g, '<span class="code">$1</span>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/(https?:\/\/[^\s]+)/g, '<a target="_blank" rel="noopener noreferrer" href="$1">$1</a>');
  out = out.replace(/\n/g, '<br/>');
  return out;
}
function fmtTime(ts){ return new Date(ts).toLocaleString(); }

/* ---------- Module state ---------- */
let state = {
  user: null,
  currentRoomId: null,
  currentChannelId: null,
  replyTo: null,
  listeners: { messages: null }
};

/* ---------- DOM refs ---------- */
const roomsListEl = () => document.getElementById('roomsList');
const channelsListEl = () => document.getElementById('channelsList');
const messagesEl = () => document.getElementById('messages');
const msgForm = () => document.getElementById('msgForm');
const msgInput = () => document.getElementById('msgInput');
const replyPreviewEl = () => document.getElementById('replyPreview');
const msgTemplate = () => document.getElementById('msg-template');

/* ---------- Rooms & Channels ---------- */
export async function createRoom({ name }) {
  const roomsRef = ref(chatDb, 'rooms');
  const newRef = push(roomsRef);
  await set(newRef, { name, createdAt: Date.now() });
  // will appear via realtime listener
}

export async function createChannel(name) {
  if (!state.currentRoomId) throw new Error('No room selected');
  const channelsRef = ref(chatDb, `rooms/${state.currentRoomId}/channels`);
  const newRef = push(channelsRef);
  await set(newRef, { name, createdAt: Date.now() });
}

/* ---------- UI rendering for rooms/channels ---------- */
function clearChildren(el){ while(el.firstChild) el.removeChild(el.firstChild); }

function renderRooms(rooms) {
  const el = roomsListEl();
  clearChildren(el);
  Object.entries(rooms || {}).forEach(([id, r]) => {
    const div = document.createElement('div');
    div.className = 'item' + (id === state.currentRoomId ? ' active' : '');
    div.textContent = r.name || ('Room ' + id);
    div.addEventListener('click', () => selectRoom(id, r));
    el.appendChild(div);
  });
}

function renderChannels(channels) {
  const el = channelsListEl();
  clearChildren(el);
  Object.entries(channels || {}).forEach(([id, c]) => {
    const div = document.createElement('div');
    div.className = 'item' + (id === state.currentChannelId ? ' active' : '');
    div.textContent = c.name || ('Channel ' + id);
    div.addEventListener('click', () => selectChannel(id, c));
    el.appendChild(div);
  });
}

/* ---------- Selection ---------- */
async function selectRoom(id, roomObj) {
  state.currentRoomId = id;
  state.currentChannelId = null;
  // update UI
  // load channels list by reading once and setting up listener for that path
  const channelsRef = ref(chatDb, `rooms/${id}/channels`);
  onValue(channelsRef, (snap) => {
    renderChannels(snap.val() || {});
  });
  // auto-select first channel if exists
  const snap = await get(channelsRef);
  const val = snap.val();
  if (val) {
    const firstId = Object.keys(val)[0];
    selectChannel(firstId, val[firstId]);
  } else {
    // update room title via callback if present
    if (opts && typeof opts.onRoomChange === 'function') opts.onRoomChange(roomObj, null);
  }
  renderRoomsListActive();
  notifyRoomChange();
}

function renderRoomsListActive(){
  const items = roomsListEl().children;
  for (const it of items) {
    it.classList.toggle('active', it.textContent === (state.currentRoomId ? document.querySelector(`#roomsList .item.active`) : false));
  }
}

function notifyRoomChange(){
  if (typeof opts.onRoomChange === 'function') {
    const room = state.currentRoomId ? currentRoomsCache[state.currentRoomId] : null;
    const channel = state.currentChannelId ? currentChannelsCache[state.currentRoomId]?.[state.currentChannelId] : null;
    opts.onRoomChange(room, channel);
  }
}

/* ---------- Channels ---------- */
async function selectChannel(channelId, channelObj) {
  state.currentChannelId = channelId;
  // stop old message listener if any
  if (state.listeners.messages) {
    // no direct off API used; we switch reference: old listener will stop when element removed by SDK GC
  }
  // render active classes
  Array.from(channelsListEl().children).forEach(ch => {
    ch.classList.toggle('active', ch.textContent === channelObj.name);
  });

  // listen messages for this channel
  listenMessages(state.currentRoomId, state.currentChannelId);
  notifyRoomChange();
}

/* ---------- Messages ---------- */
let currentMessagesQuery = null;
function listenMessages(roomId, channelId) {
  const container = messagesEl();
  clearChildren(container);
  state.replyTo = null;
  replyPreviewEl().style.display = 'none';

  if (!roomId || !channelId) return;

  const messagesRef = ref(chatDb, `rooms/${roomId}/channels/${channelId}/messages`);
  // order by ts
  const q = query(messagesRef, orderByChild('ts'), limitToLast(500));
  // initial load & updates
  onChildAdded(q, (snap) => {
    const data = snap.val();
    data._id = snap.key;
    appendMessage(data, container);
    container.scrollTop = container.scrollHeight;
  });
  onChildChanged(q, (snap) => {
    const data = snap.val();
    data._id = snap.key;
    updateMessageInDOM(data);
  });
}

/* DOM helpers: append, update, find */
function findMsgElById(id) {
  return messagesEl().querySelector(`.msg[data-id="${id}"]`);
}

function appendMessage(msg, container) {
  const tpl = msgTemplate().content.cloneNode(true);
  const el = tpl.querySelector('.msg');
  el.dataset.id = msg._id;

  const meta = el.querySelector('.meta');
  meta.textContent = `${msg.username} • ${fmtTime(msg.ts)}${msg.editedAt ? ' • edited' : ''}`;

  // reply quote
  const replyQuote = el.querySelector('.reply-quote');
  if (msg.parentId) {
    // fetch parent message to show quote (best-effort)
    get(ref(chatDb, `rooms/${state.currentRoomId}/channels/${state.currentChannelId}/messages/${msg.parentId}`))
      .then(s => {
        const p = s.val();
        if (p) {
          replyQuote.style.display = 'block';
          const t = (p.text || '').split('\n').slice(0,2).join(' ');
          replyQuote.innerHTML = `<strong>${escapeHtml(p.username)}</strong>: ${escapeHtml(t)}${(p.text && p.text.length > t.length) ? ' …' : ''}`;
          // clicking the quote will scroll to original if present
          replyQuote.addEventListener('click', () => {
            const target = findMsgElById(msg.parentId);
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
        }
      });
  } else {
    replyQuote.style.display = 'none';
  }

  const textDiv = el.querySelector('.text');
  textDiv.innerHTML = renderMarkdown(msg.text);

  // controls
  const controls = el.querySelector('.controls');
  // reply button
  const replyBtn = document.createElement('span');
  replyBtn.className = 'link';
  replyBtn.textContent = 'Reply';
  replyBtn.addEventListener('click', () => {
    state.replyTo = { id: msg._id, username: msg.username, text: msg.text };
    showReplyPreview(state.replyTo);
    msgInput().focus();
  });
  controls.appendChild(replyBtn);

  // if message belongs to current user, add edit button
  if (state.user && msg.uid === state.user.uid) {
    const editBtn = document.createElement('span');
    editBtn.className = 'link';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      openEditUI(msg, el);
    });
    controls.appendChild(editBtn);
  }

  // mark as mine
  if (state.user && msg.uid === state.user.uid) el.classList.add('me');

  container.appendChild(el);
}

function updateMessageInDOM(msg) {
  const el = findMsgElById(msg._id);
  if (!el) return;
  const meta = el.querySelector('.meta');
  meta.textContent = `${msg.username} • ${fmtTime(msg.ts)}${msg.editedAt ? ' • edited' : ''}`;
  const textDiv = el.querySelector('.text');
  textDiv.innerHTML = renderMarkdown(msg.text);
}

/* ---------- Edit UI ---------- */
function openEditUI(msg, el) {
  const textDiv = el.querySelector('.text');
  const controls = el.querySelector('.controls');
  // hide original text and controls
  textDiv.style.display = 'none';
  controls.style.display = 'none';

  // create edit box
  const textarea = document.createElement('textarea');
  textarea.value = msg.text || '';
  textarea.rows = 3;
  textarea.style.width = '100%';
  textarea.style.marginTop = '8px';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn small';
  saveBtn.textContent = 'Save';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn ghost small';
  cancelBtn.textContent = 'Cancel';

  const wrapper = document.createElement('div');
  wrapper.style.marginTop = '8px';
  wrapper.appendChild(textarea);
  wrapper.appendChild(document.createElement('div')).style.height = '8px';
  wrapper.appendChild(saveBtn);
  wrapper.appendChild(cancelBtn);

  el.appendChild(wrapper);

  saveBtn.addEventListener('click', async () => {
    const newText = textarea.value.trim();
    if (newText === '') return;
    const updates = { text: newText, editedAt: Date.now() };
    await update(ref(chatDb, `rooms/${state.currentRoomId}/channels/${state.currentChannelId}/messages/${msg._id}`), updates);
    // cleanup UI
    wrapper.remove();
    textDiv.style.display = '';
    controls.style.display = '';
  });

  cancelBtn.addEventListener('click', () => {
    wrapper.remove();
    textDiv.style.display = '';
    controls.style.display = '';
  });
}

/* ---------- Reply Preview ---------- */
function showReplyPreview(replyObj) {
  const el = replyPreviewEl();
  if (!replyObj) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'block';
  const snippet = (replyObj.text || '').split('\n').slice(0,2).join(' ');
  el.innerHTML = `<strong>Replying to ${escapeHtml(replyObj.username)}</strong>: ${escapeHtml(snippet)} <button id="cancelReply" class="btn ghost small" style="margin-left:8px">Cancel</button>`;
  document.getElementById('cancelReply').addEventListener('click', () => {
    state.replyTo = null;
    showReplyPreview(null);
  });
}

/* ---------- Sending messages ---------- */
export async function sendMessage(text) {
  if (!state.user) throw new Error('Not authenticated');
  if (!state.currentRoomId || !state.currentChannelId) throw new Error('Pick a room & channel');
  const messagesRef = ref(chatDb, `rooms/${state.currentRoomId}/channels/${state.currentChannelId}/messages`);
  const newRef = push(messagesRef);
  const now = Date.now();
  await set(newRef, {
    uid: state.user.uid,
    username: state.user.username,
    text,
    ts: now,
    parentId: state.replyTo ? state.replyTo.id : null
  });
  // clear reply
  state.replyTo = null;
  showReplyPreview(null);
}

/* ---------- Wire up message form (multiline support) ---------- */
function wireMessageForm() {
  const form = msgForm();
  const input = msgInput();
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    try {
      await sendMessage(text);
      input.value = '';
    } catch (err) {
      console.error(err);
    }
  });
}

/* ---------- Rooms listener ---------- */
let currentRoomsCache = {};
let currentChannelsCache = {};
let opts = {};

export function init(options = {}) {
  opts = options || {};
  state.user = options.user || JSON.parse(localStorage.getItem('bv_session') || 'null');
  // Rooms listener
  const roomsRef = ref(chatDb, 'rooms');
  onChildAdded(roomsRef, (snap) => {
    currentRoomsCache[snap.key] = snap.val();
    renderRooms(currentRoomsCache);
  });
  onChildChanged(roomsRef, (snap) => {
    currentRoomsCache[snap.key] = snap.val();
    renderRooms(currentRoomsCache);
  });

  // Also load existing rooms at once
  onValue(roomsRef, (snap) => {
    currentRoomsCache = snap.val() || {};
    renderRooms(currentRoomsCache);
  });

  // Watch channels cache per room dynamically (keeps UI updated)
  // We'll use onValue for channels when a room is selected (see selectRoom)

  // wire message form
  wireMessageForm();

  // initial channels/rooms are empty until created; you can create via form
}

/* ---------- Helpers for DOM update when room/channel change ---------- */
export async function selectRoomById(roomId) {
  if (!roomId) return;
  // fetch room
  const r = await get(ref(chatDb, `rooms/${roomId}`));
  selectRoom(roomId, r.val());
}
export async function selectChannelById(roomId, channelId) {
  if (!roomId || !channelId) return;
  const c = await get(ref(chatDb, `rooms/${roomId}/channels/${channelId}`));
  selectChannel(channelId, c.val());
}
