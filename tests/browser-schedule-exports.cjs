const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const out=path.resolve(process.env.BROWSER_OUTPUT||'.browser-results');
const start='2099-11-01',end='2099-11-03',date='2026-01-15';
const key='moiShtab_v03';
const data={
 version:3,objects:[{id:'site',name:'Тестовый объект'}],tasks:[],works:[],goals:[],
 workers:[{id:'worker',name:'Тестовый рабочий',rate:6000}],
 attendance:[{id:'shift',workerId:'worker',objectId:'site',date,status:'Смена',shifts:1,ratePerShift:6000}],
 payments:[],
 expenses:[{id:'expense',objectId:'site',date,amount:1234.5,category:'Материалы',paymentSource:'accountable',notes:'Тестовый расход'}],
 warehouse:[{id:'tool',objectId:'site',name:'Тестовый инструмент',baseQty:5,unit:'шт.'}],
 warehouseMovements:[{id:'issue',itemId:'tool',date,kind:'issue',qty:2}],
 schedule:[
  {id:'phase',objectId:'site',title:'Тестовый этап',start,end,status:'Задержка',
   substeps:[{title:'Тестовая стадия',start,end,status:'Выполнено'}]},
  {id:'planned',objectId:'site',title:'Будущий этап',start,end,status:'Запланировано'}
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
 await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 await context.addInitScript(({key,data})=>localStorage.setItem(key,JSON.stringify(data)),{key,data});
 const page=await context.newPage(),errors=[],dialogs=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',dialog=>{dialogs.push(dialog.message());return dialog.dismiss()});
 await page.goto(origin);
 const snapshot=()=>page.evaluate(key=>[localStorage.getItem(key),localStorage.getItem(key+'_before_import'),JSON.stringify(db)],key);
 const before=await snapshot();
 async function download(pageName,button,name){
  await page.evaluate(pageName=>showPage(pageName),pageName);
  const [file]=await Promise.all([page.waitForEvent('download'),page.locator('#'+button).click()]);
  await file.saveAs(path.join(out,name));
 }
 await page.evaluate(()=>setActiveObject('site'));
 await page.locator('#scheduleViewStart').evaluate((el,value)=>el.value=value,start);
 await page.locator('#scheduleViewDays').evaluate(el=>el.value='14');
 await download('schedule','exportScheduleExcel','d01-schedule.xlsx');
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
 console.log('D01: six downloads from the browser, storage unchanged: PASS');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{
 if(browser)await browser.close();
 if(server)server.close();
});
