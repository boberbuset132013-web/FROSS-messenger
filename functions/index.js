import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
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


// Account deletion is performed server-side so the public tombstone and chat notices
// are written before the Auth identity is removed. DM chats are purged after 24 hours.
export const requestAccountDeletion = onRequest(async (req, res) => {
  const origin=req.get("Origin")||"*";
  res.set("Access-Control-Allow-Origin",origin);
  res.set("Vary","Origin");
  res.set("Access-Control-Allow-Methods","POST, OPTIONS");
  res.set("Access-Control-Allow-Headers","Authorization, Content-Type");
  res.set("Cache-Control","no-store");
  if(req.method==="OPTIONS")return res.status(204).send("");
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed."});
  try{
    const match=(req.get("Authorization")||"").match(/^Bearer\\s+(.+)$/i);
    if(!match)return res.status(401).json({error:"Firebase ID token is required."});
    const decoded=await getAuth().verifyIdToken(match[1],true);
    if(!decoded.auth_time||Date.now()/1000-decoded.auth_time>300)return res.status(401).json({error:"Please sign in again before deleting your account."});
    const uid=decoded.uid,auth=getAuth(),firestore=getFirestore();
    const user=await auth.getUser(uid);
    const profileRef=firestore.doc("publicUsers/"+uid);
    const profileSnap=await profileRef.get();
    if(!profileSnap.exists)return res.status(404).json({error:"Profile not found."});
    const profile=profileSnap.data();
    if(profile.deleted===true)return res.status(409).json({error:"Account deletion has already been requested."});
    const now=Timestamp.now(),deleteAfter=Timestamp.fromMillis(now.toMillis()+24*60*60*1000);
    const chats=await firestore.collection("chats").where("memberUids","array-contains",uid).get();
    const batch=firestore.batch();
    batch.set(profileRef,{
      deleted:true,deletedAt:now,displayName:"Аккаунт удалён",username:"deleted_"+uid.slice(0,8),
      usernameLower:"deleted_"+uid.slice(0,8),bio:"",avatarUrl:"",lastSeenAt:now
    },{merge:true});
    const username=String(profile.usernameLower||profile.username||"").toLowerCase();
    if(username)batch.delete(firestore.doc("usernameIndex/"+username));
    batch.delete(firestore.doc("users/"+uid));
    for(const chatDoc of chats.docs){
      const chat=chatDoc.data(),messageRef=chatDoc.ref.collection("messages").doc();
      const isDm=chat.type==="dm";
      const text=isDm
        ?"Аккаунт удалён. Этот личный чат будет автоматически удалён через 24 часа."
        :"Аккаунт удалён.";
      batch.set(messageRef,{
        senderUid:uid,username:"deleted",displayName:"Аккаунт удалён",text,
        accountDeletedNotice:true,createdAt:FieldValue.serverTimestamp()
      });
      const update={lastMessage:text,lastMessageAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),memberProfiles:(chat.memberProfiles||[]).map(member=>member.uid===uid?{...member,deleted:true,displayName:"Аккаунт удалён",username:"deleted",avatarUrl:"",profileColor:profile.profileColor||"#777777"}:member)};
      if(isDm){update.deletionScheduledAt=now;update.deleteAfter=deleteAfter;update.deletionNotice="Этот чат будет удалён через 24 часа."}
      batch.update(chatDoc.ref,update);
    }
    await batch.commit();
    if(profile.avatarUrl){
      try{await getStorage().bucket("fross-ca5d6.firebasestorage.app").file("avatars/"+uid+"/avatar.jpg").delete({ignoreNotFound:true})}catch(error){console.warn("Avatar cleanup:",error?.message)}
    }
    await auth.deleteUser(uid);
    return res.status(200).json({ok:true,personalChatsScheduled:chats.docs.filter(d=>d.data().type==="dm").length});
  }catch(error){
    console.error("Account deletion failed:",error);
    return res.status(500).json({error:error?.message||"Account deletion failed."});
  }
});

export const purgeDeletedChats = onSchedule("every 15 minutes", async () => {
  const firestore=getFirestore(),now=Timestamp.now();
  const due=await firestore.collection("chats").where("deleteAfter","<=",now).limit(100).get();
  for(const chat of due.docs){
    try{await firestore.recursiveDelete(chat.ref)}
    catch(error){console.error("Could not purge deleted chat "+chat.id,error)}
  }
});

export {
  verifyPhoneWithPnv,
  createTrustedDeviceSession,
  createBrowserLoginRequest,
  refreshBrowserLoginSession,
  approveBrowserLogin,
  rejectBrowserLogin,
  registerTrustedDevicePushToken,
  expireBrowserLoginRequests,
} from "./phone-security.js";
