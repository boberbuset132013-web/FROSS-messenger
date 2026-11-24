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
  let turnConfigured=false,turnProvider="";
  if(env.FROSS_TURN_KEY_ID&&env.FROSS_TURN_API_TOKEN){
    try{
      const response=await fetch("https://rtc.live.cloudflare.com/v1/turn/keys/"+encodeURIComponent(env.FROSS_TURN_KEY_ID)+"/credentials/generate-ice-servers",{
        method:"POST",
        headers:{"Authorization":"Bearer "+env.FROSS_TURN_API_TOKEN,"Content-Type":"application/json"},
        body:JSON.stringify({ttl:86400})
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(String(result?.error||result?.message||"Cloudflare TURN HTTP "+response.status).slice(0,240));
      const issued=Array.isArray(result.iceServers)?result.iceServers:[];
      for(const server of issued){
        const urls=(Array.isArray(server.urls)?server.urls:[server.urls]).filter(Boolean)
          .filter(url=>!/:53(?:\/|\?|$)/.test(String(url)));
        if(!urls.length)continue;
        if(server.username&&server.credential){
          iceServers.push({urls,username:String(server.username),credential:String(server.credential)});
          turnConfigured=true;turnProvider="cloudflare";
        }else if(urls.some(url=>String(url).startsWith("stun:"))){
          iceServers.push({urls});
        }
      }
    }catch(error){
      console.warn("Cloudflare Realtime TURN credentials unavailable:",error?.message||error);
    }
  }
  if(!turnConfigured){
    const urls=String(env.FROSS_TURN_URLS||"").split(",").map(value=>value.trim()).filter(Boolean)
      .filter(url=>!/:53(?:\/|\?|$)/.test(url));
    const username=String(env.FROSS_TURN_USERNAME||"").trim(),credential=String(env.FROSS_TURN_CREDENTIAL||"");
    if(urls.length&&username&&credential){iceServers.push({urls,username,credential});turnConfigured=true;turnProvider="custom"}
  }
  return json({iceServers,turnConfigured,turnProvider,turnSetupRequired:!turnConfigured});
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
async function firestorePatch(path,token,fields,createIfMissing=false){
  const mask=Object.keys(fields).map(name=>"updateMask.fieldPaths="+encodeURIComponent(name)).join("&");
  const precondition=createIfMissing?"&currentDocument.exists=false":"";
  const response=await fetch(firestoreUrl(path)+"?"+mask+precondition,{method:"PATCH",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({fields})});
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
  if(!/^[a-f0-9]{32}$/.test(challengeId)||!/^d{6}$/.test(code))return json({error:"Проверь ссылку и шестизначный код."},400);
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
  const phoneLink={uid:identity.uid,telegramChatId:String(challenge.chatId||""),telegramUserId:String(challenge.telegramUserId||""),telegramUsername:String(challenge.telegramUsername||""),linkedAt:Date.now()};
  const previousLink=await readPhoneRecord("phoneLinks/"+identity.uid+".json",env);
  if(phoneLink.telegramUserId){
    const existing=await readPhoneRecord("telegramOwners/"+phoneLink.telegramUserId+".json",env);
    if(existing&&existing.uid!==identity.uid)return json({error:"Этот Telegram уже привязан к другому аккаунту FROSS."},409);
  }
  const userPath="users/"+encodeURIComponent(identity.uid),privateDoc=await firestoreGet(userPath,identity.token);
  const phoneVisible=privateDoc?.fields?.phoneVisible?.booleanValue===true;
  await firestorePatch(userPath,identity.token,{
    phoneNumber:{stringValue:challenge.phone},phoneVerified:{booleanValue:true},
    updatedAt:{timestampValue:new Date().toISOString()}
  },!privateDoc);
  await firestorePatch("publicUsers/"+encodeURIComponent(identity.uid),identity.token,{
    phoneStatus:{stringValue:phoneVisible?"visible":"hidden"},
    phonePublic:{stringValue:phoneVisible?challenge.phone:""}
  });
  if(previousLink?.telegramUserId&&previousLink.telegramUserId!==phoneLink.telegramUserId){
    const oldOwner=await readPhoneRecord("telegramOwners/"+previousLink.telegramUserId+".json",env);
    if(oldOwner?.uid===identity.uid)await deletePhoneRecord("telegramOwners/"+previousLink.telegramUserId+".json",env);
  }
  await savePhoneRecord("phoneLinks/"+identity.uid+".json",phoneLink,env);
  if(phoneLink.telegramUserId)await savePhoneRecord("telegramOwners/"+phoneLink.telegramUserId+".json",phoneLink,env);
  await deletePhoneRecord(key,env);
  if(challenge.chatId)await deletePhoneRecord("phoneSessions/"+String(challenge.chatId)+".json",env);
  return json({ok:true,phoneVerified:true,channel:"telegram"});
}
async function telegramPhoneWebhook(request,env,url){
  const {token,secret}=phoneBotConfig(env);
  if(!constantTimeEqual(request.headers.get("X-Telegram-Bot-Api-Secret-Token"),secret))return new Response("",{status:401});
  const update=await request.json().catch(()=>({}));
  // Telegram is used only for confirming the user's phone number in FROSS.
  const message=update.message;
  if(!message?.chat?.id||String(message.chat.type)!=="private")return new Response("ok");
  const chatId=String(message.chat.id),from=message.from||{},telegramUserId=String(from.id||""),text=String(message.text||"");
  const start=text.match(/^\/start(?:@\w+)?\s+([a-f0-9]{32})/i);
  if(start){
    const challengeId=start[1].toLowerCase(),key="phoneChallenges/"+challengeId+".json",challenge=await readPhoneRecord(key,env);
    if(!challenge||challenge.status!=="waiting_start"||challenge.expiresAt<=Date.now()){
      await telegramCall(token,"sendMessage",{chat_id:chatId,text:"Ссылка FROSS истекла. Вернись в настройки и запроси новый код."});return new Response("ok");
    }
    challenge.status="waiting_contact";challenge.chatId=chatId;challenge.telegramUserId=telegramUserId;challenge.telegramUsername=String(from.username||"");
    await savePhoneRecord(key,challenge,env);
    await savePhoneRecord("phoneSessions/"+chatId+".json",{challengeId,telegramUserId,expiresAt:challenge.expiresAt},env);
    await telegramCall(token,"sendMessage",{chat_id:chatId,text:"Чтобы подтвердить номер FROSS, нажми кнопку и отправь именно свой контакт.",reply_markup:{keyboard:[[{text:"Поделиться номером телефона",request_contact:true}]],resize_keyboard:true,one_time_keyboard:true}});
    return new Response("ok");
  }
  if(message.contact){
    const session=await readPhoneRecord("phoneSessions/"+chatId+".json",env);
    if(!session||session.expiresAt<=Date.now())return new Response("ok");
    const key="phoneChallenges/"+session.challengeId+".json",challenge=await readPhoneRecord(key,env);
    if(!challenge||challenge.status!=="waiting_contact"||telegramUserId!==session.telegramUserId)return new Response("ok");
    if(String(message.contact.user_id||"")!==telegramUserId||phoneDigits(message.contact.phone_number)!==phoneDigits(challenge.phone)){
      await telegramCall(token,"sendMessage",{chat_id:chatId,text:"Нужен именно твой собственный контакт с номером, который указан в FROSS.",reply_markup:{remove_keyboard:true}});return new Response("ok");
    }
    const code=challenge.code;
    await telegramCall(token,"sendMessage",{chat_id:chatId,text:"Код подтверждения FROSS: "+code+"\nНикому не пересылай этот код."});
    challenge.code="";challenge.codeHash=await sha256Hex(session.challengeId+":"+code);challenge.status="code_sent";challenge.codeSentAt=Date.now();
    await savePhoneRecord(key,challenge,env);await deletePhoneRecord("phoneSessions/"+chatId+".json",env);
    await telegramCall(token,"sendMessage",{chat_id:chatId,text:"Контакт проверен. Код отправлен. Вернись в FROSS и введи шесть цифр.",reply_markup:{remove_keyboard:true}});
    return new Response("ok");
  }
  if(text==="/start"||text==="/help")await telegramCall(token,"sendMessage",{chat_id:chatId,text:"Я — официальный бот FROSS. Подтверди номер в настройках приложения или открой раздел «Мои боты», чтобы создать своего Telegram-бота."});
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
    id:String(message.id||""),role:message.role==="user"?"user":"assistant",
    sender:message.role==="user"?"Ты":"FROSS",kind:String(message.kind||"notice"),
    model:String(message.model||""),text:String(message.text||"").slice(0,4000),
    createdAt:Number(message.createdAt)||0
  }));
  return json({ok:true,bot:{id:"fross-system",name:"FROSS",verified:true},messages,unreadCount:messages.filter(message=>message.createdAt>(Number(inbox.readAt)||0)).length});
}
const FROSS_AI_MODELS=[
  {id:"openrouter/free",name:"Автовыбор бесплатной модели",provider:"OpenRouter",tools:true},
  {id:"baidu/ernie-5.5-flash-preview:free",name:"ERNIE 5.5 Flash",provider:"Baidu",tools:true},
  {id:"nvidia/nemotron-3.5-super-vl:free",name:"Nemotron 3.5 Super VL",provider:"NVIDIA",tools:true},
  {id:"nvidia/nemotron-3.5-lightning:free",name:"Nemotron 3.5 Lightning",provider:"NVIDIA",tools:true},
  {id:"particle-ai/particle-1:free",name:"Particle-1",provider:"Particle AI",tools:true},
  {id:"dots-studio/dots-3-note-preview:free",name:"Dots3-Note Preview",provider:"Dots Studio",tools:true},
  {id:"inclusionai/ling-3.2-flash:free",name:"Ling 3.2 Flash",provider:"inclusionAI",tools:true}
];
const FROSS_AI_TOOLS=[
  {type:"function",function:{
    name:"list_my_bots",description:"Показать собственных ботов FROSS пользователя: имя, username, описание, приветствие и кнопки.",
    parameters:{type:"object",properties:{},required:[],additionalProperties:false}
  }},
  {type:"function",function:{
    name:"update_my_bot",description:"Изменить профиль и поведение одного из внутренних ботов FROSS. Можно поменять имя, username, описание, приветствие, ответ по умолчанию, включённость и кнопки. Перед изменением найди точный bot id через list_my_bots. Вызывай только когда пользователь явно просит внести изменение.",
    parameters:{
      type:"object",
      properties:{
        id:{type:"string",description:"ID бота из результата list_my_bots"},
        name:{type:"string",description:"Новое имя бота FROSS, до 40 символов"},
        username:{type:"string",description:"Новый уникальный username бота FROSS"},
        description:{type:"string",description:"Новое описание профиля, до 300 символов"},
        enabled:{type:"boolean",description:"Включить или отключить бота"},
        welcomeMessage:{type:"string",description:"Текст при команде /start, до 1000 символов"},
        fallbackMessage:{type:"string",description:"Ответ, если сообщение не совпадает ни с одной кнопкой, до 1000 символов"},
        buttons:{type:"array",description:"Полный список до 12 кнопок FROSS. Каждая кнопка показывает название и задаёт ответ бота; можно добавить ссылку.",items:{type:"object",properties:{label:{type:"string"},response:{type:"string"},url:{type:"string"}},required:["label"],additionalProperties:false}}
      },
      required:["id"],additionalProperties:false
    }
  }}
];
function frossAiSystemPrompt(){
  return "Ты — FROSS, встроенный помощник мессенджера FROSS. Всегда отвечай на русском, дружелюбно и по делу. Пользователь может попросить управлять его внутренними ботами FROSS: эти боты живут внутри приложения, а не в Telegram. Сначала используй list_my_bots, чтобы выбрать правильный ID. Изменять можно имя, username, описание, приветствие, ответ по умолчанию, включённость и кнопки. Не утверждай, что изменение сделано, пока update_my_bot не вернул ok=true. Если пользователь просит создать или изменить кнопки, составь понятные названия и полезные ответы и сохрани список через update_my_bot. Не меняй другие свойства без необходимости. Не запрашивай и не показывай API-токены, секреты, пароли и коды. Инструменты работают только с ботами текущего пользователя. Если пользователь не уточнил, какого бота менять, сначала покажи список и попроси выбрать.";
}
async function openRouterCompletion(env,model,messages){
  if(!env.OPENROUTER_API_KEY)throw new Error("ИИ-модели пока не подключены. Нужен бесплатный API-ключ OpenRouter: создай его на openrouter.ai/settings/keys и добавь в GitHub Secrets под именем OPENROUTER_API_KEY. Ключ не отправляй в чат.");
  const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{
    method:"POST",
    headers:{
      "Authorization":"Bearer "+env.OPENROUTER_API_KEY,
      "Content-Type":"application/json",
      "HTTP-Referer":"https://fross-messenger.boberbuset132013.workers.dev",
      "X-Title":"FROSS Messenger"
    },
    body:JSON.stringify({model,messages,tools:FROSS_AI_TOOLS,tool_choice:"auto",parallel_tool_calls:false,max_tokens:1200})
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error("OpenRouter (HTTP "+response.status+"): "+String(payload?.error?.message||payload?.message||"модель временно недоступна").slice(0,500));
  const message=payload?.choices?.[0]?.message;
  if(!message)throw new Error("ИИ-провайдер не вернул ответ.");
  return message;
}
async function runFrossAiTool(name,args,identity,env,url){
  if(name==="list_my_bots"){
    const store=await readBotStore(identity.uid,env);
    return {ok:true,bots:store.bots.filter(bot=>!bot.botId).map(bot=>({
      id:String(bot.id||bot.botId),name:bot.name||"",username:bot.username||"",
      description:bot.description||"",shortDescription:bot.shortDescription||"",
      welcomeMessage:bot.welcomeMessage||"",fallbackMessage:bot.fallbackMessage||"",
      buttons:Array.isArray(bot.buttons)?bot.buttons:[]
    }))};
  }
  if(name==="update_my_bot"){
    const request=new Request(new URL("/api/bots/update",url.origin).toString(),{
      method:"POST",
      headers:{"Authorization":"Bearer "+identity.token,"Content-Type":"application/json"},
      body:JSON.stringify(args||{})
    });
    const response=await botApi(request,env,url,"update");
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"Не удалось изменить бота.");
    return {ok:true,bot:result.bot};
  }
  throw new Error("Неизвестная команда FROSS.");
}
async function createFrossAssistantReply(identity,env,url,inbox,text,model){
  const messages=[{role:"system",content:frossAiSystemPrompt()}];
  for(const item of inbox.messages.slice(-18)){
    if(item.role==="user"||item.role==="assistant"){
      messages.push({role:item.role,content:String(item.text||"").slice(0,4000)});
    }
  }
  messages.push({role:"user",content:text});
  let assistant=await openRouterCompletion(env,model,messages);
  for(let round=0;round<3&&Array.isArray(assistant.tool_calls)&&assistant.tool_calls.length;round++){
    messages.push(assistant);
    for(const call of assistant.tool_calls.slice(0,2)){
      const name=call.function?.name||"",rawArgs=call.function?.arguments||"{}";
      let args={};
      try{args=JSON.parse(rawArgs)}catch{throw new Error("ИИ прислал некорректные параметры для команды "+name+".")}
      let result;
      try{result=await runFrossAiTool(name,args,identity,env,url)}
      catch(error){result={ok:false,error:String(error?.message||"Команда не выполнена").slice(0,500)}}
      messages.push({role:"tool",tool_call_id:call.id,name,content:JSON.stringify(result)});
    }
    assistant=await openRouterCompletion(env,model,messages);
  }
  const content=String(assistant.content||"").trim();
  return content||"Я выполнил доступное действие. Напиши, что ещё нужно изменить.";
}
async function frossAiModels(request,env){
  const identity=await verifyFirebaseToken(request);
  return json({ok:true,configured:!!env.OPENROUTER_API_KEY,models:FROSS_AI_MODELS});
}
async function frossAiChat(request,env,url){
  const identity=await verifyFirebaseToken(request),body=await request.json().catch(()=>({}));
  const text=String(body.text||"").trim(),model=String(body.model||"openrouter/free");
  if(!text||text.length>2000)return json({error:"Сообщение должно содержать от 1 до 2000 символов."},400);
  if(!FROSS_AI_MODELS.some(item=>item.id===model))return json({error:"Выбрана неизвестная модель FROSS."},400);
  if(!env.OPENROUTER_API_KEY)return json({error:"Модели пока не активированы: добавь бесплатный ключ OpenRouter в GitHub Secrets с именем OPENROUTER_API_KEY. Сам ключ сюда не присылай.",needsApiKey:true},503);
  const key="systemInbox/"+identity.uid+".json";
  let inbox=await readPhoneRecord(key,env);
  if(!inbox)inbox={version:1,uid:identity.uid,createdAt:Date.now(),readAt:0,messages:[]};
  if(inbox.uid!==identity.uid||!Array.isArray(inbox.messages))throw new Error("История чата FROSS не прошла проверку владельца.");
  let reply;
  try{
    reply=await createFrossAssistantReply(identity,env,url,inbox,text,model);
  }catch(error){
    console.error("FROSS AI request failed:",error?.message||error);
    return json({error:String(error?.message||"Не удалось получить ответ FROSS.").slice(0,650)},502);
  }
  inbox.messages.push({id:crypto.randomUUID(),role:"user",sender:"Ты",kind:"chat",text,createdAt:Date.now()});
  inbox.messages.push({id:crypto.randomUUID(),role:"assistant",sender:"FROSS",kind:"chat",model,text:reply.slice(0,4000),createdAt:Date.now()});
  inbox.messages=inbox.messages.slice(-100);
  await savePhoneRecord(key,inbox,env);
  const messages=inbox.messages.slice(-100).map(item=>({
    id:String(item.id||""),role:item.role==="user"?"user":"assistant",
    sender:item.role==="user"?"Ты":"FROSS",kind:String(item.kind||"chat"),
    model:String(item.model||""),text:String(item.text||"").slice(0,4000),createdAt:Number(item.createdAt)||0
  }));
  return json({ok:true,message:messages[messages.length-1],messages,model});
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
  return store&&store.uid===uid&&Array.isArray(store.bots)?store:{version:3,uid,bots:[]};
}
function publicBot(bot){
  const {tokenHash,webhookSecret,ownerUid,...safe}=bot;
  return safe;
}
function cleanBotButtons(value){
  if(!Array.isArray(value))return [];
  return value.slice(0,12).map(item=>({
    label:String(item?.label||"").trim().slice(0,32),
    response:String(item?.response||"").trim().slice(0,1000),
    url:String(item?.url||"").trim().slice(0,500)
  })).filter(item=>item.label&&(item.response||item.url));
}
async function readBotDirectory(env){
  const value=await readPhoneRecord("frossBots/directory.json",env);
  return value&&Array.isArray(value.bots)?value:{version:1,bots:[]};
}
function directoryBot(bot){
  return {id:String(bot.id),name:String(bot.name||"Бот FROSS"),username:String(bot.username||""),
    description:String(bot.description||""),avatarUrl:String(bot.avatarUrl||""),ownerUsername:String(bot.ownerUsername||""),
    enabled:bot.enabled!==false,buttons:cleanBotButtons(bot.buttons),createdAt:Number(bot.createdAt)||0,updatedAt:Number(bot.updatedAt)||0};
}
async function saveBotDirectory(env,directory){
  directory.bots=directory.bots.filter(bot=>bot&&bot.id&&bot.username);
  await savePhoneRecord("frossBots/directory.json",directory,env);
}
async function storeBotPublic(bot,env){
  await savePhoneRecord("frossBots/"+bot.id+".json",{...directoryBot(bot),ownerUid:bot.ownerUid},env);
  const directory=await readBotDirectory(env),index=directory.bots.findIndex(item=>item.id===bot.id),entry=directoryBot(bot);
  if(index>=0)directory.bots[index]=entry;else directory.bots.push(entry);
  await saveBotDirectory(env,directory);
}
async function removeBotPublic(bot,env){
  await deletePhoneRecord("frossBots/"+bot.id+".json",env);
  await deletePhoneRecord("frossBots/by-username/"+bot.username+".json",env);
  const directory=await readBotDirectory(env);directory.bots=directory.bots.filter(item=>item.id!==bot.id);
  await saveBotDirectory(env,directory);
}
async function migrateLegacyFrossBots(identity,env,store){
  const legacy=store.bots.filter(bot=>!bot.botId&&bot.id&&bot.username&&bot.apiVersion!==1);
  if(!legacy.length)return [];
  const profile=await firestoreGet("publicUsers/"+encodeURIComponent(identity.uid),identity.token).catch(()=>null);
  const migratedKeys=[];
  for(const bot of legacy){
    const username=String(bot.username||"").trim().toLowerCase().replace(/^@/,"");
    if(!/^[a-z0-9_]{3,24}$/.test(username))continue;
    const taken=await readPhoneRecord("frossBots/by-username/"+username+".json",env);
    if(taken&&taken.id!==bot.id)continue;
    const raw="FRS_"+Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
    const oldHash=String(bot.tokenHash||"");
    bot.ownerUid=identity.uid;
    bot.ownerUsername=stringField(profile,"username");
    bot.avatarUrl=String(bot.avatarUrl||"");
    bot.welcomeMessage=String(bot.welcomeMessage||("Привет! Я "+String(bot.name||"бот")+". Чем могу помочь?")).slice(0,1000);
    bot.fallbackMessage=String(bot.fallbackMessage||"Я пока не знаю, как ответить. Выбери кнопку ниже.").slice(0,1000);
    bot.buttons=cleanBotButtons(bot.buttons);
    bot.enabled=bot.enabled!==false;
    bot.apiVersion=1;
    bot.tokenHash=await sha256Hex(raw);
    bot.updatedAt=Date.now();
    await savePhoneRecord("botTokens/"+bot.tokenHash+".json",{uid:identity.uid,botId:bot.id,createdAt:Date.now()},env);
    if(oldHash)await deletePhoneRecord("botTokens/"+oldHash+".json",env);
    await savePhoneRecord("frossBots/by-username/"+username+".json",{id:bot.id,uid:identity.uid,createdAt:bot.createdAt||Date.now()},env);
    await storeBotPublic(bot,env);
    migratedKeys.push({id:bot.id,name:bot.name||"Бот FROSS",username,token:raw});
  }
  store.version=3;
  await savePhoneRecord("userBots/"+identity.uid+".json",store,env);
  return migratedKeys;
}
async function createInternalBot(identity,env,body){
  const store=await readBotStore(identity.uid,env),owned=store.bots.filter(bot=>!bot.botId);
  if(owned.length>=20)return json({error:"Можно создать не более 20 ботов FROSS."},409);
  const name=String(body.name||"").trim().slice(0,40),username=String(body.username||"").trim().toLowerCase().replace(/^@/,"");
  const description=String(body.description||"").trim().slice(0,300);
  if(name.length<2)return json({error:"Название должно содержать от 2 до 40 символов."},400);
  if(!/^[a-z0-9_]{3,24}$/.test(username))return json({error:"Username: 3–24 символа, латиница, цифры и _."},400);
  const directory=await readBotDirectory(env);
  if(directory.bots.some(item=>String(item.username).toLowerCase()===username))return json({error:"Этот username бота уже занят в FROSS."},409);
  const id=crypto.randomUUID(),raw="FRS_"+Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
  const ownerProfile=await firestoreGet("publicUsers/"+encodeURIComponent(identity.uid),identity.token).catch(()=>null);
  const bot={id,ownerUid:identity.uid,name,username,description,avatarUrl:"",ownerUsername:stringField(ownerProfile,"username"),
    welcomeMessage:"Привет! Я "+name+". Чем могу помочь?",fallbackMessage:"Я пока не знаю, как ответить. Выбери одну из кнопок ниже.",
    buttons:[],enabled:true,apiVersion:1,tokenHash:await sha256Hex(raw),createdAt:Date.now(),updatedAt:Date.now()};
  store.version=3;store.bots=store.bots.filter(item=>item.botId);store.bots.push(bot);
  await savePhoneRecord("userBots/"+identity.uid+".json",store,env);
  await savePhoneRecord("botTokens/"+bot.tokenHash+".json",{uid:identity.uid,botId:id,createdAt:Date.now()},env);
  await savePhoneRecord("frossBots/by-username/"+username+".json",{id,uid:identity.uid,createdAt:Date.now()},env);
  await storeBotPublic(bot,env);
  return json({ok:true,bot:publicBot(bot),token:raw,warning:"Токен показывается один раз. Скопируй его сейчас."},201);
}
function botResponseFor(bot,text,isFirst){
  const message=String(text||"").trim();
  if(isFirst||/^\/start(?:\s|$)/i.test(message))return {text:bot.welcomeMessage||("Привет! Я "+bot.name+".")};
  const button=(bot.buttons||[]).find(item=>String(item.label||"").toLowerCase()===message.toLowerCase());
  if(button)return {text:button.response||"",url:button.url||""};
  if(/^\/help(?:\s|$)/i.test(message)&&bot.buttons?.length)return {text:"Выбери действие с помощью кнопок ниже."};
  return {text:bot.fallbackMessage||"Я пока не знаю, как ответить."};
}
async function botApi(request,env,url,action){
  const identity=await verifyFirebaseToken(request),store=await readBotStore(identity.uid,env);
  if(action==="list"){
    const migratedKeys=await migrateLegacyFrossBots(identity,env,store);
    return json({ok:true,bots:store.bots.filter(bot=>!bot.botId).map(publicBot),migratedKeys});
  }
  if(action==="directory"){
    const directory=await readBotDirectory(env);
    return json({ok:true,bots:directory.bots.filter(bot=>bot.enabled!==false).slice(-200)});
  }
  const body=await request.json().catch(()=>({}));
  if(action==="create")return createInternalBot(identity,env,body);
  if(action==="chat"){
    const botId=String(body.botId||""),text=String(body.text||"").trim();
    if(!/^[0-9a-f-]{36}$/i.test(botId))return json({error:"Некорректный ID бота."},400);
    if(text.length>1000)return json({error:"Сообщение не должно быть длиннее 1000 символов."},400);
    const bot=await readPhoneRecord("frossBots/"+botId+".json",env);
    if(!bot||bot.enabled===false)return json({error:"Бот не найден или отключён."},404);
    const key="botChats/"+botId+"/"+identity.uid+".json";
    let chat=await readPhoneRecord(key,env);
    if(!chat||chat.botId!==botId||chat.uid!==identity.uid)chat={version:1,botId,uid:identity.uid,messages:[]};
    if(!chat.messages.length&&!text){
      const first=botResponseFor(bot,"",true);
      chat.messages.push({id:crypto.randomUUID(),role:"assistant",text:first.text,url:first.url||"",createdAt:Date.now()});
    }else if(text){
      chat.messages.push({id:crypto.randomUUID(),role:"user",text,createdAt:Date.now()});
      const answer=botResponseFor(bot,text,false);
      chat.messages.push({id:crypto.randomUUID(),role:"assistant",text:answer.text,url:answer.url||"",createdAt:Date.now()});
    }
    chat.messages=chat.messages.slice(-80);await savePhoneRecord(key,chat,env);
    return json({ok:true,bot:{id:bot.id,name:bot.name,username:bot.username,description:bot.description,avatarUrl:bot.avatarUrl,buttons:cleanBotButtons(bot.buttons)},messages:chat.messages});
  }
  const id=String(body.id||""),bot=store.bots.find(item=>item.id===id&&!item.botId);
  if(!bot)return json({error:"Бот FROSS не найден. Старые Telegram-записи не входят в каталог FROSS."},404);
  if(action==="delete"){
    store.bots=store.bots.filter(item=>item.id!==id);
    await savePhoneRecord("userBots/"+identity.uid+".json",store,env);
    await removeBotPublic(bot,env);
    if(bot.tokenHash)await deletePhoneRecord("botTokens/"+bot.tokenHash+".json",env);
    return json({ok:true,deleted:true});
  }
  if(action==="rotate"){
    const oldHash=bot.tokenHash||"",raw="FRS_"+Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
    const newHash=await sha256Hex(raw);bot.tokenHash=newHash;bot.updatedAt=Date.now();
    await savePhoneRecord("userBots/"+identity.uid+".json",store,env);
    if(oldHash)await deletePhoneRecord("botTokens/"+oldHash+".json",env);
    await savePhoneRecord("botTokens/"+newHash+".json",{uid:identity.uid,botId:id,createdAt:Date.now()},env);
    return json({ok:true,token:raw,rotated:true});
  }
  if(action==="update"){
    const name=body.name===undefined?bot.name:String(body.name).trim();
    const username=body.username===undefined?bot.username:String(body.username).trim().toLowerCase().replace(/^@/,"");
    const description=body.description===undefined?bot.description:String(body.description).trim();
    const welcomeMessage=body.welcomeMessage===undefined?bot.welcomeMessage:String(body.welcomeMessage).trim();
    const fallbackMessage=body.fallbackMessage===undefined?bot.fallbackMessage:String(body.fallbackMessage).trim();
    if(name.length<2||name.length>40)return json({error:"Название: от 2 до 40 символов."},400);
    if(!/^[a-z0-9_]{3,24}$/.test(username))return json({error:"Username: 3–24 символа, латиница, цифры и _."},400);
    if(description.length>300)return json({error:"Описание не должно быть длиннее 300 символов."},400);
    if(!welcomeMessage||welcomeMessage.length>1000||!fallbackMessage||fallbackMessage.length>1000)return json({error:"Приветствие и ответ по умолчанию должны содержать 1–1000 символов."},400);
    if(username!==bot.username){
      const taken=await readPhoneRecord("frossBots/by-username/"+username+".json",env);
      if(taken&&taken.id!==id)return json({error:"Этот username бота уже занят в FROSS."},409);
      await deletePhoneRecord("frossBots/by-username/"+bot.username+".json",env);
      await savePhoneRecord("frossBots/by-username/"+username+".json",{id,uid:identity.uid,createdAt:Date.now()},env);
    }
    bot.name=name;bot.username=username;bot.description=description;
    bot.welcomeMessage=welcomeMessage;bot.fallbackMessage=fallbackMessage;
    bot.buttons=cleanBotButtons(body.buttons===undefined?bot.buttons:body.buttons);
    if(body.enabled!==undefined)bot.enabled=body.enabled===true;
    bot.updatedAt=Date.now();
    await savePhoneRecord("userBots/"+identity.uid+".json",store,env);
    await storeBotPublic(bot,env);
    return json({ok:true,bot:publicBot(bot)});
  }
  return json({error:"Неизвестное действие."},400);
}
async function botTokenApi(request,env,action){
  const match=(request.headers.get("Authorization")||"").match(/^Bearer\s+(FRS_[A-Fa-f0-9]{64})$/);
  if(!match)return json({error:"Нужен действующий FROSS Bot API token."},401);
  const tokenHash=await sha256Hex(match[1]),record=await readPhoneRecord("botTokens/"+tokenHash+".json",env);
  if(!record?.uid||!record?.botId)return json({error:"Токен бота неверен или отозван."},401);
  const store=await readBotStore(record.uid,env),bot=store.bots.find(item=>item.id===record.botId&&!item.botId);
  if(!bot||bot.tokenHash!==tokenHash||bot.enabled===false)return json({error:"Бот отключён, удалён или токен отозван."},403);
  if(action==="profile")return json({ok:true,bot:publicBot(bot)});
  const body=await request.json().catch(()=>({})),text=String(body.text||"").trim();
  if(!text||text.length>1000)return json({error:"text должен содержать от 1 до 1000 символов."},400);
  const answer=botResponseFor(bot,text,false);
  return json({ok:true,bot:{id:bot.id,username:bot.username},response:answer.text,url:answer.url||"",buttons:cleanBotButtons(bot.buttons)});
}
async function api(request,env,url){
  if(request.method==="POST"&&url.pathname==="/api/bots/list")return await botApi(request,env,url,"list");
  if(request.method==="POST"&&url.pathname==="/api/bots/directory")return await botApi(request,env,url,"directory");
  if(request.method==="POST"&&url.pathname==="/api/bots/create")return await botApi(request,env,url,"create");
  if(request.method==="POST"&&url.pathname==="/api/bots/update")return await botApi(request,env,url,"update");
  if(request.method==="POST"&&url.pathname==="/api/bots/rotate")return await botApi(request,env,url,"rotate");
  if(request.method==="POST"&&url.pathname==="/api/bots/delete")return await botApi(request,env,url,"delete");
  if(request.method==="POST"&&url.pathname==="/api/bots/chat")return await botApi(request,env,url,"chat");
  if(request.method==="GET"&&url.pathname==="/api/bot/v1/me")return await botTokenApi(request,env,"profile");
  if(request.method==="POST"&&url.pathname==="/api/bot/v1/respond")return await botTokenApi(request,env,"respond");
  if(request.method==="POST"&&url.pathname==="/api/system/models")return await frossAiModels(request,env);
  if(request.method==="POST"&&url.pathname==="/api/system/chat")return await frossAiChat(request,env,url);
  if(request.method==="POST"&&url.pathname==="/api/system/inbox")return await getSystemInbox(request,env);
  if(request.method==="POST"&&url.pathname==="/api/system/read")return await markSystemInboxRead(request,env);
  if(request.method==="POST"&&url.pathname==="/api/phone/start")return await startPhoneVerification(request,env,url);
  if(request.method==="POST"&&url.pathname==="/api/phone/confirm")return await confirmPhoneVerification(request,env);
  if(request.method==="POST"&&url.pathname==="/api/telegram/webhook")return await telegramPhoneWebhook(request,env,url);
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
      message.includes("HTTP 403")||message.includes("Нет доступа")||message.includes("может только")?403:
      message.includes("Filebase ещё не подключён")?503:500;
    return corsResponse(request,json({error:message||"Ошибка сервера при работе с файлом."},status));
  }}
  if(!env.ASSETS)return new Response("Static assets binding ASSETS is not configured.",{status:503});
  return env.ASSETS.fetch(request);
}};
