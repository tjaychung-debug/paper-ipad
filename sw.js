const CACHE='paper-pwa-v1';
const SHELL=['./','./index.html','./app.js','./manifest.json','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))]))});
self.addEventListener('fetch',event=>{
 const r=event.request;
 if(r.method!=='GET')return;
 if(new URL(r.url).origin===self.location.origin){event.respondWith(caches.match(r).then(hit=>hit||fetch(r).then(res=>{if(res.ok)caches.open(CACHE).then(c=>c.put(r,res.clone()));return res})));return}
 // Cache the PDF.js module/worker after the first successful online load, when CORS permits.
 if(/pdf\.min\.mjs|pdf\.worker\.min\.mjs/.test(r.url))event.respondWith(caches.match(r).then(hit=>hit||fetch(r).then(res=>{if(res.ok)caches.open(CACHE).then(c=>c.put(r,res.clone()));return res})));
});
