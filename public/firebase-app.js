import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import { uploadChatFile, createUploadProgress, appendMentionText, appendReadReceipt } from "./chat-features.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, updatePassword, reauthenticateWithCredential, reauthenticateWithPopup,
  EmailAuthProvider, deleteUser, GoogleAuthProvider, signInWithPopup, linkWithCredential,
  sendEmailVerification, sendPasswordResetEmail, linkWithPhoneNumber, RecaptchaVerifier
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection,
  query, where, orderBy, limit, limitToLast, startAt, endAt, getDocs,
  onSnapshot, runTransaction, writeBatch, serverTimestamp, arrayRemove, arrayUnion
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";
import {
  getStorage, ref, uploadString, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyBflnOcg4btfTRLgFWV1HT47j0fcnC15d4",
  authDomain: "fross-ca5d6.firebaseapp.com",
  projectId: "fross-ca5d6",
  storageBucket: "fross-ca5d6.firebasestorage.app",
  messagingSenderId: "200886619645",
  appId: "1:200886619645:web:0f1bc9b750eedf22a05d94"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const DEF = {theme:"dark",accent:"#9181ff",fs:15,shape:"round",density:"normal",font:"system",enter:true,h24:true,wall:"none",avatars:true,bgColor:"#0f1015",panelColor:"#16181f",textColor:"#f2f3f7",incomingColor:"#232632",outgoingColor:"#9181ff",profileColor:"#9181ff",notifyDesktop:true,notifySound:true,readReceipts:true,showOnline:true,autoDownload:false,compressImages:true,autoPlayMedia:false,reduceMotion:false};
const ACC = ["#9181ff","#3b82f6","#10b981","#f59e0b","#ef4444","#ec4899","#06b6d4"];
let currentUser=null, me=null, S={...DEF}, cur="general", chats=[], found=[];
let stopChats=null, stopMessages=null, presenceTimer=null, searchTimer=null, W=null, creatingAccount=false, bootedUid=null, reactionStops=[];
window.FROSS = {get authUser(){return currentUser},get profile(){return me},get chatId(){return cur}};

function authEmail(username) {
  return String(username).trim().toLowerCase() + "@fross-ca5d6.firebaseapp.com";
}
async function completeTotpSignIn(error) {
  const sdk=await import("https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js");
  const resolver=sdk.getMultiFactorResolver(auth,error);
  const hint=resolver.hints.find(item=>item.factorId===sdk.TotpMultiFactorGenerator.FACTOR_ID);
  if(!hint)throw new Error("Для этого аккаунта требуется другой способ второго фактора.");
  const code=prompt("Введите шестизначный код из Google Authenticator:");
  if(!code)throw new Error("Вход отменён.");
  const assertion=sdk.TotpMultiFactorGenerator.assertionForSignIn(hint.uid,code.trim());
  return await resolver.resolveSignIn(assertion);
}
function showLogin() {
  $("auth").style.display="grid"; $("app").style.display="none"; $("auth").scrollTop=0;
  $("ac").innerHTML='<div class="logo">FROSS</div><p class="mut">Вход в мессенджер</p><label>Email (для старых перенесённых аккаунтов — username)</label><input id="lu" type="text" autocomplete="username" maxlength="120" placeholder="name@example.com"><label>Пароль</label><input id="lp" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false"><div class="err" id="le"></div><div class="row"><button class="pr" id="lg">Войти</button><button id="gr">Google</button></div><p><button class="ic" id="reset">Забыли пароль?</button></p><p style="text-align:center" class="mut">Нет аккаунта? <button class="ic" style="font-size:15px;color:var(--accent)" id="rg">Регистрация</button></p>';
  $("rg").onclick=()=>{W={username:"",email:"",password:"",display_name:"",bio:"",avatar:"",settings:{...DEF}};wiz(1)};
  $("gr").onclick=googleLogin;
  $("reset").onclick=async()=>{const email=$("lu").value.trim();if(!email.includes("@")){$("le").textContent="Сначала введите email.";return}try{await sendPasswordResetEmail(auth,email);$("le").textContent="Письмо для сброса пароля отправлено."}catch(e){$("le").textContent=authError(e)}};
  $("lg").onclick=async()=>{try{
    const identifier=$("lu").value.trim();
    if(!identifier)throw Error("Введите email или имя пользователя.");
    const email=identifier.includes("@")?identifier.toLowerCase():authEmail(identifier);
    const password=$("lp").value;
    if(!password)throw Error("Введите пароль. Большие и маленькие буквы учитываются отдельно.");
    const result=await signInWithEmailAndPassword(auth,email,password);
    if(!result.user.emailVerified){const token=await result.user.getIdTokenResult();if(token.claims.legacyAccount!==true){await sendEmailVerification(result.user);await signOut(auth);$("le").textContent="Подтвердите email по ссылке в письме, затем войдите снова.";return}}
  }catch(e){try{if(e?.code==="auth/multi-factor-auth-required"){await completeTotpSignIn(e);return}}catch(mfaError){$("le").textContent=authError(mfaError);return}$("le").textContent=authError(e)}};
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
    "storage/unauthorized":"Firebase Storage запретил загрузку. Опубликуйте Storage Rules и проверьте, что вход выполнен в нужный аккаунт.",
    "storage/bucket-not-found":"В Firebase не найден Storage bucket. Проверьте, создано ли хранилище в проекте.",
    "storage/quota-exceeded":"Превышена квота Firebase Storage.",
    "storage/retry-limit-exceeded":"Firebase не смог завершить загрузку после нескольких попыток. Проверьте интернет.",
    "storage/canceled":"Загрузка была отменена.",
    "storage/unknown":"Firebase Storage вернул неизвестную ошибку. Проверьте консоль и повторите попытку."
  };
  return map[code] || e?.message || "Неизвестная ошибка Firebase.";
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
function avatar(el,o,on) {
  const name=o?.displayName||o?.display_name||o?.username||o?.title||"#";
  el.classList.toggle("on",!!on);
  el.style.background=o?.avatarUrl||o?.avatar ? "":(o?.profileColor||hue(name));
  el.style.backgroundImage=o?.avatarUrl ? 'url("'+o.avatarUrl+'")' : (o?.avatar ? 'url("'+o.avatar+'")' : "none");
  el.textContent=(o?.avatarUrl||o?.avatar)?"":String(name)[0].toUpperCase();
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
  if(!dataUrl)return "";
  if(/^https:\/\//i.test(dataUrl))return dataUrl;
  if(!dataUrl.startsWith("data:image/"))throw new Error("Фото не подготовлено. Сначала нажми «Применить фото».");
  try{
    const response=await fetch(dataUrl),blob=await response.blob();
    if(!blob.size)throw new Error("Получилось пустое изображение.");
    const target=ref(storage,"avatars/"+uid+"/avatar_"+crypto.randomUUID()+".jpg");
    const uploaded=await uploadBytes(target,blob,{contentType:"image/jpeg",cacheControl:"public,max-age=3600"});
    return await getDownloadURL(uploaded.ref);
  }catch(error){
    console.error("FROSS avatar upload failed:",error);
    throw new Error("Не удалось загрузить фото в Firebase Storage: "+authError(error));
  }
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
function chatInfo(c) {
  if(c.id==="general")return{title:"Общий чат",avatar:{title:"#"},sub:"Для всех"};
  if(c.type==="dm"){
    const other=(c.memberProfiles||[]).find(m=>m.uid!==me.uid)||{};
    if(other.deleted)return{title:"Аккаунт удалён",avatar:{...other,displayName:"Аккаунт удалён"},sub:"Пользователь удалил аккаунт"};
    return{title:other.displayName||other.username||"Личный чат",avatar:other,sub:"@"+(other.username||"")+(isOnline(other)?" · в сети":"")};
  }
  return{title:c.title||"Группа",avatar:{title:c.title||"G"},sub:(c.memberUids||[]).length+" участн."};
}
function item(o,title,sub,online,active,fn) {
  const d=document.createElement("div");d.className="it"+(active?" a":"");
  d.innerHTML='<div class="av"></div><div class="t"><b>'+esc(title)+'</b><small>'+esc(sub||"")+'</small></div>';
  avatar(d.firstChild,o,online);d.onclick=fn;return d;
}
function renderList() {
  const L=$("list"),term=$("q").value.trim().toLowerCase();L.innerHTML="";
  const all=[{id:"general",type:"general",memberUids:[]},...chats];
  let count=0;
  for(const c of all){
    const info=chatInfo(c);
    if(term&&!info.title.toLowerCase().includes(term))continue;
    count++;L.append(item(info.avatar,info.title,c.lastMessage||info.sub,isOnline(info.avatar),c.id===cur,()=>openChat(c.id)));
  }
  if(term&&found.length){
    const h=document.createElement("div");h.className="h";h.textContent="Люди";L.append(h);
    found.forEach(u=>L.append(item(u,u.displayName||u.username,"@"+u.username,isOnline(u),false,()=>openUserProfile(u))));
  }
  if(!count&&!found.length)L.innerHTML='<div class="empty" style="padding:20px">Ничего не найдено</div>';
}
let stopSearch=null;
async function searchUsers(term) {
  const q=term.trim().toLowerCase().replace(/^@/,"");if(q.length<2){found=[];renderList();return;}
  try{
    const users=await getDocs(query(collection(db,"publicUsers"),orderBy("usernameLower"),startAt(q),endAt(q+"\uf8ff"),limit(20)));
    found=users.docs.filter(d=>d.id!==me.uid&&!d.data().deleted).map(d=>({uid:d.id,...d.data()}));renderList();
  }catch(e){console.error(e)}
}
function startChatList() {
  if(stopChats)stopChats();
  // Draw the general chat immediately; the private list is populated from the first
  // snapshot without requiring the user to open the Chats tab.
  chats=[];renderList();head();
  const sortChats=items=>items.sort((a,b)=>{
    const at=a.updatedAt?.toMillis?.()||a.lastMessageAt?.toMillis?.()||0;
    const bt=b.updatedAt?.toMillis?.()||b.lastMessageAt?.toMillis?.()||0;
    return bt-at;
  });
  const q=query(collection(db,"chats"),where("memberUids","array-contains",me.uid),limit(100));
  stopChats=onSnapshot(q,snapshot=>{
    chats=sortChats(snapshot.docs.map(d=>({id:d.id,...d.data()})));
    renderList();head();
  },async e=>{
    console.error("Chat list listener:",e);
    try {
      const snapshot=await getDocs(q);
      chats=sortChats(snapshot.docs.map(d=>({id:d.id,...d.data()})));
      renderList();head();
    } catch(fallbackError) {
      console.error("Chat list fallback:",fallbackError);
      $("list").innerHTML='<div class="empty" style="padding:20px">Не удалось загрузить чаты. Проверьте подключение и попробуйте снова.</div>';
    }
  });
}
async function ensureGeneral() {
  const r=doc(db,"chats","general");
  await runTransaction(db,async tx=>{
    const snap=await tx.get(r);
    if(!snap.exists())tx.set(r,{
      type:"general",title:"Общий чат",memberUids:[],memberProfiles:[],
      createdAt:serverTimestamp(),updatedAt:serverTimestamp(),lastMessage:""
    });
  });
}
function head() {
  const c=cur==="general"?{id:"general",type:"general"}:chats.find(x=>x.id===cur);
  if(!c)return;
  const i=chatInfo(c);avatar($("hav"),i.avatar,isOnline(i.avatar));$("ht").textContent=i.title;$("hs").textContent=i.sub;
  if ($("call")) $("call").style.display = c.type==="dm" ? "block" : "none";
}
function openChat(id) {
  cur=id;
  document.body.classList.add("ch");renderList();head();subscribeMessages();
  const chat=chats.find(c=>c.id===id);if(chat?.type==="dm"){const other=(chat.memberProfiles||[]).find(m=>m.uid!==me.uid);if(other?.uid)loadChatProfile(other.uid).then(profile=>{chat.memberProfiles=(chat.memberProfiles||[]).map(m=>m.uid===profile.uid?{...m,...profile}:m);head();renderList()}).catch(()=>{})}
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
async function deleteMessageForAll(message) {
  if(!confirm("Удалить это сообщение у всех участников?"))return;
  try{await deleteDoc(doc(db,"chats",cur,"messages",message.id))}catch(e){alert(authError(e))}
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
  const box=$("msgs");box.innerHTML='<div class="empty">Загрузка сообщений…</div>';
  const q=query(collection(db,"chats",cur,"messages"),orderBy("createdAt","asc"),limitToLast(100));
  stopMessages=onSnapshot(q,snapshot=>{
    const stick=box.scrollHeight-box.scrollTop-box.clientHeight<120;
    markMessagesRead(snapshot.docs);
    reactionStops.forEach(stop=>stop());reactionStops=[];
    box.innerHTML="";
    if(snapshot.empty)box.innerHTML='<div class="empty">Пока нет сообщений. Напишите первым!</div>';
    let previous="";
    snapshot.docs.forEach(s=>{
      const m={id:s.id,...s.data()},mine=m.senderUid===me.uid,r=document.createElement("div");
      r.className="mr"+(mine?" me":"")+(S.avatars&&!mine&&previous===m.senderUid?" nf":"");
      r.dataset.messageId=m.id;
      if(S.avatars&&!mine&&previous!==m.senderUid){
        const a=document.createElement("div");a.className="av";avatar(a,{displayName:m.displayName||m.username,avatarUrl:m.avatarUrl,profileColor:m.profileColor});r.append(a);
      }else if(S.avatars&&!mine)r.classList.add("nf");
      const b=document.createElement("div");b.className="msg";
      if(previous!==m.senderUid&&(cur==="general"||chats.find(c=>c.id===cur)?.type==="group")){
        const n=document.createElement("button");n.type="button";n.className="sender-profile";
        n.textContent=(mine?"Вы":(m.displayName||m.username||"Пользователь"))+" · @"+(m.username||"user");
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
        if(a.type?.startsWith("image/")){const img=document.createElement("img");img.src=a.url;img.alt=a.name||"Изображение";img.className="message-image";img.loading=S.autoDownload?"eager":"lazy";b.append(img)}
        if(a.type?.startsWith("audio/")){const audio=document.createElement("audio");audio.controls=true;audio.preload=S.autoDownload?"auto":"metadata";audio.autoplay=!!S.autoPlayMedia;audio.src=a.url;audio.className="message-audio";b.append(audio)}
        if(a.type?.startsWith("video/")){const video=document.createElement("video");video.controls=true;video.playsInline=true;video.preload=S.autoDownload?"auto":"metadata";video.autoplay=!!S.autoPlayMedia;video.src=a.url;video.className="message-video";b.append(video)}
        const link=document.createElement("a");link.href=a.url;link.target="_blank";link.rel="noopener";link.textContent="⬇ "+(a.name||"Скачать файл")+" ("+Math.max(1,Math.round((a.size||0)/1024))+" КБ)";link.className="attachment-link";b.append(link);
      }
      if(m.accountDeletedNotice){b.classList.add("deleted-account-notice");const tag=document.createElement("small");tag.textContent="АККАУНТ УДАЛЁН";tag.style.cssText="display:block;font-size:10px;letter-spacing:.08em;opacity:.7;font-weight:700;margin-bottom:4px";b.append(tag)}
      if(m.text){const body=document.createElement("div");appendMentionText(body,m.text,resolveMention);b.append(body)}
      const t=document.createElement("time");const date=m.createdAt?.toDate?m.createdAt.toDate():new Date();t.textContent=date.toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit",hour12:!S.h24})+(m.editedAt?" · изменено":"");if(mine&&cur!=="general") {
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
    if(stick)box.scrollTop=box.scrollHeight;
  },e=>{box.textContent="Не удалось загрузить сообщения: "+e.message;});
}
async function loadChatProfile(uid) {
  const snap=await getDoc(doc(db,"publicUsers",uid));
  if(!snap.exists())throw new Error("Пользователь не найден.");
  return{uid,...snap.data()};
}
async function openUserProfile(userOrName) {
  try {
    let profile;
    if(typeof userOrName==="string") {
      const username=userOrName.trim().toLowerCase().replace(/^@/,"");
      const index=await getDoc(doc(db,"usernameIndex",username));
      if(!index.exists())throw new Error("Пользователь не найден.");
      profile=await loadChatProfile(index.data().uid);
    } else profile=userOrName;
    if(!profile||profile.deleted)throw new Error("Профиль недоступен.");
    openM('<div class="profile-card"><div class="av big" id="profile-card-avatar"></div><h3 id="profile-card-name"></h3><b class="profile-handle" id="profile-card-handle"></b><p id="profile-card-bio" class="mut"></p><div class="row"><button id="profile-card-close">Закрыть</button><button class="pr" id="profile-card-chat">Написать</button></div></div>');
    avatar($("profile-card-avatar"),profile);
    $("profile-card-name").textContent=profile.displayName||profile.username;
    $("profile-card-handle").textContent="@"+profile.username;
    $("profile-card-bio").textContent=profile.bio||"Пользователь пока ничего не рассказал о себе.";
    $("profile-card-close").onclick=closeM;
    $("profile-card-chat").onclick=()=>startDM(profile);
  } catch(error) { alert(authError(error)); }
}
async function resolveMention(username) { await openUserProfile(username); }
async function markMessagesRead(docs) {
  if(!S.readReceipts||cur==="general")return;
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
    const u=typeof user==="string"?await loadChatProfile(user):user;
    const ids=[me.uid,u.uid].sort(),id="dm_"+ids.join("_"),r=doc(db,"chats",id);
    await runTransaction(db,async tx=>{
      const snap=await tx.get(r);
      if(!snap.exists())tx.set(r,{type:"dm",title:"",ownerUid:me.uid,memberUids:ids,memberProfiles:[
        {uid:me.uid,username:me.username,displayName:me.displayName,avatarUrl:me.avatarUrl||""},
        {uid:u.uid,username:u.username,displayName:u.displayName,avatarUrl:u.avatarUrl||""}
      ],createdAt:serverTimestamp(),updatedAt:serverTimestamp(),lastMessage:""});
    });
    $("q").value="";found=[];closeM();openChat(id);
  }catch(e){alert(authError(e))}
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
  me={uid:currentUser.uid,...p,contactEmail:v.contactEmail||"",settings:v.settings||{}};
  let cached={};try{cached=JSON.parse(localStorage.getItem("fross-settings-"+currentUser.uid)||"{}")}catch{}
  S={...DEF,...cached,...me.settings};applyS(S);fillMe();
}
function fillMe(){avatar($("mav"),me,true);$("mn").textContent=me.displayName||me.username;$("mu").textContent="@"+me.username}
async function boot(user) {
  if(bootedUid===user.uid)return;
  bootedUid=user.uid;
  currentUser=user;
  try{
    await loadCurrentProfile();$("auth").style.display="none";$("app").style.display="grid";cur="general";
    await ensureGeneral();startChatList();subscribeMessages();
    if(presenceTimer)clearInterval(presenceTimer);
    presenceTimer=setInterval(()=>updateDoc(doc(db,"publicUsers",me.uid),{lastSeenAt:serverTimestamp()}).catch(console.error),60000);
  }catch(e){bootedUid=null;console.error(e);alert("Не удалось открыть мессенджер: "+authError(e));await signOut(auth)}
}
async function send() {
  const input=$("inp"),text=input.value.trim();if(!text&&!replyTarget)return;input.value="";input.style.height="";
  const reply=replyTarget;replyTarget=null;$("reply-preview")?.remove();
  try{
    const chatRef=doc(db,"chats",cur),batch=writeBatch(db);
    const messageRef=doc(collection(db,"chats",cur,"messages"));
    const message={senderUid:me.uid,username:me.username,displayName:me.displayName||me.username,avatarUrl:me.avatarUrl||"",profileColor:me.profileColor||S.profileColor||"",text,readBy:[me.uid],createdAt:serverTimestamp()};
    if(reply)message.replyTo={id:reply.id,senderUid:reply.senderUid,displayName:reply.displayName,text:reply.text.slice(0,160)};
    batch.set(messageRef,message);
    batch.update(chatRef,{lastMessage:text.slice(0,120),lastMessageAt:serverTimestamp(),updatedAt:serverTimestamp()});
    await batch.commit();
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
if(attachmentButton&&attachmentInput){
  attachmentButton.onclick=()=>attachmentInput.click();
  attachmentInput.onchange=async()=>{
    const files=[...(attachmentInput.files||[])];attachmentInput.value="";
    for(const file of files) {
      let uploadFile=file;
      try{uploadFile=await optimizeChatImage(file)}catch{}
      if(uploadFile.size>=20*1024*1024){alert("Файл «"+file.name+"» больше лимита 20 МБ.");continue}
      const chatId=cur,path="chatFiles/"+chatId+"/"+me.uid+"/"+Date.now()+"_"+crypto.randomUUID().slice(0,8)+"_"+(uploadFile.name.replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,100)||"file");
      const progress=createUploadProgress($("msgs"),file.name);$("msgs").scrollTop=$("msgs").scrollHeight;
      attachmentButton.disabled=true;
      try{
        const {url}=await uploadChatFile(storage,path,uploadFile,percent=>progress.update(percent));
        const batch=writeBatch(db),messageRef=doc(collection(db,"chats",chatId,"messages"));
        const attachment={name:uploadFile.name.slice(0,180),type:uploadFile.type||"application/octet-stream",size:uploadFile.size,url,path};
        const summary=(uploadFile.type.startsWith("image/")?"Фото: ":"Файл: ")+uploadFile.name;
        const message={senderUid:me.uid,username:me.username,displayName:me.displayName||me.username,avatarUrl:me.avatarUrl||"",profileColor:me.profileColor||S.profileColor||"",text:"",attachment,readBy:[me.uid],createdAt:serverTimestamp()};
        if(replyTarget){message.replyTo={id:replyTarget.id,senderUid:replyTarget.senderUid,displayName:replyTarget.displayName,text:replyTarget.text.slice(0,160)};replyTarget=null;$("reply-preview")?.remove()}
        batch.set(messageRef,message);
        batch.update(doc(db,"chats",chatId),{lastMessage:summary.slice(0,120),lastMessageAt:serverTimestamp(),updatedAt:serverTimestamp()});
        await batch.commit();progress.update(100);setTimeout(()=>progress.remove(),900);
      }catch(error){console.error("FROSS chat attachment upload failed:",{code:error?.code,message:error?.message,path});progress.remove();alert("Не удалось загрузить или отправить «"+file.name+"».\\n"+(error?.code||"Ошибка Firebase")+": "+authError(error)+"\\n\\nЕсли ошибка storage/unauthorized — проверьте опубликованные правила Firebase Storage.")}
      finally{attachmentButton.disabled=false}
    }
  };
}

$("chat-settings").onclick=openChatSettings;
async function openChatSettings(){
  const chat=cur==="general"?{id:"general",type:"general"}:chats.find(c=>c.id===cur);if(!chat)return;
  openM('<h3>Настройки чата</h3><p class="mut">'+esc(chat.title||chatInfo(chat).title)+'</p><button id="clear-chat" style="width:100%">Очистить переписку у себя</button><button id="delete-chat" class="dg" style="width:100%;margin-top:8px">Удалить чат из моего списка</button><div class="err" id="chat-settings-error"></div>');
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
    if(cur==="general"){$("chat-settings-error").textContent="Общий чат нельзя удалить из списка.";return}
    if(!confirm("Удалить чат из вашего списка? История останется у других участников."))return;
    try{await updateDoc(doc(db,"chats",cur),{memberUids:arrayRemove(me.uid),updatedAt:serverTimestamp()});closeM();cur="general";openChat("general")}
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
  box.innerHTML='<input placeholder="Имя пользователя"><div class="pl" style="max-height:220px;overflow:auto"></div>';
  const input=box.firstChild,list=box.lastChild;let timer;
  const run=async()=>{
    const text=input.value.trim().toLowerCase();list.innerHTML="";
    if(text.length<2)return;
    try{
      const snap=await getDocs(query(collection(db,"publicUsers"),orderBy("usernameLower"),startAt(text),endAt(text+"\uf8ff"),limit(20)));
      snap.docs.filter(d=>d.id!==me.uid).forEach(d=>{
        const u={uid:d.id,...d.data()};
        const it=item(u,u.displayName||u.username,"@"+u.username,isOnline(u),selected&&selected.has(u.uid),()=>onPick(u));list.append(it);
      });
    }catch(e){list.textContent=authError(e)}
  };
  input.oninput=()=>{clearTimeout(timer);timer=setTimeout(run,250)};
}
$("nb").onclick=()=>{
  openM('<h3 style="margin:0">Новый чат</h3><div class="tabs"><button class="a" id="t1">Личный</button><button id="t2">Группа</button></div><div id="nc"></div><div class="row"><button id="cx">Закрыть</button></div>');
  $("cx").onclick=closeM;
  const tab=n=>{
    $("t1").classList.toggle("a",n===1);$("t2").classList.toggle("a",n===2);
    $("nc").innerHTML="";
    if(n===1){const b=document.createElement("div");$("nc").append(b);picker(b,u=>startDM(u));return;}
    const selected=new Map();$("nc").innerHTML='<label>Название группы</label><input id="gt" maxlength="40"><p class="mut">Добавляй участников из уже существующих личных чатов.</p><div id="ch"></div><div id="pk" class="existing-chat-picker"></div><div class="err" id="ge"></div><button class="pr" id="gc" style="width:100%">Создать группу</button>';
    const candidates=chats.filter(chat=>chat.type==="dm").map(chat=>(chat.memberProfiles||[]).find(person=>person.uid!==me.uid)).filter(person=>person&&!person.deleted);
    const renderSelected=()=>{$("ch").innerHTML=[...selected.values()].map(person=>'<span class="chip">@'+esc(person.username||"user")+'</span>').join("");};
    if(!candidates.length)$("pk").textContent="Пока нет личных чатов. Сначала начни переписку с человеком.";
    candidates.forEach(person=>{
      const row=document.createElement("label");row.className="group-contact";
      const checkbox=document.createElement("input");checkbox.type="checkbox";
      const info=document.createElement("span");info.textContent=(person.displayName||person.username)+" · @"+person.username;
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
        await setDoc(doc(db,"chats",id),{type:"group",title,ownerUid:me.uid,memberUids:unique.map(x=>x.uid),memberProfiles:unique.map(x=>({uid:x.uid,username:x.username,displayName:x.displayName,avatarUrl:x.avatarUrl||""})),createdAt:serverTimestamp(),updatedAt:serverTimestamp(),lastMessage:""});
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
  openM('<div class="settings-head"><h3>Настройки FROSS</h3><p>Выбери раздел, который хочешь изменить</p></div><div class="settings-layout"><nav class="settings-categories" aria-label="Разделы настроек"><button type="button" class="settings-category" data-i="0"><span>🛡️</span><b>Безопасность</b><small>Вход и защита аккаунта</small></button><button type="button" class="settings-category" data-i="1"><span>💬</span><b>Чаты</b><small>Переписки и уведомления</small></button><button type="button" class="settings-category" data-i="2"><span>🖼️</span><b>Медиа</b><small>Фото и файлы</small></button><button type="button" class="settings-category" data-i="3"><span>👤</span><b>Профиль</b><small>Фото и личные данные</small></button><button type="button" class="settings-category" data-i="4"><span>🎨</span><b>Кастомизация</b><small>Цвета и внешний вид</small></button></nav><section id="sc" class="settings-content"></section></div><div class="row settings-actions"><button id="sx">Отмена</button><button class="pr" id="ss">Сохранить</button></div>');
  const toggle=(k,label,description)=>'<div class="sw2"><div>'+label+(description?'<br><small class="mut">'+description+'</small>':"")+'</div><input type="checkbox" data-k="'+k+'" '+(o[k]?"checked":"")+'></div>';
  const section=(title,description)=>'<div class="settings-section-title"><h4>'+title+'</h4><p>'+description+'</p></div>';
  let settingsRenderVersion=0;
  const show=async i=>{
    const renderVersion=++settingsRenderVersion;
    document.querySelectorAll(".settings-category").forEach((b,j)=>b.classList.toggle("active",i===j));
    const c=$("sc");c.classList.remove("settings-content-enter");void c.offsetWidth;c.classList.add("settings-content-enter");
    if(i===3){
      c.innerHTML=section("Профиль","Настрой, как твой аккаунт выглядит для других.")+'<div class="profile-photo-editor"><div class="av big" id="pav"></div><div class="profile-photo-actions"><button type="button" id="up">📷 Выбрать фото</button><input type="file" id="fi" accept="image/*" hidden><button type="button" class="ic" id="rm">Убрать фото</button><small id="photo-state" class="photo-state">Текущее фото сохранено.</small></div></div><label>Уникальный username</label><input id="un" maxlength="20" autocomplete="username"><small class="mut">3–20 символов: латиница, цифры и _. Username должен быть свободен.</small><label>Никнейм — может повторяться</label><input id="dn" maxlength="40"><label>О себе</label><textarea id="bio" rows="3" maxlength="160" placeholder="Расскажи немного о себе"></textarea><label>Контактный email</label><input id="em" type="email">';
      $("un").value=P.username;$("dn").value=P.displayName;$("bio").value=P.bio;$("em").value=P.contactEmail;avatar($("pav"),{displayName:P.displayName,avatarUrl:P.avatarUrl});
      if(P.avatarDirty){$("photo-state").textContent="Фото уже применено, нажми «Сохранить»."; $("photo-state").classList.add("pending")}
      $("un").oninput=e=>P.username=e.target.value.trim().toLowerCase();$("dn").oninput=e=>P.displayName=e.target.value;$("bio").oninput=e=>P.bio=e.target.value;$("em").oninput=e=>P.contactEmail=e.target.value;
      $("up").onclick=()=>$("fi").click();
      $("fi").onchange=e=>{
        const file=e.target.files?.[0];e.target.value="";if(!file)return;
        pickImg(file,dataUrl=>{
          P.avatarUrl=dataUrl;P.avatarDirty=true;
          avatar($("pav"),{displayName:P.displayName,avatarUrl:dataUrl});
          $("photo-state").textContent="Фото применено. Теперь нажми «Сохранить».";
          $("photo-state").classList.add("pending");
        });
      };
      $("rm").onclick=()=>{
        P.avatarUrl="";P.avatarDirty=true;avatar($("pav"),{displayName:P.displayName});
        $("photo-state").textContent="Фото будет удалено после нажатия «Сохранить».";
        $("photo-state").classList.add("pending");
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
      c.innerHTML=section("Чаты","Настрой переписки, отображение и уведомления.")+'<h4>Отображение</h4>'+toggle("avatars","Показывать аватары")+toggle("h24","24-часовой формат времени")+toggle("enter","Отправлять по Enter","Если выключено — Ctrl+Enter")+toggle("reduceMotion","Уменьшить анимации")+'<h4>Приватность</h4>'+toggle("showOnline","Показывать статус «в сети»")+toggle("readReceipts","Разрешить отметки о прочтении")+'<h4>Уведомления</h4>'+toggle("notifyDesktop","Уведомления на рабочем столе")+toggle("notifySound","Звуковые уведомления")+'<p class="mut settings-footnote">Изменения сохраняются в аккаунте и синхронизируются между устройствами.</p>';
      c.querySelectorAll("[data-k]").forEach(x=>x.onchange=()=>o[x.dataset.k]=x.checked);
    }
    if(i===2){
      c.innerHTML=section("Медиа","Управляй загрузкой фотографий и файлов.")+'<h4>Загрузка</h4>'+toggle("autoDownload","Загружать превью сразу","Изображения и аудио будут подгружаться заранее.")+toggle("compressImages","Сжимать большие фотографии","Уменьшает размер изображений перед отправкой.")+toggle("autoPlayMedia","Автовоспроизведение аудио и видео")+'<div class="settings-info-card"><b>Ограничения файлов</b><span>До 20 МБ на один файл. Фото профиля обрезается до квадратного изображения с круглой маской.</span></div><p class="mut settings-footnote">Фотографии и вложения хранятся в Firebase Storage.</p>';
      c.querySelectorAll("[data-k]").forEach(x=>x.onchange=()=>o[x.dataset.k]=x.checked);
    }
    if(i===0){
      const tokenInfo = await currentUser.getIdTokenResult();
      if(renderVersion!==settingsRenderVersion)return;
      const adminButton = tokenInfo.claims.frossAdmin === true ? '<hr style="border:0;border-top:1px solid var(--line);margin:14px 0"><p class="mut">Только для администратора тестового проекта. Удаляет все Auth-аккаунты, профили, чаты и файлы.</p><button class="dg" id="wipeAll" style="width:100%">☠ Удалить ВСЕ тестовые аккаунты</button><div id="wipeBox"></div>' : "";
      c.innerHTML='<div class="sum"><div><b>Google Authenticator (TOTP)</b><small class="mut">Шестизначный код для двухэтапной проверки. Требуется Firebase Authentication with Identity Platform.</small></div></div><div id="totp-box"><button id="totp-start">Подключить Google Authenticator</button><div id="totp-status" class="mut"></div></div><hr style="border:0;border-top:1px solid var(--line);margin:14px 0"><div class="sum"><div><b>Привязка телефона</b><small class="mut">Подтверждённый номер можно будет использовать для восстановления и связи.</small></div></div><label>Номер телефона в международном формате</label><input id="phoneNumber" type="tel" autocomplete="tel" placeholder="+447700900123" value="'+esc(currentUser.phoneNumber||"")+'"><div id="phone-recaptcha-container"></div><small class="mut">Если SMS не отправляется: Firebase Console → Authentication → Sign-in method → Phone должен быть включён; домен сайта добавлен в Authorized domains, а отправка SMS разрешена для вашей страны.</small><button id="phoneSend">Отправить SMS-код</button><label>Код из SMS</label><input id="phoneCode" inputmode="numeric" maxlength="6" placeholder="6 цифр"><button id="phoneConfirm" class="pr">Подтвердить телефон</button><div class="err" id="phoneError"></div><small class="mut">'+(currentUser.phoneNumber?'Телефон привязан: '+esc(currentUser.phoneNumber):'Телефон пока не привязан.')+'</small><hr style="border:0;border-top:1px solid var(--line);margin:14px 0"><label>Смена пароля</label><input id="po" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false" placeholder="Старый пароль"><input id="pn" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false" placeholder="Новый пароль (от 8 символов)"><button id="pc">Сменить пароль</button><div class="err" id="pe"></div><hr style="border:0;border-top:1px solid var(--line);margin:14px 0"><div class="row"><button id="lo">Выйти</button><button class="dg" id="dl">Удалить аккаунт</button></div><div id="db"></div>'+adminButton;
      $("pc").onclick=async()=>{
        try{
          const credential=EmailAuthProvider.credential(currentUser.email,$("po").value);
          await reauthenticateWithCredential(currentUser,credential);
          const newPassword=$("pn").value;
          if(newPassword.length<8)throw Error("Новый пароль должен содержать минимум 8 символов.");
          await updatePassword(currentUser,newPassword);
          $("pe").style.color="#3ddc84";$("pe").textContent="Пароль изменён.";
        }catch(e){$("pe").textContent=authError(e)}
      };
      $("lo").onclick=logout;
      const authSdk=await import("https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js");
      const factors=authSdk.multiFactor(currentUser).enrolledFactors;
      if(factors.length){
        $("totp-status").textContent="Подключено: "+factors.map(f=>f.displayName||"Authenticator").join(", ");
        $("totp-start").textContent="Добавить Authenticator";
        const disable=document.createElement("button");disable.textContent="Отключить Authenticator";disable.style.marginTop="8px";$("totp-box").append(disable);
        disable.onclick=async()=>{try{await authSdk.multiFactor(currentUser).unenroll(factors[0]);$("totp-status").textContent="Authenticator отключён.";disable.remove()}catch(e){$("totp-status").textContent=authError(e)}};
      }
      $("totp-start").onclick=async()=>{
        const status=$("totp-status"),box=$("totp-box");
        try{
          const session=await authSdk.multiFactor(currentUser).getSession();
          const secret=await authSdk.TotpMultiFactorGenerator.generateSecret(session);
          const uri=secret.generateQrCodeUrl(currentUser.email||currentUser.uid,"FROSS Messenger");
          box.innerHTML='<p>Отсканируйте QR-код в Google Authenticator, затем введите текущий код. Если QR не загрузится, добавьте ключ вручную.</p><img id="totp-qr" alt="QR-код настройки" style="display:block;width:220px;max-width:100%;margin:12px auto;border-radius:12px"><label>Секретный ключ (если QR недоступен)</label><code id="totp-secret" style="overflow-wrap:anywhere"></code><label>Шестизначный код</label><input id="totp-code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"><div class="err" id="totp-error"></div><button class="pr" id="totp-confirm" style="width:100%">Подтвердить и включить</button>';
          $("totp-secret").textContent=secret.secretKey;
          try{const qrmod=await import("https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm");$("totp-qr").src=await qrmod.toDataURL(uri,{width:220,margin:2})}
          catch(qrError){$("totp-qr").remove();$("totp-error").textContent="QR недоступен. Используйте секретный ключ вручную."}
          $("totp-confirm").onclick=async()=>{
            try{
              const assertion=authSdk.TotpMultiFactorGenerator.assertionForEnrollment(secret,$("totp-code").value.trim());
              await authSdk.multiFactor(currentUser).enroll(assertion,"FROSS Authenticator");
              $("totp-error").style.color="#3ddc84";$("totp-error").textContent="Google Authenticator успешно подключён.";
              $("totp-confirm").disabled=true;
            }catch(e){$("totp-error").textContent=authError(e)}
          };
        }catch(e){status.textContent=e.code==="auth/operation-not-allowed"?"В Firebase нужно включить Identity Platform и TOTP MFA.":authError(e)}
      };
      let phoneConfirmation = null, phoneVerifier = null;
      $("phoneSend").onclick = async () => {
        try {
          const phone = $("phoneNumber").value.trim().replace(/[\s()-]/g,"");
          if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error("Введите номер в международном формате: +кодстраны и номер.");
          if(phoneVerifier){try{phoneVerifier.clear()}catch{}phoneVerifier=null}
          $("phoneError").style.color="var(--muted)";
          $("phoneError").textContent="Подготавливаем проверку номера…";
          phoneVerifier = new RecaptchaVerifier(auth,"phone-recaptcha-container",{size:"normal"});
          await phoneVerifier.render();
          phoneConfirmation = await linkWithPhoneNumber(currentUser,phone,phoneVerifier);
          $("phoneError").style.color = "#3ddc84";
          $("phoneError").textContent = "SMS отправлено. Введите код из сообщения.";
        } catch(e) {
          $("phoneError").textContent = authError(e);
          if (phoneVerifier) { try { phoneVerifier.clear(); } catch {} phoneVerifier = null; }
        }
      };
      $("phoneConfirm").onclick = async () => {
        try {
          if (!phoneConfirmation) throw new Error("Сначала запросите SMS-код.");
          const linked = await phoneConfirmation.confirm($("phoneCode").value.trim());
          currentUser = linked.user;
          await updateDoc(doc(db,"users",me.uid),{phoneNumber:linked.user.phoneNumber||$("phoneNumber").value.trim(),phoneVerified:true,updatedAt:serverTimestamp()});
          $("phoneError").style.color = "#3ddc84";
          $("phoneError").textContent = "Телефон успешно подтверждён и привязан.";
          if (phoneVerifier) { try { phoneVerifier.clear(); } catch {} phoneVerifier = null; }
        } catch(e) { $("phoneError").textContent = authError(e); }
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
        $("db").innerHTML='<label>Удаление аккаунта необратимо. Профиль станет помечен как удалённый. Личные чаты будут автоматически удалены через 24 часа, а в группах останется уведомление.</label>'+(hasGoogle?'':'<input id="dp" type="password" autocomplete="current-password" placeholder="Пароль для подтверждения">')+'<div class="err" id="de"></div><button class="dg" id="dk" style="width:100%">Подтвердить удаление аккаунта</button>';
        $("dk").onclick=async()=>{
          try{
            if(!confirm("Удалить аккаунт? Личные чаты будут удалены через 24 часа. Это действие нельзя отменить."))return;
            if(hasGoogle)await reauthenticateWithPopup(currentUser,new GoogleAuthProvider());
            else if(hasPassword)await reauthenticateWithCredential(currentUser,EmailAuthProvider.credential(currentUser.email,$("dp").value));
            else throw new Error("Для удаления аккаунта войдите повторно через привязанный способ входа.");
            const token=await currentUser.getIdToken(true);
            const response=await fetch("https://us-central1-fross-ca5d6.cloudfunctions.net/requestAccountDeletion",{method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},body:"{}"});
            const result=await response.json().catch(()=>({}));
            if(!response.ok)throw new Error(result.error||("HTTP "+response.status));
            await signOut(auth);alert("Аккаунт помечен как удалённый. Личные чаты будут удалены в течение 24 часов.");
          }catch(e){$("de").textContent=authError(e)}
        };
      };
    }
  };
  document.querySelectorAll(".settings-category").forEach(b=>b.onclick=()=>show(Number(b.dataset.i)));
  show(startCategory);
  $("sx").onclick=()=>{S=backup;applyS(S);closeM()};
  $("ss").onclick=async()=>{
    const saveButton=$("ss"),originalLabel=saveButton.textContent;
    saveButton.disabled=true;saveButton.textContent=P.avatarDirty?"Загружаем фото…":"Сохраняем…";
    try{
      const username = P.username.trim().toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(username)) throw new Error("Username: 3–20 символов, латиница, цифры и _.");
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
      S={...DEF,...o};me.settings={...S};P.avatarDirty=false;
      try{localStorage.setItem("fross-settings-"+me.uid,JSON.stringify(S))}catch{}
      applyS(S);fillMe();closeM();head();renderList();
      if (username !== oldUsername) location.reload();
    }catch(e){alert(authError(e));saveButton.disabled=false;saveButton.textContent=originalLabel}
  };
};
$("me-profile").onclick=()=>{window.FROSS_SETTINGS_START=3;$("gb").click()};
async function logout(){if(stopChats)stopChats();if(stopMessages)stopMessages();if(presenceTimer)clearInterval(presenceTimer);await signOut(auth);}
async function bootFromAuth(user){await boot(user)}
onAuthStateChanged(auth,async user=>{
  if(user){if(!creatingAccount){if(user.providerData.some(p=>p.providerId==="password")&&!user.emailVerified){const token=await user.getIdTokenResult();if(token.claims.legacyAccount!==true){signOut(auth);return}}bootFromAuth(user)}}
  else{
    currentUser=null;me=null;bootedUid=null;
    if(stopChats)stopChats();if(stopMessages)stopMessages();if(presenceTimer)clearInterval(presenceTimer);
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
    document.body.classList.remove("ch");
    chats?.classList.remove("active");people.classList.add("active");
    window.FROSS_SETTINGS_START=1;$("gb").click();
  };
  if(chats)chats.onclick=()=>{
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
