const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const storage=require('../storage.js'),repo=path.join(__dirname,'..'),key='moiShtab_v03';
const output=process.env.BROWSER_OUTPUT||path.join(repo,'.browser-results');fs.mkdirSync(output,{recursive:true});
const stage=(extra={})=>({title:'Одинаковая стадия',start:'2026-11-01',end:'2026-12-05',assignee:'Бригада',status:'В работе',notes:'  исходное примечание  ',...extra});
function fixture(){return {version:3,objects:[{id:'o1',name:'Объект 1'},{id:'o2',name:'Объект 2'}],workers:[],tasks:[],works:[],goals:[],attendance:[],payments:[],expenses:[],income:[],accountable:[],warehouse:[],warehouseMovements:[],financeHistory:[{at:'2026-11-01T00:00:00Z',collection:'income',id:'old',action:'create',before:'null',after:'{}'},{at:'2026-11-01T00:00:00Z',collection:'income',id:'old',action:'create',before:'null',after:'{}'}],schedule:[{id:'legacy_plan',title:'Строительные работы',objectId:'o1',start:'2026-11-01',end:'2026-12-05',assignee:'Прораб',status:'В работе',notes:'Примечание этапа',actualStart:'2026-11-02',actualEnd:'',progress:12.5,extension:{nested:[1,null,{text:'Русский 🏗',flag:false}]},substeps:[stage({id:'historic_stage',objectId:'o2',actualStart:'2026-11-03',actualEnd:'',progress:2.5,extension:{nested:['A',null]}}),stage({extension:{key:'legacy-one'}}),stage({extension:{key:'legacy-two'},notes:'Не трогать'})]}]};}
const copy=value=>JSON.parse(JSON.stringify(value));
const snapshot=page=>page.evaluate(key=>({raw:localStorage.getItem(key),backup:localStorage.getItem(key+'_before_import'),confirmed:persistence.readSnapshot(),memory:JSON.parse(JSON.stringify(db))}),key);
const edit=page=>page.evaluate(()=>{if(!activeObjectId)setActiveObject('o1');showPage('schedule');editItem('schedule','legacy_plan','scheduleForm')});
const submit=page=>page.evaluate(()=>document.getElementById('scheduleForm').requestSubmit());
const patch=async(page,selector,value)=>page.locator(selector).fill(value);
let server,browser,passed=0;
(async()=>{
 server=http.createServer((req,res)=>{const file=req.url==='/'?'index.html':req.url.slice(1);if(!['index.html','storage.js'].includes(file))return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8');res.end(fs.readFileSync(path.join(repo,file)))});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
 async function scenario(name,run,data=fixture()){
  const context=await browser.newContext({acceptDownloads:true});
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await context.addInitScript(({key,data})=>{if(localStorage.getItem(key)===null){localStorage.setItem(key,JSON.stringify(data));localStorage.setItem(key+'_before_import','untouched preimport copy')}},{key,data});
  const page=await context.newPage(),dialogs=[],errors=[];page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.accept()});page.on('pageerror',error=>errors.push(error.message));
  try{await page.goto(origin);assert.equal(await page.evaluate(()=>persistence.status().blocked),false);await run(page,dialogs,data);assert.deepEqual(errors,[]);passed++;console.log(name+' PASS');}finally{await context.close()}
 }
 async function verify(page,expected,before){
  const current=await snapshot(page);assert.deepEqual(current.confirmed.schedule,expected);assert.deepEqual(JSON.parse(current.raw).schedule,expected);assert.deepEqual(current.memory.schedule,expected);assert.equal(current.backup,before.backup);
  for(const collection of Object.keys(before.confirmed).filter(k=>!['schedule','_revision'].includes(k)))assert.deepEqual(current.confirmed[collection],before.confirmed[collection],collection+' unchanged');
  return current;
 }
 await scenario('SH01 01 read-only screen and editor do not write or add legacy IDs',async page=>{
  const before=await snapshot(page);await edit(page);await page.evaluate(()=>{renderSchedule();showPage('objects');showPage('schedule')});assert.deepEqual(await snapshot(page),before);assert.equal(await page.locator('.substep-editor').count(),3);
 });
 await scenario('SH01 02 real UI note save preserves every parent/stage field, raw JSON and reload',async(page,dialogs,data)=>{
  const before=await snapshot(page),expected=copy(data.schedule);expected[0].notes='Исправленное примечание';await edit(page);await patch(page,'#scheduleForm [name=notes]',expected[0].notes);await submit(page);assert.deepEqual(dialogs,[]);await verify(page,expected,before);await page.reload();await verify(page,expected,before);await edit(page);
  await page.screenshot({path:path.join(output,'schedule-preservation-editor.png'),fullPage:true});
  const exported=page.waitForEvent('download');await page.evaluate(()=>document.getElementById('exportBtn').click());const download=await exported;const target=path.join(output,'schedule-preservation.json');await download.saveAs(target);const json=JSON.parse(fs.readFileSync(target,'utf8'));assert.deepEqual(json.schedule,expected);assert.deepEqual(storage.validate(json).schedule,expected);await verify(page,expected,before);
 });
 await scenario('SH01 03 all editable parent fields apply; explicit object selection retained',async(page,dialogs,data)=>{
  const before=await snapshot(page);await edit(page);const changes={title:'Новое название',start:'2026-11-04',end:'2026-12-10',status:'Задержка',assignee:'Новая бригада',notes:'Новое примечание',objectId:'o2'};
  await page.evaluate(changes=>{setActiveObject('');const form=document.getElementById('scheduleForm');for(const [key,value]of Object.entries(changes))form.elements[key].value=value},changes);await submit(page);assert.deepEqual(dialogs,[]);await verify(page,[{...data.schedule[0],...changes}],before);
 });
 await scenario('SH01 04 stage token mapping survives same titles, reorder, edit, delete, add and reopen',async(page,dialogs,data)=>{
  const before=await snapshot(page);await edit(page);
  await page.evaluate(()=>{const editor=document.getElementById('substepsEditor'),rows=editor.children;editor.prepend(rows[2]);editor.children[2].querySelector('.substep-remove').click();editor.children[0].querySelector('.sub-notes').value='Изменена третья';document.getElementById('addSubstep').click();const row=editor.lastElementChild;row.querySelector('.sub-title').value='Новая стадия';row.querySelector('.sub-start').value='2026-11-10';row.querySelector('.sub-end').value='2026-12-02'});
  const newId=await page.locator('.substep-editor').last().getAttribute('data-subid');assert.match(newId,/^[a-f0-9-]{32,36}$/i);await submit(page);assert.deepEqual(dialogs,[]);
  const expected=[{...data.schedule[0],substeps:[{...data.schedule[0].substeps[2],notes:'Изменена третья'},data.schedule[0].substeps[0],{id:newId,title:'Новая стадия',start:'2026-11-10',end:'2026-12-02',assignee:'',status:'Запланировано',notes:''}]}];
  await verify(page,expected,before);await edit(page);await submit(page);await verify(page,expected,before);
 });
 for(const ids of [['duplicate','duplicate'],['bad/id','unique'],['','unique']]){
  const data=fixture();data.schedule[0].substeps=data.schedule[0].substeps.slice(0,2).map((row,i)=>({...row,id:ids[i]}));
  await scenario('SH01 05 ambiguous/damaged stage IDs refuse '+JSON.stringify(ids),async(page,dialogs)=>{
   const before=await snapshot(page);await edit(page);await patch(page,'#scheduleForm [name=notes]','Не сохранять');await submit(page);assert.match(dialogs.at(-1),/ID стадий/);assert.deepEqual(await snapshot(page),before);
  },data);
 }
 await scenario('SH01 06 substituted DOM row and tampered identity refuse without writes',async(page,dialogs)=>{
  const before=await snapshot(page);await edit(page);await page.evaluate(()=>{const row=document.querySelector('.substep-editor');row.dataset.subid='fake'});await submit(page);assert.match(dialogs.at(-1),/ID стадии/);assert.deepEqual(await snapshot(page),before);
  await edit(page);await page.evaluate(()=>{const row=document.querySelector('.substep-editor');row.replaceWith(row.cloneNode(true))});await submit(page);assert.match(dialogs.at(-1),/сопоставить строку/);assert.deepEqual(await snapshot(page),before);
 });
 await scenario('SH01 07 invalid parent and stage dates are rejected',async(page,dialogs)=>{
  const before=await snapshot(page);await edit(page);await patch(page,'#scheduleForm [name=end]','2026-10-01');await submit(page);assert.match(dialogs.at(-1),/раньше начала/);assert.deepEqual(await snapshot(page),before);
  await edit(page);await patch(page,'.sub-end >> nth=0','2026-10-01');await submit(page);assert.match(dialogs.at(-1),/сроки каждой стадии/);assert.deepEqual(await snapshot(page),before);
 });
 for(const removed of [false,true])await scenario('SH01 08 stale or deleted parent refuses '+removed,async(page,dialogs)=>{
  await edit(page);await page.evaluate(removed=>{if(removed)db.schedule=[];else db.schedule[0].notes='changed outside editor'},removed);const before=await snapshot(page);await patch(page,'#scheduleForm [name=notes]','do not save');await submit(page);assert.match(dialogs.at(-1),/отсутствует или изменилась/);assert.deepEqual(await snapshot(page),before);
 });
 await scenario('SH01 09 disk conflict retains external raw and rolls back memory',async(page,dialogs)=>{
  const before=await snapshot(page);await edit(page);await page.evaluate(key=>{const external=JSON.parse(localStorage.getItem(key));external.schedule[0].notes='external';localStorage.setItem(key,JSON.stringify(external))},key);const external=(await snapshot(page)).raw;
  await patch(page,'#scheduleForm [name=notes]','do not save');await submit(page);assert.match(dialogs.at(-1),/не сохранены/);const after=await snapshot(page);assert.equal(after.raw,external);assert.deepEqual(after.confirmed,before.confirmed);assert.deepEqual(after.memory,before.memory);assert.equal(after.backup,before.backup);
 });
 await scenario('SH01 10 write failure keeps raw, confirmed memory, draft and preimport backup',async(page,dialogs)=>{
  const before=await snapshot(page);await edit(page);await patch(page,'#scheduleForm [name=notes]','draft retained');await page.evaluate(key=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key)throw Error('synthetic quota failure');return original.call(this,k,v)}},key);await submit(page);assert.match(dialogs.at(-1),/не сохранены/);assert.deepEqual(await snapshot(page),before);assert.equal(await page.locator('#scheduleForm [name=notes]').inputValue(),'draft retained');
 });
 const sparse=fixture();sparse.schedule=[{id:'legacy_plan',title:'Минимальный этап',start:'2026-11-01',end:'2026-12-05',extension:{keep:true}}];
 await scenario('SH01 11 absent fields and substeps stay absent; reset permits new secure creation',async(page,dialogs,data)=>{
  const before=await snapshot(page);await edit(page);await submit(page);await verify(page,data.schedule,before);await page.evaluate(()=>{const form=document.getElementById('scheduleForm');form.elements.title.value='Новый этап';form.elements.start.value='2026-11-01';form.elements.end.value='2026-12-05';document.getElementById('addSubstep').click();const row=document.querySelector('.substep-editor');row.querySelector('.sub-title').value='Новая';row.querySelector('.sub-start').value='2026-11-01';row.querySelector('.sub-end').value='2026-12-05'});await submit(page);assert.deepEqual(dialogs,[]);const current=await snapshot(page);assert.equal(current.confirmed.schedule.length,2);assert.match(current.confirmed.schedule[1].id,/^[a-f0-9-]{32,36}$/i);assert.deepEqual(current.confirmed.schedule[0],data.schedule[0]);assert.equal(Object.hasOwn(current.confirmed.schedule[1],'extension'),false);
 },sparse);
 await scenario('SH01 12 active object does not silently reassign edited plan',async(page,dialogs,data)=>{
  const before=await snapshot(page);await page.evaluate(()=>{setActiveObject('o2')});await edit(page);await patch(page,'#scheduleForm [name=notes]','Изменено без переноса');await submit(page);assert.deepEqual(dialogs,[]);await verify(page,[{...data.schedule[0],notes:'Изменено без переноса'}],before);
 });
 await scenario('SH01 13 every stage form field applies and preserves unknown stage fields',async(page,dialogs,data)=>{
  const before=await snapshot(page),changes={title:'Проверенный монтаж',start:'2026-11-06',end:'2026-12-04',status:'Выполнено',assignee:'Мастер',notes:'Исправление стадии'};await edit(page);
  await page.evaluate(changes=>{const row=document.querySelector('.substep-editor');for(const [key,value]of Object.entries(changes))row.querySelector('.sub-'+key).value=value},changes);await submit(page);assert.deepEqual(dialogs,[]);const expected=copy(data.schedule);Object.assign(expected[0].substeps[0],changes);await verify(page,expected,before);
 });
 const unknown=fixture();unknown.schedule[0].status='Исторический статус';unknown.schedule[0].substeps[0].status='Старое состояние';
 await scenario('SH01 14 unknown statuses and untouched whitespace survive unrelated note edit',async(page,dialogs,data)=>{
  const before=await snapshot(page);await edit(page);await patch(page,'#scheduleForm [name=notes]','Другое примечание');await submit(page);assert.deepEqual(dialogs,[]);await verify(page,[{...data.schedule[0],notes:'Другое примечание'}],before);
 },unknown);
 console.log(`Schedule preservation browser scenarios: ${passed} passed`);
})().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve())});
