import { IS_CONFIGURED } from "./firebase-config.js";
import * as Auth from "./auth.js";
import * as Chat from "./chat.js";
import * as Storage from "./storage.js";

if (!IS_CONFIGURED) {
  document.getElementById("setup-notice").classList.remove("hidden");
}

const EMOJI_SET = ["😀","😂","🥰","😎","🤔","😢","😡","👍","👎","🙏","🎉","🔥","💯","❤️","🍯","🐝","🌻","✨","😴","🤝","👏","🙌","😱","🥳","🤩","😇","🫡","🤗","🍕","☕","😊","😉","😅","🤯","🥺","😭","🤣","👌","💪","🎂"];
const STICKERS = ["🐝","🍯","🌻","🎉","❤️","👍","😂","🔥","🥳","🎂","☀️","🌙","⭐","🍀","🎈","💐"];
const AVATAR_EMOJIS = ["🐝","🍯","🌻","🐼","🦊","🐨","🐯","🐸","🐧","🦁","🐙","🦋"];

let me = null;
let usersCache = {};
let chats = [];
let activeChatId = null;
let activeMessages = [];
let unsubChats = null, unsubMessages = null, unsubTyping = null, unsubUsers = null, stopPresence = null;
let pendingAttachments = [];
let replyingTo = null;
let chatFilter = "all";
let mediaRecorder = null, recordChunks = [], recordStart = null, recordTimerInt = null;
let typingTimeout = null;
let notifiedMessageIds = new Set();

// ---------------- THEME ----------------
function applyTheme(theme) {
  document.body.setAttribute("data-theme", theme);
  localStorage.setItem("talkbee-theme", theme);
  const railBtn = document.getElementById("rail-theme-btn");
  if (railBtn) railBtn.textContent = theme === "dark" ? "☀️" : "🌙";
}
function toggleTheme() {
  const cur = document.body.getAttribute("data-theme");
  applyTheme(cur === "dark" ? "light" : "dark");
}
applyTheme(localStorage.getItem("talkbee-theme") || "light");

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function el(id) { return document.getElementById(id); }
function showToast(icon, title, body, onClick) {
  const stack = el("toast-stack");
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `<div class="t-ico">${icon}</div><div><div class="t-title">${escapeHtml(title)}</div><div class="t-body">${escapeHtml(body)}</div></div>`;
  if (onClick) t.addEventListener("click", onClick);
  stack.appendChild(t);
  setTimeout(() => { t.style.transition = "opacity .25s,transform .25s"; t.style.opacity = "0"; t.style.transform = "translateX(24px)"; setTimeout(() => t.remove(), 250); }, 4500);
}
function requestNotifPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}
function nativeNotify(title, body) {
  if ("Notification" in window && Notification.permission === "granted" && document.visibilityState === "hidden") {
    try { new Notification(title, { body, icon: "" }); } catch (e) {}
  }
}

// ---------------- AUTH SCREEN WIRING ----------------
function authError(msg) { const e = el("auth-error"); e.textContent = msg; e.style.display = "block"; el("auth-ok").style.display = "none"; }
function authOk(msg) { const e = el("auth-ok"); e.textContent = msg; e.style.display = "block"; el("auth-error").style.display = "none"; }
function clearAuthMsgs() { el("auth-error").style.display = "none"; el("auth-ok").style.display = "none"; }

function setAuthMode(mode) {
  clearAuthMsgs();
  ["login-form", "register-form", "forgot-form"].forEach((id) => el(id).classList.add("hidden"));
  el("auth-switch-login-view").classList.add("hidden");
  el("auth-switch-register-view").classList.add("hidden");
  if (mode === "login") {
    el("login-form").classList.remove("hidden");
    el("auth-title").textContent = "Welcome back";
    el("auth-sub").textContent = "Log in to keep the conversation going.";
    el("auth-switch-login-view").classList.remove("hidden");
  } else if (mode === "register") {
    el("register-form").classList.remove("hidden");
    el("auth-title").textContent = "Create your account";
    el("auth-sub").textContent = "Join TalkBee — it's free.";
    el("auth-switch-register-view").classList.remove("hidden");
  } else if (mode === "forgot") {
    el("forgot-form").classList.remove("hidden");
    el("auth-title").textContent = "Reset your password";
    el("auth-sub").textContent = "We'll email you a secure link.";
  }
}

function setBtnLoading(btn, loading, textWhenIdle) {
  btn.disabled = loading;
  btn.innerHTML = loading ? `<span class="spinner"></span> Please wait...` : textWhenIdle;
}

el("show-register-btn").addEventListener("click", () => setAuthMode("register"));
el("show-login-btn").addEventListener("click", () => setAuthMode("login"));
el("forgot-password-btn").addEventListener("click", () => setAuthMode("forgot"));
el("back-to-login-btn").addEventListener("click", () => setAuthMode("login"));

el("login-submit-btn").addEventListener("click", async () => {
  clearAuthMsgs();
  const email = el("login-email").value.trim();
  const pass = el("login-password").value;
  if (!email || !pass) { authError("Please enter your email and password."); return; }
  const btn = el("login-submit-btn");
  setBtnLoading(btn, true);
  try {
    await Auth.loginWithEmail(email, pass);
  } catch (e) {
    authError(Auth.mapAuthError(e));
  } finally {
    setBtnLoading(btn, false, "Log in");
  }
});

el("register-submit-btn").addEventListener("click", async () => {
  clearAuthMsgs();
  const name = el("reg-name").value.trim();
  const email = el("reg-email").value.trim();
  const pass = el("reg-password").value;
  if (!name || !email || !pass) { authError("Please fill in every field."); return; }
  if (pass.length < 6) { authError("Password should be at least 6 characters."); return; }
  const btn = el("register-submit-btn");
  setBtnLoading(btn, true);
  try {
    await Auth.registerWithEmail(name, email, pass);
  } catch (e) {
    authError(Auth.mapAuthError(e));
  } finally {
    setBtnLoading(btn, false, "Create account");
  }
});

el("google-login-btn").addEventListener("click", () => doGoogleAuth(el("google-login-btn"), "Continue with Google"));
el("google-register-btn").addEventListener("click", () => doGoogleAuth(el("google-register-btn"), "Continue with Google"));
async function doGoogleAuth(btn, label) {
  clearAuthMsgs();
  btn.disabled = true;
  try {
    await Auth.loginWithGoogle();
  } catch (e) {
    authError(Auth.mapAuthError(e));
  } finally {
    btn.disabled = false;
  }
}

el("forgot-submit-btn").addEventListener("click", async () => {
  clearAuthMsgs();
  const email = el("forgot-email").value.trim();
  if (!email) { authError("Please enter your account email."); return; }
  const btn = el("forgot-submit-btn");
  setBtnLoading(btn, true);
  try {
    await Auth.resetPassword(email);
    authOk("Reset link sent — check your inbox.");
  } catch (e) {
    authError(Auth.mapAuthError(e));
  } finally {
    setBtnLoading(btn, false, "Send reset link");
  }
});

[["login-email", () => el("login-submit-btn").click()], ["login-password", () => el("login-submit-btn").click()]]
  .forEach(([id, fn]) => el(id).addEventListener("keydown", (e) => { if (e.key === "Enter") fn(); }));
["reg-name", "reg-email", "reg-password"].forEach((id) => el(id).addEventListener("keydown", (e) => { if (e.key === "Enter") el("register-submit-btn").click(); }));
el("forgot-email").addEventListener("keydown", (e) => { if (e.key === "Enter") el("forgot-submit-btn").click(); });

// ---------------- SESSION ----------------
Auth.watchAuthState(
  (user) => { me = user; enterApp(); },
  () => { me = null; leaveApp(); }
);

function leaveApp() {
  el("app-screen").classList.add("hidden");
  el("auth-screen").classList.remove("hidden");
  setAuthMode("login");
  if (unsubChats) unsubChats();
  if (unsubMessages) unsubMessages();
  if (unsubTyping) unsubTyping();
  if (unsubUsers) unsubUsers();
  if (stopPresence) stopPresence();
  chats = []; activeChatId = null; activeMessages = [];
}

function enterApp() {
  el("auth-screen").classList.add("hidden");
  el("app-screen").classList.remove("hidden");
  requestNotifPermission();
  renderRailAvatar();
  stopPresence = Chat.startPresence(me.uid);
  unsubUsers = Chat.listenAllUsers((users) => {
    usersCache = users;
    if (me && usersCache[me.uid]) me = { ...me, ...usersCache[me.uid] };
    renderRailAvatar();
    renderChatList();
    if (activeChatId) updateTopbarPresence();
  });
  unsubChats = Chat.listenMyChats(me.uid, (list) => {
    chats = list;
    renderChatList();
  });
}

function renderRailAvatar() {
  const av = el("rail-me-avatar");
  av.innerHTML = me.photoURL ? `<img src="${me.photoURL}" style="width:100%;height:100%;object-fit:cover;">` : (me.name ? me.name[0].toUpperCase() : "🐝");
}

// ---------------- USER HELPERS ----------------
function getUser(uid) { return usersCache[uid] || { name: "Unknown", id: uid }; }
function timeAgo(ts) {
  if (!ts) return "a while ago";
  const ms = ts.toDate ? ts.toDate().getTime() : ts;
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  return Math.floor(hrs / 24) + "d ago";
}
function fmtTime(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ---------------- CHAT LIST ----------------
function chatDisplayName(chat) {
  if (chat.type === "group") return chat.name;
  const otherUid = chat.members.find((u) => u !== me.uid);
  return getUser(otherUid).name || "Unknown user";
}
function chatAvatar(chat) {
  if (chat.type === "group") return chat.photoURL ? `<img src="${chat.photoURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">` : (chat.name ? chat.name[0].toUpperCase() : "🐝");
  const u = getUser(chat.members.find((x) => x !== me.uid));
  return u.photoURL ? `<img src="${u.photoURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">` : (u.name ? u.name[0].toUpperCase() : "?");
}
function chatOnline(chat) {
  if (chat.type === "group") return false;
  const u = getUser(chat.members.find((x) => x !== me.uid));
  return !!u.online;
}
function isBlockedChat(chat) {
  if (chat.type !== "direct" || !me.blockedUsers) return false;
  const otherUid = chat.members.find((u) => u !== me.uid);
  return me.blockedUsers.includes(otherUid);
}

function renderChatList() {
  const list = el("chat-list");
  const q = (el("chat-search").value || "").toLowerCase();
  let filtered = [...chats];
  if (chatFilter === "direct") filtered = filtered.filter((c) => c.type === "direct");
  if (chatFilter === "group") filtered = filtered.filter((c) => c.type === "group");
  if (q) filtered = filtered.filter((c) => chatDisplayName(c).toLowerCase().includes(q) || (c.lastMessage?.text || "").toLowerCase().includes(q));

  list.innerHTML = "";
  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-hint">${chats.length === 0 ? "No chats yet. Tap + to start one." : "No matches."}</div>`;
  }
  let totalUnread = 0;
  filtered.forEach((chat) => {
    const unread = chat.unreadCounts?.[me.uid] || 0;
    totalUnread += unread;
    const item = document.createElement("div");
    item.className = "chat-item" + (chat.id === activeChatId ? " active" : "");
    const lm = chat.lastMessage;
    const lastText = lm ? (lm.senderId === me.uid ? "You: " : "") + lm.text : "No messages yet";
    item.innerHTML = `
      <div class="avatar-wrap"><div class="avatar-circle">${chatAvatar(chat)}</div>${chat.type === "direct" ? `<div class="dot ${chatOnline(chat) ? "online" : ""}"></div>` : ""}</div>
      <div class="meta">
        <div class="row1"><div class="cname">${escapeHtml(chatDisplayName(chat))}</div><div class="ctime">${lm ? fmtTime(lm.ts) : ""}</div></div>
        <div class="row1"><div class="clast">${escapeHtml(lastText)}</div>${unread ? `<div class="unread">${unread}</div>` : ""}</div>
      </div>`;
    item.addEventListener("click", () => openChat(chat.id));
    list.appendChild(item);
  });
  const badge = el("rail-badge");
  if (totalUnread > 0) { badge.textContent = totalUnread > 99 ? "99+" : totalUnread; badge.classList.remove("hidden"); }
  else badge.classList.add("hidden");
}

el("chat-search").addEventListener("input", renderChatList);
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    chatFilter = btn.dataset.filter;
    renderChatList();
  });
});

// ---------------- OPEN CHAT ----------------
async function openChat(chatId) {
  activeChatId = chatId;
  replyingTo = null;
  el("reply-bar").classList.add("hidden");
  el("chat-empty").classList.add("hidden");
  el("chat-active").classList.remove("hidden");
  el("sidebar").classList.add("chat-open");
  el("chat-main").classList.add("chat-open");
  el("in-chat-search").classList.add("hidden");

  updateTopbarPresence();
  await Chat.markChatRead(chatId, me.uid);

  if (unsubMessages) unsubMessages();
  if (unsubTyping) unsubTyping();

  unsubMessages = Chat.listenMessages(chatId, (msgs) => {
    activeMessages = msgs;
    handleIncomingForNotifications(msgs);
    renderMessages(msgs);
    markVisibleAsRead(msgs);
    updatePinnedBar();
  });
  unsubTyping = Chat.listenTyping(chatId, (typers) => {
    const others = typers.filter((u) => u !== me.uid);
    el("typing-row").classList.toggle("hidden", others.length === 0);
  });

  renderChatList();
  closeDetailPanel();
}

let lastMsgCountForNotif = {};
function handleIncomingForNotifications(msgs) {
  if (msgs.length === 0) return;
  const last = msgs[msgs.length - 1];
  if (last.senderId !== me.uid && !notifiedMessageIds.has(last.id)) {
    notifiedMessageIds.add(last.id);
    if (lastMsgCountForNotif[activeChatId] !== undefined) {
      const sender = getUser(last.senderId);
      nativeNotify(sender.name || "New message", last.deleted ? "Message deleted" : (last.text || "Sent an attachment"));
    }
  }
  lastMsgCountForNotif[activeChatId] = msgs.length;
}

function updateTopbarPresence() {
  const chat = chats.find((c) => c.id === activeChatId);
  if (!chat) return;
  el("topbar-avatar-wrap").innerHTML = `<div class="avatar-circle">${chatAvatar(chat)}</div>${chat.type === "direct" ? `<div class="dot ${chatOnline(chat) ? "online" : ""}"></div>` : ""}`;
  el("topbar-name").textContent = chatDisplayName(chat);
  const statusEl = el("topbar-status");
  if (chat.type === "group") {
    statusEl.className = "cstatus";
    statusEl.textContent = chat.members.length + " members";
  } else {
    const u = getUser(chat.members.find((x) => x !== me.uid));
    statusEl.className = "cstatus" + (u.online ? " online" : "");
    statusEl.textContent = u.online ? "Online" : (u.lastSeen ? "Last seen " + timeAgo(u.lastSeen) : "Offline");
  }
}

function closeChatMobile() {
  el("sidebar").classList.remove("chat-open");
  el("chat-main").classList.remove("chat-open");
}
el("mobile-back-btn").addEventListener("click", closeChatMobile);
el("topbar-info-btn").addEventListener("click", () => openDetailPanel("chat"));
el("topbar-info").addEventListener("click", () => openDetailPanel("chat"));

// ---------------- MESSAGES RENDER ----------------
function renderMessages(msgs) {
  const wrap = el("messages");
  const chat = chats.find((c) => c.id === activeChatId);
  const atBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 80;
  wrap.innerHTML = "";
  let lastDay = null;
  msgs.forEach((m) => {
    if (m.deletedFor && m.deletedFor.includes(me.uid)) return;
    const dayKey = m.ts ? (m.ts.toDate ? m.ts.toDate().toDateString() : new Date(m.ts).toDateString()) : "now";
    if (dayKey !== lastDay) {
      const sep = document.createElement("div");
      sep.className = "day-sep";
      sep.textContent = dayKey === new Date().toDateString() ? "Today" : dayKey;
      wrap.appendChild(sep);
      lastDay = dayKey;
    }
    wrap.appendChild(renderMsgRow(m, chat));
  });
  if (atBottom) wrap.scrollTop = wrap.scrollHeight;
}

function renderMsgRow(m, chat) {
  const row = document.createElement("div");
  const isMe = m.senderId === me.uid;
  row.className = "msg-row " + (isMe ? "me" : "them");
  row.dataset.msgId = m.id;
  const sender = isMe ? me : getUser(m.senderId);

  let inner = "";
  if (chat.type === "group" && !isMe) inner += `<div class="small-avatar">${sender.photoURL ? `<img src="${sender.photoURL}" style="width:100%;height:100%;object-fit:cover;">` : (sender.name ? sender.name[0].toUpperCase() : "?")}</div>`;

  let bc = "";
  if (m.deleted) {
    bc = `<div class="deleted-bubble">🚫 This message was deleted</div>`;
  } else {
    if (chat.type === "group" && !isMe) bc += `<div class="sender-name">${escapeHtml(sender.name)}</div>`;
    if (m.forwardedFrom) bc += `<div class="forwarded-tag">↪ Forwarded</div>`;
    if (m.replyTo) bc += `<div class="reply-preview"><div class="rp-name">${escapeHtml(getUser(m.replyTo.senderId).name)}</div>${escapeHtml(m.replyTo.text || "Attachment")}</div>`;

    if (m.type === "image") {
      bc += `<img src="${m.fileURL}" class="msg-img" alt="shared image">`;
      if (m.text) bc += `<div>${escapeHtml(m.text)}</div>`;
    } else if (m.type === "video") {
      bc += `<video src="${m.fileURL}" class="msg-video" controls></video>`;
    } else if (m.type === "voice" || m.type === "audio") {
      bc += `<div class="voice-msg"><button class="voice-play" data-url="${m.fileURL}">▶️</button><div class="voice-wave"></div><span style="font-size:.72rem;">${m.duration ? formatDuration(m.duration) : ""}</span></div>`;
    } else if (m.type === "file") {
      bc += `<a href="${m.fileURL}" target="_blank" style="color:inherit;"><div class="file-chip"><span class="fi">📄</span><div><div class="fname">${escapeHtml(m.fileName || "Document")}</div><div class="fsize">${m.fileSize || ""}</div></div></div></a>`;
    } else {
      bc += `<div>${escapeHtml(m.text)}${m.edited ? ' <span class="edited-tag">(edited)</span>' : ""}</div>`;
    }
    const readByOthers = (m.readBy || []).some((u) => u !== me.uid && chat.members.includes(u));
    const tick = isMe ? `<span class="seen-tick ${readByOthers ? "read" : ""}">${readByOthers ? "✓✓" : "✓"}</span>` : "";
    bc += `<span class="mtime">${fmtTime(m.ts)}${tick}</span>`;
  }
  inner += `<div class="bubble">${bc}</div>`;

  if (!m.deleted) {
    inner += `<div class="msg-actions">
      <button class="act-reply" title="Reply">↩️</button>
      <button class="act-forward" title="Forward">↪️</button>
      ${isMe && m.type === "text" ? `<button class="act-edit" title="Edit">✏️</button>` : ""}
      <button class="act-pin" title="Pin">📌</button>
      ${isMe ? `<button class="act-delete" title="Delete">🗑️</button>` : ""}
    </div>`;
  }

  row.innerHTML = inner;
  row.querySelectorAll("img.msg-img").forEach((img) => img.addEventListener("click", () => openLightbox(img.src, "image")));
  row.querySelectorAll(".voice-play").forEach((btn) => btn.addEventListener("click", () => playVoice(btn)));
  const actReply = row.querySelector(".act-reply"); if (actReply) actReply.addEventListener("click", () => startReply(m));
  const actForward = row.querySelector(".act-forward"); if (actForward) actForward.addEventListener("click", () => openForwardModal(m));
  const actEdit = row.querySelector(".act-edit"); if (actEdit) actEdit.addEventListener("click", () => startEdit(m, row));
  const actPin = row.querySelector(".act-pin"); if (actPin) actPin.addEventListener("click", () => Chat.pinMessage(activeChatId, m.id));
  const actDelete = row.querySelector(".act-delete"); if (actDelete) actDelete.addEventListener("click", () => openDeleteChoice(m));
  return row;
}

function formatDuration(sec) { const m = Math.floor(sec / 60); const s = Math.floor(sec % 60); return `${m}:${s.toString().padStart(2, "0")}`; }

let currentAudio = null;
function playVoice(btn) {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  const audio = new Audio(btn.dataset.url);
  currentAudio = audio;
  btn.textContent = "⏸️";
  audio.play();
  audio.onended = () => { btn.textContent = "▶️"; };
}

async function markVisibleAsRead(msgs) {
  const unread = msgs.filter((m) => m.senderId !== me.uid && !(m.readBy || []).includes(me.uid)).map((m) => m.id);
  if (unread.length) await Chat.markMessagesRead(activeChatId, unread, me.uid);
}

function updatePinnedBar() {
  const chat = chats.find((c) => c.id === activeChatId);
  const bar = el("pinned-bar");
  if (chat && chat.pinnedMessageId) {
    const m = activeMessages.find((x) => x.id === chat.pinnedMessageId);
    if (m) {
      bar.classList.remove("hidden");
      el("pinned-text").textContent = m.text || previewLabel(m);
    } else bar.classList.add("hidden");
  } else bar.classList.add("hidden");
}
function previewLabel(m) {
  if (m.type === "image") return "📷 Photo";
  if (m.type === "video") return "🎬 Video";
  if (m.type === "voice") return "🎤 Voice message";
  if (m.type === "file") return "📄 " + (m.fileName || "Document");
  return "";
}
el("unpin-btn").addEventListener("click", () => Chat.unpinMessage(activeChatId));
el("pinned-bar").addEventListener("click", (e) => {
  if (e.target.id === "unpin-btn") return;
  const chat = chats.find((c) => c.id === activeChatId);
  const row = document.querySelector(`[data-msg-id="${chat.pinnedMessageId}"]`);
  if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
});

// ---------------- IN-CHAT SEARCH ----------------
el("topbar-search-btn").addEventListener("click", () => {
  el("in-chat-search").classList.toggle("hidden");
  el("in-chat-search-input").focus();
});
el("in-chat-search-input").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  document.querySelectorAll(".msg-row").forEach((row) => {
    const id = row.dataset.msgId;
    const m = activeMessages.find((x) => x.id === id);
    const match = !q || (m && (m.text || "").toLowerCase().includes(q));
    row.style.display = match ? "flex" : "none";
  });
});

// ---------------- REPLY / EDIT / DELETE / FORWARD ----------------
function startReply(m) {
  replyingTo = m;
  el("reply-bar").classList.remove("hidden");
  el("rb-name").textContent = getUser(m.senderId).name || "You";
  el("rb-snippet").textContent = m.text || previewLabel(m);
  el("msg-input").focus();
}
el("cancel-reply-btn").addEventListener("click", () => { replyingTo = null; el("reply-bar").classList.add("hidden"); });

function startEdit(m, row) {
  const bubble = row.querySelector(".bubble");
  const original = bubble.innerHTML;
  bubble.innerHTML = `<textarea id="edit-inline-${m.id}" style="width:100%;min-width:200px;border-radius:8px;padding:6px;border:1px solid var(--line);background:var(--input-bg);color:inherit;">${escapeHtml(m.text)}</textarea>
    <div style="display:flex;gap:6px;margin-top:5px;">
      <button class="btn btn-primary" style="padding:4px 12px;font-size:.78rem;" id="save-edit-${m.id}">Save</button>
      <button class="btn btn-ghost" style="padding:4px 12px;font-size:.78rem;" id="cancel-edit-${m.id}">Cancel</button>
    </div>`;
  el(`save-edit-${m.id}`).addEventListener("click", async () => {
    const val = el(`edit-inline-${m.id}`).value.trim();
    if (val) await Chat.editMessage(activeChatId, m.id, val);
  });
  el(`cancel-edit-${m.id}`).addEventListener("click", () => { bubble.innerHTML = original; });
}

function openDeleteChoice(m) {
  const root = el("modal-root");
  root.innerHTML = `
    <div class="modal-backdrop" id="del-backdrop">
      <div class="modal-card">
        <h3>Delete message?</h3>
        <p style="color:var(--text-dim);font-size:.85rem;margin-bottom:16px;">This can't be undone.</p>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button class="btn btn-ghost btn-block" id="del-for-me">Delete for me</button>
          <button class="btn btn-danger btn-block" id="del-for-everyone">Delete for everyone</button>
          <button class="btn btn-ghost btn-block" id="del-cancel">Cancel</button>
        </div>
      </div>
    </div>`;
  el("del-backdrop").addEventListener("click", (e) => { if (e.target.id === "del-backdrop") root.innerHTML = ""; });
  el("del-cancel").addEventListener("click", () => (root.innerHTML = ""));
  el("del-for-me").addEventListener("click", async () => { await Chat.deleteMessage(activeChatId, m.id, false); root.innerHTML = ""; });
  el("del-for-everyone").addEventListener("click", async () => { await Chat.deleteMessage(activeChatId, m.id, true); root.innerHTML = ""; });
}

function openForwardModal(m) {
  const root = el("modal-root");
  root.innerHTML = `
    <div class="modal-backdrop" id="fwd-backdrop">
      <div class="modal-card">
        <h3>Forward message</h3>
        <div id="fwd-list"></div>
        <div class="modal-actions"><button class="btn btn-ghost btn-block" id="fwd-cancel">Cancel</button></div>
      </div>
    </div>`;
  const listEl = el("fwd-list");
  chats.forEach((c) => {
    const row = document.createElement("div");
    row.className = "contact-pick";
    row.style.cursor = "pointer";
    row.innerHTML = `<div class="avatar-circle" style="width:34px;height:34px;font-size:.9rem;">${chatAvatar(c)}</div><span class="cp-name">${escapeHtml(chatDisplayName(c))}</span>`;
    row.addEventListener("click", async () => {
      await Chat.forwardMessage(m, c.id, me.uid, c.members);
      showToast("↪️", "Forwarded", `Sent to ${chatDisplayName(c)}`);
      root.innerHTML = "";
    });
    listEl.appendChild(row);
  });
  el("fwd-backdrop").addEventListener("click", (e) => { if (e.target.id === "fwd-backdrop") root.innerHTML = ""; });
  el("fwd-cancel").addEventListener("click", () => (root.innerHTML = ""));
}

// ---------------- SENDING ----------------
const msgInput = el("msg-input");
function autoGrow(elx) { elx.style.height = "auto"; elx.style.height = Math.min(elx.scrollHeight, 120) + "px"; }
msgInput.addEventListener("input", () => {
  autoGrow(msgInput);
  if (!activeChatId) return;
  Chat.setTyping(activeChatId, me.uid, true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => Chat.setTyping(activeChatId, me.uid, false), 2200);
});
msgInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendCurrentMessage(); } });
el("send-btn").addEventListener("click", sendCurrentMessage);

async function sendCurrentMessage() {
  if (!activeChatId) return;
  const chat = chats.find((c) => c.id === activeChatId);
  if (isBlockedChat(chat)) { showToast("🚫", "Blocked", "You can't message a user you've blocked."); return; }
  const text = msgInput.value.trim();
  if (!text && pendingAttachments.length === 0) return;

  const replyPayload = replyingTo ? { senderId: replyingTo.senderId, text: replyingTo.text || previewLabel(replyingTo) } : null;

  if (pendingAttachments.length) {
    for (const att of pendingAttachments) {
      await Chat.sendMessage(activeChatId, me.uid, chat.members, {
        type: att.kind, fileURL: att.url, fileName: att.name, fileSize: att.size, mimeType: att.mimeType, replyTo: replyPayload,
      });
    }
    pendingAttachments = [];
    renderPreviewStrip();
  }
  if (text) {
    await Chat.sendMessage(activeChatId, me.uid, chat.members, { type: "text", text, replyTo: replyPayload });
  }
  msgInput.value = ""; autoGrow(msgInput);
  replyingTo = null; el("reply-bar").classList.add("hidden");
  Chat.setTyping(activeChatId, me.uid, false);
}

// ---------------- ATTACHMENTS ----------------
function renderPreviewStrip() {
  const strip = el("preview-strip");
  strip.innerHTML = "";
  pendingAttachments.forEach((att, idx) => {
    const chip = document.createElement("div");
    chip.className = "preview-chip";
    chip.innerHTML = att.kind === "image" ? `<img src="${att.url}"><span class="rm" data-idx="${idx}">✕</span>` : `<span class="fi">📄</span><span class="pf-name">${escapeHtml(att.name)}</span><span class="rm" data-idx="${idx}">✕</span>`;
    strip.appendChild(chip);
  });
  strip.querySelectorAll(".rm").forEach((btn) => btn.addEventListener("click", (e) => { pendingAttachments.splice(+e.target.dataset.idx, 1); renderPreviewStrip(); }));
}

async function handleFiles(fileList) {
  if (!activeChatId) return;
  const progressWrap = el("upload-progress");
  const bar = el("upload-bar");
  for (const file of [...fileList]) {
    progressWrap.classList.remove("hidden");
    bar.style.width = "0%";
    try {
      const result = await Storage.uploadChatFile(activeChatId, file, (pct) => (bar.style.width = pct + "%"));
      pendingAttachments.push(result);
      renderPreviewStrip();
    } catch (e) {
      showToast("⚠️", "Upload failed", e.message);
    }
  }
  progressWrap.classList.add("hidden");
}
el("attach-btn").addEventListener("click", () => el("file-input").click());
el("file-input").addEventListener("change", (e) => { handleFiles(e.target.files); e.target.value = ""; });
el("camera-btn").addEventListener("click", () => el("camera-input").click());
el("camera-input").addEventListener("change", (e) => { handleFiles(e.target.files); e.target.value = ""; });

// ---------------- VOICE MESSAGES ----------------
el("mic-btn").addEventListener("click", async () => {
  if (mediaRecorder && mediaRecorder.state === "recording") { stopRecording(true); return; }
  if (!activeChatId) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => recordChunks.push(e.data);
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const durationSec = (Date.now() - recordStart) / 1000;
      if (durationSec < 0.6) return;
      const blob = new Blob(recordChunks, { type: "audio/webm" });
      const chat = chats.find((c) => c.id === activeChatId);
      try {
        const { url, duration } = await Storage.uploadVoiceMessage(activeChatId, blob, durationSec);
        await Chat.sendMessage(activeChatId, me.uid, chat.members, { type: "voice", fileURL: url, duration });
      } catch (e) {
        showToast("⚠️", "Voice message failed", e.message);
      }
    };
    mediaRecorder.start();
    recordStart = Date.now();
    el("recording-ui").classList.remove("hidden");
    el("mic-btn").classList.add("recording");
    recordTimerInt = setInterval(() => {
      const sec = Math.floor((Date.now() - recordStart) / 1000);
      el("record-timer").textContent = formatDuration(sec);
    }, 300);
  } catch (e) {
    showToast("🎤", "Microphone blocked", "Please allow microphone access to send voice messages.");
  }
});
el("cancel-record-btn").addEventListener("click", () => stopRecording(false));
function stopRecording(shouldSend) {
  clearInterval(recordTimerInt);
  el("recording-ui").classList.add("hidden");
  el("mic-btn").classList.remove("recording");
  if (mediaRecorder) {
    if (!shouldSend) mediaRecorder.onstop = () => mediaRecorder.stream.getTracks().forEach((t) => t.stop());
    mediaRecorder.stop();
  }
}

// ---------------- EMOJI & STICKERS ----------------
let emojiOpen = false, emojiTab = "emoji";
function toggleEmojiPicker() {
  emojiOpen = !emojiOpen;
  renderEmojiPopover();
}
function renderEmojiPopover() {
  let pop = el("emoji-popover-el");
  if (!emojiOpen) { if (pop) pop.remove(); return; }
  if (pop) pop.remove();
  pop = document.createElement("div");
  pop.id = "emoji-popover-el";
  pop.className = "emoji-popover";
  pop.innerHTML = `<div class="emoji-tabs">
      <button class="${emojiTab === "emoji" ? "active" : ""}" data-t="emoji">😊 Emoji</button>
      <button class="${emojiTab === "sticker" ? "active" : ""}" data-t="sticker">🎨 Stickers</button>
    </div>`;
  if (emojiTab === "emoji") {
    EMOJI_SET.forEach((em) => {
      const b = document.createElement("button");
      b.textContent = em;
      b.addEventListener("click", () => { msgInput.value += em; msgInput.focus(); autoGrow(msgInput); });
      pop.appendChild(b);
    });
  } else {
    const grid = document.createElement("div");
    grid.className = "sticker-grid";
    STICKERS.forEach((st) => {
      const b = document.createElement("button");
      b.textContent = st;
      b.addEventListener("click", async () => {
        if (!activeChatId) return;
        const chat = chats.find((c) => c.id === activeChatId);
        await Chat.sendMessage(activeChatId, me.uid, chat.members, { type: "text", text: st });
        emojiOpen = false; renderEmojiPopover();
      });
      grid.appendChild(b);
    });
    pop.appendChild(grid);
  }
  pop.querySelectorAll(".emoji-tabs button").forEach((b) => b.addEventListener("click", () => { emojiTab = b.dataset.t; renderEmojiPopover(); }));
  document.querySelector(".composer").appendChild(pop);
}
el("emoji-btn").addEventListener("click", toggleEmojiPicker);
document.addEventListener("click", (e) => {
  const pop = el("emoji-popover-el");
  if (pop && emojiOpen && !pop.contains(e.target) && e.target !== el("emoji-btn")) { emojiOpen = false; renderEmojiPopover(); }
});

// ---------------- LIGHTBOX ----------------
function openLightbox(src, kind) {
  el("lb-content").innerHTML = kind === "video" ? `<video src="${src}" controls autoplay></video>` : `<img src="${src}">`;
  el("lightbox").classList.remove("hidden");
}
el("lb-close").addEventListener("click", () => el("lightbox").classList.add("hidden"));
el("lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") e.currentTarget.classList.add("hidden"); });

// ---------------- NEW CHAT / NEW GROUP ----------------
el("rail-new-chat").addEventListener("click", openNewChatModal);
function openNewChatModal() {
  const root = el("modal-root");
  const others = Object.values(usersCache).filter((u) => u.id !== me.uid);
  root.innerHTML = `
    <div class="modal-backdrop" id="new-chat-backdrop">
      <div class="modal-card">
        <h3>Start a new chat</h3>
        <input type="text" class="modal-search" id="nc-search" placeholder="Search people..." style="width:100%;padding:9px 12px;border-radius:9px;border:1px solid var(--line);background:var(--input-bg);">
        <div id="contact-picks" style="margin-top:10px;max-height:320px;overflow-y:auto;"></div>
        <div class="field" style="margin-top:12px;"><label>Group name (for 2+ people)</label><input type="text" id="new-group-name" placeholder="e.g. Design Team"></div>
        <div class="modal-actions">
          <button class="btn btn-ghost btn-block" id="new-chat-cancel">Cancel</button>
          <button class="btn btn-primary btn-block" id="new-chat-create">Start</button>
        </div>
      </div>
    </div>`;
  function renderPicks(filterQ) {
    const wrap = el("contact-picks");
    wrap.innerHTML = "";
    others.filter((u) => !filterQ || (u.name || "").toLowerCase().includes(filterQ.toLowerCase())).forEach((u) => {
      const label = document.createElement("label");
      label.className = "contact-pick";
      label.innerHTML = `<input type="checkbox" value="${u.id}"><div class="avatar-circle" style="width:34px;height:34px;font-size:.9rem;">${u.photoURL ? `<img src="${u.photoURL}" style="width:100%;height:100%;object-fit:cover;">` : (u.name ? u.name[0].toUpperCase() : "?")}</div><span class="cp-name">${escapeHtml(u.name)}</span><span class="dot ${u.online ? "online" : ""}"></span>`;
      wrap.appendChild(label);
    });
    if (others.length === 0) wrap.innerHTML = `<div class="empty-hint">No other users registered yet. Invite someone to join TalkBee!</div>`;
  }
  renderPicks("");
  el("nc-search").addEventListener("input", (e) => renderPicks(e.target.value));
  el("new-chat-cancel").addEventListener("click", () => (root.innerHTML = ""));
  el("new-chat-backdrop").addEventListener("click", (e) => { if (e.target.id === "new-chat-backdrop") root.innerHTML = ""; });
  el("new-chat-create").addEventListener("click", async () => {
    const picked = [...root.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
    if (picked.length === 0) return;
    if (picked.length === 1) {
      const id = await Chat.startDirectChat(me.uid, picked[0]);
      root.innerHTML = "";
      openChat(id);
    } else {
      const name = el("new-group-name").value.trim() || "New Group";
      const id = await Chat.createGroupChat(me.uid, picked, name, null);
      root.innerHTML = "";
      openChat(id);
      showToast("🐝", "Group created", `"${name}" is ready.`);
    }
  });
}

// ---------------- DETAIL / PROFILE / SETTINGS PANEL ----------------
function openDetailPanel(mode) {
  const panel = el("detail-panel");
  const overlay = el("overlay");
  let html = "";
  if (mode === "me") {
    html = `
      <div class="dp-head"><h3>Your profile</h3><button class="icon-btn" id="dp-close">✕</button></div>
      <div class="dp-body">
        <div class="dp-avatar-lg" id="dp-avatar-click">${me.photoURL ? `<img src="${me.photoURL}" style="width:100%;height:100%;object-fit:cover;">` : (me.name ? me.name[0].toUpperCase() : "🐝")}<div class="cam-overlay">📷</div></div>
        <input type="file" id="dp-avatar-input" accept="image/*" class="hidden">
        <h2>${escapeHtml(me.name)}</h2>
        <div class="dp-username">@${escapeHtml(me.username || "")}</div>
        <div class="dp-field"><label>Name</label><input id="dp-name" value="${escapeHtml(me.name)}"></div>
        <div class="dp-field"><label>Bio / About</label><textarea id="dp-status" rows="2">${escapeHtml(me.bio || "")}</textarea></div>
        <div class="dp-field"><label>Email</label><div class="val">${escapeHtml(me.email || "—")}</div></div>
        <button class="btn btn-primary btn-block" id="dp-save">Save changes</button>
      </div>`;
  } else if (mode === "settings") {
    html = `
      <div class="dp-head"><h3>Settings</h3><button class="icon-btn" id="dp-close">✕</button></div>
      <div class="dp-body">
        <div class="settings-row"><div><div class="sr-label">Dark mode</div><div class="sr-sub">Toggle app appearance</div></div><div class="switch ${document.body.getAttribute("data-theme") === "dark" ? "on" : ""}" id="settings-theme-switch"><div class="knob"></div></div></div>
        <div class="settings-row"><div><div class="sr-label">Read receipts</div><div class="sr-sub">Let others see blue ticks</div></div><div class="switch ${me.privacy?.readReceipts !== false ? "on" : ""}" id="settings-receipts-switch"><div class="knob"></div></div></div>
        <div class="settings-row"><div><div class="sr-label">Last seen</div><div class="sr-sub">Who can see when you were last online</div></div><select class="select-inline" id="settings-lastseen"><option value="everyone">Everyone</option><option value="nobody">Nobody</option></select></div>
        <div class="settings-row"><div><div class="sr-label">Blocked users</div><div class="sr-sub">${(me.blockedUsers || []).length} blocked</div></div><button class="link-btn" id="manage-blocked-btn">Manage</button></div>
        <div class="settings-row" style="border-bottom:none;"><button class="btn btn-danger btn-block" id="settings-logout-btn">Log out</button></div>
      </div>`;
  } else {
    const chat = chats.find((c) => c.id === activeChatId);
    if (!chat) return;
    if (chat.type === "direct") {
      const otherUid = chat.members.find((u) => u !== me.uid);
      const u = getUser(otherUid);
      const blocked = (me.blockedUsers || []).includes(otherUid);
      html = `
        <div class="dp-head"><h3>Contact info</h3><button class="icon-btn" id="dp-close">✕</button></div>
        <div class="dp-body">
          <div class="dp-avatar-lg">${u.photoURL ? `<img src="${u.photoURL}" style="width:100%;height:100%;object-fit:cover;">` : (u.name ? u.name[0].toUpperCase() : "?")}</div>
          <h2>${escapeHtml(u.name)}</h2>
          <div class="dp-username">${u.online ? "🟢 Online" : "⚪ Last seen " + timeAgo(u.lastSeen)}</div>
          <div class="dp-field"><label>Bio</label><div class="val">${escapeHtml(u.bio || "—")}</div></div>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:18px;">
            <button class="btn btn-ghost btn-block" id="block-user-btn">${blocked ? "Unblock" : "Block"} user</button>
            <button class="btn btn-ghost btn-block" id="report-user-btn" style="color:var(--danger);">Report user</button>
          </div>
        </div>`;
    } else {
      html = `
        <div class="dp-head"><h3>Group info</h3><button class="icon-btn" id="dp-close">✕</button></div>
        <div class="dp-body">
          <div class="dp-avatar-lg">${chat.photoURL ? `<img src="${chat.photoURL}" style="width:100%;height:100%;object-fit:cover;">` : (chat.name ? chat.name[0].toUpperCase() : "🐝")}</div>
          <h2>${escapeHtml(chat.name)}</h2>
          <div class="dp-username">${chat.members.length} members</div>
          <div class="members-list">${chat.members.map((id) => { const u = getUser(id); return `<div class="member-row"><div class="avatar-circle">${u.photoURL ? `<img src="${u.photoURL}" style="width:100%;height:100%;object-fit:cover;">` : (u.name ? u.name[0].toUpperCase() : "?")}</div><div class="mname">${escapeHtml(u.name)}</div>${chat.admins?.includes(id) ? '<span class="mbadge">Admin</span>' : ""}<div class="dot ${u.online ? "online" : ""}" style="position:static;margin-left:6px;"></div></div>`; }).join("")}</div>
        </div>`;
    }
  }
  panel.innerHTML = html;
  panel.classList.add("open");
  overlay.classList.add("show");
  el("dp-close").addEventListener("click", closeDetailPanel);
  overlay.onclick = closeDetailPanel;
  wireDetailPanelActions(mode);
}
function closeDetailPanel() { el("detail-panel").classList.remove("open"); el("overlay").classList.remove("show"); }
el("rail-me-avatar").addEventListener("click", () => openDetailPanel("me"));
el("rail-settings-btn").addEventListener("click", () => openDetailPanel("settings"));
el("rail-theme-btn").addEventListener("click", toggleTheme);
el("rail-logout").addEventListener("click", () => Auth.logout());

function wireDetailPanelActions(mode) {
  if (mode === "me") {
    el("dp-avatar-click").addEventListener("click", () => el("dp-avatar-input").click());
    el("dp-avatar-input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      showToast("⬆️", "Uploading photo...", "");
      try {
        const url = await Storage.uploadProfilePhoto(me.uid, file);
        await Chat.updateMyProfile(me.uid, { photoURL: url });
        showToast("✅", "Profile photo updated", "");
      } catch (err) { showToast("⚠️", "Upload failed", err.message); }
    });
    el("dp-save").addEventListener("click", async () => {
      const name = el("dp-name").value.trim() || me.name;
      const bio = el("dp-status").value.trim();
      await Chat.updateMyProfile(me.uid, { name, nameLower: name.toLowerCase(), bio });
      showToast("✅", "Profile updated", "Your changes have been saved.");
      closeDetailPanel();
    });
  } else if (mode === "settings") {
    el("settings-theme-switch").addEventListener("click", () => { toggleTheme(); el("settings-theme-switch").classList.toggle("on"); });
    el("settings-receipts-switch").addEventListener("click", async () => {
      const on = !el("settings-receipts-switch").classList.contains("on");
      el("settings-receipts-switch").classList.toggle("on");
      await Chat.updateMyProfile(me.uid, { "privacy.readReceipts": on });
    });
    const lastSeenSel = el("settings-lastseen");
    lastSeenSel.value = me.privacy?.lastSeen || "everyone";
    lastSeenSel.addEventListener("change", async () => { await Chat.updateMyProfile(me.uid, { "privacy.lastSeen": lastSeenSel.value }); });
    el("manage-blocked-btn").addEventListener("click", () => openBlockedListModal());
    el("settings-logout-btn").addEventListener("click", () => Auth.logout());
  } else {
    const chat = chats.find((c) => c.id === activeChatId);
    if (chat && chat.type === "direct") {
      const otherUid = chat.members.find((u) => u !== me.uid);
      const blockBtn = el("block-user-btn");
      if (blockBtn) blockBtn.addEventListener("click", async () => {
        const blocked = (me.blockedUsers || []).includes(otherUid);
        if (blocked) await Chat.unblockUser(me.uid, otherUid);
        else await Chat.blockUser(me.uid, otherUid);
        showToast(blocked ? "✅" : "🚫", blocked ? "Unblocked" : "Blocked", "");
        openDetailPanel("chat");
      });
      const reportBtn = el("report-user-btn");
      if (reportBtn) reportBtn.addEventListener("click", () => openReportModal(otherUid));
    }
  }
}

function openBlockedListModal() {
  const root = el("modal-root");
  const blocked = (me.blockedUsers || []).map((id) => getUser(id));
  root.innerHTML = `
    <div class="modal-backdrop" id="bl-backdrop">
      <div class="modal-card">
        <h3>Blocked users</h3>
        <div id="bl-list">${blocked.length === 0 ? '<div class="empty-hint">No blocked users.</div>' : ""}</div>
        <div class="modal-actions"><button class="btn btn-ghost btn-block" id="bl-close">Close</button></div>
      </div>
    </div>`;
  const list = el("bl-list");
  blocked.forEach((u) => {
    const row = document.createElement("div");
    row.className = "contact-pick";
    row.innerHTML = `<span class="cp-name">${escapeHtml(u.name)}</span><button class="link-btn" data-uid="${u.id}">Unblock</button>`;
    row.querySelector("button").addEventListener("click", async () => { await Chat.unblockUser(me.uid, u.id); root.innerHTML = ""; });
    list.appendChild(row);
  });
  el("bl-close").addEventListener("click", () => (root.innerHTML = ""));
  el("bl-backdrop").addEventListener("click", (e) => { if (e.target.id === "bl-backdrop") root.innerHTML = ""; });
}

function openReportModal(targetUid) {
  const root = el("modal-root");
  root.innerHTML = `
    <div class="modal-backdrop" id="rep-backdrop">
      <div class="modal-card">
        <h3>Report user</h3>
        <div class="field"><label>Reason</label><textarea id="rep-reason" rows="3" style="width:100%;padding:10px;border-radius:9px;border:1px solid var(--line);background:var(--input-bg);" placeholder="Tell us what happened..."></textarea></div>
        <div class="modal-actions"><button class="btn btn-ghost btn-block" id="rep-cancel">Cancel</button><button class="btn btn-danger btn-block" id="rep-submit">Submit report</button></div>
      </div>
    </div>`;
  el("rep-cancel").addEventListener("click", () => (root.innerHTML = ""));
  el("rep-backdrop").addEventListener("click", (e) => { if (e.target.id === "rep-backdrop") root.innerHTML = ""; });
  el("rep-submit").addEventListener("click", async () => {
    const reason = el("rep-reason").value.trim() || "No reason provided";
    await Chat.reportUser(me.uid, targetUid, reason);
    showToast("✅", "Report submitted", "Our team will review this.");
    root.innerHTML = "";
  });
}
