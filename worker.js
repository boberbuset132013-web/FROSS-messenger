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
async function api(request,env,url){
  if(request.method==="POST"&&url.pathname==="/api/files/upload")return await upload(request,env,url);
  if(request.method==="POST"&&url.pathname==="/api/files/url")return await fileUrl(request,env);
  if(request.method==="POST"&&url.pathname==="/api/files/delete-message")return await deleteMessageFile(request,env);
  if(request.method==="POST"&&url.pathname==="/api/files/delete-avatar")return await deleteAvatar(request,env);
  return json({error:"API route not found."},404);
}
export default {async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname.startsWith("/api/")){try{return await api(request,env,url)}catch(error){
    console.error("FROSS private file API:",error?.message||error);const message=String(error?.message||"");
    const status=message.includes("Нужен вход")||message.includes("Сессия")||message.includes("Войди")?401:
      message.includes("Нет доступа")||message.includes("может только")?403:message.includes("Filebase ещё не подключён")?503:500;
    return json({error:message||"Ошибка сервера при работе с файлом."},status);
  }}
  if(!env.ASSETS)return new Response("Static assets binding ASSETS is not configured.",{status:503});
  return env.ASSETS.fetch(request);
}};
