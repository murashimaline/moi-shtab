// All fixtures and profiles are synthetic; external network requests are blocked.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
let browser,server;
const fixture=()=>({version:3,_revision:{number:12,token:'unchanged'},objects:[{id:'o',name:'Test'}],workers:[{id:'w',name:'Test',rate:9000}],tasks:[],works:[],goals:[],attendance:[{id:'a',workerId:'w',objectId:'o',date:'2026-01-10',status:'Смена',shifts:1,hours:'',shiftType:'day'}],payments:[],expenses:[]});
(async()=>{
 server=http.createServer((req,res)=>{const f=req.url==='/'?'index.html':req.url.slice(1);if(!['index.html','storage.js'].includes(f))return res.writeHead(404).end();res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(path.join(__dirname,'..',f)))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,headless:true});
 async function scenario(name,raw,fn){
  const ctx=await browser.newContext();await ctx.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  await ctx.addInitScript(raw=>{
   localStorage.setItem('moiShtab_v03',raw);localStorage.setItem('moiShtab_v03_before_import','original backup');
   window.diagnosticWrites=[];
   for(const name of ['setItem','removeItem','clear']){const original=Storage.prototype[name];Storage.prototype[name]=function(...args){if(this===localStorage)diagnosticWrites.push([name,...args]);return original.apply(this,args)}}
  },raw);
  const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(origin);
  const before=await p.evaluate(()=>({snapshot:persistence.readSnapshot(),state:persistence.status(),memory:JSON.stringify(db)}));
  assert.equal(await p.locator('#diagnosticsResults').innerText(),'');
  await p.locator('#runDiagnostics').click();await fn(p);
  assert.equal(await p.evaluate(()=>localStorage.getItem(KEY)),raw);
  assert.equal(await p.evaluate(()=>localStorage.getItem(KEY+'_before_import')),'original backup');
  assert.deepEqual(await p.evaluate(()=>({snapshot:persistence.readSnapshot(),state:persistence.status(),memory:JSON.stringify(db)})),before);
  assert.deepEqual(await p.evaluate(()=>diagnosticWrites),[]);assert.deepEqual(errors,[]);
  await ctx.close();console.log(name+' PASS');
 }
 await scenario('legacy diagnostics keep raw bytes, revision, rates, payroll and backups',JSON.stringify(fixture(),null,2)+'\r\n',async p=>{
  const amount=await p.evaluate(()=>attendanceAmount(db.attendance[0]));assert.equal(amount,9000);
  assert.match(await p.locator('#diagnosticsResults').innerText(),/Ставка смены не сохранена/);
  await p.locator('#runDiagnostics').click();assert.equal(await p.evaluate(()=>attendanceAmount(db.attendance[0])),amount);
  await p.reload();assert.equal(await p.locator('#diagnosticsResults').innerText(),'');await p.locator('#runDiagnostics').click();
 });
 const dup=fixture();dup.workers.push({...dup.workers[0]});
 await scenario('blocked load still diagnoses duplicate IDs by index',JSON.stringify(dup),async p=>{
  assert.equal(await p.evaluate(()=>persistence.status().blocked),true);
  const text=await p.locator('#diagnosticsResults').innerText();assert.match(text,/workers\[0\]/);assert.match(text,/workers\[1\]/);assert.match(text,/Повторяющийся ID/);
 });
 await scenario('malformed JSON is incomplete and untouched','{broken\r\n',async p=>{assert.match(await p.locator('#diagnosticsSummary').innerText(),/неполная/);assert.match(await p.locator('#diagnosticsResults').innerText(),/JSON не читается/)});
 const bad=fixture();bad.workers={};bad.attendance.push(null);
 await scenario('damaged collections yield partial report without crashes',JSON.stringify(bad),async p=>{assert.match(await p.locator('#diagnosticsSummary').innerText(),/неполная/)});
 const xss=fixture();xss.expenses=[{id:'<img src=x onerror="window.injected=1">',date:'2026-01-10',amount:1}];
 await scenario('untrusted IDs render as text, never HTML',JSON.stringify(xss),async p=>{
  assert.equal(await p.locator('#diagnosticsResults img').count(),0);assert.equal(await p.evaluate(()=>window.injected),undefined);assert.match(await p.locator('#diagnosticsResults').innerText(),/<img/);
 });
 await scenario('read denial clears previous successful report and makes no writes',JSON.stringify(fixture()),async p=>{
  await p.evaluate(()=>{window.realGet=Storage.prototype.getItem;Storage.prototype.getItem=function(k){if(k===KEY)throw Error('denied');return realGet.call(this,k)}});
  await p.locator('#runDiagnostics').click();assert.match(await p.locator('#diagnosticsSummary').innerText(),/не выполнена/);assert.equal(await p.locator('#diagnosticsResults').innerText(),'');
  await p.evaluate(()=>Storage.prototype.getItem=realGet);
 });
 const many=fixture();many.attendance=Array.from({length:120},(_,i)=>({...many.attendance[0],id:'a'+i,date:'2026-01-10'}));
 await scenario('pagination and mobile rendering do not change source',JSON.stringify(many),async p=>{
  await p.setViewportSize({width:390,height:844});assert.equal(await p.locator('#diagnosticsResults article').count(),100);
  await p.getByRole('button',{name:'Следующие 100',exact:true}).click();assert.match(await p.locator('#diagnosticsSummary').innerText(),/101–200/);
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 });
 const finance=fixture();finance.payments=[{id:'p',workerId:'w',date:'2026-01-10',kind:'Выплата',amount:100},{id:'q',workerId:'w',date:'2026-01-10',kind:'Выплата',amount:100}];
 await scenario('financial candidates and missing sources have readable reasons',JSON.stringify(finance),async p=>{
  const text=await p.locator('#diagnosticsResults').innerText();assert.match(text,/Источник оплаты/);assert.match(text,/повторная финансовая/);assert.match(text,/payments\[0\]/);
 });
 await browser.close();server.close();
})().catch(async e=>{console.error(e);if(browser)await browser.close();if(server)server.close();process.exitCode=1});
