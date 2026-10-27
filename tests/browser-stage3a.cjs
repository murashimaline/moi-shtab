// Isolated synthetic browser profile; no production requests or user storage.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
let browser,server;
(async()=>{
 server=http.createServer((req,res)=>{const file=req.url==='/'?'index.html':req.url.slice(1);if(!['index.html','storage.js'].includes(file))return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(path.join(__dirname,'..',file)))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});const ctx=await browser.newContext({acceptDownloads:true});await ctx.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());const p=await ctx.newPage(),errors=[],dialogs=[];p.on('pageerror',e=>errors.push(e.message));p.on('dialog',async d=>{dialogs.push(d.message());await d.accept()});await p.goto(origin);
 await p.evaluate(()=>{db={...blank(),objects:[{id:'o',name:'A'},{id:'o2',name:'A'}],workers:[{id:'w',name:'TEST worker',rate:6000}],attendance:[{id:'a',workerId:'w',objectId:'o2',date:'2026-01-10',shifts:1,ratePerShift:6000}],works:[{id:'work',date:'2026-01-10',objectId:'o2',title:'TEST',workersCount:'',workerIds:['w']}],income:[{id:'inc1',date:'2026-01-10',objectId:'o',amount:100},{id:'inc2',date:'2026-01-10',objectId:'o2',amount:200}]};if(!save())throw Error('fixture rejected')});
 const raw=await p.evaluate(()=>localStorage.getItem(KEY));await p.evaluate(()=>removeItem('workers','w'));assert.equal(await p.evaluate(()=>localStorage.getItem(KEY)),raw);assert.equal(await p.evaluate(()=>db.workers.length),1);assert.match(dialogs.at(-1),/связанных/);await p.reload();assert.equal(await p.evaluate(()=>ProrabkaStorage.validate(JSON.parse(localStorage.getItem(KEY))).attendance.length),1);console.log('R1 actual deletion rollback, reload and strict backup validation PASS');
 await p.evaluate(()=>{showPage('payroll');document.getElementById('payFrom').value='2026-02-01';document.getElementById('payTo').value='2026-01-01'});await p.locator('#refreshPayroll').click();assert.match(await p.locator('#payrollList').innerText(),/Начало/);let downloads=0;p.on('download',()=>downloads++);await p.locator('#exportPayrollExcel').click();assert.match(dialogs.at(-1),/Начало/);assert.equal(downloads,0);console.log('R7 actual payroll UI and Excel reject reversed range PASS');
 await p.evaluate(()=>{showPage('finance');document.getElementById('financeFrom').value='2026-01-01';document.getElementById('financeTo').value='2026-01-31';document.getElementById('financeObject').value='o2'});await p.locator('#refreshFinance').click();const rows=p.locator('#financeByObjects tbody tr');assert.equal(await rows.count(),1);assert.match(await rows.first().innerText(),/200,00/);const download=p.waitForEvent('download');await p.locator('#exportFinanceExcel').click();const file=await(await download).path();const xml=fs.readFileSync(file,'utf8');assert.match(xml,/>200</);console.log('R8 duplicate object names selected by ID, table and actual Excel PASS');
 await p.evaluate(()=>{showPage('report');document.getElementById('reportDate').value='2026-01-10';document.getElementById('reportObject').value='o2'});await p.locator('#makeReport').click();assert.match(await p.locator('#reportText').innerText(),/Количество рабочих: 1/);assert.equal(await p.evaluate(()=>localStorage.getItem(KEY)),raw);console.log('daily report selected workers and timesheet count agree without data mutation PASS');

 // B0-03: use real import/download handlers and an isolated confirmed dataset.
 const beforeImport=await p.evaluate(()=>localStorage.getItem(KEY));
 const imported=await p.evaluate(()=>{const next=persistence.readSnapshot();next.objects[0].name='B0-03 import';return next});
 await p.locator('#importFile').setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(imported))});
 await p.waitForFunction(()=>db.objects[0].name==='B0-03 import');
 assert.equal(await p.evaluate(()=>persistence.readPreviousBackup()),beforeImport);
 assert.equal(await p.evaluate(()=>persistence.capabilities().crossTabCompareAndSwap),false);
 const copyDownload=p.waitForEvent('download');await p.evaluate(()=>previousBackupButton.click());
 assert.equal(fs.readFileSync(await(await copyDownload).path(),'utf8'),beforeImport);
 const savedAfterImport=await p.evaluate(()=>localStorage.getItem(KEY));
 await p.locator('#importFile').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{broken')});
 await p.waitForFunction(()=>document.getElementById('importFile').value==='');
 assert.equal(await p.evaluate(()=>localStorage.getItem(KEY)),savedAfterImport);
 await p.reload();assert.equal(await p.evaluate(()=>db.objects[0].name),'B0-03 import');
 assert.equal(await p.evaluate(()=>{const snap=persistence.readSnapshot();snap.objects[0].name='outside';return persistence.readSnapshot().objects[0].name}),'B0-03 import');
 console.log('B0-03 DataStore snapshots, real JSON import, exact previous backup download and malformed import rollback PASS');

 assert.deepEqual(errors,[]);await browser.close();server.close();
})().catch(async e=>{console.error(e);if(browser)await browser.close();if(server)server.close();process.exitCode=1});
