import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "fross-ca5d6";
const BUCKET_NAME = PROJECT_ID + ".firebasestorage.app";
const INPUT = process.argv[2] || path.join(__dirname, "d1-backup.sql");
const AUTH_DOMAIN = PROJECT_ID + ".firebaseapp.com";
const MARKER_PATH = "systemMigrations/d1-to-firebase-v1";
const FIRESTORE_BATCH_SIZE = 400;

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  throw new Error("Set GOOGLE_APPLICATION_CREDENTIALS to a local Firebase service-account JSON file. Never commit this file.");
}
if (!fs.existsSync(INPUT)) {
  throw new Error("D1 export not found: " + INPUT + "\nFirst run: npx wrangler d1 export fross-messenger-db --remote --output=./migration/d1-backup.sql");
}

const adminApp = initializeApp({
  credential: applicationDefault(),
  projectId: PROJECT_ID,
  storageBucket: BUCKET_NAME
});
const adminAuth = getAuth(adminApp);
const firestore = getFirestore(adminApp);
const bucket = getStorage(adminApp).bucket(BUCKET_NAME);

const SQL = await initSqlJs({
  locateFile: file => path.join(__dirname, "node_modules", "sql.js", "dist", file)
});
const sqlite = new SQL.Database(fs.readFileSync(INPUT));
const tableNames = new Set(
  sqlite.exec("SELECT name FROM sqlite_master WHERE type='table'").flatMap(r => r.values.map(v => String(v[0])))
);

function rows(table) {
  if (!tableNames.has(table)) return [];
  const result = sqlite.exec('SELECT * FROM "' + table.replace(/"/g, '""') + '"');
  if (!result.length) return [];
  const columns = result[0].columns;
  return result[0].values.map(values => Object.fromEntries(columns.map((name, i) => [name, values[i]])));
}
function asMillis(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function legacyAuthEmail(username) {
  return String(username).trim().toLowerCase() + "@" + AUTH_DOMAIN;
}
function chunk(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}
async function setInBatches(entries) {
  for (const group of chunk(entries, FIRESTORE_BATCH_SIZE)) {
    const batch = firestore.batch();
    for (const [ref, data] of group) batch.set(ref, data, { merge: true });
    await batch.commit();
  }
}
function makeAvatarUrl(user) {
  const raw = String(user.avatar || "");
  if (!raw.startsWith("data:image/")) return raw.startsWith("https://") ? raw : "";
  const match = raw.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return "";
  const buffer = Buffer.from(match[2], "base64");
  const contentType = match[1];
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) return "";
  return { buffer, contentType };
}
async function uploadLegacyAvatar(user, uid) {
  const avatar = makeAvatarUrl(user);
  if (!avatar) return avatar;
  const objectPath = "avatars/" + uid + "/avatar.jpg";
  const token = crypto.randomUUID();
  await bucket.file(objectPath).save(avatar.buffer, {
    resumable: false,
    metadata: {
      contentType: avatar.contentType,
      cacheControl: "public,max-age=3600",
      metadata: { firebaseStorageDownloadTokens: token }
    }
  });
  return "https://firebasestorage.googleapis.com/v0/b/" + bucket.name +
    "/o/" + encodeURIComponent(objectPath) + "?alt=media&token=" + token;
}
function firestoreChatId(rawId) {
  const id = String(rawId || "general");
  if (!id.includes("/") && id.length > 0 && id.length <= 1200) return id;
  return "legacy_" + crypto.createHash("sha256").update(id).digest("hex");
}

const users = rows("users");
const messages = rows("messages");
const legacyChats = rows("chats");
const legacyMembers = rows("chat_members");
if (!tableNames.has("users") || !tableNames.has("messages")) {
  throw new Error("The D1 SQL export must include users and messages tables.");
}
for (const u of users) {
  if (!u.id || !u.username) throw new Error("A D1 user is missing id or username.");
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(String(u.username))) throw new Error("Unsupported legacy username: " + u.username);
  if (!/^[a-f0-9]{64}$/i.test(String(u.password_hash || ""))) {
    throw new Error("Unsupported password hash for " + u.username + ". Expected 32-byte PBKDF2-SHA256 hex.");
  }
  if (!/^[a-f0-9]{64}$/i.test(String(u.password_salt || ""))) {
    throw new Error("Unsupported password salt for " + u.username + ". Expected the current 64-character salt string.");
  }
}
const uidSet = new Set(users.map(u => String(u.id)));
const profileByUid = new Map(users.map(u => [String(u.id), u]));
const usernameByUid = new Map(users.map(u => [String(u.id), String(u.username).toLowerCase()]));

const markerRef = firestore.doc(MARKER_PATH);
const markerSnap = await markerRef.get();
if (markerSnap.exists && markerSnap.data().status === "completed") {
  console.log("Migration already completed:", markerSnap.data());
  process.exit(0);
}
if (!markerSnap.exists) {
  const existing = await firestore.collection("users").limit(1).get();
  if (!existing.empty) {
    throw new Error("Firebase Firestore already contains user documents. Refusing to mix a D1 import into an occupied Firebase database.");
  }
  await markerRef.set({ status: "running", startedAt: FieldValue.serverTimestamp(), source: "Cloudflare D1" });
} else {
  console.log("Resuming previous incomplete migration.");
}

/*
 * The old Worker derived PBKDF2 with:
 *   salt: TextEncoder.encode(password_salt)
 *   iterations: 100000
 *   hash: SHA-256
 * The stored password_hash is the 32-byte result encoded as hex.
 * Therefore the import salt must be the UTF-8 bytes of the 64-character
 * salt text, not Buffer.from(saltText, "hex").
 */
const existingAuthIds = new Set();
for (const group of chunk(users, 100)) {
  const found = await adminAuth.getUsers(group.map(u => ({ uid: String(u.id) })));
  for (const item of found.users) {
    const expectedEmail = legacyAuthEmail(usernameByUid.get(item.uid));
    if (item.email && item.email.toLowerCase() !== expectedEmail.toLowerCase()) {
      throw new Error("Firebase Auth UID " + item.uid + " already exists with a different email. Stopping to avoid overwriting it.");
    }
    existingAuthIds.add(item.uid);
  }
}
const missingAuth = users.filter(u => !existingAuthIds.has(String(u.id)));
let imported = 0;
for (const group of chunk(missingAuth, 1000)) {
  const records = group.map(u => ({
    uid: String(u.id),
    email: legacyAuthEmail(u.username),
    emailVerified: false,
    disabled: false,
    displayName: String(u.display_name || u.username).slice(0, 256),
    passwordHash: Buffer.from(String(u.password_hash), "hex"),
    passwordSalt: Buffer.from(String(u.password_salt), "utf8")
  }));
  const result = await adminAuth.importUsers(records, {
    hash: { algorithm: "PBKDF2_SHA256", rounds: 100000 }
  });
  imported += result.successCount;
  if (result.failureCount) {
    const details = (result.errors || []).map(e => "index " + e.index + ": " + e.error?.message).join("\n");
    throw new Error("Firebase Auth imported " + result.successCount + " accounts in this batch but rejected " + result.failureCount + ":\n" + details + "\nRerun after fixing the reported conflicts; already imported UIDs will be skipped.");
  }
}
console.log("Firebase Auth accounts imported/skipped:", users.length, "new imports:", imported);

const usersEntries = [];
for (const u of users) {
  const uid = String(u.id);
  const username = String(u.username).toLowerCase();
  const avatarUrl = await uploadLegacyAvatar(u, uid);
  const createdAt = Timestamp.fromMillis(asMillis(u.created_at, Date.now()));
  const settings = (() => { try { return JSON.parse(String(u.settings || "{}")); } catch { return {}; } })();
  const publicProfile = {
    username,
    usernameLower: username,
    displayName: String(u.display_name || u.username).slice(0, 40),
    bio: String(u.bio || "").slice(0, 160),
    avatarUrl: typeof avatarUrl === "string" ? avatarUrl : "",
    lastSeenAt: u.last_seen ? Timestamp.fromMillis(asMillis(u.last_seen, Date.now())) : createdAt
  };
  const privateProfile = {
    contactEmail: String(u.email || ""),
    settings,
    createdAt,
    authProvider: "password",
    migratedFromD1: true
  };
  usersEntries.push([firestore.doc("usernameIndex/" + username), {
    uid, username, usernameLower: username, createdAt
  }]);
  usersEntries.push([firestore.doc("publicUsers/" + uid), publicProfile]);
  usersEntries.push([firestore.doc("users/" + uid), privateProfile]);
}
await setInBatches(usersEntries);
console.log("Firestore profiles imported:", users.length);

const membersByChat = new Map();
for (const row of legacyMembers) {
  const key = firestoreChatId(row.chat_id);
  if (!membersByChat.has(key)) membersByChat.set(key, new Set());
  if (uidSet.has(String(row.user_id))) membersByChat.get(key).add(String(row.user_id));
}
const chatData = new Map();
for (const c of legacyChats) {
  const id = firestoreChatId(c.id);
  const memberUids = [...(membersByChat.get(id) || new Set())];
  chatData.set(id, {
    type: c.type === "dm" ? "dm" : "group",
    title: String(c.title || ""),
    ownerUid: String(c.owner_id || memberUids[0] || ""),
    memberUids,
    createdAt: Timestamp.fromMillis(asMillis(c.created_at, Date.now())),
    updatedAt: Timestamp.fromMillis(asMillis(c.created_at, Date.now())),
    lastMessage: ""
  });
}
for (const message of messages) {
  const id = firestoreChatId(message.room_id || "general");
  if (id === "general" || chatData.has(id)) continue;
  const inferredMembers = [...new Set(messages.filter(m => firestoreChatId(m.room_id || "general") === id && uidSet.has(String(m.user_id))).map(m => String(m.user_id)))];
  chatData.set(id, {
    type: "group", title: "Перенесённый чат", ownerUid: inferredMembers[0] || "",
    memberUids: inferredMembers, createdAt: Timestamp.fromMillis(Date.now()),
    updatedAt: Timestamp.fromMillis(Date.now()), lastMessage: ""
  });
}
const profiles = new Map();
for (const u of users) {
  const uid=String(u.id),username=String(u.username).toLowerCase();
  profiles.set(uid,{uid,username,displayName:String(u.display_name||u.username).slice(0,40),avatarUrl:""});
}
for (const [chatId, data] of chatData) {
  data.memberProfiles=(data.memberUids||[]).map(uid=>profiles.get(uid)).filter(Boolean);
}
const chatEntries = [[firestore.doc("chats/general"),{
  type:"general",title:"Общий чат",ownerUid:"",memberUids:[],memberProfiles:[],
  createdAt:Timestamp.fromMillis(Date.now()),updatedAt:Timestamp.fromMillis(Date.now()),lastMessage:""
}]];
for (const [id, data] of chatData) {
  chatEntries.push([firestore.doc("chats/"+id),data]);
}
await setInBatches(chatEntries);
console.log("Firestore chats imported:", chatEntries.length);

const messagesByChat = new Map();
for (const m of messages) {
  const chatId=firestoreChatId(m.room_id||"general");
  if (!uidSet.has(String(m.user_id))) {
    throw new Error("Message " + m.id + " refers to a user not found in the D1 users table.");
  }
  if (!messagesByChat.has(chatId)) messagesByChat.set(chatId,[]);
  messagesByChat.get(chatId).push(m);
}
const messageEntries=[];
let newestByChat=new Map();
for (const [chatId, items] of messagesByChat) {
  items.sort((a,b)=>asMillis(a.created_at,0)-asMillis(b.created_at,0));
  for (const m of items) {
    const uid=String(m.user_id),u=profileByUid.get(uid);
    const millis=asMillis(m.created_at,Date.now());
    const messageId=String(m.id||crypto.randomUUID()).replaceAll("/","_").slice(0,1200);
    messageEntries.push([firestore.doc("chats/"+chatId+"/messages/"+messageId),{
      senderUid:uid,username:String(u.username).toLowerCase(),
      displayName:String(u.display_name||u.username).slice(0,40),
      text:String(m.body||"").slice(0,4000),
      createdAt:Timestamp.fromMillis(millis)
    }]);
    const prev=newestByChat.get(chatId);
    if(!prev||millis>prev.millis)newestByChat.set(chatId,{millis,text:String(m.body||"").slice(0,120)});
  }
}
await setInBatches(messageEntries);
for (const [chatId, last] of newestByChat) {
  await firestore.doc("chats/"+chatId).set({
    lastMessage:last.text,
    lastMessageAt:Timestamp.fromMillis(last.millis),
    updatedAt:Timestamp.fromMillis(last.millis)
  },{merge:true});
}
console.log("Firestore messages imported:", messageEntries.length);

await markerRef.set({
  status:"completed",
  completedAt:FieldValue.serverTimestamp(),
  users:users.length,
  authUsersImported:imported,
  chats:chatEntries.length,
  messages:messageEntries.length,
  source:"Cloudflare D1"
},{merge:true});
console.log("Migration finished. D1 was read only; no source rows were deleted or changed.");
