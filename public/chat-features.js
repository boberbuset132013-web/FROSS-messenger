const FROSS_API_ORIGIN = window.FROSS_NATIVE_APP ? "https://fross-messenger.boberbuset132013.workers.dev" : "";
export function uploadChatFile(chatId,file,token,onProgress=()=>{}) {
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest(),name=encodeURIComponent(file.name||"file");
    xhr.open("POST",FROSS_API_ORIGIN+"/api/files/upload?scope=chat&chatId="+encodeURIComponent(chatId)+"&name="+name);
    xhr.setRequestHeader("Authorization","Bearer "+token);xhr.setRequestHeader("Content-Type",file.type||"application/octet-stream");
    xhr.upload.onprogress=event=>{const percent=event.lengthComputable&&event.total?Math.round(event.loaded/event.total*100):0;onProgress(percent,event.loaded,event.total||0)};
    xhr.onload=()=>{let data={};try{data=JSON.parse(xhr.responseText)}catch{};if(xhr.status>=200&&xhr.status<300&&data.path)resolve({url:"filebase:"+data.path,path:data.path});else reject(new Error(data.error||("Файловый сервер вернул ошибку "+xhr.status)))};
    xhr.onerror=()=>reject(new Error("Сетевая ошибка при отправке файла."));xhr.onabort=()=>reject(new Error("Загрузка файла отменена."));xhr.send(file);
  });
}
export function createUploadProgress(container,fileName) {
  const card=document.createElement("div");card.className="upload-progress";const label=document.createElement("div");label.className="upload-progress-label";
  const name=document.createElement("span");name.textContent=fileName;const percent=document.createElement("b");percent.textContent="0%";label.append(name,percent);
  const track=document.createElement("div");track.className="upload-progress-track";const bar=document.createElement("i");track.append(bar);
  const status=document.createElement("small");status.textContent="Подготовка файла…";card.append(label,track,status);container.append(card);
  return {update(value){const safe=Math.max(0,Math.min(100,Number(value)||0));percent.textContent=safe+"%";bar.style.width=safe+"%";status.textContent=safe>=100?"Загрузка завершена. Отправляем сообщение…":"Загружаем файл…"},remove(){card.remove()}};
}
export function appendMentionText(container,value,onMention) {
  const text=String(value||""),pattern=/(^|[\\s(])@([a-z0-9_]{3,20})/gi;let cursor=0,match;
  while((match=pattern.exec(text))){const start=match.index+match[1].length;if(start>cursor)container.append(document.createTextNode(text.slice(cursor,start)));const username=match[2];const link=document.createElement("a");link.className="mention-link";link.href="#profile-"+encodeURIComponent(username);link.textContent="@"+username;link.addEventListener("click",event=>{event.preventDefault();onMention(username)});container.append(link);cursor=start+match[0].length-match[1].length}
  if(cursor<text.length)container.append(document.createTextNode(text.slice(cursor)));
}
export function appendReadReceipt(container,state) {
  const receipt=document.createElement("span");receipt.className="read-receipt"+(state.read?" is-read":"");receipt.textContent=state.read?"✓✓":"✓";receipt.title=state.read?"Прочитано всеми участниками":"Отправлено";receipt.setAttribute("aria-label",receipt.title);container.append(receipt);return receipt;
}
