const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
const encoder=new TextEncoder();
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
async function hash(s){return hex(await crypto.subtle.digest("SHA-256",encoder.encode(s)))}
async function passwordHash(password,salt){const key=await crypto.subtle.importKey("raw",encoder.encode(password),"PBKDF2",false,["deriveBits"]);return hex(await crypto.subtle.deriveBits({name:"PBKDF2",salt:encoder.encode(salt),iterations:210000,hash:"SHA-256"},key,256))}
function randomToken(){const b=crypto.getRandomValues(new Uint8Array(32));return [...b].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function body(req){try{return await req.json()}catch{return {}}}
async function auth(req,env){const h=req.headers.get("Authorization")||"",token=h.startsWith("Bearer ")?h.slice(7):"";if(!token)return null;return env.DB.prepare("SELECT users.id, users.username FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?").bind(await hash(token),Date.now()).first()}
function validName(s){return typeof s==="string"&&/^[a-zA-Z0-9_]{3,20}$/.test(s)}
function validPassword(s){return typeof s==="string"&&s.length>=8&&s.length<=128}
export default {async fetch(req,env){
 try {
 const url=new URL(req.url),p=url.pathname,m=req.method;
 if(m==="OPTIONS")return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Authorization"}});
 if(p==="/api/health"){
  if(!env.DB)return json({ok:false,service:"FROSS Messenger",database:false,tablesReady:false},503);
  const result=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','sessions','messages')").all();
  const tables=result.results.map(row=>row.name);
  return json({ok:true,service:"FROSS Messenger",database:true,tables,tablesReady:["users","sessions","messages"].every(name=>tables.includes(name))});
 }
 if(!env.DB)return json({error:"Не настроена база D1 (binding DB)."},503);
 if(p==="/api/register"&&m==="POST"){const d=await body(req),username=String(d.username||"").trim(),password=d.password;if(!validName(username)||!validPassword(password))return json({error:"Имя: 3–20 символов (латиница, цифры, _). Пароль: 8–128 символов."},400);const exists=await env.DB.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE").bind(username).first();if(exists)return json({error:"Это имя уже занято."},409);const id=crypto.randomUUID(),salt=randomToken(),ph=await passwordHash(password,salt);await env.DB.prepare("INSERT INTO users(id,username,password_hash,password_salt,created_at) VALUES(?,?,?,?,?)").bind(id,username,ph,salt,Date.now()).run();const token=randomToken();await env.DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").bind(await hash(token),id,Date.now()+30*86400000).run();return json({token,user:{id,username}},201)}
 if(p==="/api/login"&&m==="POST"){const d=await body(req),username=String(d.username||"").trim();if(!validName(username)||typeof d.password!=="string")return json({error:"Проверьте имя и пароль."},400);const u=await env.DB.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE").bind(username).first();if(!u||await passwordHash(d.password,u.password_salt)!==u.password_hash)return json({error:"Неверное имя пользователя или пароль."},401);const token=randomToken();await env.DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").bind(await hash(token),u.id,Date.now()+30*86400000).run();return json({token,user:{id:u.id,username:u.username}})}
 const user=await auth(req,env);if(!user)return json({error:"Требуется войти в аккаунт."},401);
 if(p==="/api/me"&&m==="GET")return json({user});
 if(p==="/api/logout"&&m==="POST"){const t=(req.headers.get("Authorization")||"").slice(7);await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await hash(t)).run();return json({ok:true})}
 if(p==="/api/messages"&&m==="GET"){const chat=url.searchParams.get("chat")||"general";if(chat!=="general")return json({error:"Пока доступен только общий чат."},400);const rows=await env.DB.prepare("SELECT messages.id,messages.body,messages.created_at,users.username FROM messages JOIN users ON users.id=messages.user_id WHERE messages.room_id=? ORDER BY messages.created_at DESC LIMIT 100").bind(chat).all();return json({messages:rows.results.reverse()})}
 if(p==="/api/messages"&&m==="POST"){const d=await body(req),chat=d.chat||"general",text=typeof d.body==="string"?d.body.trim():"";if(chat!=="general")return json({error:"Неизвестный чат."},400);if(!text||text.length>4000)return json({error:"Сообщение должно содержать от 1 до 4000 символов."},400);const id=crypto.randomUUID(),created=Date.now();await env.DB.prepare("INSERT INTO messages(id,room_id,user_id,body,created_at) VALUES(?,?,?,?,?)").bind(id,chat,user.id,text,created).run();return json({ok:true,id,created_at:created},201)}
 return json({error:"Маршрут не найден."},404);
 } catch(error) {
   console.error("FROSS Messenger API error:",error);
   return json({error:"Внутренняя ошибка сервера.",diagnostic:String(error?.message||error).slice(0,240)},500);
 }
}};
