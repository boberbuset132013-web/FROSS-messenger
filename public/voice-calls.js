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
const ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
];

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
async function toggleMicrophone(){
  const track=activeCall?.stream?.getAudioTracks()[0];if(!track)return;
  track.enabled=!track.enabled;$("call-status").textContent=track.enabled?"Микрофон включён.":"Микрофон выключен.";
  const b=[...$("call-actions").querySelectorAll("button")].find(x=>x.dataset.action==="mute");if(b)b.textContent=track.enabled?"Выключить микрофон":"Включить микрофон";
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

function showCall(title, status, avatarText, actions) {
  $("call-title").textContent = title;
  $("call-status").textContent = status || "";
  $("call-avatar").textContent = avatarText || "☎";
  $("call-actions").replaceChildren();
  const visibleActions=[...(actions||[])];
  if(activeCall?.peer){visibleActions.push({label:activeCall.stream?.getAudioTracks()[0]?.enabled===false?"Включить микрофон":"Выключить микрофон",onClick:toggleMicrophone});visibleActions.push({label:"Показать экран",onClick:startScreenShare});}
  for (const action of visibleActions) {
    const button = document.createElement("button");
    button.textContent = action.label;
    button.className = action.danger ? "dg" : action.primary ? "pr" : "";
    if(action.label.includes("микрофон"))button.dataset.action="mute";
    button.onclick = action.onClick;
    $("call-actions").append(button);
  }
  $("call-layer").classList.add("open");
  refreshCallDevices();
}
function hideCall() {
  $("call-layer")?.classList.remove("open");
}
function stopMedia() {
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
  peer.ontrack = event => {
    if(event.track.kind==="video"){if(remoteScreen){remoteScreen.srcObject=event.streams[0];remoteScreen.style.display="block";remoteScreen.play().catch(()=>{})}return}
    if (!audioElement) {
      audioElement = document.createElement("audio");
      audioElement.autoplay = true;
      audioElement.playsInline = true;
      audioElement.setAttribute("aria-label","Голос собеседника");
      audioElement.style.display = "none";
      document.body.append(audioElement);
    }
    audioElement.srcObject = event.streams[0];
    if(outputSelect?.value)changeAudioOutput(outputSelect.value);
    if(remoteScreen)remoteScreen.style.display="none";
    audioElement.play().catch(() => {
      $("call-status").textContent = "Разрешите воспроизведение звука в браузере.";
    });
  };
}
function watchRemoteCandidates(callId, remoteSet) {
  const call = activeCall;
  call.candidateStop = onSnapshot(collection(db,"calls",callId,remoteSet),snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type !== "added") return;
      const candidate = change.doc.data()?.candidate;
      if (!candidate || !activeCall?.peer) return;
      activeCall.peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(error => {
        console.warn("ICE candidate rejected:",error);
      });
    });
  },error => {
    $("call-status").textContent = "Ошибка соединения: " + error.message;
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
      $("call-status").textContent = "Собеседник отклонил звонок.";
      setTimeout(() => { if (activeCall?.id === callId) stopMedia(); },1200);
      return;
    }
    if (data.status === "ended") {
      $("call-status").textContent = "Звонок завершён.";
      setTimeout(() => { if (activeCall?.id === callId) stopMedia(); },700);
      return;
    }
    if (call.role === "caller" && data.answer && !call.peer.currentRemoteDescription) {
      try {
        await call.peer.setRemoteDescription(new RTCSessionDescription(data.answer));
        $("call-status").textContent = "Соединение установлено. Говорите!";
      } catch (e) {
        $("call-status").textContent = "Не удалось принять ответ: " + e.message;
      }
    }
    if (data.status === "accepted") $("call-status").textContent = "Соединение устанавливается…";
  },error => {
    $("call-status").textContent = "Связь с сервером потеряна: " + error.message;
  });
}
async function getMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Браузер не поддерживает доступ к микрофону. Откройте сайт по HTTPS.");
  }
  return navigator.mediaDevices.getUserMedia({audio:true,video:false});
}
function createPeer(callId, role, stream) {
  const peer = new RTCPeerConnection({iceServers:ICE_SERVERS});
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
    const peerProfile = (chat.memberProfiles || []).find(item => item.uid === calleeUid) || {};
    showCall("Звоним: "+(peerProfile.displayName||peerProfile.username||"пользователь"),"Запрашиваем микрофон…","☎",[
      {label:"Отменить",danger:true,onClick:()=>finishCall("ended")}
    ]);
    const stream = await getMicrophone();
    const callRef = doc(collection(db,"calls"));
    const callId = callRef.id;
    const participantUids = [profile.uid,calleeUid];
    await setDoc(callRef,{
      chatId,callerUid:profile.uid,calleeUid,participantUids,
      status:"preparing",createdAt:serverTimestamp()
    });
    const peer = createPeer(callId,"caller",stream);
    activeCall = {id:callId,ref:callRef,role:"caller",peer,stream,peerProfile};
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await updateDoc(callRef,{
      offer:{type:offer.type,sdp:offer.sdp},
      status:"ringing",updatedAt:serverTimestamp()
    });
    showCall("Звоним: "+(peerProfile.displayName||peerProfile.username||"пользователь"),"Ожидаем ответа…",String(peerProfile.displayName||peerProfile.username||"☎")[0],[
      {label:"Завершить",danger:true,onClick:()=>finishCall("ended")}
    ]);
    watchCallDocument(callId);
    watchRemoteCandidates(callId,"calleeCandidates");
  } catch (e) {
    console.error("Call start failed:",e);
    if (activeCall) stopMedia();
    $("call-status").textContent = e.message || "Не удалось начать звонок.";
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
  showCall("Входящий звонок",caller.displayName||caller.username||"Пользователь звонит…",String(caller.displayName||caller.username||"☎")[0],[
    {label:"Отклонить",danger:true,onClick:async()=>{
      try { await updateDoc(doc(db,"calls",callId),{status:"declined",endedAt:serverTimestamp()}); } catch(e) { console.warn(e); }
      hideCall();
    }},
    {label:"Ответить",primary:true,onClick:()=>acceptCall(callId,data,caller)}
  ]);
}
async function acceptCall(callId, data, caller) {
  if (activeCall) return;
  try {
    $("call-status").textContent = "Запрашиваем доступ к микрофону…";
    const stream = await getMicrophone();
    const callRef = doc(db,"calls",callId);
    const peer = createPeer(callId,"callee",stream);
    activeCall = {id:callId,ref:callRef,role:"callee",peer,stream,peerProfile:caller};
    await peer.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    await updateDoc(callRef,{
      answer:{type:answer.type,sdp:answer.sdp},
      status:"accepted",acceptedAt:serverTimestamp(),updatedAt:serverTimestamp()
    });
    showCall("Разговор с "+(caller.displayName||caller.username||"пользователем"),"Соединяемся…",String(caller.displayName||caller.username||"☎")[0],[
      {label:"Завершить",danger:true,onClick:()=>finishCall("ended")}
    ]);
    watchCallDocument(callId);
    watchRemoteCandidates(callId,"callerCandidates");
  } catch (e) {
    console.error("Could not answer call:",e);
    try { await updateDoc(doc(db,"calls",callId),{status:"declined",endedAt:serverTimestamp()}); } catch {}
    if (activeCall) stopMedia();
    showCall("Не удалось ответить",e.message||"Проверьте разрешение на микрофон.","!",[
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
      if (data.status === "ringing") showIncomingCall(change.doc);
      else seenIncoming.delete(change.doc.id);
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
