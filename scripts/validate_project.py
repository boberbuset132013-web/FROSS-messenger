from pathlib import Path

root = Path(__file__).resolve().parents[1]
html = (root / "public/index.html").read_text(encoding="utf-8")
js = (root / "public/firebase-app.js").read_text(encoding="utf-8")
worker = (root / "worker.js").read_text(encoding="utf-8")
rules = (root / "firestore.rules").read_text(encoding="utf-8")
storage = (root / "storage.rules").read_text(encoding="utf-8")
checks = {
    "global audio dock survives chat switching": 'id="audio-dock"' in html and 'id="global-audio"' in html and "function startGlobalAudio(attachment)" in js,
    "global audio controls provide pause, speed and seek": all(x in js for x in ["audio-dock-toggle", "audio-dock-speed", "audio-dock-seek", "closeGlobalAudioDock"]),
    "audio playback is independent from message DOM": "message-audio-engine" not in js,
    "responsive viewport": 'name="viewport"' in html,
    "in-chat photo viewer and download action": "openImageViewer" in js and "media-viewer" in html and "downloadStoredFile" in js,
    "music playback button is available": "createAudioMessagePlayer" in js and "▶ Слушать" in js and "audio-play-button" in html,
    "messages persist independently from chat preview metadata": "async function publishChatMessage(chatId,message,summary)" in js and "await setDoc(messageRef,message);" in js and "allowed by Firestore rules" in js,
    "text messages use the independent message writer": "await publishChatMessage(cur,message,text);" in js,
    "attachment messages use the independent message writer": "await publishChatMessage(chatId,message,summary);" in js,
    "private avatar images refresh stale saved paths": "async function retryAvatarImage" in js and "loadPrivateAvatar(el,nextSource" in js,
    "installed app refreshes JavaScript rather than serving stale cache": 'const CACHE="fross-shell-v10"' in (root / "public/sw.js").read_text(encoding="utf-8") and "const appCode=" in (root / "public/sw.js").read_text(encoding="utf-8"),
    "chat previews show the last sender": "senderUid=c.lastSenderUid" in js and "lastSenderUid" in rules and "lastSenderName" in rules,
    "group owner can change group settings": "group-settings-editor" in js and "resource.data.ownerUid == request.auth.uid" in rules and '"memberProfiles"' in rules,
    "profile editor includes a live public preview": 'id="pp-avatar"' in js and "refreshProfilePreview" in js,
    "message history preserves its reading position": "anchorOffset" in js and "box.scrollTop+=nextOffset-anchorOffset" in js,
    "violet space theme is the default and persisted": 'accent:"#b45cff"' in js and 'bgColor:"#080611"' in js and 'localStorage.setItem("fross-settings-"+me.uid' in js,
    "chat composer has no hard divider": ".comp{border-top:0" in html,
    "audio attachment has no black card or link underline": ".message-audio-player{" in html and "background:transparent!important" in html and "text-decoration:none!important" in html,
    "private avatar image is not cleared after loading": 'el.style.backgroundColor="transparent"' in js and 'el.style.background=""' not in js[js.index("async function loadPrivateAvatar"):js.index("function avatar(")],
    "message avatars carry sender identity for private image refresh": 'avatar(a,{uid:m.senderUid' in js,
    "private downloads are authenticated server-side": "/api/files/download" in js and "async function downloadFile" in worker and "verifyFirebaseToken" in worker,
    "reduced motion support": "prefers-reduced-motion:reduce" in html,
    "animated interface transitions": "@keyframes fross-enter" in html and "@keyframes fross-pop" in html,
    "email verification on registration": "sendEmailVerification(credential.user)" in js,
    "Google sign-in": "new GoogleAuthProvider()" in js,
    "real email/password login": "signInWithEmailAndPassword(auth,email" in js,
    "required email at signup": 'Email для входа и подтверждения' in js and 'Укажите действующий email для подтверждения.' in js,
    "legacy username login retained": 'authEmail(identifier)' in js and 'token.claims.legacyAccount' in js,
    "legacy accounts receive a trusted migration claim": "setCustomUserClaims" in (root / "migration/migrate-d1-to-firebase.mjs").read_text(encoding="utf-8"),
    "Google and password providers have useful setup errors": "auth/unauthorized-domain" in js,
    "chat access requires verified email or admin-migrated legacy claim": "function verified()" in rules and "email_verified == true" in rules and "legacyAccount == true" in rules,
    "chat file uploads are restricted to the authenticated user's own folder": 'request.auth.uid == userId' in storage and 'match /chatFiles/{chatId}/{userId}/{fileName}' in storage and "request.auth.token.email_verified == true" not in storage,
    "no unsafe diagnostic leakage": 'diagnostic:String(error?.message' not in js,
    "username availability can be checked before registration": "allow get: if true;" in rules,
    "duplicate email is not reported as a taken username": 'auth/email-already-in-use":"Этот email уже зарегистрирован' in js,
    "Google users complete a real profile setup": "askGoogleProfile(user)" in js,
    "username can be changed with a Firestore reservation transaction": "username !== oldUsername" in js and "getAfter(/databases/$(database)/documents/usernameIndex/" in rules,
    "display name is separate from unique username": 'Никнейм — может повторяться' in js,
    "phone number linking uses Firebase SMS verification": "linkWithPhoneNumber(currentUser" in js and "RecaptchaVerifier" in js,
    "voice calling has Firestore signaling": (root / "public/voice-calls.js").exists() and "callerCandidates" in (root / "public/voice-calls.js").read_text(encoding="utf-8"),
    "voice call signaling is limited to chat members": "match /calls/{callId}" in rules and "participantUids" in rules,
    "global account reset is admin and opt-in protected": "decoded.frossAdmin !== true" in (root / "functions/index.js").read_text(encoding="utf-8") and 'ENABLE_DANGEROUS_TEST_RESET !== "true"' in (root / "functions/index.js").read_text(encoding="utf-8"),
    "phone and call UI controls exist": 'id="phoneSend"' in js and 'id="call"' in html,
}
for name, passed in checks.items():
    print(("PASS" if passed else "FAIL") + "  " + name)
if not all(checks.values()):
    raise SystemExit(1)
