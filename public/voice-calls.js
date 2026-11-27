import { getApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import {
  getFirestore, doc, collection, query, where, limit, getDoc, setDoc,
  updateDoc, addDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);
const FALLBACK_ICE_SERVERS = [
  {urls:["stun:stun.l.google.com:19302","stun:stun1.l.google.com:19302"]},
  {urls:["stun:stun.cloudflare.com:3478"]}
];
let iceServersCache=null,iceServersCacheAt=0;
async function loadIceServers(){
  if(iceServersCache&&Date.now()-iceServersCacheAt<6*60*60*1000)return iceServersCache;
  try{
    const user=auth.currentUser;if(!user)return FALLBACK_ICE_SERVERS;
    const token=await user.getIdToken();
    const apiOrigin=window.FROSS?.apiOrigin||"";
    const response=await fetch(apiOrigin+"/api/calls/ice",{headers:{Authorization:"Bearer "+token}});
    if(!response.ok)throw new Error("ICE config HTTP "+response.status);
    const result=await response.json();
    if(Array.isArray(result.iceServers)&&result.iceServers.length){iceServersCache=result.iceServers;iceServersCacheAt=Date.now();}
  }catch(error){console.warn("FROSS TURN config unavailable; using STUN fallback:",error?.message||error)}
  return iceServersCache||FALLBACK_ICE_SERVERS;
}

let signedInUser = null;
let activeCall = null;
let incomingStop = null;
let audioElement = null;
const seenIncoming = new Set();
let screenStream=null,renegotiationSeen=0;
const micSelect=$("mic-device"),outputSelect=$("audio-device"),remoteScreen=$("remote-screen");
async function refreshCallDevices(){
  if(!navigator.mediaDevices?.enumerateDevices)return;
  try{
    const devices=await navigator.mediaDevices.enumerateDevices();
    const fill=(select,kind,label)=>{if(!select)return;const old=select.value;select.replaceChildren();devices.filter(d=>d.kind===kind).forEach((d,i)=>{const o=document.createElement("option");o.value=d.deviceId;o.textContent=d.label||label+" "+(i+1);select.append(o)});if([...select.options].some(o=>o.value===old))select.value=old};
    fill(micSelect,"audioinput","Микрофон");fill(outputSelect,"audiooutput","Динамик");
  }catch(e){console.warn("Device enumeration failed:",e)}
}
async function changeMicrophone(deviceId){
  if(!activeCall?.peer||!deviceId)return;
  try{
    const next=await navigator.mediaDevices.getUserMedia({audio:{deviceId:{exact:deviceId}},video:false});
    const newTrack=next.getAudioTracks()[0],oldTrack=activeCall.stream.getAudioTracks()[0];
    const sender=activeCall.peer.getSenders().find(s=>s.track?.kind==="audio");
    if(sender)await sender.replaceTrack(newTrack);else activeCall.peer.addTrack(newTrack,next);
    if(oldTrack){activeCall.stream.removeTrack(oldTrack);oldTrack.stop()}
    activeCall.stream.addTrack(newTrack);$("call-status").textContent="Микрофон переключён.";
  }catch(e){$("call-status").textContent="Не удалось переключить микрофон: "+e.message}
}
async function changeAudioOutput(deviceId){
  if(!audioElement||!deviceId)return;
  if(typeof audioElement.setSinkId!=="function"){$("call-status").textContent="Браузер не поддерживает выбор устройства вывода.";return}
  try{await audioElement.setSinkId(deviceId)}catch(e){$("call-status").textContent="Не удалось выбрать устройство вывода: "+e.message}
}
function toggleRemoteAudio(){
  if(!audioElement){
    $("call-status").textContent="Ожидаем аудиопоток собеседника…";
    return;
  }
  if(audioElement.paused){
    audioElement.muted=false;
    audioElement.play().then(()=>{$("call-status").textContent="Звук собеседника включён."})
      .catch(error=>{$("call-status").textContent="Браузер не разрешил воспроизведение: "+(error.message||"нажми ещё раз")});
    return;
  }
  audioElement.muted=!audioElement.muted;
  $("call-status").textContent=audioElement.muted?"Звук собеседника выключен.":"Звук собеседника включён.";
  const b=[...$("call-actions").querySelectorAll("button")].find(x=>x.dataset.action==="output");
  if(b){b.setAttribute("aria-pressed",String(audioElement.muted));b.setAttribute("aria-label",audioElement.muted?"Включить звук":"Выключить звук")}
}
async function toggleMicrophone(){
  const track=activeCall?.stream?.getAudioTracks()[0];if(!track)return;
  track.enabled=!track.enabled;$("call-status").textContent=track.enabled?"Микрофон включён.":"Микрофон выключен.";
  const b=[...$("call-actions").querySelectorAll("button")].find(x=>x.dataset.action==="mute");if(b){b.setAttribute("aria-pressed",String(!track.enabled));b.setAttribute("aria-label",track.enabled?"Выключить микрофон":"Включить микрофон")}
}
async function negotiateScreenShare(){
  const call=activeCall;if(!call?.peer)return;
  const offer=await call.peer.createOffer();await call.peer.setLocalDescription(offer);
  const nonce=Date.now();call.pendingRenegotiation=nonce;
  await updateDoc(call.ref,{renegotiateOffer:{type:offer.type,sdp:offer.sdp,from:signedInUser.uid,nonce}});
}
async function startScreenShare(){
  if(!activeCall?.peer)return;
  try{
    screenStream=await navigator.mediaDevices.getDisplayMedia({video:{width:{ideal:854},height:{ideal:480},frameRate:{ideal:30,min:15}},audio:false});
    const track=screenStream.getVideoTracks()[0],sender=activeCall.peer.getSenders().find(s=>s.track?.kind==="video");
    if(sender)await sender.replaceTrack(track);else activeCall.peer.addTrack(track,screenStream);
    track.onended=async()=>{try{const v=activeCall?.peer?.getSenders().find(s=>s.track?.kind==="video");if(v)await v.replaceTrack(null);screenStream=null;await negotiateScreenShare()}catch(e){console.warn(e)}};
    await negotiateScreenShare();$("call-status").textContent="Демонстрация экрана включена (цель: 480p / 30 FPS).";
  }catch(e){$("call-status").textContent="Не удалось начать демонстрацию: "+e.message}
}
if(micSelect)micSelect.onchange=()=>changeMicrophone(micSelect.value);
if(outputSelect)outputSelect.onchange=()=>changeAudioOutput(outputSelect.value);
if(navigator.mediaDevices?.addEventListener)navigator.mediaDevices.addEventListener("devicechange",refreshCallDevices);

let ringAudioContext=null,ringOscillators=[],ringGain=null,ringTimer=null;
function stopRingbackTone(){
  if(ringTimer){clearInterval(ringTimer);ringTimer=null}
  if(ringGain&&ringAudioContext){
    try{ringGain.gain.cancelScheduledValues(ringAudioContext.currentTime);ringGain.gain.setTargetAtTime(0,ringAudioContext.currentTime,.04)}catch{}
  }
  if(ringOscillators.length)ringOscillators.forEach(oscillator=>{try{oscillator.stop()}catch{}});
  ringOscillators=[];ringGain=null;
  if(ringAudioContext){const context=ringAudioContext;ringAudioContext=null;context.close().catch(()=>{})}
}
function startRingbackTone(incoming=false){
  stopRingbackTone();
  try{
    const AudioContextClass=window.AudioContext||window.webkitAudioContext;
    if(!AudioContextClass)return;
    ringAudioContext=new AudioContextClass();
    ringGain=ringAudioContext.createGain();ringGain.gain.value=0;ringGain.connect(ringAudioContext.destination);
    const frequencies=incoming?[660,880]:[440,480];
    frequencies.forEach(frequency=>{
      const oscillator=ringAudioContext.createOscillator();oscillator.type="sine";oscillator.frequency.value=frequency;oscillator.connect(ringGain);oscillator.start();ringOscillators.push(oscillator);
    });
    const pulse=()=>{
      if(!ringAudioContext||!ringGain)return;
      const now=ringAudioContext.currentTime,duration=incoming?0.75:1.65;
      ringGain.gain.cancelScheduledValues(now);ringGain.gain.setValueAtTime(0,now);
      ringGain.gain.linearRampToValueAtTime(.035,now+.06);
      ringGain.gain.setValueAtTime(.035,now+duration-.08);
      ringGain.gain.linearRampToValueAtTime(0,now+duration);
    };
    ringAudioContext.resume().catch(()=>{});
    pulse();ringTimer=setInterval(pulse,incoming?3200:6000);
  }catch(error){console.warn("FROSS call tone unavailable:",error?.message||error)}
}

function callIcon(action){
  const label=String(action.label||"").toLowerCase();
  if(label.includes("ответить"))return '<svg class="call-action-icon" viewBox="0 0 24 24"><path d="M4 5c0 8.3 6.7 15 15 15h1a1 1 0 0 0 1-1v-3.5a1 1 0 0 0-.8-1l-4-.8a1 1 0 0 0-1 .4l-1.7 2.1a13 13 0 0 1-5.7-5.7L9.9 8.8a1 1 0 0 0 .4-1l-.8-4a1 1 0 0 0-1-.8H5a1 1 0 0 0-1 1z"/></svg>';
  if(label.includes("отклонить")||label.includes("завершить")||label.includes("закрыть"))return '<svg class="call-action-icon" viewBox="0 0 24 24"><path d="M3 14c4.8-4.2 13.2-4.2 18 0l-2.2 3.2a1.5 1.5 0 0 1-1.8.5l-2.5-1.1a1.5 1.5 0 0 1-.9-1.4v-1.1a17 17 0 0 0-3.2 0v1.1a1.5 1.5 0 0 1-.9 1.4L7 17.7a1.5 1.5 0 0 1-1.8-.5z"/></svg>';
  if(label.includes("микрофон"))return '<svg class="call-action-icon" viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4m-4 0h8"/></svg>';
  if(label.includes("звук"))return '<svg class="call-action-icon" viewBox="0 0 24 24"><path d="M3 9v6h4l5 4V5L7 9z"/><path d="M16 9a5 5 0 0 1 0 6m2-9a9 9 0 0 1 0 12"/></svg>';
  if(label.includes("экран"))return '<svg class="call-action-icon" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4m-5-9 3-3 2 2 4-4"/></svg>';
  return '<svg class="call-action-icon" viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 6.2A10.8 10.8 0 0 1 21 12a11 11 0 0 1-2.4 3.3M6.2 6.2A11 11 0 0 0 3 12a11 11 0 0 0 18 0M9 9a4 4 0 0 0 6 6"/></svg>';
}
function showCall(title, status, avatarText, actions, profile, callInfo) {
  $("call-title").textContent=title;
  $("call-status").textContent=status||"";
  const codeElement=$("call-code");
  if(codeElement){if(callInfo?.id&&callInfo?.code){codeElement.hidden=false;codeElement.textContent="ID "+callInfo.id+" · КОД "+callInfo.code}else codeElement.hidden=true}
  const avatarElement=$("call-avatar");
  if(profile&&window.FROSS?.renderAvatar)window.FROSS.renderAvatar(avatarElement,profile);
  else{avatarElement.style.backgroundImage="none";avatarElement.style.background="#6f3296";avatarElement.textContent=avatarText||"☎"}
  $("call-actions").replaceChildren();
  const callControls=[];
  if(activeCall?.peer){
    callControls.push({label:"Выключить звук",onClick:toggleRemoteAudio});
    callControls.push({label:"Выключить микрофон",onClick:toggleMicrophone});
    callControls.push({label:"Камера недоступна",disabled:true,video:true});
  }
  const visibleActions=activeCall?.peer?[...callControls,...(actions||[])]:[...(actions||[])];
  for(const action of visibleActions){
    const button=document.createElement("button");
    const label=String(action.label||"Действие");
    button.type="button";button.className=action.danger?"dg":action.primary?"pr":"";
    button.dataset.action=action.video?"video":label.includes("микрофон")?"mute":label.includes("звук")?"output":label.includes("экран")?"screen":label.includes("Ответить")?"answer":label.includes("Отклонить")||label.includes("Завершить")?"hangup":"other";
    button.disabled=!!action.disabled;
    button.setAttribute("aria-label",label);button.title=label;
    button.setAttribute("aria-pressed",String(label==="Выключить микрофон"||label==="Выключить звук"));
    button.innerHTML=callIcon(action)+'<span class="call-action-label"></span>';
    button.querySelector(".call-action-label").textContent=label;
    if(action.onClick)button.onclick=action.onClick;
    $("call-actions").append(button);
  }
  $("call-layer").classList.add("open");
  refreshCallDevices();
}
function hideCall() {
  stopRingbackTone();
  $("call-layer")?.classList.remove("open");
}
function stopMedia() {
  stopRingbackTone();
  if (activeCall?.docStop) activeCall.docStop();
  if (activeCall?.candidateStop) activeCall.candidateStop();
  if (activeCall?.peer) {
    activeCall.peer.onicecandidate = null;
    activeCall.peer.ontrack = null;
    activeCall.peer.close();
  }
  if (activeCall?.stream) activeCall.stream.getTracks().forEach(track => track.stop());
  if(screenStream){screenStream.getTracks().forEach(track=>track.stop());screenStream=null}
  if(remoteScreen){remoteScreen.pause();remoteScreen.srcObject=null;remoteScreen.style.display="none"}
  if (audioElement) {
    audioElement.pause();
    audioElement.srcObject = null;
    audioElement.remove();
    audioElement = null;
  }
  activeCall = null;
  hideCall();
}
async function finishCall(status = "ended") {
  const call = activeCall;
  if (!call) return;
  try {
    await updateDoc(call.ref,{status,endedAt:serverTimestamp(),updatedAt:serverTimestamp()});
  } catch (e) {
    console.warn("Could not update call state:", e);
  }
  stopMedia();
}
function attachAudio(peer) {
  peer.ontrack=event=>{
    if(event.track.kind==="video"){
      if(remoteScreen){
        const stream=event.streams?.[0]||new MediaStream([event.track]);
        remoteScreen.srcObject=stream;remoteScreen.style.display="block";
        remoteScreen.play().catch(()=>{$("call-status").textContent="Нажмите на экран, чтобы разрешить воспроизведение."});
      }
      return;
    }
    const stream=event.streams?.[0]||new MediaStream([event.track]);
    if(!audioElement){
      audioElement=document.createElement("audio");
      audioElement.autoplay=true;audioElement.playsInline=true;audioElement.muted=false;audioElement.volume=1;
      audioElement.setAttribute("autoplay","");audioElement.setAttribute("playsinline","");
      audioElement.setAttribute("aria-label","Голос собеседника");audioElement.style.display="none";
      document.body.append(audioElement);
    }
    audioElement.muted=false;audioElement.volume=1;audioElement.srcObject=stream;
    if(outputSelect?.value)changeAudioOutput(outputSelect.value);
    if(remoteScreen)remoteScreen.style.display="none";
    const playRemote=()=>{
      if(!audioElement||audioElement.srcObject!==stream)return;
      audioElement.play().then(()=>{
        if(activeCall&&$("call-status")?.textContent.includes("Ожидаем аудио"))$("call-status").textContent="Аудиосвязь подключена.";
      }).catch(error=>{
        console.warn("FROSS remote audio autoplay blocked:",error?.message||error);
        $("call-status").textContent="Браузер заблокировал звук. Нажмите «Включить звук».";
      });
    };
    event.track.enabled=true;event.track.onunmute=playRemote;
    event.track.onmute=()=>{if(activeCall)$("call-status").textContent="Аудиопоток временно приостановлен…"};
    playRemote();
  };
}
async function addRemoteCandidate(call,candidate){
  if(!call?.peer||!candidate)return;
  if(!call.peer.remoteDescription){
    call.pendingRemoteCandidates ||= [];
    call.pendingRemoteCandidates.push(candidate);
    return;
  }
  try{
    await call.peer.addIceCandidate(new RTCIceCandidate(candidate));
  }catch(error){
    console.warn("ICE candidate rejected:",error?.message||error);
    if(error?.name==="InvalidStateError"){
      call.pendingRemoteCandidates ||= [];
      call.pendingRemoteCandidates.push(candidate);
    }
  }
}
async function flushRemoteCandidates(call){
  if(!call?.peer?.remoteDescription||!call.pendingRemoteCandidates?.length)return;
  const pending=call.pendingRemoteCandidates.splice(0);
  for(const candidate of pending){
    try{await call.peer.addIceCandidate(new RTCIceCandidate(candidate))}
    catch(error){console.warn("Queued ICE candidate rejected:",error?.message||error)}
  }
}
function watchRemoteCandidates(callId, remoteSet) {
  const call=activeCall;
  if(!call||call.id!==callId)return;
  call.pendingRemoteCandidates ||= [];
  call.candidateStop=onSnapshot(collection(db,"calls",callId,remoteSet),snapshot=>{
    snapshot.docChanges().forEach(change=>{
      if(change.type!=="added")return;
      const candidate=change.doc.data()?.candidate;
      if(candidate)addRemoteCandidate(call,candidate);
    });
  },error=>{
    if(activeCall?.id===callId)$("call-status").textContent="Ошибка ICE-сигнализации: "+error.message;
    console.warn("FROSS candidate listener failed:",error);
  });
}
function watchCallDocument(callId) {
  const call = activeCall;
  call.docStop = onSnapshot(doc(db,"calls",callId),async snapshot => {
    if (!snapshot.exists() || !activeCall) return;
    const data = snapshot.data();
    if(data.renegotiateOffer&&data.renegotiateOffer.from!==signedInUser.uid&&data.renegotiateOffer.nonce!==renegotiationSeen){
      renegotiationSeen=data.renegotiateOffer.nonce;
      try{
        await call.peer.setRemoteDescription(new RTCSessionDescription(data.renegotiateOffer));
        const answer=await call.peer.createAnswer();await call.peer.setLocalDescription(answer);
        await updateDoc(call.ref,{renegotiateAnswer:{type:answer.type,sdp:answer.sdp,from:signedInUser.uid,nonce:data.renegotiateOffer.nonce}});
      }catch(e){$("call-status").textContent="Не удалось согласовать демонстрацию экрана: "+e.message}
    }
    if(data.renegotiateAnswer&&data.renegotiateAnswer.from!==signedInUser.uid&&call.pendingRenegotiation===data.renegotiateAnswer.nonce){
      try{await call.peer.setRemoteDescription(new RTCSessionDescription(data.renegotiateAnswer));call.pendingRenegotiation=null}catch(e){console.warn("Renegotiation answer:",e)}
    }
    if (data.status === "declined") {
      stopRingbackTone();
      $("call-status").textContent = "Собеседник отклонил звонок.";
      setTimeout(() => { if (activeCall?.id === callId) stopMedia(); },1200);
      return;
    }
    if (data.status === "ended") {
      stopRingbackTone();
      $("call-status").textContent = "Звонок завершён.";
      setTimeout(() => { if (activeCall?.id === callId) stopMedia(); },700);
      return;
    }
    if (call.role === "caller" && data.answer && !call.peer.currentRemoteDescription) {
      stopRingbackTone();
      try {
        await call.peer.setRemoteDescription(new RTCSessionDescription(data.answer));
        await flushRemoteCandidates(call);
        $("call-status").textContent = "Соединение установлено. Говорите!";
      } catch (e) {
        $("call-status").textContent = "Не удалось принять ответ: " + e.message;
      }
    }
    if (data.status === "accepted") {stopRingbackTone();$("call-status").textContent = "Соединение устанавливается…";}
  },error => {
    $("call-status").textContent = "Связь с сервером потеряна: " + error.message;
  });
}
async function getMicrophone() {
  if (!window.isSecureContext) {
    throw new Error("Для звонка откройте FROSS по защищённому адресу HTTPS.");
  }
  const mediaDevices=navigator.mediaDevices;
  if (!mediaDevices?.getUserMedia) {
    throw new Error("Этот браузер не предоставляет доступ к микрофону. Обновите Chrome и откройте FROSS непосредственно в браузере.");
  }
  try {
    return await mediaDevices.getUserMedia({
      audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},
      video:false
    });
  } catch (error) {
    // Some Android devices or Chrome builds reject optional audio constraints.
    if (["OverconstrainedError","ConstraintNotSatisfiedError","NotFoundError"].includes(error?.name)) {
      try { return await mediaDevices.getUserMedia({audio:true,video:false}); }
      catch (fallbackError) { throw fallbackError; }
    }
    throw error;
  }
}
async function createPeer(callId, role, stream) {
  const peer = new RTCPeerConnection({iceServers:await loadIceServers()});
  const localSet = role === "caller" ? "callerCandidates" : "calleeCandidates";
  peer.onicecandidate = async event => {
    if (!event.candidate || !activeCall || activeCall.id !== callId) return;
    try {
      await addDoc(collection(db,"calls",callId,localSet),{
        uid:signedInUser.uid,
        candidate:event.candidate.toJSON(),
        createdAt:serverTimestamp()
      });
    } catch (e) {
      console.warn("Could not send ICE candidate:",e);
    }
  };
  peer.oniceconnectionstatechange=()=>{
    if(!activeCall||activeCall.id!==callId)return;
    if(peer.iceConnectionState==="checking")$("call-status").textContent="Проверяем аудиосоединение…";
    else if(peer.iceConnectionState==="connected")$("call-status").textContent="Аудиосоединение установлено.";
    else if(peer.iceConnectionState==="failed")$("call-status").textContent="Не удалось установить аудиосвязь. Для этой сети может потребоваться TURN.";
    else if(peer.iceConnectionState==="disconnected")$("call-status").textContent="Сеть прервала аудиосвязь. Пробуем восстановить…";
  };
  peer.onconnectionstatechange = () => {
    if (!activeCall || activeCall.id !== callId) return;
    if (peer.connectionState === "connected") {
      $("call-status").textContent = "Соединение установлено. Говорите!";
    } else if (peer.connectionState === "failed") {
      $("call-status").textContent = "Сеть не пропускает прямое соединение. Для таких сетей нужен TURN-сервер.";
      try { peer.restartIce(); } catch {}
    } else if (peer.connectionState === "disconnected") {
      $("call-status").textContent = "Связь прервалась. Пытаемся восстановить…";
    }
  };
  for (const track of stream.getTracks()) peer.addTrack(track,stream);
  attachAudio(peer);
  return peer;
}
async function generateCallIdentity(){
  for(let attempt=0;attempt<12;attempt++){
    const random=new Uint32Array(2);crypto.getRandomValues(random);
    const callId=String(100000000+(random[0]%900000000));
    const reference=doc(db,"calls",callId);
    if(!(await getDoc(reference)).exists()){
      return {callId,callCode:String(random[1]%10000).padStart(4,"0"),reference};
    }
  }
  throw new Error("Не удалось создать уникальный ID звонка. Попробуй ещё раз.");
}
function friendlyCallError(error){
  const code=error?.code||"",name=error?.name||"";
  if(code==="permission-denied")return "Firebase запретил доступ к звонку. Проверь публикацию новых правил Firestore.";
  if(code==="unavailable")return "Firebase временно недоступен. Проверь интернет и повтори звонок.";
  if(code==="unauthenticated")return "Сессия закончилась. Войди в FROSS заново.";
  if(name==="NotAllowedError"||name==="SecurityError")return "Chrome не разрешил доступ к микрофону. Разреши микрофон для сайта FROSS в настройках Chrome и проверь, что доступ к микрофону включён в Android.";
  if(name==="NotFoundError")return "Chrome не обнаружил микрофон. Проверь, что микрофон подключён и доступен системе.";
  if(name==="NotReadableError"||name==="AbortError")return "Микрофон занят другим приложением или не отвечает. Закрой другие приложения, использующие микрофон, и попробуй снова.";
  if(name==="OverconstrainedError"||name==="ConstraintNotSatisfiedError")return "Chrome не поддерживает выбранные параметры микрофона. Попробуй другое устройство ввода.";
  if(name==="TypeError")return "Не удалось получить доступ к микрофону. Открой FROSS в актуальном Chrome по HTTPS.";
  return error?.message||"Не удалось выполнить действие со звонком.";
}
function callDisplayName(profile){
  // Calls identify accounts by their unique username, never by the editable display nickname.
  const username=String(profile?.username||profile?.usernameLower||profile?.handle||"").trim().replace(/^@/,"");
  return username ? "@"+username : "Собеседник";
}
async function startOutgoingCall() {
  if (activeCall) {
    $("call-status").textContent = "Сначала завершите текущий звонок.";
    return;
  }
  const profile = window.FROSS?.profile;
  const chatId = window.FROSS?.chatId;
  if (!profile || !chatId || chatId === "general") return;
  try {
    const chatSnap = await getDoc(doc(db,"chats",chatId));
    if (!chatSnap.exists()) throw new Error("Чат не найден.");
    const chat = chatSnap.data();
    const calleeUid = (chat.memberUids || []).find(uid => uid !== profile.uid);
    if (!calleeUid) throw new Error("Не удалось определить собеседника.");
    let peerProfile = (chat.memberProfiles || []).find(item => item.uid === calleeUid) || {};
    try {
      const latestProfile=await getDoc(doc(db,"publicUsers",calleeUid));
      if(latestProfile.exists())peerProfile={...peerProfile,...latestProfile.data()};
    } catch(error) { console.warn("Could not refresh call profile:",error); }
    peerProfile.uid=calleeUid;
    const peerLabel=callDisplayName(peerProfile);
    showCall(peerLabel,"Запрашиваем микрофон…",peerLabel[0]||"☎", [
      {label:"Отменить",danger:true,onClick:()=>finishCall("ended")}
    ],peerProfile);
    const stream = await getMicrophone();
    const {callId,callCode,reference:callRef}=await generateCallIdentity();
    const participantUids=[profile.uid,calleeUid];
    await setDoc(callRef,{
      chatId,callId,callCode,callerUid:profile.uid,calleeUid,participantUids,
      status:"preparing",createdAt:serverTimestamp()
    });
    const peer = await createPeer(callId,"caller",stream);
    activeCall = {id:callId,callCode,ref:callRef,role:"caller",peer,stream,peerProfile,pendingRemoteCandidates:[]};
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await updateDoc(callRef,{
      offer:{type:offer.type,sdp:offer.sdp},
      status:"ringing",updatedAt:serverTimestamp()
    });
    showCall(callDisplayName(peerProfile),"Вызов… идут гудки",callDisplayName(peerProfile)[0]||"☎",[
      {label:"Завершить",danger:true,onClick:()=>finishCall("ended")}
    ],peerProfile,{id:callId,code:callCode});
    startRingbackTone(false);
    watchCallDocument(callId);
    watchRemoteCandidates(callId,"calleeCandidates");
  } catch (e) {
    console.error("Call start failed:",e);
    if (activeCall) stopMedia();
    $("call-status").textContent = friendlyCallError(e);
    showCall("Не удалось позвонить",e.message||"Проверьте микрофон и настройки Firebase.","!",[
      {label:"Закрыть",onClick:hideCall}
    ]);
  }
}
async function showIncomingCall(snapshot) {
  if (activeCall) return;
  const data = snapshot.data(), callId = snapshot.id;
  if (seenIncoming.has(callId)) return;
  seenIncoming.add(callId);
  let caller = {};
  try {
    const profile = await getDoc(doc(db,"publicUsers",data.callerUid));
    if (profile.exists()) caller = profile.data();
  } catch {}
  if (activeCall) return;
  caller.uid=data.callerUid;
  window.FROSS?.notifyIncomingCall?.(caller,callId);
  showCall(callDisplayName(caller),"Входящий звонок",callDisplayName(caller)[0]||"☎",[
    {label:"Отклонить",danger:true,onClick:async()=>{
      try { await updateDoc(doc(db,"calls",callId),{status:"declined",endedAt:serverTimestamp()}); } catch(e) { console.warn(e); }
      stopRingbackTone();hideCall();
    }},
    {label:"Ответить",primary:true,onClick:()=>{stopRingbackTone();acceptCall(callId,data,caller)}}
  ],caller,{id:data.callId||callId,code:data.callCode||""});
  startRingbackTone(true);
}
async function acceptCall(callId, data, caller) {
  if (activeCall) return;
  try {
    $("call-status").textContent = "Запрашиваем доступ к микрофону…";
    const stream = await getMicrophone();
    const callRef = doc(db,"calls",callId);
    const peer = await createPeer(callId,"callee",stream);
    activeCall = {id:callId,callCode:data.callCode||"",ref:callRef,role:"callee",peer,stream,peerProfile:caller,pendingRemoteCandidates:[]};
    await peer.setRemoteDescription(new RTCSessionDescription(data.offer));
    await flushRemoteCandidates(activeCall);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    await updateDoc(callRef,{
      answer:{type:answer.type,sdp:answer.sdp},
      status:"accepted",acceptedAt:serverTimestamp(),updatedAt:serverTimestamp()
    });
    showCall(callDisplayName(caller),"Соединяемся…",callDisplayName(caller)[0]||"☎",[
      {label:"Завершить",danger:true,onClick:()=>finishCall("ended")}
    ],caller,{id:data.callId||callId,code:data.callCode||""});
    stopRingbackTone();
    watchCallDocument(callId);
    watchRemoteCandidates(callId,"callerCandidates");
  } catch (e) {
    console.error("Could not answer call:",e);
    try { await updateDoc(doc(db,"calls",callId),{status:"declined",endedAt:serverTimestamp()}); } catch {}
    if (activeCall) stopMedia();
    showCall("Не удалось ответить",friendlyCallError(e),"!",[
      {label:"Закрыть",onClick:hideCall}
    ]);
  }
}
function listenForCalls(uid) {
  if (incomingStop) incomingStop();
  const callsQuery = query(collection(db,"calls"),where("calleeUid","==",uid),limit(10));
  incomingStop = onSnapshot(callsQuery,snapshot => {
    for (const change of snapshot.docChanges()) {
      const data = change.doc.data();
      if(data.status==="ringing"){
        const createdAt=data.createdAt?.toMillis?.()||0;
        if(!createdAt||Date.now()-createdAt>90*1000){
          updateDoc(doc(db,"calls",change.doc.id),{status:"ended",endedAt:serverTimestamp(),updatedAt:serverTimestamp()}).catch(()=>{});
          seenIncoming.delete(change.doc.id);
          continue;
        }
        showIncomingCall(change.doc);
      }else seenIncoming.delete(change.doc.id);
    }
  },error => console.error("Incoming call listener:",error));
}

const callButton = $("call");
if (callButton) callButton.addEventListener("click",startOutgoingCall);

onAuthStateChanged(auth,user => {
  signedInUser = user;
  if (incomingStop) {
    incomingStop();
    incomingStop = null;
  }
  if (!user) {
    if (activeCall) finishCall("ended");
    else stopMedia();
    seenIncoming.clear();
    return;
  }
  listenForCalls(user.uid);
});

window.addEventListener("beforeunload",() => {
  if (activeCall?.stream) activeCall.stream.getTracks().forEach(track => track.stop());
});
