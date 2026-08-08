import { db, auth } from "./firebase-config.js";
import {
  collection, doc, setDoc, addDoc, updateDoc, deleteDoc, getDoc, getDocs,
  onSnapshot, query, where, orderBy, limit, serverTimestamp, increment,
  arrayUnion, arrayRemove, writeBatch, deleteField
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// ---------- USERS ----------
export function listenAllUsers(cb) {
  return onSnapshot(collection(db, "users"), (snap) => {
    const users = {};
    snap.forEach((d) => (users[d.id] = { id: d.id, ...d.data() }));
    cb(users);
  });
}

export async function updateMyProfile(uid, fields) {
  await setDoc(doc(db, "users", uid), fields, { merge: true });
}

export async function blockUser(myUid, targetUid) {
  await updateDoc(doc(db, "users", myUid), { blockedUsers: arrayUnion(targetUid) });
}
export async function unblockUser(myUid, targetUid) {
  await updateDoc(doc(db, "users", myUid), { blockedUsers: arrayRemove(targetUid) });
}
export async function reportUser(reporterUid, targetUid, reason) {
  await addDoc(collection(db, "reports"), {
    reporterUid, targetUid, reason,
    status: "open",
    createdAt: serverTimestamp(),
  });
}

let presenceHeartbeat = null;
export function startPresence(uid) {
  setDoc(doc(db, "users", uid), { online: true, lastSeen: serverTimestamp() }, { merge: true });
  presenceHeartbeat = setInterval(() => {
    setDoc(doc(db, "users", uid), { lastSeen: serverTimestamp() }, { merge: true });
  }, 25000);
  const goOffline = () => {
    setDoc(doc(db, "users", uid), { online: false, lastSeen: serverTimestamp() }, { merge: true });
  };
  window.addEventListener("beforeunload", goOffline);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") goOffline();
    else setDoc(doc(db, "users", uid), { online: true, lastSeen: serverTimestamp() }, { merge: true });
  });
  return () => clearInterval(presenceHeartbeat);
}

// ---------- CHATS ----------
export function directChatId(uidA, uidB) {
  return "dm_" + [uidA, uidB].sort().join("_");
}

export async function startDirectChat(myUid, otherUid) {
  const id = directChatId(myUid, otherUid);
  const ref = doc(db, "chats", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      type: "direct",
      members: [myUid, otherUid],
      unreadCounts: { [myUid]: 0, [otherUid]: 0 },
      pinnedMessageId: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessage: null,
    });
  }
  return id;
}

export async function createGroupChat(myUid, memberUids, name, photoURL) {
  const members = [myUid, ...memberUids];
  const unreadCounts = {};
  members.forEach((u) => (unreadCounts[u] = 0));
  const ref = await addDoc(collection(db, "chats"), {
    type: "group",
    name,
    photoURL: photoURL || null,
    members,
    admins: [myUid],
    unreadCounts,
    pinnedMessageId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastMessage: null,
  });
  return ref.id;
}

export function listenMyChats(uid, cb) {
  const q = query(
    collection(db, "chats"),
    where("members", "array-contains", uid),
    orderBy("updatedAt", "desc")
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function markChatRead(chatId, uid) {
  await updateDoc(doc(db, "chats", chatId), { [`unreadCounts.${uid}`]: 0 });
}

export async function pinMessage(chatId, messageId) {
  await updateDoc(doc(db, "chats", chatId), { pinnedMessageId: messageId });
}
export async function unpinMessage(chatId) {
  await updateDoc(doc(db, "chats", chatId), { pinnedMessageId: null });
}

// ---------- MESSAGES ----------
export function listenMessages(chatId, cb) {
  const q = query(
    collection(db, "chats", chatId, "messages"),
    orderBy("ts", "asc"),
    limit(300)
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function sendMessage(chatId, senderId, members, payload) {
  const msgRef = await addDoc(collection(db, "chats", chatId, "messages"), {
    senderId,
    type: payload.type || "text",
    text: payload.text || "",
    fileURL: payload.fileURL || null,
    fileName: payload.fileName || null,
    fileSize: payload.fileSize || null,
    mimeType: payload.mimeType || null,
    duration: payload.duration || null,
    replyTo: payload.replyTo || null,
    forwardedFrom: payload.forwardedFrom || null,
    edited: false,
    deleted: false,
    readBy: [senderId],
    ts: serverTimestamp(),
  });

  const unreadUpdates = {};
  members.forEach((uid) => {
    if (uid !== senderId) unreadUpdates[`unreadCounts.${uid}`] = increment(1);
  });

  await updateDoc(doc(db, "chats", chatId), {
    lastMessage: {
      text: previewText(payload),
      senderId,
      ts: serverTimestamp(),
      type: payload.type || "text",
    },
    updatedAt: serverTimestamp(),
    [`unreadCounts.${senderId}`]: 0,
    ...unreadUpdates,
  });

  return msgRef.id;
}

function previewText(payload) {
  if (payload.type === "image") return "📷 Photo";
  if (payload.type === "video") return "🎬 Video";
  if (payload.type === "audio" || payload.type === "voice") return "🎤 Voice message";
  if (payload.type === "file") return "📄 " + (payload.fileName || "Document");
  return payload.text || "";
}

export async function editMessage(chatId, messageId, newText) {
  await updateDoc(doc(db, "chats", chatId, "messages", messageId), {
    text: newText,
    edited: true,
  });
}

export async function deleteMessage(chatId, messageId, forEveryone) {
  if (forEveryone) {
    await updateDoc(doc(db, "chats", chatId, "messages", messageId), {
      deleted: true,
      text: "",
      fileURL: null,
    });
  } else {
    await updateDoc(doc(db, "chats", chatId, "messages", messageId), {
      deletedFor: arrayUnion(auth.currentUser.uid),
    });
  }
}

export async function forwardMessage(fromMsg, toChatId, senderId, members) {
  return sendMessage(toChatId, senderId, members, {
    type: fromMsg.type,
    text: fromMsg.text,
    fileURL: fromMsg.fileURL,
    fileName: fromMsg.fileName,
    fileSize: fromMsg.fileSize,
    mimeType: fromMsg.mimeType,
    duration: fromMsg.duration,
    forwardedFrom: fromMsg.senderId,
  });
}

export async function markMessagesRead(chatId, messageIds, uid) {
  const batch = writeBatch(db);
  messageIds.forEach((id) => {
    batch.update(doc(db, "chats", chatId, "messages", id), {
      readBy: arrayUnion(uid),
    });
  });
  await batch.commit();
}

// ---------- TYPING ----------
export async function setTyping(chatId, uid, isTyping) {
  await setDoc(doc(db, "chats", chatId, "typing", uid), {
    isTyping,
    updatedAt: serverTimestamp(),
  });
}

export function listenTyping(chatId, cb) {
  return onSnapshot(collection(db, "chats", chatId, "typing"), (snap) => {
    const typers = [];
    snap.forEach((d) => {
      if (d.data().isTyping) typers.push(d.id);
    });
    cb(typers);
  });
}
