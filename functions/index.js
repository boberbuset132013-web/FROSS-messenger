import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

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


const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");
const TELEGRAM_WEBHOOK_SECRET = defineSecret("TELEGRAM_WEBHOOK_SECRET");
const MAX_BOT_TOKEN = defineSecret("MAX_BOT_TOKEN");
const MAX_WEBHOOK_SECRET = defineSecret("MAX_WEBHOOK_SECRET");
const BOT_SECRETS = [TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, MAX_BOT_TOKEN, MAX_WEBHOOK_SECRET];
const PROJECT_ID = "fross-ca5d6";
const TG_WEBHOOK_URL = "https://us-central1-fross-ca5d6.cloudfunctions.net/telegramPhoneWebhook";
const MAX_WEBHOOK_URL = "https://us-central1-fross-ca5d6.cloudfunctions.net/maxPhoneWebhook";
const PHONE_CODE_TTL_MS = 10 * 60 * 1000;

function setCors(req,res){
  const origin=req.get("Origin");
  if(origin==="https://fross-messenger.boberbuset132013.workers.dev"||origin?.endsWith(".workers.dev"))res.set("Access-Control-Allow-Origin",origin);
  else res.set("Access-Control-Allow-Origin","https://fross-messenger.boberbuset132013.workers.dev");
  res.set("Vary","Origin");
  res.set("Access-Control-Allow-Methods","POST, OPTIONS");
  res.set("Access-Control-Allow-Headers","Authorization, Content-Type");
  res.set("Cache-Control","no-store");
}
async function verifiedUid(req){
  const match=(req.get("Authorization")||"").match(/^Bearer\s+(.+)$/i);
  if(!match)throw new Error("Нужен вход в FROSS.");
  const decoded=await getAuth().verifyIdToken(match[1],true);
  if(decoded.email_verified!==true&&decoded.legacyAccount!==true)throw new Error("Сначала подтверди email аккаунта FROSS.");
  return decoded.uid;
}
function normalizePhone(value){
  const phone=String(value||"").replace(/[\s().-]/g,"");
  if(!/^\+[1-9]\d{7,14}$/.test(phone))throw new Error("Введите номер в международном формате, например +447700900123.");
  return phone;
}
function safeSecretEqual(left,right){
  const a=Buffer.from(String(left||"")),b=Buffer.from(String(right||""));
  return a.length===b.length&&timingSafeEqual(a,b);
}
function challengeExpired(data){
  return !data?.expiresAt||data.expiresAt.toMillis()<=Date.now();
}
async function telegramApi(token,method,body){
  const response=await fetch("https://api.telegram.org/bot"+token+"/"+method,{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||result.ok!==true)throw new Error("Telegram Bot API: "+(result.description||response.status));
  return result.result;
}
async function maxApi(token,path,method="GET",body){
  const response=await fetch("https://platform-api2.max.ru"+path,{
    method,headers:{"Authorization":token,"Content-Type":"application/json"},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error("MAX Bot API: "+(result.message||result.code||response.status));
  return result;
}
async function deliverPhoneCode(challengeRef,challenge,channelChatId,botToken){
  if(challenge.status==="code_sent"||!challenge.code)return;
  if(challengeExpired(challenge))throw new Error("Ссылка для подтверждения истекла.");
  if(challenge.channel==="telegram"){
    await telegramApi(botToken,"sendMessage",{
      chat_id:channelChatId,text:"Код подтверждения FROSS: "+challenge.code+"\nНикому не пересылайте этот код."
    });
  }else{
    await maxApi(botToken,"/messages?chat_id="+encodeURIComponent(channelChatId),"POST",{
      text:"Код подтверждения FROSS: "+challenge.code+"\nНикому не пересылайте этот код."
    });
  }
  await challengeRef.update({status:"code_sent",botChatId:String(channelChatId),code:FieldValue.delete(),codeSentAt:Timestamp.now()});
}
async function ensureTelegramWebhook(token,secret){
  const info=await telegramApi(token,"getMe",{});
  if(!info?.username)throw new Error("У Telegram-бота не найден username.");
  await telegramApi(token,"setWebhook",{url:TG_WEBHOOK_URL,secret_token:secret,allowed_updates:["message"],drop_pending_updates:false});
  return info.username;
}
async function ensureMaxWebhook(token,secret){
  const bot=await maxApi(token,"/me");
  if(!bot?.username)throw new Error("У MAX-бота не задан публичный username.");
  const existing=await maxApi(token,"/subscriptions").catch(()=>({subscriptions:[]}));
  const subscriptions=existing.subscriptions||existing.items||[];
  if(!subscriptions.some(item=>item.url===MAX_WEBHOOK_URL&&item.update_types?.includes("message_created")&&item.update_types?.includes("bot_started"))){
    await maxApi(token,"/subscriptions","POST",{url:MAX_WEBHOOK_URL,update_types:["message_created","bot_started"],secret});
  }
  return bot.username;
}
async function sendTelegramContactRequest(token,chatId){
  await telegramApi(token,"sendMessage",{
    chat_id:chatId,text:"Чтобы подтвердить номер для FROSS, нажми кнопку ниже и отправь собственный контакт.",
    reply_markup:{keyboard:[[{text:"Поделиться номером телефона",request_contact:true}]],resize_keyboard:true,one_time_keyboard:true}
  });
}
async function sendMaxContactRequest(token,chatId){
  await maxApi(token,"/messages?chat_id="+encodeURIComponent(chatId),"POST",{
    text:"Чтобы подтвердить номер для FROSS, нажми кнопку ниже и поделись контактом, привязанным к твоему профилю MAX.",
    attachments:[{type:"inline_keyboard",payload:{buttons:[[{type:"request_contact",text:"Поделиться номером"}]]}}]
  });
}
async function activateChallenge(challengeId,channel,chatId,userId){
  if(!/^[A-Za-z0-9_-]{20,40}$/.test(String(challengeId||"")))return null;
  const firestore=getFirestore(),ref=firestore.doc("phoneChallenges/"+challengeId),snap=await ref.get();
  if(!snap.exists)return null;
  const data=snap.data();
  if(data.channel!==channel||data.status!=="waiting_contact"||challengeExpired(data))return null;
  if(data.botUserId&&String(data.botUserId)!==String(userId))return null;
  await ref.update({botChatId:String(chatId),botUserId:String(userId||""),botStartedAt:Timestamp.now()});
  await firestore.doc("phoneBotSessions/"+channel+"_"+String(chatId)).set({
    challengeId,uid:data.uid,expiresAt:data.expiresAt,updatedAt:Timestamp.now()
  });
  return {ref,data:{...data,botChatId:String(chatId)}};
}
function parseVcfPhone(vcf){
  const match=String(vcf||"").match(/^TEL(?:;[^:]*)?:(.+)$/im);
  if(!match)return "";
  return match[1].replace(/[\s().-]/g,"").startsWith("+")
    ?match[1].replace(/[\s().-]/g,"")
    :"+"+match[1].replace(/[^0-9]/g,"");
}

export const startPhoneVerification = onRequest({secrets:BOT_SECRETS},async(req,res)=>{
  setCors(req,res);
  if(req.method==="OPTIONS")return res.status(204).send("");
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed."});
  try{
    const uid=await verifiedUid(req);
    const phone=normalizePhone(req.body?.phone),channel=String(req.body?.channel||"");
    if(!["telegram","max"].includes(channel))return res.status(400).json({error:"Выберите Telegram или MAX."});
    const token=channel==="telegram"?TELEGRAM_BOT_TOKEN.value():MAX_BOT_TOKEN.value();
    const webhookSecret=channel==="telegram"?TELEGRAM_WEBHOOK_SECRET.value():MAX_WEBHOOK_SECRET.value();
    if(!token||!webhookSecret)return res.status(503).json({error:"Бот ещё не подключён. Администратору нужно добавить токен и секрет webhook в Firebase."});
    const botUsername=channel==="telegram"
      ?await ensureTelegramWebhook(token,webhookSecret)
      :await ensureMaxWebhook(token,webhookSecret);
    const challengeId=randomBytes(18).toString("base64url");
    const code=String(randomInt(100000,1000000));
    const now=Date.now();
    const expiresAt=Timestamp.fromMillis(now+PHONE_CODE_TTL_MS);
    await getFirestore().doc("phoneChallenges/"+challengeId).create({
      uid,phone,channel,code,codeHash:createHash("sha256").update(challengeId+":"+code).digest("hex"),
      status:"waiting_contact",attempts:0,createdAt:Timestamp.now(),expiresAt
    });
    const botUrl=channel==="telegram"
      ?"https://t.me/"+botUsername+"?start="+challengeId
      :"https://max.ru/"+botUsername+"?start="+challengeId;
    return res.status(200).json({ok:true,challengeId,botUrl,expiresInSeconds:600});
  }catch(error){
    console.error("Start phone verification:",error?.message||error);
    const msg=String(error?.message||"Не удалось начать подтверждение номера.");
    return res.status(400).json({error:msg});
  }
});

export const confirmPhoneVerification = onRequest(async(req,res)=>{
  setCors(req,res);
  if(req.method==="OPTIONS")return res.status(204).send("");
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed."});
  try{
    const uid=await verifiedUid(req);
    const challengeId=String(req.body?.challengeId||""),code=String(req.body?.code||"").trim();
    if(!/^[A-Za-z0-9_-]{20,40}$/.test(challengeId)||!/^\d{6}$/.test(code))return res.status(400).json({error:"Проверь ссылку и шестизначный код."});
    const firestore=getFirestore(),challengeRef=firestore.doc("phoneChallenges/"+challengeId),snap=await challengeRef.get();
    if(!snap.exists)return res.status(404).json({error:"Запрос подтверждения не найден. Запроси новый код."});
    const challenge=snap.data();
    if(challenge.uid!==uid)return res.status(403).json({error:"Этот запрос создан для другого аккаунта FROSS."});
    if(challengeExpired(challenge))return res.status(410).json({error:"Код истёк. Запроси новый."});
    if(challenge.status!=="code_sent"||!challenge.codeHash)return res.status(409).json({error:"Сначала открой бота и поделись своим контактом, чтобы получить код."});
    if((challenge.attempts||0)>=5)return res.status(429).json({error:"Слишком много попыток. Запроси новый код."});
    const codeHash=createHash("sha256").update(challengeId+":"+code).digest("hex");
    if(!safeSecretEqual(codeHash,challenge.codeHash)){
      await challengeRef.update({attempts:FieldValue.increment(1)});
      return res.status(400).json({error:"Неверный код. Проверь сообщение от бота."});
    }
    const privateRef=firestore.doc("users/"+uid),publicRef=firestore.doc("publicUsers/"+uid);
    const [privateSnap,publicSnap]=await Promise.all([privateRef.get(),publicRef.get()]);
    const phoneData={phoneNumber:challenge.phone,phoneVerified:true,phoneVerifiedAt:Timestamp.now(),phoneVerificationChannel:challenge.channel,updatedAt:Timestamp.now()};
    if(privateSnap.exists&&privateSnap.data().phoneVisible===true)phoneData.phoneVisible=true;
    await privateRef.set(phoneData,{merge:true});
    if(publicSnap.exists()&&privateSnap.data()?.phoneVisible===true)await publicRef.set({phonePublic:challenge.phone},{merge:true});
    await challengeRef.delete();
    if(challenge.botChatId)await firestore.doc("phoneBotSessions/"+challenge.channel+"_"+challenge.botChatId).delete().catch(()=>{});
    return res.status(200).json({ok:true,phoneVerified:true,channel:challenge.channel});
  }catch(error){
    console.error("Confirm phone verification:",error?.message||error);
    return res.status(400).json({error:error?.message||"Не удалось подтвердить номер."});
  }
});

export const telegramPhoneWebhook = onRequest({secrets:[TELEGRAM_BOT_TOKEN,TELEGRAM_WEBHOOK_SECRET]},async(req,res)=>{
  if(req.method!=="POST")return res.status(405).send("");
  if(!safeSecretEqual(req.get("X-Telegram-Bot-Api-Secret-Token"),TELEGRAM_WEBHOOK_SECRET.value()))return res.status(401).send("");
  try{
    const update=req.body||{},message=update.message,token=TELEGRAM_BOT_TOKEN.value();
    if(!message?.chat?.id)return res.status(200).send("ok");
    const chatId=String(message.chat.id),sessionRef=getFirestore().doc("phoneBotSessions/telegram_"+chatId);
    const text=String(message.text||"");
    const start=text.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{20,40})/);
    if(start){
      const active=await activateChallenge(start[1],"telegram",chatId,message.from?.id);
      if(!active)return await telegramApi(token,"sendMessage",{chat_id:chatId,text:"Ссылка FROSS истекла. Вернись в настройки мессенджера и запроси новый код."}).then(()=>res.status(200).send("ok"));
      await sendTelegramContactRequest(token,chatId);
      return res.status(200).send("ok");
    }
    if(message.contact){
      const sessionSnap=await sessionRef.get();if(!sessionSnap.exists())return res.status(200).send("ok");
      const session=sessionSnap.data(),challengeRef=getFirestore().doc("phoneChallenges/"+session.challengeId),challengeSnap=await challengeRef.get();
      if(!challengeSnap.exists())return res.status(200).send("ok");
      const challenge=challengeSnap.data(),contact=message.contact;
      const actualPhone=String(contact.phone_number||"").replace(/\D/g,"");
      const expectedPhone=String(challenge.phone||"").replace(/\D/g,"");
      if(String(contact.user_id||"")!==String(message.from?.id||"")||actualPhone!==expectedPhone){
        await telegramApi(token,"sendMessage",{chat_id:chatId,text:"Нужен именно твой собственный контакт с номером, который указан в FROSS.",reply_markup:{remove_keyboard:true}});
        return res.status(200).send("ok");
      }
      await deliverPhoneCode(challengeRef,challenge,chatId,token);
      await telegramApi(token,"sendMessage",{chat_id:chatId,text:"Контакт проверен. Код отправлен. Вернись в FROSS и введи шесть цифр.",reply_markup:{remove_keyboard:true}});
    }
    return res.status(200).send("ok");
  }catch(error){
    console.error("Telegram phone webhook:",error?.message||error);
    return res.status(200).send("ok");
  }
});

export const maxPhoneWebhook = onRequest({secrets:[MAX_BOT_TOKEN,MAX_WEBHOOK_SECRET]},async(req,res)=>{
  if(req.method!=="POST")return res.status(405).send("");
  if(!safeSecretEqual(req.get("X-Max-Bot-Api-Secret"),MAX_WEBHOOK_SECRET.value()))return res.status(401).send("");
  try{
    const update=req.body||{},token=MAX_BOT_TOKEN.value(),type=update.update_type;
    if(type==="bot_started"){
      const chatId=String(update.chat_id||"");
      const challengeId=String(update.payload||"");
      const active=await activateChallenge(challengeId,"max",chatId,update.user?.user_id);
      if(active)await sendMaxContactRequest(token,chatId);
      else if(chatId)await maxApi(token,"/messages?chat_id="+encodeURIComponent(chatId),"POST",{text:"Ссылка для подтверждения FROSS истекла. Запроси новый код в приложении."});
    }else if(type==="message_created"){
      const message=update.message||{},chatId=String(message.recipient?.chat_id||update.chat_id||"");
      const sessionSnap=await getFirestore().doc("phoneBotSessions/max_"+chatId).get();
      if(!sessionSnap.exists)return res.status(200).send("ok");
      const session=sessionSnap.data(),challengeRef=getFirestore().doc("phoneChallenges/"+session.challengeId),challengeSnap=await challengeRef.get();
      if(!challengeSnap.exists)return res.status(200).send("ok");
      const challenge=challengeSnap.data(),contact=(message.body?.attachments||[]).find(item=>item.type==="contact");
      const payload=contact?.payload||{},vcfInfo=String(payload.vcf_info||""),hash=String(payload.hash||"");
      if(!vcfInfo||!/^[a-f0-9]{64}$/i.test(hash))return res.status(200).send("ok");
      const expectedHash=createHmac("sha256",token).update(vcfInfo).digest("hex");
      if(!safeSecretEqual(expectedHash.toLowerCase(),hash.toLowerCase()))return res.status(200).send("ok");
      const senderId=String(message.sender?.user_id||""),ownerId=String(payload.max_info?.user_id||"");
      const actualPhone=parseVcfPhone(vcfInfo).replace(/\D/g,""),expectedPhone=String(challenge.phone||"").replace(/\D/g,"");
      if(!senderId||senderId!==ownerId||actualPhone!==expectedPhone){
        await maxApi(token,"/messages?chat_id="+encodeURIComponent(chatId),"POST",{text:"MAX не подтвердил этот номер для твоего профиля. Проверь, что делишься собственным контактом."});
        return res.status(200).send("ok");
      }
      await deliverPhoneCode(challengeRef,challenge,chatId,token);
      await maxApi(token,"/messages?chat_id="+encodeURIComponent(chatId),"POST",{text:"Контакт проверен. Код отправлен. Вернись в FROSS и введи шесть цифр."});
    }
  }catch(error){console.error("MAX phone webhook:",error?.message||error)}
  return res.status(200).send("ok");
});

export const deleteGroupForEveryone = onRequest(async(req,res)=>{
  setCors(req,res);
  if(req.method==="OPTIONS")return res.status(204).send("");
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed."});
  try{
    const uid=await verifiedUid(req),chatId=String(req.body?.chatId||"");
    if(!/^[A-Za-z0-9_-]{1,120}$/.test(chatId))return res.status(400).json({error:"Некорректный ID группы."});
    const firestore=getFirestore(),chatRef=firestore.doc("chats/"+chatId),snap=await chatRef.get();
    if(!snap.exists)return res.status(404).json({error:"Группа уже удалена."});
    const chat=snap.data();
    if(chat.type!=="group"||chat.ownerUid!==uid)return res.status(403).json({error:"Удалить группу у всех может только её создатель."});
    await firestore.recursiveDelete(chatRef);
    return res.status(200).json({ok:true,deleted:true});
  }catch(error){
    console.error("Delete group for everyone:",error?.message||error);
    return res.status(400).json({error:error?.message||"Не удалось удалить группу."});
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
