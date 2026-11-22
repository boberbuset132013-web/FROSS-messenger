from pathlib import Path

root = Path(__file__).resolve().parents[1]
html = (root / "public/index.html").read_text(encoding="utf-8")
js = (root / "public/firebase-app.js").read_text(encoding="utf-8")
rules = (root / "firestore.rules").read_text(encoding="utf-8")
storage = (root / "storage.rules").read_text(encoding="utf-8")
checks = {
    "responsive viewport": 'name="viewport"' in html,
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
    "chat file access requires verified email or admin-migrated legacy claim": "request.auth.token.email_verified == true" in storage and "request.auth.token.legacyAccount == true" in storage,
    "no unsafe diagnostic leakage": 'diagnostic:String(error?.message' not in js,
    "username availability can be checked before registration": "allow get: if true;" in rules,
    "duplicate email is not reported as a taken username": 'auth/email-already-in-use":"Этот email уже зарегистрирован' in js,
    "Google users complete a real profile setup": "askGoogleProfile(user)" in js,
    "username can be changed with a Firestore reservation transaction": "username !== oldUsername" in js and "getAfter(/databases/$(database)/documents/usernameIndex/" in rules,
    "display name is separate from unique username": 'Никнейм — может повторяться' in js,
    "web no longer sends SMS for phone verification": "linkWithPhoneNumber" not in js and "phoneSend" not in js,
    "Android app includes Firebase PNV": (root / "android/app/src/main/java/com/fross/messenger/MainActivity.kt").exists() and "getVerifiedPhoneNumber(this)" in (root / "android/app/src/main/java/com/fross/messenger/MainActivity.kt").read_text(encoding="utf-8") and "com.google.firebase:firebase-pnv" in (root / "android/app/build.gradle.kts").read_text(encoding="utf-8"),
    "PNV token is verified on the server": "JwtVerifier.create" in (root / "functions/phone-security.js").read_text(encoding="utf-8") and "verifyPhoneWithPnv" in (root / "functions/index.js").read_text(encoding="utf-8"),
    "browser sign-in requests approval through FROSS Security": "createBrowserLoginRequest" in js and "waitForBrowserApproval" in js and "FROSS Security" in js,
    "browser approval is protected by Firestore session rules": "function approvedBrowserSession()" in rules and "approvedBrowserSessions" in rules and ".expiresAt > request.time" in rules,
    "Storage also checks trusted FROSS sessions": "function frossSessionApproved()" in storage and "requireBrowserApproval" in storage,
    "browser approval gate is opt-in": "requireBrowserApproval" in (root / "functions/phone-security.js").read_text(encoding="utf-8") and "off by default" in (root / "android/README.md").read_text(encoding="utf-8"),
    "voice calling has Firestore signaling": (root / "public/voice-calls.js").exists() and "callerCandidates" in (root / "public/voice-calls.js").read_text(encoding="utf-8"),
    "voice call signaling is limited to chat members": "match /calls/{callId}" in rules and "participantUids" in rules,
    "global account reset is admin and opt-in protected": "decoded.frossAdmin !== true" in (root / "functions/index.js").read_text(encoding="utf-8") and 'ENABLE_DANGEROUS_TEST_RESET !== "true"' in (root / "functions/index.js").read_text(encoding="utf-8"),
    "phone and call UI controls exist": 'phoneError' in js and 'id="call"' in html,
}
for name, passed in checks.items():
    print(("PASS" if passed else "FAIL") + "  " + name)
if not all(checks.values()):
    raise SystemExit(1)
