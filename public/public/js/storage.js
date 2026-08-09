import { storage } from "./firebase-config.js";
import {
  ref, uploadBytesResumable, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";

const MAX_FILE_MB = 50;

export function fileKind(file) {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
}

export function formatBytes(b) {
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
  return (b / (1024 * 1024)).toFixed(1) + " MB";
}

export function uploadChatFile(chatId, file, onProgress) {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      reject(new Error(`File exceeds the ${MAX_FILE_MB}MB limit.`));
      return;
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `chats/${chatId}/${Date.now()}_${safeName}`;
    const storageRef = ref(storage, path);
    const task = uploadBytesResumable(storageRef, file);
    task.on(
      "state_changed",
      (snap) => {
        const pct = (snap.bytesTransferred / snap.totalBytes) * 100;
        if (onProgress) onProgress(pct);
      },
      (err) => reject(err),
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        resolve({
          url,
          kind: fileKind(file),
          name: file.name,
          size: formatBytes(file.size),
          mimeType: file.type,
        });
      }
    );
  });
}

export function uploadVoiceMessage(chatId, blob, durationSec) {
  return new Promise((resolve, reject) => {
    const path = `chats/${chatId}/voice_${Date.now()}.webm`;
    const storageRef = ref(storage, path);
    const task = uploadBytesResumable(storageRef, blob);
    task.on(
      "state_changed",
      null,
      (err) => reject(err),
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        resolve({ url, duration: durationSec });
      }
    );
  });
}

export function uploadProfilePhoto(uid, file) {
  return new Promise((resolve, reject) => {
    const path = `avatars/${uid}_${Date.now()}`;
    const storageRef = ref(storage, path);
    const task = uploadBytesResumable(storageRef, file);
    task.on(
      "state_changed",
      null,
      (err) => reject(err),
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        resolve(url);
      }
    );
  });
}
