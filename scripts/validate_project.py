from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
html = (root / "public/index.html").read_text(encoding="utf-8")
js = (root / "public/firebase-app.js").read_text(encoding="utf-8")
rules = (root / "firestore.rules").read_text(encoding="utf-8")
storage = (root / "storage.rules").read_text(encoding="utf-8")
checks = {
    "responsive viewport": 'name="viewport"' in html,
    "reduced motion support": "prefers-reduced-motion:reduce" in html,
    "email verification on registration": "sendEmailVerification(credential.user)" in js,
    "Google sign-in": "new GoogleAuthProvider()" in js,
    "real email/password login": "signInWithEmailAndPassword(auth,email" in js,
    "required email at signup": 'Email для входа и подтверждения' in js and 'Некорректный email.' in js,
    "legacy username login retained": 'authEmail(identifier)' in js,
    "Google and password providers have useful setup errors": "auth/unauthorized-domain" in js,
    "chat access requires verified email": "function verified()" in rules and "return verified()" in rules,
    "chat file access requires verified email": "request.auth.token.email_verified == true" in storage,
    "no unsafe diagnostic leakage": 'diagnostic:String(error?.message' not in js,
}
for name, passed in checks.items():
    print(("PASS" if passed else "FAIL") + "  " + name)
if not all(checks.values()):
    raise SystemExit(1)
