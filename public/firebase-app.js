import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, updatePassword, reauthenticateWithCredential,
  EmailAuthProvider, deleteUser, GoogleAuthProvider, signInWithPopup,
  sendEmailVerification, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection,
  query, where, orderBy, limit, limitToLast, startAt, endAt, getDocs,
  onSnapshot, runTransaction, writeBatch, serverTimestamp, arrayRemove
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";
import {
  getStorage, ref, uploadString, getDownloadURL, deleteObject
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
const DEF = {theme:"dark",accent:"#9181ff",fs:15,shape:"round",density:"normal",enter:true,h24:true,wall:"none",avatars:true};
const ACC = ["#9181ff","#3b82f6","#10b981","#f59e0b","#ef4444","#ec4899","#06b6d4"];
let currentUser=null, me=null, S={...DEF}, cur="general", chats=[], found=[];
let stopChats=null, stopMessages=null, presenceTimer=null, searchTimer=null, W=null, creatingAccount=false, bootedUid=null;

function authEmail(username) {
  return String(username).trim().toLowerCase() + "@fross-ca5d6.firebaseapp.com";
}
function showLogin() {
  $("auth").style.display="grid"; $("app").style.display="none";
  $("ac").innerHTML='<div class="logo">FROSS</div><p class="mut">Вход в мессенджер</p><label>Email или имя пользователя</label><input id="lu" type="text" autocomplete="username" maxlength="120" placeholder="name@example.com"><label>Пароль</label><input id="lp" type="password" autocomplete="current-password"><div class="err" id="le"></div><div class="row"><button class="pr" id="lg">Войти</button><button id="gr">Google</button></div><p><button class="ic" id="reset">Забыли пароль?</button></p><p style="text-align:center" class="mut">Нет аккаунта? <button class="ic" style="font-size:15px;color:var(--accent)" id="rg">Регистрация</button></p>';
  $("rg").onclick=()=>{W={username:"",email:"",password:"",display_name:"",bio:"",avatar:"",settings:{...DEF}};wiz(1)};
  $("gr").onclick=googleLogin;
  $("reset").onclick=async()=>{const email=$("lu").value.trim();if(!email.includes("@")){$("le").textContent="Сначала введите email.";return}try{await sendPasswordResetEmail(auth,email);$("le").textContent="Письмо для сброса пароля отправлено."}catch(e){$("le").textContent=authError(e)}};
  $("lg").onclick=async()=>{try{
    const identifier=$("lu").value.trim().toLowerCase();
    if(!identifier)throw Error("Введите email или имя пользователя.");
    const email=identifier.includes("@")?identifier:authEmail(identifier);
    const result=await signInWithEmailAndPassword(auth,email,$("lp").value);
    if(!result.user.emailVerified){await sendEmailVerification(result.user);await signOut(auth);$("le").textContent="Подтвердите email по ссылке в письме, затем войдите снова.";return}
  }catch(e){$("le").textContent=authError(e)}};
  $("lp").onkeydown=e=>{if(e.key==="Enter")$("lg").click()};
}

async function googleLogin(){
  try{
    creatingAccount=true;
    const result=await signInWithPopup(auth,new GoogleAuthProvider());
    const user=result.user;
    const profile=await getDoc(doc(db,"publicUsers",user.uid));
    if(!profile.exists()){
      const username=(prompt("Придумайте имя пользователя (3–20 символов, латиница, цифры, _):")||"").trim().toLowerCase();
      if(!/^[a-z0-9_]{3,20}$/.test(username))throw new Error("Некорректное имя пользователя. Войдите через Google ещё раз.");
      await runTransaction(db,async tx=>{
        const index=doc(db,"usernameIndex",username),taken=await tx.get(index);
        if(taken.exists())throw new Error("Это имя пользователя уже занято.");
        tx.set(index,{uid:user.uid,username,usernameLower:username,createdAt:serverTimestamp()});
        tx.set(doc(db,"publicUsers",user.uid),{username,usernameLower:username,displayName:user.displayName||username,bio:"",avatarUrl:user.photoURL||"",lastSeenAt:serverTimestamp()});
        tx.set(doc(db,"users",user.uid),{contactEmail:user.email||"",settings:{...DEF},createdAt:serverTimestamp(),authProvider:"google"});
      });
    }
    creatingAccount=false;await boot(user);
  }catch(e){creatingAccount=false;await signOut(auth).catch(()=>{});$("le").textContent=authError(e)}
}

function authError(e) {
  const code=e?.code||"";
  const map={
    "auth/invalid-credential":"Неверное имя пользователя или пароль.",
    "auth/user-not-found":"Аккаунт не найден.",
    "auth/wrong-password":"Неверный пароль.",
    "auth/email-already-in-use":"Это имя пользователя уже занято.",
    "auth/weak-password":"Пароль слишком простой (минимум 8 символов).",
    "auth/too-many-requests":"Слишком много попыток. Попробуйте позже.",
    "auth/operation-not-allowed":"В Firebase Console включите Authentication → Email/Password.",
    "auth/popup-closed-by-user":"Окно Google было закрыто.",
    "auth/account-exists-with-different-credential":"Для этого email уже существует аккаунт с другим способом входа.",
    "permission-denied":"Firebase Rules запретили операцию. Проверьте опубликованные правила."
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
  if($("msgs"))$("msgs").dataset.w=s.wall;
}
function hue(s) {
  let h=0; for(const c of String(s||"#"))h=(h*31+c.charCodeAt(0))%360;
  return "hsl("+h+" 50% 45%)";
}
function avatar(el,o,on) {
  const name=o?.displayName||o?.display_name||o?.username||o?.title||"#";
  el.classList.toggle("on",!!on);
  el.style.background=o?.avatarUrl||o?.avatar ? "":hue(name);
  el.style.backgroundImage=o?.avatarUrl ? 'url("'+o.avatarUrl+'")' : (o?.avatar ? 'url("'+o.avatar+'")' : "none");
  el.textContent=(o?.avatarUrl||o?.avatar)?"":String(name)[0].toUpperCase();
}
function pickImg(file,cb) {
  const fr=new FileReader();
  fr.onload=()=>{
    const image=new Image();
    image.onload=()=>{
      const c=document.createElement("canvas");c.width=c.height=160;
      const side=Math.min(image.width,image.height);
      c.getContext("2d").drawImage(image,(image.width-side)/2,(image.height-side)/2,side,side,0,0,160,160);
      cb(c.toDataURL("image/jpeg",.82));
    };
    image.src=fr.result;
  };
  fr.readAsDataURL(file);
}
async function uploadAvatar(uid,dataUrl) {
  if(!dataUrl)return "";
  if(dataUrl.startsWith("https://"))return dataUrl;
  const target=ref(storage,"avatars/"+uid+"/avatar.jpg");
  await uploadString(target,dataUrl,"data_url",{contentType:"image/jpeg",cacheControl:"public,max-age=3600"});
  return await getDownloadURL(target);
}
const swatches=(id,selected)=>'<div class="sw" id="'+id+'">'+ACC.map(c=>'<span data-c="'+c+'" style="background:'+c+'" class="'+(c===selected?"s":"")+'"></span>').join("")+'</div>';
function look(o,pre) {
  return '<label>Тема</label><select id="'+pre+'th"><option value="dark">Тёмная</option><option value="light">Светлая</option><option value="auto">Как в системе</option></select><label>Цвет акцента</label>'+swatches(pre+"ac",o.accent)+'<label>Размер текста</label><input id="'+pre+'fs" type="range" min="13" max="19" value="'+o.fs+'"><label>Форма сообщений</label><select id="'+pre+'sh"><option value="round">Скруглённые</option><option value="sq">Прямоугольные</option></select>';
}
function bindLook(o,pre) {
  $(pre+"th").value=o.theme;$(pre+"sh").value=o.shape;
  $(pre+"th").onchange=e=>{o.theme=e.target.value;applyS(o)};
  $(pre+"sh").onchange=e=>{o.shape=e.target.value;applyS(o)};
  $(pre+"fs").oninput=e=>{o.fs=+e.target.value;applyS(o)};
  $(pre+"ac").onclick=e=>{
    const color=e.target.dataset.c;if(!color)return;o.accent=color;
    [...$(pre+"ac").children].forEach(x=>x.classList.toggle("s",x.dataset.c===color));applyS(o);
  };
}

/* Four-step registration wizard */
function wiz(n) {
  const bar='<div class="logo">FROSS</div><div class="steps">'+[1,2,3,4].map(i=>'<i class="'+(i<=n?"d":"")+'"></i>').join("")+'</div><b>Шаг '+n+' из 4</b>';
  let h=bar;
  if(n===1)h+='<label>Имя пользователя</label><input id="u" maxlength="20" placeholder="латиница, цифры, _"><label>Email для входа и подтверждения</label><input id="e" type="email" autocomplete="email" required><label>Пароль</label><input id="p" type="password" placeholder="от 8 символов"><div class="meter"><b id="mt"></b></div><label>Повторите пароль</label><input id="p2" type="password"><small class="mut">На этот адрес придёт письмо со ссылкой подтверждения. После подтверждения можно войти по email и паролю.</small>';
  if(n===2)h+='<div style="display:flex;gap:14px;align-items:center;margin-top:10px"><div class="av big" id="pav"></div><div><button id="up">📷 Загрузить фото</button><input type="file" id="fi" accept="image/*" hidden><br><button class="ic" id="rm" style="font-size:13px">Убрать</button></div></div><label>Отображаемое имя</label><input id="dn" maxlength="40"><label>О себе</label><textarea id="bio" rows="2" maxlength="160"></textarea>';
  if(n===3)h+='<p class="mut">Оформление можно будет поменять в настройках</p>'+look(W.settings,"w");
  if(n===4)h+='<div class="sum"><div class="av big" id="pav"></div><div><b>'+esc(W.display_name||W.username)+'</b><br><span class="mut">@'+esc(W.username)+(W.email?" · "+esc(W.email):"")+'</span><br><span class="mut">'+esc(W.bio)+'</span></div></div><label style="margin-top:14px"><input type="checkbox" id="tos">Принимаю правила тестовой версии</label>';
  h+='<div class="err" id="we"></div><div class="row"><button id="wb">'+(n===1?"Отмена":"Назад")+'</button><button class="pr" id="wn">'+(n===4?"Создать аккаунт":"Далее")+'</button></div>';
  $("ac").innerHTML=h;
  const error=t=>$("we").textContent=t;
  if(n===1){
    $("u").value=W.username;$("e").value=W.email;$("p").value=W.password;$("p2").value=W.password;
    $("p").oninput=e=>{
      const v=e.target.value,score=(v.length>=8)+(v.length>=12)+(/[A-Z]/.test(v)?1:0)+(/\d/.test(v)?1:0)+(/\W/.test(v)?1:0);
      $("mt").style.width=score*20+"%";$("mt").style.background=score<3?"#ff6b6b":score<4?"#f59e0b":"#3ddc84";
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
    return{title:other.displayName||other.username||"Личный чат",avatar:other,sub:isOnline(other)?"в сети":"@"+(other.username||"")};
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
    found.forEach(u=>L.append(item(u,u.displayName||u.username,"@"+u.username,isOnline(u),false,()=>startDM(u))));
  }
  if(!count&&!found.length)L.innerHTML='<div class="empty" style="padding:20px">Ничего не найдено</div>';
}
let stopSearch=null;
async function searchUsers(term) {
  const q=term.trim().toLowerCase();if(q.length<2){found=[];renderList();return;}
  try{
    const users=await getDocs(query(collection(db,"publicUsers"),orderBy("usernameLower"),startAt(q),endAt(q+"\uf8ff"),limit(20)));
    found=users.docs.filter(d=>d.id!==me.uid).map(d=>({uid:d.id,...d.data()}));renderList();
  }catch(e){console.error(e)}
}
function startChatList() {
  if(stopChats)stopChats();
  const q=query(collection(db,"chats"),where("memberUids","array-contains",me.uid),orderBy("updatedAt","desc"),limit(50));
  stopChats=onSnapshot(q,snapshot=>{
    chats=snapshot.docs.map(d=>({id:d.id,...d.data()}));
    renderList();head();
  },e=>console.error("Chat list:",e));
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
}
function openChat(id) {
  cur=id;document.body.classList.add("ch");renderList();head();subscribeMessages();
}
function subscribeMessages() {
  if(stopMessages)stopMessages();
  const box=$("msgs");box.innerHTML='<div class="empty">Загрузка сообщений…</div>';
  const q=query(collection(db,"chats",cur,"messages"),orderBy("createdAt","asc"),limitToLast(100));
  stopMessages=onSnapshot(q,snapshot=>{
    const stick=box.scrollHeight-box.scrollTop-box.clientHeight<120;
    box.innerHTML="";
    if(snapshot.empty)box.innerHTML='<div class="empty">Пока нет сообщений. Напишите первым!</div>';
    let previous="";
    snapshot.docs.forEach(s=>{
      const m={id:s.id,...s.data()},mine=m.senderUid===me.uid,r=document.createElement("div");
      r.className="mr"+(mine?" me":"")+(S.avatars&&!mine&&previous===m.senderUid?" nf":"");
      if(S.avatars&&!mine&&previous!==m.senderUid){
        const a=document.createElement("div");a.className="av";avatar(a,{displayName:m.displayName||m.username,avatarUrl:m.avatarUrl});r.append(a);
      }else if(S.avatars&&!mine)r.classList.add("nf");
      const b=document.createElement("div");b.className="msg";
      if(!mine&&previous!==m.senderUid&&(cur==="general"||chats.find(c=>c.id===cur)?.type==="group")){
        const n=document.createElement("b");n.textContent=m.displayName||m.username||"Пользователь";b.append(n);
      }
      b.append(document.createTextNode(m.text||""));
      const t=document.createElement("time");const date=m.createdAt?.toDate?m.createdAt.toDate():new Date();t.textContent=date.toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit",hour12:!S.h24});b.append(t);
      r.append(b);box.append(r);previous=m.senderUid;
    });
    if(stick)box.scrollTop=box.scrollHeight;
  },e=>{box.textContent="Не удалось загрузить сообщения: "+e.message;});
}
async function loadChatProfile(uid) {
  const snap=await getDoc(doc(db,"publicUsers",uid));
  if(!snap.exists())throw new Error("Пользователь не найден.");
  return{uid,...snap.data()};
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
  S={...DEF,...me.settings};applyS(S);fillMe();
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
  const input=$("inp"),text=input.value.trim();if(!text)return;input.value="";input.style.height="";
  try{
    const chatRef=doc(db,"chats",cur),batch=writeBatch(db);
    const messageRef=doc(collection(db,"chats",cur,"messages"));
    batch.set(messageRef,{senderUid:me.uid,username:me.username,displayName:me.displayName||me.username,text,createdAt:serverTimestamp()});
    batch.update(chatRef,{lastMessage:text.slice(0,120),lastMessageAt:serverTimestamp(),updatedAt:serverTimestamp()});
    await batch.commit();
  }catch(e){alert(authError(e));input.value=text}
}
$("send").onclick=send;
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
    const selected=new Map();$("nc").innerHTML='<label>Название группы</label><input id="gt" maxlength="40"><div id="ch"></div><div id="pk"></div><div class="err" id="ge"></div><button class="pr" id="gc" style="width:100%">Создать группу</button>';
    picker($("pk"),u=>{selected.has(u.uid)?selected.delete(u.uid):selected.set(u.uid,u);$("ch").innerHTML=[...selected.values()].map(u=>'<span class="chip">'+esc(u.displayName||u.username)+'</span>').join("");},selected);
    $("gc").onclick=async()=>{
      const title=$("gt").value.trim();if(!title)return $("ge").textContent="Введите название группы.";
      if(!selected.size)return $("ge").textContent="Добавьте хотя бы одного участника.";
      try{
        const members=[me,{uid:me.uid,username:me.username,displayName:me.displayName,avatarUrl:me.avatarUrl||""},...selected.values()];
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
  const backup=JSON.parse(JSON.stringify(S)),o={...S},P={displayName:me.displayName||"",bio:me.bio||"",contactEmail:me.contactEmail||"",avatarUrl:me.avatarUrl||""};
  openM('<h3 style="margin:0">Настройки</h3><div class="tabs"><button data-i="0">Профиль</button><button data-i="1">Оформление</button><button data-i="2">Чат</button><button data-i="3">Аккаунт</button></div><div id="sc"></div><div class="row"><button id="sx">Отмена</button><button class="pr" id="ss">Сохранить</button></div>');
  const toggle=(k,label,description)=>'<div class="sw2"><div>'+label+(description?'<br><small class="mut">'+description+'</small>':"")+'</div><input type="checkbox" data-k="'+k+'" '+(o[k]?"checked":"")+'></div>';
  const show=i=>{
    document.querySelectorAll("#md .tabs button").forEach((b,j)=>b.classList.toggle("a",i===j));
    const c=$("sc");
    if(i===0){
      c.innerHTML='<div style="display:flex;gap:14px;align-items:center"><div class="av big" id="pav"></div><div><button id="up">📷 Сменить фото</button><input type="file" id="fi" accept="image/*" hidden><br><button class="ic" id="rm" style="font-size:13px">Убрать фото</button></div></div><label>Отображаемое имя</label><input id="dn" maxlength="40"><label>О себе</label><textarea id="bio" rows="2" maxlength="160"></textarea><label>Контактный email</label><input id="em" type="email"><p class="mut">Логин: @'+esc(me.username)+'</p>';
      $("dn").value=P.displayName;$("bio").value=P.bio;$("em").value=P.contactEmail;avatar($("pav"),{displayName:P.displayName,avatarUrl:P.avatarUrl});
      $("dn").oninput=e=>P.displayName=e.target.value;$("bio").oninput=e=>P.bio=e.target.value;$("em").oninput=e=>P.contactEmail=e.target.value;
      $("up").onclick=()=>$("fi").click();$("fi").onchange=e=>e.target.files[0]&&pickImg(e.target.files[0],d=>{P.avatarUrl=d;avatar($("pav"),{displayName:P.displayName,avatarUrl:d})});
      $("rm").onclick=()=>{P.avatarUrl="";avatar($("pav"),{displayName:P.displayName})};
    }
    if(i===1){
      c.innerHTML=look(o,"s")+'<label>Фон чата</label><select id="sw"><option value="none">Без фона</option><option value="dots">Точки</option><option value="grad">Градиент</option></select>';
      bindLook(o,"s");$("sw").value=o.wall;$("sw").onchange=e=>{o.wall=e.target.value;applyS(o)};
    }
    if(i===2){
      c.innerHTML=toggle("avatars","Аватары в сообщениях")+toggle("h24","24-часовое время")+toggle("enter","Enter — отправить","Выключено: Ctrl+Enter, Enter — новая строка")+'<label>Плотность сообщений</label><select id="sd"><option value="normal">Обычная</option><option value="compact">Компактная</option></select>';
      $("sd").value=o.density;$("sd").onchange=e=>{o.density=e.target.value;applyS(o)};
      c.querySelectorAll("[data-k]").forEach(x=>x.onchange=()=>o[x.dataset.k]=x.checked);
    }
    if(i===3){
      c.innerHTML='<label>Смена пароля</label><input id="po" type="password" placeholder="Старый пароль"><input id="pn" type="password" placeholder="Новый пароль (от 8 символов)"><button id="pc">Сменить пароль</button><div class="err" id="pe"></div><hr style="border:0;border-top:1px solid var(--line);margin:14px 0"><div class="row"><button id="lo">Выйти</button><button class="dg" id="dl">Удалить аккаунт</button></div><div id="db"></div>';
      $("pc").onclick=async()=>{
        try{
          const credential=EmailAuthProvider.credential(currentUser.email,$("po").value);
          await reauthenticateWithCredential(currentUser,credential);
          await updatePassword(currentUser,$("pn").value);
          $("pe").style.color="#3ddc84";$("pe").textContent="Пароль изменён.";
        }catch(e){$("pe").textContent=authError(e)}
      };
      $("lo").onclick=logout;
      $("dl").onclick=()=>{$("db").innerHTML='<label>Введите пароль для удаления аккаунта. Ваш профиль будет удалён, история сообщений останется у собеседников.</label><input id="dp" type="password"><div class="err" id="de"></div><button class="dg" id="dk" style="width:100%">Удалить аккаунт</button>';
        $("dk").onclick=async()=>{
          try{
            await reauthenticateWithCredential(currentUser,EmailAuthProvider.credential(currentUser.email,$("dp").value));
            const chatsSnap=await getDocs(query(collection(db,"chats"),where("memberUids","array-contains",me.uid)));
            for(const c of chatsSnap.docs)await updateDoc(c.ref,{memberUids:arrayRemove(me.uid),updatedAt:serverTimestamp()});
            await deleteDoc(doc(db,"usernameIndex",me.usernameLower||me.username.toLowerCase()));
            await deleteDoc(doc(db,"publicUsers",me.uid));await deleteDoc(doc(db,"users",me.uid));
            if(me.avatarUrl)try{await deleteObject(ref(storage,"avatars/"+me.uid+"/avatar.jpg"))}catch{}
            await deleteUser(currentUser);
          }catch(e){$("de").textContent=authError(e)}
        };
      };
    }
  };
  document.querySelectorAll("#md .tabs button").forEach(b=>b.onclick=()=>show(+b.dataset.i));show(0);
  $("sx").onclick=()=>{S=backup;applyS(S);closeM()};
  $("ss").onclick=async()=>{
    try{
      const avatarUrl=await uploadAvatar(me.uid,P.avatarUrl);
      await updateDoc(doc(db,"publicUsers",me.uid),{displayName:P.displayName||me.username,bio:P.bio||"",avatarUrl});
      await updateDoc(doc(db,"users",me.uid),{contactEmail:P.contactEmail||"",settings:o,updatedAt:serverTimestamp()});
      Object.assign(me,{displayName:P.displayName||me.username,bio:P.bio||"",avatarUrl,contactEmail:P.contactEmail||""});S=o;applyS(S);fillMe();closeM();head();renderList();
    }catch(e){alert(authError(e))}
  };
};
async function logout(){if(stopChats)stopChats();if(stopMessages)stopMessages();if(presenceTimer)clearInterval(presenceTimer);await signOut(auth);}
async function bootFromAuth(user){await boot(user)}
onAuthStateChanged(auth,user=>{
  if(user){if(!creatingAccount){if(user.providerData.some(p=>p.providerId==="password")&&!user.emailVerified){signOut(auth);return}bootFromAuth(user)}}
  else{
    currentUser=null;me=null;bootedUid=null;
    if(stopChats)stopChats();if(stopMessages)stopMessages();if(presenceTimer)clearInterval(presenceTimer);
    showLogin();
  }
});
