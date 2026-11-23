from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / ".merge" / "FROSS-messenger-v6.zip"
PARTS_DIR = ROOT / ".merge" / "parts"

# Large uploads are committed as small ASCII chunks so GitHub's API can store
# them reliably. Reassemble the original ZIP byte-for-byte before extracting.
if not ARCHIVE.exists() and PARTS_DIR.exists():
    parts = sorted(PARTS_DIR.glob("part*.txt"))
    if parts:
        import base64
        encoded = "".join(part.read_text(encoding="ascii").strip() for part in parts)
        try:
            ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
            ARCHIVE.write_bytes(base64.b64decode(encoded, validate=True))
        except Exception as error:
            raise SystemExit(f"Could not reconstruct uploaded archive: {error}")

if not ARCHIVE.exists():
    print("No uploaded archive found; nothing to merge.")
    raise SystemExit(0)

# Read the last deployed source before overlaying the submitted v6 project.
current_js = subprocess.check_output(
    ["git", "show", "HEAD:public/firebase-app.js"], cwd=ROOT, text=True
)
current_sw = subprocess.check_output(
    ["git", "show", "HEAD:public/sw.js"], cwd=ROOT, text=True
)

with tempfile.TemporaryDirectory(prefix="fross-v6-") as temp_name:
    temp = Path(temp_name)
    with zipfile.ZipFile(ARCHIVE) as zf:
        for entry in zf.infolist():
            target = (temp / entry.filename).resolve()
            if not target.is_relative_to(temp.resolve()):
                raise SystemExit(f"Unsafe archive path: {entry.filename}")
        zf.extractall(temp)

    # Preserve the current deployment pipeline, Worker and validation.
    protected = {
        "worker.js",
        "wrangler.toml",
        ".github/workflows/deploy.yml",
        ".github/workflows/validate.yml",
        "scripts/validate_project.py",
        "scripts/merge_uploaded_v6.py",
    }
    imported = []
    for source in temp.rglob("*"):
        if not source.is_file():
            continue
        rel = source.relative_to(temp).as_posix()
        if rel in protected:
            continue
        target = ROOT / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        imported.append(rel)

def get_function(source: str, name: str) -> str:
    pattern = re.compile(
        rf"^(?:async\s+)?function\s+{re.escape(name)}\s*\([^)]*\)\s*\{{.*?^\}}",
        re.M | re.S,
    )
    match = pattern.search(source)
    if not match:
        raise SystemExit(f"Required function not found: {name}")
    return match.group(0)

def replace_function(source: str, name: str, replacement: str) -> str:
    pattern = re.compile(
        rf"^(?:async\s+)?function\s+{re.escape(name)}\s*\([^)]*\)\s*\{{.*?^\}}",
        re.M | re.S,
    )
    updated, count = pattern.subn(lambda _: replacement, source, count=1)
    if count != 1:
        raise SystemExit(f"Could not replace function: {name}")
    return updated

js_path = ROOT / "public/firebase-app.js"
js = js_path.read_text(encoding="utf-8")

# Restore current fixes for stale private avatar URLs.
avatar_helpers = "\n\n".join(
    get_function(current_js, name)
    for name in ("showAvatarFallback", "retryAvatarImage", "loadPrivateAvatar")
)
current_avatar = get_function(current_js, "avatar")
js = replace_function(js, "avatar", current_avatar)
js = re.sub(
    r"(?m)^function avatar\(",
    lambda _: avatar_helpers + "\n\nfunction avatar(",
    js,
    count=1,
)

# Preserve safe message persistence: save the message before chat preview metadata.
publish_helper = get_function(current_js, "publishChatMessage")
if "async function publishChatMessage(chatId,message,summary)" not in js:
    marker = "async function send() {"
    if marker not in js:
        raise SystemExit("Text message handler was not found in imported source")
    js = js.replace(marker, publish_helper + "\n\n" + marker, 1)

send_start = js.find("async function send() {")
send_end = js.find('\n$("send").onclick=send;', send_start)
if send_start < 0 or send_end < 0:
    raise SystemExit("Could not isolate text message handler")
send_block = js[send_start:send_end]
send_block = send_block.replace(
    '    const chatRef=doc(db,"chats",cur),batch=writeBatch(db);\n'
    '    const messageRef=doc(collection(db,"chats",cur,"messages"));',
    "",
    1,
)
send_block, text_count = re.subn(
    r"\n    batch\.set\(messageRef,message\);\n"
    r"    batch\.update\(chatRef,\{.*?\}\);\n"
    r"    await batch\.commit\(\);",
    "\n    await publishChatMessage(cur,message,text);",
    send_block,
    count=1,
    flags=re.S,
)
if text_count != 1 or "batch.commit" in send_block or "messageRef" in send_block:
    raise SystemExit("Could not safely convert text message persistence")
js = js[:send_start] + send_block + js[send_end:]

js = js.replace(
    'const batch=writeBatch(db),messageRef=doc(collection(db,"chats",chatId,"messages"));',
    "",
    1,
)
js = js.replace("        batch.set(messageRef,message);", "", 1)
js, attachment_count = re.subn(
    r"\n        batch\.update\(doc\(db,\"chats\",chatId\),\{.*?\}\);\n"
    r"        await batch\.commit\(\);progress\.update\(100\);",
    "\n        await publishChatMessage(chatId,message,summary);progress.update(100);",
    js,
    count=1,
    flags=re.S,
)
if attachment_count != 1 or "batch.set(messageRef,message)" in js:
    raise SystemExit("Could not safely convert attachment message persistence")
js_path.write_text(js, encoding="utf-8")

# Retain the network-first service worker and include the imported PWA updater.
sw = current_sw
shell_match = re.search(r"const SHELL=\[(.*?)\];", sw, re.S)
if not shell_match:
    raise SystemExit("Could not find service-worker shell asset list")
shell = shell_match.group(1)
if '"/pwa.js"' not in shell:
    shell = shell.rstrip() + ',"/pwa.js"'
sw = sw[:shell_match.start(1)] + shell + sw[shell_match.end(1):]
(ROOT / "public/sw.js").write_text(sw, encoding="utf-8")

html_path = ROOT / "public/index.html"
html = html_path.read_text(encoding="utf-8")
if 'name="fross-shell-version"' in html:
    html = re.sub(
        r'(<meta\s+name="fross-shell-version"\s+content=")[^"]*(")',
        r"\g<1>7\2",
        html,
        count=1,
    )
else:
    html = html.replace(
        '<meta charset="utf-8">',
        '<meta charset="utf-8"><meta name="fross-shell-version" content="7">',
        1,
    )
html_path.write_text(html, encoding="utf-8")

required = {
    "cosmic background module": (ROOT / "public/space.js").exists(),
    "PWA update/install module": (ROOT / "public/pwa.js").exists(),
    "upload progress component": "createUploadProgress" in (ROOT / "public/chat-features.js").read_text(encoding="utf-8"),
    "group settings UI": "openGroupSettings" in js and "group-sheet" in html,
    "latest avatar retry fix": "async function retryAvatarImage" in js and "loadPrivateAvatar(el,nextSource" in js,
    "safe text message writer": "await publishChatMessage(cur,message,text);" in js,
    "safe attachment message writer": "await publishChatMessage(chatId,message,summary);" in js,
    "network-first app assets": "const appCode=" in sw,
    "PWA updater in service-worker shell": '"/pwa.js"' in sw,
}
for label, passed in required.items():
    print(("PASS" if passed else "FAIL") + "  " + label)
if not all(required.values()):
    raise SystemExit("The uploaded source merge did not pass feature checks")

ARCHIVE.unlink()
if PARTS_DIR.exists():
    for part in PARTS_DIR.glob("part*.txt"):
        part.unlink()
    try:
        PARTS_DIR.rmdir()
    except OSError:
        pass
try:
    ARCHIVE.parent.rmdir()
except OSError:
    pass
print(f"Imported {len(imported)} files from uploaded FROSS v6 archive.")
