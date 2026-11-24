import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root=process.cwd();
const source=resolve(root,"public");
const target=resolve(root,"www");
await rm(target,{recursive:true,force:true});
await mkdir(target,{recursive:true});
await cp(source,target,{recursive:true});

const workerOrigin="https://fross-messenger.boberbuset132013.workers.dev";
const appPath=resolve(target,"firebase-app.js");
let app=await readFile(appPath,"utf8");
app=app.replaceAll('fetch("/api/files/download"', 'fetch("'+workerOrigin+'/api/files/download"');
await writeFile(appPath,app);

const voicePath=resolve(target,"voice-calls.js");
let voice=await readFile(voicePath,"utf8");
voice=voice.replaceAll('fetch("/api/calls/ice"', 'fetch("'+workerOrigin+'/api/calls/ice"');
await writeFile(voicePath,voice);

const indexPath=resolve(target,"index.html");
let html=await readFile(indexPath,"utf8");
html=html.replace(/<link rel="manifest"[^>]*>/i,"");
html=html.replace(/<script src="\/pwa\.js" defer><\/script>/i,"");
html=html.replace('<script type="module" src="/firebase-app.js"></script>','<script>window.FROSS_NATIVE_APP=true;</script><script type="module" src="/firebase-app.js"></script>');
await writeFile(indexPath,html);
console.log("Prepared local FROSS UI assets for Capacitor Android.");
