import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  doc, setDoc, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const googleProvider = new GoogleAuthProvider();

export function mapAuthError(err) {
  const code = err?.code || "";
  const map = {
    "auth/email-already-in-use": "That email is already registered. Try logging in instead.",
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
    "auth/popup-closed-by-user": "Sign-in popup was closed before completing.",
    "auth/network-request-failed": "Network error. Check your connection.",
  };
  return map[code] || err?.message || "Something went wrong. Please try again.";
}

async function ensureUserDoc(user, extra = {}) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const name = extra.name || user.displayName || user.email.split("@")[0];
    await setDoc(ref, {
      uid: user.uid,
      name,
      nameLower: name.toLowerCase(),
      username: extra.username || (user.email.split("@")[0] + Math.floor(Math.random() * 1000)),
      email: user.email,
      photoURL: user.photoURL || null,
      bio: "Hey there! I'm using TalkBee.",
      online: true,
      lastSeen: serverTimestamp(),
      createdAt: serverTimestamp(),
      blockedUsers: [],
      privacy: { lastSeen: "everyone", profilePhoto: "everyone", readReceipts: true },
    });
  } else {
    await setDoc(ref, { online: true, lastSeen: serverTimestamp() }, { merge: true });
  }
}

export async function registerWithEmail(name, email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name });
  await ensureUserDoc(cred.user, { name });
  return cred.user;
}

export async function loginWithEmail(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  await ensureUserDoc(cred.user);
  return cred.user;
}

export async function loginWithGoogle() {
  const cred = await signInWithPopup(auth, googleProvider);
  await ensureUserDoc(cred.user);
  return cred.user;
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

export async function logout() {
  if (auth.currentUser) {
    try {
      await setDoc(doc(db, "users", auth.currentUser.uid), {
        online: false,
        lastSeen: serverTimestamp(),
      }, { merge: true });
    } catch (e) { /* best effort */ }
  }
  await signOut(auth);
}

export function watchAuthState(onLogin, onLogout) {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      const ref = doc(db, "users", user.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        onLogin({ uid: user.uid, ...snap.data() });
      } else {
        await ensureUserDoc(user);
        const snap2 = await getDoc(ref);
        onLogin({ uid: user.uid, ...snap2.data() });
      }
    } else {
      onLogout();
    }
  });
}
