let installPrompt=null,registration=null,waitingWorker=null;
const banner=()=>{
 let el=document.getElementById("fross-update-banner");
 if(!el){el=document.createElement("div");el.id="fross-update-banner";el.innerHTML='<span id="fross-update-text">Доступно обновление FROSS</span><button id="fross-update-action" class="pr">Установить обновление</button>';document.body.append(el)}
 return el;
};
function showUpdate(text,action){
 const el=banner(),label=el.querySelector("#fross-update-text"),button=el.querySelector("#fross-update-action");
 label.textContent=text;button.textContent=action;el.classList.add("visible");
}
window.addEventListener("beforeinstallprompt",event=>{
 event.preventDefault();installPrompt=event;
 const el=banner();showUpdate("Установить FROSS на устройство?","Установить");
 el.querySelector("button").onclick=async()=>{
  if(!installPrompt)return;
  installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;el.classList.remove("visible");
 };
});
window.addEventListener("appinstalled",()=>{installPrompt=null;});
if("serviceWorker" in navigator){
 window.addEventListener("load",async()=>{
  try{
   registration=await navigator.serviceWorker.register("/sw.js",{updateViaCache:"none"});
   await registration.update();
   const offer=worker=>{
    waitingWorker=worker;
    showUpdate("Доступна новая версия FROSS","Установить обновление");
    banner().querySelector("button").onclick=()=>{
     if(waitingWorker)waitingWorker.postMessage({type:"SKIP_WAITING"});
     showUpdate("Обновление установлено. Перезапустите FROSS.","Перезапустить");
     banner().querySelector("button").onclick=()=>location.reload();
    };
   };
   if(registration.waiting)offer(registration.waiting);
   registration.addEventListener("updatefound",()=>{
    const worker=registration.installing;
    if(!worker)return;
    worker.addEventListener("statechange",()=>{if(worker.state==="installed"&&navigator.serviceWorker.controller)offer(worker)});
   });
   let hadController=!!navigator.serviceWorker.controller;
   navigator.serviceWorker.addEventListener("controllerchange",()=>{
    if(!hadController){hadController=true;return}
    showUpdate("Обновление готово. Нажмите «Перезапустить».","Перезапустить");
    banner().querySelector("button").onclick=()=>location.reload();
   });
  }catch(error){console.warn("FROSS update service unavailable",error)}
 });
}
