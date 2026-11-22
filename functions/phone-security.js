import { randomUUID } from "node:crypto";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { JwtVerifier } from "aws-jwt-verify";

if (!getApps().length) initializeApp();

const PROJECT_NUMBER = "200886619645";
const FPNV_ISSUER = `https://fpnv.googleapis.com/projects/${PROJECT_NUMBER}`;
const fpnvVerifier = JwtVerifier.create({
  issuer: FPNV_ISSUER,
  audience: FPNV_ISSUER,
  jwksUri: "https://fpnv.googleapis.com/v1beta/jwks",
});

const auth = getAuth();
const db = getFirestore();
const FIVE_MINUTES = 5 * 60 * 1000;

function cors(req, res) {
  const origin = req.get("Origin");
  const allowed = (process.env.FROSS_ALLOWED_ORIGINS || "")
    .split(",").map(value => value.trim()).filter(Boolean);
  if (origin && allowed.length && !allowed.includes(origin)) return false;
  res.set("Access-Control-Allow-Origin", origin && allowed.length ? origin : "*");
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Cache-Control", "no-store");
  return true;
}

function sendError(res, status, message) {
  return res.status(status).json({ ok: false, error: message });
}

async function requireFirebaseUser(req) {
  const match = (req.get("Authorization") || "").match(/^Bearer\\s+(.+)$/i);
  if (!match) throw Object.assign(new Error("Firebase ID token is required."), { status: 401 });
  const decoded = await auth.verifyIdToken(match[1], true);
  if (decoded.email_verified !== true && decoded.legacyAccount !== true) {
    throw Object.assign(new Error("Сначала подтвердите email вашего аккаунта FROSS."), { status: 403 });
  }
  return decoded;
}

function validateDeviceId(value) {
  return typeof value === "string" && /^[a-f0-9-]{20,64}$/i.test(value);
}

async function ensureSecurityBotMessage(uid, requestId, browserLabel, expiresAt) {
  const chatRef = db.doc(`chats/security_${uid}`);
  const now = Timestamp.now();
  await chatRef.set({
    type: "system",
    title: "FROSS Security",
    ownerUid: uid,
    memberUids: [uid],
    memberProfiles: [],
    createdAt: now,
    updatedAt: now,
    lastMessage: "Новый запрос на вход через браузер",
    lastMessageAt: now,
  }, { merge: true });

  await chatRef.collection("messages").doc(requestId).set({
    senderUid: "fross-security",
    username: "fross-security",
    displayName: "FROSS Security",
    text: `Попытка входа через ${browserLabel}. Подтвердите её в приложении FROSS.`,
    securityRequestId: requestId,
    securityRequestStatus: "pending",
    securityRequestExpiresAt: expiresAt,
    createdAt: now,
  });
}

export const verifyPhoneWithPnv = onRequest(async (req, res) => {
  if (!cors(req, res)) return sendError(res, 403, "Origin is not allowed.");
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed.");

  try {
    const user = await requireFirebaseUser(req);
    const { pnvToken, deviceId, deviceName } = req.body || {};
    if (typeof pnvToken !== "string" || pnvToken.length < 100 || pnvToken.length > 12000) {
      return sendError(res, 400, "Некорректный токен подтверждения номера.");
    }
    if (!validateDeviceId(deviceId)) return sendError(res, 400, "Некорректный идентификатор устройства.");

    let payload;
    try {
      payload = await fpnvVerifier.verify(pnvToken);
    } catch {
      return sendError(res, 403, "Подпись токена Firebase PNV не прошла проверку.");
    }

    const isTestToken = payload.test_number === true;
    if (isTestToken && process.env.FROSS_ALLOW_PNV_TEST_TOKENS !== "true") {
      return sendError(res, 403, "Тестовые PNV-токены запрещены в этой среде.");
    }

    const phoneNumber = typeof payload.sub === "string" ? payload.sub : "";
    if (!/^\\+[1-9]\\d{7,14}$/.test(phoneNumber)) {
      return sendError(res, 403, "PNV не вернул корректный международный номер.");
    }

    const account = await auth.getUser(user.uid);
    if (account.phoneNumber && account.phoneNumber !== phoneNumber) {
      return sendError(res, 409, "К аккаунту уже привязан другой номер. Для его замены нужна отдельная процедура.");
    }

    try {
      const owner = await auth.getUserByPhoneNumber(phoneNumber);
      if (owner.uid !== user.uid) return sendError(res, 409, "Этот номер уже привязан к другому аккаунту FROSS.");
    } catch (error) {
      if (error?.code !== "auth/user-not-found") throw error;
    }

    if (account.phoneNumber !== phoneNumber) {
      await auth.updateUser(user.uid, { phoneNumber });
    }

    const now = Timestamp.now();
    const deviceRef = db.doc(`users/${user.uid}/trustedDevices/${deviceId}`);
    await db.doc(`users/${user.uid}`).set({
      phoneNumber,
      phoneVerified: true,
      phoneVerificationMethod: "firebase-pnv",
      phoneVerifiedAt: now,
      phoneVerificationTest: isTestToken,
      updatedAt: now,
    }, { merge: true });
    await deviceRef.set({
      deviceId,
      deviceName: String(deviceName || "Android").slice(0, 60),
      platform: "android",
      status: "active",
      testDevice: isTestToken,
      createdAt: FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const customToken = await auth.createCustomToken(user.uid, { frossDeviceId: deviceId });
    return res.status(200).json({
      ok: true,
      phoneNumber,
      customToken,
      testMode: isTestToken,
      message: "Номер подтверждён. Устройство FROSS зарегистрировано.",
    });
  } catch (error) {
    console.error("FROSS PNV verification failed:", error);
    return sendError(res, error.status || 500, error.status ? error.message : "Не удалось подтвердить номер телефона.");
  }
});

export const createTrustedDeviceSession = onRequest(async (req, res) => {
  if (!cors(req, res)) return sendError(res, 403, "Origin is not allowed.");
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed.");

  try {
    const user = await requireFirebaseUser(req);
    const { deviceId } = req.body || {};
    if (!validateDeviceId(deviceId)) return sendError(res, 400, "Некорректный идентификатор устройства.");
    const [profile, device] = await Promise.all([
      db.doc(`users/${user.uid}`).get(),
      db.doc(`users/${user.uid}/trustedDevices/${deviceId}`).get(),
    ]);
    if (!profile.data()?.phoneVerified || !device.exists || device.data()?.status !== "active") {
      return sendError(res, 403, "Это устройство не зарегистрировано. Сначала подтвердите номер телефона.");
    }
    await device.ref.update({ lastSeenAt: FieldValue.serverTimestamp() });
    const customToken = await auth.createCustomToken(user.uid, { frossDeviceId: deviceId });
    return res.status(200).json({ ok: true, customToken });
  } catch (error) {
    console.error("FROSS trusted device session failed:", error);
    return sendError(res, error.status || 500, error.status ? error.message : "Не удалось открыть защищённую сессию.");
  }
});

export const createBrowserLoginRequest = onRequest(async (req, res) => {
  if (!cors(req, res)) return sendError(res, 403, "Origin is not allowed.");
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed.");

  try {
    const user = await requireFirebaseUser(req);
    const config = await db.doc("system/securityConfig").get();
    if (config.data()?.requireBrowserApproval !== true) {
      return res.status(200).json({ ok: true, mode: "disabled" });
    }

    const [profile, devices] = await Promise.all([
      db.doc(`users/${user.uid}`).get(),
      db.collection(`users/${user.uid}/trustedDevices`).where("status", "==", "active").limit(1).get(),
    ]);
    if (!profile.data()?.phoneVerified) {
      return sendError(res, 412, "Сначала подтвердите номер телефона в Android-приложении FROSS.");
    }
    if (devices.empty) return sendError(res, 412, "Сначала зарегистрируйте доверенное Android-устройство в FROSS.");

    const requestId = randomUUID();
    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(now.toMillis() + FIVE_MINUTES);
    const browserLabel = String(req.body?.browserLabel || "Браузер").replace(/[<>]/g, "").slice(0, 80);
    await db.doc(`browserLoginRequests/${requestId}`).set({
      sessionId: requestId,
      uid: user.uid,
      status: "pending",
      browserLabel,
      createdAt: now,
      expiresAt,
    });
    await ensureSecurityBotMessage(user.uid, requestId, browserLabel, expiresAt);
    const customToken = await auth.createCustomToken(user.uid, { frossBrowserSession: requestId });
    return res.status(200).json({ ok: true, mode: "approval-required", requestId, customToken, expiresInSeconds: 300 });
  } catch (error) {
    console.error("FROSS browser login request failed:", error);
    return sendError(res, error.status || 500, error.status ? error.message : "Не удалось создать запрос на вход.");
  }
});

async function updateBrowserRequest(req, res, status) {
  if (!cors(req, res)) return sendError(res, 403, "Origin is not allowed.");
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed.");

  try {
    const user = await requireFirebaseUser(req);
    const deviceId = user.frossDeviceId;
    if (!validateDeviceId(deviceId)) return sendError(res, 403, "Подтвердите номер и войдите с доверенного устройства FROSS.");
    const deviceRef = db.doc(`users/${user.uid}/trustedDevices/${deviceId}`);
    const device = await deviceRef.get();
    if (!device.exists || device.data()?.status !== "active") return sendError(res, 403, "Это устройство больше не является доверенным.");

    const requestId = String(req.body?.requestId || "");
    if (!/^[a-f0-9-]{36}$/i.test(requestId)) return sendError(res, 400, "Некорректный запрос на вход.");
    const requestRef = db.doc(`browserLoginRequests/${requestId}`);
    const request = await requestRef.get();
    if (!request.exists || request.data()?.uid !== user.uid) return sendError(res, 404, "Запрос на вход не найден.");
    const data = request.data();
    if (data.status !== "pending") return sendError(res, 409, "Этот запрос уже обработан.");
    if (!data.expiresAt || data.expiresAt.toMillis() <= Date.now()) {
      await requestRef.update({ status: "expired", resolvedAt: Timestamp.now() });
      return sendError(res, 410, "Время подтверждения истекло.");
    }

    const resolvedAt = Timestamp.now();
    await requestRef.update({
      status,
      resolvedAt,
      approvedDeviceId: status === "approved" ? deviceId : null,
    });
    const messageRef = db.doc(`chats/security_${user.uid}/messages/${requestId}`);
    await messageRef.set({
      securityRequestStatus: status,
      text: status === "approved" ? "Вход в FROSS через браузер подтверждён." : "Запрос на вход отклонён.",
      resolvedAt,
    }, { merge: true });
    await deviceRef.update({ lastSeenAt: FieldValue.serverTimestamp() });
    return res.status(200).json({ ok: true, status });
  } catch (error) {
    console.error("FROSS browser request action failed:", error);
    return sendError(res, error.status || 500, error.status ? error.message : "Не удалось обработать запрос на вход.");
  }
}

export const approveBrowserLogin = onRequest((req, res) => updateBrowserRequest(req, res, "approved"));
export const rejectBrowserLogin = onRequest((req, res) => updateBrowserRequest(req, res, "denied"));

export const expireBrowserLoginRequests = onSchedule("every 5 minutes", async () => {
  const now = Timestamp.now();
  const expired = await db.collection("browserLoginRequests")
    .where("status", "==", "pending")
    .where("expiresAt", "<=", now)
    .limit(100)
    .get();
  const batch = db.batch();
  for (const item of expired.docs) {
    batch.update(item.ref, { status: "expired", resolvedAt: now });
    batch.set(db.doc(`chats/security_${item.data().uid}/messages/${item.id}`), {
      securityRequestStatus: "expired",
      text: "Время подтверждения входа истекло.",
      resolvedAt: now,
    }, { merge: true });
  }
  if (!expired.empty) await batch.commit();
});
