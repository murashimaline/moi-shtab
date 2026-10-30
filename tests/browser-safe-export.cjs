// Synthetic profiles only; never opens production or contacts external services.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const KEY='moiShtab_v03';let browser,server,passed=0;
const fixture=()=>({version:3,_revision:{number:12,token:'saved'},objects:[{id:'o',name:'Site',extension:'kept'}],workers:[{id:'w',name:'Worker',rate:6000}],tasks:[],works:[{id:'work',date:'2026-01-10',objectId:'o',photos:['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2Nk+M/wHwAF/gL+5ewzAAAAAElFTkSuQmCC']}],goals:[{id:'g',title:'History'}],attendance:[{id:'a',date:'2026-01-10',workerId:'w',shifts:1,ratePerShift:6000}],payments:[],expenses:[{id:'e',date:'2026-01-10',amount:1,receipts:[{id:'r',name:'Receipt',data:'data:application/pdf;base64,JVBERi0xLjQK'}]}],financeHistory:[{at:'old',collection:'expenses',id:'e',action:'create',before:'null',after:'{"amount":1}'},{at:'old',collection:'expenses',id:'e',action:'create',before:'null',after:'{"amount":1}'}],extension:{nested:['unchanged']}});
const rawFixture=()=>JSON.stringify({...fixture(),unicode:'Русский текст 🏗️',escapedSurrogate:'\ud800',precise:'PRECISE',tiny:'TINY',large:'LARGE'},null,2).replace('"PRECISE"','1.0000000000000001').replace('"TINY"','1e-400').replace('"LARGE"','9007199254740993')+'\r\n';
(async()=>{
 server=http.createServer((req,res)=>{const f=req.url==='/'?'index.html':req.url.slice(1);if(!['index.html','storage.js'].includes(f))return res.writeHead(404).end();res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(path.join(__dirname,'..',f)))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,headless:true});
 async function scenario(name,raw,fn){
  const ctx=await browser.newContext({acceptDownloads:true});await ctx.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  await ctx.addInitScript(({raw,KEY})=>{
   if(raw!==null)localStorage.setItem(KEY,raw);localStorage.setItem(KEY+'_before_import','previous backup\r\n');
   window.exportOriginalGet=Storage.prototype.getItem;window.exportWrites=[];window.exportUrlCalls=0;
   for(const name of ['setItem','removeItem','clear']){const old=Storage.prototype[name];Storage.prototype[name]=function(...args){if(this===localStorage)exportWrites.push([name,...args]);return old.apply(this,args)}}
   const create=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{exportUrlCalls++;return create(blob)};
  },{raw,KEY});
  const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(origin);await p.locator('#backupToggle').click();
  const snapshot=()=>p.evaluate(KEY=>({raw:exportOriginalGet.call(localStorage,KEY),backup:exportOriginalGet.call(localStorage,KEY+'_before_import'),state:persistence.status(),confirmed:persistence.readSnapshot(),memory:JSON.stringify(db),writes:exportWrites}),KEY);
  async function readonly(action){const before=await snapshot();await action();assert.deepEqual(await snapshot(),before);assert.deepEqual(errors,[])}
  async function rejected(){const before=await p.evaluate(()=>exportUrlCalls);await p.locator('#exportBtn').click();assert.equal(await p.evaluate(()=>exportUrlCalls),before);assert.match(await p.locator('#backupStatus').innerText(),/^JSON не подготовлен:/)}
  async function download(selector='#exportBtn'){
   const waiting=p.waitForEvent('download');await p.locator(selector).click();const file=await waiting;assert.equal(await file.failure(),null);return {bytes:fs.readFileSync(await file.path()),name:file.suggestedFilename()};
  }
  try{await fn({p,ctx,readonly,rejected,download});passed++;console.log(name+' PASS')}finally{await ctx.close()}
 }
 const raw=rawFixture();
 await scenario('P2 exact saved JSON includes files, extensions, repeated history and raw numbers without writes',raw,async({p,readonly,download})=>{
  await readonly(async()=>{for(let i=0;i<2;i++){const file=await download();assert.deepEqual(file.bytes,Buffer.from(raw));assert.match(file.name,/^prorabka-backup-.*\.json$/)}
   const text=await p.locator('#backupStatus').innerText();assert.match(text,/подготовлен к скачиванию/);assert.match(text,/полнота резервной копии не проверены/);assert.doesNotMatch(text,/Резервная копия подготовлена\./);
  });
 });
 await scenario('P2 unsaved memory and form edits cannot replace saved JSON in the download',raw,async({p,readonly,download})=>{
  await p.evaluate(()=>{db.objects[0].name='Unsaved';document.querySelector('#objectForm [name=name]').value='Draft'});
  await readonly(async()=>{assert.deepEqual((await download()).bytes,Buffer.from(raw));assert.equal(await p.locator('#objectForm [name=name]').inputValue(),'Draft');assert.match(await p.locator('#backupStatus').innerText(),/Несохранённые правки не включены/)});
 });
 await scenario('P2 damaged source is not exported as an empty full backup; raw recovery is explicit','{broken\r\n',async({p,readonly,rejected,download})=>{
  await readonly(async()=>{await rejected();assert.deepEqual((await download('#downloadRawRecovery')).bytes,Buffer.from('{broken\r\n'));assert.match(await p.locator('#backupStatus').innerText(),/Это не подтверждённая резервная копия/)});
 });
 for(const [name,value] of [['missing',null],['empty',''],['unsupported','{"version":99}']])await scenario('P2 rejects '+name+' saved source',value,async({readonly,rejected})=>readonly(rejected));
 const orphan=fixture();orphan.attendance[0].workerId='missing';
 await scenario('P2 legacy orphan remains readable but cannot be labelled a restorable backup',JSON.stringify(orphan),async({p,readonly,rejected})=>{
  assert.equal(await p.evaluate(()=>persistence.status().blocked),false);await readonly(rejected);
 });
 await scenario('P2 a real second tab conflict rejects normal export and recovery reads current raw bytes',raw,async({p,ctx,readonly,rejected,download})=>{
  const other=await ctx.newPage();await other.goto(origin);const fresh=JSON.stringify({...fixture(),foreign:'new tab'});
  await other.evaluate(({KEY,fresh})=>localStorage.setItem(KEY,fresh),{KEY,fresh});await p.waitForFunction(()=>persistence.status().conflict);
  await readonly(async()=>{await rejected();assert.deepEqual((await download('#downloadRawRecovery')).bytes,Buffer.from(fresh))});await other.close();
 });
 await scenario('P2 external bytes are rejected even without a storage event',raw,async({p,readonly,rejected})=>{
  await p.evaluate(KEY=>localStorage.setItem(KEY,'changed without event'),KEY);assert.equal(await p.evaluate(()=>persistence.status().conflict),false);await readonly(rejected);
 });
 await scenario('P2 denied reading cannot report a successful copy',raw,async({p,readonly,rejected})=>{
  await p.evaluate(KEY=>{Storage.prototype.getItem=function(k){if(k===KEY)throw Error('Read denied');return exportOriginalGet.call(this,k)}},KEY);await readonly(rejected);
 });
 await scenario('P2 a download preparation failure clears the earlier success message',raw,async({p,readonly,download})=>{
  await readonly(async()=>{await download();await p.evaluate(()=>{URL.createObjectURL=()=>{throw Error('Download denied')}});await p.locator('#exportBtn').click();assert.match(await p.locator('#backupStatus').innerText(),/^JSON не подготовлен: Download denied/)});
 });
 await scenario('P2 refuses UTF-8 substitution of a literal lone surrogate without changing source',JSON.stringify({...fixture(),unicode:'PLACEHOLDER'}).replace('PLACEHOLDER','\ud800'),async({p,readonly,rejected})=>{
  await readonly(async()=>{await rejected();assert.match(await p.locator('#backupStatus').innerText(),/точная UTF-8 выгрузка невозможна/)});
 });
 async function collapseRecoveryPanel(p){
  await p.locator('#backupToggle').click();assert.equal(await p.locator('#backupDetails').isVisible(),false);assert.equal(await p.locator('#backupStatus').isVisible(),false);
 }
 async function visibleRecoveryResult(p,pattern){
  assert.equal(await p.locator('#backupDetails').isVisible(),true);assert.equal(await p.locator('#backupStatus').isVisible(),true);
  assert.match(await p.locator('#backupStatus').innerText(),pattern);
  await p.waitForFunction(()=>{const rect=document.getElementById('backupStatus').getBoundingClientRect();return rect.top>=0&&rect.bottom<=innerHeight});
 }
 await scenario('I01 collapsed panel exposes recovery read failure and creates no file',raw,async({p,readonly,rejected})=>{
  await p.evaluate(KEY=>{Storage.prototype.getItem=function(k){if(k===KEY)throw Error('Read denied');return exportOriginalGet.call(this,k)}},KEY);
  await rejected();await collapseRecoveryPanel(p);
  await readonly(async()=>{const urls=await p.evaluate(()=>exportUrlCalls);let downloads=0;p.on('download',()=>downloads++);
   await p.locator('#downloadRawRecovery').click();await visibleRecoveryResult(p,/^Исходный JSON не подготовлен: Read denied/);
   assert.equal(await p.evaluate(()=>exportUrlCalls),urls);assert.equal(downloads,0);
  });
 });
 await scenario('I01 collapsed panel exposes missing recovery source and creates no file',raw,async({p,readonly,rejected})=>{
  await p.evaluate(KEY=>localStorage.removeItem(KEY),KEY);await rejected();await collapseRecoveryPanel(p);
  await readonly(async()=>{const urls=await p.evaluate(()=>exportUrlCalls);let downloads=0;p.on('download',()=>downloads++);
   await p.locator('#downloadRawRecovery').click();await visibleRecoveryResult(p,/^Исходный JSON не подготовлен: Сохранённый источник отсутствует/);
   assert.equal(await p.evaluate(()=>exportUrlCalls),urls);assert.equal(downloads,0);
  });
 });
 await scenario('I01 collapsed panel exposes successful unverified recovery without changing data',raw,async({p,readonly,rejected,download})=>{
  await p.evaluate(KEY=>persistence.observe({key:KEY,newValue:'simulated foreign notification'}),KEY);await rejected();await collapseRecoveryPanel(p);
  await readonly(async()=>{const file=await download('#downloadRawRecovery');assert.deepEqual(file.bytes,Buffer.from(raw));assert.equal(file.name,'prorabka-recovery.json');
   await visibleRecoveryResult(p,/Исходный JSON подготовлен к скачиванию без проверки пригодности к восстановлению\. Это не подтверждённая резервная копия/);
  });
 });
 await browser.close();server.close();console.log('Safe JSON export: '+passed+'/'+passed+' PASS');
})().catch(async error=>{console.error(error);if(browser)await browser.close();if(server)server.close();process.exitCode=1});
