// ============================================================
// FIREBASE CONFIG — connected to the "talkbee-4de82" Firebase project
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import {
  getStorage, connectStorageEmulator
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyAbtEGFpoT79ctt6axbD18GegIuTFlHdZY",
  authDomain: "talkbee-4de82.firebaseapp.com",
  projectId: "talkbee-4de82",
  storageBucket: "talkbee-4de82.firebasestorage.app",
  messagingSenderId: "1077194498468",
  appId: "1:1077194498468:web:9fdd7fd3cc41b776ff6131",
  measurementId: "G-X3XJTNVWTY"
};

export const IS_CONFIGURED = firebaseConfig.apiKey !== "YOUR_API_KEY";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
