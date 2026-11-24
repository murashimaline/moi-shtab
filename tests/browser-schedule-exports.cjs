const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const out=path.resolve(process.env.BROWSER_OUTPUT||'.browser-results');
const start='2026-12-27',end='2026-12-30',date='2026-01-15';
const key='moiShtab_v03';
const data={
 version:3,objects:[{id:'site',name:'Тестовый объект'}],tasks:[],goals:[],
 workers:[{id:'worker',name:'Тестовый рабочий',rate:6000}],
 attendance:[{id:'shift',workerId:'worker',objectId:'site',date,status:'Смена',shifts:1,ratePerShift:6000}],
 payments:[],
 expenses:[{id:'expense',objectId:'site',date,amount:1234.5,category:'Материалы',paymentSource:'accountable',notes:'Тестовый расход'},
  {id:'archive',objectId:'site',date:'2025-10-05',amount:2,category:'Материалы',receipts:[{id:'doc',name:'Синтетический файл',data:'data:application/pdf;base64,JVBERi0xLjQK'}]}],
 warehouse:[{id:'tool',objectId:'site',name:'Тестовый инструмент',baseQty:5,unit:'шт.'}],
 warehouseMovements:[{id:'issue',itemId:'tool',date,kind:'issue',qty:2}],
 works:[{id:'work',date,objectId:'site',photos:['data:image/png;base64,AA==']}],
 financeHistory:[{at:'2026-01-15',collection:'expenses',id:'expense',action:'create',before:'null',after:'{"amount":1234.5}'}],
 schedule:[
  {id:'phase',objectId:'site',title:'Фундамент',start,end,status:'Запланировано',assignee:'Мастер',
   substeps:[
    {id:'a',title:'Армирование',start,end,status:'В работе',notes:'Проверить крепления'},
    {id:'b',title:'Армирование',start:'2026-12-28',end:'2027-01-03',status:'В работе'}
   ]},
  {id:'late',objectId:'site',title:'Земляные работы / разработка котлована и вывоз грунта',start,end,status:'Выполнено',assignee:'Бригадир'},
  {id:'day',objectId:'site',title:'Приёмка арматуры',start:'2026-12-29',end:'2026-12-29',status:'Запланировано'},
  {id:'delay',objectId:'site',title:'Подготовка основания',start:'2027-01-01',end:'2027-01-05',status:'Задержка'},
  {id:'unknown',objectId:'site',title:'Проверка отметок',start:'2027-01-03',end:'2027-01-04'},
  {id:'outside',objectId:'site',title:'Монтаж опалубки',start:'2027-02-01',end:'2027-02-02',status:'Запланировано'}
 ]
};
let server,browser;

(async()=>{
 fs.mkdirSync(out,{recursive:true});
 server=http.createServer((req,res)=>{
  const file=req.url==='/'?'index.html':req.url.slice(1);
  if(!['index.html','storage.js'].includes(file))return res.writeHead(404).end();
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join(root,file)));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
 const context=await browser.newContext({acceptDownloads:true});
 async function seed(ctx,fixture){
  await ctx.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  await ctx.addInitScript(({key,fixture})=>{
   localStorage.setItem(key,JSON.stringify(fixture,null,2));
   localStorage.setItem(key+'_before_import','Предимпортная копия');
  },{key,fixture});

 }
 await seed(context,data);
 const page=await context.newPage(),errors=[],dialogs=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',dialog=>{dialogs.push(dialog.message());return dialog.dismiss()});
 await page.clock.setFixedTime(new Date("2027-01-01T12:00:00Z"));
 await page.goto(origin);
 const snapshot=(target=page)=>target.evaluate(key=>[
  localStorage.getItem(key),localStorage.getItem(key+'_before_import'),JSON.stringify(db),
  persistence.status(),persistence.readSnapshot()
 ],key);
 const before=await snapshot();
 async function download(pageName,button,name,target=page){
  await target.evaluate(pageName=>showPage(pageName),pageName);
  const control=target.locator('#'+button);
  const [file]=await Promise.all([target.waitForEvent('download'),target===page?control.click():control.tap()]);
  await file.saveAs(path.join(out,name));
 }
 await page.evaluate(()=>setActiveObject('site'));
 assert.equal(await page.evaluate(()=>activeObjectId),'site');
 await page.locator('#scheduleViewStart').evaluate((el,value)=>el.value=value,start);
 await page.locator('#scheduleViewDays').evaluate(el=>el.value='60');
 await context.setOffline(true);
 await download('schedule','exportScheduleExcel','d01-schedule.xlsx');
 await context.setOffline(false);
 for(const [name,schedule] of [['empty',[]],['mobile',[data.schedule[2]]]]){
  const mobile=await browser.newContext({acceptDownloads:true,viewport:{width:393,height:852},isMobile:true,hasTouch:true});
  await seed(mobile,{...data,schedule});
  const target=await mobile.newPage();
  target.on('pageerror',error=>errors.push(error.message));
  target.on('dialog',dialog=>{dialogs.push(dialog.message());return dialog.dismiss()});
  await target.clock.setFixedTime(new Date('2027-01-01T12:00:00Z'));
  await target.goto(origin);
  await target.evaluate(()=>setActiveObject('site'));
  await target.locator('#scheduleViewStart').evaluate((el,value)=>el.value=value,start);
  const original=await snapshot(target);
  await mobile.setOffline(true);
  await download('schedule','exportScheduleExcel',`vg01-${name}.xlsx`,target);
  assert.deepEqual(await snapshot(target),original);
  await mobile.close();
  console.log(`VG01: ${name} workbook downloaded offline on a mobile viewport: PASS`);
 }
 await page.evaluate(()=>{
  document.getElementById('expenseFrom').value='2026-01-01';
  document.getElementById('expenseTo').value='2026-01-31';
  document.getElementById('advanceMonth').value='2026-01';
 });
 await download('finance','exportExpensesExcel','d01-expenses.xlsx');
 await download('finance','exportMissingExpenses','d01-missing-expenses.xlsx');
 await download('finance','exportAdvanceMissing','d01-advance-missing.xlsx');
 await download('warehouse','exportWarehouseExcel','d01-warehouse.xls');
 await download('timesheet','exportTimesheetExcel','d01-timesheet.xls');
 assert.deepEqual(await snapshot(),before);
 assert.deepEqual(errors,[]);
 assert.deepEqual(dialogs,[]);
 console.log('VG01: desktop XLSX and five export regressions, storage unchanged: PASS');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{
 if(browser)await browser.close();
 if(server)server.close();
});
