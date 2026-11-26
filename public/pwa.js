let registration=null,waitingWorker=null,reloadWhenReady=false;
function updateBanner(){
 let el=document.getElementById("fross-update-banner");
 if(!el){
  el=document.createElement("div");
  el.id="fross-update-banner";
  el.innerHTML='<span id="fross-update-text">Новая версия FROSS готова</span><button id="fross-update-action" class="pr" type="button">Перезапустить</button>';
  document.body.append(el);
 }
 return el;
}
function offerRestart(worker){
 if(!worker||worker.state!=="installed"||!navigator.serviceWorker.controller)return;
 waitingWorker=worker;
 const el=updateBanner(),button=el.querySelector("#fross-update-action");
 el.querySelector("#fross-update-text").textContent="Доступна новая версия FROSS. Перезапусти приложение, чтобы применить её.";
 button.textContent="Перезапустить";
 button.disabled=false;
 el.classList.add("visible");
 button.onclick=()=>{
  if(!waitingWorker)return;
  reloadWhenReady=true;
  button.disabled=true;
  button.textContent="Перезапускаем…";
  waitingWorker.postMessage({type:"SKIP_WAITING"});
 };
}
if("serviceWorker" in navigator){
 window.addEventListener("load",async()=>{
  try{
   registration=await navigator.serviceWorker.register("/sw.js",{updateViaCache:"none"});
   registration.addEventListener("updatefound",()=>{
    const worker=registration.installing;
    if(!worker)return;
    worker.addEventListener("statechange",()=>{
     if(worker.state==="installed"&&navigator.serviceWorker.controller)offerRestart(worker);
    });
   });
   if(registration.waiting)offerRestart(registration.waiting);
   navigator.serviceWorker.addEventListener("controllerchange",()=>{
    if(reloadWhenReady)location.reload();
   });
   await registration.update();
   if(registration.waiting)offerRestart(registration.waiting);
  }catch(error){console.warn("FROSS update service unavailable",error)}
 });
}
