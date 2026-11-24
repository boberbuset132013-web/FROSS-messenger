const PROJECT_ID = "fross-ca5d6";
const FILEBASE_HOST = "s3.filebase.io";
const REGION = "auto";
const SERVICE = "s3";
const TOKEN_ISSUER = "https://securetoken.google.com/" + PROJECT_ID;
const encoder = new TextEncoder();
let signingKeys = null;
let signingKeysLoadedAt = 0;
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}})}
function base64UrlBytes(value){const padded=value.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((value.length+3)%4);const binary=atob(padded);const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes}
function decodeBase64UrlJson(value){return JSON.parse(new TextDecoder().decode(base64UrlBytes(value)))}
function hex(bytes){return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("")}
async function sha256(value){return new Uint8Array(await crypto.subtle.digest("SHA-256",value))}
async function hmac(key,value){const cryptoKey=await crypto.subtle.importKey("raw",key,{name:"HMAC",hash:"SHA-256"},false,["sign"]);return new Uint8Array(await crypto.subtle.sign("HMAC",cryptoKey,typeof value==="string"?encoder.encode(value):value))}
async function signingKey(secret,date){const kDate=await hmac(encoder.encode("AWS4"+secret),date);const kRegion=await hmac(kDate,REGION);const kService=await hmac(kRegion,SERVICE);return await hmac(kService,"aws4_request")}
function amzTimestamp(){return new Date().toISOString().replace(/[:-]|\.\d{3}/g,"")}
function awsEncode(value){return encodeURIComponent(value).replace(/[!'()*]/g,c=>"%" + c.charCodeAt(0).toString(16).toUpperCase())}
function objectPath(bucket,key){return "/"+awsEncode(bucket)+"/"+key.split("/").map(awsEncode).join("/")}
async function getGoogleSigningKeys(force=false){
  const now=Date.now();if(!force&&signingKeys&&now-signingKeysLoadedAt<3000000)return signingKeys;
  const response=await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
  if(!response.ok)throw new Error("Не удалось проверить подпись Firebase.");
  signingKeys=(await response.json()).keys||[];signingKeysLoadedAt=now;return signingKeys;
}
async function verifyFirebaseToken(request){
  const match=(request.headers.get("Authorization")||"").match(/^Bearer\s+(.+)$/i);
  if(!match)throw new Error("Нужен вход в аккаунт FROSS.");
  const parts=match[1].trim().split(".");if(parts.length!==3)throw new Error("Сессия входа недействительна.");
  const header=decodeBase64UrlJson(parts[0]),claims=decodeBase64UrlJson(parts[1]),now=Math.floor(Date.now()/1000);
  if(header.alg!=="RS256"||!header.kid||claims.aud!==PROJECT_ID||claims.iss!==TOKEN_ISSUER||
    !claims.sub||typeof claims.sub!=="string"||!Number.isFinite(claims.exp)||claims.exp<=now||
    !Number.isFinite(claims.iat)||claims.iat>now+60||(claims.email_verified!==true&&claims.legacyAccount!==true)){
    throw new Error("Войди в подтверждённый аккаунт FROSS и повтори попытку.");
  }
  let keys=await getGoogleSigningKeys(),jwk=keys.find(item=>item.kid===header.kid);
  if(!jwk){keys=await getGoogleSigningKeys(true);jwk=keys.find(item=>item.kid===header.kid)}
  if(!jwk)throw new Error("Ключ подписи Firebase не найден.");
  const publicKey=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  const valid=await crypto.subtle.verify({name:"RSASSA-PKCS1-v1_5"},publicKey,base64UrlBytes(parts[2]),encoder.encode(parts[0]+"."+parts[1]));
  if(!valid)throw new Error("Сессия Firebase не прошла проверку подписи.");
  return {uid:claims.sub,token:match[1].trim()};
}
function firestoreUrl(path){return "https://firestore.googleapis.com/v1/projects/"+PROJECT_ID+"/databases/(default)/documents/"+path}
async function firestoreGet(path,token){
  const response=await fetch(firestoreUrl(path),{headers:{Authorization:"Bearer "+token}});
  if(response.status===404)return null;
  if(!response.ok)throw new Error("Firestore отклонил проверку доступа (HTTP "+response.status+").");
  return await response.json();
}
function stringField(document,name){return document?.fields?.[name]?.stringValue||""}
async function isChatMember(chatId,uid,token){
  if(chatId==="general")return true;
  if(!/^[A-Za-z0-9_-]{1,120}$/.test(chatId))return false;
  const chat=await firestoreGet("chats/"+encodeURIComponent(chatId),token);if(!chat)return false;
  return (chat.fields?.memberUids?.arrayValue?.values||[]).some(value=>value.stringValue===uid);
}
function attachmentFields(message){return message?.fields?.attachment?.mapValue?.fields||{}}
function validAvatarPath(path,uid){return new RegExp("^avatars/"+uid+"/[A-Za-z0-9._-]{1,180}$").test(path)}
function validChatPath(path,chatId,uid){return path.startsWith("chatFiles/"+chatId+"/"+uid+"/")&&/^chatFiles\/[A-Za-z0-9_-]{1,120}\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9._-]{1,220}$/.test(path)}
function config(env){if(!env.FILEBASE_ACCESS_KEY||!env.FILEBASE_SECRET_KEY||!env.FILEBASE_BUCKET)throw new Error("Filebase ещё не подключён на сервере. Проверь секреты деплоя.");return {key:env.FILEBASE_ACCESS_KEY,secret:env.FILEBASE_SECRET_KEY,bucket:env.FILEBASE_BUCKET}}
async function s3Request(env,method,key,body=null,contentType=""){
  const c=config(env),path=objectPath(c.bucket,key),timestamp=amzTimestamp(),date=timestamp.slice(0,8);
  const payload=body===null?new Uint8Array():body,payloadHash=hex(await sha256(payload));
  const headers={host:FILEBASE_HOST,"x-amz-content-sha256":payloadHash,"x-amz-date":timestamp};
  if(contentType)headers["content-type"]=contentType.trim();
  const names=Object.keys(headers).sort(),canonicalHeaders=names.map(name=>name+":"+headers[name].replace(/\s+/g," ").trim()+"\n").join("");
  const signedHeaders=names.join(";"),scope=date+"/"+REGION+"/"+SERVICE+"/aws4_request";
  const canonicalRequest=method+"\n"+path+"\n\n"+canonicalHeaders+"\n"+signedHeaders+"\n"+payloadHash;
  const stringToSign="AWS4-HMAC-SHA256\n"+timestamp+"\n"+scope+"\n"+hex(await sha256(encoder.encode(canonicalRequest)));
  const signature=hex(await hmac(await signingKey(c.secret,date),stringToSign));
  const requestHeaders={"x-amz-content-sha256":payloadHash,"x-amz-date":timestamp,"Authorization":"AWS4-HMAC-SHA256 Credential="+c.key+"/"+scope+", SignedHeaders="+signedHeaders+", Signature="+signature};
  if(contentType)requestHeaders["Content-Type"]=contentType;
  const response=await fetch("https://"+FILEBASE_HOST+path,{method,headers:requestHeaders,body:method==="PUT"?payload:undefined});
  if(!response.ok)throw new Error("Filebase отклонил запрос (HTTP "+response.status+"). "+(await response.text()).slice(0,300));
  return response;
}
async function presignedGet(env,key,expires=600){
  const c=config(env),path=objectPath(c.bucket,key),timestamp=amzTimestamp(),date=timestamp.slice(0,8),scope=date+"/"+REGION+"/"+SERVICE+"/aws4_request";
  const values={"X-Amz-Algorithm":"AWS4-HMAC-SHA256","X-Amz-Credential":c.key+"/"+scope,"X-Amz-Date":timestamp,"X-Amz-Expires":String(expires),"X-Amz-SignedHeaders":"host"};
  const query=Object.entries(values).map(([k,v])=>[awsEncode(k),awsEncode(v)]).sort((a,b)=>a[0].localeCompare(b[0])).map(p=>p[0]+"="+p[1]).join("&");
  const canonicalRequest="GET\n"+path+"\n"+query+"\nhost:"+FILEBASE_HOST+"\n\nhost\nUNSIGNED-PAYLOAD";
  const stringToSign="AWS4-HMAC-SHA256\n"+timestamp+"\n"+scope+"\n"+hex(await sha256(encoder.encode(canonicalRequest)));
  const signature=hex(await hmac(await signingKey(c.secret,date),stringToSign));
  return "https://"+FILEBASE_HOST+path+"?"+query+"&X-Amz-Signature="+signature;
}
async function upload(request,env,url){
  const identity=await verifyFirebaseToken(request),scope=url.searchParams.get("scope")||"",type=(request.headers.get("Content-Type")||"application/octet-stream").trim();
  const max=scope==="avatar"?5*1024*1024:20*1024*1024,declared=Number(request.headers.get("Content-Length")||0);
  if(declared>max)return json({error:"Файл слишком большой."},413);
  if(type.length>120)return json({error:"Слишком длинный тип файла."},400);
  const body=new Uint8Array(await request.arrayBuffer());if(!body.length)return json({error:"Файл пустой."},400);if(body.length>max)return json({error:"Файл превышает допустимый размер."},413);
  const name=(url.searchParams.get("name")||"file").replace(/[^A-Za-z0-9._-]/g,"_").slice(0,100)||"file";let key;
  if(scope==="avatar"){
    if(!type.toLowerCase().startsWith("image/"))return json({error:"Аватар должен быть изображением."},400);
    key="avatars/"+identity.uid+"/avatar_"+crypto.randomUUID()+"_"+name;
  }else if(scope==="chat"){
    const chatId=url.searchParams.get("chatId")||"";
    if(!await isChatMember(chatId,identity.uid,identity.token))return json({error:"У тебя нет доступа к этому чату."},403);
    key="chatFiles/"+chatId+"/"+identity.uid+"/"+Date.now()+"_"+crypto.randomUUID().slice(0,8)+"_"+name;
  }else return json({error:"Неподдерживаемый тип загрузки."},400);
  await s3Request(env,"PUT",key,body,type);return json({path:key,url:"filebase:"+key});
}
async function fileUrl(request,env){
  const identity=await verifyFirebaseToken(request),body=await request.json(),path=String(body.path||"");let allowed=false;
  if(path.startsWith("avatars/")){
    const match=path.match(/^avatars\/([A-Za-z0-9_-]{1,128})\//);
    if(match&&validAvatarPath(path,match[1])){
      const profile=await firestoreGet("publicUsers/"+encodeURIComponent(match[1]),identity.token);
      allowed=stringField(profile,"avatarUrl")==="filebase:"+path;
    }
  }else if(path.startsWith("chatFiles/")){
    const match=path.match(/^chatFiles\/([A-Za-z0-9_-]{1,120})\/([A-Za-z0-9_-]{1,128})\/[A-Za-z0-9._-]{1,220}$/);
    if(match&&validChatPath(path,match[1],match[2]))allowed=await isChatMember(match[1],identity.uid,identity.token);
  }
  if(!allowed)return json({error:"Нет доступа к этому файлу."},403);
  return json({url:await presignedGet(env,path,600),expiresIn:600});
}

async function downloadFile(request,env){
  const identity=await verifyFirebaseToken(request);
  const body=await request.json();
  const path=String(body.path||"");
  const requestedName=String(body.name||"download").replace(/[\r\n"]/g,"_").slice(0,180)||"download";
  let allowed=false;
  if(path.startsWith("avatars/")){
    const match=path.match(/^avatars\/([A-Za-z0-9_-]{1,128})\//);
    if(match&&match[1]===identity.uid&&validAvatarPath(path,identity.uid)){
      const profile=await firestoreGet("publicUsers/"+encodeURIComponent(identity.uid),identity.token);
      allowed=stringField(profile,"avatarUrl")==="filebase:"+path;
    }
  }else if(path.startsWith("chatFiles/")){
    const match=path.match(/^chatFiles\/([A-Za-z0-9_-]{1,120})\/([A-Za-z0-9_-]{1,128})\/[A-Za-z0-9._-]{1,220}$/);
    if(match&&validChatPath(path,match[1],match[2]))allowed=await isChatMember(match[1],identity.uid,identity.token);
  }
  if(!allowed)return json({error:"Нет доступа к этому файлу."},403);
  const object=await s3Request(env,"GET",path);
  const asciiName=requestedName.replace(/[^\x20-\x7E]/g,"_").replace(/[\\"]/g,"_");
  const headers=new Headers({
    "Content-Type":object.headers.get("Content-Type")||"application/octet-stream",
    "Content-Disposition":"attachment; filename=\""+asciiName+"\"; filename*=UTF-8''"+awsEncode(requestedName),
    "Cache-Control":"private, no-store",
    "X-Content-Type-Options":"nosniff"
  });
  const length=object.headers.get("Content-Length");
  if(length)headers.set("Content-Length",length);
  return new Response(object.body,{status:200,headers});
}

async function deleteMessageFile(request,env){
  const identity=await verifyFirebaseToken(request),body=await request.json(),chatId=String(body.chatId||""),messageId=String(body.messageId||"");
  if(!/^[A-Za-z0-9_-]{1,120}$/.test(chatId)||!/^[A-Za-z0-9_-]{1,160}$/.test(messageId))return json({error:"Неверный идентификатор сообщения."},400);
  if(!await isChatMember(chatId,identity.uid,identity.token))return json({error:"Нет доступа к этому чату."},403);
  const message=await firestoreGet("chats/"+encodeURIComponent(chatId)+"/messages/"+encodeURIComponent(messageId),identity.token);
  if(!message)return json({error:"Сообщение уже удалено."},404);
  if(stringField(message,"senderUid")!==identity.uid)return json({error:"Удалить сообщение может только его автор."},403);
  const attachment=attachmentFields(message),path=attachment.path?.stringValue||"",storedUrl=attachment.url?.stringValue||"";let fileDeleted=false;
  if(storedUrl.startsWith("filebase:")&&storedUrl==="filebase:"+path){
    if(!validChatPath(path,chatId,identity.uid))return json({error:"Путь вложения не прошёл проверку."},400);
    await s3Request(env,"DELETE",path);fileDeleted=true;
  }
  return json({ok:true,fileDeleted});
}
async function deleteAvatar(request,env){
  const identity=await verifyFirebaseToken(request),body=await request.json(),path=String(body.path||"");
  if(!validAvatarPath(path,identity.uid))return json({error:"Неверный путь аватара."},400);
  const profile=await firestoreGet("publicUsers/"+encodeURIComponent(identity.uid),identity.token);
  if(stringField(profile,"avatarUrl")==="filebase:"+path)return json({error:"Сначала сохрани новый аватар или удали текущий из профиля."},409);
  await s3Request(env,"DELETE",path);return json({ok:true});
}
async function callIceConfiguration(request,env){
  await verifyFirebaseToken(request);
  const iceServers=[
    {urls:["stun:stun.l.google.com:19302","stun:stun1.l.google.com:19302"]},
    {urls:["stun:stun.cloudflare.com:3478"]}
  ];
  const urls=String(env.FROSS_TURN_URLS||"").split(",").map(value=>value.trim()).filter(Boolean);
  const username=String(env.FROSS_TURN_USERNAME||"").trim();
  const credential=String(env.FROSS_TURN_CREDENTIAL||"");
  const turnConfigured=urls.length>0&&!!username&&!!credential;
  if(turnConfigured)iceServers.push({urls,username,credential});
  return json({iceServers,turnConfigured});
}

function phoneBotConfig(env){
  if(!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_WEBHOOK_SECRET)throw new Error("Telegram-бот ещё не подключён на сервере. Добавь TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET в секреты деплоя.");
  return {token:env.TELEGRAM_BOT_TOKEN,secret:env.TELEGRAM_WEBHOOK_SECRET};
}
async function telegramCall(token,method,payload){
  const response=await fetch("https://api.telegram.org/bot"+token+"/"+method,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  const result=await response.json().catch(()=>({}));
  if(!response.ok||result.ok!==true)throw new Error("Telegram Bot API: "+(result.description||response.status));
  return result.result;
}
async function savePhoneRecord(key,value,env){
  await s3Request(env,"PUT",key,encoder.encode(JSON.stringify(value)),"application/json");
}
async function readPhoneRecord(key,env){
  try{const response=await s3Request(env,"GET",key);return await response.json()}
  catch(error){if(String(error?.message||"").includes("(HTTP 404)"))return null;throw error}
}
async function deletePhoneRecord(key,env){
  await s3Request(env,"DELETE",key).catch(error=>{if(!String(error?.message||"").includes("(HTTP 404)"))throw error});
}
async function sha256Hex(value){return hex(await sha256(encoder.encode(value)))}
function constantTimeEqual(a,b){
  const left=encoder.encode(String(a||"")),right=encoder.encode(String(b||""));
  if(left.length!==right.length)return false;
  let diff=0;for(let i=0;i<left.length;i++)diff|=left[i]^right[i];
  return diff===0;
}
function phoneDigits(value){return String(value||"").replace(/\D/g,"")}
async function firestorePatch(path,token,fields){
  const mask=Object.keys(fields).map(name=>"updateMask.fieldPaths="+encodeURIComponent(name)).join("&");
  const response=await fetch(firestoreUrl(path)+"?"+mask,{method:"PATCH",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({fields})});
  if(!response.ok){
    const detail=await response.text().catch(()=>"");
    let reason=detail;
    try{const parsed=JSON.parse(detail);reason=parsed?.error?.message||parsed?.error?.status||detail}catch{}
    console.error("Firestore phone confirmation PATCH failed:",response.status,detail.slice(0,1200));
    throw new Error("Не удалось сохранить подтверждение в Firestore (HTTP "+response.status+"): "+String(reason||"неизвестная причина").slice(0,500));
  }
  return await response.json();
}
async function startPhoneVerification(request,env,url){
  const identity=await verifyFirebaseToken(request),body=await request.json(),phone=String(body.phone||"").replace(/[\s().-]/g,"");
  if(!/^\+[1-9]\d{7,14}$/.test(phone))return json({error:"Введите номер в международном формате."},400);
  const {token,secret}=phoneBotConfig(env),challengeId=crypto.randomUUID().replace(/-/g,""),code=String(crypto.getRandomValues(new Uint32Array(1))[0]%900000+100000);
  const bot=await telegramCall(token,"getMe",{});
  if(!bot?.username)throw new Error("У Telegram-бота не найден username.");
  const webhookUrl=new URL("/api/telegram/webhook",url.origin).toString();
  await telegramCall(token,"setWebhook",{url:webhookUrl,secret_token:secret,allowed_updates:["message"],drop_pending_updates:false});
  await savePhoneRecord("phoneChallenges/"+challengeId+".json",{
    uid:identity.uid,phone,code,codeHash:"",status:"waiting_start",createdAt:Date.now(),expiresAt:Date.now()+10*60*1000
  },env);
  return json({ok:true,challengeId,botUrl:"https://t.me/"+bot.username+"?start="+challengeId,expiresInSeconds:600});
}
async function confirmPhoneVerification(request,env){
  const identity=await verifyFirebaseToken(request),body=await request.json(),challengeId=String(body.challengeId||""),code=String(body.code||"").trim();
  if(!/^[a-f0-9]{32}$/.test(challengeId)||!/^\d{6}$/.test(code))return json({error:"Проверь ссылку и шестизначный код."},400);
  const key="phoneChallenges/"+challengeId+".json",challenge=await readPhoneRecord(key,env);
  if(!challenge)return json({error:"Запрос подтверждения не найден. Запроси новый код."},404);
  if(challenge.uid!==identity.uid)return json({error:"Этот запрос создан для другого аккаунта FROSS."},403);
  if(!Number.isFinite(challenge.expiresAt)||challenge.expiresAt<=Date.now())return json({error:"Код истёк. Запроси новый."},410);
  if(challenge.status!=="code_sent"||!challenge.codeHash)return json({error:"Сначала открой бота и отправь свой контакт."},409);
  if(!constantTimeEqual(await sha256Hex(challengeId+":"+code),challenge.codeHash)){
    challenge.attempts=(challenge.attempts||0)+1;
    if(challenge.attempts>=5)await deletePhoneRecord(key,env);else await savePhoneRecord(key,challenge,env);
    return json({error:challenge.attempts>=5?"Слишком много попыток. Запроси новый код.":"Неверный код. Проверь сообщение от бота."},400);
  }
  const privateDoc=await firestoreGet("users/"+encodeURIComponent(identity.uid),identity.token);
  const phoneVisible=privateDoc?.fields?.phoneVisible?.booleanValue===true;
  await firestorePatch("users/"+encodeURIComponent(identity.uid),identity.token,{
    phoneNumber:{stringValue:challenge.phone},phoneVerified:{booleanValue:true},
    updatedAt:{timestampValue:new Date().toISOString()}
  });
  await firestorePatch("publicUsers/"+encodeURIComponent(identity.uid),identity.token,{
    phoneStatus:{stringValue:phoneVisible?"visible":"hidden"},
    phonePublic:{stringValue:phoneVisible?challenge.phone:""}
  });
  await savePhoneRecord("phoneLinks/"+identity.uid+".json",{
    uid:identity.uid,telegramChatId:String(challenge.chatId||""),telegramUserId:String(challenge.telegramUserId||""),
    telegramUsername:String(challenge.telegramUsername||""),linkedAt:Date.now()
  },env);
  await deletePhoneRecord(key,env);
  if(challenge.chatId)await deletePhoneRecord("phoneSessions/"+String(challenge.chatId)+".json",env);
  return json({ok:true,phoneVerified:true,channel:"telegram"});
}
async function telegramPhoneWebhook(request,env){
  const {token,secret}=phoneBotConfig(env);
  if(!constantTimeEqual(request.headers.get("X-Telegram-Bot-Api-Secret-Token"),secret))return new Response("",{status:401});
  const update=await request.json(),message=update.message;
  if(!message?.chat?.id||String(message.chat.type)!=="private")return new Response("ok");
  const chatId=String(message.chat.id),from=message.from||{},text=String(message.text||"");
  const start=text.match(/^\/start(?:@\w+)?\s+([a-f0-9]{32})/i);
  if(start){
    const challengeId=start[1].toLowerCase(),key="phoneChallenges/"+challengeId+".json",challenge=await readPhoneRecord(key,env);
    if(!challenge||challenge.status!=="waiting_start"||challenge.expiresAt<=Date.now()){
      await telegramCall(token,"sendMessage",{chat_id:chatId,text:"Ссылка FROSS истекла. Вернись в настройки приложения и запроси новый код."});
      return new Response("ok");
    }
    challenge.status="waiting_contact";challenge.chatId=chatId;challenge.telegramUserId=String(from.id||"");challenge.telegramUsername=String(from.username||"");
    await savePhoneRecord(key,challenge,env);
    await savePhoneRecord("phoneSessions/"+chatId+".json",{challengeId,telegramUserId:String(from.id||""),expiresAt:challenge.expiresAt},env);
    await telegramCall(token,"sendMessage",{chat_id:chatId,text:"Чтобы подтвердить номер FROSS, нажми кнопку и отправь именно свой контакт.",reply_markup:{keyboard:[[{text:"Поделиться номером телефона",request_contact:true}]],resize_keyboard:true,one_time_keyboard:true}});
    return new Response("ok");
  }
  if(message.contact){
    const session=await readPhoneRecord("phoneSessions/"+chatId+".json",env);
    if(!session||session.expiresAt<=Date.now())return new Response("ok");
    const key="phoneChallenges/"+session.challengeId+".json",challenge=await readPhoneRecord(key,env);
    if(!challenge||challenge.status!=="waiting_contact"||String(from.id||"")!==session.telegramUserId)return new Response("ok");
    if(String(message.contact.user_id||"")!==String(from.id||"")||phoneDigits(message.contact.phone_number)!==phoneDigits(challenge.phone)){
      await telegramCall(token,"sendMessage",{chat_id:chatId,text:"Нужен именно твой собственный контакт с номером, который указан в FROSS.",reply_markup:{remove_keyboard:true}});
      return new Response("ok");
    }
    const code=challenge.code;
    await telegramCall(token,"sendMessage",{chat_id:chatId,text:"Код подтверждения FROSS: "+code+"\nНикому не пересылай этот код."});
    challenge.code="";challenge.codeHash=await sha256Hex(session.challengeId+":"+code);challenge.status="code_sent";challenge.codeSentAt=Date.now();
    await savePhoneRecord(key,challenge,env);
    await deletePhoneRecord("phoneSessions/"+chatId+".json",env);
    await telegramCall(token,"sendMessage",{chat_id:chatId,text:"Контакт проверен. Код отправлен. Вернись в FROSS и введи шесть цифр.",reply_markup:{remove_keyboard:true}});
    return new Response("ok");
  }
  if(text==="/start"||text==="/help"){
    await telegramCall(token,"sendMessage",{chat_id:chatId,text:"Я — бот подтверждения номера FROSS. Чтобы начать, открой бота по ссылке из настроек FROSS."});
  }
  return new Response("ok");
}


async function getSystemInbox(request,env){
  const identity=await verifyFirebaseToken(request),key="systemInbox/"+identity.uid+".json";
  let inbox=await readPhoneRecord(key,env);
  if(!inbox){
    inbox={
      version:1,uid:identity.uid,createdAt:Date.now(),readAt:0,
      messages:[{
        id:"welcome",sender:"fross",kind:"welcome",
        text:"Добро пожаловать в FROSS! Это официальный системный чат. Здесь будут появляться важные уведомления о безопасности, аккаунте и новых возможностях. Настоящие сообщения FROSS отправляются сервером; другие пользователи не могут писать от имени системного бота.",
        createdAt:Date.now()
      }]
    };
    await savePhoneRecord(key,inbox,env);
  }
  if(inbox.uid!==identity.uid||!Array.isArray(inbox.messages))throw new Error("Системный чат не прошёл проверку владельца.");
  const messages=inbox.messages.slice(-100).map(message=>({
    id:String(message.id||""),sender:"fross",kind:String(message.kind||"notice"),
    text:String(message.text||"").slice(0,4000),createdAt:Number(message.createdAt)||0
  }));
  return json({ok:true,bot:{id:"fross-system",name:"FROSS",verified:true},messages,unreadCount:messages.filter(message=>message.createdAt>(Number(inbox.readAt)||0)).length});
}
async function markSystemInboxRead(request,env){
  const identity=await verifyFirebaseToken(request),key="systemInbox/"+identity.uid+".json";
  const inbox=await readPhoneRecord(key,env);
  if(!inbox||inbox.uid!==identity.uid)return json({ok:true});
  inbox.readAt=Date.now();
  await savePhoneRecord(key,inbox,env);
  return json({ok:true});
}

async function readBotStore(uid,env){
  const store=await readPhoneRecord("userBots/"+uid+".json",env);
  return store&&store.uid===uid&&Array.isArray(store.bots)?store:{version:1,uid,bots:[]};
}
async function botApi(request,env,action){
  const identity=await verifyFirebaseToken(request),store=await readBotStore(identity.uid,env);
  if(action==="list")return json({ok:true,bots:store.bots.map(({id,name,username,description,model,enabled,createdAt,updatedAt})=>({id,name,username,description,model,enabled,createdAt,updatedAt}))});
  const body=await request.json().catch(()=>({}));
  if(action==="create"){
    const name=String(body.name||"").trim().slice(0,40),username=String(body.username||"").trim().toLowerCase().replace(/^@/,"");
    if(name.length<2)return json({error:"Название бота должно содержать не менее 2 символов."},400);
    if(!/^[a-z0-9_]{3,24}$/.test(username))return json({error:"Username бота: 3–24 символа, латиница, цифры и _."},400);
    if(store.bots.length>=20)return json({error:"Можно создать не более 20 ботов."},409);
    if(store.bots.some(bot=>bot.username===username))return json({error:"Такой username уже занят среди твоих ботов."},409);
    const raw="FRS_"+Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
    const bot={id:crypto.randomUUID(),name,username,description:String(body.description||"").trim().slice(0,300),model:"none",enabled:true,tokenHash:await sha256Hex(raw),createdAt:Date.now(),updatedAt:Date.now()};
    store.bots.push(bot);await savePhoneRecord("userBots/"+identity.uid+".json",store,env);
    return json({ok:true,bot:{id:bot.id,name:bot.name,username:bot.username,description:bot.description,model:bot.model,enabled:bot.enabled,createdAt:bot.createdAt},token:raw,warning:"Скопируй токен сейчас: повторно показать его нельзя."},201);
  }
  const id=String(body.id||"");
  const bot=store.bots.find(item=>item.id===id);
  if(!bot)return json({error:"Бот не найден."},404);
  if(action==="update"){
    if(body.name!==undefined){const name=String(body.name).trim();if(name.length<2||name.length>40)return json({error:"Название: 2–40 символов."},400);bot.name=name}
    if(body.description!==undefined)bot.description=String(body.description).trim().slice(0,300);
    if(body.enabled!==undefined)bot.enabled=body.enabled===true;
    bot.updatedAt=Date.now();
  }else if(action==="revoke"){
    bot.tokenHash="";bot.enabled=false;bot.updatedAt=Date.now();
  }else return json({error:"Неизвестное действие."},400);
  await savePhoneRecord("userBots/"+identity.uid+".json",store,env);
  return json({ok:true,bot:{id:bot.id,name:bot.name,username:bot.username,description:bot.description,model:bot.model,enabled:bot.enabled,createdAt:bot.createdAt,updatedAt:bot.updatedAt}});
}
async function api(request,env,url){
  if(request.method==="POST"&&url.pathname==="/api/bots/list")return await botApi(request,env,"list");
  if(request.method==="POST"&&url.pathname==="/api/bots/create")return await botApi(request,env,"create");
  if(request.method==="POST"&&url.pathname==="/api/bots/update")return await botApi(request,env,"update");
  if(request.method==="POST"&&url.pathname==="/api/bots/revoke")return await botApi(request,env,"revoke");
  if(request.method==="POST"&&url.pathname==="/api/system/inbox")return await getSystemInbox(request,env);
  if(request.method==="POST"&&url.pathname==="/api/system/read")return await markSystemInboxRead(request,env);
  if(request.method==="POST"&&url.pathname==="/api/phone/start")return await startPhoneVerification(request,env,url);
  if(request.method==="POST"&&url.pathname==="/api/phone/confirm")return await confirmPhoneVerification(request,env);
  if(request.method==="POST"&&url.pathname==="/api/telegram/webhook")return await telegramPhoneWebhook(request,env);
  if(request.method==="GET"&&url.pathname==="/api/calls/ice")return await callIceConfiguration(request,env);
  if(request.method==="POST"&&url.pathname==="/api/files/upload")return await upload(request,env,url);
  if(request.method==="POST"&&url.pathname==="/api/files/url")return await fileUrl(request,env);
  if(request.method==="POST"&&url.pathname==="/api/files/download")return await downloadFile(request,env);
  if(request.method==="POST"&&url.pathname==="/api/files/delete-message")return await deleteMessageFile(request,env);
  if(request.method==="POST"&&url.pathname==="/api/files/delete-avatar")return await deleteAvatar(request,env);
  return json({error:"API route not found."},404);
}
function corsResponse(request,response){
  const origin=request.headers.get("Origin")||"";
  const allowed=origin==="https://fross-messenger.boberbuset132013.workers.dev"||origin.endsWith(".workers.dev")||origin==="https://localhost"||origin==="capacitor://localhost";
  if(!allowed)return response;
  const headers=new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin",origin);
  headers.set("Access-Control-Allow-Methods","GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers","Authorization, Content-Type");
  headers.set("Access-Control-Max-Age","86400");
  headers.append("Vary","Origin");
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
export default {async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname.startsWith("/api/")&&request.method==="OPTIONS")
    return corsResponse(request,new Response(null,{status:204}));
  if(url.pathname.startsWith("/api/")){try{return corsResponse(request,await api(request,env,url))}catch(error){
    console.error("FROSS private file API:",error?.message||error);const message=String(error?.message||"");
    const status=message.includes("Нужен вход")||message.includes("Сессия")||message.includes("Войди")?401:
      message.includes("Нет доступа")||message.includes("может только")?403:message.includes("Filebase ещё не подключён")?503:500;
    return corsResponse(request,json({error:message||"Ошибка сервера при работе с файлом."},status));
  }}
  if(!env.ASSETS)return new Response("Static assets binding ASSETS is not configured.",{status:503});
  return env.ASSETS.fetch(request);
}};
