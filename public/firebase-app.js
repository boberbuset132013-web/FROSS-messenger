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
const DEF = {allowForwarding:true,allowProfileFromForward:true,theme:"dark",accent:"#b45cff",fs:15,shape:"round",density:"normal",font:"system",enter:true,h24:true,wall:"dots",avatars:true,bgColor:"#080611",panelColor:"#110b1d",textColor:"#f7f0ff",incomingColor:"#21152f",outgoingColor:"#8429c8",profileColor:"#b45cff",notifyDesktop:true,notifySound:true,readReceipts:true,showOnline:true,autoDownload:false,compressImages:true,autoPlayMedia:false,reduceMotion:false};
const ACC = ["#9181ff","#3b82f6","#10b981","#f59e0b","#ef4444","#ec4899","#06b6d4"];
let currentUser=null, me=null, S={...DEF}, cur="", chats=[], found=[];
const SYSTEM_CHAT_ID="system:fross";
let systemInboxMessages=[],systemInboxLoaded=false,systemInboxError="",systemInboxLoading=null,systemInboxTimer=null;
let globalAudioTrackKey="", globalAudioRequest=0, globalAudioAttachment=null, globalAudioRetryUsed=false;
let globalAudioPlayer=null, globalAudioSpeed=1;
const GLOBAL_AUDIO_SPEEDS=[1,1.25,1.5,2];
let stopChats=null, stopMessages=null, presenceTimer=null, searchTimer=null, W=null, creatingAccount=false, bootedUid=null, reactionStops=[];
let chatProfileStops=new Map(),messageProfileStops=new Map();
let peopleSearchSequence=0,reactionSubscriptions=new Map();
let chatNotificationStops=new Map(),chatNotificationSeen=new Map(),notificationAudioContext=null;
window.FROSS = {
  get authUser(){return currentUser},get profile(){return me},get chatId(){return cur},get apiOrigin(){return FROSS_API_ORIGIN},
  renderAvatar:(element,profile)=>avatar(element,profile),
  notifyIncomingCall:(profile,callId)=>{
    if(!S.notifyDesktop||!("Notification" in window)||Notification.permission!=="granted")return;
    try{
      const n=new Notification("Входящий звонок",{body:(profile?.username?("@"+String(profile.username).replace(/^@/,"")):(profile?.displayName||"Пользователь"))+" звонит тебе",icon:"/fross-icon.webp",tag:"fross-call-"+callId,requireInteraction:true});
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
 const root=document.documentElement,theme=s.theme||"dark";
 const autoLight=theme==="auto"&&window.matchMedia?.("(prefers-color-scheme: light)").matches;
 const light=theme==="light"||autoLight;
 const base=light?{bg:"#f2f4f8",panel:"#ffffff",text:"#202331",incoming:"#e8ebf2",outgoing:"#7b35c7",muted:"#687083",line:"#dfe3ec"}:{bg:"#080611",panel:"#110b1d",text:"#f7f0ff",incoming:"#21152f",outgoing:s.accent||"#b45cff",muted:"#a99ab9",line:"#302044"};
 const defaultMap={bgColor:DEF.bgColor,panelColor:DEF.panelColor,textColor:DEF.textColor,incomingColor:DEF.incomingColor,outgoingColor:DEF.outgoingColor};
 const use=(key,fallback)=>!s[key]||s[key]===defaultMap[key]?fallback:s[key];
 const bg=use("bgColor",base.bg),panel=use("panelColor",base.panel),text=use("textColor",base.text),accent=s.accent||DEF.accent;
 const incoming=use("incomingColor",base.incoming),outgoing=use("outgoingColor",light?base.outgoing:accent);
 const font=s.font==="rounded"?"Trebuchet MS,Arial,sans-serif":s.font==="mono"?"ui-monospace,SFMono-Regular,monospace":s.font==="serif"?"Georgia,serif":s.font==="humanist"?"Verdana,Arial,sans-serif":"Inter,system-ui,sans-serif";
 root.dataset.theme=light?"light":"dark";root.dataset.themeMode=theme;root.style.colorScheme=light?"light":"dark";
 const vars={"--bg":bg,"--panel":panel,"--text":text,"--accent":accent,"--incoming":incoming,"--outgoing":outgoing,
  "--muted":base.muted,"--muted-text":"color-mix(in srgb,"+text+" 62%,transparent)","--p2":"color-mix(in srgb,"+panel+" 90%,"+text+" 10%)",
  "--line":"color-mix(in srgb,"+panel+" 78%,"+text+" 22%)","--surface":panel,"--surface-raised":"color-mix(in srgb,"+panel+" 92%,"+text+" 8%)",
  "--space-night":bg,"--space-glass":panel,"--space-stroke":"color-mix(in srgb,"+text+" 14%,transparent)",
  "--space-shadow":light?"0 16px 40px rgba(30,38,58,.10)":"0 18px 48px rgba(0,0,0,.28)",
  "--profile-accent":s.profileColor||accent,"--fs":(Number(s.fs)||DEF.fs)+"px","--br":s.shape==="pill"?"24px":s.shape==="square"?"5px":"16px",
  "--pad":s.density==="compact"?"5px":s.density==="comfortable"?"13px":"10px","--font":font,"--app-muted":base.muted,"--app-border":base.line};
 for(const [key,value] of Object.entries(vars))root.style.setProperty(key,value);
 if($("msgs"))$("msgs").dataset.w=s.wall||"none";
 root.classList.toggle("reduce-motion",!!s.reduceMotion);
 const themeMeta=document.querySelector('meta[name="theme-color"]');
 if(themeMeta)themeMeta.setAttribute("content",light?bg:"#080611");
 if(theme==="auto"&&!root.dataset.autoThemeListener&&window.matchMedia){
  const media=window.matchMedia("(prefers-color-scheme: light)"),listener=()=>{if(S?.theme==="auto")applyS(S)};
  if(media.addEventListener)media.addEventListener("change",listener);else media.addListener?.(listener);
  root.dataset.autoThemeListener="1";
 }
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
    const playing=active&&!audio.paused;
    button.innerHTML=audioMessageIcon(playing);
    button.setAttribute("aria-label",playing?"Пауза":"Воспроизвести аудио");
    button.title=playing?"Пауза":"Воспроизвести";
    const hint=button.closest('.message-audio-player')?.querySelector('.audio-player-hint');
    if(hint)hint.textContent=active?(audio.paused?"На паузе":"Сейчас воспроизводится"):"Аудио";
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

function audioMessageIcon(playing) {
  return playing
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3v14H7zM14 5h3v14h-3z"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.7c0-.8.9-1.3 1.6-.9l9.1 6.3a1.1 1.1 0 0 1 0 1.8l-9.1 6.3c-.7.5-1.6-.1-1.6-.9z"/></svg>';
}
function createAudioMessagePlayer(attachment) {
  const key=String(attachment.path||attachment.url||attachment.name||"audio");
  const player=document.createElement('div');player.className='message-audio-player';
  const top=document.createElement('div');top.className='audio-player-top';
  const button=document.createElement('button');button.type='button';button.className='audio-play-button';button.dataset.audioKey=key;
  button.setAttribute('aria-label','Воспроизвести аудио');button.title='Воспроизвести';button.innerHTML=audioMessageIcon(false);
  const meta=document.createElement('div');meta.className='audio-player-meta';
  const name=document.createElement('div');name.className='audio-player-name';
  name.textContent=String(attachment.name||'Аудиофайл').replace(/\.(mp3|m4a|ogg|wav|flac|aac|opus)$/i,'').replace(/[_]+/g,' ');
  const hint=document.createElement('div');hint.className='audio-player-hint';hint.textContent='Аудио';
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
  const color=(key,label)=>'<label class="custom-color-field"><span>'+label+'</span><input type="color" id="'+pre+key+'" value="'+(o[key]||DEF[key]||"#9181ff")+'"></label>';
  return '<div class="custom-section"><h4>Тема приложения</h4><p>Выбери светлый, тёмный режим или оформление устройства.</p><label for="'+pre+'th">Режим</label><select id="'+pre+'th"><option value="dark">Тёмная</option><option value="light">Светлая</option><option value="auto">Как в системе</option></select></div>'+
  '<div class="custom-section"><h4>Цветовая палитра</h4><p>Цвета применяются к меню, перепискам, карточкам и настройкам.</p><label>Акцентный цвет</label>'+swatches(pre+"ac",o.accent)+color("custom","Свой акцент")+
  color("bgColor","Фон приложения")+color("panelColor","Панели и меню")+color("textColor","Основной текст")+color("incomingColor","Входящие сообщения")+color("outgoingColor","Мои сообщения")+color("profileColor","Публичный цвет профиля")+'</div>'+
  '<div class="custom-section"><h4>Текст и сообщения</h4><label>Размер текста · <span id="'+pre+'fs-value">'+(Number(o.fs)||DEF.fs)+' px</span></label><input id="'+pre+'fs" type="range" min="13" max="22" value="'+(Number(o.fs)||DEF.fs)+'"><label>Форма сообщений</label><select id="'+pre+'sh"><option value="round">Скруглённые</option><option value="pill">Овальные</option><option value="square">Квадратные</option></select><label>Шрифт</label><select id="'+pre+'font"><option value="system">Современный системный</option><option value="rounded">Мягкий округлый</option><option value="humanist">Чёткий гуманистический</option><option value="serif">С засечками</option><option value="mono">Моноширинный</option></select><label>Плотность интерфейса</label><select id="'+pre+'density"><option value="comfortable">Просторная</option><option value="normal">Обычная</option><option value="compact">Компактная</option></select></div>'+
  '<div class="custom-section"><h4>Фон переписки</h4><p>Обои чата независимы от общей темы приложения.</p><select id="'+pre+'wall"><option value="none">Однотонный</option><option value="dots">Мягкие точки</option><option value="grad">Мягкий градиент</option><option value="grid">Тонкая сетка</option></select></div>';
}
function bindLook(o,pre) {
  const syncAccent=()=>{[...$(pre+"ac").children].forEach(x=>x.classList.toggle("s",x.dataset.c===(o.accent||DEF.accent)))};
  $(pre+"custom").value=o.accent||DEF.accent;
  $(pre+"th").value=o.theme||"dark";$(pre+"sh").value=o.shape||"round";$(pre+"font").value=o.font||"system";$(pre+"density").value=o.density||"normal";$(pre+"wall").value=o.wall||"none";
  $(pre+"fs").value=Number(o.fs)||DEF.fs;
  ["bgColor","panelColor","textColor","incomingColor","outgoingColor","profileColor"].forEach(k=>{$(pre+k).value=o[k]||DEF[k];$(pre+k).oninput=e=>{o[k]=e.target.value;applyS(o)}});
  $(pre+"font").onchange=e=>{o.font=e.target.value;applyS(o)};$(pre+"density").onchange=e=>{o.density=e.target.value;applyS(o)};$(pre+"wall").onchange=e=>{o.wall=e.target.value;applyS(o)};
  $(pre+"custom").oninput=e=>{o.accent=e.target.value;applyS(o);syncAccent()};
  $(pre+"th").onchange=e=>{o.theme=e.target.value;applyS(o)};
  $(pre+"sh").onchange=e=>{o.shape=e.target.value;applyS(o)};
  $(pre+"fs").oninput=e=>{o.fs=+e.target.value;const label=$(pre+"fs-value");if(label)label.textContent=o.fs+" px";applyS(o)};
  $(pre+"ac").onclick=e=>{const color=e.target.dataset.c;if(!color)return;o.accent=color;$(pre+"custom").value=color;applyS(o);syncAccent()};
  syncAccent();
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
  return{title:c.title||"Группа",avatar:{uid:me.uid,title:c.title||"G",displayName:c.title||"Группа",avatarUrl:c.groupAvatarUrl||"",profileColor:c.groupAvatarColor||"#8b5cf6"},sub:(c.memberUids||[]).length+" участн."};
}
function item(o,title,sub,online,active,fn) {
  const d=document.createElement("div");d.className="it"+(active?" a":"");
  d.innerHTML='<div class="av"></div><div class="t"><b>'+esc(title)+'</b><small>'+esc(sub||"")+'</small></div>';
  avatar(d.firstChild,o,online);d.onclick=fn;return d;
}
function showToast(message){
  let host=document.getElementById("fross-toast-host");
  if(!host){host=document.createElement("div");host.id="fross-toast-host";host.setAttribute("aria-live","polite");document.body.append(host)}
  const node=document.createElement("div");node.className="fross-toast";node.textContent=String(message||"");host.append(node);
  requestAnimationFrame(()=>node.classList.add("visible"));
  setTimeout(()=>{node.classList.remove("visible");setTimeout(()=>node.remove(),220)},3200);
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
      const latest=snapshot.docs[0],previous=chatNotificationSeen.get(chat.id);
      if(!latest){if(previous===undefined)chatNotificationSeen.set(chat.id,null);return}
      const message={id:latest.id,...latest.data()};chatNotificationSeen.set(chat.id,message.id);
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
  if(!systemInboxLoaded&&!systemInboxMessages.length){
    const empty=document.createElement("div");empty.className="empty";empty.textContent=systemInboxError||"Загрузка чата FROSS…";box.append(empty);return;
  }
  if(!systemInboxMessages.length){
    const empty=document.createElement("div");empty.className="empty";empty.textContent="Здесь будут появляться системные уведомления FROSS о безопасности, аккаунте и важных обновлениях.";box.append(empty);return;
  }
  for(const message of systemInboxMessages){
    const isUser=message.role==="user";
    const row=document.createElement("div");row.className="mr system-message"+(isUser?" me":"");row.dataset.messageId=message.id||"";
    const bubble=document.createElement("div");bubble.className="msg";
    const sender=document.createElement("small");sender.className="system-message-sender";sender.textContent=isUser?"Ты":"FROSS";bubble.append(sender);
    const body=document.createElement("div");body.textContent=message.text||"";bubble.append(body);
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
  const matches=new Map();let indexedQueryFailed=false;
  const add=docs=>docs.forEach(snapshot=>{
    if(!snapshot.exists())return;
    const data=snapshot.data();
    if(data.deleted===true||snapshot.id===me.uid)return;
    const name=String(data.usernameLower||data.username||"").toLowerCase();
    if(name.startsWith(normalized))matches.set(snapshot.id,{uid:snapshot.id,...data});
  });
  const safeQuery=async queryRef=>{
    try{const result=await getDocs(queryRef);add(result.docs)}
    catch(error){indexedQueryFailed=true;console.warn("FROSS profile search fallback:",error?.code||error?.message||error)}
  };
  const profiles=collection(db,"publicUsers");
  await safeQuery(query(profiles,orderBy("usernameLower"),startAt(normalized),endAt(normalized+"\uf8ff"),limit(maxResults)));
  if(matches.size<maxResults)await safeQuery(query(profiles,orderBy("username"),startAt(normalized),endAt(normalized+"\uf8ff"),limit(maxResults)));
  if(indexedQueryFailed&&matches.size<maxResults){
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
  const value=term.trim().toLowerCase().replace(/^@/,""),sequence=++peopleSearchSequence;
  if(value.length<2){found=[];renderList();return}
  try{
    const results=await findPublicProfiles(value,20);
    if(sequence!==peopleSearchSequence||$("q").value.trim().toLowerCase().replace(/^@/,"")!==value)return;
    found=results;renderList();
  }catch(error){if(sequence!==peopleSearchSequence)return;console.error("FROSS user search failed:",error);found=[];renderList()}
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
  const composer=document.querySelector(".comp");
  if(composer)composer.style.display=cur&&cur!==SYSTEM_CHAT_ID?"flex":"none";
  if($("inp"))$("inp").disabled=!cur||cur===SYSTEM_CHAT_ID;
  if(cur===SYSTEM_CHAT_ID){
    avatar(avatarElement,{displayName:"FROSS",profileColor:"#a855f7"});
    titleElement.innerHTML='FROSS <span class="verified-mark" title="Официальный системный бот">✓</span>';
    subtitleElement.textContent="Системные уведомления";
    avatarElement.onclick=null;titleElement.onclick=null;avatarElement.style.cursor="default";titleElement.style.cursor="default";
    if($("call"))$("call").style.display="none";
    $("bots-open-button")?.remove();$("fross-model-button")?.remove();$("chat-settings").style.display="none";
    return;
  }
  $("bots-open-button")?.remove();$("fross-model-button")?.remove();$("chat-settings").style.display="";
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
    if($("inp")){$("inp").placeholder="Системные уведомления";$("inp").maxLength=4000;}
    if($("attach"))$("attach").style.display="none";
    subscribeMessages();loadSystemInbox();return;
  }
  const chat=chats.find(item=>item.id===id);if(!chat)return;
  const composer=document.querySelector(".comp");if(composer)composer.style.display="flex";
  if($("inp")){$("inp").placeholder="Сообщение…";$("inp").maxLength=4000;}
  if($("attach"))$("attach").style.display="";
  cur=id;document.body.classList.add("ch");renderList();head();subscribeMessages();
  if(chat.type==="dm"){
    const other=(chat.memberProfiles||[]).find(person=>person.uid!==me.uid);
    if(other?.uid)loadChatProfile(other.uid).then(profile=>{Object.assign(other,profile);renderList();head()}).catch(()=>{});
  }
}
const MESSAGE_EMOJIS=["❤️","😂","👍","🔥","😮","😢","🙏","🎉","💯","👀","😍","🥰","😘","🤔","👏","🙌","🤝","💔","😭","😎","🥳","🤩","🤗","😡","🤯","💀","✨","🚀","☕","💖"];
async function downloadMessageAttachment(message) {
  const attachment=message?.attachment;
  if(!attachment?.url){showToast("У этого сообщения нет доступного файла.");return}
  try{
    if(attachment.external){
      try{await downloadStoredFile(attachment.url,attachment.path,attachment.name||"download")}
      catch(error){const opened=window.open(attachment.url,"_blank","noopener,noreferrer");if(!opened)throw error}
    }else await downloadStoredFile(attachment.url,attachment.path,attachment.name||"download");
    showToast("Загрузка файла началась.");
  }catch(error){showToast(error?.message||"Не удалось скачать файл.")}
}
function openMessageMenu(message,mine,x,y) {
  document.getElementById("message-menu")?.remove();
  const menu=document.createElement("div");menu.id="message-menu";menu.className="message-menu";
  const actions=[["↩ Ответить",()=>{setReplyTarget(message);menu.remove()}],["↪ Переслать",()=>{menu.remove();forwardMessage(message)}],["😊 Реакция",()=>showReactionPicker(message,menu)]];
  if(message.attachment)actions.push(["↓ Скачать "+(message.attachment.type?.startsWith("audio/")?"аудио":"файл"),()=>{menu.remove();downloadMessageAttachment(message)}]);
  actions.push(["📋 Копировать",()=>{navigator.clipboard?.writeText(message.text||message.attachment?.name||"").catch(()=>{});menu.remove()}]);
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
async function forwardMessage(message) {
  if(!cur||cur===SYSTEM_CHAT_ID)return;
  const sourceText=String(message?.text||"").trim(),sourceAttachment=message?.attachment||null;
  if(!sourceText&&!sourceAttachment){showToast("Это сообщение нельзя переслать.");return}
  const available=chats.filter(chat=>chat.id!==SYSTEM_CHAT_ID);
  if(!available.length){showToast("Нет чатов, куда можно переслать сообщение.");return}
  openM('<h3 style="margin:0 0 8px">Переслать сообщение</h3><p class="mut">Выбери чат или группу.</p><div id="forward-chat-list" class="existing-chat-picker"></div><div class="row"><button type="button" id="forward-cancel">Отмена</button></div>');
  $("forward-cancel").onclick=closeM;
  const list=$("forward-chat-list");
  available.forEach(chat=>{
    const info=chatInfo(chat),button=document.createElement("button");
    button.type="button";button.className="forward-chat-option";button.innerHTML='<span class="av forward-destination-avatar"></span><span class="forward-destination-title"></span>';
    avatar(button.querySelector(".forward-destination-avatar"),info.avatar,isOnline(info.avatar));
    button.querySelector(".forward-destination-title").textContent=info.title;
    button.onclick=async()=>{
      button.disabled=true;button.textContent="Пересылаем…";
      try{
        let attachment=null;
        if(sourceAttachment){
          if(sourceAttachment.external===true){
            attachment={name:String(sourceAttachment.name||"Ссылка"),type:String(sourceAttachment.type||"application/octet-stream"),size:0,url:String(sourceAttachment.url||""),path:"",external:true};
          }else{
            const path=String(sourceAttachment.path||String(sourceAttachment.url||"").replace(/^filebase:/,""));
            if(!path)throw new Error("У вложения отсутствует путь к файлу.");
            const token=await currentUser.getIdToken();
            const response=await fetch(FROSS_API_ORIGIN+"/api/files/download",{method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({path,name:sourceAttachment.name||"forwarded-file"})});
            if(!response.ok){let data={};try{data=await response.json()}catch{};throw new Error(data.error||"Не удалось получить исходный файл для пересылки.")}
            const blob=await response.blob(),name=String(sourceAttachment.name||"forwarded-file");
            const file=new File([blob],name,{type:sourceAttachment.type||blob.type||"application/octet-stream"});
            const uploaded=await uploadChatFile(chat.id,file,token);
            attachment={name,type:file.type,size:file.size,url:uploaded.url,path:uploaded.path,external:false};
          }
        }
        const originalUid=String(message.forwardedFrom?.senderUid||message.senderUid||"");
        let originalProfile={};
        if(!message.forwardedFrom&&originalUid){
          try{const profileSnap=await getDoc(doc(db,"publicUsers",originalUid));if(profileSnap.exists())originalProfile=profileSnap.data()||{}}catch(error){console.warn("FROSS forward profile lookup:",error)}
        }
        const originalName=String(message.forwardedFrom?.displayName||originalProfile.displayName||message.displayName||message.username||originalProfile.username||"Пользователь").slice(0,60);
        const originalUsername=String(message.forwardedFrom?.username||originalProfile.username||message.username||"").replace(/^@/,"").slice(0,20);
        const originalAvatar=String(message.forwardedFrom?.avatarUrl||originalProfile.avatarUrl||message.avatarUrl||"");
        const forwarded={senderUid:me.uid,username:me.username,displayName:me.displayName||me.username,avatarUrl:me.avatarUrl||"",profileColor:me.profileColor||S.profileColor||"",text:sourceText,readBy:[me.uid],createdAt:serverTimestamp(),forwardedFrom:{senderUid:originalUid,displayName:originalName,username:originalUsername,avatarUrl:originalAvatar,profileColor:String(message.forwardedFrom?.profileColor||originalProfile.profileColor||message.profileColor||""),profileAllowed:message.forwardedFrom?message.forwardedFrom.profileAllowed!==false:message.profileForwardAllowed!==false}};
        if(attachment)forwarded.attachment=attachment;
        const preview=sourceText||(attachment?.type?.startsWith("image/")?"Фото":attachment?.type?.startsWith("video/")?"Видео":attachment?.type?.startsWith("audio/")?"Аудио":"Файл");
        await publishChatMessage(chat.id,forwarded,"↪ "+preview);
        closeM();showToast("Сообщение переслано.");
      }catch(error){button.disabled=false;button.querySelector(".forward-destination-title").textContent=info.title;alert(authError(error))}
    };
    list.append(button);
  });
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
  const existing=reactionSubscriptions.get(messageId);
  if(existing){existing.host=host;return}
  const reactionRef=collection(db,"chats",cur,"messages",messageId,"reactions"),entry={host,stop:null};
  const stop=onSnapshot(reactionRef,snap=>{
    const target=entry.host;if(!target?.isConnected)return;
    target.querySelector(".reaction-bar")?.remove();
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
    target.append(bar);
  },e=>console.warn("Reaction listener:",e));
  entry.stop=stop;reactionSubscriptions.set(messageId,entry);reactionStops.push(stop);
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
  reactionStops.forEach(stop=>stop());reactionStops=[];reactionSubscriptions.clear();
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
    box.innerHTML="";
    if(snapshot.empty)box.innerHTML='<div class="empty">Пока нет сообщений. Напишите первым!</div>';
    const activeMessageIds=new Set(snapshot.docs.map(s=>s.id));
    for(const [id,entry] of reactionSubscriptions){if(!activeMessageIds.has(id)){try{entry.stop?.()}catch{}reactionSubscriptions.delete(id)}}
    reactionStops=[...reactionSubscriptions.values()].map(entry=>entry.stop).filter(Boolean);
    let previous="";
    snapshot.docs.forEach(s=>{
      const m={id:s.id,...s.data()},mine=m.senderUid===me.uid,r=document.createElement("div");
      r.className="mr"+(mine?" me":"")+(S.avatars&&!mine&&previous===m.senderUid?" nf":"");
      r.dataset.messageId=m.id;r.dataset.senderUid=m.senderUid||"";
      if(m.senderUid)watchMessageProfile(m.senderUid,box);
      if((m.hiddenFor||[]).includes(me.uid))return;
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
        if(!a.type?.startsWith("audio/")){
          const link=document.createElement("a");link.href=a.external?a.url:"#";link.textContent=a.external?"↗ Открыть внешний файл: "+(a.name||"файл"):"↓ Скачать "+(a.name||"файл")+" ("+Math.max(1,Math.round((a.size||0)/1024))+" КБ)";link.className="attachment-link";
          if(a.external){link.target="_blank";link.rel="noopener noreferrer"}
          else link.addEventListener("click",async event=>{event.preventDefault();try{await downloadStoredFile(a.url,a.path,a.name||"download")}catch(error){alert(error.message)}});
          b.append(link);
        }
      }
      if(m.accountDeletedNotice){b.classList.add("deleted-account-notice");const tag=document.createElement("small");tag.textContent="АККАУНТ УДАЛЁН";tag.style.cssText="display:block;font-size:10px;letter-spacing:.08em;opacity:.7;font-weight:700;margin-bottom:4px";b.append(tag)}
      if(m.forwardedFrom){
        const origin=m.forwardedFrom,forwarded=document.createElement("button");
        forwarded.type="button";forwarded.className="forwarded-label";
        forwarded.innerHTML='<span class="av forwarded-avatar"></span><span class="forwarded-caption"></span>';
        const originName=String(origin.displayName||origin.username||"Пользователь");
        const caption=forwarded.querySelector(".forwarded-caption");
        caption.textContent="Переслано от "+originName+(origin.username&&origin.username.toLowerCase()!==originName.toLowerCase()?" · @"+String(origin.username).replace(/^@/,""):"");
        avatar(forwarded.querySelector(".forwarded-avatar"),{uid:origin.senderUid,displayName:originName,avatarUrl:origin.avatarUrl||"",profileColor:origin.profileColor||""});
        if(origin.profileAllowed!==false&&origin.senderUid){
          forwarded.classList.add("is-link");forwarded.title="Открыть профиль автора исходного сообщения";
          forwarded.onclick=async()=>{try{const profile=await loadChatProfile(origin.senderUid);if(profile.allowProfileFromForward===false){showToast("Автор запретил переход в свой профиль из пересылок.");return}openUserProfile(profile)}catch(error){showToast("Профиль недоступен.")}};
        }else{forwarded.disabled=true;forwarded.title="Переход в профиль отключён автором"}
        b.append(forwarded);
        if(origin.senderUid&&(!origin.displayName||!origin.avatarUrl||!origin.username)){
          getDoc(doc(db,"publicUsers",origin.senderUid)).then(profileSnap=>{
            if(!profileSnap.exists()||!forwarded.isConnected)return;
            const profile=profileSnap.data()||{},resolvedName=String(origin.displayName||profile.displayName||profile.username||"Пользователь");
            caption.textContent="Переслано от "+resolvedName+(origin.username||profile.username?" · @"+String(origin.username||profile.username).replace(/^@/,""):"");
            if(!origin.avatarUrl&&profile.avatarUrl)avatar(forwarded.querySelector(".forwarded-avatar"),{uid:origin.senderUid,displayName:resolvedName,avatarUrl:profile.avatarUrl,profileColor:profile.profileColor||origin.profileColor||""});
            if(!origin.displayName&&profile.displayName)origin.displayName=profile.displayName;
            if(!origin.username&&profile.username)origin.username=profile.username;
          }).catch(error=>console.warn("FROSS forwarded author profile:",error));
        }
      }
      if(m.text){const body=document.createElement("div");appendMentionText(body,m.text,resolveMention);b.append(body)}
      const t=document.createElement("time");const date=m.createdAt?.toDate?m.createdAt.toDate():new Date();t.textContent=date.toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit",hour12:!S.h24})+(m.editedAt?" · изменено":"");if(mine&&cur) {
        const chat=chats.find(item=>item.id===cur),recipients=(chat?.memberUids||[]).filter(uid=>uid!==me.uid);
        if(recipients.length)appendReadReceipt(t,{read:recipients.some(uid=>(m.readBy||[me.uid]).includes(uid))});
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
async function openOwnProfileEditor(profile){
  const P={
    username:me.username||profile.username||"",
    displayName:me.displayName||profile.displayName||"",
    bio:me.bio||profile.bio||"",
    avatarUrl:me.avatarUrl||profile.avatarUrl||"",
    avatarDirty:false,
    phoneNumber:me.phoneNumber||""
  };
  openM('<div class="profile-editor-screen"><header class="profile-editor-heading"><div class="av big profile-editor-avatar" id="profile-edit-avatar"></div><div><h3>Редактировать профиль</h3><p>Изменения увидят другие пользователи</p></div></header><section class="profile-editor-group"><label for="profile-edit-display">Имя</label><input id="profile-edit-display" maxlength="40" autocomplete="name"><label for="profile-edit-username">Username</label><div class="profile-editor-handle"><span>@</span><input id="profile-edit-username" maxlength="20" autocomplete="username"></div><small>3–20 символов: латиница, цифры и _.</small></section><section class="profile-editor-group"><label>Фото профиля</label><div class="profile-edit-photo"><button type="button" id="profile-edit-photo-button">Изменить фото</button><button type="button" id="profile-edit-photo-remove">Удалить фото</button><input id="profile-edit-photo-file" type="file" accept="image/*" hidden><small class="mut" id="profile-edit-photo-state">Текущее фото сохранено</small></div></section><section class="profile-editor-group"><label for="profile-edit-bio">О себе</label><textarea id="profile-edit-bio" rows="3" maxlength="160" placeholder="Расскажи о себе"></textarea></section><section class="profile-editor-group profile-editor-phone"><div><b>Номер телефона</b><small id="profile-edit-phone"></small></div><button type="button" id="profile-edit-phone-change">Изменить</button></section><div class="err" id="profile-edit-error"></div><div class="profile-editor-actions"><button type="button" id="profile-edit-cancel">Отмена</button><button type="button" class="pr" id="profile-edit-save">Сохранить</button></div></div>');
  $("profile-edit-display").value=P.displayName;
  $("profile-edit-username").value=P.username;
  $("profile-edit-bio").value=P.bio;
  $("profile-edit-phone").textContent=P.phoneNumber||"Номер не подтверждён";
  avatar($("profile-edit-avatar"),{...profile,displayName:P.displayName,avatarUrl:P.avatarUrl});
  $("profile-edit-photo-button").onclick=()=>$("profile-edit-photo-file").click();
  $("profile-edit-photo-file").onchange=event=>{
    const file=event.target.files?.[0];event.target.value="";if(!file)return;
    pickImg(file,dataUrl=>{
      P.avatarUrl=dataUrl;P.avatarDirty=true;
      avatar($("profile-edit-avatar"),{...profile,displayName:$("profile-edit-display").value,avatarUrl:dataUrl});
      $("profile-edit-photo-state").textContent="Новое фото готово к сохранению.";
    });
  };
  $("profile-edit-photo-remove").onclick=()=>{
    P.avatarUrl="";P.avatarDirty=true;
    avatar($("profile-edit-avatar"),{displayName:P.displayName,profileColor:me.profileColor});
    $("profile-edit-photo-state").textContent="Фото будет удалено после сохранения.";
  };
  $("profile-edit-display").oninput=()=>P.displayName=$("profile-edit-display").value;
  $("profile-edit-username").oninput=()=>P.username=$("profile-edit-username").value.trim().toLowerCase();
  $("profile-edit-bio").oninput=()=>P.bio=$("profile-edit-bio").value;
  $("profile-edit-phone-change").onclick=()=>{
    closeM();window.FROSS_SETTINGS_START=0;$("gb").click();
  };
  $("profile-edit-cancel").onclick=()=>{closeM();openUserProfile({...me})};
  $("profile-edit-save").onclick=async()=>{
    const button=$("profile-edit-save"),error=$("profile-edit-error"),oldUsername=String(me.username||"").toLowerCase();
    const username=P.username.trim().toLowerCase(),displayName=P.displayName.trim(),bio=P.bio.trim();
    if(!/^[a-z0-9_]{3,20}$/.test(username)){error.textContent="Username: 3–20 символов, латиница, цифры и _.";return}
    if(displayName.length>40){error.textContent="Имя не должно быть длиннее 40 символов.";return}
    if(bio.length>160){error.textContent="Описание не должно быть длиннее 160 символов.";return}
    button.disabled=true;button.textContent="Сохраняем…";
    try{
      const previousAvatar=me.avatarUrl||"",avatarUrl=P.avatarDirty?await uploadAvatar(me.uid,P.avatarUrl):(P.avatarUrl||"");
      const publicRef=doc(db,"publicUsers",me.uid);
      const fields={username,usernameLower:username,displayName:displayName||username,bio,avatarUrl,profileColor:me.profileColor||S.profileColor||DEF.profileColor,lastSeenAt:serverTimestamp()};
      if(username!==oldUsername){
        await runTransaction(db,async tx=>{
          const nextRef=doc(db,"usernameIndex",username),oldRef=doc(db,"usernameIndex",oldUsername);
          const taken=await tx.get(nextRef);
          if(taken.exists()&&taken.data().uid!==me.uid)throw new Error("Этот username уже занят.");
          const old=await tx.get(oldRef);
          if(old.exists()&&old.data().uid===me.uid)tx.delete(oldRef);
          tx.set(nextRef,{uid:me.uid,username,usernameLower:username,createdAt:serverTimestamp()});
          tx.update(publicRef,fields);
        });
      }else{
        await setDoc(publicRef,fields,{merge:true});
      }
      const saved=await getDoc(publicRef);
      if(!saved.exists()||saved.data().username!==username||saved.data().bio!==bio)throw new Error("Не удалось проверить сохранение профиля.");
      Object.assign(me,{username,usernameLower:username,displayName:displayName||username,bio,avatarUrl});
      Object.assign(profile,me);
      if(previousAvatar.startsWith("filebase:")&&previousAvatar!==avatarUrl)privateFileApi("/api/files/delete-avatar",{path:previousAvatar.slice(9)}).catch(error=>console.warn("Old profile photo cleanup:",error.message));
      closeM();head();renderList();openUserProfile({...me});
      if(username!==oldUsername)location.reload();
    }catch(errorValue){error.textContent=authError(errorValue);button.disabled=false;button.textContent="Сохранить"}
  };
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
    const own=!!(me&&profile.uid===me.uid);
    openM('<div class="profile-public-card"><div class="profile-public-card-top"><span>Профиль</span><span class="profile-live" id="profile-card-presence"></span></div><div class="profile-public-card-main"><div class="av big" id="profile-card-avatar"></div><div class="profile-public-card-identity"><h3 id="profile-card-name"></h3><div class="profile-handle-row"><b class="profile-handle" id="profile-card-handle"></b><button type="button" class="profile-copy-btn" id="profile-card-copy-username" aria-label="Копировать username">⧉</button></div></div></div><div id="profile-card-phone" class="profile-phone-row"><span>Номер телефона</span><b id="profile-card-phone-value"></b><button type="button" class="profile-copy-btn" id="profile-card-copy-phone" aria-label="Копировать номер" hidden>⧉</button></div><div class="profile-description-label">Описание</div><p id="profile-card-bio" class="profile-public-bio"></p><div class="profile-public-actions"><button type="button" id="profile-card-close">Закрыть</button>'+(own?'<button type="button" class="pr profile-edit-pencil" id="profile-card-edit" aria-label="Редактировать профиль" title="Редактировать профиль">✎</button>':'<button type="button" class="pr" id="profile-card-chat">Написать</button>')+'</div></div>');
    avatar($("profile-card-avatar"),profile);
    const publicUsername=String(profile.username||profile.usernameLower||"").trim().replace(/^@/,"");
    $("profile-card-name").textContent=profile.displayName||publicUsername||"Пользователь";
    $("profile-card-handle").textContent=publicUsername?"@"+publicUsername:"Username не задан";
    $("profile-card-presence").textContent=presenceLabel(profile);
    $("profile-card-presence").classList.toggle("online",isOnline(profile));
    $("profile-card-bio").textContent=profile.bio||"Описание не добавлено.";
    const phoneValue=$("profile-card-phone-value"),phoneCopy=$("profile-card-copy-phone");
    if(profile.phonePublic){
      phoneValue.textContent=profile.phonePublic;phoneCopy.hidden=false;
      phoneCopy.onclick=()=>copyProfileValue(profile.phonePublic,phoneCopy);
    }else{
      phoneValue.textContent=own&&me.phoneNumber?me.phoneNumber:(profile.phoneStatus==="hidden"?"Номер скрыт":"Номер не подтверждён");
      phoneCopy.hidden=true;
      if(own&&me.phoneNumber){phoneCopy.hidden=false;phoneCopy.onclick=()=>copyProfileValue(me.phoneNumber,phoneCopy)}
    }
    $("profile-card-copy-username").onclick=()=>copyProfileValue("@"+(profile.username||"user"),$("profile-card-copy-username"));
    $("profile-card-close").onclick=closeM;
    if(own)$("profile-card-edit").onclick=()=>openOwnProfileEditor(profile);
    else $("profile-card-chat").onclick=()=>startDM(profile);
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
function fillMe(){avatar($("mav"),me,true);$("mn").textContent=me.displayName||me.username;$("mu").textContent="";$("mu").style.display="none";$("mav").onclick=()=>openUserProfile({...me});$("mn").onclick=()=>openUserProfile({...me});$("mav").style.cursor="pointer";$("mn").style.cursor="pointer"}
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
  const payload={...message,profileForwardAllowed:S.allowProfileFromForward!==false};
  const messageRef=doc(collection(db,"chats",chatId,"messages"));
  await setDoc(messageRef,payload);

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
  const input=$("inp"),text=input.value.trim();
  if(cur===SYSTEM_CHAT_ID)return;
  if(!cur){showToast("Сначала выберите личный чат или группу.");return}
  if(!text&&!replyTarget)return;input.value="";input.style.height="";
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
  const closeAttachmentMenu=()=>{
    if(!attachmentMenu)return;
    attachmentMenu.hidden=true;
    attachmentButton.setAttribute("aria-expanded","false");
  };
  if(attachmentMenu){
    attachmentButton.setAttribute("aria-controls","attach-menu");
    attachmentButton.setAttribute("aria-expanded","false");
    attachmentButton.onclick=()=>{
      const open=attachmentMenu.hidden;
      attachmentMenu.hidden=!open;
      attachmentButton.setAttribute("aria-expanded",String(open));
    };
    document.addEventListener("pointerdown",event=>{
      if(attachmentMenu.hidden||attachmentMenu.contains(event.target)||attachmentButton.contains(event.target))return;
      closeAttachmentMenu();
    });
    document.addEventListener("keydown",event=>{
      if(event.key!=="Escape"||attachmentMenu.hidden)return;
      closeAttachmentMenu();
      attachmentButton.focus();
    });
  }else attachmentButton.onclick=()=>attachmentInput.click();
  if(uploadChoice)uploadChoice.onclick=()=>{closeAttachmentMenu();attachmentInput.click()};
  if(urlChoice)urlChoice.onclick=()=>{closeAttachmentMenu();sendExternalFileLink()};
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
      ? '<div class="group-settings-editor"><div class="group-avatar-editor"><div class="av group-avatar-preview" id="group-avatar-preview"></div><div><b>Фото группы</b><div class="row"><button type="button" id="group-avatar-change">Изменить фото</button><button type="button" id="group-avatar-remove">Убрать</button></div><input id="group-avatar-file" type="file" accept="image/*" hidden></div></div><label>Название группы</label><input id="group-title" maxlength="40"><label>Описание</label><textarea id="group-description" rows="3" maxlength="300" placeholder="Кратко расскажи о группе"></textarea><h4>Участники</h4><div id="group-members" class="group-settings-members"></div><h4>Добавить из личных чатов</h4><div id="group-candidates" class="group-settings-members"></div><div class="err" id="group-settings-error"></div><button class="pr" id="save-group-settings" style="width:100%">Сохранить настройки группы</button><button class="dg" id="delete-group-everyone" style="width:100%;margin-top:8px">Удалить группу у всех участников</button></div>'
      : '<p class="mut">Настраивать группу может только её создатель.</p><b>Участники</b><div id="group-members" class="group-settings-members"></div>';
  }
  openM('<div class="chat-settings-heading"><button type="button" id="chat-settings-back" aria-label="Назад">←</button><div><h3>'+(isGroup?'Настройки группы':'Настройки чата')+'</h3><p class="mut">'+esc(title)+'</p></div><button type="button" id="chat-settings-cancel">Отмена</button></div>'+editor+'<hr style="border:0;border-top:1px solid var(--line);margin:14px 0"><button type="button" id="toggle-chat-mute" style="width:100%;margin-bottom:8px">'+((me.mutedChats||[]).includes(cur)?'Включить уведомления':'Отключить уведомления')+'</button><button id="clear-chat" style="width:100%">Очистить переписку у себя</button><button id="delete-chat" class="dg" style="width:100%;margin-top:8px">Удалить чат из моего списка</button><div class="err" id="chat-settings-error"></div>');
  $("chat-settings-back").onclick=closeM;$("chat-settings-cancel").onclick=closeM;
  if(isGroup){
    const currentMemberIds=new Set(chat.memberUids||[]);
    const profiles=new Map((chat.memberProfiles||[]).filter(person=>currentMemberIds.has(person.uid)).map(person=>[person.uid,{...person}]));
    let pendingGroupAvatar=null,removeGroupAvatar=false;
    if(isOwner){const preview=$("group-avatar-preview");avatar(preview,{uid:me.uid,title:chat.title||"G",displayName:chat.title||"Группа",avatarUrl:chat.groupAvatarUrl||"",profileColor:chat.groupAvatarColor||"#8b5cf6"});$("group-avatar-change").onclick=()=>$("group-avatar-file").click();$("group-avatar-file").onchange=()=>{const file=$("group-avatar-file").files?.[0];if(!file)return;pickImg(file,dataUrl=>{pendingGroupAvatar=dataUrl;removeGroupAvatar=false;avatar(preview,{displayName:chat.title||"Группа",avatarUrl:dataUrl,profileColor:chat.groupAvatarColor||"#8b5cf6"})},()=>{$("group-avatar-file").value=""})};$("group-avatar-remove").onclick=()=>{pendingGroupAvatar=null;removeGroupAvatar=true;avatar(preview,{displayName:chat.title||"Группа",profileColor:chat.groupAvatarColor||"#8b5cf6"})};}
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
          let groupAvatarUrl=chat.groupAvatarUrl||"";if(pendingGroupAvatar){const blob=await (await fetch(pendingGroupAvatar)).blob();const file=new File([blob],"group-avatar.jpg",{type:blob.type||"image/jpeg"});const token=await currentUser.getIdToken();const uploaded=await uploadChatFile(cur,file,token);groupAvatarUrl="filebase:"+uploaded.path;}if(removeGroupAvatar)groupAvatarUrl="";
          await updateDoc(doc(db,"chats",cur),{title:nextTitle,description:nextDescription,memberUids,memberProfiles,groupAvatarUrl,groupAvatarColor:chat.groupAvatarColor||"#8b5cf6",updatedAt:serverTimestamp()});
          Object.assign(chat,{title:nextTitle,description:nextDescription,memberUids,memberProfiles,groupAvatarUrl});
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
const openM=h=>{$("md").innerHTML=h;$("ov").classList.add("o")},closeM=()=>$("ov").classList.remove("o","settings-mode");
$("ov").onclick=e=>{if(e.target===$("ov")){applyS(S);closeM()}};
$("gb").onclick=()=>{
  const requestedCategory=Number.isInteger(window.FROSS_SETTINGS_START)?window.FROSS_SETTINGS_START:null;
  const startCategory=requestedCategory===3?3:requestedCategory===0?0:1;
  window.FROSS_SETTINGS_START=null;
  const backup=JSON.parse(JSON.stringify(S)),o={...DEF,...S};
  const P={username:me.username||"",displayName:me.displayName||"",bio:me.bio||"",contactEmail:me.contactEmail||"",avatarUrl:me.avatarUrl||"",profileColor:me.profileColor||S.profileColor,avatarDirty:false};
  openM('<div class="settings-shell">  <header class="settings-topbar">    <div><h3>Настройки FROSS</h3><p>Управляй своим пространством</p></div>    <button type="button" id="settings-back" class="settings-back">← Чаты</button>  </header>  <div id="settings-scroll" class="settings-scroll">    <div class="settings-account-card">      <div class="av" id="settings-account-avatar"></div>      <div class="settings-account-copy"><b id="settings-account-name"></b><small id="settings-account-handle"></small></div>      <span class="settings-account-mark" aria-hidden="true">✦</span>    </div>    <section id="settings-home" class="settings-home" aria-label="Все настройки">      <h4 class="settings-group-label">АККАУНТ</h4>      <div class="settings-group">        <button type="button" class="settings-category settings-row" data-i="3" data-title="Профиль" data-description="Фото, имя и личные данные">          <span class="settings-row-icon profile-icon" aria-hidden="true">            <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c.7-3.7 3.2-5.5 7.5-5.5s6.8 1.8 7.5 5.5"/></svg>          </span><span class="settings-row-copy"><b>Профиль</b><small>Фото и личные данные</small></span><span class="settings-row-chevron">›</span>        </button>        <button type="button" class="settings-category settings-row" data-i="0" data-title="Безопасность" data-description="Подтверждение номера и защита аккаунта">          <span class="settings-row-icon security-icon" aria-hidden="true">            <svg viewBox="0 0 24 24"><path d="M12 2.8 19 5.5v5.2c0 4.6-2.7 8.2-7 10.5-4.3-2.3-7-5.9-7-10.5V5.5z"/><path d="m8.7 11.8 2.1 2.1 4.6-4.8"/></svg>          </span><span class="settings-row-copy"><b>Безопасность</b><small>Вход и защита аккаунта</small></span><span class="settings-row-chevron">›</span>        </button>      </div>      <h4 class="settings-group-label">ОБЩЕНИЕ И МЕДИА</h4>      <div class="settings-group">        <button type="button" class="settings-category settings-row" data-i="1" data-title="Чаты" data-description="Переписки, отображение и уведомления">          <span class="settings-row-icon chats-icon" aria-hidden="true">            <svg viewBox="0 0 24 24"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-6.5A7.5 7.5 0 1 1 20 11.5Z"/><path d="M8 11h.01M12 11h.01M16 11h.01"/></svg>          </span><span class="settings-row-copy"><b>Чаты</b><small>Переписки и уведомления</small></span><span class="settings-row-chevron">›</span>        </button>        <button type="button" class="settings-category settings-row" data-i="2" data-title="Медиа" data-description="Загрузка фотографий и файлов">          <span class="settings-row-icon media-icon" aria-hidden="true">            <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 3 3 3-4 5 6"/></svg>          </span><span class="settings-row-copy"><b>Медиа</b><small>Фото, видео и файлы</small></span><span class="settings-row-chevron">›</span>        </button>      </div>      <h4 class="settings-group-label">ВНЕШНИЙ ВИД</h4>      <div class="settings-group">        <button type="button" class="settings-category settings-row" data-i="4" data-title="Кастомизация" data-description="Цвета, шрифт и оформление приложения">          <span class="settings-row-icon appearance-icon" aria-hidden="true">            <svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18h1.2a2 2 0 0 0 1.4-3.4 1.8 1.8 0 0 1 1.3-3.1H18a3 3 0 0 0 3-3c0-4.7-4-8.5-9-8.5Z"/><circle cx="7.5" cy="10" r="1"/><circle cx="11" cy="6.8" r="1"/><circle cx="16" cy="8.5" r="1"/></svg>          </span><span class="settings-row-copy"><b>Кастомизация</b><small>Цвета и внешний вид</small></span><span class="settings-row-chevron">›</span>        </button>      </div>    </section>    <section id="settings-detail" class="settings-detail" hidden>      <button type="button" id="settings-detail-back" class="settings-detail-back">← Все настройки</button>      <div class="settings-detail-heading"><h3 id="settings-detail-title"></h3><p id="settings-detail-description"></p></div>      <section id="sc" class="settings-content"></section>    </section>  </div>  <div class="row settings-actions" id="settings-actions" hidden><button id="sx">Отмена</button><button class="pr" id="ss">Сохранить</button></div></div>');
  $("ov").classList.add("settings-mode");
  $("settings-account-name").textContent=P.displayName||P.username||"Пользователь FROSS";
  $("settings-account-handle").textContent=P.username?"@"+P.username:"Твой профиль";
  avatar($("settings-account-avatar"),{displayName:P.displayName||P.username,username:P.username,avatarUrl:P.avatarUrl,profileColor:P.profileColor||o.profileColor});
  $("settings-back").onclick=()=>{applyS(S);closeM();document.body.classList.remove("ch");$("nav-chats").classList.add("active");$("nav-people").classList.remove("active")};
  const toggle=(k,label,description)=>'<div class="sw2"><div>'+label+(description?'<br><small class="mut">'+description+'</small>':"")+'</div><input type="checkbox" data-k="'+k+'" '+(o[k]?"checked":"")+'></div>';
  const section=(title,description)=>'<div class="settings-section-title"><h4>'+title+'</h4><p>'+description+'</p></div>';
  let settingsRenderVersion=0;
  const showSettingsHome=()=>{
    settingsRenderVersion++;
    $("settings-home").hidden=false;
    $("settings-detail").hidden=true;
    $("settings-actions").hidden=true;
    document.querySelectorAll(".settings-category").forEach(b=>b.classList.remove("active"));
    $("settings-scroll").scrollTop=0;
  };
  const show=async i=>{
    const renderVersion=++settingsRenderVersion;
    const selected=document.querySelector('.settings-category[data-i="'+i+'"]');
    if(!selected)return;
    $("settings-home").hidden=true;
    $("settings-detail").hidden=false;
    $("settings-actions").hidden=i===3;
    $("settings-detail-title").textContent=selected.dataset.title||selected.querySelector("b")?.textContent||"Настройки";
    $("settings-detail-description").textContent=selected.dataset.description||"Измени параметры раздела.";
    $("settings-scroll").scrollTop=0;
    document.querySelectorAll(".settings-category").forEach((b,j)=>b.classList.toggle("active",Number(b.dataset.i)===i));
    const c=$("sc");c.classList.remove("settings-content-enter");void c.offsetWidth;c.classList.add("settings-content-enter");
    if(i===3){
      c.innerHTML=section("Профиль","")+
        '<div class="settings-profile-card">'+
          '<div class="settings-profile-identity"><div class="av big" id="settings-profile-avatar"></div><div><b id="settings-profile-name"></b><small id="settings-profile-handle"></small></div></div>'+
          '<div class="settings-profile-bio" id="settings-profile-bio"></div>'+
          '<div class="settings-profile-actions"><button type="button" id="settings-profile-view">Посмотреть профиль</button><button type="button" class="pr" id="settings-profile-edit">Изменить профиль</button></div>'+
        '</div>';
      $("settings-profile-name").textContent=P.displayName||P.username||"Пользователь";
      $("settings-profile-handle").textContent=P.username?"@"+P.username:"Username не задан";
      $("settings-profile-bio").textContent=P.bio||"Описание не добавлено";
      avatar($("settings-profile-avatar"),{...me,displayName:P.displayName,username:P.username,avatarUrl:P.avatarUrl,profileColor:P.profileColor});
      $("settings-profile-view").onclick=()=>{closeM();openUserProfile({...me})};
      $("settings-profile-edit").onclick=()=>{closeM();openOwnProfileEditor({...me})};
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
      c.innerHTML=section("Чаты","Настрой переписки, отображение и уведомления.")+'<h4>Отображение</h4>'+toggle("avatars","Показывать аватары")+toggle("h24","24-часовой формат времени")+toggle("enter","Отправлять по Enter","Если выключено — Ctrl+Enter")+toggle("reduceMotion","Уменьшить анимации")+'<h4>Приватность</h4>'+toggle("showOnline","Показывать статус «в сети»")+toggle("readReceipts","Разрешить отметки о прочтении")+toggle("allowForwarding","Разрешить другим пересылать мои сообщения","Если выключить, другие не смогут пересылать твои сообщения. Свои сообщения ты сможешь пересылать всегда.")+toggle("allowProfileFromForward","Разрешить переход в мой профиль из пересланных сообщений","Если выключить, имя и аватар останутся видны, но открыть профиль по пересылке будет нельзя.")+'<h4>Уведомления</h4>'+toggle("notifyDesktop","Уведомления на рабочем столе")+toggle("notifySound","Звуковые уведомления")+'<button type="button" id="enable-browser-notifications" style="width:100%;margin-top:10px">Разрешить уведомления браузера</button><small id="browser-notification-status" class="mut"></small><p class="mut settings-footnote">Изменения сохраняются в аккаунте и синхронизируются между устройствами.</p>';
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
  $("settings-detail-back").onclick=showSettingsHome;
  if(requestedCategory!==null)show(startCategory);else showSettingsHome();
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
            displayName:P.displayName||username,bio:P.bio||"",avatarUrl,profileColor:o.profileColor||P.profileColor||DEF.profileColor,allowProfileFromForward:o.allowProfileFromForward!==false,lastSeenAt:serverTimestamp()
          });
        });
      } else {
        await setDoc(publicRef,{username,usernameLower:username,displayName:P.displayName||username,bio:P.bio||"",avatarUrl,profileColor:o.profileColor||P.profileColor||DEF.profileColor,allowProfileFromForward:o.allowProfileFromForward!==false},{merge:true});
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
async function resetAccountSession(){
  if(stopChats){stopChats();stopChats=null}if(stopMessages){stopMessages();stopMessages=null}
  clearProfileObservers(chatProfileStops);clearProfileObservers(messageProfileStops);clearChatNotificationObservers();
  reactionSubscriptions.forEach(entry=>{try{entry.stop?.()}catch{}});reactionSubscriptions.clear();reactionStops=[];
  if(presenceTimer){clearInterval(presenceTimer);presenceTimer=null}
  if(systemInboxTimer){clearInterval(systemInboxTimer);systemInboxTimer=null}
  if(searchTimer){clearTimeout(searchTimer);searchTimer=null}
  peopleSearchSequence++;found=[];chats=[];cur="";me=null;currentUser=null;bootedUid=null;
  systemInboxMessages=[];systemInboxLoaded=false;systemInboxError="";systemInboxLoading=null;privateFileUrlCache.clear();
  if(notificationAudioContext){try{await notificationAudioContext.close()}catch{}notificationAudioContext=null}
  if(globalAudioPlayer){try{globalAudioPlayer.pause();globalAudioPlayer.removeAttribute("src");globalAudioPlayer.load()}catch{}globalAudioPlayer=null}
  globalAudioTrackKey="";globalAudioAttachment=null;globalAudioRequest++;
  document.body.classList.remove("ch");const composer=document.querySelector(".comp");if(composer)composer.style.display="none";
}
async function logout(){closeM();await resetAccountSession();await signOut(auth);}
async function bootFromAuth(user){await boot(user)}
onAuthStateChanged(auth,async user=>{
  if(user){if(!creatingAccount){if(user.providerData.some(p=>p.providerId==="password")&&!user.emailVerified){const token=await user.getIdTokenResult();if(token.claims.legacyAccount!==true){signOut(auth);return}}bootFromAuth(user)}}
  else{
    await resetAccountSession();
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
    window.FROSS_SETTINGS_START=null;$("gb").click();
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
