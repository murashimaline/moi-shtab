const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const key='moiShtab_v03',date='2026-05-15';
const repo=path.join(__dirname,'..');
const marker={id:'nagatinskaya-2026',review:[]};
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const receipt={id:uuid(13),name:'old.pdf',data:'data:application/pdf;base64,JVBERi0xLjQK',verified:true};
function fixture(){
 return {
  version:3,objects:[{id:uuid(1),name:'Site',extra:'keep'}],
  workers:[{id:uuid(1),name:'Worker',rate:6000},{id:'legacy_worker',name:'Other worker',rate:5000}],
  tasks:[{id:uuid(11),title:'Old task',objectId:uuid(1)}],
  works:[{id:uuid(6),title:'Old work',date,objectId:uuid(1),photos:['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2Nk+M/wHwAF/gL+5ewzAAAAAElFTkSuQmCC']}],goals:[],
  attendance:[{id:uuid(2),date,workerId:uuid(1),objectId:uuid(1),status:'Смена',shifts:1,ratePerShift:6000,shiftType:'day'}],
  payments:[{id:uuid(3),date,workerId:uuid(1),kind:'Выплата',amount:100,paymentSource:'other'}],
  expenses:[{id:uuid(8),date,objectId:uuid(1),amount:100,category:'Материалы',paymentSource:'other',receipts:[receipt]}],
  income:[{id:uuid(9),date,amount:100,objectId:uuid(1)}],
  accountable:[{id:uuid(10),date,amount:100,kind:'receipt'}],
  schedule:[{id:uuid(7),title:'Old schedule',start:date,end:date,substeps:[{id:uuid(12),title:'Old stage',start:date,end:date},{title:'Legacy stage',start:date,end:date}]}],
  warehouse:[{id:uuid(4),name:'Tool',objectId:uuid(1),baseQty:2,unit:'шт.'}],
  warehouseMovements:[{id:uuid(5),date,itemId:uuid(4),kind:'restock',qty:1}],
  timesheetImports:[{id:uuid(20),sourceFile:'old.xlsx',year:2025,review:[]}],
  financeHistory:[{at:'2026-05-15T00:00:00Z',collection:'expenses',id:uuid(8),action:'create',before:'null',after:'{"amount":100}'}]
 };
}
let browser,server,passed=0;
async function snapshot(page){
 return page.evaluate(key=>({
  raw:localStorage.getItem(key),backup:localStorage.getItem(key+'_before_import'),
  confirmed:persistence.readSnapshot(),status:persistence.status(),memory:JSON.stringify(db)
 }),key);
}
async function submit(page,formId,values={}){
 await page.evaluate(({formId,values})=>{
  const form=document.getElementById(formId);
  for(const [name,value] of Object.entries(values))form.elements.namedItem(name).value=value;
  if(!form.checkValidity())throw Error('Invalid test form: '+formId);
  form.requestSubmit();
 },{formId,values});
}
async function cryptoSequence(page,ids,repeat){
 await page.evaluate(({ids,repeat})=>{
  window.cryptoCalls=0;
  Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=>{
   window.cryptoCalls++;
   return ids.shift()??repeat;
  }});
 },{ids,repeat});
}
async function saved(page,collection,id){
 await page.waitForFunction(({collection,id})=>persistence.readSnapshot()[collection].some(row=>row.id===id),{collection,id});
 return page.evaluate(({collection,id})=>persistence.readSnapshot()[collection].find(row=>row.id===id),{collection,id});
}
const click=(page,id)=>page.evaluate(id=>document.getElementById(id).click(),id);
const jsonFile=payload=>({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))});
const sourceKey='t26_'+'a'.repeat(24);
const sheet={
 kind:'prorabka-timesheet-v1',year:2026,rate:6000,workers:[{name:'Imported worker',rate:6000}],
 entries:[{sourceKey,workerName:'Imported worker',date:'2026-05-01',shiftType:'day',sheet:'May',cell:'A1',
  objectName:'Imported site',shifts:1,rate:6000,paid:true,fill:'00B050',accrued:6000,fine:0,paidAmount:6000,rawValue:1}],
 payments:[{sourceKey:'p26_'+'b'.repeat(24),workerName:'Imported worker',date:'2026-05-31',kind:'Выплата',amount:6000,sourceKeys:[sourceKey]}],
 review:[{sheet:'May',cell:'B1',workerName:'Unknown worker',date:'2026-05-01',rawValue:1,quantity:1,paid:false,fine:0,reason:'Worker not identified'}]
};
async function previewSheet(page){
 await page.locator('#timesheetImportFile').setInputFiles(jsonFile(sheet));
 await click(page,'timesheetPreview');
 await page.waitForFunction(()=>!document.getElementById('timesheetPreview').disabled&&document.getElementById('timesheetImportStatus').textContent);
}
async function importSheet(page){
 await previewSheet(page);
 assert.equal(await page.locator('#timesheetApply').isEnabled(),true);
 await click(page,'timesheetApply');
 assert.match(await page.locator('#timesheetImportStatus').textContent(),/Перенос завершён/);
}
const accruals=page=>page.evaluate(()=>db.attendance.map(row=>attendanceAmount(row)));
const withoutRevision=({_revision,...data})=>data;

(async()=>{
 const pinned={
  baseline:'4eb2e73f4dac7da24ed37a2bd38c54d271479aa3',
  'previous-p3':'534725f5ae90cb4b376a9a1076bead8836b4770c'
 };
 const sources=new Map(Object.entries(pinned).flatMap(([prefix,sha])=>['index.html','storage.js'].map(f=>
  [`/${prefix}/${f}`,execFileSync('git',['show',`${sha}:${f}`],{cwd:repo})]
 )));
 server=http.createServer((req,res)=>{
  const f=req.url.endsWith('/')?req.url+'index.html':req.url;
  const body=sources.get(f)??(['/index.html','/storage.js'].includes(f)?fs.readFileSync(path.join(repo,f.slice(1))):null);
  if(!body)return res.writeHead(404).end();
  res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8');
  res.end(body);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,headless:true});
 async function scenario(name,run,data=fixture()){
  const ctx=await browser.newContext({acceptDownloads:true});
  await ctx.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  await ctx.addInitScript(({data,key})=>{
   if(localStorage.getItem(key)===null)localStorage.setItem(key,JSON.stringify(data));
   localStorage.setItem(key+'_before_import','previous backup');
  },{data,key});
  const page=await ctx.newPage(),dialogs=[],errors=[];
  page.on('dialog',d=>{dialogs.push(d.message());return d.accept()});
  page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(origin);
   assert.equal((await snapshot(page)).status.blocked,false);
   await run(page,dialogs);
   assert.deepEqual(errors,[]);
   passed++;console.log(name+' PASS');
  }finally{await ctx.close()}
 }
 await scenario('P3 01 secure unique creation',async page=>{
  await submit(page,'objectForm',{name:'New site'});
  const rows=(await snapshot(page)).confirmed.objects;
  assert.equal(rows.length,2);
  assert.deepEqual(rows[0],fixture().objects[0]);
  assert.match(rows[1].id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
 });
 await scenario('P3 02 forced collision retries through the task form',async page=>{
  await cryptoSequence(page,[uuid(11),uuid(31)]);
  await submit(page,'taskForm',{title:'New task',objectId:uuid(1)});
  assert.equal((await saved(page,'tasks',uuid(31))).title,'New task');
  assert.deepEqual((await snapshot(page)).confirmed.tasks[0],fixture().tasks[0]);
  assert.equal(await page.evaluate(()=>cryptoCalls),2);
 });
 await scenario('P3 03 eight repeated collisions refuse the operation',async(page,dialogs)=>{
  await cryptoSequence(page,[],uuid(1));const before=await snapshot(page);
  await submit(page,'workerForm',{name:'Retry worker',rate:'6000'});
  assert.match(dialogs.at(-1),/8 попыток/);
  assert.equal(await page.evaluate(()=>cryptoCalls),8);
  assert.deepEqual(await snapshot(page),before);
  assert.equal(await page.locator('#workerForm [name=name]').inputValue(),'Retry worker');
 });
 await scenario('P3 04 worker collision preserves existing worker and history',async page=>{
  await cryptoSequence(page,[uuid(1),uuid(32)]);
  await submit(page,'workerForm',{name:'New worker',rate:'6000'});
  await saved(page,'workers',uuid(32));
  const data=(await snapshot(page)).confirmed;
  assert.deepEqual(data.workers.slice(0,2),fixture().workers);
  assert.deepEqual(data.attendance,fixture().attendance);
  assert.deepEqual(data.payments,fixture().payments);
 });
 await scenario('P3 05 object collision preserves original object and its links',async page=>{
  await cryptoSequence(page,[uuid(1),uuid(33)]);
  await submit(page,'objectForm',{name:'New site'});
  await saved(page,'objects',uuid(33));
  const data=(await snapshot(page)).confirmed;
  assert.deepEqual(data.objects[0],fixture().objects[0]);
  assert.deepEqual(data.tasks,fixture().tasks);
  assert.deepEqual(data.warehouse,fixture().warehouse);
 });
 await scenario('P3 06 existing edit preserves its ID without allocating a new one',async page=>{
  await cryptoSequence(page,[]);
  await page.evaluate(id=>editItem('workers',id,'workerForm'),uuid(1));
  await submit(page,'workerForm',{name:'Renamed worker'});
  assert.equal((await saved(page,'workers',uuid(1))).name,'Renamed worker');
  assert.equal(await page.evaluate(()=>cryptoCalls),0);
  assert.deepEqual((await snapshot(page)).confirmed.attendance,fixture().attendance);
 });
 await scenario('P3 07 deleted edit target and substituted form ID are refused',async(page,dialogs)=>{
  await page.evaluate(id=>editItem('tasks',id,'taskForm'),uuid(11));
  const original=await snapshot(page);
  await submit(page,'taskForm',{id:uuid(99),title:'Do not create'});
  assert.match(dialogs.at(-1),/ID формы/);
  assert.deepEqual(await snapshot(page),original);
  await page.evaluate(id=>removeItem('tasks',id),uuid(11));
  const afterDelete=await snapshot(page);
  assert.deepEqual(afterDelete.confirmed.tasks,[]);
  await submit(page,'taskForm',{id:uuid(11),title:'Do not recreate'});
  assert.match(dialogs.at(-1),/отсутствует или изменилась/);
  assert.deepEqual(await snapshot(page),afterDelete);
 });
 await scenario('P3 08 mass worker import handles saved and in-batch collisions atomically',async page=>{
  await page.locator('#workersImportFile').setInputFiles(jsonFile({kind:'prorabka-workers-v1',workers:[{name:'New A'},{name:'New B'}]}));
  await cryptoSequence(page,[uuid(34)],uuid(34));
  const before=await snapshot(page);
  await click(page,'workersImportButton');
  await page.waitForFunction(()=>document.getElementById('workersImportStatus').textContent.includes('8 попыток'));
  assert.deepEqual(await snapshot(page),before);
  await cryptoSequence(page,[uuid(1),uuid(34),uuid(34),uuid(35)]);
  await click(page,'workersImportButton');
  await saved(page,'workers',uuid(35));
  const rows=(await snapshot(page)).confirmed.workers;
  assert.deepEqual(rows.slice(0,2),fixture().workers);
  assert.deepEqual(rows.slice(2).map(row=>row.id),[uuid(34),uuid(35)]);
 });
 await scenario('P3 09 unavailable or throwing crypto refuses creation',async(page,dialogs)=>{
  const before=await snapshot(page);
  await page.evaluate(()=>{Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=>{throw Error('denied')}})});
  await submit(page,'objectForm',{name:'Do not create'});
  assert.match(dialogs.at(-1),/криптографического генератора/);
  assert.deepEqual(await snapshot(page),before);
  await page.evaluate(()=>{Object.defineProperty(window,'crypto',{configurable:true,value:undefined})});
  await submit(page,'objectForm',{name:'Still do not create'});
  assert.match(dialogs.at(-1),/криптографического генератора/);
  assert.deepEqual(await snapshot(page),before);
 });
 await scenario('P3 10 failed save preserves disk, confirmed snapshot and draft',async(page,dialogs)=>{
  await cryptoSequence(page,[uuid(36),uuid(36)]);
  const before=await snapshot(page);
  await page.evaluate(key=>{
   window.originalSetItem=Storage.prototype.setItem;
   Storage.prototype.setItem=function(k,v){if(k===key)throw Error('synthetic quota');return originalSetItem.call(this,k,v)};
  },key);
  await submit(page,'objectForm',{name:'Kept draft'});
  assert.match(dialogs.at(-1),/synthetic quota/);
  assert.deepEqual(await snapshot(page),before);
  assert.equal(await page.locator('#objectForm [name=name]').inputValue(),'Kept draft');
  await page.evaluate(()=>{Storage.prototype.setItem=originalSetItem});
  await submit(page,'objectForm');
  await saved(page,'objects',uuid(36));
 });
 await scenario('P3 11 protected creation and edits across work, schedule, payroll, finance and warehouse preserve links',async page=>{
  const anotherDate='2026-06-17',oid=uuid(1),workerId=uuid(1);
  const cases=[
   ['works','workForm',uuid(6),{title:'New work',date:anotherDate,objectId:oid},{notes:'Edited work'}],
   ['schedule','scheduleForm',uuid(7),{title:'New schedule',start:anotherDate,end:anotherDate},{notes:'Edited stage'}],
   ['attendance','attendanceForm',uuid(2),{date:anotherDate,workerId,objectId:oid,shiftType:'day',status:'Смена'},{notes:'Edited shift'}],
   ['payments','paymentForm',uuid(3),{date:anotherDate,workerId,kind:'Выплата',amount:'100',paymentSource:'other'},{notes:'Edited payment'}],
   ['income','incomeForm',uuid(9),{date:anotherDate,amount:'100',objectId:oid},{notes:'Edited income'}],
   ['expenses','expenseForm',uuid(8),{date:anotherDate,amount:'100',objectId:oid,paymentSource:'other'},{notes:'Edited expense'}],
   ['accountable','accountableForm',uuid(10),{date:anotherDate,amount:'100',kind:'receipt'},{notes:'Edited cash'}],
   ['warehouse','warehouseItemForm',uuid(4),{name:'New tool',baseQty:'2',objectId:oid},{notes:'Edited tool'}],
   ['warehouseMovements','warehouseMoveForm',uuid(5),{date:anotherDate,itemId:uuid(4),qty:'1',kind:'restock'},null]
  ];
  for(let i=0;i<cases.length;i++){
   const [collection,formId,occupied,create,edit]=cases[i],id=uuid(50+i);
   await cryptoSequence(page,[occupied,id]);
   await submit(page,formId,create);
   await saved(page,collection,id);
   if(edit){
    await page.evaluate(({collection,id,formId})=>editItem(collection,id,formId),{collection,id,formId});
    await submit(page,formId,edit);
    await page.waitForFunction(({collection,id})=>!!persistence.readSnapshot()[collection].find(row=>row.id===id)?.notes,{collection,id});
    assert.equal((await saved(page,collection,id)).notes,edit.notes);
   }
   assert.equal(await page.evaluate(()=>cryptoCalls),2);
  }
  const data=(await snapshot(page)).confirmed;
  for(const collection of ['works','attendance','payments','warehouseMovements','expenses']){
   assert.deepEqual(data[collection][0],fixture()[collection][0]);
  }
  assert.deepEqual(data.financeHistory[0],fixture().financeHistory[0]);
 });
 await scenario('P3 12 reload and actual JSON v3 download preserve IDs and source bytes',async page=>{
  await cryptoSequence(page,[uuid(37)]);
  await submit(page,'objectForm',{name:'Saved for reload'});
  await saved(page,'objects',uuid(37));
  const before=await snapshot(page);
  await page.reload();
  await saved(page,'objects',uuid(37));
  await click(page,'backupToggle');
  const pending=page.waitForEvent('download');await page.locator('#exportBtn').click();
  const file=await pending;
  assert.deepEqual(fs.readFileSync(await file.path()),Buffer.from(before.raw));
  assert.equal(JSON.parse(before.raw).version,3);
  assert.deepEqual(await snapshot(page),before);
 });
 await scenario('P3 weekly payments reserve IDs across a batch',async page=>{
  await cryptoSequence(page,[uuid(3),uuid(38),uuid(38),uuid(39)]);
  await page.evaluate(()=>{
   document.getElementById('weeklyAnchor').value='2026-06-17';
   document.getElementById('weeklyPaymentDate').value='2026-06-17';
   document.getElementById('weeklyPaymentSource').value='other';
   renderWeeklyPayroll();
   for(const input of document.querySelectorAll('[data-weekly-worker]'))input.value='100';
   document.getElementById('weeklyPaymentForm').requestSubmit();
  });
  await saved(page,'payments',uuid(39));
  const payments=(await snapshot(page)).confirmed.payments;
  assert.deepEqual(payments[0],fixture().payments[0]);
  assert.deepEqual(payments.slice(1).map(row=>row.id),[uuid(38),uuid(39)]);
 });
 const wageFixture=fixture();
 wageFixture.workers[0].rate=9000;
 delete wageFixture.attendance[0].ratePerShift;
 await scenario('P3 timesheet retries ordinary ID collisions and preserves a single review through JSON and baseline reimport',async page=>{
  const ids=[uuid(1),uuid(40),uuid(1),uuid(41),uuid(2),uuid(42),uuid(3),uuid(43),uuid(20),uuid(44)];
  const before=await snapshot(page);
  await cryptoSequence(page,ids);
  await previewSheet(page);
  assert.deepEqual(await snapshot(page),before);
  await cryptoSequence(page,ids);
  await click(page,'timesheetApply');
  await saved(page,'timesheetImports',uuid(44));
  assert.equal(await page.evaluate(()=>cryptoCalls),10);
  const data=(await snapshot(page)).confirmed;
  assert.equal(data.attendance.at(-1).workerId,uuid(40));
  assert.equal(data.attendance.at(-1).objectId,uuid(41));
  assert.equal(data.payments.at(-1).workerId,uuid(40));
  for(const collection of ['workers','objects','attendance','payments','timesheetImports']){
   assert.deepEqual(data[collection].slice(0,before.confirmed[collection].length),before.confirmed[collection]);
  }
  assert.deepEqual(data.timesheetImports.slice(-2),[
   {id:uuid(44),importSourceKey:marker.id,sourceFile:'Табель Нагатинская.xlsx',year:2026,review:sheet.review},marker
  ]);
  assert.deepEqual(await accruals(page),[9000,6000]);
  assert.equal(await page.locator('#timesheetReview tbody tr').count(),1);
  await cryptoSequence(page,[]);
  await importSheet(page);
  assert.equal(await page.evaluate(()=>cryptoCalls),0);
  const savedState=await snapshot(page);
  assert.deepEqual(withoutRevision(savedState.confirmed),withoutRevision(data));
  await page.reload();
  assert.deepEqual(await snapshot(page),savedState);
  await click(page,'backupToggle');
  const pending=page.waitForEvent('download');await page.locator('#exportBtn').click();
  const download=await pending,bytes=fs.readFileSync(await download.path());
  assert.deepEqual(bytes,Buffer.from(savedState.raw));
  assert.equal(JSON.parse(bytes).version,3);
  assert.deepEqual(await snapshot(page),savedState);

  const ctx=await browser.newContext();
  try{
   await ctx.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
   const baseline=await ctx.newPage(),errors=[];
   baseline.on('dialog',d=>d.accept());
   baseline.on('pageerror',e=>errors.push(e.message));
   await baseline.goto(origin+'/baseline/');
   await baseline.locator('#importFile').setInputFiles({name:'saved-v3.json',mimeType:'application/json',buffer:bytes});
   await baseline.waitForFunction(()=>document.getElementById('backupStatus').textContent.includes('_before_import'));
   const restored=(await snapshot(baseline)).confirmed;
   const {financeHistory,...records}=withoutRevision(restored);
   const {financeHistory:exportedHistory,...exportedRecords}=withoutRevision(savedState.confirmed);
   assert.deepEqual(records,exportedRecords);
   assert.deepEqual(financeHistory.slice(0,exportedHistory.length),exportedHistory);
   await baseline.reload();
   assert.deepEqual((await snapshot(baseline)).confirmed,restored);
   assert.equal(await baseline.locator('#timesheetReview tbody tr').count(),1);
   assert.deepEqual(await accruals(baseline),[9000,6000]);
   await importSheet(baseline);
   assert.deepEqual(withoutRevision((await snapshot(baseline)).confirmed),withoutRevision(restored));
   assert.equal(await baseline.locator('#timesheetReview tbody tr').count(),1);
   assert.deepEqual(await accruals(baseline),[9000,6000]);
   assert.deepEqual(errors,[]);
  }finally{await ctx.close()}
 },wageFixture);
 await scenario('P3 preserves the historical review created by the unchanged baseline',async page=>{
  await page.goto(origin+'/baseline/');
  await importSheet(page);
  const before=(await snapshot(page)).confirmed;
  const historical=before.timesheetImports.find(row=>row.id===marker.id);
  assert.deepEqual(historical.review,sheet.review);
  await page.goto(origin);
  await importSheet(page);
  assert.deepEqual(withoutRevision((await snapshot(page)).confirmed),withoutRevision(before));
  assert.equal(await page.locator('#timesheetReview tbody tr').count(),1);
 });
 await scenario('P3 adds only the compatibility marker to data saved by the original P3 commit',async page=>{
  await page.goto(origin+'/previous-p3/');
  await importSheet(page);
  const before=(await snapshot(page)).confirmed;
  assert.equal(before.timesheetImports.some(row=>row.id===marker.id),false);
  assert.deepEqual(before.timesheetImports.find(row=>row.importSourceKey===marker.id).review,sheet.review);
  await page.goto(origin);
  await cryptoSequence(page,[]);
  await importSheet(page);
  const after=(await snapshot(page)).confirmed;
  assert.equal(await page.evaluate(()=>cryptoCalls),0);
  assert.deepEqual(withoutRevision(after),{...withoutRevision(before),timesheetImports:[...before.timesheetImports,marker]});
  assert.equal(await page.locator('#timesheetReview tbody tr').count(),1);
 });
 await scenario('P3 refuses a foreign fixed ID without writing any data',async page=>{
  const before=await snapshot(page);
  await previewSheet(page);
  assert.equal(await page.locator('#timesheetApply').isEnabled(),false);
  assert.match(await page.locator('#timesheetImportStatus').textContent(),/Служебный ID .* занят/);
  assert.deepEqual(await snapshot(page),before);
 },{...fixture(),timesheetImports:[{...marker,sourceFile:'Another sheet.xlsx',year:2026}]});
 await scenario('P3 does not persist a partial timesheet package on storage or crypto errors',async page=>{
  const before=await snapshot(page);
  await previewSheet(page);
  await page.evaluate(()=>{
   window.originalSetItem=Storage.prototype.setItem;
   Storage.prototype.setItem=function(k,v){
    if(k==='moiShtab_v03')throw new DOMException('Synthetic quota','QuotaExceededError');
    return window.originalSetItem.call(this,k,v);
   };
  });
  await click(page,'timesheetApply');
  assert.match(await page.locator('#timesheetImportStatus').textContent(),/не удалось сохранить/);
  assert.deepEqual(await snapshot(page),before);
  await page.evaluate(()=>Storage.prototype.setItem=window.originalSetItem);
  await previewSheet(page);
  await cryptoSequence(page,[uuid(40)]);
  await click(page,'timesheetApply');
  assert.equal(await page.evaluate(()=>cryptoCalls),2);
  assert.match(await page.locator('#timesheetImportStatus').textContent(),/криптографического генератора/);
  assert.deepEqual(await snapshot(page),before);
  await page.reload();
  await importSheet(page);
  assert.deepEqual((await snapshot(page)).confirmed.timesheetImports.at(-1),marker);
 });
 await scenario('P3 nested stages and receipts reserve IDs while preserving legacy entries',async page=>{
  await page.evaluate(id=>editItem('schedule',id,'scheduleForm'),uuid(7));
  await cryptoSequence(page,[uuid(12),uuid(45)]);
  await click(page,'addSubstep');
  await page.evaluate(date=>{
   const row=document.querySelector('#substepsEditor .substep-editor:last-child');
   row.querySelector('.sub-title').value='New stage';
   row.querySelector('.sub-start').value=date;
   row.querySelector('.sub-end').value=date;
  },date);
  await submit(page,'scheduleForm');
  const stages=(await snapshot(page)).confirmed.schedule[0].substeps;
  assert.deepEqual(stages.map(stage=>stage.id),[uuid(12),undefined,uuid(45)]);
  await page.evaluate(id=>editItem('expenses',id,'expenseForm'),uuid(8));
  await cryptoSequence(page,[uuid(13),uuid(46),uuid(46),uuid(47)]);
  await page.locator('#expenseReceipts').setInputFiles(['a.txt','b.txt'].map(name=>({name,mimeType:'text/plain',buffer:Buffer.from(name)})));
  await page.waitForFunction(()=>financeReceiptDraft.length===3);
  await submit(page,'expenseForm');
  const receipts=(await snapshot(page)).confirmed.expenses[0].receipts;
  assert.deepEqual(receipts[0],receipt);
  assert.deepEqual(receipts.map(row=>row.id),[uuid(13),uuid(46),uuid(47)]);
 });
 await browser.close();server.close();console.log('Record IDs: '+passed+'/'+passed+' PASS');
})().catch(async error=>{console.error(error);if(browser)await browser.close();if(server)server.close();process.exitCode=1});
