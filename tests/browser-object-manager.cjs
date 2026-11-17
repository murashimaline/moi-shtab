const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const root=path.join(__dirname,'..');
const key='moiShtab_v03';
const legacy={id:'old',name:'Первый объект',manager:'  Иванов Иван  ',extra:'оставить'};
const fixture={
 version:3,objects:[legacy],workers:[
  {id:'w1',name:'Иванов Иван',trade:'Мастер',rate:9000},
  {id:'w2',name:'Иванов Иван',trade:'Плотник',rate:6000}
 ],tasks:[],works:[],goals:[],attendance:[],payments:[],expenses:[]
};
const broken=[{...legacy,managerId:'missing'},{id:'second',name:'Второй объект',managerId:'former'}];
const jsonFile=bytes=>({name:'source.json',mimeType:'application/json',buffer:Buffer.from(bytes)});
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
 async function scenario(name,data,run,mobile=false){
  const context=await browser.newContext({viewport:{width:mobile?390:1440,height:900},hasTouch:mobile,acceptDownloads:true});
  try{
   await context.addInitScript(({key,raw})=>{
    if(localStorage.getItem(key)===null){
     localStorage.setItem(key,raw);
     localStorage.setItem(key+'_before_import','previous backup');
    }
    const set=Storage.prototype.setItem;
    window.primaryWrites=0;
    Storage.prototype.setItem=function(name,value){
     if(name===key){
      if(window.failWrite)throw Error('Synthetic quota failure');
      window.primaryWrites++;
     }
     return set.call(this,name,value);
    };
   },{key,raw:typeof data==='string'?data:JSON.stringify(data)});
   const page=await context.newPage(),dialogs=[],errors=[];
   page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.accept()});
   page.on('pageerror',error=>errors.push(error.message));
   await page.goto(url);
   await page.evaluate(()=>showPage('objects'));
   const snapshot=()=>page.evaluate(key=>({
    raw:localStorage.getItem(key),backup:localStorage.getItem(key+'_before_import'),
    model:db,confirmed:persistence.readSnapshot(),writes:window.primaryWrites
   }),key);
   await run(page,snapshot,dialogs,context);
   assert.deepEqual(errors,[]);
   passed++;
   console.log(name+' PASS');
  }finally{await context.close();}
 }
 const edit=page=>page.locator('#objectList').getByRole('button',{name:'Изменить'}).first().click();
 const submit=page=>page.getByRole('button',{name:'Сохранить объект'}).click();
 const picker=page=>page.locator('#objectManagerPicker');
 const search=page=>page.locator('#objectManagerSearch');
 const choose=async(page,id)=>{
  await search(page).fill('иВаНоВ');
  assert.deepEqual(await picker(page).locator('option').allTextContents(),[
   'Выберите сотрудника','Иванов Иван · Мастер · w1','Иванов Иван · Плотник · w2'
  ]);
  await picker(page).selectOption(id);
 };
 const restore=async(page,raw)=>{
  await page.locator('#importFile').setInputFiles(jsonFile(raw));
  await page.waitForFunction(()=>document.getElementById('importFile').value==='');
 };
 const download=async(page,button)=>{
  const waiting=page.waitForEvent('download');
  await page.locator(button).click();
  return fs.readFileSync(await (await waiting).path());
 };
 for(const mobile of [false,true]){
  await scenario((mobile?'Mobile':'Desktop')+' legacy, explicit selection, clear and reset',fixture,async(page,snapshot)=>{
   await edit(page);
   assert.match(await page.locator('#objectManagerSelection').textContent(),/Старая запись/);
   await search(page).fill('Иванов');
   await page.locator('#objectForm [name=address]').fill('Новый адрес');
   await submit(page);
   let object=(await snapshot()).model.objects[0];
   assert.equal(Object.hasOwn(object,'managerId'),false);
   assert.equal(object.manager,legacy.manager);
   assert.equal(object.extra,legacy.extra);
   await edit(page);
   if(mobile){
    await search(page).tap();
    await choose(page,'w2');
   }else{
    await search(page).fill('Иванов');
    await picker(page).focus();
    await picker(page).press('End');
    await picker(page).press('Enter');
   }
   await search(page).fill('не найден');
   await search(page).clear();
   await submit(page);
   object=(await snapshot()).model.objects[0];
   assert.equal(object.managerId,'w2');
   assert.equal(object.manager,legacy.manager);
   await edit(page);
   await choose(page,'w1');
   await page.locator('#objectForm').getByRole('button',{name:'Очистить'}).click();
   assert.equal(await page.locator('#objectManagerSelection').textContent(),'Не назначен');
   await edit(page);
   await page.locator('#objectManagerClear').click();
   await submit(page);
   await page.reload();
   await page.evaluate(()=>showPage('objects'));
   assert.match(await page.locator('#objectList').textContent(),/Не назначен/);
   const saved=(await snapshot()).model.objects[0];
   assert.equal(saved.managerId,null);
   assert.equal(saved.manager,legacy.manager);
  },mobile);
 }
 await scenario('Rename, protected deletion, new snapshot and JSON v3 round trip',fixture,async(page,snapshot,dialogs)=>{
  await page.locator('#objectForm [name=name]').fill('Новый объект');
  await choose(page,'w2');
  await submit(page);
  const created=(await snapshot()).model.objects[1];
  assert.equal(created.manager,'Иванов Иван');
  assert.equal(created.managerId,'w2');
  await page.evaluate(()=>{showPage('workers');editItem('workers','w2','workerForm')});
  await page.locator('#workerForm [name=name]').fill('Иванов Пётр');
  await page.locator('#workerForm button').first().click();
  const before=await snapshot();
  await page.locator('#workerList tbody tr').nth(1).getByRole('button',{name:'Удалить'}).click();
  assert.match(dialogs.at(-1),/Новый объект/);
  assert.deepEqual(await snapshot(),before);
  await page.evaluate(()=>showPage('objects'));
  assert.match(await page.locator('#objectList').textContent(),/Иванов Пётр/);
  assert.deepEqual((await snapshot()).model.objects[1],created);
  await page.locator('#objectList tbody tr').nth(1).getByRole('button',{name:'Изменить'}).click();
  await page.locator('#objectManagerClear').click();
  await submit(page);
  await page.locator('#backupToggle').click();
  const raw=await download(page,'#exportBtn');
  assert.equal(JSON.parse(raw).objects[1].managerId,null);
  await restore(page,JSON.stringify(fixture));
  assert.deepEqual((await snapshot()).model.objects,[legacy]);
  await restore(page,raw);
  assert.equal((await snapshot()).model.objects[1].managerId,null);
  const saved=await snapshot();
  await restore(page,JSON.stringify({...fixture,objects:broken}));
  assert.match(dialogs.at(-1),/managerId.*Первый объект.*missing/);
  assert.deepEqual(await snapshot(),saved);
 });
 async function confirmRepair(page,raw){
  await page.locator('#managerRepairStart').click();
  const rows=page.locator('#managerRepairRows select');
  await rows.nth(0).selectOption('w1');
  await rows.nth(1).selectOption('@clear');
  assert.equal(await page.locator('#managerRepairApply').isDisabled(),true);
  await page.locator('#managerRepairFile').setInputFiles(jsonFile('{}'));
  await page.waitForFunction(()=>document.getElementById('managerRepairStatus').textContent.includes('не совпадает'));
  assert.equal(await page.locator('#managerRepairApply').isDisabled(),true);
  const backup=await download(page,'#managerRepairDownload');
  assert.equal(backup.toString('utf8'),raw);
  await page.locator('#managerRepairFile').setInputFiles(jsonFile(backup));
  await page.waitForFunction(()=>!document.getElementById('managerRepairApply').disabled);
 }
 const unicodeSource=JSON.stringify({
  ...fixture,objects:[{...broken[0],notes:'Отметка: SYMBOL'}],
  financeHistory:[{at:'2026-01-01',collection:'payments',id:'previous',action:'create',before:'null',after:'{"amount":50}'}]
 });
 for(const unit of [0xD800,0xDC00]){
  const raw=unicodeSource.replace('SYMBOL',String.fromCharCode(unit));
  await scenario('Rejects UTF-8 replacement for lone U+'+unit.toString(16).toUpperCase(),raw,async(page,snapshot)=>{
   const before=await snapshot();
   assert.ok(before.raw.includes(String.fromCharCode(unit)));
   assert.equal(before.model.financeHistory.length,1);
   assert.deepEqual(before.model, before.confirmed);
   await page.locator('#managerRepairStart').click();
   await page.locator('#managerRepairRows select').selectOption('@clear');
   await page.locator('#managerRepairDownload').click();
   const status=page.locator('#managerRepairStatus');
   assert.match(await status.textContent(),/непарный UTF-16/);
   await page.locator('#managerRepairCancel').click();
   await page.locator('#managerRepairStart').click();
   await page.locator('#managerRepairRows select').selectOption('@clear');
   const lossy=raw.replace(String.fromCharCode(unit),'\uFFFD');
   assert.notEqual(lossy,raw);
   await page.locator('#managerRepairFile').setInputFiles(jsonFile(lossy));
   await page.waitForFunction(()=>/UTF-16|Файл совпадает/.test(document.getElementById('managerRepairStatus').textContent));
   assert.match(await status.textContent(),/непарный UTF-16/);
   assert.doesNotMatch(await status.textContent(),/Файл совпадает/);
   const apply=page.locator('#managerRepairApply');
   assert.equal(await apply.isDisabled(),true);
   await apply.evaluate(button=>button.click());
   assert.deepEqual(await snapshot(),before);
  });
 }
 for(const symbols of ['Русский текст','Проверено 🧱']){
  const raw=unicodeSource.replace('SYMBOL',symbols);
  await scenario('Confirms an exact UTF-8 copy of '+symbols,raw,async(page,snapshot)=>{
   const before=await snapshot();
   await page.locator('#managerRepairStart').click();
   await page.locator('#managerRepairRows select').selectOption('@clear');
   const backup=await download(page,'#managerRepairDownload');
   assert.deepEqual(backup,Buffer.from(raw,'utf8'));
   await page.locator('#managerRepairFile').setInputFiles(jsonFile(Buffer.from(raw+' ','utf8')));
   await page.waitForFunction(()=>document.getElementById('managerRepairStatus').textContent.includes('не совпадает'));
   assert.equal(await page.locator('#managerRepairApply').isDisabled(),true);
   assert.deepEqual(await snapshot(),before);
   await page.locator('#managerRepairFile').setInputFiles(jsonFile(backup));
   await page.waitForFunction(()=>!document.getElementById('managerRepairApply').disabled);
   assert.match(await page.locator('#managerRepairStatus').textContent(),/Файл совпадает/);
   assert.deepEqual(await snapshot(),before);
   await page.locator('#managerRepairApply').click();
   const after=await snapshot();
   assert.equal(after.writes,before.writes+1);
   assert.deepEqual(after.model.objects,[{...before.model.objects[0],managerId:null}]);
   assert.deepEqual(after.model.financeHistory,before.model.financeHistory);
   assert.equal(after.backup,before.backup);
  });
 }
 await scenario('Two repairs use one confirmed source copy and roll back on quota failure',{...fixture,objects:broken},async(page,snapshot)=>{
  const before=await snapshot();
  assert.match(await page.locator('#objectList').textContent(),/Ответственный недоступен \(missing\)/);
  await edit(page);
  assert.equal(await picker(page).isDisabled(),true);
  assert.equal(await page.locator('#objectManagerClear').isDisabled(),true);
  await confirmRepair(page,before.raw);
  await page.evaluate(()=>{window.failWrite=true});
  await page.locator('#managerRepairApply').click();
  assert.match(await page.locator('#managerRepairStatus').textContent(),/не сохранены.*Synthetic quota failure/);
  assert.deepEqual(await snapshot(),before);
  assert.deepEqual(await page.locator('#managerRepairRows select').evaluateAll(rows=>rows.map(row=>row.value)),['w1','@clear']);
  await page.evaluate(()=>{window.failWrite=false});
  await page.locator('#managerRepairApply').click();
  const after=await snapshot();
  assert.equal(after.writes,1);
  assert.equal(after.backup,before.backup);
  assert.deepEqual(after.model.objects,[{...broken[0],managerId:'w1'},{...broken[1],managerId:null}]);
  assert.deepEqual(after.model,after.confirmed);
  assert.match(await page.locator('#managerRepairResult').textContent(),/Исправлено назначений: 2/);
  await page.reload();
  assert.equal((await snapshot()).raw,after.raw);
 });
 await scenario('Repair keeps other broken references blocked',{...fixture,objects:broken,tasks:[{id:'task',title:'Проверка',objectId:'unrelated'}]},async(page,snapshot)=>{
  const before=await snapshot();
  await confirmRepair(page,before.raw);
  await page.locator('#managerRepairApply').click();
  assert.match(await page.locator('#managerRepairStatus').textContent(),/tasks.objectId/);
  assert.deepEqual(await snapshot(),before);
 });
 await scenario('Object form keeps draft after quota failure and rejects a stale tab',fixture,async(page,snapshot,dialogs,context)=>{
  const before=await snapshot();
  await edit(page);
  await choose(page,'w2');
  await page.evaluate(()=>{window.failWrite=true});
  await submit(page);
  assert.deepEqual(await snapshot(),before);
  assert.equal(await page.locator('#objectForm [name=managerChoice]').inputValue(),'w2');
  await page.evaluate(()=>{window.failWrite=false});
  const second=await context.newPage();
  await second.goto(url);
  await second.evaluate(()=>{db.objects[0].address='Другая вкладка';save()});
  await page.waitForFunction(()=>persistence.status().conflict);
  const otherRaw=await second.evaluate(key=>localStorage.getItem(key),key);
  await submit(page);
  assert.match(dialogs.at(-1),/другой вкладке/);
  const after=await snapshot();
  assert.equal(after.raw,otherRaw);
  assert.deepEqual(after.model,before.model);
  assert.equal(await page.locator('#objectForm [name=managerChoice]').inputValue(),'w2');
 });
 console.log('Object manager: '+passed+'/'+passed+' PASS');
})().catch(error=>{
 console.error(error);
 process.exitCode=1;
}).finally(async()=>{
 await browser?.close();
 server?.close();
});
