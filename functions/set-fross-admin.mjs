import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const projectId = process.env.FIREBASE_PROJECT_ID || "fross-ca5d6";
const uid = process.argv[2];
if (!uid) {
  throw new Error("Usage: GOOGLE_APPLICATION_CREDENTIALS=/path/key.json node set-fross-admin.mjs FIREBASE_UID");
}
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  throw new Error("Set GOOGLE_APPLICATION_CREDENTIALS to a private service-account JSON path. Do not commit the key.");
}

initializeApp({ credential: applicationDefault(), projectId });
const auth = getAuth();
const user = await auth.getUser(uid);
await auth.setCustomUserClaims(uid, { ...(user.customClaims || {}), frossAdmin: true });
console.log("FROSS admin claim assigned to UID:", uid);
console.log("Sign out and sign in again to refresh the user's ID token.");
