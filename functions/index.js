import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

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


const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");
const TELEGRAM_WEBHOOK_SECRET = defineSecret("TELEGRAM_WEBHOOK_SECRET");
const BOT_SECRETS = [TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET];
const TG_WEBHOOK_URL = "https://us-central1-fross-ca5d6.cloudfunctions.net/telegramPhoneWebhook";
const PHONE_CODE_TTL_MS = 10 * 60 * 1000;
const BOT_OWNER_USERNAME = "denhic";

function setCors(req,res){
  const origin=req.get("Origin");
  if(origin==="https://fross-messenger.boberbuset132013.workers.dev"||origin?.endsWith(".workers.dev")||origin==="https://localhost"||origin==="capacitor://localhost")res.set("Access-Control-Allow-Origin",origin);
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
function challengeExpired(data){return !data?.expiresAt||data.expiresAt.toMillis()<=Date.now()}
async function telegramApi(token,method,body){
  const response=await fetch("https://api.telegram.org/bot"+token+"/"+method,{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||result.ok!==true)throw new Error("Telegram Bot API: "+(result.description||response.status));
  return result.result;
}
async function ensureTelegramWebhook(token,secret){
  const info=await telegramApi(token,"getMe",{});
  if(!info?.username)throw new Error("У Telegram-бота не найден username.");
  await telegramApi(token,"setWebhook",{url:TG_WEBHOOK_URL,secret_token:secret,allowed_updates:["message","callback_query","managed_bot"],drop_pending_updates:false});
  return info.username;
}
async function sendTelegramContactRequest(token,chatId){
  await telegramApi(token,"sendMessage",{
    chat_id:chatId,text:"Чтобы подтвердить номер для FROSS, нажми кнопку ниже и отправь собственный контакт.",
    reply_markup:{keyboard:[[{text:"Поделиться номером телефона",request_contact:true}]],resize_keyboard:true,one_time_keyboard:true}
  });
}
async function activateChallenge(challengeId,chatId,user){
  if(!/^[A-Za-z0-9_-]{20,40}$/.test(String(challengeId||"")))return null;
  const firestore=getFirestore(),ref=firestore.doc("phoneChallenges/"+challengeId),snap=await ref.get();
  if(!snap.exists)return null;
  const data=snap.data();
  if(data.channel!=="telegram"||data.status!=="waiting_contact"||challengeExpired(data))return null;
  if(data.telegramUserId&&String(data.telegramUserId)!==String(user?.id||""))return null;
  await ref.update({
    botChatId:String(chatId),botUserId:String(user?.id||""),
    telegramUserId:String(user?.id||""),telegramUsername:String(user?.username||"").toLowerCase(),botStartedAt:Timestamp.now()
  });
  await firestore.doc("phoneBotSessions/telegram_"+String(chatId)).set({
    challengeId,uid:data.uid,expiresAt:data.expiresAt,updatedAt:Timestamp.now()
  });
  return {ref,data:{...data,botChatId:String(chatId)}};
}
async function deliverPhoneCode(challengeRef,challenge,chatId,token){
  if(challenge.status==="code_sent"||!challenge.code)return;
  if(challengeExpired(challenge))throw new Error("Ссылка для подтверждения истекла.");
  await telegramApi(token,"sendMessage",{
    chat_id:chatId,
    text:"Код подтверждения FROSS: "+challenge.code+"\nНикому не пересылайте этот код."
  });
  await challengeRef.update({status:"code_sent",botChatId:String(chatId),code:FieldValue.delete(),codeSentAt:Timestamp.now()});
}
async function linkedTelegramUser(firestore,uid){
  const snap=await firestore.doc("users/"+uid).get(),data=snap.data()||{};
  if(!data.telegramChatId||!data.telegramUserId)throw new Error("Сначала привяжи Telegram, подтвердив свой номер через бота FROSS.");
  return data;
}
async function createSecurityRequest(uid,type,telegram,extra={}){
  const firestore=getFirestore(),id=randomBytes(12).toString("base64url"),ref=firestore.doc("securityRequests/"+id);
  const expiresAt=Timestamp.fromMillis(Date.now()+15*60*1000);
  await ref.create({
    uid,type,status:"pending_confirmation",
    telegramChatId:String(telegram.telegramChatId),telegramUserId:String(telegram.telegramUserId),
    telegramUsername:telegram.telegramUsername||"",createdAt:Timestamp.now(),expiresAt,...extra
  });
  return {id,ref,expiresAt};
}
async function answerCallback(token,callbackId,text){
  if(callbackId)await telegramApi(token,"answerCallbackQuery",{callback_query_id:callbackId,text,show_alert:false}).catch(()=>{});
}
async function handleSecurityCallback(callback,token){
  const data=String(callback.data||""),fromId=String(callback.from?.id||""),chatId=String(callback.message?.chat?.id||"");
  const match=data.match(/^(del_yes|del_no|del_cancel)_([A-Za-z0-9_-]{12,32})$/);
  if(!match){await answerCallback(token,callback.id,"Неизвестное действие.");return}
  const [,action,id]=match,firestore=getFirestore(),requestRef=firestore.doc("securityRequests/"+id),snap=await requestRef.get();
  if(!snap.exists){await answerCallback(token,callback.id,"Запрос уже не существует.");return}
  const request=snap.data();
  if(request.type!=="account_delete"){
    await answerCallback(token,callback.id,"Это действие не соответствует исходному запросу.");return;
  }
  if(String(request.telegramUserId)!==fromId||String(request.telegramChatId)!==chatId){
    await answerCallback(token,callback.id,"Эта кнопка предназначена другому аккаунту.");return;
  }
  if(action==="del_cancel"){
    const deletionRef=firestore.doc("accountDeletionRequests/"+request.uid);
    const deletionSnap=await deletionRef.get();
    if(!deletionSnap.exists||deletionSnap.data().status!=="scheduled"||deletionSnap.data().deleteAfter.toMillis()<=Date.now()){
      await answerCallback(token,callback.id,"Отменить уже нельзя: срок истёк или запрос не найден.");return;
    }
    await deletionRef.update({status:"cancelled",cancelledAt:Timestamp.now(),cancelledByTelegramId:fromId});
    await requestRef.update({status:"cancelled",cancelledAt:Timestamp.now()});
    await answerCallback(token,callback.id,"Удаление аккаунта отменено.");
    await telegramApi(token,"sendMessage",{chat_id:chatId,text:"✅ Удаление аккаунта FROSS отменено. Аккаунт сохранён."});
    return;
  }
  if(request.status!=="pending_confirmation"||challengeExpired(request)){
    await answerCallback(token,callback.id,"Запрос уже истёк или обработан.");return;
  }
  if(action==="del_no"){
    await requestRef.update({status:"rejected",resolvedAt:Timestamp.now()});
    if(action==="del_no")await firestore.doc("accountDeletionRequests/"+request.uid).set({uid:request.uid,status:"cancelled",cancelledAt:Timestamp.now()},{merge:true});
    await answerCallback(token,callback.id,"Запрос отклонён.");
    await telegramApi(token,"sendMessage",{chat_id:chatId,text:"Запрос FROSS отклонён. Никаких изменений не внесено."});
    return;
  }
  if(action==="del_yes"){
    const deleteAfter=Timestamp.fromMillis(Date.now()+24*60*60*1000);
    await firestore.doc("accountDeletionRequests/"+request.uid).set({
      uid:request.uid,status:"scheduled",requestedAt:Timestamp.now(),deleteAfter,
      telegramChatId:request.telegramChatId,telegramUserId:request.telegramUserId,securityRequestId:id
    });
    await requestRef.update({status:"scheduled",approvedAt:Timestamp.now(),deleteAfter});
    await answerCallback(token,callback.id,"Удаление запланировано на 24 часа.");
    await telegramApi(token,"sendMessage",{
      chat_id:chatId,
      text:"🕒 Удаление аккаунта FROSS запланировано через 24 часа. До этого момента ты можешь отменить его кнопкой ниже.",
      reply_markup:{inline_keyboard:[[{text:"Отменить удаление аккаунта",callback_data:"del_cancel_"+id}]]}
    });
  }
}
async function claimBotOwnerIfNeeded(firestore,uid,telegramUserId,telegramUsername){
  const profileSnap=await firestore.doc("publicUsers/"+uid).get();
  const profile=profileSnap.data()||{};
  const frossUsername=String(profile.usernameLower||profile.username||"").toLowerCase();
  if(frossUsername!==BOT_OWNER_USERNAME||!telegramUserId)return;
  const ref=firestore.doc("system/telegramBotOwner");
  await firestore.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    if(!snap.exists)tx.create(ref,{
      uid,telegramUserId:String(telegramUserId),telegramUsername:String(telegramUsername||"").toLowerCase(),
      frossUsername:BOT_OWNER_USERNAME,createdAt:Timestamp.now()
    });
  });
}
async function isTelegramBotOwner(firestore,user){
  const snap=await firestore.doc("system/telegramBotOwner").get();
  return snap.exists&&snap.data().frossUsername===BOT_OWNER_USERNAME
    &&String(snap.data().telegramUserId)===String(user?.id||"");
}
async function setBotProfilePhoto(token,fileId){
  const file=await telegramApi(token,"getFile",{file_id:fileId});
  if(!file?.file_path)throw new Error("Telegram не вернул файл фотографии.");
  const response=await fetch("https://api.telegram.org/file/bot"+token+"/"+file.file_path);
  if(!response.ok)throw new Error("Не удалось скачать фотографию из Telegram.");
  const bytes=await response.arrayBuffer(),form=new FormData();
  form.append("photo",JSON.stringify({type:"static",photo:"attach://profile_photo"}));
  form.append("profile_photo",new Blob([bytes],{type:"image/jpeg"}),"fross-bot-profile.jpg");
  const result=await fetch("https://api.telegram.org/bot"+token+"/setMyProfilePhoto",{method:"POST",body:form});
  const payload=await result.json().catch(()=>({}));
  if(!result.ok||payload.ok!==true)throw new Error(payload.description||"Не удалось обновить фото бота.");
}
async function handleOwnerBotMessage(message,token,firestore){
  const from=message.from||{},chatId=message.chat?.id;
  if(String(message.chat?.type)!=="private"||!await isTelegramBotOwner(firestore,from))return false;
  const text=String(message.text||message.caption||"").trim();
  if(text==="/owner"||text==="/help"||text==="/start"){
    await telegramApi(token,"sendMessage",{chat_id:chatId,text:"Панель владельца FROSS Security Bot (@denhic)\n/setname новое имя\n/setdescription новое описание\n/setabout краткое описание\n/setphoto — команда в подписи к фотографии\n\nТолько аккаунт FROSS с username denhic может менять профиль бота."});
    return true;
  }
  if(text.startsWith("/setname ")){
    const name=text.slice(9).trim();if(!name||name.length>64)throw new Error("Имя должно содержать от 1 до 64 символов.");
    await telegramApi(token,"setMyName",{name});
    await telegramApi(token,"sendMessage",{chat_id:chatId,text:"Имя бота обновлено."});return true;
  }
  if(text.startsWith("/setdescription ")){
    const description=text.slice(16).trim();if(description.length>512)throw new Error("Описание должно быть не длиннее 512 символов.");
    await telegramApi(token,"setMyDescription",{description});
    await telegramApi(token,"sendMessage",{chat_id:chatId,text:"Описание бота обновлено."});return true;
  }
  if(text.startsWith("/setabout ")){
    const shortDescription=text.slice(10).trim();if(shortDescription.length>120)throw new Error("Краткое описание должно быть не длиннее 120 символов.");
    await telegramApi(token,"setMyShortDescription",{short_description:shortDescription});
    await telegramApi(token,"sendMessage",{chat_id:chatId,text:"Краткое описание бота обновлено."});return true;
  }
  if((text==="/setphoto"||text.startsWith("/setphoto@"))&&Array.isArray(message.photo)&&message.photo.length){
    await setBotProfilePhoto(token,message.photo[message.photo.length-1].file_id);
    await telegramApi(token,"sendMessage",{chat_id:chatId,text:"Фото профиля бота обновлено."});return true;
  }
  return false;
}
async function sendManagedBotCreationRequest(token,chatId){
  await telegramApi(token,"setMySettings",{can_manage_bots:true});
  await telegramApi(token,"sendMessage",{
    chat_id:chatId,
    text:"Нажми кнопку ниже, чтобы создать своего Telegram-бота, который будет привязан к твоему Telegram-аккаунту и управляться через FROSS.",
    reply_markup:{keyboard:[[{text:"Создать своего бота",request_managed_bot:{request_id:1,suggested_name:"My FROSS Bot"}}]],resize_keyboard:true,one_time_keyboard:true}
  });
}
async function registerManagedBotCreated(message,firestore,token){
  const created=message?.managed_bot_created?.bot,owner=message?.from;
  if(!created?.id||!owner?.id||String(message.chat?.type)!=="private")return false;
  const linked=await firestore.collection("users").where("telegramUserId","==",String(owner.id)).limit(1).get();
  if(linked.empty){
    await telegramApi(token,"sendMessage",{chat_id:message.chat.id,text:"Бот создан, но Telegram пока не привязан к FROSS. Подтверди номер в настройках приложения."});
    return true;
  }
  const uid=linked.docs[0].id;
  await firestore.doc("managedBots/"+String(created.id)).set({
    botId:String(created.id),username:String(created.username||""),firstName:String(created.first_name||""),
    ownerUid:uid,ownerTelegramUserId:String(owner.id),createdAt:Timestamp.now(),status:"active"
  },{merge:true});
  await telegramApi(token,"sendMessage",{
    chat_id:message.chat.id,
    text:"✅ Твой бот создан: "+(created.username?"@"+created.username:(created.first_name||"My bot"))+
      ". Он добавлен в список управляемых ботов FROSS. Секретный токен не отправляю в историю чата.",
    reply_markup:{remove_keyboard:true}
  });
  return true;
}
async function sendBotHelp(token,chatId){
  await telegramApi(token,"sendMessage",{
    chat_id:chatId,
    text:"FROSS Security Bot\n\n/securitycode — получить одноразовый код безопасности\n/createbot — инструкция по созданию собственного Telegram-бота\n\nВладелец бота @denhic может использовать /setname, /setdescription, /setabout и отправить фото с подписью /setphoto."
  });
}

// Account deletion is first confirmed in the linked Telegram account, then scheduled for 24 hours.
 // The user can cancel it in Telegram until the deadline.
export const requestAccountDeletion = onRequest({secrets:[TELEGRAM_BOT_TOKEN,TELEGRAM_WEBHOOK_SECRET]},async(req,res)=>{
  setCors(req,res);
  if(req.method==="OPTIONS")return res.status(204).send("");
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed."});
  try{
    const uid=await verifiedUid(req),auth=getAuth(),firestore=getFirestore();
    const decoded=await auth.verifyIdToken((req.get("Authorization")||"").replace(/^Bearer\s+/i,""),true);
    if(!decoded.auth_time||Date.now()/1000-decoded.auth_time>300)return res.status(401).json({error:"Для удаления войди в аккаунт заново."});
    const [userSnap,profileSnap]=await Promise.all([firestore.doc("users/"+uid).get(),firestore.doc("publicUsers/"+uid).get()]);
    if(!profileSnap.exists||profileSnap.data().deleted===true)return res.status(404).json({error:"Профиль не найден."});
    const userData=userSnap.data()||{};
    if(!userData.telegramChatId||!userData.telegramUserId)return res.status(409).json({error:"Сначала привяжи Telegram: подтверди свой номер через бота FROSS."});
    const active=await firestore.doc("accountDeletionRequests/"+uid).get();
    if(active.exists){
      const state=active.data();
      const stillPending=state.status==="awaiting_confirmation"&&(!state.expiresAt||state.expiresAt.toMillis()>Date.now());
      const stillScheduled=state.status==="scheduled"&&state.deleteAfter&&state.deleteAfter.toMillis()>Date.now();
      if(stillPending||stillScheduled)return res.status(409).json({error:"Запрос на удаление уже существует. Проверь сообщения от бота FROSS."});
    }
    await ensureTelegramWebhook(TELEGRAM_BOT_TOKEN.value(),TELEGRAM_WEBHOOK_SECRET.value());
    const requestId=randomBytes(12).toString("base64url");
    const requestRef=firestore.doc("securityRequests/"+requestId);
    const expiresAt=Timestamp.fromMillis(Date.now()+15*60*1000);
    await requestRef.create({
      uid,type:"account_delete",status:"pending_confirmation",
      telegramChatId:String(userData.telegramChatId),telegramUserId:String(userData.telegramUserId),
      telegramUsername:userData.telegramUsername||"",createdAt:Timestamp.now(),expiresAt
    });
    await firestore.doc("accountDeletionRequests/"+uid).set({uid,status:"awaiting_confirmation",securityRequestId:requestId,expiresAt,telegramChatId:String(userData.telegramChatId),telegramUserId:String(userData.telegramUserId)});
    await telegramApi(TELEGRAM_BOT_TOKEN.value(),"sendMessage",{
      chat_id:userData.telegramChatId,
      text:"⚠️ Запрошено удаление аккаунта FROSS. Если это ты, подтверди действие. После подтверждения аккаунт будет удалён через 24 часа. До истечения срока удаление можно отменить здесь, в боте.",
      reply_markup:{inline_keyboard:[[
        {text:"Подтвердить удаление",callback_data:"del_yes_"+requestId},
        {text:"Это не я",callback_data:"del_no_"+requestId}
      ]]}
    });
    return res.status(200).json({ok:true,confirmationSent:true});
  }catch(error){
    console.error("Request account deletion:",error?.message||error);
    return res.status(400).json({error:error?.message||"Не удалось отправить запрос в Telegram."});
  }
});

export const startPhoneVerification = onRequest({secrets:BOT_SECRETS},async(req,res)=>{
  setCors(req,res);
  if(req.method==="OPTIONS")return res.status(204).send("");
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed."});
  try{
    const uid=await verifiedUid(req),phone=normalizePhone(req.body?.phone);
    await ensureTelegramWebhook(TELEGRAM_BOT_TOKEN.value(),TELEGRAM_WEBHOOK_SECRET.value());
    const challengeId=randomBytes(18).toString("base64url");
    const code=String(randomInt(100000,1000000));
    const expiresAt=Timestamp.fromMillis(Date.now()+PHONE_CODE_TTL_MS);
    await getFirestore().doc("phoneChallenges/"+challengeId).create({
      uid,phone,channel:"telegram",code,
      codeHash:createHash("sha256").update(challengeId+":"+code).digest("hex"),
      status:"waiting_contact",attempts:0,createdAt:Timestamp.now(),expiresAt
    });
    const bot=await telegramApi(TELEGRAM_BOT_TOKEN.value(),"getMe",{});
    return res.status(200).json({ok:true,challengeId,botUrl:"https://t.me/"+bot.username+"?start="+challengeId,expiresInSeconds:600});
  }catch(error){
    console.error("Start phone verification:",error?.message||error);
    return res.status(400).json({error:error?.message||"Не удалось начать подтверждение номера."});
  }
});


export const confirmPhoneVerification = onRequest(async(req,res)=>{
  setCors(req,res);
  if(req.method==="OPTIONS")return res.status(204).send("");
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed."});
  try{
    const uid=await verifiedUid(req),challengeId=String(req.body?.challengeId||""),code=String(req.body?.code||"").trim();
    if(!/^[A-Za-z0-9_-]{20,40}$/.test(challengeId)||!/^\\d{6}$/.test(code))return res.status(400).json({error:"Проверь ссылку и шестизначный код."});
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
    const privateData=privateSnap.data()||{};
    const verifiedPhone=challenge.phone;
    await privateRef.set({
      phoneNumber:verifiedPhone,phoneVerified:true,phoneVerifiedAt:Timestamp.now(),
      phoneVerificationChannel:"telegram",telegramChatId:String(challenge.botChatId||""),
      telegramUserId:String(challenge.telegramUserId||challenge.botUserId||""),
      telegramUsername:String(challenge.telegramUsername||""),
      phoneVisible:privateData.phoneVisible===true,updatedAt:Timestamp.now()
    },{merge:true});
    await publicRef.set({
      phoneStatus:privateData.phoneVisible===true?"visible":"hidden",
      ...(privateData.phoneVisible===true?{phonePublic:verifiedPhone}:{phonePublic:""})
    },{merge:true});
    await claimBotOwnerIfNeeded(firestore,uid,challenge.telegramUserId||challenge.botUserId,challenge.telegramUsername);
    await challengeRef.delete();
    if(challenge.botChatId)await firestore.doc("phoneBotSessions/telegram_"+challenge.botChatId).delete().catch(()=>{});
    return res.status(200).json({ok:true,phoneVerified:true,channel:"telegram"});
  }catch(error){
    console.error("Confirm phone verification:",error?.message||error);
    return res.status(400).json({error:error?.message||"Не удалось подтвердить номер."});
  }
});



export const telegramPhoneWebhook = onRequest({secrets:BOT_SECRETS},async(req,res)=>{
  if(req.method!=="POST")return res.status(405).send("");
  if(!safeSecretEqual(req.get("X-Telegram-Bot-Api-Secret-Token"),TELEGRAM_WEBHOOK_SECRET.value()))return res.status(401).send("");
  try{
    const firestore=getFirestore(),token=TELEGRAM_BOT_TOKEN.value(),update=req.body||{};
    if(update.callback_query){
      await handleSecurityCallback(update.callback_query,token);
      return res.status(200).send("ok");
    }
    const message=update.message;
    if(!message?.chat?.id||String(message.chat.type)!=="private")return res.status(200).send("ok");
    if(message.managed_bot_created?.bot){
      await registerManagedBotCreated(message,firestore,token);
      return res.status(200).send("ok");
    }
    const chatId=String(message.chat.id),text=String(message.text||"");
    const start=text.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{20,40})/);
    if(start){
      const active=await activateChallenge(start[1],chatId,message.from);
      if(!active)await telegramApi(token,"sendMessage",{chat_id:chatId,text:"Ссылка FROSS истекла. Вернись в настройки и запроси новый код."});
      else await sendTelegramContactRequest(token,chatId);
      return res.status(200).send("ok");
    }
    const sessionRef=firestore.doc("phoneBotSessions/telegram_"+chatId);
    if(message.contact){
      const sessionSnap=await sessionRef.get();
      if(!sessionSnap.exists)return res.status(200).send("ok");
      const session=sessionSnap.data(),challengeRef=firestore.doc("phoneChallenges/"+session.challengeId),challengeSnap=await challengeRef.get();
      if(!challengeSnap.exists)return res.status(200).send("ok");
      const challenge=challengeSnap.data(),contact=message.contact;
      const actualPhone=String(contact.phone_number||"").replace(/\D/g,"");
      const expectedPhone=String(challenge.phone||"").replace(/\D/g,"");
      if(String(contact.user_id||"")!==String(message.from?.id||"")||actualPhone!==expectedPhone){
        await telegramApi(token,"sendMessage",{chat_id:chatId,text:"Нужен именно твой собственный контакт с номером, который указан в FROSS.",reply_markup:{remove_keyboard:true}});
        return res.status(200).send("ok");
      }
      await deliverPhoneCode(challengeRef,challenge,chatId,token);
      await telegramApi(token,"sendMessage",{chat_id:chatId,text:"Контакт проверен. Код отправлен. Вернись в FROSS и введи шесть цифр.",reply_markup:{remove_keyboard:true}});
      return res.status(200).send("ok");
    }
    const linked=await firestore.collection("users").where("telegramUserId","==",String(message.from?.id||"")).limit(1).get();
    if(!linked.empty){
      const uid=linked.docs[0].id,privateData=linked.docs[0].data();
      await claimBotOwnerIfNeeded(firestore,uid,message.from?.id,message.from?.username);
      if(text==="/securitycode"){
        const last=privateData.securityCodeCreatedAt?.toMillis?.()||0;
        if(last&&Date.now()-last<30*1000){
          await telegramApi(token,"sendMessage",{chat_id:chatId,text:"Подожди 30 секунд перед запросом нового кода безопасности."});
          return res.status(200).send("ok");
        }
        const code=String(randomInt(100000,1000000)),expiresAt=Timestamp.fromMillis(Date.now()+5*60*1000);
        await firestore.doc("users/"+uid).set({securityCodeHash:createHash("sha256").update(uid+":"+code).digest("hex"),securityCodeExpiresAt:expiresAt,securityCodeCreatedAt:Timestamp.now()},{merge:true});
        await telegramApi(token,"sendMessage",{chat_id:chatId,text:"Твой одноразовый код безопасности FROSS: "+code+"\nОн действует 5 минут. Никому его не пересылай."});
        return res.status(200).send("ok");
      }
      if(text==="/createbot"){
        try{await sendManagedBotCreationRequest(token,chatId)}
        catch(error){
          console.warn("Managed bot creation unavailable:",error?.message||error);
          await telegramApi(token,"sendMessage",{chat_id:chatId,text:"Создание управляемых ботов недоступно для этого бота. Повтори позже или проверь функцию can_manage_bots через @BotFather."});
        }
        return res.status(200).send("ok");
      }
      if(await handleOwnerBotMessage(message,token,firestore))return res.status(200).send("ok");
      if(text==="/start"||text==="/help"){await sendBotHelp(token,chatId);return res.status(200).send("ok")}
      if(text.startsWith("/")){await telegramApi(token,"sendMessage",{chat_id:chatId,text:"Неизвестная команда. Отправь /help."});return res.status(200).send("ok")}
    }else if(text==="/start"||text==="/help"){
      await sendBotHelp(token,chatId);
    }
    return res.status(200).send("ok");
  }catch(error){
    console.error("Telegram bot webhook:",error?.message||error);
    return res.status(200).send("ok");
  }
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

async function deleteAccountAfterDeadline(uid,requestData){
  const firestore=getFirestore(),auth=getAuth(),profileRef=firestore.doc("publicUsers/"+uid);
  const [profileSnap,privateSnap]=await Promise.all([profileRef.get(),firestore.doc("users/"+uid).get()]);
  if(!profileSnap.exists)return;
  const profile=profileSnap.data(),privateData=privateSnap.data()||{};
  const now=Timestamp.now(),chatDeleteAfter=Timestamp.fromMillis(now.toMillis()+24*60*60*1000);
  const chats=await firestore.collection("chats").where("memberUids","array-contains",uid).get();
  const batch=firestore.batch(),username=String(profile.usernameLower||profile.username||"").toLowerCase();
  batch.set(profileRef,{deleted:true,deletedAt:now,displayName:"Аккаунт удалён",username:"deleted_"+uid.slice(0,8),usernameLower:"deleted_"+uid.slice(0,8),bio:"",avatarUrl:"",lastSeenAt:now},{merge:true});
  if(username)batch.delete(firestore.doc("usernameIndex/"+username));
  batch.delete(firestore.doc("users/"+uid));
  for(const chatDoc of chats.docs){
    const chat=chatDoc.data(),messageRef=chatDoc.ref.collection("messages").doc();
    const isDm=chat.type==="dm",text=isDm?"Аккаунт удалён. Этот личный чат будет автоматически удалён через 24 часа.":"Аккаунт удалён.";
    batch.set(messageRef,{senderUid:uid,username:"deleted",displayName:"Аккаунт удалён",text,accountDeletedNotice:true,createdAt:FieldValue.serverTimestamp()});
    const update={lastMessage:text,lastMessageAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),memberProfiles:(chat.memberProfiles||[]).map(member=>member.uid===uid?{...member,deleted:true,displayName:"Аккаунт удалён",username:"deleted",avatarUrl:"",profileColor:profile.profileColor||"#777777"}:member)};
    if(isDm){update.deletionScheduledAt=now;update.deleteAfter=chatDeleteAfter;update.deletionNotice="Этот чат будет удалён через 24 часа."}
    batch.update(chatDoc.ref,update);
  }
  await batch.commit();
  if(profile.avatarUrl){
    try{await getStorage().bucket("fross-ca5d6.firebasestorage.app").file("avatars/"+uid+"/avatar.jpg").delete({ignoreNotFound:true})}catch(error){console.warn("Avatar cleanup:",error?.message)}
  }
  await auth.deleteUser(uid).catch(error=>{if(error.code!=="auth/user-not-found")throw error});
  await firestore.doc("accountDeletionRequests/"+uid).update({status:"completed",completedAt:Timestamp.now()});
  if(requestData?.telegramChatId){
    await telegramApi(TELEGRAM_BOT_TOKEN.value(),"sendMessage",{chat_id:requestData.telegramChatId,text:"Аккаунт FROSS окончательно удалён. Личные чаты будут очищены в течение следующих 24 часов."}).catch(()=>{});
  }
}
export const purgePendingAccountDeletions = onSchedule({schedule:"every 15 minutes",secrets:[TELEGRAM_BOT_TOKEN]},async()=>{
  const firestore=getFirestore(),now=Timestamp.now();
  const due=await firestore.collection("accountDeletionRequests").where("status","==","scheduled").where("deleteAfter","<=",now).limit(50).get();
  for(const item of due.docs){
    try{
      const claimed=await firestore.runTransaction(async tx=>{
        const fresh=await tx.get(item.ref);
        if(!fresh.exists||fresh.data().status!=="scheduled"||fresh.data().deleteAfter.toMillis()>Date.now())return false;
        tx.update(item.ref,{status:"deleting",deletingAt:Timestamp.now()});return true;
      });
      if(claimed)await deleteAccountAfterDeadline(item.id,item.data());
    }catch(error){
      console.error("Scheduled account deletion failed for "+item.id,error?.message||error);
      await item.ref.update({status:"scheduled",lastErrorAt:Timestamp.now()}).catch(()=>{});
    }
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
