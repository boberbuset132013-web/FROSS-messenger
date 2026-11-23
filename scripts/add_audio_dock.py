from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "public/firebase-app.js"
HTML = ROOT / "public/index.html"
SW = ROOT / "public/sw.js"


def replace_function(source: str, name: str, replacement: str) -> str:
    pattern = re.compile(
        rf"^(?:async\s+)?function\s+{re.escape(name)}\s*\([^)]*\)\s*\{{.*?^\}}",
        re.M | re.S,
    )
    updated, count = pattern.subn(lambda _: replacement, source, count=1)
    if count != 1:
        raise SystemExit(f"Could not replace {name} in public/firebase-app.js")
    return updated


js = JS.read_text(encoding="utf-8")

# The shared audio element lives in the page shell, not inside a chat bubble.
audio_functions = r'''function updateGlobalAudioDock() {
  const audio=globalAudioPlayer||$('global-audio');
  if(!audio)return;
  const duration=Number.isFinite(audio.duration)?audio.duration:0;
  const current=Number.isFinite(audio.currentTime)?audio.currentTime:0;
  const seek=$('audio-dock-seek');
  if(seek){seek.value=duration?String(Math.round(current/duration*1000)):"0";seek.disabled=!duration}
  const time=$('audio-dock-time');if(time)time.textContent=mediaTime(current)+" / "+mediaTime(duration);
  const toggle=$('audio-dock-toggle');
  if(toggle){toggle.textContent=audio.paused?"▶":"Ⅱ";toggle.setAttribute("aria-label",audio.paused?"Продолжить":"Пауза")}
  const speed=$('audio-dock-speed');if(speed)speed.textContent=String(globalAudioSpeed).replace(/\.0$/,'')+"×";
  const status=$('audio-dock-status');
  if(status){
    if(audio.error)status.textContent="Не удалось загрузить аудио";
    else if(audio.ended)status.textContent="Воспроизведение завершено";
    else if(audio.paused)status.textContent=globalAudioTrackKey?"На паузе":"Выберите аудио в сообщении";
    else status.textContent="Сейчас воспроизводится · можно перейти в другой чат";
  }
  document.querySelectorAll('.audio-play-button').forEach(button=>{
    const active=button.dataset.audioKey===globalAudioTrackKey;
    button.textContent=active&&!audio.paused?"Ⅱ Пауза":"▶ Слушать";
    const hint=button.closest('.message-audio-player')?.querySelector('.audio-player-hint');
    if(hint)hint.textContent=active?(audio.paused?"На паузе · управление сверху":"Сейчас воспроизводится · управление сверху"):"Управление появится в верхнем плеере";
  });
}

function closeGlobalAudioDock() {
  const audio=globalAudioPlayer||$('global-audio');
  globalAudioRequest++;
  if(audio){audio.pause();audio.removeAttribute('src');audio.load()}
  globalAudioTrackKey="";globalAudioAttachment=null;globalAudioRetryUsed=false;
  const dock=$('audio-dock');if(dock)dock.hidden=true;
  document.body.classList.remove('audio-dock-on');
  updateGlobalAudioDock();
}

function initGlobalAudioDock() {
  globalAudioPlayer=$('global-audio');
  if(!globalAudioPlayer)return;
  const audio=globalAudioPlayer;
  audio.addEventListener('loadedmetadata',updateGlobalAudioDock);
  audio.addEventListener('durationchange',updateGlobalAudioDock);
  audio.addEventListener('timeupdate',updateGlobalAudioDock);
  audio.addEventListener('play',updateGlobalAudioDock);
  audio.addEventListener('pause',updateGlobalAudioDock);
  audio.addEventListener('ended',()=>{audio.currentTime=0;updateGlobalAudioDock()});
  audio.addEventListener('error',async()=>{
    updateGlobalAudioDock();
    const attachment=globalAudioAttachment,request=globalAudioRequest;
    if(globalAudioRetryUsed||!attachment?.url?.startsWith('filebase:'))return;
    globalAudioRetryUsed=true;
    try{
      const user=auth.currentUser||currentUser;
      const key=String(attachment.path||attachment.url.slice(9));
      if(user)privateFileUrlCache.delete(user.uid+":"+key);
      const refreshed=await resolveStoredFileUrl(attachment.url,attachment.path);
      if(request!==globalAudioRequest)return;
      audio.src=refreshed;audio.load();await audio.play();
    }catch(error){
      const status=$('audio-dock-status');if(status)status.textContent=error?.message||"Не удалось открыть аудиофайл";
      updateGlobalAudioDock();
    }
  });
  $('audio-dock-toggle').onclick=async()=>{
    if(!globalAudioTrackKey)return;
    try{if(audio.paused)await audio.play();else audio.pause()}
    catch(error){notify(error?.message||"Не удалось запустить аудио")}
  };
  $('audio-dock-speed').onclick=()=>{
    const i=GLOBAL_AUDIO_SPEEDS.indexOf(globalAudioSpeed);
    globalAudioSpeed=GLOBAL_AUDIO_SPEEDS[(i+1)%GLOBAL_AUDIO_SPEEDS.length];
    audio.playbackRate=globalAudioSpeed;updateGlobalAudioDock();
  };
  $('audio-dock-close').onclick=closeGlobalAudioDock;
  $('audio-dock-seek').addEventListener('input',event=>{
    if(Number.isFinite(audio.duration)&&audio.duration>0){audio.currentTime=Number(event.target.value)/1000*audio.duration;updateGlobalAudioDock()}
  });
  updateGlobalAudioDock();
}

async function startGlobalAudio(attachment) {
  const audio=globalAudioPlayer||$('global-audio');
  if(!audio)throw new Error("Аудиоплеер пока не готов. Обнови страницу.");
  const key=String(attachment.path||attachment.url||attachment.name||"audio");
  const dock=$('audio-dock');if(dock)dock.hidden=false;
  document.body.classList.add('audio-dock-on');
  globalAudioAttachment=attachment;
  const title=$('audio-dock-title');if(title)title.textContent=attachment.name||"Аудиофайл";
  const status=$('audio-dock-status');if(status)status.textContent="Подключаем аудио…";
  if(key!==globalAudioTrackKey){
    globalAudioRequest++;globalAudioTrackKey=key;globalAudioRetryUsed=false;
    audio.pause();audio.removeAttribute('src');audio.load();audio.playbackRate=globalAudioSpeed;
  }
  if(!audio.getAttribute('src')){
    const request=globalAudioRequest;
    const source=await resolveStoredFileUrl(attachment.url,attachment.path);
    if(request!==globalAudioRequest)return;
    audio.src=source;audio.load();
  }
  audio.playbackRate=globalAudioSpeed;
  await audio.play();
  updateGlobalAudioDock();
}

function createAudioMessagePlayer(attachment) {
  const key=String(attachment.path||attachment.url||attachment.name||"audio");
  const player=document.createElement('div');player.className='message-audio-player';
  const top=document.createElement('div');top.className='audio-player-top';
  const button=document.createElement('button');button.type='button';button.className='audio-play-button';button.dataset.audioKey=key;button.textContent='▶ Слушать';
  const meta=document.createElement('div');meta.className='audio-player-meta';
  const name=document.createElement('div');name.className='audio-player-name';name.textContent=attachment.name||'Аудиофайл';
  const hint=document.createElement('div');hint.className='audio-player-hint';hint.textContent='Управление появится в верхнем плеере';
  meta.append(name,hint);top.append(button,meta);player.append(top);
  button.addEventListener('click',async()=>{
    const audio=globalAudioPlayer||$('global-audio');
    if(globalAudioTrackKey===key&&audio&&!audio.paused){audio.pause();return}
    button.disabled=true;
    try{await startGlobalAudio(attachment)}
    catch(error){notify(error?.message||'Не удалось открыть аудио')}
    finally{button.disabled=false;updateGlobalAudioDock()}
  });
  if(globalAudioTrackKey===key)updateGlobalAudioDock();
  return player;
}

initGlobalAudioDock();'''

# Keep the script safe to rerun.
if "function updateGlobalAudioDock()" not in js:
    js = replace_function(js, "createAudioMessagePlayer", audio_functions)
if "let globalAudioTrackKey=" not in js:
    state_anchor = 'let currentUser=null, me=null, S={...DEF}, cur="general", chats=[], found=[];'
    state = '\nlet globalAudioTrackKey="", globalAudioRequest=0, globalAudioAttachment=null, globalAudioRetryUsed=false;\nlet globalAudioPlayer=null, globalAudioSpeed=1;\nconst GLOBAL_AUDIO_SPEEDS=[1,1.25,1.5,2];'
    if state_anchor not in js:
        raise SystemExit("Could not find app state declaration for audio dock")
    js = js.replace(state_anchor, state_anchor + state, 1)
JS.write_text(js, encoding="utf-8")

html = HTML.read_text(encoding="utf-8")
dock = '''<div id="audio-dock" class="audio-dock" hidden role="region" aria-label="Аудиоплеер">
  <div class="audio-dock-info"><b id="audio-dock-title">Аудиофайл</b><small id="audio-dock-status">Выберите аудио в сообщении</small></div>
  <div class="audio-dock-controls"><button id="audio-dock-toggle" type="button" aria-label="Продолжить">▶</button><button id="audio-dock-speed" type="button" aria-label="Скорость воспроизведения">1×</button><button id="audio-dock-close" type="button" aria-label="Закрыть плеер">×</button></div>
  <input id="audio-dock-seek" class="audio-dock-seek" type="range" min="0" max="1000" value="0" step="1" aria-label="Перемотка аудио" disabled>
  <span id="audio-dock-time" class="audio-dock-time">0:00 / 0:00</span>
  <audio id="global-audio" preload="metadata"></audio>
</div>
'''
if 'id="audio-dock"' not in html:
    marker = '<section id="auth">'
    if marker not in html:
        raise SystemExit("Could not find the page shell insertion point")
    html = html.replace(marker, dock + marker, 1)

css = '''
/* The global audio dock stays mounted when the active chat changes. */
.audio-dock{position:fixed;z-index:500;inset:0 0 auto;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto auto;align-items:center;column-gap:12px;row-gap:3px;min-height:72px;padding:8px 14px;background:color-mix(in srgb,var(--panel) 96%,#7650b5 4%);border-bottom:1px solid var(--line);box-shadow:0 8px 26px #0005;backdrop-filter:blur(18px)}
.audio-dock[hidden]{display:none!important}
.audio-dock-info{min-width:0;display:flex;flex-direction:column;gap:2px}
.audio-dock-info b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
.audio-dock-info small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:11px}
.audio-dock-controls{grid-column:2;grid-row:1;display:flex;align-items:center;gap:6px}
.audio-dock-controls button{min-width:38px;height:34px;padding:0 9px;border:1px solid var(--line);border-radius:10px;background:var(--p2);color:var(--text);font-size:13px;font-weight:800}
#audio-dock-toggle{background:var(--accent);border-color:var(--accent);color:white}
.audio-dock-seek{grid-column:1;grid-row:2;width:100%;min-width:0;margin:0;accent-color:var(--accent)}
.audio-dock-time{grid-column:2;grid-row:2;min-width:88px;text-align:right;color:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}
#global-audio{display:none}
body.audio-dock-on #app{padding-top:calc(72px + env(safe-area-inset-top))}
@media(max-width:700px){.audio-dock{min-height:76px;padding:calc(7px + env(safe-area-inset-top)) 10px 7px;column-gap:8px}.audio-dock-controls{gap:4px}.audio-dock-controls button{min-width:34px;height:32px;padding:0 7px}.audio-dock-time{min-width:78px;font-size:10px}body.audio-dock-on #app{padding-top:calc(76px + env(safe-area-inset-top))}}
'''
if ".audio-dock{" not in html:
    html = html.replace("</style>", css + "</style>", 1)

if 'name="fross-shell-version"' in html:
    html = re.sub(r'(<meta\s+name="fross-shell-version"\s+content=")[^"]*(")', r'\g<1>8\2', html, count=1)
else:
    html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta name="fross-shell-version" content="8">', 1)
HTML.write_text(html, encoding="utf-8")

sw = SW.read_text(encoding="utf-8")
if 'const CACHE="fross-shell-v7";' in sw:
    sw = sw.replace('const CACHE="fross-shell-v7";', 'const CACHE="fross-shell-v8";', 1)
elif 'const CACHE="fross-shell-v8";' not in sw or 'const appCode=' not in sw:
    raise SystemExit("Expected the v7/v8 network-first service worker was not found")
SW.write_text(sw, encoding="utf-8")

required = {
    "shared audio element is outside chat DOM": 'id="global-audio"' in html,
    "dock stays visible while app chats change": "body.audio-dock-on #app" in html,
    "audio speed and seek controls exist": all(x in html for x in ['id="audio-dock-speed"', 'id="audio-dock-seek"']),
    "audio playback uses shared engine": "function startGlobalAudio(attachment)" in js and "const audio=globalAudioPlayer||$('global-audio')" in js,
    "old per-message audio engine removed": "audio.className='message-audio-engine'" not in js,
    "service worker cache bumped": 'fross-shell-v8' in sw,
}
for label, ok in required.items():
    print(("PASS" if ok else "FAIL") + "  " + label)
if not all(required.values()):
    raise SystemExit("Global audio dock feature check failed")