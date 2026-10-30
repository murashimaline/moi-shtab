// All fixtures and profiles are synthetic; external network requests are blocked.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
let browser,server;
const fixture=()=>({version:3,_revision:{number:12,token:'unchanged'},objects:[{id:'o',name:'Test'}],workers:[{id:'w',name:'Test',rate:9000}],tasks:[],works:[],goals:[],attendance:[{id:'a',workerId:'w',objectId:'o',date:'2026-01-10',status:'Смена',shifts:1,hours:'',shiftType:'day'}],payments:[],expenses:[]});
(async()=>{
 server=http.createServer((req,res)=>{const f=req.url==='/'?'index.html':req.url.slice(1);if(!['index.html','storage.js'].includes(f))return res.writeHead(404).end();res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(path.join(__dirname,'..',f)))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,headless:true});
 async function scenario(name,raw,fn,beforeRun){
  const ctx=await browser.newContext();await ctx.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  await ctx.addInitScript(raw=>{
   localStorage.setItem('moiShtab_v03',raw);localStorage.setItem('moiShtab_v03_before_import','original backup');
   window.diagnosticWrites=[];
   for(const name of ['setItem','removeItem','clear']){const original=Storage.prototype[name];Storage.prototype[name]=function(...args){if(this===localStorage)diagnosticWrites.push([name,...args]);return original.apply(this,args)}}
  },raw);
  const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(origin);
  const before=await p.evaluate(()=>({snapshot:persistence.readSnapshot(),state:persistence.status(),memory:JSON.stringify(db)}));
  assert.equal(await p.locator('#diagnosticsResults').innerText(),'');
  if(beforeRun)await beforeRun(p);
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
 const warehouse=fixture();warehouse.warehouse=[
  {id:'tool',name:'Tool',objectId:'o',baseQty:2,unit:'шт.',serial:'  XSS-42  '},
  {id:'second-tool',name:'Second tool',objectId:'o',baseQty:1,unit:'условная ед.',serial:'xss-42'}
 ];
 warehouse.warehouseMovements=[
  {id:'move-a',itemId:'tool',date:'2026-01-10',kind:'issue',qty:1,assignee:'Test',notes:'Act'},
  {id:'move-b',itemId:'tool',date:'2026-01-10',kind:'issue',qty:1,assignee:'Test',notes:'Act'}
 ];
 warehouse.works=[{id:'bad-photo',date:'2026-01-10',objectId:'o',photos:['data:image/png;base64,%%%']}];
 warehouse.expenses=[{id:'bad-receipt',date:'2026-01-10',objectId:'o',category:'Материалы',amount:1,paymentSource:'other',receipts:[{id:'receipt',name:'<img src=x onerror="window.injected=1">',data:'data:text/plain;base64,%%%'}]}];
 await scenario('warehouse and attachment directions are visible, safe, and separate from findings',JSON.stringify(warehouse),async p=>{
  const coverage=await p.locator('#diagnosticsDirections').innerText();
  for(const label of ['Проверено','Частично','Невозможно'])assert.match(coverage,new RegExp(label));
  assert.match(coverage,/Остатки/);assert.match(coverage,/Вложения/);
  const text=await p.locator('#diagnosticsResults').innerText();assert.match(text,/Склад/);assert.match(text,/Вложения/);assert.match(text,/Возможный дубль/);
  assert.equal(await p.locator('#diagnosticsResults img').count(),0);assert.equal(await p.evaluate(()=>window.injected),undefined);
 });
  const fractional=fixture();fractional.warehouse=[{id:'cement',name:'Cement',objectId:'o',baseQty:0.3,unit:'кг'}];
  fractional.warehouseMovements=[
   {id:'issue-one',itemId:'cement',date:'2026-01-10',kind:'issue',qty:0.1,assignee:'',notes:''},
   {id:'issue-two',itemId:'cement',date:'2026-01-11',kind:'issue',qty:0.2,assignee:'',notes:''}
  ];
  await scenario('exact fractional warehouse calculation renders without a false deficit and stays read-only',JSON.stringify(fractional),async p=>{
   const text=await p.locator('#diagnosticsResults').innerText();
   assert.doesNotMatch(text,/Отрицательный расчётный остаток/);assert.doesNotMatch(text,/Возможен отрицательный промежуточный остаток/);
   assert.match(await p.locator('#diagnosticsDirections').innerText(),/Остатки/);
  });
 const precise=fixture();precise.warehouse=[{id:'material',objectId:'o',baseQty:10,unit:'кг'},{id:'piece',objectId:'o',baseQty:10,unit:'шт.'}];
 precise.warehouseMovements=[
  {id:'tiny',itemId:'material',date:'2026-01-10',kind:'restock',qty:'TINY'},
  {id:'fraction',itemId:'piece',date:'2026-01-10',kind:'restock',qty:'FRACTION'}
 ];
 const preciseRaw=JSON.stringify(precise).replace('"TINY"','1e-400').replace('"FRACTION"','1.0000000000000001');
 await scenario('raw underflow stays positive and raw fractional pieces are detected without writes',preciseRaw,async p=>{
  const text=await p.locator('#diagnosticsResults').innerText();
  assert.doesNotMatch(text,/Количество движения отсутствует или недопустимо/);
  assert.match(text,/Дробное количество штучного инструмента/);
 });
 const limitedRaw=preciseRaw.replace('1e-400','1e-4097');
 await scenario('unsupported quantity precision renders partial without an invalid-quantity error',limitedRaw,async p=>{
  const text=await p.locator('#diagnosticsResults').innerText();
  assert.doesNotMatch(text,/Количество движения отсутствует или недопустимо/);
  assert.match(text,/Точная десятичная проверка количества недоступна/);
  assert.match(await p.locator('#diagnosticsDirections').innerText(),/Частично/);
 });
 const duplicateRaw=quantities=>{
  const d=fixture();d.warehouse=[{id:'material',name:'Material',objectId:'o',baseQty:10,unit:'кг'}];
  d.warehouseMovements=quantities.map((qty,i)=>({id:'m'+i,itemId:'material',date:'2026-01-10',kind:'restock',qty:'Q'+i,assignee:'Worker',notes:'Act'}));
  let raw=JSON.stringify(d);quantities.forEach((qty,i)=>{raw=raw.replace('"Q'+i+'"',qty)});return raw;
 };
 const duplicateResult=p=>p.evaluate(()=>{
  const r=ProrabkaStorage.diagnoseRaw(persistence.readRaw());
  return {direction:r.directions.find(d=>d.id==='warehouse_duplicates'),ids:r.issues.filter(i=>i.code==='possible_duplicate_warehouse_movement').map(i=>i.record.id)};
 });
 await scenario('distinct exact quantities do not render false duplicate candidates',duplicateRaw(['1e-400','2e-400','1','1.0000000000000001']),async p=>{
  const r=await duplicateResult(p);assert.equal(r.direction.status,'checked');assert.deepEqual(r.ids,[]);
  assert.doesNotMatch(await p.locator('#diagnosticsResults').innerText(),/Возможный дубль движения/);
 });
 await scenario('equal decimal forms retain all real duplicate candidates',duplicateRaw(['1','1.0','1e0','10e-1']),async p=>{
  const r=await duplicateResult(p);assert.equal(r.direction.status,'checked');assert.deepEqual(r.ids,['m0','m1','m2','m3']);
  assert.match(await p.locator('#diagnosticsResults').innerText(),/Возможный дубль движения/);
 });
 await scenario('unsupported precision limits duplicate coverage but preserves available candidates',duplicateRaw(['1','1.0','1e-4097','"0x10"']),async p=>{
  const r=await duplicateResult(p);assert.equal(r.direction.status,'partial');assert.deepEqual(r.ids,['m0','m1']);
  assert.match(await p.locator('#diagnosticsDirections').innerText(),/точное сравнение количества недоступно/);
 });
 await scenario('missing BigInt makes duplicate comparison partial without unproven candidates',duplicateRaw(['1','1.0']),async p=>{
  const r=await duplicateResult(p);assert.equal(r.direction.status,'partial');assert.deepEqual(r.ids,[]);
  assert.doesNotMatch(await p.locator('#diagnosticsResults').innerText(),/Возможный дубль движения/);
  assert.match(await p.locator('#diagnosticsDirections').innerText(),/BigInt/);
 },p=>p.evaluate(()=>{window.BigInt=undefined}));
 const missingMoves=fixture();missingMoves.warehouse=[{id:'tool',name:'Tool',objectId:'o',baseQty:1,unit:'шт.'}];
 await scenario('unavailable directions explain missing data without claiming no problems',JSON.stringify(missingMoves),async p=>{
  const coverage=await p.locator('#diagnosticsDirections').innerText();
  assert.match(coverage,/Связи склада/);assert.match(coverage,/Частично/);assert.match(coverage,/Проверка невозможна — недостаточно данных/);
  assert.doesNotMatch(coverage,/Невозможно — проблем не обнаружено/);
 });
 await browser.close();server.close();
})().catch(async e=>{console.error(e);if(browser)await browser.close();if(server)server.close();process.exitCode=1});
