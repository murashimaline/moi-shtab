const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');

const root=path.join(__dirname,'..');
const key='moiShtab_v03';
const event={at:'2026-01-01T00:00:00.000Z',collection:'payments',id:'legacy',action:'create',before:'null',after:'{"amount":10}'};
const shift=(id,workerId,date,patch={})=>({id,workerId,date,status:'Смена',hours:8,shifts:1,shiftType:'day',ratePerShift:9000,...patch});
const data={
 version:3,objects:[{id:'site',name:'Синтетический объект'}],workers:[{id:'a',name:'Тест',rate:12000},{id:'b',name:'Тест',rate:6000}],
 tasks:[],works:[],goals:[],expenses:[],warehouse:[],
 attendance:[
  shift('history-a','a','2026-04-01',{fine:100,deduction:50}),
  shift('history-b','b','2026-05-01',{ratePerShift:6000,importSourceKey:'synthetic-import'}),
  shift('edit-a','a','2027-01-01',{fine:100,deduction:50,extra:'keep'}),
  shift('night-a','a','2027-01-01',{shiftType:'night',hours:4}),
  shift('unknown-b','b','2027-01-02',{shiftType:'unspecified',ratePerShift:6000}),
  shift('weekly-b','b','2027-01-04',{ratePerShift:6000})
 ],
 payments:[
  {id:'cash-a',workerId:'a',date:'2027-01-01',kind:'Аванс',amount:1234,paymentSource:'other'},
  {id:'weekly',workerId:'b',date:'2027-01-12',kind:'Выплата',amount:6000,weeklyWeekStart:'2027-01-04',weeklyWeekEnd:'2027-01-10',paymentSource:'other'}
 ],
 financeHistory:[event,event],
 advanceReports:{'2026-12':{status:'approved'}}
};

let server,browser,passed=0;
(async()=>{
 server=http.createServer((req,res)=>{
  const name=req.url==='/'?'index.html':req.url.slice(1);
  if(!['index.html','storage.js'].includes(name))return res.writeHead(404).end();
  res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join(root,name)));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port+'/';
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 await context.addInitScript(({key,data})=>{
  if(localStorage.getItem(key)===null){
   localStorage.setItem(key,JSON.stringify(data));
   localStorage.setItem(key+'_before_import','prior backup');
  }
  const set=Storage.prototype.setItem;
  window.primaryWrites=0;
  Storage.prototype.setItem=function(name,value){
   if(name===key){
    if(window.failPrimaryWrite)throw Error('Synthetic storage failure');
    window.primaryWrites++;
   }
   return set.call(this,name,value);
  };
 },{key,data});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('dialog',dialog=>dialog.accept());
 const control=id=>page.locator('#timesheet'+id);
 const form=name=>control('BatchForm').locator('[name='+name+']');
 const snapshot=()=>page.evaluate(key=>({raw:localStorage.getItem(key),backup:localStorage.getItem(key+'_before_import'),db,confirmed:persistence.readSnapshot(),writes:window.primaryWrites}),key);
 const at=async date=>{
  await control('Date').fill(date);
  await control('Date').dispatchEvent('change');
 };
 const add=(view,id,date)=>control(view).locator('[data-worker="'+id+'"][data-date="'+date+'"]');
 const edit=id=>control('WeekView').locator('[data-record="'+id+'"]');
 async function check(name,run){
  await run();
  passed++;
  console.log('TB01 '+name+' PASS');
 }
 await page.goto(url);
 await page.evaluate(()=>showPage('timesheet'));
 const original=await snapshot();

 await check('desktop and phone share selections without writing, including cross-year dates',async()=>{
  await at('2027-01-02');
  assert.match(await control('Week').textContent(),/2026-12-28 — 2027-01-03/);
  assert.equal(await control('WeekView').isVisible(),true);
  assert.equal(await control('DayView').isVisible(),false);
  assert.match(await control('WeekView').textContent(),/Смена · День.*Смена · Ночь/s);
  assert.match(await control('WeekView').textContent(),/Не указана/);
  assert.equal(await add('WeekView','a','2026-12-31').count(),0);
  await add('WeekView','a','2027-01-02').check();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await control('WeekView').isVisible(),false);
  assert.equal(await control('DayView').isVisible(),true);
  assert.equal(await add('DayView','a','2027-01-02').isChecked(),true);
  assert.equal(await control('Calendar').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  await control('DayView').locator('[data-timesheet-day="2027-01-03"]').click();
  await add('DayView','b','2027-01-03').check();
  await control('WorkerFilter').selectOption('a');
  assert.match(await control('Selection').textContent(),/2/);
  await control('WorkerFilter').selectOption('');
  await page.setViewportSize({width:1440,height:1000});
  assert.equal(await add('WeekView','b','2027-01-03').isChecked(),true);
  assert.deepEqual(await snapshot(),original);
 });

 await check('cancel and a conflict in a filtered-out worker leave raw data and draft state correct',async()=>{
  await control('BatchCancel').click();
  assert.match(await control('Selection').textContent(),/0/);
  await add('WeekView','a','2027-01-03').check();
  await add('WeekView','b','2027-01-02').check();
  await control('WorkerFilter').selectOption('a');
  await control('BatchPreview').click();
  assert.match(await control('BatchRows').textContent(),/Тест · b · 2027-01-02 — Дубль или конфликт/);
  assert.equal(await control('BatchSave').isDisabled(),true);
  assert.match(await control('Selection').textContent(),/2/);
  assert.deepEqual(await snapshot(),original);
  await control('BatchCancel').click();
  await control('WorkerFilter').selectOption('');
 });

 await check('write failure is atomic and retry creates exactly two shifts with one write',async()=>{
  await add('WeekView','a','2027-01-02').check();
  await add('WeekView','b','2027-01-03').check();
  await form('shiftType').selectOption('day');
  await form('objectId').selectOption('site');
  await control('BatchPreview').click();
  assert.match(await control('BatchRows').textContent(),/Новых смен: 2/);
  await page.evaluate(()=>{window.failPrimaryWrite=true});
  await control('BatchSave').click();
  assert.match(await control('BatchStatus').textContent(),/не сохранены.*Synthetic storage failure/);
  assert.match(await control('Selection').textContent(),/2/);
  assert.deepEqual(await snapshot(),original);
  await page.evaluate(()=>{window.failPrimaryWrite=false});
  await control('BatchPreview').click();
  await control('BatchSave').click();
  await page.evaluate(()=>document.getElementById('timesheetBatchSave').click());
  assert.match(await control('BatchStatus').textContent(),/Сохранено: новых смен 2, исправлений 0/);
  assert.equal(await control('BatchResult').locator('tbody tr').count(),2);
  const saved=await snapshot();
  assert.equal(saved.writes,1);
  assert.equal(saved.db.attendance.length,original.db.attendance.length+2);
  assert.deepEqual(saved.db.attendance.slice(-2).map(row=>[row.workerId,row.date,row.ratePerShift,row.objectId]),[
   ['a','2027-01-02',12000,'site'],['b','2027-01-03',6000,'site']
  ]);
  assert.deepEqual(saved.db.payments,original.db.payments);
  assert.deepEqual(saved.db.financeHistory,original.db.financeHistory);
  assert.equal(saved.backup,original.backup);
 });

 await check('correction requires renewed confirmation, keeps rate and deductions, and persists after reload',async()=>{
  await control('Mode').selectOption('edit');
  await edit('edit-a').check();
  await form('changeStatus').check();
  await form('status').selectOption('Часы');
  await form('changeHours').check();
  await form('hours').fill('4');
  await form('reason').fill(' ');
  await control('BatchPreview').click();
  assert.match(await control('BatchStatus').textContent(),/Укажите основание/);
  await form('reason').fill('Проверка часов');
  await control('BatchPreview').click();
  assert.match((await control('BatchRows').textContent()).replaceAll(/\s/g,''),/9000,00₽→4500,00₽/);
  assert.match((await control('BatchRows').textContent()).replaceAll(/\s/g,''),/1234,00₽/);
  assert.equal(await control('BatchSave').isDisabled(),true);
  await control('BatchAck').check();
  await form('hours').fill('2');
  assert.equal(await control('BatchReview').isVisible(),false);
  await control('BatchPreview').click();
  assert.equal(await control('BatchAck').isChecked(),false);
  await control('BatchAck').check();
  await form('reason').fill('Уточнение по наряду');
  assert.equal(await control('BatchReview').isVisible(),false);
  await control('BatchPreview').click();
  await control('BatchAck').check();
  const beforeWrite=await snapshot();
  await page.evaluate(()=>{window.failPrimaryWrite=true});
  await control('BatchSave').click();
  assert.match(await control('BatchStatus').textContent(),/не сохранены.*Synthetic storage failure/);
  assert.deepEqual(await snapshot(),beforeWrite);
  assert.equal(await form('reason').inputValue(),'Уточнение по наряду');
  await page.evaluate(()=>{window.failPrimaryWrite=false});
  await control('BatchPreview').click();
  await control('BatchAck').check();
  await control('BatchSave').click();
  assert.match(await control('BatchStatus').textContent(),/новых смен 0, исправлений 1/);
  const saved=await snapshot();
  assert.equal(saved.writes,2);
  assert.deepEqual(saved.db.attendance.find(row=>row.id==='edit-a'),{
   ...original.db.attendance.find(row=>row.id==='edit-a'),status:'Часы',hours:'2',shifts:0.25
  });
  assert.deepEqual(saved.db.payments,original.db.payments);
  assert.deepEqual(saved.db.financeHistory,original.db.financeHistory);
  assert.equal(saved.db.attendanceEditHistory.length,1);
  assert.deepEqual(saved.db.attendanceEditHistory[0].before,original.db.attendance.find(row=>row.id==='edit-a'));
  assert.deepEqual(saved.db.attendanceEditHistory[0].after,saved.db.attendance.find(row=>row.id==='edit-a'));
  await page.reload();
  await page.evaluate(()=>showPage('timesheet'));
  assert.equal((await snapshot()).raw,saved.raw);
  assert.deepEqual(await page.evaluate(()=>['history-a','history-b','edit-a'].map(id=>attendanceAmount(db.attendance.find(row=>row.id===id)))),[9000,6000,2250]);
 });

 await check('status switches use valid hours, preserve manual time and never rewrite stored shifts',async()=>{
  const before=await snapshot();
  await at('2027-01-02');
  await add('WeekView','a','2027-01-03').check();
  const setStatus=status=>form('status').selectOption(status);
  await setStatus('Отсутствовал');
  assert.equal(await form('hours').inputValue(),'0');
  assert.equal(await form('hours').isDisabled(),true);
  await setStatus('Смена');
  assert.equal(await form('hours').inputValue(),'8');
  await setStatus('Отсутствовал');
  await setStatus('Половина смены');
  assert.equal(await form('hours').inputValue(),'4');
  await setStatus('Отсутствовал');
  await setStatus('Часы');
  assert.equal(await form('hours').inputValue(),'');
  await form('hours').fill('0');
  assert.equal(await form('hours').evaluate(input=>input.validity.rangeUnderflow),true);
  await control('BatchPreview').click();
  assert.equal(await control('BatchReview').isVisible(),false);
  await form('hours').fill('3.5');
  await setStatus('Отсутствовал');
  await setStatus('Смена');
  assert.equal(await form('hours').inputValue(),'3.5');
  await setStatus('Отсутствовал');
  await setStatus('Половина смены');
  assert.equal(await form('hours').inputValue(),'3.5');
  await setStatus('Часы');
  await control('BatchPreview').click();
  assert.match(await control('BatchRows').textContent(),/3\.5 ч/);
  await control('BatchCancel').click();
  assert.deepEqual(await snapshot(),before);
  await control('Mode').selectOption('edit');
  await edit('edit-a').check();
  await form('changeStatus').check();
  await setStatus('Отсутствовал');
  await setStatus('Смена');
  assert.equal(await form('changeHours').isChecked(),true);
  assert.equal(await form('hours').inputValue(),'8');
  await setStatus('Отсутствовал');
  await setStatus('Половина смены');
  assert.equal(await form('hours').inputValue(),'4');
  await setStatus('Отсутствовал');
  await setStatus('Часы');
  assert.equal(await form('hours').inputValue(),'');
  await control('BatchCancel').click();
  assert.deepEqual(await snapshot(),before);
 });

 await check('second correction keeps the full journal across reload, export and repeated JSON restore',async()=>{
  await at('2027-01-02');
  await control('Mode').selectOption('edit');
  await edit('edit-a').check();
  await form('changeStatus').check();
  await form('status').selectOption('Смена');
  await form('reason').fill('Сверка полного дня');
  await control('BatchPreview').click();
  await control('BatchAck').check();
  await control('BatchSave').click();
  const history=(await snapshot()).db.attendanceEditHistory;
  assert.deepEqual(history.map(e=>[e.reason,e.accruedBeforeCents,e.accruedAfterCents]),[
   ['Уточнение по наряду',900000,225000],['Сверка полного дня',225000,900000]
  ]);
  assert.deepEqual(history[1].before,history[0].after);
  assert.equal(history[1].after.extra,'keep');
  await page.reload();
  await page.evaluate(()=>showPage('timesheet'));
  await control('EditHistory').locator('summary').first().click();
  assert.equal(await control('EditHistoryRows').locator('tbody tr').count(),2);
  assert.match(await control('EditHistoryRows').textContent(),/Уточнение по наряду.*Сверка полного дня/s);
  await page.locator('#backupToggle').click();
  const json=page.waitForEvent('download');
  await page.locator('#exportBtn').click();
  const exported=JSON.parse(fs.readFileSync(await (await json).path(),'utf8'));
  assert.equal(exported.version,3);
  assert.deepEqual(exported.attendanceEditHistory,history);
  for(const candidate of [data,exported,exported]){
   await page.locator('#importFile').setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(candidate))});
   await page.waitForFunction(()=>document.getElementById('importFile').value==='');
   assert.match(await page.locator('#backupStatus').textContent(),/Данные импортированы/);
   assert.deepEqual((await snapshot()).db.attendanceEditHistory,history);
  }
  assert.deepEqual((await snapshot()).db.financeHistory,original.db.financeHistory);
  assert.deepEqual((await snapshot()).db.payments,original.db.payments);
  assert.deepEqual(await page.evaluate(()=>['history-a','history-b'].map(id=>attendanceAmount(db.attendance.find(row=>row.id===id)))),[9000,6000]);
 });

 await check('weekly payout locks the linked week, prior mobile/desktop edits remain exportable',async()=>{
  await at('2027-01-05');
  await control('Mode').selectOption('edit');
  assert.equal(await edit('weekly-b').count(),0);
  assert.match(await control('WeekView').textContent(),/недельная выплата/);
  const excel=page.waitForEvent('download');
  await page.locator('#exportTimesheetExcel').click();
  assert.match((await excel).suggestedFilename(),/^tabel-.*\.xls$/);
  if(!await page.locator('#exportBtn').isVisible())await page.locator('#backupToggle').click();
  const json=page.waitForEvent('download');
  await page.locator('#exportBtn').click();
  const file=await (await json).path();
  const exported=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(exported.version,3);
  assert.deepEqual(exported.attendance,(await snapshot()).db.attendance);
  assert.deepEqual(exported.financeHistory,original.db.financeHistory);
 });

 await check('external write invalidates confirmation and keeps the draft',async()=>{
  const before=await snapshot();
  await control('Mode').selectOption('create');
  await add('WeekView','a','2027-01-05').check();
  await control('BatchPreview').click();
  const second=await context.newPage();
  await second.goto(url);
  await second.evaluate(key=>{
   const changed=JSON.parse(localStorage.getItem(key));
   changed.workers[0].rate=15000;
   localStorage.setItem(key,JSON.stringify(changed));
  },key);
  await page.waitForFunction(()=>document.getElementById('timesheetBatchStatus').textContent.includes('другой вкладке'));
  const foreign=await second.evaluate(key=>localStorage.getItem(key),key);
  await page.evaluate(()=>document.getElementById('timesheetBatchSave').click());
  assert.equal((await snapshot()).raw,foreign);
  assert.equal((await snapshot()).writes,before.writes);
  assert.match(await control('Selection').textContent(),/1/);
  await second.close();
 });

 await check('historical rows of deleted workers stay readable and the DataStore guard stays intact',async()=>{
  const legacyContext=await browser.newContext();
  const legacy=await legacyContext.newPage();
  try{
   await legacy.goto(url);
   await legacy.evaluate(({data,key,shift})=>localStorage.setItem(key,JSON.stringify({...data,attendance:[...data.attendance,shift]})),{
    data,key,shift:shift('missing','deleted','2027-01-02')
   });
   await legacy.reload();
   await legacy.evaluate(()=>showPage('timesheet'));
   await legacy.locator('#timesheetDate').fill('2027-01-02');
   await legacy.locator('#timesheetDate').dispatchEvent('change');
   const week=legacy.locator('#timesheetWeekView');
   assert.match(await week.textContent(),/Удалённый сотрудник \(deleted\)/);
   assert.equal(await week.locator('[data-worker="deleted"]').count(),0);
   const raw=await legacy.evaluate(key=>localStorage.getItem(key),key);
   await week.locator('[data-worker="a"][data-date="2027-01-02"]').check();
   await legacy.locator('#timesheetBatchPreview').click();
   await legacy.locator('#timesheetBatchSave').click();
   assert.match(await legacy.locator('#timesheetBatchStatus').textContent(),/не сохранены.*attendance\.workerId/);
   assert.equal(await legacy.evaluate(key=>localStorage.getItem(key),key),raw);
  }finally{await legacyContext.close();}
 });

 assert.deepEqual(errors,[]);
 console.log('Timesheet batch: '+passed+'/'+passed+' PASS');
})().catch(error=>{
 console.error(error);
 process.exitCode=1;
}).finally(async()=>{
 await browser?.close();
 server?.close();
});
