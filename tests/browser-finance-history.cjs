const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(process.env.HISTORY_APP_ROOT||path.join(__dirname,'..'));
const key='moiShtab_v03';
const event={at:'2026-01-01T00:00:00.000Z',collection:'payments',id:'legacy',action:'create',before:'null',after:'{"amount":10}'};
const data={
 version:3,objects:[],workers:[{id:'w',name:'Тест',rate:9000}],tasks:[],works:[],goals:[],expenses:[],payments:[],
 attendance:[{id:'old',workerId:'w',date:'2026-04-01',status:'Смена',shifts:1}],warehouse:[],
 financeHistory:[event,event],advanceReports:{'2026-01':{status:'approved'}}
};
const sourceKey='t26_'+'a'.repeat(24);
const sheet={
 kind:'prorabka-timesheet-v1',year:2026,rate:6000,workers:[{name:'Тест',rate:6000}],
 entries:[{sourceKey,workerName:'Тест',date:'2026-05-01',shiftType:'day',sheet:'Май',cell:'A1',objectName:null,
  shifts:1,rate:6000,paid:true,fill:'00B050',accrued:6000,fine:0,paidAmount:6000,rawValue:1}],
 payments:[{sourceKey:'p26_'+'b'.repeat(24),workerName:'Тест',date:'2026-05-31',kind:'Выплата',amount:6000,sourceKeys:[sourceKey]}],
 review:[]
};
const file=data=>({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
let server,browser,passed=0;
(async()=>{
 server=http.createServer((req,res)=>{
  const name=req.url==='/'?'index.html':req.url.slice(1);
  if(!['index.html','storage.js'].includes(name))return res.writeHead(404).end();
  res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join(root,name)));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
 const context=await browser.newContext({acceptDownloads:true});
 await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 await context.addInitScript(({data,key})=>{
  if(localStorage.getItem(key)===null){
   localStorage.setItem(key,JSON.stringify(data));
   localStorage.setItem(key+'_before_import','prior backup');
  }
 },{data,key});
 const page=await context.newPage(),errors=[],dialogs=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('dialog',dialog=>{dialogs.push(dialog.message());return dialog.accept()});
 await page.goto(origin);
 const snapshot=()=>page.evaluate(key=>({
  raw:localStorage.getItem(key),backup:localStorage.getItem(key+'_before_import'),
  confirmed:persistence.readSnapshot(),memory:JSON.stringify(db)
 }),key);
 async function check(name,run){await run();passed++;console.log('DI01 '+name+' PASS')}
 async function importSheet(){
  await page.locator('#timesheetImportFile').setInputFiles(file(sheet));
  await page.evaluate(()=>document.getElementById('timesheetPreview').click());
  await page.waitForFunction(()=>!document.getElementById('timesheetApply').disabled);
  await page.evaluate(()=>document.getElementById('timesheetApply').click());
  assert.match(await page.locator('#timesheetImportStatus').textContent(),/Перенос завершён/);
 }
 async function restore(candidate){
  await page.locator('#importFile').setInputFiles(file(candidate));
  await page.waitForFunction(()=>document.getElementById('importFile').value==='');
 }
 await check('unrelated form save preserves both identical events',async()=>{
  await page.evaluate(()=>{
   const form=document.getElementById('objectForm');
   form.elements.name.value='Synthetic site';
   form.requestSubmit();
  });
  const after=await snapshot();
  assert.deepEqual(after.confirmed.financeHistory,[event,event]);
  assert.equal(after.confirmed.objects.length,1);
  assert.equal(after.backup,'prior backup');
  await page.reload();
  assert.deepEqual((await snapshot()).confirmed.financeHistory,[event,event]);
 });
 await check('paid timesheet repeat preserves all events and historical 9000/6000 accruals',async()=>{
  await importSheet();
  const before=await snapshot();
  assert.deepEqual(before.confirmed.financeHistory.slice(0,2),[event,event]);
  assert.equal(before.confirmed.financeHistory.length,3);
  for(let attempt=0;attempt<2;attempt++)await importSheet();
  const after=await snapshot();
  assert.deepEqual(after.confirmed.financeHistory,before.confirmed.financeHistory);
  assert.deepEqual(after.confirmed.attendance,before.confirmed.attendance);
  assert.deepEqual(after.confirmed.payments,before.confirmed.payments);
  assert.deepEqual(await page.evaluate(()=>db.attendance.map(attendanceAmount)),[9000,6000]);
 });
 await check('restore retains incoming repeated occurrences without growth on repetition',async()=>{
  const before=await snapshot(),candidate=JSON.parse(before.raw);
  candidate.financeHistory.push(event);
  await restore(candidate);
  const after=await snapshot();
  assert.equal(after.backup,before.raw);
  assert.equal(after.confirmed.financeHistory.length,4);
  assert.deepEqual(after.confirmed.financeHistory.slice(0,3),before.confirmed.financeHistory);
  assert.deepEqual(after.confirmed.financeHistory[3],event);
  await restore(candidate);
  const again=await snapshot();
  assert.deepEqual(again.confirmed.financeHistory,after.confirmed.financeHistory);
  assert.equal(again.backup,after.raw);
  assert.deepEqual(again.confirmed.payments,before.confirmed.payments);
  assert.deepEqual(again.confirmed.advanceReports,before.confirmed.advanceReports);
 });
 await check('failed form save preserves raw history and retry adds one real event',async()=>{
  const before=await snapshot();
  await page.evaluate(()=>{
   window.originalSet=Storage.prototype.setItem;
   Storage.prototype.setItem=function(k,v){
    if(k==='moiShtab_v03')throw Error('Synthetic quota');
    return originalSet.call(this,k,v);
   };
   const form=document.getElementById('incomeForm');
   form.elements.date.value='2026-05-01';
   form.elements.amount.value='100';
   form.requestSubmit();
  });
  assert.deepEqual(await snapshot(),before);
  assert.match(dialogs.at(-1),/Данные не сохранены/);
  await page.evaluate(()=>{
   Storage.prototype.setItem=originalSet;
   document.getElementById('incomeForm').requestSubmit();
  });
  const after=await snapshot();
  assert.deepEqual(after.confirmed.financeHistory.slice(0,4),before.confirmed.financeHistory);
  assert.equal(after.confirmed.financeHistory.length,5);
  assert.equal(after.confirmed.income.length,1);
 });
 await check('actual JSON download and reload retain the complete event sequence',async()=>{
  const before=await snapshot();
  const pending=page.waitForEvent('download');
  await page.evaluate(()=>document.getElementById('exportBtn').click());
  const download=await pending;
  assert.deepEqual(fs.readFileSync(await download.path()),Buffer.from(before.raw));
  assert.deepEqual(await snapshot(),before);
  await page.reload();
  assert.deepEqual(await snapshot(),before);
  assert.deepEqual(await page.evaluate(()=>db.attendance.map(attendanceAmount)),[9000,6000]);
 });
 assert.deepEqual(errors,[]);
 console.log('Finance history: '+passed+'/'+passed+' PASS');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{
 if(browser)await browser.close();
 if(server)server.close();
});
