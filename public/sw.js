const CACHE="fross-shell-v34";
const SHELL=["/","/index.html","/firebase-app.js","/chat-features.js","/voice-calls.js","/space-ui.css","/manifest.webmanifest","/fross-icon.webp","/fross-mascot.webp"];
self.addEventListener("install",event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 await Promise.all(SHELL.map(async path=>{try{await cache.add(path)}catch(error){console.warn("FROSS cache skipped",path,error)}}));
})()));
self.addEventListener("activate",event=>event.waitUntil((async()=>{
 const keys=await caches.keys();
 await Promise.all(keys.filter(key=>key.startsWith("fross-shell-")&&key!==CACHE).map(key=>caches.delete(key)));
 await self.clients.claim();
})()));
self.addEventListener("message",event=>{if(event.data?.type==="SKIP_WAITING")self.skipWaiting()});
self.addEventListener("fetch",event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=="GET"||url.origin!==self.location.origin)return;
 if(request.mode==="navigate"){
  event.respondWith(fetch(request).then(response=>{
   const copy=response.clone();caches.open(CACHE).then(cache=>cache.put("/index.html",copy));return response;
  }).catch(()=>caches.match("/index.html")));
  return;
 }
 const appCode=/\.(?:js|css)$/i.test(url.pathname);
 if(appCode){
  event.respondWith(fetch(request).then(response=>{
   if(response.ok)caches.open(CACHE).then(cache=>cache.put(request,response.clone()));
   return response;
  }).catch(()=>caches.match(request)));
  return;
 }
 event.respondWith(caches.match(request).then(cached=>{
  if(cached)return cached;
  return fetch(request).then(response=>{
   if(response.ok)caches.open(CACHE).then(cache=>cache.put(request,response.clone()));
   return response;
  });
 }));
});