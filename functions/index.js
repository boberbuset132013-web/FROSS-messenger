import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";

initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 1, timeoutSeconds: 540, memory: "512MiB" });

export const testDeleteAllAccounts = onRequest(async (req, res) => {
  const origin = req.get("Origin") || "*";
  res.set("Access-Control-Allow-Origin", origin);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  // The endpoint is dormant unless the project owner explicitly enables it.
  if (process.env.ENABLE_DANGEROUS_TEST_RESET !== "true") {
    return res.status(404).json({ error: "Test account reset is disabled in this Firebase project." });
  }

  try {
    const authorization = req.get("Authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ error: "Firebase ID token is required." });

    const decoded = await getAuth().verifyIdToken(match[1], true);
    if (decoded.frossAdmin !== true) {
      return res.status(403).json({ error: "Administrator permission is required." });
    }
    if (req.body?.confirmation !== "DELETE ALL ACCOUNTS") {
      return res.status(400).json({ error: "The confirmation phrase does not match." });
    }

    const firestore = getFirestore();
    const bucket = getStorage().bucket("fross-ca5d6.firebasestorage.app");
    const collections = ["users", "publicUsers", "usernameIndex", "chats", "calls"];
    for (const name of collections) {
      await firestore.recursiveDelete(firestore.collection(name));
    }
    await firestore.recursiveDelete(firestore.doc("systemMigrations/d1-to-firebase-v1"));
    await bucket.deleteFiles({ force: true });

    const auth = getAuth();
    const allUids = [];
    let pageToken;
    do {
      const page = await auth.listUsers(1000, pageToken);
      allUids.push(...page.users.map(user => user.uid));
      pageToken = page.pageToken;
    } while (pageToken);

    let deletedUsers = 0;
    const failures = [];
    for (let i = 0; i < allUids.length; i += 1000) {
      const result = await auth.deleteUsers(allUids.slice(i, i + 1000));
      deletedUsers += result.successCount;
      if (result.failureCount) {
        failures.push(...(result.errors || []).map(item => ({
          index: item.index,
          error: item.error?.message || "Unknown deletion error"
        })));
      }
    }

    if (failures.length) {
      return res.status(207).json({
        error: "Some Auth accounts could not be deleted.",
        deletedUsers,
        failedUsers: failures.length
      });
    }
    return res.status(200).json({
      ok: true,
      deletedUsers,
      deletedCollections: collections.length + 1,
      storageBucketCleared: true
    });
  } catch (error) {
    console.error("Test project reset failed:", error);
    return res.status(500).json({ error: error?.message || "Test reset failed." });
  }
});
