// chat.js
import { chatDb } from './firebase-chat.js';
import {
  ref, push, set, onChildAdded, query, limitToLast, onChildChanged,
  orderByChild, onValue, update, get, orderByKey
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

/*
 Single global chat:
 /messages/{messageId} -> { uid, username, text, ts, editedAt?, parentId? }
 /messages/{messageId}/reactions/{emoji}/{uid} : true
*/

/* ---------- Utilities ---------- */
function escapeHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

export function _renderPlain(s){ // helper for search result text snippet (plain)
  return escapeHtml((s||'').split('\n').slice(0,3).join(' '));
}

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

/* ---------- State ---------- */
let state = {
  user: null,
  replyTo: null,
  listeners: { messages: null }
};

/* DOM refs */
const messagesEl = () => document.getElementById('messages');
const msgForm = () => document.getElementById('msgForm');
const msgInput = () => document.getElementById('msgInput');
const replyPreviewEl = () => document.getElementById('replyPreview');
const tpl = () => document.getElementById('msg-template');

/* Emoji set — large set requested */
const EMOJIS = ["👍","❤️","😂","😮","😢","😡","🔥","🎉","👏","🙏","👀","🚀","😅","🤣","😎","😴","🙌","🤯","💀","😇"];

/* ---------- Initialize & message listeners ---------- */
export function init({ user }) {
  state.user = user || JSON.parse(localStorage.getItem('bv_session') || 'null');
  // listen for messages (last 500)
  const messagesRef = ref(chatDb, 'messages');
  const q = query(messagesRef, orderByChild('ts'), limitToLast(500));

  onChildAdded(q, (snap) => {
    const data = snap.val();
    data._id = snap.key;
    appendMessage(data);
    // auto-scroll to bottom
    const m = messagesEl();
    m.scrollTop = m.scrollHeight;
  });

  onChildChanged(q, (snap) => {
    const data = snap.val();
    data._id = snap.key;
    updateMessageInDOM(data);
  });

  wireMessageForm();
}

/* ---------- Append / Update message DOM ---------- */
function findMsgElById(id) {
  return messagesEl().querySelector(`.msg[data-id="${id}"]`);
}

async function appendMessage(msg) {
  const container = messagesEl();
  const node = tpl().content.cloneNode(true);
  const el = node.querySelector('.msg');
  el.dataset.id = msg._id;

  const meta = el.querySelector('.meta');
  meta.textContent = `${msg.username} • ${fmtTime(msg.ts)}${msg.editedAt ? ' • edited' : ''}`;

  // reply quote
  const replyQuote = el.querySelector('.reply-quote');
  if (msg.parentId) {
    try {
      const s = await get(ref(chatDb, `messages/${msg.parentId}`));
      const p = s.val();
      if (p) {
        replyQuote.style.display = 'block';
        const t = (p.text || '').split('\n').slice(0,2).join(' ');
        replyQuote.innerHTML = `<strong>${escapeHtml(p.username)}</strong>: ${escapeHtml(t)}${(p.text && p.text.length > t.length) ? ' …' : ''}`;
        replyQuote.addEventListener('click', () => {
          const target = findMsgElById(msg.parentId);
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      } else replyQuote.style.display = 'none';
    } catch (e) { replyQuote.style.display = 'none'; }
  } else replyQuote.style.display = 'none';

  const textDiv = el.querySelector('.text');
  textDiv.innerHTML = renderMarkdown(msg.text);

  const meta2 = el.querySelector('.meta2');
  meta2.textContent = '';

  // controls: reply, edit (if owner), react (emoji picker)
  const controls = el.querySelector('.controls');
  controls.innerHTML = '';

  const replyBtn = document.createElement('span');
  replyBtn.className = 'link';
  replyBtn.textContent = 'Reply';
  replyBtn.addEventListener('click', () => {
    state.replyTo = { id: msg._id, username: msg.username, text: msg.text };
    showReplyPreview(state.replyTo);
    msgInput().focus();
  });
  controls.appendChild(replyBtn);

  if (state.user && msg.uid === state.user.uid) {
    const editBtn = document.createElement('span');
    editBtn.className = 'link';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openEditUI(msg, el));
    controls.appendChild(editBtn);
  }

  // emoji quick add UI (show minimal set + more on click)
  const reactContainer = el.querySelector('.reactions');
  reactContainer.innerHTML = ''; // will fill later

  // We'll render the reaction buttons by reading reactions for this message
  renderReactions(msg._id, reactContainer);

  // attach click-to-scroll if message authored by me mark
  if (state.user && msg.uid === state.user.uid) el.classList.add('me');

  container.appendChild(el);
}

/* update existing message DOM after edit */
function updateMessageInDOM(msg) {
  const el = findMsgElById(msg._id);
  if (!el) return;
  const meta = el.querySelector('.meta');
  meta.textContent = `${msg.username} • ${fmtTime(msg.ts)}${msg.editedAt ? ' • edited' : ''}`;
  const textDiv = el.querySelector('.text');
  textDiv.innerHTML = renderMarkdown(msg.text);
  // re-render reactions
  const reactContainer = el.querySelector('.reactions');
  renderReactions(msg._id, reactContainer);
}

/* ---------- Reactions handling ---------- */
function renderReactions(messageId, container) {
  // Listen to reactions for this particular message (one-time fetch then onValue)
  const reactionsRef = ref(chatDb, `messages/${messageId}/reactions`);
  onValue(reactionsRef, (snap) => {
    const val = snap.val() || {};
    container.innerHTML = '';
    // compute counts per emoji
    const counts = {};
    Object.entries(val).forEach(([emoji, users]) => {
      counts[emoji] = users ? Object.keys(users).length : 0;
    });
    // Render each emoji that has counts
    Object.keys(counts).sort((a,b) => counts[b]-counts[a]).forEach(emoji => {
      const btn = document.createElement('button');
      btn.className = 'react-btn';
      btn.innerHTML = `<span class="emoji">${emoji}</span> <span class="count">${counts[emoji]}</span>`;
      btn.addEventListener('click', async () => {
        await toggleReaction(messageId, emoji);
      });
      container.appendChild(btn);
    });

    // small quick-add row for popular emojis (shows all EMOJIS as small clickable)
    const picker = document.createElement('div');
    picker.style.display = 'flex';
    picker.style.gap = '6px';
    picker.style.marginTop = '6px';
    EMOJIS.slice(0,8).forEach(e => {
      const p = document.createElement('button');
      p.className = 'react-btn';
      p.style.padding = '6px';
      p.textContent = e;
      p.addEventListener('click', async () => { await toggleReaction(messageId, e); });
      picker.appendChild(p);
    });
    // "more" opens full picker
    const more = document.createElement('button');
    more.className = 'react-btn';
    more.textContent = '⋯';
    more.addEventListener('click', () => openFullEmojiPicker(messageId, container));
    picker.appendChild(more);

    container.appendChild(picker);
  });
}

async function toggleReaction(messageId, emoji) {
  if (!state.user) return;
  const uid = state.user.uid;
  const path = `messages/${messageId}/reactions/${encodeURIComponent(emoji)}/${uid}`;
  const nodeRef = ref(chatDb, path);
  try {
    const snap = await get(nodeRef);
    if (snap.exists()) {
      // remove reaction
      await update(ref(chatDb, `messages/${messageId}/reactions/${encodeURIComponent(emoji)}`), { [uid]: null });
    } else {
      // add reaction
      await set(nodeRef, true);
    }
  } catch (e) {
    console.error('Reaction error', e);
  }
}

function openFullEmojiPicker(messageId, container) {
  // render a simple overlay picker
  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  overlay.style.left = '12px';
  overlay.style.top = '100%';
  overlay.style.padding = '8px';
  overlay.style.display = 'grid';
  overlay.style.gridTemplateColumns = 'repeat(8, 32px)';
  overlay.style.gap = '6px';
  overlay.style.background = 'var(--card)';
  overlay.style.border = '1px solid rgba(255,255,255,0.04)';
  overlay.style.borderRadius = '8px';
  overlay.style.zIndex = 60;

  EMOJIS.forEach(e => {
    const b = document.createElement('button');
    b.className = 'react-btn';
    b.style.padding = '6px';
    b.textContent = e;
    b.addEventListener('click', async () => {
      await toggleReaction(messageId, e);
      overlay.remove();
    });
    overlay.appendChild(b);
  });

  container.appendChild(overlay);
  // close when clicking outside
  document.addEventListener('click', function onDocClick(ev) {
    if (!overlay.contains(ev.target)) { overlay.remove(); document.removeEventListener('click', onDocClick); }
  });
}

/* ---------- Edit UI ---------- */
function openEditUI(msg, el) {
  const textDiv = el.querySelector('.text');
  const controls = el.querySelector('.controls');
  textDiv.style.display = 'none';
  controls.style.display = 'none';

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
    await update(ref(chatDb, `messages/${msg._id}`), updates);
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

/* ---------- Reply preview ---------- */
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

/* ---------- Sending messages (multiline support) ---------- */
export async function sendMessage(text) {
  if (!state.user) throw new Error('Not authenticated');
  const messagesRef = ref(chatDb, 'messages');
  const newRef = push(messagesRef);
  const now = Date.now();
  await set(newRef, {
    uid: state.user.uid,
    username: state.user.username,
    text,
    ts: now,
    parentId: state.replyTo ? state.replyTo.id : null
  });
  state.replyTo = null;
  showReplyPreview(null);
}

function wireMessageForm() {
  const form = msgForm();
  const input = msgInput();
  // Enter to send (Shift+Enter newline)
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
      alert('Send failed: ' + err.message);
    }
  });
}

/* ---------- Message search (client-side) ---------- */
/*
  Implementation:
  - For the simplicity and realtime constraints we fetch the last N messages (500) and filter client-side.
  - searchMessages(query) returns array of matching message objects.
*/
export async function searchMessages(queryStr) {
  const q = (queryStr||'').trim().toLowerCase();
  if (!q) return [];
  const messagesRef = ref(chatDb, 'messages');
  // fetch last 1000 messages ordered by ts
  const snap = await get(query(messagesRef, orderByChild('ts'), limitToLast(1000)));
  const val = snap.val() || {};
  const arr = Object.entries(val).map(([id,m]) => ({ _id: id, ...m }));
  const results = arr.filter(m => {
    if (!m) return false;
    const text = (m.text||'').toLowerCase();
    const user = (m.username||'').toLowerCase();
    // emoji search matches emoji char
    if (text.includes(q) || user.includes(q)) return true;
    // search in reactions: if q is an emoji or name, check reactions
    if (m.reactions) {
      const emojis = Object.keys(m.reactions).map(decodeURIComponent);
      if (emojis.some(e => e.includes(q) || (e === q))) return true;
      // also check users who reacted (username substring) — left out for performance
    }
    return false;
  });
  // sort by ts desc
  results.sort((a,b) => b.ts - a.ts);
  return results;
}

/* ---------- Scroll to message helper ---------- */
export function scrollToMessage(messageId) {
  const el = findMsgElById(messageId);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ---------- Expose some helpers for chat.html script ---------- */
export { renderMarkdown as _renderMarkdown, renderMarkdown, EMOJIS };
