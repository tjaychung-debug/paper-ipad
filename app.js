// Paper: a deliberately chrome-free, client-side PDF reader.
// Requires PDF.js (loaded from CDN on first use). No PDF file is uploaded.
const $=id=>document.getElementById(id);
const scroller=$('scroller'),pages=$('pages'),toolbar=$('toolbar'),welcome=$('start');
const PDFJS_SRC='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
const PDFJS_WORKER='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
let pdfJs=null,pdf=null,currentBytes=null,currentName='',currentDocId=null,zoom=1,zoomTimer=null,renderToken=0,rendering=0;
let states=[],queue=[],observer=null,lastTap={at:0,x:0,y:0},lastDown=null,ignoreTapUntil=0,pinch=null;
const maxRendered=9,eps=.00001;
const getPdfJs=async()=>{
 if(pdfJs)return pdfJs;
 // Tests may provide a local PDF.js-compatible module. Not used in production.
 const url=(location.hostname==='localhost'&&new URLSearchParams(location.search).has('renderer'))?
    new URLSearchParams(location.search).get('renderer'):PDFJS_SRC;
 pdfJs=await import(url);
 pdfJs.GlobalWorkerOptions.workerSrc=PDFJS_WORKER;
 return pdfJs;
};
function notice(message,persist=false){const t=$('loading');t.textContent=message;t.classList.remove('hidden');if(!persist)setTimeout(()=>{if(t.textContent===message)t.classList.add('hidden')},3200)}
function hideNotice(){$('loading').classList.add('hidden')}
function setTools(show){toolbar.classList.toggle('hidden',!show)}
function setName(){const span=$('fileLabel').querySelector('span');span.textContent=currentName||'PDF';$('fileLabel').querySelector('small').textContent=pdf?`${pdf.numPages}페이지 · 두 번 탭하면 숨김`:'두 번 탭하면 숨김';}
function clampZoom(x){return Math.max(1,Math.min(3.2,x))}
function applyZoom(newZoom,anchorY=scroller.clientHeight/2){
 const old=zoom,next=clampZoom(newZoom);if(Math.abs(next-old)<eps)return;
 const oldTop=scroller.scrollTop;
 const focusY=oldTop+anchorY;
 zoom=next;
 $('zoomLabel').textContent=Math.round(zoom*100)+'%';
 for(const s of states)resizeSheet(s);
 // Preserve the same vertical point during zoom.
 scroller.scrollTop=(focusY*zoom/old)-anchorY;
 clearTimeout(zoomTimer);
 zoomTimer=setTimeout(()=>{for(const s of states){if(s.canvas){s.canvas.remove();s.canvas=null}}requestVisibleRenders()},180);
}
function resizeSheet(s){
 const w=scroller.clientWidth||innerWidth;
 s.el.style.height=Math.max(2,Math.round(w*s.height/s.width*zoom))+'px';
 if(s.canvas){s.canvas.style.width=(w*zoom)+'px';s.canvas.style.height=(w*s.height/s.width*zoom)+'px'}
}
function cancelRenders(){renderToken++;queue.length=0;rendering=0;if(observer){observer.disconnect();observer=null}for(const s of states){s.canvas?.remove();s.canvas=null;s.queued=false}}
function initObserver(){
 if(observer)observer.disconnect();
 observer=new IntersectionObserver(entries=>{
  for(const entry of entries){const s=states[Number(entry.target.dataset.page)-1];if(!s)continue;if(entry.isIntersecting)enqueue(s)}
  pump();
 },{root:scroller,rootMargin:'120% 0px'});
 for(const s of states)observer.observe(s.el);
}
function enqueue(s){if(!s||s.canvas||s.queued||!pdf)return;s.queued=true;queue.push(s);pump()}
function isNear(s){let r=s.el.getBoundingClientRect(),v=scroller.getBoundingClientRect();return r.bottom>v.top-2*v.height&&r.top<v.bottom+2*v.height}
async function pump(){
 while(rendering<2&&queue.length){const s=queue.shift();s.queued=false;if(!isNear(s)||s.canvas||!pdf)continue;rendering++;const token=renderToken;renderSheet(s,token).finally(()=>{rendering=Math.max(0,rendering-1);pump()})}
}
async function renderSheet(s,token){
 let canvas=null;
 try{
  const page=await pdf.getPage(s.page);
  if(token!==renderToken||!isNear(s))return;
  const natural=page.getViewport({scale:1});
  if(Math.abs(natural.width-s.width)>.5||Math.abs(natural.height-s.height)>.5){s.width=natural.width;s.height=natural.height;resizeSheet(s)}
  const cssWidth=scroller.clientWidth*zoom;
  const physical=Math.min(cssWidth*(Math.min(devicePixelRatio||1,2)),4096);
  const viewport=page.getViewport({scale:physical/natural.width});
  canvas=document.createElement('canvas');
  canvas.width=Math.round(viewport.width);canvas.height=Math.round(viewport.height);
  canvas.style.width=cssWidth+'px';canvas.style.height=(cssWidth*s.height/s.width)+'px';
  const ctx=canvas.getContext('2d',{alpha:false});
  await page.render({canvasContext:ctx,viewport,canvas}).promise;
  if(token!==renderToken||!isNear(s)){canvas.width=0;canvas.height=0;return}
  s.el.appendChild(canvas);s.canvas=canvas;s.lastRendered=performance.now();
  releaseDistant();
 }catch(err){if(canvas){canvas.width=0;canvas.height=0};console.warn('PDF page rendering',s.page,err)}
}
function releaseDistant(){
 const arr=states.filter(s=>s.canvas);if(arr.length<=maxRendered)return;
 const middle=scroller.scrollTop+scroller.clientHeight/2;
 arr.sort((a,b)=>Math.abs((a.el.offsetTop+a.el.offsetHeight/2)-middle)-Math.abs((b.el.offsetTop+b.el.offsetHeight/2)-middle));
 for(const s of arr.slice(maxRendered)){s.canvas.width=0;s.canvas.height=0;s.canvas.remove();s.canvas=null;}
}
function requestVisibleRenders(){
 if(!pdf)return;
 // A scrolling event must not turn on the toolbar.
 const v=scroller.getBoundingClientRect();for(const s of states){const r=s.el.getBoundingClientRect();if(r.bottom>v.top-1.5*v.height&&r.top<v.bottom+1.5*v.height)enqueue(s)}
 releaseDistant();
}
async function setDocument(bytes,name,persist=true,id=null){
 cancelRenders();if(pdf){try{await pdf.destroy()}catch{}}pdf=null;states=[];pages.replaceChildren();
 currentBytes=bytes;currentName=name||'document.pdf';currentDocId=id;zoom=1;$('zoomLabel').textContent='100%';scroller.scrollTop=0;
 notice('PDF 불러오는 중…',true);
 try{
  const lib=await getPdfJs();
  const loading=lib.getDocument({data:new Uint8Array(bytes.slice(0)),useSystemFonts:true});
  pdf=await loading.promise;
  const first=await pdf.getPage(1);const ref=first.getViewport({scale:1});
  const frag=document.createDocumentFragment();
  for(let i=1;i<=pdf.numPages;i++){
   const el=document.createElement('section');el.className='sheet';el.dataset.page=String(i);el.setAttribute('aria-label',`${i} 페이지`);
   const s={el,page:i,width:ref.width,height:ref.height,canvas:null,queued:false,lastRendered:0};states.push(s);resizeSheet(s);frag.appendChild(el);
  }
  pages.appendChild(frag);setName();welcome.classList.add('hidden');setTools(false);hideNotice();
  initObserver();requestVisibleRenders();
  // Page sizes may vary; compute in small batches without delaying display.
  const activeDoc=pdf;
  (async()=>{for(let i=1;i<=states.length;i++){
   if(pdf!==activeDoc||!states[i-1]||states[i-1].page!==i)break;
   try{const p=await activeDoc.getPage(i),v=p.getViewport({scale:1});if(pdf!==activeDoc)break;if(v.width!==states[i-1].width||v.height!==states[i-1].height){states[i-1].width=v.width;states[i-1].height=v.height;resizeSheet(states[i-1]);}}catch{}
   if(i%20===0)await new Promise(r=>setTimeout(r,0));
  }})().catch(console.warn);
  if(persist)saveRecent(bytes,name);
 }catch(e){console.error(e);notice('PDF를 열지 못했습니다. 최초 실행에는 인터넷 연결(PDF.js)이 필요합니다.',true);welcome.classList.remove('hidden');setTools(false)}
}
function openFilePicker(){$('fileInput').click()}
$('fileInput').addEventListener('change',async e=>{
 const f=e.target.files?.[0];e.target.value='';if(!f)return;
 if(!/\.pdf$/i.test(f.name)&&f.type!=='application/pdf'){notice('PDF 파일을 선택하세요.');return}
 const b=await f.arrayBuffer();await setDocument(b,f.name);
});
$('startOpen').onclick=openFilePicker;
$('newFile').onclick=openFilePicker;
$('libraryBtn').onclick=$('startLibrary').onclick=openLibrary;
$('libraryClose').onclick=()=>{$('libraryOverlay').classList.add('hidden')};
$('closeTools').onclick=()=>setTools(false);
$('minus').onclick=()=>applyZoom(zoom/1.2);
$('plus').onclick=()=>applyZoom(zoom*1.2);
$('showHelpStart').onclick=$('helpBtn').onclick=()=>{$('help').classList.remove('hidden')};
$('helpClose').onclick=()=>{$('help').classList.add('hidden')};
$('full').onclick=async()=>{
 try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen({navigationUI:'hide'});else notice('Safari 주소창을 숨기려면 홈 화면에 웹앱을 추가하세요.')}catch{notice('iPad에서는 홈 화면에 추가한 웹앱으로 실행하세요.')}
};
$('save').onclick=async()=>{
 if(!currentBytes)return;
 const file=new File([currentBytes],currentName,{type:'application/pdf'});
 try{if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:currentName});return}}catch(e){if(e.name==='AbortError')return}
 const url=URL.createObjectURL(new Blob([currentBytes],{type:'application/pdf'}));
 const a=document.createElement('a');a.href=url;a.download=currentName;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
};
// React ONLY to double tap; never show controls on a single touch/tap.
scroller.addEventListener('pointerdown',e=>{lastDown={x:e.clientX,y:e.clientY}});
scroller.addEventListener('pointerup',e=>{
 if(!pdf||e.pointerType==='mouse'&&e.button!==0)return;
 if(pinch||performance.now()<ignoreTapUntil||!lastDown)return;
 if(Math.hypot(e.clientX-lastDown.x,e.clientY-lastDown.y)>14){lastTap.at=0;return;}
 const now=performance.now(),dx=e.clientX-lastTap.x,dy=e.clientY-lastTap.y;
 if(now-lastTap.at<340&&Math.hypot(dx,dy)<42){setTools(toolbar.classList.contains('hidden'));lastTap.at=0;e.preventDefault()}
 else lastTap={at:now,x:e.clientX,y:e.clientY};
});
// iOS touch events for two-finger pinch; horizontal panning is never enabled.
scroller.addEventListener('touchstart',e=>{
 if(e.touches.length===2){const a=e.touches[0],b=e.touches[1];pinch={dist:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY),zoom,startY:(a.clientY+b.clientY)/2};lastTap.at=0;}
},{passive:true});
scroller.addEventListener('touchmove',e=>{
 if(e.touches.length===2&&pinch){e.preventDefault();const a=e.touches[0],b=e.touches[1];const dist=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);applyZoom(pinch.zoom*(dist/Math.max(1,pinch.dist)),(a.clientY+b.clientY)/2)}
},{passive:false});
scroller.addEventListener('touchend',e=>{if(e.touches.length<2&&pinch){pinch=null;ignoreTapUntil=performance.now()+480}},{passive:true});
// Native Safari double-tap should not additionally zoom the webpage.
scroller.addEventListener('dblclick',e=>e.preventDefault());
scroller.addEventListener('dragover',e=>e.preventDefault());
scroller.addEventListener('drop',async e=>{e.preventDefault();const f=e.dataTransfer.files?.[0];if(f&&/\.pdf$/i.test(f.name))await setDocument(await f.arrayBuffer(),f.name)});
let scrollTid=0;scroller.addEventListener('scroll',()=>{if(scrollTid)return;scrollTid=requestAnimationFrame(()=>{scrollTid=0;requestVisibleRenders()})},{passive:true});
window.addEventListener('resize',()=>{for(const s of states)resizeSheet(s);for(const s of states){s.canvas?.remove();s.canvas=null}requestVisibleRenders()});
// Persist several PDFs, with the last-opened document restored on next launch.
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('paper-local-files-v1',1);req.onupgradeneeded=()=>req.result.createObjectStore('docs');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
function dbRead(db,key){return new Promise((resolve,reject)=>{const req=db.transaction('docs','readonly').objectStore('docs').get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
function dbWrite(db,pairs){return new Promise((resolve,reject)=>{const tx=db.transaction('docs','readwrite');for(const [key,value]of pairs)tx.objectStore('docs').put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
async function saveRecent(bytes,name){
 try{
  const db=await openDB();const id='doc:'+Date.now()+':'+Math.random().toString(36).slice(2);
  await dbWrite(db,[[id,{kind:'pdf',id,bytes,name,timestamp:Date.now()}],['last-index',{id}]]);
  currentDocId=id;db.close();
 }catch(e){console.info('PDF could not be stored locally',e)}
}
async function markOpened(id){try{const db=await openDB();await dbWrite(db,[['last-index',{id}]]);db.close()}catch{}}
async function listStored(){const db=await openDB();const docs=await new Promise((resolve,reject)=>{const req=db.transaction('docs','readonly').objectStore('docs').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});db.close();return docs.filter(x=>x?.kind==='pdf').sort((a,b)=>b.timestamp-a.timestamp)}
async function deleteStored(id){const db=await openDB();await new Promise((resolve,reject)=>{const tx=db.transaction('docs','readwrite');tx.objectStore('docs').delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close()}
async function openLibrary(){
 const dialog=$('libraryOverlay'),box=$('libraryList');dialog.classList.remove('hidden');box.replaceChildren();
 try{
  const docs=await listStored();
  if(!docs.length){const msg=document.createElement('div');msg.textContent='등록된 PDF가 없습니다. PDF 등록 버튼으로 추가하세요.';msg.style.color='#767e8d';msg.style.fontSize='14px';box.appendChild(msg);return}
  for(const doc of docs){
   const line=document.createElement('div');line.className='libraryEntry';
   const btn=document.createElement('button');btn.className='fileTitle';btn.style.border='0';btn.style.background='none';btn.textContent=doc.name;
   btn.onclick=()=>{dialog.classList.add('hidden');setDocument(doc.bytes,doc.name,false,doc.id);markOpened(doc.id)};
   const del=document.createElement('button');del.className='remove';del.textContent='×';del.title='보관된 PDF 삭제';del.onclick=async()=>{await deleteStored(doc.id);openLibrary()};
   line.append(btn,del);box.appendChild(line);
  }
 }catch(e){box.textContent='저장소에 접근하지 못했습니다. Safari 개인 정보 보호 또는 저장소 설정을 확인하세요.';console.warn(e)}
}
async function loadRecent(){
 try{const db=await openDB();const last=await dbRead(db,'last-index');let doc=last?.id?await dbRead(db,last.id):null;
  if(!doc)doc=await dbRead(db,'recent');db.close();if(doc?.bytes)await setDocument(doc.bytes,doc.name,false,doc.id||null)
 }catch(e){console.info('No recent PDF available',e)}
}
if('serviceWorker'in navigator&&/^https?:$/.test(location.protocol)){navigator.serviceWorker.register('./sw.js').catch(console.warn)}
loadRecent();
