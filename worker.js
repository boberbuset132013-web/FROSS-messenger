const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
const encoder=new TextEncoder();
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
async function hash(s){return hex(await crypto.subtle.digest("SHA-256",encoder.encode(s)))}
async function passwordHash(password,salt){const key=await crypto.subtle.importKey("raw",encoder.encode(password),"PBKDF2",false,["deriveBits"]);return hex(await crypto.subtle.deriveBits({name:"PBKDF2",salt:encoder.encode(salt),iterations:100000,hash:"SHA-256"},key,256))}
function randomToken(){const b=crypto.getRandomValues(new Uint8Array(32));return [...b].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function body(req){try{return await req.json()}catch{return {}}}
function validName(s){return typeof s==="string"&&/^[a-zA-Z0-9_]{3,20}$/.test(s)}
function validPassword(s){return typeof s==="string"&&s.length>=8&&s.length<=128}
const COLS="users.id, users.username, users.display_name, users.bio, users.email, users.avatar, users.settings";
function userOut(u){let s={};try{s=JSON.parse(u.settings||"{}")}catch{}return{id:u.id,username:u.username,display_name:u.display_name||u.username,bio:u.bio||"",email:u.email||"",avatar:u.avatar||"",settings:s}}
function prof(d){
  const display_name=String(d.display_name||"").trim().slice(0,40),bio=String(d.bio||"").trim().slice(0,160),email=String(d.email||"").trim().slice(0,100);
  let avatar=typeof d.avatar==="string"?d.avatar:"";if(avatar&&(!avatar.startsWith("data:image/")||avatar.length>60000))avatar="";
  let settings="{}";try{const s=JSON.stringify(d.settings&&typeof d.settings==="object"?d.settings:{});if(s.length<=2000)settings=s}catch{}
  return{display_name,bio,email,avatar,settings,emailOk:!email||/^\S+@\S+\.\S+$/.test(email)};
}
async function auth(req,env){
  const h=req.headers.get("Authorization")||"",token=h.startsWith("Bearer ")?h.slice(7):"";if(!token)return null;
  const u=await env.DB.prepare(`SELECT ${COLS} FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?`).bind(await hash(token),Date.now()).first();
  if(u)await env.DB.prepare("UPDATE users SET last_seen=? WHERE id=?").bind(Date.now(),u.id).run();
  return u;
}
async function isMember(env,chat,uid){if(chat==="general")return true;return !!await env.DB.prepare("SELECT 1 AS x FROM chat_members WHERE chat_id=? AND user_id=?").bind(chat,uid).first()}
async function newSession(env,id){const token=randomToken();await env.DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").bind(await hash(token),id,Date.now()+30*86400000).run();return token}
export default {async fetch(req,env){
 try {
  const url=new URL(req.url),p=url.pathname,m=req.method;
  if(m==="OPTIONS")return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Authorization"}});
  if(p==="/api/health"){
   if(!env.DB)return json({ok:false,service:"FROSS Messenger",database:false,tablesReady:false},503);
   const result=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','sessions','messages','chats','chat_members')").all();
   const tables=result.results.map(r=>r.name);
   return json({ok:true,service:"FROSS Messenger",database:true,tables,tablesReady:["users","sessions","messages","chats","chat_members"].every(n=>tables.includes(n))});
  }
  // Set MAINTENANCE_MODE=true in Worker variables to pause all authenticated
  // and anonymous API writes/reads during a final database export and cutover.
  // /api/health remains available for operational checks.
  if(env.MAINTENANCE_MODE==="true")return json({error:"Сервис временно на техническом обслуживании. Попробуйте позже."},503);
  if(!env.DB)return json({error:"Не настроена база D1 (binding DB)."},503);

  if(p==="/api/register"&&m==="POST"){
   const d=await body(req),username=String(d.username||"").trim(),pr=prof(d);
   if(!validName(username)||!validPassword(d.password))return json({error:"Имя: 3–20 символов (латиница, цифры, _). Пароль: 8–128 символов."},400);
   if(!pr.emailOk)return json({error:"Некорректный email."},400);
   if(await env.DB.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE").bind(username).first())return json({error:"Это имя уже занято."},409);
   const id=crypto.randomUUID(),salt=randomToken(),ph=await passwordHash(d.password,salt);
   await env.DB.prepare("INSERT INTO users(id,username,password_hash,password_salt,created_at,display_name,bio,email,avatar,settings,last_seen) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(id,username,ph,salt,Date.now(),pr.display_name||username,pr.bio,pr.email,pr.avatar,pr.settings,Date.now()).run();
   return json({token:await newSession(env,id),user:{id,username}},201);
  }
  if(p==="/api/login"&&m==="POST"){
   const d=await body(req),username=String(d.username||"").trim();
   if(!validName(username)||typeof d.password!=="string")return json({error:"Проверьте имя и пароль."},400);
   const u=await env.DB.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE").bind(username).first();
   if(!u||await passwordHash(d.password,u.password_salt)!==u.password_hash)return json({error:"Неверное имя пользователя или пароль."},401);
   return json({token:await newSession(env,u.id),user:{id:u.id,username:u.username}});
  }
  const user=await auth(req,env);if(!user)return json({error:"Требуется войти в аккаунт."},401);

  if(p==="/api/me"&&m==="GET")return json({user:userOut(user)});
  if(p==="/api/logout"&&m==="POST"){const t=(req.headers.get("Authorization")||"").slice(7);await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await hash(t)).run();return json({ok:true})}
  if(p==="/api/profile"&&m==="POST"){
   const d=await body(req),pr=prof(d);if(!pr.emailOk)return json({error:"Некорректный email."},400);
   await env.DB.prepare("UPDATE users SET display_name=?,bio=?,email=?,avatar=?,settings=? WHERE id=?").bind(pr.display_name||user.username,pr.bio,pr.email,pr.avatar,pr.settings,user.id).run();
   return json({ok:true});
  }
  if(p==="/api/password"&&m==="POST"){
   const d=await body(req),u=await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(user.id).first();
   if(await passwordHash(String(d.old||""),u.password_salt)!==u.password_hash)return json({error:"Старый пароль неверен."},401);
   if(!validPassword(d.new))return json({error:"Новый пароль: 8–128 символов."},400);
   const salt=randomToken();await env.DB.prepare("UPDATE users SET password_hash=?,password_salt=? WHERE id=?").bind(await passwordHash(d.new,salt),salt,user.id).run();
   return json({ok:true});
  }
  if(p==="/api/account/delete"&&m==="POST"){
   const d=await body(req),u=await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(user.id).first();
   if(await passwordHash(String(d.password||""),u.password_salt)!==u.password_hash)return json({error:"Неверный пароль."},401);
   await env.DB.batch([
    env.DB.prepare("DELETE FROM messages WHERE user_id=?").bind(user.id),
    env.DB.prepare("DELETE FROM chat_members WHERE user_id=?").bind(user.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(user.id),
    env.DB.prepare("DELETE FROM users WHERE id=?").bind(user.id)]);
   return json({ok:true});
  }
  if(p==="/api/users/search"&&m==="GET"){
   const q=(url.searchParams.get("q")||"").trim().slice(0,30),like="%"+q.replace(/[\\%_]/g,"\\$&")+"%";
   const r=await env.DB.prepare("SELECT id,username,display_name,avatar,bio,last_seen FROM users WHERE id!=? AND (username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\') ORDER BY username LIMIT 20").bind(user.id,like,like).all();
   return json({users:r.results});
  }
  if(p==="/api/chats"&&m==="GET"){
   const cs=(await env.DB.prepare("SELECT c.id,c.type,c.title,c.owner_id,c.created_at,(SELECT body FROM messages WHERE room_id=c.id ORDER BY created_at DESC LIMIT 1) AS last_body,(SELECT MAX(created_at) FROM messages WHERE room_id=c.id) AS last_at FROM chats c JOIN chat_members m ON m.chat_id=c.id WHERE m.user_id=?").bind(user.id).all()).results;
   const ms=(await env.DB.prepare("SELECT m.chat_id,u.id,u.username,u.display_name,u.avatar,u.last_seen FROM chat_members m JOIN users u ON u.id=m.user_id WHERE m.chat_id IN (SELECT chat_id FROM chat_members WHERE user_id=?)").bind(user.id).all()).results;
   for(const c of cs)c.members=ms.filter(x=>x.chat_id===c.id);
   cs.sort((a,b)=>(b.last_at||b.created_at)-(a.last_at||a.created_at));
   return json({chats:cs});
  }
  if(p==="/api/chats"&&m==="POST"){
   const d=await body(req),now=Date.now();
   if(d.type==="dm"){
    const other=String(d.user_id||"");if(other===user.id||!await env.DB.prepare("SELECT id FROM users WHERE id=?").bind(other).first())return json({error:"Пользователь не найден."},404);
    const id="dm:"+[user.id,other].sort().join(":");
    await env.DB.batch([env.DB.prepare("INSERT OR IGNORE INTO chats(id,type,owner_id,created_at) VALUES(?,?,?,?)").bind(id,"dm",user.id,now),
     env.DB.prepare("INSERT OR IGNORE INTO chat_members(chat_id,user_id) VALUES(?,?)").bind(id,user.id),env.DB.prepare("INSERT OR IGNORE INTO chat_members(chat_id,user_id) VALUES(?,?)").bind(id,other)]);
    return json({id},201);
   }
   if(d.type==="group"){
    const title=String(d.title||"").trim().slice(0,40);if(!title)return json({error:"Введите название группы."},400);
    const ids=[...new Set((Array.isArray(d.members)?d.members:[]).map(String))].filter(x=>x!==user.id).slice(0,49);
    const found=ids.length?(await env.DB.prepare(`SELECT id FROM users WHERE id IN (${ids.map(()=>"?").join(",")})`).bind(...ids).all()).results.map(r=>r.id):[];
    const id="g:"+crypto.randomUUID();
    await env.DB.batch([env.DB.prepare("INSERT INTO chats(id,type,title,owner_id,created_at) VALUES(?,?,?,?,?)").bind(id,"group",title,user.id,now),
     ...[user.id,...found].map(uid=>env.DB.prepare("INSERT INTO chat_members(chat_id,user_id) VALUES(?,?)").bind(id,uid))]);
    return json({id},201);
   }
   return json({error:"Неизвестный тип чата."},400);
  }
  if(p==="/api/messages"&&m==="GET"){
   const chat=url.searchParams.get("chat")||"general";if(!await isMember(env,chat,user.id))return json({error:"Нет доступа к чату."},403);
   const rows=await env.DB.prepare("SELECT messages.id,messages.body,messages.created_at,users.username,users.display_name,users.avatar FROM messages JOIN users ON users.id=messages.user_id WHERE messages.room_id=? ORDER BY messages.created_at DESC LIMIT 100").bind(chat).all();
   return json({messages:rows.results.reverse()});
  }
  if(p==="/api/messages"&&m==="POST"){
   const d=await body(req),chat=String(d.chat||"general"),text=typeof d.body==="string"?d.body.trim():"";
   if(!await isMember(env,chat,user.id))return json({error:"Нет доступа к чату."},403);
   if(!text||text.length>4000)return json({error:"Сообщение должно содержать от 1 до 4000 символов."},400);
   const id=crypto.randomUUID(),created=Date.now();
   await env.DB.prepare("INSERT INTO messages(id,room_id,user_id,body,created_at) VALUES(?,?,?,?,?)").bind(id,chat,user.id,text,created).run();
   return json({ok:true,id,created_at:created},201);
  }
  return json({error:"Маршрут не найден."},404);
 } catch(error) {
  console.error("FROSS Messenger API error:",error);
  return json({error:"Внутренняя ошибка сервера.",diagnostic:String(error?.message||error).slice(0,240)},500);
 }
}};
