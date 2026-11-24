import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import { uploadChatFile, createUploadProgress, appendMentionText, appendReadReceipt } from "./chat-features.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, updatePassword, reauthenticateWithCredential, reauthenticateWithPopup,
  EmailAuthProvider, deleteUser, GoogleAuthProvider, signInWithPopup, linkWithCredential,
  sendEmailVerification
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection,
  query, where, orderBy, limit, limitToLast, startAt, endAt, getDocs,
  onSnapshot, runTransaction, writeBatch, serverTimestamp, arrayRemove, arrayUnion
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBflnOcg4btfTRLgFWV1HT47j0fcnC15d4",
  authDomain: "fross-ca5d6.firebaseapp.com",
  projectId: "fross-ca5d6",
  messagingSenderId: "200886619645",
  appId: "1:200886619645:web:0f1bc9b750eedf22a05d94"
};
const FROSS_API_ORIGIN = window.FROSS_NATIVE_APP ? "https://fross-messenger.boberbuset132013.workers.dev" : "";
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const DEF = {theme:"dark",accent:"#b45cff",fs:15,shape:"round",density:"normal",font:"system",enter:true,h24:true,wall:"dots",avatars:true,bgColor:"#080611",panelColor:"#110b1d",textColor:"#f7f0ff",incomingColor:"#21152f",outgoingColor:"#8429c8",profileColor:"#b45cff",notifyDesktop:true,notifySound:true,readReceipts:true,showOnline:true,autoDownload:false,compressImages:true,autoPlayMedia:false,reduceMotion:false};
const ACC = ["#9181ff","#3b82f6","#10b981","#f59e0b","#ef4444","#ec4899","#06b6d4"];
let currentUser=null, me=null, S={...DEF}, cur="", chats=[], found=[];
const SYSTEM_CHAT_ID="system:fross";
let systemInboxMessages=[],systemInboxLoaded=false,systemInboxError="",systemInboxLoading=null,systemInboxTimer=null;
let globalAudioTrackKey="", globalAudioRequest=0, globalAudioAttachment=null, globalAudioRetryUsed=false;
let globalAudioPlayer=null, globalAudioSpeed=1;
const GLOBAL_AUDIO_SPEEDS=[1,1.25,1.5,2];
let stopChats=null, stopMessages=null, presenceTimer=null, searchTimer=null, W=null, creatingAccount=false, bootedUid=null, reactionStops=[];
let chatProfileStops=new Map(),messageProfileStops=new Map();
let chatNotificationStops=new Map(),chatNotificationSeen=new Map(),notificationAudioContext=null;
window.FROSS = {
  get authUser(){return currentUser},get profile(){return me},get chatId(){return cur},
  renderAvatar:(element,profile)=>avatar(element,profile),
  notifyIncomingCall:(profile,callId)=>{
    if(!S.notifyDesktop||!("Notification" in window)||Notification.permission!=="granted")return;
    try{
      const n=new Notification("Входящий звонок",{body:(profile?.displayName||"Пользователь")+" звонит тебе",icon:"/fross-icon.webp",tag:"fross-call-"+callId,requireInteraction:true});
      n.onclick=()=>{window.focus();n.close()};
    }catch(error){console.warn("FROSS call notification:",error)}
  }
};

function authEmail(username) {
  return String(username).trim().toLowerCase() + "@fross-ca5d6.firebaseapp.com";
}
function showLogin() {
  $("auth").style.display="grid"; $("app").style.display="none"; $("auth").scrollTop=0;
  $("ac").innerHTML='<div class="logo">FROSS</div><p class="mut">Вход в мессенджер</p><label>Email (для старых перенесённых аккаунтов — username)</label><input id="lu" type="text" autocomplete="username" maxlength="120" placeholder="name@example.com"><label>Пароль</label><input id="lp" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false"><div class="err" id="le"></div><div class="row"><button class="pr" id="lg">Войти</button><button id="gr">Google</button></div><p style="text-align:center" class="mut">Нет аккаунта? <button class="ic" style="font-size:15px;color:var(--accent)" id="rg">Регистрация</button></p>';
  $("rg").onclick=()=>{W={username:"",email:"",password:"",display_name:"",bio:"",avatar:"",settings:{...DEF}};wiz(1)};
  $("gr").onclick=googleLogin;
  $("lg").onclick=async()=>{try{
    const identifier=$("lu").value.trim();
    if(!identifier)throw Error("Введите email или имя пользователя.");
    const email=identifier.includes("@")?identifier.toLowerCase():authEmail(identifier);
    const password=$("lp").value;
    if(!password)throw Error("Введите пароль. Большие и маленькие буквы учитываются отдельно.");
    const result=await signInWithEmailAndPassword(auth,email,password);
    if(!result.user.emailVerified){const token=await result.user.getIdTokenResult();if(token.claims.legacyAccount!==true){await sendEmailVerification(result.user);await signOut(auth);$("le").textContent="Подтвердите email по ссылке в письме, затем войдите снова.";return}}
  }catch(e){$("le").textContent=authError(e)}};
  $("lp").onkeydown=e=>{if(e.key==="Enter")$("lg").click()};
}

function askGoogleProfile(user) {
  return new Promise(resolve => {
    openM('<h3 style="margin:0">Завершение регистрации</h3><p class="mut">Google подключён. Придумайте уникальный username — по нему вас смогут найти. Никнейм может повторяться.</p><label>Уникальный username</label><input id="gu" maxlength="20" autocomplete="username" placeholder="например, fross_user"><div class="mut" id="gcheck">3–20 символов: латиница, цифры и _</div><label>Никнейм</label><input id="gd" maxlength="40" placeholder="Как вас будут видеть"><div class="err" id="ge"></div><div class="row"><button id="gcancel">Отмена</button><button class="pr" id="gcreate">Продолжить</button></div>');
    let sequence = 0, available = false;
    const check = async () => {
      const name = $("gu").value.trim().toLowerCase(), seq = ++sequence;
      available = false;
      if (!/^[a-z0-9_]{3,20}$/.test(name)) {
        $("gcheck").textContent = "Нужно 3–20 символов: a-z, 0-9 и _.";
        $("gcheck").style.color = "var(--muted)";
        return;
      }
      $("gcheck").textContent = "Проверяем username…";
      try {
        const snap = await getDoc(doc(db,"usernameIndex",name));
        if (seq !== sequence) return;
        available = !snap.exists();
        $("gcheck").textContent = available ? "Это имя свободно." : "Это имя уже занято.";
        $("gcheck").style.color = available ? "#3ddc84" : "var(--danger)";
      } catch (e) {
        if (seq !== sequence) return;
        $("gcheck").textContent = "Не удалось проверить доступность. " + authError(e);
        $("gcheck").style.color = "var(--danger)";
      }
    };
    $("gu").oninput = check;
    $("gu").onblur = check;
    $("gd").value = user.displayName || "";
    $("gcancel").onclick = () => { closeM(); resolve(null); };
    $("gcreate").onclick = async () => {
      const username = $("gu").value.trim().toLowerCase();
      const displayName = $("gd").value.trim().slice(0,40) || user.displayName || username;
      if (!/^[a-z0-9_]{3,20}$/.test(username)) {
        $("ge").textContent = "Username: 3–20 символов, латиница, цифры и _.";
        return;
      }
      try {
        const existing = await getDoc(doc(db,"usernameIndex",username));
        if (existing.exists()) {
          $("ge").textContent = "Это имя уже занято. Выберите другое.";
          available = false;
          return;
        }
        closeM();
        resolve({username,displayName});
      } catch (e) {
        $("ge").textContent = authError(e);
      }
    };
  });
}

async function linkGoogleToExistingAccount(error) {
  const googleCredential = GoogleAuthProvider.credentialFromError(error);
  if (!googleCredential) throw error;
  return new Promise(resolve => {
    openM('<h3 style="margin:0">Аккаунт уже существует</h3><p class="mut">Для этого Google email уже есть аккаунт FROSS. Войдите в него по паролю, чтобы безопасно привязать Google.</p><label>Email существующего аккаунта</label><input id="linkEmail" type="email" autocomplete="username"><label>Пароль FROSS</label><input id="linkPassword" type="password" autocomplete="current-password"><div class="err" id="linkError"></div><div class="row"><button id="linkCancel">Отмена</button><button class="pr" id="linkContinue">Войти и связать</button></div>');
    $("linkCancel").onclick=()=>{closeM();resolve(null)};
    $("linkContinue").onclick=async()=>{
      const email=$("linkEmail").value.trim(),password=$("linkPassword").value;
      if(!email||!password){$("linkError").textContent="Введите email и пароль существующего аккаунта.";return;}
      $("linkContinue").disabled=true;
      try {
        const signed=await signInWithEmailAndPassword(auth,email,password);
        const linked=await linkWithCredential(signed.user,googleCredential);
        closeM();
        resolve(linked.user);
      } catch(linkError) {
        $("linkError").textContent=authError(linkError);
        $("linkContinue").disabled=false;
      }
    };
  });
}

async function googleLogin(){
  try{
    creatingAccount = true;
    const result = await signInWithPopup(auth,new GoogleAuthProvider());
    const user = result.user;
    const profile = await getDoc(doc(db,"publicUsers",user.uid));
    if (!profile.exists()) {
      const details = await askGoogleProfile(user);
      if (!details) {
        creatingAccount = false;
        await signOut(auth);
        return;
      }
      const usernameLower = details.username.toLowerCase();
      await runTransaction(db,async tx => {
        const indexRef = doc(db,"usernameIndex",usernameLower);
        const taken = await tx.get(indexRef);
        if (taken.exists()) throw new Error("username-taken");
        tx.set(indexRef,{uid:user.uid,username:usernameLower,usernameLower,createdAt:serverTimestamp()});
        tx.set(doc(db,"publicUsers",user.uid),{
          username:usernameLower,usernameLower,
          displayName:details.displayName,bio:"",avatarUrl:user.photoURL||"",
          lastSeenAt:serverTimestamp()
        });
        tx.set(doc(db,"users",user.uid),{
          contactEmail:user.email||"",settings:{...DEF},
          createdAt:serverTimestamp(),authProvider:"google"
        });
      });
    }
    creatingAccount = false;
    await boot(user);
  }catch(e){
    if (e?.code === "auth/account-exists-with-different-credential") {
      try {
        const linkedUser = await linkGoogleToExistingAccount(e);
        if (linkedUser) {
          creatingAccount = false;
          await boot(linkedUser);
          return;
        }
      } catch (linkError) {
        if ($("le")) $("le").textContent = authError(linkError);
      }
    }
    creatingAccount = false;
    const message = e?.message === "username-taken"
      ? "Это имя пользователя уже занято. Выберите другое."
      : authError(e);
    await signOut(auth).catch(()=>{});
    if ($("le")) $("le").textContent = message;
  }
}
function authError(e) {
  const code=e?.code||"";
  const map={
    "auth/invalid-credential":"Неверное имя пользователя или пароль.",
    "auth/user-not-found":"Аккаунт не найден.",
    "auth/wrong-password":"Неверный пароль.",
    "auth/email-already-in-use":"Этот email уже зарегистрирован. Войдите в аккаунт или используйте восстановление пароля.",
    "auth/credential-already-in-use":"Этот способ входа уже привязан к другому аккаунту.",
    "auth/phone-number-already-exists":"Этот номер телефона уже привязан к другому аккаунту.",
    "auth/provider-already-linked":"Номер телефона уже привязан к этому аккаунту.",
    "auth/invalid-phone-number":"Введите номер в международном формате, например +447700900123.",
    "auth/captcha-check-failed":"Проверка reCAPTCHA не пройдена. Обновите страницу и попробуйте снова.",
    "auth/invalid-app-credential":"Firebase не принял reCAPTCHA. Проверьте Authorized domains и настройки Phone Authentication.",
    "auth/missing-phone-number":"Введите номер телефона в международном формате.",
    "auth/invalid-verification-code":"Неверный код из SMS. Проверьте цифры и попробуйте снова.",
    "auth/code-expired":"Срок действия SMS-кода истёк. Запросите новый код.",
    "auth/quota-exceeded":"Лимит SMS Firebase исчерпан. Попробуйте позже.",
    "auth/operation-not-allowed":"В Firebase Console включите этот провайдер в Authentication → Sign-in method.",
    "auth/admin-restricted-operation":"Firebase отклонил операцию настройками проекта или правилами провайдера.",
    "auth/weak-password":"Пароль слишком простой (минимум 8 символов).",
    "auth/too-many-requests":"Слишком много попыток. Попробуйте позже.",
    "auth/operation-not-allowed":"В Firebase Console включите нужный способ входа в Authentication → Sign-in method.",
    "auth/unauthorized-domain":"Добавьте домен сайта в Firebase Authentication → Settings → Authorized domains.",
    "auth/popup-blocked":"Разрешите всплывающие окна для входа через Google.",
    "auth/popup-closed-by-user":"Окно Google было закрыто.",
    "auth/account-exists-with-different-credential":"Для этого email уже существует аккаунт с другим способом входа.",
    "permission-denied":"Firestore Rules запретили операцию. Проверьте опубликованные правила Firestore.",
  };
  return map[code] || e?.message || "Неизвестная ошибка FROSS.";
}
function applyS(s) {
  const r=document.documentElement;
  r.dataset.theme=s.theme;
  r.style.setProperty("--accent",s.accent);
  r.style.setProperty("--fs",s.fs+"px");
  r.style.setProperty("--br",s.shape==="round"?"16px":"4px");
  r.style.setProperty("--pad",s.density==="compact"?"5px":"10px");
  r.style.setProperty("--font",s.font==="rounded"?"Trebuchet MS,Arial,sans-serif":s.font==="mono"?"ui-monospace,SFMono-Regular,monospace":s.font==="serif"?"Georgia,serif":s.font==="humanist"?"Verdana,Arial,sans-serif":"Inter,system-ui,sans-serif");
  r.style.setProperty("--bg",s.bgColor||"#0f1015");r.style.setProperty("--panel",s.panelColor||"#16181f");r.style.setProperty("--text",s.textColor||"#f2f3f7");r.style.setProperty("--incoming",s.incomingColor||"#232632");r.style.setProperty("--outgoing",s.outgoingColor||s.accent);r.style.setProperty("--br",s.shape==="pill"?"24px":s.shape==="square"?"5px":"16px");
  if($("msgs"))$("msgs").dataset.w=s.wall;
  r.classList.toggle("reduce-motion",!!s.reduceMotion);
}
function hue(s) {
  let h=0; for(const c of String(s||"#"))h=(h*31+c.charCodeAt(0))%360;
  return "hsl("+h+" 50% 45%)";
}
const privateFileUrlCache = new Map();
async function privateFileApi(endpoint,payload) {
  const user=auth.currentUser||currentUser;if(!user)throw new Error("Войди в аккаунт, чтобы открыть файл.");
  const token=await user.getIdToken(),response=await fetch(FROSS_API_ORIGIN+endpoint,{method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(payload)});
  let data={};try{data=await response.json()}catch{};if(!response.ok)throw new Error(data.error||("Ошибка файлового сервера: "+response.status));return data;
}
async function getPrivateFileUrl(path) {
  const user=auth.currentUser||currentUser;if(!user)throw new Error("Войди в аккаунт, чтобы открыть файл.");
  const key=String(path||"").replace(/^filebase:/,"");if(!key)throw new Error("Путь к файлу отсутствует.");
  const cacheKey=user.uid+":"+key,cached=privateFileUrlCache.get(cacheKey);if(cached&&cached.expires>Date.now())return cached.url;
  const data=await privateFileApi("/api/files/url",{path:key});privateFileUrlCache.set(cacheKey,{url:data.url,expires:Date.now()+4*60*1000});return data.url;
}
async function resolveStoredFileUrl(value,path="") {const source=String(value||"");if(source.startsWith("filebase:"))return await getPrivateFileUrl(path||source.slice(9));return source}
function setPrivateMediaSource(element,value,path="") {
  const source=String(value||"");
  if(source.startsWith("filebase:")){const marker=source;resolveStoredFileUrl(source,path).then(url=>{if(element.isConnected&&element.dataset.fileSource===marker)element.src=url}).catch(error=>console.warn("FROSS private file preview failed:",error.message));element.dataset.fileSource=marker}
  else element.src=source;
}
async function downloadStoredFile(value,path,name) {
  const source=String(value||"");
  if(!source)throw new Error("Ссылка на файл отсутствует.");
  const user=auth.currentUser||currentUser;
  let blob;
  if(source.startsWith("filebase:")){
    if(!user)throw new Error("Войди в аккаунт, чтобы скачать файл.");
    const token=await user.getIdToken();
    const response=await fetch(FROSS_API_ORIGIN+"/api/files/download",{
      method:"POST",
      headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
      body:JSON.stringify({path:path||source.slice(9),name:name||"download"})
    });
    if(!response.ok){
      let data={};try{data=await response.json()}catch{}
      throw new Error(data.error||("Не удалось скачать файл: "+response.status));
    }
    blob=await response.blob();
  }else{
    const response=await fetch(source);
    if(!response.ok)throw new Error("Не удалось скачать файл: "+response.status);
    blob=await response.blob();
  }
  const objectUrl=URL.createObjectURL(blob);
  const link=document.createElement("a");
  link.href=objectUrl;
  link.download=name||"download";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(objectUrl),30000);
}
function openImageViewer(value,path,name) {
  const overlay=document.createElement("div");
  overlay.className="media-viewer";
  overlay.setAttribute("role","dialog");
  overlay.setAttribute("aria-modal","true");
  overlay.setAttribute("aria-label","Просмотр изображения");
  const toolbar=document.createElement("div");toolbar.className="media-viewer-toolbar";
  const title=document.createElement("div");title.className="media-viewer-title";title.textContent=name||"Изображение";
  const actions=document.createElement("div");actions.className="media-viewer-actions";
  const download=document.createElement("button");download.type="button";download.className="media-viewer-btn media-viewer-download";download.textContent="↓ Скачать";
  const closeButton=document.createElement("button");closeButton.type="button";closeButton.className="media-viewer-btn media-viewer-close";closeButton.textContent="×";closeButton.setAttribute("aria-label","Закрыть просмотр");
  const stage=document.createElement("div");stage.className="media-viewer-stage";
  const image=document.createElement("img");image.className="media-viewer-image";image.alt=name||"Изображение";image.draggable=false;
  setPrivateMediaSource(image,value,path);
  actions.append(download,closeButton);toolbar.append(title,actions);stage.append(image);overlay.append(toolbar,stage);
  const oldOverflow=document.body.style.overflow;
  const close=()=>{
    document.removeEventListener("keydown",onKey);
    document.body.style.overflow=oldOverflow;
    overlay.remove();
  };
  const onKey=event=>{if(event.key==="Escape")close()};
  closeButton.addEventListener("click",close);
  overlay.addEventListener("click",event=>{if(event.target===overlay||event.target===stage)close()});
  download.addEventListener("click",async()=>{
    const original=download.textContent;download.disabled=true;download.textContent="Скачиваем…";
    try{await downloadStoredFile(value,path,name||"image")}
    catch(error){alert(error.message)}
    finally{download.disabled=false;download.textContent=original}
  });
  document.addEventListener("keydown",onKey);
  document.body.style.overflow="hidden";
  document.body.append(overlay);
  closeButton.focus();
}
function mediaTime(seconds) {
  if(!Number.isFinite(seconds)||seconds<0)return "0:00";
  const value=Math.floor(seconds),minutes=Math.floor(value/60),remaining=String(value%60).padStart(2,"0");
  return minutes+":"+remaining;
}
function updateGlobalAudioDock() {
  const audio=globalAudioPlayer||$('global-audio');
  if(!audio)return;
  const duration=Number.isFinite(audio.duration)?audio.duration:0;
  const current=Number.isFinite(audio.currentTime)?audio.currentTime:0;
  const seek=$('audio-dock-seek');
  if(seek){seek.value=duration?String(Math.round(current/duration*1000)):"0";seek.disabled=!duration}
  const time=$('audio-dock-time');if(time)time.textContent=mediaTime(current)+" / "+mediaTime(duration);
  const toggle=$('audio-dock-toggle');
  if(toggle){toggle.textContent=audio.paused?"▶":"Ⅱ";toggle.setAttribute("aria-label",audio.paused?"Продолжить":"Пауза")}
  const speed=$('audio-dock-speed');if(speed)speed.textContent=String(globalAudioSpeed).replace(/\.0$/,'')+"×";
  const status=$('audio-dock-status');
  if(status){
    if(audio.error)status.textContent="Не удалось загрузить аудио";
    else if(audio.ended)status.textContent="Воспроизведение завершено";
    else if(audio.paused)status.textContent=globalAudioTrackKey?"На паузе":"Выберите аудио в сообщении";
    else status.textContent="Сейчас воспроизводится · можно перейти в другой чат";
  }
  document.querySelectorAll('.audio-play-button').forEach(button=>{
    const active=button.dataset.audioKey===globalAudioTrackKey;
    button.textContent=active&&!audio.paused?"Ⅱ Пауза":"▶ Слушать";
    const hint=button.closest('.message-audio-player')?.querySelector('.audio-player-hint');
    if(hint)hint.textContent=active?(audio.paused?"На паузе · управление сверху":"Сейчас воспроизводится · управление сверху"):"Управление появится в верхнем плеере";
  });
}

function closeGlobalAudioDock() {
  const audio=globalAudioPlayer||$('global-audio');
  globalAudioRequest++;
  if(audio){audio.pause();audio.removeAttribute('src');audio.load()}
  globalAudioTrackKey="";globalAudioAttachment=null;globalAudioRetryUsed=false;
  const dock=$('audio-dock');if(dock)dock.hidden=true;
  document.body.classList.remove('audio-dock-on');
  updateGlobalAudioDock();
}

function initGlobalAudioDock() {
  globalAudioPlayer=$('global-audio');
  if(!globalAudioPlayer)return;
  const audio=globalAudioPlayer;
  audio.addEventListener('loadedmetadata',updateGlobalAudioDock);
  audio.addEventListener('durationchange',updateGlobalAudioDock);
  audio.addEventListener('timeupdate',updateGlobalAudioDock);
  audio.addEventListener('play',updateGlobalAudioDock);
  audio.addEventListener('pause',updateGlobalAudioDock);
  audio.addEventListener('ended',()=>{audio.currentTime=0;updateGlobalAudioDock()});
  audio.addEventListener('error',async()=>{
    updateGlobalAudioDock();
    const attachment=globalAudioAttachment,request=globalAudioRequest;
    if(globalAudioRetryUsed||!attachment?.url?.startsWith('filebase:'))return;
    globalAudioRetryUsed=true;
    try{
      const user=auth.currentUser||currentUser;
      const key=String(attachment.path||attachment.url.slice(9));
      if(user)privateFileUrlCache.delete(user.uid+":"+key);
      const refreshed=await resolveStoredFileUrl(attachment.url,attachment.path);
      if(request!==globalAudioRequest)return;
      audio.src=refreshed;audio.load();await audio.play();
    }catch(error){
      const status=$('audio-dock-status');if(status)status.textContent=error?.message||"Не удалось открыть аудиофайл";
      updateGlobalAudioDock();
    }
  });
  $('audio-dock-toggle').onclick=async()=>{
    if(!globalAudioTrackKey)return;
    try{if(audio.paused)await audio.play();else audio.pause()}
    catch(error){notify(error?.message||"Не удалось запустить аудио")}
  };
  $('audio-dock-speed').onclick=()=>{
    const i=GLOBAL_AUDIO_SPEEDS.indexOf(globalAudioSpeed);
    globalAudioSpeed=GLOBAL_AUDIO_SPEEDS[(i+1)%GLOBAL_AUDIO_SPEEDS.length];
    audio.playbackRate=globalAudioSpeed;updateGlobalAudioDock();
  };
  $('audio-dock-close').onclick=closeGlobalAudioDock;
  $('audio-dock-seek').addEventListener('input',event=>{
    if(Number.isFinite(audio.duration)&&audio.duration>0){audio.currentTime=Number(event.target.value)/1000*audio.duration;updateGlobalAudioDock()}
  });
  updateGlobalAudioDock();
}

async function startGlobalAudio(attachment) {
  const audio=globalAudioPlayer||$('global-audio');
  if(!audio)throw new Error("Аудиоплеер пока не готов. Обнови страницу.");
  const key=String(attachment.path||attachment.url||attachment.name||"audio");
  const dock=$('audio-dock');if(dock)dock.hidden=false;
  document.body.classList.add('audio-dock-on');
  globalAudioAttachment=attachment;
  const title=$('audio-dock-title');if(title)title.textContent=attachment.name||"Аудиофайл";
  const status=$('audio-dock-status');if(status)status.textContent="Подключаем аудио…";
  if(key!==globalAudioTrackKey){
    globalAudioRequest++;globalAudioTrackKey=key;globalAudioRetryUsed=false;
    audio.pause();audio.removeAttribute('src');audio.load();audio.playbackRate=globalAudioSpeed;
  }
  if(!audio.getAttribute('src')){
    const request=globalAudioRequest;
    const source=await resolveStoredFileUrl(attachment.url,attachment.path);
    if(request!==globalAudioRequest)return;
    audio.src=source;audio.load();
  }
  audio.playbackRate=globalAudioSpeed;
  await audio.play();
  updateGlobalAudioDock();
}

function createAudioMessagePlayer(attachment) {
  const key=String(attachment.path||attachment.url||attachment.name||"audio");
  const player=document.createElement('div');player.className='message-audio-player';
  const top=document.createElement('div');top.className='audio-player-top';
  const button=document.createElement('button');button.type='button';button.className='audio-play-button';button.dataset.audioKey=key;button.textContent='▶ Слушать';
  const meta=document.createElement('div');meta.className='audio-player-meta';
  const name=document.createElement('div');name.className='audio-player-name';name.textContent=attachment.name||'Аудиофайл';
  const hint=document.createElement('div');hint.className='audio-player-hint';hint.textContent='Управление появится в верхнем плеере';
  meta.append(name,hint);top.append(button,meta);player.append(top);
  button.addEventListener('click',async()=>{
    const audio=globalAudioPlayer||$('global-audio');
    if(globalAudioTrackKey===key&&audio&&!audio.paused){audio.pause();return}
    button.disabled=true;
    try{await startGlobalAudio(attachment)}
    catch(error){notify(error?.message||'Не удалось открыть аудио')}
    finally{button.disabled=false;updateGlobalAudioDock()}
  });
  if(globalAudioTrackKey===key)updateGlobalAudioDock();
  return player;
}

initGlobalAudioDock();

function showAvatarFallback(el,name,color) {
  if(!el.isConnected)return;
  el.style.backgroundImage="none";
  el.style.background=color||hue(name);
  el.textContent=String(name||"#")[0].toUpperCase();
}
async function retryAvatarImage(el,source,name,uid,color,retries,error) {
  if(retries<=0) {
    console.warn("FROSS avatar load failed:",error?.message||error||"image unavailable");
    showAvatarFallback(el,name,color);
    return;
  }
  let nextSource=source;
  if(uid) {
    try {
      const profile=await getDoc(doc(db,"publicUsers",uid));
      if(profile.exists()) {
        const current=String(profile.data().avatarUrl||"");
        if(current)nextSource=current;
      }
    } catch(profileError) {
      console.warn("FROSS avatar refresh failed:",profileError?.message||profileError);
    }
  }
  if(nextSource===source&&source.startsWith("filebase:")) {
    const user=auth.currentUser||currentUser;
    if(user)privateFileUrlCache.delete(user.uid+":"+source.slice(9));
  }
  if(!el.isConnected||el.dataset.avatarSource!==source)return;
  el.dataset.avatarSource=nextSource;
  if(!nextSource) {showAvatarFallback(el,name,color);return;}
  loadPrivateAvatar(el,nextSource,name,uid,color,retries-1);
}
async function loadPrivateAvatar(el,source,name,uid,color,retries=1) {
  try {
    const url=await resolveStoredFileUrl(source);
    if(!el.isConnected||el.dataset.avatarSource!==source)return;
    const image=new Image();
    image.onload=()=>{
      if(!el.isConnected||el.dataset.avatarSource!==source)return;
      el.style.backgroundImage='url("'+url+'")';
      el.style.backgroundColor="transparent";
      el.style.backgroundRepeat="no-repeat";
      el.style.backgroundSize="cover";
      el.style.backgroundPosition="center";
      el.textContent="";
    };
    image.onerror=()=>retryAvatarImage(el,source,name,uid,color,retries,new Error("Файл аватара не загрузился."));
    image.src=url;
  } catch(error) {
    await retryAvatarImage(el,source,name,uid,color,retries,error);
  }
}
function avatar(el,o,on) {
  const name=o?.displayName||o?.display_name||o?.username||o?.title||"#";
  const source=o?.avatarUrl||o?.avatar||"";
  const privateSource=typeof source==="string"&&source.startsWith("filebase:");
  el.classList.toggle("on",!!on);
  el.dataset.avatarSource=source;
  el.style.background=source&&!privateSource?"":(o?.profileColor||hue(name));
  el.style.backgroundImage=source&&!privateSource?'url("'+source+'")':"none";
  el.textContent=source&&!privateSource?"":String(name)[0].toUpperCase();
  if(privateSource) {
    const uid=o?.uid||o?.senderUid||(me?.avatarUrl===source?me?.uid:"");
    loadPrivateAvatar(el,source,name,uid,o?.profileColor||"",1);
  }
}
function pickImg(file,cb,onCancel=()=>{}) {
  if(!file || !file.type?.startsWith("image/")) { onCancel(); return; }
  if(file.size > 15*1024*1024) { alert("Изображение больше 15 МБ."); onCancel(); return; }
  const reader=new FileReader();
  reader.onerror=()=>{alert("Не удалось прочитать изображение.");onCancel()};
  reader.onload=()=>{
    const image=new Image();
    image.onerror=()=>{alert("Не удалось открыть изображение.");onCancel()};
    image.onload=()=>{
      let zoom=1,panX=0,panY=0,drag=null;
      const layer=document.createElement("div");
      layer.className="avatar-crop-layer";
      layer.innerHTML='<div class="avatar-crop-card"><div class="avatar-crop-heading"><div><b>Настройка фото</b><small>Передвинь изображение и выбери область для аватара</small></div><button type="button" class="avatar-crop-close" aria-label="Закрыть">×</button></div><div class="avatar-crop-preview" role="img" aria-label="Предпросмотр круглого аватара"></div><label class="avatar-crop-scale">Масштаб <span class="avatar-zoom-value">100%</span></label><input class="avatar-zoom" type="range" min="1" max="3" step=".01" value="1"><div class="avatar-crop-actions"><button type="button" class="avatar-crop-cancel">Отмена</button><button type="button" class="pr avatar-crop-apply">Применить фото</button></div></div>';
      document.body.append(layer);
      const preview=layer.querySelector(".avatar-crop-preview");
      const zoomInput=layer.querySelector(".avatar-zoom");
      const zoomValue=layer.querySelector(".avatar-zoom-value");
      const boxSize=()=>preview.clientWidth||240;
      const drawPreview=()=>{
        const size=boxSize(),base=Math.max(size/image.width,size/image.height),w=image.width*base*zoom,h=image.height*base*zoom;
        preview.style.backgroundImage='url("'+reader.result+'")';
        preview.style.backgroundSize=w+"px "+h+"px";
        preview.style.backgroundPosition="calc(50% + "+panX+"px) calc(50% + "+panY+"px)";
        zoomValue.textContent=Math.round(zoom*100)+"%";
      };
      preview.style.backgroundRepeat="no-repeat";preview.style.touchAction="none";preview.style.cursor="grab";drawPreview();
      zoomInput.oninput=()=>{zoom=Number(zoomInput.value);drawPreview()};
      preview.onpointerdown=e=>{drag={x:e.clientX,y:e.clientY,px:panX,py:panY};preview.setPointerCapture(e.pointerId);preview.style.cursor="grabbing"};
      preview.onpointermove=e=>{
        if(!drag)return;
        panX=drag.px+e.clientX-drag.x;panY=drag.py+e.clientY-drag.y;
        const size=boxSize(),base=Math.max(size/image.width,size/image.height),w=image.width*base*zoom,h=image.height*base*zoom;
        panX=Math.max(-(w-size)/2,Math.min((w-size)/2,panX));panY=Math.max(-(h-size)/2,Math.min((h-size)/2,panY));drawPreview();
      };
      preview.onpointerup=()=>{drag=null;preview.style.cursor="grab"};
      preview.onpointercancel=()=>{drag=null;preview.style.cursor="grab"};
      const cancel=()=>{layer.remove();onCancel()};
      layer.querySelector(".avatar-crop-close").onclick=cancel;
      layer.querySelector(".avatar-crop-cancel").onclick=cancel;
      layer.querySelector(".avatar-crop-apply").onclick=()=>{
        const c=document.createElement("canvas");c.width=c.height=320;
        const scale=Math.max(320/image.width,320/image.height)*zoom,w=image.width*scale,h=image.height*scale,size=boxSize();
        const x=(320-w)/2+panX*(320/size),y=(320-h)/2+panY*(320/size),ctx=c.getContext("2d");
        ctx.save();ctx.beginPath();ctx.arc(160,160,160,0,Math.PI*2);ctx.clip();
        ctx.drawImage(image,0,0,image.width,image.height,x,y,w,h);ctx.restore();
        const result=c.toDataURL("image/jpeg",.9);layer.remove();cb(result);
      };
      layer.addEventListener("pointerdown",e=>{if(e.target===layer)cancel()});
    };
    image.src=reader.result;
  };
  reader.readAsDataURL(file);
}
async function uploadAvatar(uid,dataUrl) {
  if(!dataUrl)return "";if(/^https:\/\//i.test(dataUrl))return dataUrl;
  if(!dataUrl.startsWith("data:image/"))throw new Error("Фото не подготовлено. Сначала нажми «Применить фото».");
  try{
    const blob=await (await fetch(dataUrl)).blob();if(!blob.size)throw new Error("Получилось пустое изображение.");
    const user=auth.currentUser||currentUser;if(!user||user.uid!==uid)throw new Error("Не удалось подтвердить аккаунт для загрузки фото.");
    const token=await user.getIdToken(),result=await new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();xhr.open("POST",FROSS_API_ORIGIN+"/api/files/upload?scope=avatar&name=avatar.jpg");
      xhr.setRequestHeader("Authorization","Bearer "+token);xhr.setRequestHeader("Content-Type",blob.type||"image/jpeg");
      xhr.onload=()=>{let data={};try{data=JSON.parse(xhr.responseText)}catch{};if(xhr.status>=200&&xhr.status<300)resolve(data);else reject(new Error(data.error||("Ошибка загрузки аватара: "+xhr.status)))};
      xhr.onerror=()=>reject(new Error("Сетевая ошибка при загрузке аватара."));xhr.send(blob);
    });
    if(!result.path)throw new Error("Файловый сервер не вернул путь к аватару.");return "filebase:"+result.path;
  }catch(error){console.error("FROSS avatar upload failed:",error);throw new Error("Не удалось загрузить фото: "+(error?.message||authError(error)))}
}
const swatches=(id,selected)=>'<div class="sw" id="'+id+'">'+ACC.map(c=>'<span data-c="'+c+'" style="background:'+c+'" class="'+(c===selected?"s":"")+'"></span>').join("")+'</div>';
function look(o,pre) {
  const color=(key,label)=>'<label>'+label+'</label><input type="color" id="'+pre+key+'" value="'+(o[key]||"#9181ff")+'" style="height:42px;padding:4px">';
  return '<label>Тема приложения</label><select id="'+pre+'th"><option value="dark">Тёмная</option><option value="light">Светлая</option><option value="auto">Как в системе</option></select>'+
  '<label>Акцентный цвет</label>'+swatches(pre+"ac",o.accent)+color("custom","Свой акцент")+color("bgColor","Фон приложения")+color("panelColor","Панели и меню")+color("textColor","Основной текст")+color("incomingColor","Входящие сообщения")+color("outgoingColor","Мои сообщения")+color("profileColor","Публичный цвет профиля")+
  '<label>Размер текста</label><input id="'+pre+'fs" type="range" min="13" max="22" value="'+o.fs+'"><label>Форма сообщений</label><select id="'+pre+'sh"><option value="round">Скруглённые</option><option value="pill">Овальные</option><option value="square">Квадратные</option></select>'+
  '<label>Шрифт</label><select id="'+pre+'font"><option value="system">Современный системный</option><option value="rounded">Мягкий округлый</option><option value="humanist">Чёткий гуманистический</option><option value="serif">С засечками</option><option value="mono">Моноширинный</option></select>'+
  '<label>Плотность</label><select id="'+pre+'density"><option value="comfortable">Просторная</option><option value="normal">Обычная</option><option value="compact">Компактная</option></select><label>Фон переписки</label><select id="'+pre+'wall"><option value="none">Чистый</option><option value="dots">Точки</option><option value="grad">Градиент</option><option value="grid">Сетка</option></select>';
}
function bindLook(o,pre) {
  $(pre+"th").value=o.theme;$(pre+"sh").value=o.shape;$(pre+"font").value=o.font||"system";$(pre+"density").value=o.density||"normal";$(pre+"wall").value=o.wall||"none";
  ["bgColor","panelColor","textColor","incomingColor","outgoingColor","profileColor"].forEach(k=>{$(pre+k).value=o[k]||DEF[k];$(pre+k).oninput=e=>{o[k]=e.target.value;applyS(o)}});
  $(pre+"font").onchange=e=>{o.font=e.target.value;applyS(o)};$(pre+"density").onchange=e=>{o.density=e.target.value;applyS(o)};$(pre+"wall").onchange=e=>{o.wall=e.target.value;applyS(o)};
  $(pre+"custom").oninput=e=>{o.accent=e.target.value;applyS(o)};$(pre+"th").onchange=e=>{o.theme=e.target.value;applyS(o)};$(pre+"sh").onchange=e=>{o.shape=e.target.value;applyS(o)};$(pre+"fs").oninput=e=>{o.fs=+e.target.value;applyS(o)};
  $(pre+"ac").onclick=e=>{const color=e.target.dataset.c;if(!color)return;o.accent=color;applyS(o);[...$(pre+"ac").children].forEach(x=>x.classList.toggle("s",x.dataset.c===color))};
}

/* Four-step registration wizard */
function wiz(n) {
  const bar='<div class="logo">FROSS</div><div class="steps">'+[1,2,3,4].map(i=>'<i class="'+(i<=n?"d":"")+'"></i>').join("")+'</div><b>Шаг '+n+' из 4</b>';
  let h=bar;
  if(n===1)h+='<label>Уникальный username — по нему вас находят</label><input id="u" maxlength="20" autocomplete="username" placeholder="латиница, цифры, _"><div class="mut" id="ua">3–20 символов: латиница, цифры и _</div><label>Email для входа и подтверждения</label><input id="e" type="email" autocomplete="email" required><label>Пароль</label><input id="p" type="password" placeholder="от 8 символов" autocomplete="new-password" autocapitalize="off" spellcheck="false"><div class="meter"><b id="mt"></b></div><small class="mut" id="mt-label">Минимум 8 символов. D, d, 1 и _ разрешены; регистр важен.</small><label>Повторите пароль</label><input id="p2" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false"><small class="mut">На этот адрес придёт письмо со ссылкой подтверждения. После подтверждения можно войти по email и паролю.</small>';
  if(n===2)h+='<div style="display:flex;gap:14px;align-items:center;margin-top:10px"><div class="av big" id="pav"></div><div><button id="up">📷 Загрузить фото</button><input type="file" id="fi" accept="image/*" hidden><br><button class="ic" id="rm" style="font-size:13px">Убрать</button></div></div><label>Никнейм (может повторяться)</label><input id="dn" maxlength="40"><label>О себе</label><textarea id="bio" rows="2" maxlength="160"></textarea>';
  if(n===3)h+='<p class="mut">Оформление можно будет поменять в настройках</p>'+look(W.settings,"w");
  if(n===4)h+='<div class="sum"><div class="av big" id="pav"></div><div><b>'+esc(W.display_name||W.username)+'</b><br><span class="mut">@'+esc(W.username)+(W.email?" · "+esc(W.email):"")+'</span><br><span class="mut">'+esc(W.bio)+'</span></div></div><label style="margin-top:14px"><input type="checkbox" id="tos">Принимаю правила тестовой версии</label>';
  h+='<div class="err" id="we"></div><div class="row"><button id="wb">'+(n===1?"Отмена":"Назад")+'</button><button class="pr" id="wn">'+(n===4?"Создать аккаунт":"Далее")+'</button></div>';
  $("ac").innerHTML=h;
  const error=t=>$("we").textContent=t;
  $("auth").scrollTop=0;
  $("auth").scrollTop=0;
  if(n===1){
    $("u").value=W.username;$("e").value=W.email;$("p").value=W.password;$("p2").value=W.password;
    let checkSequence = 0;
    const checkUsername = async () => {
      const name = $("u").value.trim().toLowerCase(), seq = ++checkSequence;
      $("ua").textContent = "Проверка доступности…";
      $("ua").style.color = "var(--muted)";
      if (!/^[a-z0-9_]{3,20}$/.test(name)) {
        $("ua").textContent = "3–20 символов: латиница, цифры и _.";
        return;
      }
      try {
        const snap = await getDoc(doc(db,"usernameIndex",name));
        if (seq !== checkSequence) return;
        $("ua").textContent = snap.exists() ? "Это имя уже занято." : "Это имя свободно.";
        $("ua").style.color = snap.exists() ? "var(--danger)" : "#3ddc84";
      } catch (e) {
        if (seq !== checkSequence) return;
        $("ua").textContent = "Не удалось проверить: " + authError(e);
        $("ua").style.color = "var(--danger)";
      }
    };
    $("u").oninput = checkUsername;
    $("u").onblur = checkUsername;
    $("p").oninput=e=>{
      const v=e.target.value;
      const variety=[/[a-z]/.test(v),/[A-Z]/.test(v),/[0-9]/.test(v),/[^A-Za-z0-9]/.test(v)].filter(Boolean).length;
      const lengthScore=v.length>=16?3:v.length>=12?2:v.length>=8?1:0;
      const penalty=/(.)\1{3,}/.test(v)?1:0,score=Math.max(0,Math.min(6,lengthScore+variety-penalty));
      const label=v.length<8?"Минимум 8 символов":score<=2?"Слабый пароль":score<=4?"Нормальный пароль":"Сильный пароль";
      $("mt").style.width=Math.round(score/6*100)+"%";
      $("mt").style.background=v.length<8||score<=2?"#ff6b6b":score<=4?"#f59e0b":"#3ddc84";
      $("mt").title=label;
      if($("mt-label"))$("mt-label").textContent=label+" · D, d, 1 и _ разрешены";
    };
  }
  if(n===2){
    $("dn").value=W.display_name; $("bio").value=W.bio; avatar($("pav"),{displayName:W.display_name||W.username,avatarUrl:W.avatar});
    $("up").onclick=()=>$("fi").click();
    $("fi").onchange=e=>e.target.files[0]&&pickImg(e.target.files[0],d=>{W.avatar=d;avatar($("pav"),{displayName:W.display_name||W.username,avatarUrl:d})});
    $("rm").onclick=()=>{W.avatar="";avatar($("pav"),{displayName:W.username})};
  }
  if(n===3)bindLook(W.settings,"w");
  if(n===4)avatar($("pav"),{displayName:W.display_name||W.username,avatarUrl:W.avatar});
  $("wb").onclick=()=>{
    if(n===2){W.display_name=$("dn").value.trim();W.bio=$("bio").value.trim();}
    if(n===1)showLogin();else wiz(n-1);
  };
  $("wn").onclick=async()=>{
    if(n===1){
      const u=$("u").value.trim().toLowerCase(),p=$("p").value,e=$("e").value.trim();
      if(!/^[a-z0-9_]{3,20}$/.test(u))return error("Имя: 3–20 символов, латиница, цифры и _.");
      if(!/^\S+@\S+\.\S+$/.test(e))return error("Укажите действующий email для подтверждения.");
      if(p.length<8)return error("Пароль: минимум 8 символов.");
      if(p!==$("p2").value)return error("Пароли не совпадают.");
      try { const taken = await getDoc(doc(db,"usernameIndex",u)); if(taken.exists())return error("Это имя пользователя уже занято. Выберите другое."); } catch(e) { return error("Не удалось проверить username: "+authError(e)); }
      Object.assign(W,{username:u,email:e,password:p});return wiz(2);
    }
    if(n===2){W.display_name=$("dn").value.trim();W.bio=$("bio").value.trim();return wiz(3);}
    if(n===3)return wiz(4);
    if(!$("tos").checked)return error("Нужно принять правила тестовой версии.");
    let credential=null,avatarUrl="";
    try {
      creatingAccount=true;
      credential=await createUserWithEmailAndPassword(auth,W.email,W.password);
      const uid=credential.user.uid;
      await sendEmailVerification(credential.user);
      avatarUrl=await uploadAvatar(uid,W.avatar);
      const usernameLower=W.username.toLowerCase();
      await runTransaction(db,async tx=>{
        const usernameRef=doc(db,"usernameIndex",usernameLower);
        const existing=await tx.get(usernameRef);
        if(existing.exists())throw new Error("Это имя пользователя уже занято.");
        tx.set(usernameRef,{uid,username:W.username,usernameLower,createdAt:serverTimestamp()});
        tx.set(doc(db,"publicUsers",uid),{
          username:W.username,usernameLower,displayName:W.display_name||W.username,
          bio:W.bio||"",avatarUrl,lastSeenAt:serverTimestamp()
        });
        tx.set(doc(db,"users",uid),{
          contactEmail:W.email,settings:W.settings,createdAt:serverTimestamp(),authProvider:"password"
        });
      });
      creatingAccount=false;
      await signOut(auth);
      showLogin();
      $("le").textContent="Аккаунт создан. Откройте письмо от Firebase и подтвердите email, затем войдите.";
    } catch(e) {
      creatingAccount=false;
      if(credential?.user)try{await deleteUser(credential.user)}catch{}
      error(authError(e));
    }
  };
}

/* Chat list and people search */
function isOnline(u) {
  const value=u?.lastSeenAt;
  const millis=value?.toMillis?value.toMillis():0;
  return millis>0&&Date.now()-millis<60000;
}
function presenceLabel(profile){
  const value=profile?.lastSeenAt,millis=value?.toMillis?value.toMillis():(value instanceof Date?value.getTime():0);
  if(!millis)return "Не в сети";
  const age=Math.max(0,Date.now()-millis);
  if(age<60000)return "В сети";
  if(age<24*60*60*1000)return "Был(а) недавно";
  const date=new Date(millis);
  return "Был(а) "+date.toLocaleDateString("ru-RU",{day:"2-digit",month:"2-digit"})+" в "+date.toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"});
}
function chatInfo(c) {
  if(c.type==="dm"){
    const other=(c.memberProfiles||[]).find(m=>m.uid!==me.uid)||{};
    if(other.deleted)return{title:"Аккаунт удалён",avatar:{...other,displayName:"Аккаунт удалён"},sub:"Пользователь удалил аккаунт"};
    return{title:other.displayName||other.username||"Личный чат",avatar:other,sub:isOnline(other)?"В сети":presenceLabel(other)};
  }
  return{title:c.title||"Группа",avatar:{title:c.title||"G"},sub:(c.memberUids||[]).length+" участн."};
}
function item(o,title,sub,online,active,fn) {
  const d=document.createElement("div");d.className="it"+(active?" a":"");
  d.innerHTML='<div class="av"></div><div class="t"><b>'+esc(title)+'</b><small>'+esc(sub||"")+'</small></div>';
  avatar(d.firstChild,o,online);d.onclick=fn;return d;
}
function playNotificationBeep(){
  if(!S.notifySound)return;
  try{
    const AudioContextClass=window.AudioContext||window.webkitAudioContext;
    if(!AudioContextClass)return;
    notificationAudioContext ||= new AudioContextClass();
    if(notificationAudioContext.state==="suspended")notificationAudioContext.resume().catch(()=>{});
    const oscillator=notificationAudioContext.createOscillator(),gain=notificationAudioContext.createGain();
    oscillator.type="sine";oscillator.frequency.value=740;gain.gain.value=.025;
    oscillator.connect(gain);gain.connect(notificationAudioContext.destination);
    const now=notificationAudioContext.currentTime;oscillator.start(now);
    gain.gain.setTargetAtTime(0,now+.08,.04);oscillator.stop(now+.3);
  }catch(error){console.warn("FROSS notification sound:",error?.message||error)}
}
function notifyAppEvent(title,body,tag,chatId){
  if(!S.notifyDesktop&&!S.notifySound)return;
  if(S.notifyDesktop&&"Notification" in window&&Notification.permission==="granted"){
    try{
      const n=new Notification(title,{body,icon:"/fross-icon.webp",tag,renotify:true});
      n.onclick=()=>{window.focus();if(chatId)openChat(chatId);n.close()};
    }catch(error){console.warn("FROSS notification:",error)}
  }
  playNotificationBeep();
}
function clearChatNotificationObservers(){
  for(const stop of chatNotificationStops.values()){try{stop()}catch{}}
  chatNotificationStops.clear();chatNotificationSeen.clear();
}
function syncChatNotificationObservers(){
  const wanted=new Set(chats.map(chat=>chat.id));
  for(const [id,stop] of chatNotificationStops){
    if(!wanted.has(id)){try{stop()}catch{}chatNotificationStops.delete(id);chatNotificationSeen.delete(id)}
  }
  for(const chat of chats){
    if(chatNotificationStops.has(chat.id))continue;
    const latestQuery=query(collection(db,"chats",chat.id,"messages"),orderBy("createdAt","desc"),limit(1));
    const stop=onSnapshot(latestQuery,snapshot=>{
      const latest=snapshot.docs[0];if(!latest)return;
      const message={id:latest.id,...latest.data()};
      const previous=chatNotificationSeen.get(chat.id);chatNotificationSeen.set(chat.id,message.id);
      if(previous===undefined||previous===message.id||message.senderUid===me.uid||cur===chat.id)return;
      if((me.mutedChats||[]).includes(chat.id))return;
      const sender=(chat.memberProfiles||[]).find(person=>person.uid===message.senderUid);
      const name=sender?.displayName||message.displayName||"Пользователь";
      const preview=message.attachment?(message.attachment.type?.startsWith("image/")?"Фото":message.attachment.type?.startsWith("audio/")?"Аудио":"Файл"):(message.text||"Новое сообщение").slice(0,100);
      notifyAppEvent("FROSS · "+(chat.title||name),name+": "+preview,"fross-message-"+chat.id,chat.id);
    },error=>console.warn("FROSS notification listener:",error?.message||error));
    chatNotificationStops.set(chat.id,stop);
  }
}
function clearProfileObservers(map){
  for(const stop of map.values()){try{stop()}catch{}}
  map.clear();
}
function syncChatProfileObservers(){
  const wanted=new Set();
  chats.forEach(chat=>(chat.memberProfiles||[]).forEach(person=>{if(person.uid&&person.uid!==me.uid)wanted.add(person.uid)}));
  for(const [uid,stop] of chatProfileStops){
    if(!wanted.has(uid)){try{stop()}catch{}chatProfileStops.delete(uid)}
  }
  for(const uid of wanted){
    if(chatProfileStops.has(uid))continue;
    const stop=onSnapshot(doc(db,"publicUsers",uid),snapshot=>{
      if(!snapshot.exists())return;
      const profile={uid,...snapshot.data()};
      chats.forEach(chat=>{
        chat.memberProfiles=(chat.memberProfiles||[]).map(person=>person.uid===uid?{...person,...profile}:person);
      });
      renderList();if(cur)head();
    },error=>console.warn("FROSS chat profile listener:",error?.message||error));
    chatProfileStops.set(uid,stop);
  }
}
function watchMessageProfile(uid,box){
  if(!uid||messageProfileStops.has(uid))return;
  const stop=onSnapshot(doc(db,"publicUsers",uid),snapshot=>{
    if(!snapshot.exists())return;
    const profile={uid,...snapshot.data()};
    box.querySelectorAll(".mr").forEach(row=>{
      if(row.dataset.senderUid!==uid)return;
      const avatarElement=row.querySelector(".message-avatar");
      if(avatarElement)avatar(avatarElement,profile);
      const senderName=row.querySelector(".sender-profile");
      if(senderName)senderName.textContent=profile.displayName||profile.username||"Пользователь";
    });
  },error=>console.warn("FROSS message profile listener:",error?.message||error));
  messageProfileStops.set(uid,stop);
}

async function loadSystemInbox(){
  if(systemInboxLoading)return systemInboxLoading;
  systemInboxLoading=(async()=>{
    try{
      const user=auth.currentUser||currentUser;if(!user)throw new Error("Войди в аккаунт FROSS.");
      const response=await fetch(FROSS_API_ORIGIN+"/api/system/inbox",{method:"POST",headers:{"Authorization":"Bearer "+await user.getIdToken(),"Content-Type":"application/json"},body:"{}"});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||("Ошибка системного чата: "+response.status));
      systemInboxMessages=Array.isArray(data.messages)?data.messages:[];
      systemInboxLoaded=true;systemInboxError="";
      if(cur===SYSTEM_CHAT_ID)renderSystemMessages();
    }catch(error){
      systemInboxError=error?.message||"Не удалось загрузить системный чат.";
      console.warn("FROSS system inbox:",systemInboxError);
    }finally{
      systemInboxLoading=null;
    }
  })();
  return systemInboxLoading;
}
async function markSystemInboxRead(){
  try{
    const user=auth.currentUser||currentUser;if(!user)return;
    await fetch(FROSS_API_ORIGIN+"/api/system/read",{method:"POST",headers:{"Authorization":"Bearer "+await user.getIdToken(),"Content-Type":"application/json"},body:"{}"});
  }catch(error){console.warn("FROSS system read receipt:",error?.message||error)}
}
function renderSystemMessages(){
  const box=$("msgs");if(cur!==SYSTEM_CHAT_ID)return;
  box.innerHTML="";
  if(!systemInboxLoaded){
    const empty=document.createElement("div");empty.className="empty";empty.textContent=systemInboxError||"Загрузка сообщений FROSS…";box.append(empty);return;
  }
  if(!systemInboxMessages.length){
    const empty=document.createElement("div");empty.className="empty";empty.textContent="Пока нет уведомлений от FROSS.";box.append(empty);return;
  }
  for(const message of systemInboxMessages){
    const row=document.createElement("div");row.className="mr system-message";row.dataset.messageId=message.id;
    const bubble=document.createElement("div");bubble.className="msg";
    const sender=document.createElement("small");sender.className="system-message-sender";sender.textContent="FROSS · официальный бот";bubble.append(sender);
    const body=document.createElement("div");body.textContent=message.text;bubble.append(body);
    const time=document.createElement("time");time.textContent=new Date(message.createdAt||Date.now()).toLocaleString("ru-RU",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});bubble.append(time);
    row.append(bubble);box.append(row);
  }
  box.scrollTop=box.scrollHeight;
  markSystemInboxRead();
}

function renderList() {
  const L=$("list"),term=$("q").value.trim().toLowerCase();L.innerHTML="";
  let count=0;
  const systemMatches=!term||"fross официальный системный бот уведомления".includes(term);
  if(systemMatches){
    const latest=systemInboxMessages[systemInboxMessages.length-1];
    const preview=latest?.text||systemInboxError||(systemInboxLoaded?"Официальный системный чат":"Загрузка уведомлений…");
    const row=item({displayName:"FROSS",username:"FROSS",profileColor:"#a855f7"},"FROSS",preview,false,cur===SYSTEM_CHAT_ID,()=>openChat(SYSTEM_CHAT_ID));
    row.classList.add("system-chat-item");
    const title=row.querySelector(".t b");if(title)title.innerHTML='FROSS <span class="verified-mark" title="Официальный системный бот">✓</span>';
    L.append(row);count++;
  }
  for(const c of chats){
    const info=chatInfo(c);
    if(term&&!info.title.toLowerCase().includes(term))continue;
    let preview=String(c.lastMessage||"").trim();
    if(preview){
      const senderUid=c.lastSenderUid||"";
      const senderProfile=(c.memberProfiles||[]).find(person=>person.uid===senderUid);
      const senderName=senderUid===me.uid?"ВЫ":(c.lastSenderName||senderProfile?.displayName||"");
      if(senderName)preview=senderName+": "+preview;
    }
    count++;L.append(item(info.avatar,info.title,preview||info.sub,isOnline(info.avatar),c.id===cur,()=>openChat(c.id)));
  }
  if(term&&found.length){
    const h=document.createElement("div");h.className="h";h.textContent="Люди";L.append(h);
    found.forEach(user=>L.append(item(user,user.displayName||user.username,presenceLabel(user),isOnline(user),false,()=>openUserProfile(user))));
  }
  if(!count&&!found.length)L.innerHTML='<div class="empty" style="padding:20px">'+(term?"Ничего не найдено":"Пока нет личных чатов. Нажмите «Создать», чтобы начать переписку.")+'</div>';
}
let stopSearch=null;
async function findPublicProfiles(term,maxResults=20){
  const normalized=String(term||"").trim().toLowerCase().replace(/^@/,"");
  if(normalized.length<2)return [];
  const matches=new Map();
  const add=docs=>docs.forEach(snapshot=>{
    if(!snapshot.exists())return;
    const data=snapshot.data();
    if(data.deleted===true||snapshot.id===me.uid)return;
    const name=String(data.usernameLower||data.username||"").toLowerCase();
    if(name.startsWith(normalized))matches.set(snapshot.id,{uid:snapshot.id,...data});
  });
  const safeQuery=async queryRef=>{
    try{const result=await getDocs(queryRef);add(result.docs)}
    catch(error){console.warn("FROSS profile search fallback:",error?.code||error?.message||error)}
  };
  const profiles=collection(db,"publicUsers");
  await safeQuery(query(profiles,orderBy("usernameLower"),startAt(normalized),endAt(normalized+"\uf8ff"),limit(maxResults)));
  if(matches.size<maxResults)
    await safeQuery(query(profiles,orderBy("username"),startAt(normalized),endAt(normalized+"\uf8ff"),limit(maxResults)));
  if(matches.size<maxResults){
    try{const scan=await getDocs(query(profiles,limit(1000)));add(scan.docs)}
    catch(error){console.warn("FROSS compatibility profile scan failed:",error?.code||error?.message||error)}
  }
  return [...matches.values()].sort((a,b)=>String(a.username||"").localeCompare(String(b.username||""),"en")).slice(0,maxResults);
}
async function findPublicProfileByUsername(value){
  const username=String(value||"").trim().toLowerCase().replace(/^@/,"");
  if(!/^[a-z0-9_]{3,20}$/.test(username))throw new Error("Введи username из 3–20 символов: латиница, цифры или _.");
  try{
    const index=await getDoc(doc(db,"usernameIndex",username));
    if(index.exists()&&index.data().uid){
      try{
        const profile=await loadChatProfile(index.data().uid);
        if(profile&&!profile.deleted)return profile;
      }catch(error){console.warn("FROSS username index points to an unavailable profile:",error?.message||error)}
    }
  }catch(error){console.warn("FROSS username index lookup failed:",error?.code||error?.message||error)}
  const exact=new Map();
  const exactQuery=async field=>{
    try{
      const result=await getDocs(query(collection(db,"publicUsers"),where(field,"==",username),limit(5)));
      result.docs.forEach(snapshot=>{
        const data=snapshot.data();
        if(data.deleted!==true)exact.set(snapshot.id,{uid:snapshot.id,...data});
      });
    }catch(error){console.warn("FROSS exact username fallback:",error?.code||error?.message||error)}
  };
  await exactQuery("usernameLower");
  if(!exact.size)await exactQuery("username");
  if(!exact.size){
    const candidates=await findPublicProfiles(username,1000);
    candidates.filter(profile=>String(profile.usernameLower||profile.username||"").toLowerCase()===username)
      .forEach(profile=>exact.set(profile.uid,profile));
  }
  const profile=exact.values().next().value;
  if(!profile)throw new Error("Пользователь с таким username не найден. Проверь написание без пробелов.");
  return profile;
}

async function searchUsers(term) {
  const value=term.trim().toLowerCase().replace(/^@/,"");
  if(value.length<2){found=[];renderList();return}
  try{found=await findPublicProfiles(value,20);renderList()}
  catch(error){console.error("FROSS user search failed:",error);found=[];renderList()}
}
function startChatList() {
  loadSystemInbox().then(()=>renderList());
  if(systemInboxTimer)clearInterval(systemInboxTimer);
  systemInboxTimer=setInterval(()=>{if(cur===SYSTEM_CHAT_ID)loadSystemInbox()},20000);
  if(stopChats)stopChats();
  chats=[];clearProfileObservers(chatProfileStops);renderList();head();
  const sortChats=items=>items.sort((a,b)=>{
    const at=a.updatedAt?.toMillis?.()||a.lastMessageAt?.toMillis?.()||0;
    const bt=b.updatedAt?.toMillis?.()||b.lastMessageAt?.toMillis?.()||0;
    return bt-at;
  });
  const q=query(collection(db,"chats"),where("memberUids","array-contains",me.uid),limit(100));
  stopChats=onSnapshot(q,snapshot=>{
    chats=sortChats(snapshot.docs.map(d=>({id:d.id,...d.data()})));
    syncChatProfileObservers();syncChatNotificationObservers();renderList();head();
  },async error=>{
    console.error("Chat list listener:",error);
    try{
      const snapshot=await getDocs(q);
      chats=sortChats(snapshot.docs.map(d=>({id:d.id,...d.data()})));
      syncChatProfileObservers();syncChatNotificationObservers();renderList();head();
    }catch(fallbackError){
      console.error("Chat list fallback:",fallbackError);
      $("list").innerHTML='<div class="empty" style="padding:20px">Не удалось загрузить чаты. Проверьте подключение и попробуйте снова.</div>';
    }
  });
}
function head() {
  const avatarElement=$("hav"),titleElement=$("ht"),subtitleElement=$("hs");
  if(cur===SYSTEM_CHAT_ID){
    avatar(avatarElement,{displayName:"FROSS",profileColor:"#a855f7"});
    titleElement.innerHTML='FROSS <span class="verified-mark" title="Официальный системный бот">✓</span>';
    subtitleElement.textContent="Официальный системный бот · уведомления аккаунта";
    avatarElement.onclick=null;titleElement.onclick=null;avatarElement.style.cursor="default";titleElement.style.cursor="default";
    if($("call"))$("call").style.display="none";
    return;
  }
  const chat=chats.find(item=>item.id===cur);
  if(!chat){
    avatarElement.style.backgroundImage="none";avatarElement.textContent="";avatarElement.style.background="transparent";
    titleElement.textContent="Выберите чат";subtitleElement.textContent="Личные переписки и группы";
    avatarElement.onclick=null;titleElement.onclick=null;avatarElement.style.cursor="default";titleElement.style.cursor="default";
    if($("call"))$("call").style.display="none";
    return;
  }
  const info=chatInfo(chat);avatar(avatarElement,info.avatar,isOnline(info.avatar));
  titleElement.textContent=info.title;subtitleElement.textContent=info.sub;
  const other=chat.type==="dm"?(chat.memberProfiles||[]).find(person=>person.uid!==me.uid):null;
  const openProfile=()=>{if(other?.uid)openUserProfile(other.uid)};
  avatarElement.onclick=openProfile;titleElement.onclick=openProfile;
  avatarElement.style.cursor=other?.uid?"pointer":"default";titleElement.style.cursor=other?.uid?"pointer":"default";
  avatarElement.title=other?.uid?"Открыть профиль":"";
  if($("call"))$("call").style.display=chat.type==="dm"?"block":"none";
}
function openChat(id) {
  if(id===SYSTEM_CHAT_ID){
    cur=SYSTEM_CHAT_ID;document.body.classList.add("ch");renderList();head();
    const composer=document.querySelector(".comp");if(composer)composer.style.display="none";
    subscribeMessages();loadSystemInbox();return;
  }
  const chat=chats.find(item=>item.id===id);if(!chat)return;
  const composer=document.querySelector(".comp");if(composer)composer.style.display="flex";
  cur=id;document.body.classList.add("ch");renderList();head();subscribeMessages();
  if(chat.type==="dm"){
    const other=(chat.memberProfiles||[]).find(person=>person.uid!==me.uid);
    if(other?.uid)loadChatProfile(other.uid).then(profile=>{Object.assign(other,profile);renderList();head()}).catch(()=>{});
  }
}
const MESSAGE_EMOJIS=["❤️","😂","👍","🔥","😮","😢","🙏","🎉","💯","👀","😍","🥰","😘","🤔","👏","🙌","🤝","💔","😭","😎","🥳","🤩","🤗","😡","🤯","💀","✨","🚀","☕","💖"];
function openMessageMenu(message,mine,x,y) {
  document.getElementById("message-menu")?.remove();
  const menu=document.createElement("div");menu.id="message-menu";menu.className="message-menu";
  const actions=[["↩ Ответить",()=>{setReplyTarget(message);menu.remove()}],["😊 Реакция",()=>showReactionPicker(message,menu)],["📋 Копировать",()=>{navigator.clipboard?.writeText(message.text||message.attachment?.name||"").catch(()=>{});menu.remove()}]];
  if(mine&&message.text)actions.push(["✏️ Изменить",()=>editMessage(message)]);
  actions.push(["🗑 Удалить у себя",()=>hideMessageForMe(message)]);
  if(mine)actions.push(["🗑 Удалить у всех",()=>deleteMessageForAll(message)]);
  for(const item of actions){const b=document.createElement("button");b.type="button";b.textContent=item[0];b.onclick=item[1];menu.append(b)}
  document.body.append(menu);
  const left=Math.max(8,Math.min(x,innerWidth-menu.offsetWidth-8));
  const top=Math.max(8,Math.min(y,innerHeight-menu.offsetHeight-8));
  menu.style.left=left+"px";menu.style.top=top+"px";
  const close=e=>{if(!menu.contains(e.target)){menu.remove();document.removeEventListener("pointerdown",close)}};
  setTimeout(()=>document.addEventListener("pointerdown",close),0);
}
function showReactionPicker(message,menu) {
  menu.querySelector(".reaction-picker")?.remove();
  const previous=menu.getBoundingClientRect();
  const picker=document.createElement("div");picker.className="reaction-picker";
  const title=document.createElement("span");title.className="reaction-picker-title";title.textContent="Реакции";
  const rail=document.createElement("div");rail.className="reaction-picker-scroll";rail.setAttribute("aria-label","Листайте эмодзи влево и вправо");
  MESSAGE_EMOJIS.forEach(emoji=>{
    const b=document.createElement("button");b.type="button";b.className="reaction-choice";b.textContent=emoji;b.setAttribute("aria-label","Поставить реакцию "+emoji);
    b.onclick=async()=>{
      try{
        const ownRef=doc(db,"chats",cur,"messages",message.id,"reactions",me.uid);
        const own=await getDoc(ownRef);
        if(own.exists()&&own.data().emoji===emoji)await deleteDoc(ownRef);
        else await setDoc(ownRef,{uid:me.uid,emoji,updatedAt:serverTimestamp()});
        menu.remove();
      }catch(e){console.error("FROSS reaction failed:",e);alert(authError(e))}
    };
    rail.append(b);
  });
  picker.append(title,rail);menu.prepend(picker);
  const newHeight=menu.offsetHeight;
  menu.style.top=Math.max(8,Math.min(previous.bottom-newHeight,innerHeight-newHeight-8))+"px";
}
async function editMessage(message) {
  const value=prompt("Изменить сообщение:",message.text||"");if(value===null)return;
  const text=value.trim();if(!text||text.length>4000)return alert("Сообщение должно содержать от 1 до 4000 символов.");
  try{await updateDoc(doc(db,"chats",cur,"messages",message.id),{text,editedAt:serverTimestamp()})}catch(e){alert(authError(e))}
}
async function hideMessageForMe(message) {
  try{await updateDoc(doc(db,"chats",cur,"messages",message.id),{hiddenFor:arrayUnion(me.uid)})}catch(e){alert(authError(e))}
}
function messagePreview(message){
  if(!message)return "";
  if(message.attachment){
    const type=String(message.attachment.type||"");
    if(type.startsWith("image/"))return "фото";
    if(type.startsWith("video/"))return "видео";
    if(type.startsWith("audio/"))return "аудио";
    return "файл";
  }
  return String(message.text||"").slice(0,120);
}
async function refreshChatPreviewAfterDelete(chatId,deletedMessage){
  const latest=await getDocs(query(collection(db,"chats",chatId,"messages"),orderBy("createdAt","desc"),limit(1)));
  const newest=latest.docs[0]?.data()||null;
  const summary=messagePreview(newest),lastSender=newest?.senderUid||"";
  const senderProfile=(chats.find(chat=>chat.id===chatId)?.memberProfiles||[]).find(person=>person.uid===lastSender);
  try{
    await updateDoc(doc(db,"chats",chatId),{
      lastMessage:summary,lastSenderUid:lastSender,
      lastSenderName:(newest?.displayName||senderProfile?.displayName||"").slice(0,40),
      lastMessageAt:newest?.createdAt||deletedMessage?.createdAt||null,
      updatedAt:newest?.createdAt||deletedMessage?.createdAt||serverTimestamp()
    });
  }catch(error){
    const chat=chats.find(item=>item.id===chatId);
    if(chat&&chat.lastSenderUid===deletedMessage?.senderUid&&chat.lastMessage===messagePreview(deletedMessage)){
      await updateDoc(doc(db,"chats",chatId),{lastMessage:deletedMessage?.attachment?"Вложение удалено":"Сообщение удалено",lastMessageAt:deletedMessage?.createdAt||null,updatedAt:serverTimestamp()});
    }else throw error;
  }
}
async function deleteMessageForAll(message) {
  if(!confirm("Удалить это сообщение у всех участников?"))return;
  try{
    if(message.attachment?.url?.startsWith("filebase:"))await privateFileApi("/api/files/delete-message",{chatId:cur,messageId:message.id});
    await deleteDoc(doc(db,"chats",cur,"messages",message.id));
    try{await refreshChatPreviewAfterDelete(cur,message)}catch(previewError){console.warn("Message deleted but the chat preview could not be refreshed:",previewError)}
  }catch(e){alert(e?.message||authError(e))}
}
function renderMessageReactions(messageId,host) {
  const reactionRef=collection(db,"chats",cur,"messages",messageId,"reactions");
  const stop=onSnapshot(reactionRef,snap=>{
    if(!host.isConnected)return;
    host.querySelector(".reaction-bar")?.remove();
    const groups=new Map();
    snap.docs.forEach(d=>{const value=d.data(),emoji=value.emoji;if(emoji){const group=groups.get(emoji)||{count:0,mine:false};group.count++;if(d.id===me.uid)group.mine=true;groups.set(emoji,group)}});
    if(!groups.size)return;
    const bar=document.createElement("div");bar.className="reaction-bar";
    for(const [emoji,group] of groups){
      const b=document.createElement("button");b.className=group.mine?"mine-reaction":"";
      b.textContent=emoji+" "+group.count;b.title=group.mine?"Нажми, чтобы убрать свою реакцию":"Нажми, чтобы поставить такую же реакцию";
      b.onclick=async()=>{try{const ownRef=doc(db,"chats",cur,"messages",messageId,"reactions",me.uid);if(group.mine)await deleteDoc(ownRef);else await setDoc(ownRef,{uid:me.uid,emoji,updatedAt:serverTimestamp()})}catch(e){alert(authError(e))}};
      bar.append(b);
    }
    host.append(bar);
  },e=>console.warn("Reaction listener:",e));
  reactionStops.push(stop);
}
let replyTarget=null;
function setReplyTarget(message){
  replyTarget={id:message.id,senderUid:message.senderUid,displayName:message.displayName||message.username||"Пользователь",text:message.text||message.attachment?.name||"Вложение"};
  let bar=$("reply-preview");
  if(!bar){bar=document.createElement("div");bar.id="reply-preview";bar.className="reply-preview";$("msgs").after(bar)}
  bar.innerHTML='<span><b>Ответ '+esc(replyTarget.displayName)+'</b><small>'+esc(replyTarget.text.slice(0,140))+'</small></span><button type="button" aria-label="Отменить ответ">×</button>';
  bar.querySelector("button").onclick=()=>{replyTarget=null;bar.remove()};
  $("inp").focus();
}
function subscribeMessages() {
  if(stopMessages)stopMessages();
  clearProfileObservers(messageProfileStops);
  reactionStops.forEach(stop=>stop());reactionStops=[];
  const box=$("msgs");
  if(!cur){box.innerHTML='<div class="empty">Выберите переписку или создайте новый чат.</div>';return}
  if(cur===SYSTEM_CHAT_ID){stopMessages=null;renderSystemMessages();return}
  box.dataset.initialized="0";
  box.innerHTML='<div class="empty">Загрузка сообщений…</div>';
  const q=query(collection(db,"chats",cur,"messages"),orderBy("createdAt","asc"),limitToLast(100));
  stopMessages=onSnapshot(q,snapshot=>{
    const stick=box.scrollHeight-box.scrollTop-box.clientHeight<140;
    const isFirstSnapshot=box.dataset.initialized!=="1";
    const hasNewMessages=!isFirstSnapshot&&snapshot.docChanges().some(change=>change.type==="added");
    box.dataset.initialized="1";
    const oldHeight=box.scrollHeight,oldScrollTop=box.scrollTop,boxRect=box.getBoundingClientRect();
    const visibleAnchor=[...box.querySelectorAll(".mr")].find(node=>node.getBoundingClientRect().bottom>boxRect.top);
    const anchorId=visibleAnchor?.dataset.messageId||"";
    const anchorOffset=visibleAnchor?visibleAnchor.getBoundingClientRect().top-boxRect.top:0;
    markMessagesRead(snapshot.docs);
    reactionStops.forEach(stop=>stop());reactionStops=[];
    box.innerHTML="";
    if(snapshot.empty)box.innerHTML='<div class="empty">Пока нет сообщений. Напишите первым!</div>';
    let previous="";
    snapshot.docs.forEach(s=>{
      const m={id:s.id,...s.data()},mine=m.senderUid===me.uid,r=document.createElement("div");
      r.className="mr"+(mine?" me":"")+(S.avatars&&!mine&&previous===m.senderUid?" nf":"");
      r.dataset.messageId=m.id;r.dataset.senderUid=m.senderUid||"";
      if(m.senderUid)watchMessageProfile(m.senderUid,box);
      if(S.avatars&&!mine&&previous!==m.senderUid){
        const a=document.createElement("button");a.type="button";a.className="av message-avatar";a.setAttribute("aria-label","Открыть профиль "+(m.displayName||"пользователя"));a.title="Открыть профиль";
        avatar(a,{uid:m.senderUid,displayName:m.displayName||m.username,avatarUrl:m.avatarUrl,profileColor:m.profileColor});
        a.onclick=()=>openUserProfile(m.senderUid);r.append(a);
      }else if(S.avatars&&!mine)r.classList.add("nf");
      const b=document.createElement("div");b.className="msg";
      if(previous!==m.senderUid&&chats.find(chat=>chat.id===cur)?.type==="group"){
        const n=document.createElement("button");n.type="button";n.className="sender-profile";n.dataset.senderUid=m.senderUid||"";
        n.textContent=m.displayName||m.username||"Пользователь";
        n.onclick=()=>openUserProfile(m.senderUid);b.append(n);
      }
      if((m.hiddenFor||[]).includes(me.uid)){previous=m.senderUid;return}
      if(m.replyTo){
        const quote=document.createElement("button");quote.type="button";quote.className="reply-quote";
        const qname=document.createElement("b");qname.textContent=m.replyTo.displayName||"Ответ";
        const qtext=document.createElement("span");qtext.textContent=m.replyTo.text||"Сообщение";
        quote.append(qname,qtext);quote.onclick=()=>{const target=box.querySelector('[data-message-id="'+m.replyTo.id+'"]');target?.scrollIntoView({behavior:"smooth",block:"center"});target?.classList.add("reply-highlight");setTimeout(()=>target?.classList.remove("reply-highlight"),1200)};b.append(quote);
      }
      if(m.attachment){
        const a=m.attachment;
        if(a.type?.startsWith("image/")){
          const img=document.createElement("img");img.alt=a.name||"Изображение";img.className="message-image";img.loading=S.autoDownload?"eager":"lazy";img.tabIndex=0;img.setAttribute("role","button");img.title="Нажмите, чтобы открыть фото";
          setPrivateMediaSource(img,a.url,a.path);
          const showImage=()=>openImageViewer(a.url,a.path,a.name||"Изображение");
          img.addEventListener("click",showImage);img.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();showImage()}});
          b.append(img);
        }
        if(a.type?.startsWith("audio/"))b.append(createAudioMessagePlayer(a));
        if(a.type?.startsWith("video/")){
          const video=document.createElement("video");video.controls=true;video.playsInline=true;video.preload=S.autoDownload?"auto":"metadata";video.autoplay=!!S.autoPlayMedia;video.className="message-video";setPrivateMediaSource(video,a.url,a.path);b.append(video);
        }
        const link=document.createElement("a");link.href=a.external?a.url:"#";link.textContent=a.external?"↗ Открыть внешний файл: "+(a.name||"файл"):"↓ Скачать "+(a.name||"файл")+" ("+Math.max(1,Math.round((a.size||0)/1024))+" КБ)";link.className="attachment-link";
        if(a.external){link.target="_blank";link.rel="noopener noreferrer"}
        else link.addEventListener("click",async event=>{event.preventDefault();try{await downloadStoredFile(a.url,a.path,a.name||"download")}catch(error){alert(error.message)}});
        b.append(link);
      }
      if(m.accountDeletedNotice){b.classList.add("deleted-account-notice");const tag=document.createElement("small");tag.textContent="АККАУНТ УДАЛЁН";tag.style.cssText="display:block;font-size:10px;letter-spacing:.08em;opacity:.7;font-weight:700;margin-bottom:4px";b.append(tag)}
      if(m.text){const body=document.createElement("div");appendMentionText(body,m.text,resolveMention);b.append(body)}
      const t=document.createElement("time");const date=m.createdAt?.toDate?m.createdAt.toDate():new Date();t.textContent=date.toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit",hour12:!S.h24})+(m.editedAt?" · изменено":"");if(mine&&cur) {
        const chat=chats.find(item=>item.id===cur),recipients=(chat?.memberUids||[]).filter(uid=>uid!==me.uid);
        if(recipients.length)appendReadReceipt(t,{read:recipients.every(uid=>(m.readBy||[me.uid]).includes(uid))});
      }
      b.append(t);
      r.append(b);box.append(r);
      r.addEventListener("contextmenu",e=>{e.preventDefault();openMessageMenu(m,mine,e.clientX,e.clientY)});
      let pressTimer;r.addEventListener("touchstart",e=>{pressTimer=setTimeout(()=>openMessageMenu(m,mine,e.touches[0]?.clientX||30,e.touches[0]?.clientY||80),550)},{passive:true});
      ["touchend","touchmove","touchcancel"].forEach(ev=>r.addEventListener(ev,()=>clearTimeout(pressTimer),{passive:true}));
      renderMessageReactions(m.id,b);previous=m.senderUid;
    });
    requestAnimationFrame(()=>{
      if(!box.isConnected)return;
      if(stick){
        const target=box.scrollHeight;
        if(isFirstSnapshot||!hasNewMessages||S.reduceMotion)box.scrollTop=target;
        else box.scrollTo({top:target,behavior:"smooth"});
        return;
      }
      const anchor=anchorId?[...box.querySelectorAll(".mr")].find(node=>node.dataset.messageId===anchorId):null;
      if(anchor){
        const nextOffset=anchor.getBoundingClientRect().top-box.getBoundingClientRect().top;
        box.scrollTop+=nextOffset-anchorOffset;
      }else{
        box.scrollTop=oldScrollTop+(box.scrollHeight-oldHeight);
      }
    });
  },e=>{box.textContent="Не удалось загрузить сообщения: "+e.message;});
}
async function loadChatProfile(uid) {
  const snap=await getDoc(doc(db,"publicUsers",uid));
  if(!snap.exists())throw new Error("Пользователь не найден.");
  return{uid,...snap.data()};
}
async function copyProfileValue(value,button){
  if(!value)return;
  try{
    if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(value);
    else{
      const field=document.createElement("textarea");field.value=value;field.style.position="fixed";field.style.opacity="0";
      document.body.append(field);field.select();
      const ok=document.execCommand("copy");field.remove();if(!ok)throw new Error("Копирование недоступно.");
    }
    const previous=button.textContent;button.textContent="Скопировано";
    setTimeout(()=>{if(button.isConnected)button.textContent=previous},1300);
  }catch(error){alert("Не удалось скопировать: "+(error.message||"попробуй ещё раз."))}
}
async function openUserProfile(userOrName) {
  try {
    let profile=userOrName;
    if(typeof userOrName==="string"){
      const value=userOrName.trim();
      if(/^[A-Za-z0-9_-]{20,128}$/.test(value)){
        try{profile=await loadChatProfile(value)}
        catch{profile=await findPublicProfileByUsername(value)}
      }else profile=await findPublicProfileByUsername(value);
    }
    if(!profile||profile.deleted)throw new Error("Профиль недоступен.");
    openM('<div class="profile-public-card"><div class="profile-public-card-top"><span>ПРОФИЛЬ FROSS</span><span class="profile-live" id="profile-card-presence"></span></div><div class="profile-public-card-main"><div class="av big" id="profile-card-avatar"></div><div class="profile-public-card-identity"><h3 id="profile-card-name"></h3><div class="profile-handle-row"><b class="profile-handle" id="profile-card-handle"></b><button type="button" class="profile-copy-btn" id="profile-card-copy-username" aria-label="Копировать username">⧉</button></div></div></div><div id="profile-card-phone" class="profile-phone-row"><span>Номер телефона</span><b id="profile-card-phone-value"></b><button type="button" class="profile-copy-btn" id="profile-card-copy-phone" aria-label="Копировать номер" hidden>⧉</button></div><div class="profile-description-label">Описание</div><p id="profile-card-bio" class="profile-public-bio"></p><div class="profile-public-actions"><button type="button" id="profile-card-close">Закрыть</button><button type="button" class="pr" id="profile-card-chat">Написать</button></div></div>');
    avatar($("profile-card-avatar"),profile);
    $("profile-card-name").textContent=profile.displayName||profile.username||"Пользователь";
    $("profile-card-handle").textContent="@"+(profile.username||"user");
    $("profile-card-presence").textContent=presenceLabel(profile);
    $("profile-card-presence").classList.toggle("online",isOnline(profile));
    $("profile-card-bio").textContent=profile.bio||"Описание не добавлено.";
    const phoneValue=$("profile-card-phone-value"),phoneCopy=$("profile-card-copy-phone");
    if(profile.phonePublic){
      phoneValue.textContent=profile.phonePublic;phoneCopy.hidden=false;
      phoneCopy.onclick=()=>copyProfileValue(profile.phonePublic,phoneCopy);
    }else{
      phoneValue.textContent=profile.phoneStatus==="hidden"?"Номер скрыт":"Номер не подтверждён";
      phoneCopy.hidden=true;
    }
    $("profile-card-copy-username").onclick=()=>copyProfileValue("@"+(profile.username||"user"),$("profile-card-copy-username"));
    $("profile-card-close").onclick=closeM;
    $("profile-card-chat").onclick=()=>startDM(profile);
  } catch(error) { alert(authError(error)); }
}
async function resolveMention(username) { await openUserProfile(username); }
async function markMessagesRead(docs) {
  if(!S.readReceipts||!cur)return;
  const chat=chats.find(item=>item.id===cur);
  if(!chat||!["dm","group"].includes(chat.type))return;
  const pending=docs.filter(item=>{
    const data=item.data(),readBy=Array.isArray(data.readBy)?data.readBy:[];
    return data.senderUid!==me.uid&&!readBy.includes(me.uid);
  }).slice(0,450);
  if(!pending.length)return;
  try {
    const batch=writeBatch(db);
    pending.forEach(item=>batch.update(item.ref,{readBy:arrayUnion(me.uid)}));
    await batch.commit();
  } catch(error) { console.warn("Read receipt update failed:",error); }
}
async function startDM(user) {
  try{
    const u=typeof user==="string"?await findPublicProfileByUsername(user):user;
    if(!u?.uid||u.uid===me.uid)throw new Error("Нельзя открыть личный чат с этим аккаунтом.");
    const existing=chats.find(chat=>chat.type==="dm"
      &&(chat.memberUids||[]).includes(me.uid)
      &&(chat.memberUids||[]).includes(u.uid));
    if(existing){$("q").value="";found=[];closeM();openChat(existing.id);return}
    // Use a fresh ID: a removed deterministic DM may no longer be readable under member-only rules.
    const id="dm_"+crypto.randomUUID();
    const members=[
      {uid:me.uid,username:me.username,displayName:me.displayName,avatarUrl:me.avatarUrl||""},
      {uid:u.uid,username:u.username,displayName:u.displayName||u.username,avatarUrl:u.avatarUrl||""}
    ];
    const chatData={type:"dm",title:"",ownerUid:me.uid,memberUids:[me.uid,u.uid],
      memberProfiles:members,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),lastMessage:""};
    await setDoc(doc(db,"chats",id),chatData);
    chats=[{id,...chatData},...chats];
    $("q").value="";found=[];closeM();openChat(id);renderList();head();
  }catch(error){alert(authError(error))}
}
function startGroup() {
  const selected=new Map();
  const pickerBox=document.createElement("div");
  $("nc").append(pickerBox);
  picker(pickerBox,u=>{
    selected.has(u.uid)?selected.delete(u.uid):selected.set(u.uid,u);
    $("ch").innerHTML=[...selected.values()].map(u=>'<span class="chip">'+esc(u.displayName||u.username)+'</span>').join("");
  },selected);
}
async function loadCurrentProfile() {
  const snap=await getDoc(doc(db,"publicUsers",currentUser.uid));
  const priv=await getDoc(doc(db,"users",currentUser.uid));
  if(!snap.exists())throw new Error("Профиль Firebase не найден.");
  const p=snap.data(),v=priv.exists()?priv.data():{};
  me={uid:currentUser.uid,...p,contactEmail:v.contactEmail||"",settings:v.settings||{},phoneNumber:v.phoneNumber||currentUser.phoneNumber||"",phoneVerified:v.phoneVerified===true||!!currentUser.phoneNumber,phoneVisible:v.phoneVisible===true,phonePublic:p.phonePublic||"",phoneStatus:p.phoneStatus||"unverified",telegramLinked:!!v.telegramUserId,mutedChats:Array.isArray(v.mutedChats)?v.mutedChats:[]};
  let cached={};try{cached=JSON.parse(localStorage.getItem("fross-settings-"+currentUser.uid)||"{}")}catch{}
  S={...DEF,...cached,...me.settings};
  const priorPalette={accent:"#9181ff",bgColor:"#0f1015",panelColor:"#16181f",textColor:"#f2f3f7",incomingColor:"#232632",outgoingColor:"#9181ff",profileColor:"#9181ff"};
  for(const [key,value] of Object.entries(priorPalette))if(S[key]===value)S[key]=DEF[key];
  applyS(S);fillMe();
}
function fillMe(){avatar($("mav"),me,true);$("mn").textContent=me.displayName||me.username;$("mu").textContent="";$("mu").style.display="none"}
async function boot(user) {
  if(bootedUid===user.uid)return;
  bootedUid=user.uid;
  currentUser=user;
  try{
    await loadCurrentProfile();$("auth").style.display="none";$("app").style.display="grid";cur="";document.body.classList.remove("ch");
    startChatList();head();subscribeMessages();
    if(presenceTimer)clearInterval(presenceTimer);
    presenceTimer=setInterval(()=>updateDoc(doc(db,"publicUsers",me.uid),{lastSeenAt:serverTimestamp()}).catch(console.error),60000);
  }catch(e){bootedUid=null;console.error(e);alert("Не удалось открыть мессенджер: "+authError(e));await signOut(auth)}
}
async function publishChatMessage(chatId,message,summary) {
  const messageRef=doc(collection(db,"chats",chatId,"messages"));
  await setDoc(messageRef,message);

  const chatRef=doc(db,"chats",chatId),preview=String(summary||"").slice(0,120);
  try {
    await updateDoc(chatRef,{
      lastMessage:preview,
      lastSenderUid:me.uid,
      lastSenderName:(me.displayName||me.username||"").slice(0,40),
      lastMessageAt:serverTimestamp(),
      updatedAt:serverTimestamp()
    });
  } catch(metadataError) {
    console.warn("FROSS message saved; retrying chat preview with fields allowed by Firestore rules:",metadataError);
    try {
      await updateDoc(chatRef,{
        lastMessage:preview,
        lastMessageAt:serverTimestamp(),
        updatedAt:serverTimestamp()
      });
    } catch(fallbackError) {
      console.warn("FROSS chat preview could not be refreshed; the message itself is already saved:",fallbackError);
    }
  }
  return messageRef;
}
async function send() {
  if(cur===SYSTEM_CHAT_ID){alert("В официальный чат FROSS нельзя отправлять сообщения. Это канал системных уведомлений.");return}
  if(!cur){alert("Сначала выберите личный чат или группу.");return}
  const input=$("inp"),text=input.value.trim();if(!text&&!replyTarget)return;input.value="";input.style.height="";
  const reply=replyTarget;replyTarget=null;$("reply-preview")?.remove();
  try{
    const message={senderUid:me.uid,username:me.username,displayName:me.displayName||me.username,avatarUrl:me.avatarUrl||"",profileColor:me.profileColor||S.profileColor||"",text,readBy:[me.uid],createdAt:serverTimestamp()};
    if(reply)message.replyTo={id:reply.id,senderUid:reply.senderUid,displayName:reply.displayName,text:reply.text.slice(0,160)};
    await publishChatMessage(cur,message,text);
  }catch(e){alert(authError(e));input.value=text}
}
$("send").onclick=send;
const attachmentButton=$("attach"),attachmentInput=$("attachment-input");
async function optimizeChatImage(file) {
  if(!S.compressImages || !file.type?.startsWith("image/") || file.type==="image/gif" || file.size<700*1024 || typeof createImageBitmap!=="function")return file;
  try{
    const bitmap=await createImageBitmap(file);
    const scale=Math.min(1,1920/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement("canvas");
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",.84));
    if(!blob||blob.size>=file.size)return file;
    const name=file.name.replace(/\.[^.]+$/,"")+".webp";
    return new File([blob],name,{type:"image/webp",lastModified:file.lastModified||Date.now()});
  }catch(error){console.warn("Image optimization skipped:",error);return file}
}
const attachmentMenu=$("attach-menu"),uploadChoice=$("attach-upload"),urlChoice=$("attach-url");
if(attachmentButton&&attachmentInput){
  attachmentButton.onclick=()=>{if(attachmentMenu)attachmentMenu.hidden=!attachmentMenu.hidden;else attachmentInput.click()};
  if(uploadChoice)uploadChoice.onclick=()=>{attachmentMenu.hidden=true;attachmentInput.click()};
  if(urlChoice)urlChoice.onclick=()=>{attachmentMenu.hidden=true;sendExternalFileLink()};
  attachmentInput.onchange=async()=>{
    const files=[...(attachmentInput.files||[])];attachmentInput.value="";
    for(const file of files) {
      let uploadFile=file;
      try{uploadFile=await optimizeChatImage(file)}catch{}
      if(uploadFile.size>=20*1024*1024){alert("Файл «"+file.name+"» больше лимита 20 МБ.");continue}
      const chatId=cur;
      if(!chatId){alert("Сначала выберите личный чат или группу.");continue}
      const progress=createUploadProgress($("msgs"),file.name);$("msgs").scrollTop=$("msgs").scrollHeight;
      attachmentButton.disabled=true;
      try{
        const {url,path}=await uploadChatFile(chatId,uploadFile,await currentUser.getIdToken(),percent=>progress.update(percent));
        const attachment={name:uploadFile.name.slice(0,180),type:uploadFile.type||"application/octet-stream",size:uploadFile.size,url,path};
        const summary=uploadFile.type.startsWith("image/")?"фото":uploadFile.type.startsWith("video/")?"видео":uploadFile.type.startsWith("audio/")?"аудио":"файл";
        const message={senderUid:me.uid,username:me.username,displayName:me.displayName||me.username,avatarUrl:me.avatarUrl||"",profileColor:me.profileColor||S.profileColor||"",text:"",attachment,readBy:[me.uid],createdAt:serverTimestamp()};
        if(replyTarget){message.replyTo={id:replyTarget.id,senderUid:replyTarget.senderUid,displayName:replyTarget.displayName,text:replyTarget.text.slice(0,160)};replyTarget=null;$("reply-preview")?.remove()}
        await publishChatMessage(chatId,message,summary);progress.update(100);setTimeout(()=>progress.remove(),900);
      }catch(error){console.error("FROSS chat attachment upload failed:",{code:error?.code,message:error?.message});progress.remove();alert("Не удалось загрузить или отправить «"+file.name+"».\\n"+(error?.code||"Ошибка Firebase")+": "+authError(error)+"\\n\\nПроверь подключение к интернету и повтори попытку.")}
      finally{attachmentButton.disabled=false}
    }
  };
}

function validateExternalFileUrl(value){
  let parsed;try{parsed=new URL(String(value||"").trim())}catch{throw new Error("Вставь корректную HTTPS-ссылку на файл.")}
  const host=parsed.hostname.toLowerCase();
  if(parsed.protocol!=="https:"||parsed.username||parsed.password||!host||host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".internal")||/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)||host.includes(":"))
    throw new Error("Поддерживаются только публичные HTTPS-ссылки без адресов локальной сети.");
  parsed.hash="";return parsed;
}
function externalFileType(path){
  const ext=(path.match(/\.([a-z0-9]{1,8})$/i)||[])[1]?.toLowerCase()||"";
  if(["jpg","jpeg","png","webp","gif","avif"].includes(ext))return "image/"+(ext==="jpg"?"jpeg":ext);
  if(["mp4","webm","mov"].includes(ext))return "video/"+(ext==="mov"?"quicktime":ext);
  if(["mp3","m4a","ogg","wav","flac"].includes(ext))return "audio/"+ext;
  return "application/octet-stream";
}
async function sendExternalFileLink(){
  if(!cur){alert("Сначала открой личный чат или группу.");return}
  const input=prompt("Вставь публичную HTTPS-ссылку на файл:");
  if(input===null)return;
  try{
    const parsed=validateExternalFileUrl(input);
    const tail=decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop()||"Файл");
    const name=(tail||"Файл").slice(0,180),type=externalFileType(parsed.pathname);
    const attachment={name,type,size:0,url:parsed.href,path:"",external:true};
    const message={senderUid:me.uid,username:me.username,displayName:me.displayName||me.username,avatarUrl:me.avatarUrl||"",profileColor:me.profileColor||S.profileColor||"",text:"",attachment,readBy:[me.uid],createdAt:serverTimestamp()};
    await publishChatMessage(cur,message,type.startsWith("image/")?"фото":"файл");
  }catch(error){alert(error.message||authError(error))}
}
$("chat-settings").onclick=openChatSettings;
async function openChatSettings(){
  const chat=chats.find(c=>c.id===cur);if(!chat)return;
  const isGroup=chat.type==="group",isOwner=isGroup&&chat.ownerUid===me.uid;
  const title=chat.title||chatInfo(chat).title;
  let editor="";
  if(isGroup){
    editor=isOwner
      ? '<div class="group-settings-editor"><label>Название группы</label><input id="group-title" maxlength="40"><label>Описание</label><textarea id="group-description" rows="3" maxlength="300" placeholder="Кратко расскажи о группе"></textarea><h4>Участники</h4><div id="group-members" class="group-settings-members"></div><h4>Добавить из личных чатов</h4><div id="group-candidates" class="group-settings-members"></div><div class="err" id="group-settings-error"></div><button class="pr" id="save-group-settings" style="width:100%">Сохранить настройки группы</button><button class="dg" id="delete-group-everyone" style="width:100%;margin-top:8px">Удалить группу у всех участников</button></div>'
      : '<p class="mut">Настраивать группу может только её создатель.</p><b>Участники</b><div id="group-members" class="group-settings-members"></div>';
  }
  openM('<h3>'+(isGroup?'Настройки группы':'Настройки чата')+'</h3><p class="mut">'+esc(title)+'</p>'+editor+'<hr style="border:0;border-top:1px solid var(--line);margin:14px 0"><button type="button" id="toggle-chat-mute" style="width:100%;margin-bottom:8px">'+((me.mutedChats||[]).includes(cur)?'Включить уведомления':'Отключить уведомления')+'</button><button id="clear-chat" style="width:100%">Очистить переписку у себя</button><button id="delete-chat" class="dg" style="width:100%;margin-top:8px">Удалить чат из моего списка</button><div class="err" id="chat-settings-error"></div>');
  if(isGroup){
    const currentMemberIds=new Set(chat.memberUids||[]);
    const profiles=new Map((chat.memberProfiles||[]).filter(person=>currentMemberIds.has(person.uid)).map(person=>[person.uid,{...person}]));
    const contacts=new Map();
    for(const memberUid of (chat.memberUids||[])){
      if(!profiles.has(memberUid)){
        const known=chats.flatMap(c=>c.memberProfiles||[]).find(person=>person.uid===memberUid);
        profiles.set(memberUid,known?{...known}:{uid:memberUid,username:"user",displayName:"Участник"});
      }
    }
    if(!profiles.has(me.uid))profiles.set(me.uid,{uid:me.uid,username:me.username,displayName:me.displayName||me.username,avatarUrl:me.avatarUrl||""});
    for(const dm of chats.filter(c=>c.type==="dm")){
      const person=(dm.memberProfiles||[]).find(member=>member.uid!==me.uid);
      if(person&&!person.deleted&&!profiles.has(person.uid))contacts.set(person.uid,person);
    }
    const renderMembers=()=>{
      const host=$("group-members");if(!host)return;host.innerHTML="";
      for(const person of profiles.values()){
        if(!(chat.memberUids||[]).includes(person.uid)&&!isOwner)continue;
        const row=document.createElement("div");row.className="group-contact";
        const name=document.createElement("span");name.textContent=(person.displayName||person.username||"Участник")+(person.uid===chat.ownerUid?" · создатель":"");
        row.append(name);
        if(isOwner&&person.uid!==me.uid){
          const remove=document.createElement("button");remove.type="button";remove.textContent="Убрать";remove.onclick=()=>{profiles.delete(person.uid);renderMembers();renderCandidates()};row.append(remove);
        }
        host.append(row);
      }
    };
    const renderCandidates=()=>{
      const host=$("group-candidates");if(!host)return;host.innerHTML="";
      const available=[...contacts.values()].filter(person=>!profiles.has(person.uid));
      if(!available.length){host.textContent="Новых участников из личных чатов нет.";host.className="group-settings-members group-settings-note";return}
      host.className="group-settings-members";
      available.forEach(person=>{
        const row=document.createElement("label");row.className="group-contact";
        const check=document.createElement("input");check.type="checkbox";
        const name=document.createElement("span");name.textContent=person.displayName||person.username||"Участник";
        check.onchange=()=>{if(check.checked)profiles.set(person.uid,{...person});else profiles.delete(person.uid);renderMembers();renderCandidates()};
        row.append(check,name);host.append(row);
      });
    };
    renderMembers();if(isOwner)renderCandidates();
    if(isOwner){
      $("delete-group-everyone").onclick=async()=>{
        if(!confirm("Удалить группу и всю её переписку у всех участников? Действие необратимо."))return;
        const button=$("delete-group-everyone");button.disabled=true;button.textContent="Удаляем…";
        try{
          const token=await currentUser.getIdToken(true);
          const response=await fetch("https://us-central1-fross-ca5d6.cloudfunctions.net/deleteGroupForEveryone",{
            method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
            body:JSON.stringify({chatId:cur})
          });
          const result=await response.json().catch(()=>({}));
          if(!response.ok)throw new Error(result.error||("HTTP "+response.status));
          closeM();cur="";document.body.classList.remove("ch");chats=chats.filter(item=>item.id!==chat.id);renderList();head();subscribeMessages();
        }catch(error){$("chat-settings-error").textContent=error.message||authError(error);button.disabled=false;button.textContent="Удалить группу у всех участников"}
      };
      $("group-title").value=chat.title||"";
      $("group-description").value=chat.description||"";
      $("save-group-settings").onclick=async()=>{
        const nextTitle=$("group-title").value.trim(),nextDescription=$("group-description").value.trim().slice(0,300);
        const currentError=$("group-settings-error");
        const memberUids=[...profiles.keys()];
        if(!nextTitle||nextTitle.length>40){currentError.textContent="Название должно быть от 1 до 40 символов.";return}
        if(memberUids.length<2||memberUids.length>50){currentError.textContent="В группе должно быть от 2 до 50 участников.";return}
        if(!memberUids.includes(me.uid)){currentError.textContent="Создатель должен оставаться участником группы.";return}
        const memberProfiles=memberUids.map(uid=>{const person=profiles.get(uid)||{};return {uid,username:person.username||"user",displayName:person.displayName||person.username||"Участник",avatarUrl:person.avatarUrl||""}});
        const button=$("save-group-settings");button.disabled=true;button.textContent="Сохраняем…";
        try{
          await updateDoc(doc(db,"chats",cur),{title:nextTitle,description:nextDescription,memberUids,memberProfiles,updatedAt:serverTimestamp()});
          Object.assign(chat,{title:nextTitle,description:nextDescription,memberUids,memberProfiles});
          const stored=chats.find(item=>item.id===cur);if(stored)Object.assign(stored,{title:nextTitle,description:nextDescription,memberUids,memberProfiles});
          closeM();head();renderList();
        }catch(error){currentError.textContent=authError(error);button.disabled=false;button.textContent="Сохранить настройки группы"}
      };
    }
  }
  $("toggle-chat-mute").onclick=async()=>{
    const muted=new Set(me.mutedChats||[]);
    if(muted.has(cur))muted.delete(cur);else muted.add(cur);
    const next=[...muted];
    try{
      await updateDoc(doc(db,"users",me.uid),{mutedChats:next,updatedAt:serverTimestamp()});
      me.mutedChats=next;
      $("toggle-chat-mute").textContent=muted.has(cur)?"Включить уведомления":"Отключить уведомления";
      $("chat-settings-error").textContent=muted.has(cur)?"Уведомления этого чата отключены.":"Уведомления этого чата включены.";
    }catch(error){$("chat-settings-error").textContent=authError(error)}
  };
  $("clear-chat").onclick=async()=>{
    try{
      const snap=await getDocs(collection(db,"chats",cur,"messages"));
      let batch=writeBatch(db),count=0;const batches=[];
      for(const d of snap.docs){batch.update(d.ref,{hiddenFor:arrayUnion(me.uid)});count++;if(count===450){batches.push(batch);batch=writeBatch(db);count=0}}
      if(count)batches.push(batch);for(const b of batches)await b.commit();
      $("chat-settings-error").style.color="#3ddc84";$("chat-settings-error").textContent="Переписка очищена у вас.";
    }catch(e){$("chat-settings-error").textContent=authError(e)}
  };
  $("delete-chat").onclick=async()=>{
    if(isGroup&&isOwner){$("chat-settings-error").textContent="Создатель не может покинуть группу, пока не передаст права владения.";return}
    if(!confirm("Удалить чат из вашего списка? История останется у других участников."))return;
    try{await updateDoc(doc(db,"chats",cur),{memberUids:arrayRemove(me.uid),updatedAt:serverTimestamp()});closeM();cur="";document.body.classList.remove("ch");renderList();head();subscribeMessages()}
    catch(e){$("chat-settings-error").textContent=authError(e)}
  };
}
$("inp").onkeydown=e=>{if(e.key==="Enter"&&(S.enter?!e.shiftKey:e.ctrlKey)){e.preventDefault();send()}};
$("inp").oninput=e=>{e.target.style.height="auto";e.target.style.height=Math.min(e.target.scrollHeight,120)+"px"};
$("back").onclick=()=>document.body.classList.remove("ch");
$("q").oninput=()=>{
  renderList();clearTimeout(searchTimer);
  searchTimer=setTimeout(()=>searchUsers($("q").value),250);
};
function picker(box,onPick,selected) {
  box.innerHTML='<input placeholder="Username пользователя"><div class="pl" style="max-height:220px;overflow:auto"></div>';
  const input=box.firstChild,list=box.lastChild;let timer,request=0;
  const run=async()=>{
    const text=input.value.trim().toLowerCase().replace(/^@/,""),sequence=++request;list.innerHTML="";
    if(text.length<2)return;
    list.textContent="Ищем пользователя…";
    try{
      const users=await findPublicProfiles(text,20);
      if(sequence!==request)return;
      list.innerHTML="";
      users.forEach(user=>{
        const row=item(user,user.displayName||user.username,presenceLabel(user),isOnline(user),selected&&selected.has(user.uid),()=>onPick(user));
        list.append(row);
      });
      if(!users.length)list.textContent="Пользователь не найден. Проверь username.";
    }catch(error){if(sequence===request)list.textContent=authError(error)}
  };
  input.oninput=()=>{clearTimeout(timer);timer=setTimeout(run,220)};
}
$("nb").onclick=()=>{
  openM('<h3 style="margin:0">Новый чат</h3><div class="tabs"><button class="a" id="t1">Личный</button><button id="t2">Группа</button></div><div id="nc"></div><div class="row"><button id="cx">Закрыть</button></div>');
  $("cx").onclick=closeM;
  const tab=n=>{
    $("t1").classList.toggle("a",n===1);$("t2").classList.toggle("a",n===2);
    $("nc").innerHTML="";
    if(n===1){const b=document.createElement("div");$("nc").append(b);picker(b,u=>startDM(u));return;}
    const selected=new Map();$("nc").innerHTML='<label>Название группы</label><input id="gt" maxlength="40" placeholder="Например, Команда"><label>Описание группы</label><textarea id="gd" rows="2" maxlength="300" placeholder="О чём эта группа"></textarea><p class="mut">Добавляй участников из уже существующих личных чатов.</p><div id="ch"></div><div id="pk" class="existing-chat-picker"></div><div class="err" id="ge"></div><button class="pr" id="gc" style="width:100%">Создать группу</button>';
    const candidates=chats.filter(chat=>chat.type==="dm").map(chat=>(chat.memberProfiles||[]).find(person=>person.uid!==me.uid)).filter(person=>person&&!person.deleted);
    const renderSelected=()=>{$("ch").innerHTML=[...selected.values()].map(person=>'<span class="chip">@'+esc(person.username||"user")+'</span>').join("");};
    if(!candidates.length)$("pk").textContent="Пока нет личных чатов. Сначала начни переписку с человеком.";
    candidates.forEach(person=>{
      const row=document.createElement("label");row.className="group-contact";
      const checkbox=document.createElement("input");checkbox.type="checkbox";
      const info=document.createElement("span");info.textContent=person.displayName||person.username||"Участник";
      checkbox.onchange=()=>{if(checkbox.checked)selected.set(person.uid,person);else selected.delete(person.uid);renderSelected()};
      row.append(checkbox,info);$("pk").append(row);
    });
    $("gc").onclick=async()=>{
      const title=$("gt").value.trim();if(!title)return $("ge").textContent="Введите название группы.";
      if(!selected.size)return $("ge").textContent="Добавьте хотя бы одного участника.";
      try{
        const members=[{uid:me.uid,username:me.username,displayName:me.displayName,avatarUrl:me.avatarUrl||""},...selected.values()];
        const unique=[...new Map(members.map(x=>[x.uid,x])).values()];
        const id="group_"+crypto.randomUUID();
        await setDoc(doc(db,"chats",id),{type:"group",title,description:$("gd").value.trim().slice(0,300),ownerUid:me.uid,memberUids:unique.map(x=>x.uid),memberProfiles:unique.map(x=>({uid:x.uid,username:x.username,displayName:x.displayName,avatarUrl:x.avatarUrl||""})),createdAt:serverTimestamp(),updatedAt:serverTimestamp(),lastMessage:""});
        closeM();openChat(id);
      }catch(e){$("ge").textContent=authError(e)}
    };
  };
  $("t1").onclick=()=>tab(1);$("t2").onclick=()=>tab(2);tab(1);
};
const openM=h=>{$("md").innerHTML=h;$("ov").classList.add("o")},closeM=()=>$("ov").classList.remove("o");
$("ov").onclick=e=>{if(e.target===$("ov")){applyS(S);closeM()}};
$("gb").onclick=()=>{
  const startCategory=window.FROSS_SETTINGS_START===3?3:1;window.FROSS_SETTINGS_START=null;
  const backup=JSON.parse(JSON.stringify(S)),o={...DEF,...S};
  const P={username:me.username||"",displayName:me.displayName||"",bio:me.bio||"",contactEmail:me.contactEmail||"",avatarUrl:me.avatarUrl||"",profileColor:me.profileColor||S.profileColor,avatarDirty:false};
  openM('<div class="settings-head"><div><h3>Настройки FROSS</h3><p>Выбери раздел, который хочешь изменить</p></div><button type="button" id="settings-back" class="settings-back">← Чаты</button></div><div class="settings-layout"><nav class="settings-categories" aria-label="Разделы настроек"><button type="button" class="settings-category" data-i="0"><span>🛡️</span><b>Безопасность</b><small>Вход и защита аккаунта</small></button><button type="button" class="settings-category" data-i="1"><span>💬</span><b>Чаты</b><small>Переписки и уведомления</small></button><button type="button" class="settings-category" data-i="2"><span>🖼️</span><b>Медиа</b><small>Фото и файлы</small></button><button type="button" class="settings-category" data-i="3"><span>👤</span><b>Профиль</b><small>Фото и личные данные</small></button><button type="button" class="settings-category" data-i="4"><span>🎨</span><b>Кастомизация</b><small>Цвета и внешний вид</small></button></nav><section id="sc" class="settings-content"></section></div><div class="row settings-actions"><button id="sx">Отмена</button><button class="pr" id="ss">Сохранить</button></div>');
  $("settings-back").onclick=()=>{applyS(S);closeM();document.body.classList.remove("ch");$("nav-chats").classList.add("active");$("nav-people").classList.remove("active")};
  const toggle=(k,label,description)=>'<div class="sw2"><div>'+label+(description?'<br><small class="mut">'+description+'</small>':"")+'</div><input type="checkbox" data-k="'+k+'" '+(o[k]?"checked":"")+'></div>';
  const section=(title,description)=>'<div class="settings-section-title"><h4>'+title+'</h4><p>'+description+'</p></div>';
  let settingsRenderVersion=0;
  const show=async i=>{
    const renderVersion=++settingsRenderVersion;
    document.querySelectorAll(".settings-category").forEach((b,j)=>b.classList.toggle("active",i===j));
    const c=$("sc");c.classList.remove("settings-content-enter");void c.offsetWidth;c.classList.add("settings-content-enter");
    if(i===3){
      c.innerHTML=section("Профиль","Настрой личные данные и посмотри, как профиль будет выглядеть для других.")+'<div class="profile-public-preview"><div class="profile-public-preview-head"><b>ПУБЛИЧНЫЙ ПРОФИЛЬ</b><span>Предпросмотр</span></div><div class="profile-public-preview-main"><div class="av" id="pp-avatar"></div><div class="profile-public-preview-name"><b id="pp-name"></b><small id="pp-handle"></small></div></div><p id="pp-bio"></p></div><div class="profile-photo-editor"><div class="av big" id="pav"></div><div class="profile-photo-actions"><button type="button" id="up">📷 Выбрать фото</button><input type="file" id="fi" accept="image/*" hidden><button type="button" class="ic" id="rm">Убрать фото</button><small id="photo-state" class="photo-state">Текущее фото сохранено.</small></div></div><label>Уникальный username</label><input id="un" maxlength="20" autocomplete="username"><small class="mut">3–20 символов: латиница, цифры и _. Username должен быть свободен.</small><label>Никнейм — может повторяться</label><input id="dn" maxlength="40"><label>О себе</label><textarea id="bio" rows="3" maxlength="160" placeholder="Расскажи немного о себе"></textarea><label>Контактный email</label><input id="em" type="email">';
      $("un").value=P.username;$("dn").value=P.displayName;$("bio").value=P.bio;$("em").value=P.contactEmail;avatar($("pav"),{displayName:P.displayName,avatarUrl:P.avatarUrl});
      const refreshProfilePreview=()=>{
        $("pp-name").textContent=P.displayName||P.username||"Имя пользователя";
        $("pp-handle").textContent="@"+(P.username||"username");
        $("pp-bio").textContent=P.bio||"Здесь будет отображаться информация о себе.";
        avatar($("pp-avatar"),{displayName:P.displayName||P.username,username:P.username,avatarUrl:P.avatarUrl,profileColor:o.profileColor||P.profileColor});
      };
      refreshProfilePreview();
      if(P.avatarDirty){$("photo-state").textContent="Фото уже применено, нажми «Сохранить»."; $("photo-state").classList.add("pending")}
      $("un").oninput=e=>{P.username=e.target.value.trim().toLowerCase();refreshProfilePreview()};
      $("dn").oninput=e=>{P.displayName=e.target.value;refreshProfilePreview()};
      $("bio").oninput=e=>{P.bio=e.target.value;refreshProfilePreview()};
      $("em").oninput=e=>P.contactEmail=e.target.value;
      $("up").onclick=()=>$("fi").click();
      $("fi").onchange=e=>{
        const file=e.target.files?.[0];e.target.value="";if(!file)return;
        pickImg(file,dataUrl=>{
          P.avatarUrl=dataUrl;P.avatarDirty=true;
          avatar($("pav"),{displayName:P.displayName,avatarUrl:dataUrl});
          $("photo-state").textContent="Фото применено. Теперь нажми «Сохранить».";
          $("photo-state").classList.add("pending");refreshProfilePreview();
        });
      };
      $("rm").onclick=()=>{
        P.avatarUrl="";P.avatarDirty=true;avatar($("pav"),{displayName:P.displayName});
        $("photo-state").textContent="Фото будет удалено после нажатия «Сохранить».";
        $("photo-state").classList.add("pending");refreshProfilePreview();
      };
    }
    if(i===4){
      c.innerHTML=section("Кастомизация","Подстрой внешний вид FROSS под себя.")+'<div class="customization-panel">'+look(o,"s")+'</div><button type="button" id="reset-customization" style="width:100%;margin:14px 0">↺ Сбросить оформление</button><small class="mut">Вернёт цвета, шрифт, размеры и фон к стандартным значениям.</small>';
      bindLook(o,"s");
      $("reset-customization").onclick=()=>{
        ["theme","accent","fs","shape","density","font","wall","bgColor","panelColor","textColor","incomingColor","outgoingColor","profileColor"].forEach(key=>o[key]=DEF[key]);
        applyS(o);bindLook(o,"s");
        $("scustom").value=o.accent;
        [...$("sac").children].forEach(node=>node.classList.toggle("s",node.dataset.c===o.accent));
      };
    }
    if(i===1){
      c.innerHTML=section("Чаты","Настрой переписки, отображение и уведомления.")+'<h4>Отображение</h4>'+toggle("avatars","Показывать аватары")+toggle("h24","24-часовой формат времени")+toggle("enter","Отправлять по Enter","Если выключено — Ctrl+Enter")+toggle("reduceMotion","Уменьшить анимации")+'<h4>Приватность</h4>'+toggle("showOnline","Показывать статус «в сети»")+toggle("readReceipts","Разрешить отметки о прочтении")+'<h4>Уведомления</h4>'+toggle("notifyDesktop","Уведомления на рабочем столе")+toggle("notifySound","Звуковые уведомления")+'<button type="button" id="enable-browser-notifications" style="width:100%;margin-top:10px">Разрешить уведомления браузера</button><small id="browser-notification-status" class="mut"></small><p class="mut settings-footnote">Изменения сохраняются в аккаунте и синхронизируются между устройствами.</p>';
      c.querySelectorAll("[data-k]").forEach(x=>x.onchange=()=>o[x.dataset.k]=x.checked);
      $("browser-notification-status").textContent=("Notification" in window)?"Статус: "+Notification.permission:"Браузер не поддерживает уведомления";
      $("enable-browser-notifications").onclick=async()=>{
        if(!("Notification" in window)){$("browser-notification-status").textContent="Нет поддержки уведомлений.";return}
        const permission=await Notification.requestPermission();
        $("browser-notification-status").textContent="Статус: "+permission;
      };
    }
    if(i===2){
      c.innerHTML=section("Медиа","Управляй загрузкой фотографий и файлов.")+'<h4>Загрузка</h4>'+toggle("autoDownload","Загружать превью сразу","Изображения и аудио будут подгружаться заранее.")+toggle("compressImages","Сжимать большие фотографии","Уменьшает размер изображений перед отправкой.")+toggle("autoPlayMedia","Автовоспроизведение аудио и видео")+'<div class="settings-info-card"><b>Ограничения файлов</b><span>До 20 МБ на один файл. Фото профиля обрезается до квадратного изображения с круглой маской.</span></div><p class="mut settings-footnote">Фотографии и вложения хранятся в Firebase Storage.</p>';
      c.querySelectorAll("[data-k]").forEach(x=>x.onchange=()=>o[x.dataset.k]=x.checked);
    }
    if(i===0){
      const tokenInfo = await currentUser.getIdTokenResult();
      if(renderVersion!==settingsRenderVersion)return;
      const adminButton = tokenInfo.claims.frossAdmin === true ? '<hr style="border:0;border-top:1px solid var(--line);margin:14px 0"><p class="mut">Только для администратора тестового проекта. Удаляет все Auth-аккаунты, профили, чаты и файлы.</p><button class="dg" id="wipeAll" style="width:100%">☠ Удалить ВСЕ тестовые аккаунты</button><div id="wipeBox"></div>' : "";
      c.innerHTML='<div class="sum"><div><b>Подтверждение номера</b><small class="mut">Введи номер, открой Telegram-бот FROSS и отправь свой контакт. Код придёт только в Telegram.</small></div></div><div id="phoneError" class="phone-verify-status">'+(me.phoneVerified?"Номер подтверждён: "+esc(me.phoneNumber):"Номер не подтверждён.")+'</div><label style="margin-top:16px;margin-bottom:6px">Номер телефона</label><input id="phoneNumber" type="tel" autocomplete="tel" placeholder="+447700900123" value="'+esc(me.phoneNumber||currentUser.phoneNumber||"")+'"><button type="button" class="pr" id="phoneViaTelegram" style="width:100%">Отправить код в Telegram</button><label style="margin-top:16px;margin-bottom:6px">Код из Telegram</label><input id="phoneCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6 цифр"><button type="button" class="pr" id="phoneConfirm" style="width:100%">Подтвердить номер</button><label class="phone-visibility"><input type="checkbox" id="phoneVisible" '+(me.phoneVisible?"checked":"")+(me.phoneVerified?"":" disabled")+'><span>Показывать номер в публичном профиле</span></label><hr style="border:0;border-top:1px solid var(--line);margin:14px 0"><hr style="border:0;border-top:1px solid var(--line);margin:14px 0"><div class="row"><button id="lo">Выйти</button><button class="dg" id="dl">Удалить аккаунт</button></div><div id="db"></div>'+adminButton;
      $("lo").onclick=()=>{
        openM('<div class="logout-confirm"><h3>Выйти из FROSS?</h3><p class="mut">Текущая сессия на этом устройстве будет завершена.</p><div class="row"><button type="button" id="logout-cancel">Отмена</button><button type="button" class="pr" id="logout-confirm">Выйти</button></div></div>');
        $("logout-cancel").onclick=closeM;
        $("logout-confirm").onclick=async()=>{closeM();document.body.classList.remove("ch");await logout()};
      };
      let phoneChallengeId=null;
      $("phoneViaTelegram").onclick=async()=>{
        const phone=$("phoneNumber").value.trim().replace(/[\s().-]/g,"");
        if(!/^\+[1-9]\d{7,14}$/.test(phone)){$("phoneError").textContent="Введи номер в международном формате, например +447700900123.";return}
        const button=$("phoneViaTelegram"),label=button.textContent,botWindow=window.open("about:blank","_blank");
        button.disabled=true;button.textContent="Открываем Telegram…";
        try{
          const token=await currentUser.getIdToken(true);
          const response=await fetch(FROSS_API_ORIGIN+"/api/phone/start",{
            method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
            body:JSON.stringify({phone})
          });
          const result=await response.json().catch(()=>({}));
          if(!response.ok)throw new Error(result.error||("Сервер FROSS ответил HTTP "+response.status+"."));
          phoneChallengeId=result.challengeId;
          const verificationBotUrl=result.botUrl||("https://t.me/FROSS_verification_bot?start="+encodeURIComponent(result.challengeId));
          if(botWindow)botWindow.location.href=verificationBotUrl;else window.location.href=verificationBotUrl;
          $("phoneError").textContent="Открылся @FROSS_verification_bot. Нажми «Поделиться номером телефона», отправь свой контакт и вернись сюда за кодом.";
        }catch(error){
          botWindow?.close();
          $("phoneError").textContent=error instanceof TypeError?"Нет соединения с сервером FROSS. Проверь публикацию Cloudflare Worker и секреты Telegram-бота.":(error.message||authError(error));
        }finally{button.disabled=false;button.textContent=label}
      };
      $("phoneConfirm").onclick=async()=>{
        const code=$("phoneCode").value.trim();
        if(!phoneChallengeId){$("phoneError").textContent="Сначала запроси код через Telegram.";return}
        if(!/^\d{6}$/.test(code)){$("phoneError").textContent="Введи шесть цифр из Telegram-бота.";return}
        const button=$("phoneConfirm");button.disabled=true;button.textContent="Проверяем…";
        try{
          const token=await currentUser.getIdToken(true);
          const response=await fetch(FROSS_API_ORIGIN+"/api/phone/confirm",{
            method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
            body:JSON.stringify({challengeId:phoneChallengeId,code})
          });
          const result=await response.json().catch(()=>({}));
          if(!response.ok)throw new Error(result.error||("Подтверждение отклонено (HTTP "+response.status+")."));
          me.phoneNumber=$("phoneNumber").value.trim().replace(/[\s().-]/g,"");
          me.phoneVerified=true;me.telegramLinked=true;me.phoneStatus=me.phoneVisible?"visible":"hidden";
          phoneChallengeId=null;$("phoneCode").value="";$("phoneVisible").disabled=false;
          $("phoneError").style.color="#3ddc84";
          $("phoneError").textContent="Номер подтверждён через Telegram. Привязка бота сохранена.";
        }catch(error){$("phoneError").textContent=error.message||authError(error)}
        finally{button.disabled=false;button.textContent="Подтвердить номер"}
      };
      $("phoneVisible").onchange=async()=>{
        const visible=$("phoneVisible").checked;
        if(visible&&!me.phoneVerified){$("phoneVisible").checked=false;$("phoneError").textContent="Сначала подтверди номер через Telegram.";return}
        try{
          const phonePublic=visible?(me.phoneNumber||""):"";
          const batch=writeBatch(db);
          batch.update(doc(db,"users",me.uid),{phoneVisible:visible,updatedAt:serverTimestamp()});
          batch.set(doc(db,"publicUsers",me.uid),{phoneStatus:visible?"visible":"hidden",phonePublic},{merge:true});
          await batch.commit();
          me.phoneVisible=visible;me.phonePublic=phonePublic;me.phoneStatus=visible?"visible":"hidden";
          $("phoneError").textContent=visible?"Номер показывается в публичном профиле.":"Номер скрыт от других пользователей.";
        }catch(error){$("phoneVisible").checked=!visible;$("phoneError").textContent=authError(error)}
      };
      if (adminButton) {
        $("wipeAll").onclick = () => {
          $("wipeBox").innerHTML = '<label>Для продолжения введите точно: DELETE ALL ACCOUNTS</label><input id="wipePhrase" autocomplete="off"><div class="err" id="wipeError"></div><button class="dg" id="wipeConfirm" style="width:100%">Подтвердить полное удаление</button>';
          $("wipeConfirm").onclick = async () => {
            const phrase = $("wipePhrase").value;
            if (phrase !== "DELETE ALL ACCOUNTS") { $("wipeError").textContent = "Фраза не совпадает."; return; }
            if (!confirm("Это необратимо удалит ВСЕ аккаунты Firebase, профили, чаты и файлы. Продолжить?")) return;
            try {
              const token = await currentUser.getIdToken(true);
              const response = await fetch("https://us-central1-fross-ca5d6.cloudfunctions.net/testDeleteAllAccounts",{
                method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},
                body:JSON.stringify({confirmation:phrase})
              });
              const result = await response.json().catch(()=>({}));
              if (!response.ok) throw new Error(result.error||("HTTP "+response.status));
              alert("Удалено аккаунтов: "+result.deletedUsers+". Страницу сейчас перезагрузит.");
              await signOut(auth);
              location.reload();
            } catch(e) { $("wipeError").textContent = e.message||authError(e); }
          };
        };
      }
      $("dl").onclick=()=>{
        const hasGoogle=currentUser.providerData.some(provider=>provider.providerId==="google.com");
        const hasPassword=currentUser.providerData.some(provider=>provider.providerId==="password");
        $("db").innerHTML='<label>После подтверждения в Telegram аккаунт будет удалён через 24 часа. До истечения срока удаление можно отменить в боте FROSS. Личные чаты будут очищены позже.</label>'+(hasGoogle?'':'<input id="dp" type="password" autocomplete="current-password" placeholder="Пароль для подтверждения">')+'<div class="err" id="de"></div><button class="dg" id="dk" style="width:100%">Подтвердить удаление аккаунта</button>';
        $("dk").onclick=async()=>{
          try{
            if(!confirm("Отправить запрос на удаление? В Telegram нужно будет подтвердить действие. После подтверждения будет 24 часа на отмену."))return;
            if(hasGoogle)await reauthenticateWithPopup(currentUser,new GoogleAuthProvider());
            else if(hasPassword)await reauthenticateWithCredential(currentUser,EmailAuthProvider.credential(currentUser.email,$("dp").value));
            else throw new Error("Для удаления аккаунта войдите повторно через привязанный способ входа.");
            const token=await currentUser.getIdToken(true);
            const response=await fetch("https://us-central1-fross-ca5d6.cloudfunctions.net/requestAccountDeletion",{method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},body:"{}"});
            const result=await response.json().catch(()=>({}));
            if(!response.ok)throw new Error(result.error||("HTTP "+response.status));
            $("de").style.color="#3ddc84";$("de").textContent="Запрос отправлен в Telegram. Подтверди удаление в боте. После подтверждения будет 24 часа на отмену.";
          }catch(e){$("de").textContent=authError(e)}
        };
      };
    }
  };
  document.querySelectorAll(".settings-category").forEach(b=>b.onclick=()=>show(Number(b.dataset.i)));
  show(startCategory);
  $("sx").onclick=()=>{S=backup;applyS(S);closeM();document.body.classList.remove("ch");$("nav-chats").classList.add("active");$("nav-people").classList.remove("active")};
  $("ss").onclick=async()=>{
    const saveButton=$("ss"),originalLabel=saveButton.textContent;
    saveButton.disabled=true;saveButton.textContent=P.avatarDirty?"Загружаем фото…":"Сохраняем…";
    try{
      const username = P.username.trim().toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(username)) throw new Error("Username: 3–20 символов, латиница, цифры и _.");
      const previousAvatarUrl=me.avatarUrl||"";
      const avatarUrl = P.avatarDirty ? await uploadAvatar(me.uid,P.avatarUrl) : (P.avatarUrl||"");
      const publicRef = doc(db,"publicUsers",me.uid);
      const oldUsername = (me.username||"").toLowerCase();
      if (username !== oldUsername) {
        await runTransaction(db,async tx => {
          const newIndex = doc(db,"usernameIndex",username);
          const oldIndex = doc(db,"usernameIndex",oldUsername);
          const taken = await tx.get(newIndex);
          if (taken.exists() && taken.data().uid !== me.uid) throw new Error("Это имя пользователя уже занято.");
          const old = await tx.get(oldIndex);
          if (old.exists() && old.data().uid === me.uid) tx.delete(oldIndex);
          tx.set(newIndex,{uid:me.uid,username,usernameLower:username,createdAt:serverTimestamp()});
          tx.update(publicRef,{
            username,usernameLower:username,
            displayName:P.displayName||username,bio:P.bio||"",avatarUrl,profileColor:o.profileColor||P.profileColor||DEF.profileColor,lastSeenAt:serverTimestamp()
          });
        });
      } else {
        await setDoc(publicRef,{username,usernameLower:username,displayName:P.displayName||username,bio:P.bio||"",avatarUrl,profileColor:o.profileColor||P.profileColor||DEF.profileColor},{merge:true});
      }
      const privateRef=doc(db,"users",me.uid);
      await setDoc(privateRef,{contactEmail:P.contactEmail||"",settings:o,updatedAt:serverTimestamp()},{merge:true});
      const [savedProfile,savedSettings]=await Promise.all([getDoc(publicRef),getDoc(privateRef)]);
      if(!savedProfile.exists())throw new Error("Профиль не сохранился в Firebase. Проверьте правила Firestore.");
      if((savedProfile.data().avatarUrl||"")!==(avatarUrl||""))throw new Error("Firebase не сохранил ссылку на новое фото профиля.");
      if(!savedSettings.exists()||!savedSettings.data().settings)throw new Error("Настройки не сохранились в Firebase.");
      const persisted=savedSettings.data().settings;
      for(const key of Object.keys(o))if(JSON.stringify(persisted[key]??DEF[key])!==JSON.stringify(o[key]))throw new Error("Firebase не сохранил параметр «"+key+"». Проверьте правила Firestore.");
      Object.assign(me,{username,usernameLower:username,displayName:P.displayName||username,bio:P.bio||"",avatarUrl,profileColor:o.profileColor||P.profileColor||DEF.profileColor,contactEmail:P.contactEmail||""});
      if(previousAvatarUrl.startsWith("filebase:")&&previousAvatarUrl!==avatarUrl)privateFileApi("/api/files/delete-avatar",{path:previousAvatarUrl.slice(9)}).catch(error=>console.warn("Old avatar cleanup failed:",error.message));
      S={...DEF,...o};me.settings={...S};P.avatarDirty=false;
      try{localStorage.setItem("fross-settings-"+me.uid,JSON.stringify(S))}catch{}
      applyS(S);fillMe();closeM();head();renderList();
      if (username !== oldUsername) location.reload();
    }catch(e){alert(authError(e));saveButton.disabled=false;saveButton.textContent=originalLabel}
  };
};
$("me-profile").onclick=()=>{window.FROSS_SETTINGS_START=3;$("gb").click()};
async function logout(){closeM();document.body.classList.remove("ch");if(stopChats)stopChats();if(stopMessages)stopMessages();clearProfileObservers(chatProfileStops);clearProfileObservers(messageProfileStops);clearChatNotificationObservers();if(presenceTimer)clearInterval(presenceTimer);await signOut(auth);}
async function bootFromAuth(user){await boot(user)}
onAuthStateChanged(auth,async user=>{
  if(user){if(!creatingAccount){if(user.providerData.some(p=>p.providerId==="password")&&!user.emailVerified){const token=await user.getIdTokenResult();if(token.claims.legacyAccount!==true){signOut(auth);return}}bootFromAuth(user)}}
  else{
    currentUser=null;me=null;bootedUid=null;
    if(stopChats)stopChats();if(stopMessages)stopMessages();clearProfileObservers(chatProfileStops);clearProfileObservers(messageProfileStops);clearChatNotificationObservers();if(presenceTimer)clearInterval(presenceTimer);
    showLogin();
  }
});

import("./voice-calls.js").catch(error => console.error("Voice calls failed to load:", error));


/* Static mascot: deliberately no blinking or movement script. */

/* Bottom navigation and the relocated create action */
(()=>{
  const oldCreate=document.getElementById("nb")?.onclick;
  const q=document.getElementById("q");
  const people=document.getElementById("nav-people");
  const chats=document.getElementById("nav-chats");
  if(people)people.onclick=()=>{
    chats?.classList.remove("active");people.classList.add("active");
    window.FROSS_SETTINGS_START=1;$("gb").click();
  };
  if(chats)chats.onclick=()=>{
    if($("ov").classList.contains("o")){applyS(S);closeM()}
    if(q){q.value="";q.placeholder="Найти человека или чат";q.dispatchEvent(new Event("input"));}
    chats.classList.add("active");people?.classList.remove("active");
    document.body.classList.remove("ch");
  };
  const create=document.getElementById("nb");
  if(create)create.onclick=()=>{
    openM('<div class="create-sheet"><div class="sheet-grab"></div><h3>Создать чат</h3><p class="mut">Что хочешь создать?</p><button class="create-option" id="make-dm"><span class="option-icon"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3 20c.5-3.5 2.5-5.5 6-5.5s5.5 2 6 5.5M17 8h5m-2.5-2.5v5"/></svg></span><span><b>Личный чат</b><small>Найти человека и написать ему</small></span></button><button class="create-option" id="make-group"><span class="option-icon"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 20c.5-3.5 2.5-5.5 6.5-5.5s6 2 6.5 5.5M15 15c3.5-.2 5.5 1.5 6 4.5"/></svg></span><span><b>Группа</b><small>Общение с несколькими людьми</small></span></button><button class="sheet-cancel" id="cancel-create">Отмена</button></div>');
    document.getElementById("cancel-create").onclick=closeM;
    document.getElementById("make-dm").onclick=()=>{closeM();oldCreate?.call(create);document.getElementById("t1")?.click()};
    document.getElementById("make-group").onclick=()=>{closeM();oldCreate?.call(create);document.getElementById("t2")?.click()};
  };
})();
