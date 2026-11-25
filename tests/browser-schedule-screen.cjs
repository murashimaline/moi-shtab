const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const out=path.resolve(process.env.BROWSER_OUTPUT||'.browser-results');
const date='2026-11-30';
const fixture={
 version:3,objects:[{id:'site',name:'Мастерская — испытание ВГ02'},{id:'other',name:'Другой объект'}],
 tasks:[],goals:[],workers:[],attendance:[],payments:[],expenses:[],
 works:[{id:'journal',date,objectId:'site',title:'Одинаковое название',volume:'24 м²',photos:['data:image/png;base64,AA==']}],
 financeHistory:[{at:'old',collection:'expenses',id:'e',action:'create',before:'null',after:'{}'}],
 extension:{retained:['photo and history']},
 schedule:[
  {id:'parent',objectId:'site',title:'Фундамент',start:'2026-11-24',end:'2026-12-01',status:'В работе',assignee:'Мастер',substeps:[
   {title:'Одинаковое название',start:'2026-11-24',end:date,status:'В работе',notes:'Legacy без ID'},
   {id:'stage',title:'Одинаковое название',start:'2026-11-24',end:'2026-11-29',status:'Запланировано',objectId:'other'}
  ]},
  {id:'done',objectId:'site',title:'Земляные работы / разработка котлована и вывоз грунта',start:'2026-11-24',end:'2026-11-25',status:'Выполнено',assignee:'Бригадир',actualStart:'2026-11-24',actualEnd:'2026-11-25',progress:1,notes:'<img src=x onerror="window.injected=true">'},
  {id:'delay',objectId:'site',title:'Подготовка основания',start:'2026-11-24',end:'2026-12-05',status:'Задержка'},
  {id:'unknown',objectId:'site',title:'Проверка отметок',start:'2026-11-01',end:'2026-11-02'},
  {id:'single',objectId:'site',title:'Монтаж опалубки',start:'2026-12-10',end:'2026-12-10',status:'Запланировано'},
  {id:'foreign',objectId:'other',title:'Чужой этап',start:date,end:date,status:'Выполнено',substeps:[{title:'Чужая стадия',objectId:'site',start:date,end:date,status:'Выполнено'}]}
 ]
};
let server,browser,passed=0;
const errors=[];
function pass(label){passed++;console.log('VG02 '+label+' PASS')}
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 server=http.createServer((request,response)=>{
  const file=request.url==='/'?'index.html':request.url.slice(1);
  if(!['index.html','storage.js'].includes(file))return response.writeHead(404).end();
  response.setHeader('Content-Type',file.endsWith('.js')?'text/javascript;charset=utf-8':'text/html;charset=utf-8');
  response.end(fs.readFileSync(path.join(root,file)));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
 async function open(width,data=fixture){
  const context=await browser.newContext({viewport:{width,height:1050},isMobile:width<=390,hasTouch:width<=390,timezoneId:'Europe/Moscow',acceptDownloads:true});
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  await context.addInitScript(data=>{
   localStorage.setItem('moiShtab_v03',JSON.stringify(data,null,2));
   localStorage.setItem('moiShtab_v03_before_import','Исходная предимпортная копия');
   window.screenWrites=[];
   const write=Storage.prototype.setItem;
   Storage.prototype.setItem=function(key,value){if(this===localStorage)window.screenWrites.push(key);return write.call(this,key,value)};
  },data);
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>{errors.push(dialog.message());return dialog.dismiss()});
  await page.clock.setFixedTime(new Date('2026-11-30T20:59:59Z'));
  await page.goto(origin);
  await page.evaluate(()=>{setActiveObject('site');showPage('schedule');document.getElementById('scheduleViewStart').value='2026-11-24';renderScheduleTimeline()});
  return {page,context};
 }
 const snapshot=page=>page.evaluate(()=>({raw:localStorage.getItem('moiShtab_v03'),backup:localStorage.getItem('moiShtab_v03_before_import'),memory:JSON.stringify(db),confirmed:persistence.readSnapshot(),state:persistence.status(),writes:window.screenWrites}));
 const row=(page,name)=>page.locator('.sg-row').filter({has:page.getByRole('button',{name,exact:true})});
 for(const width of [1440,1024,768,390,320]){
  const {page,context}=await open(width),before=await snapshot(page);
  assert.equal(await page.locator('.sg-row').count(),7);
  assert.equal(await page.locator('.sg-fact').count(),7);
  assert.equal(await page.locator('.sg-fact .sg-plan-bar, .sg-fact .gantt-bar, .sg-progress .meter, .sg-progress progress').count(),0);
  assert.deepEqual(await page.locator('.sg-progress').allTextContents(),Array(7).fill('Нет данных'));
  assert.equal(await row(page,'Одинаковое название').count(),2);
  assert.match(await page.locator('#scheduleSummary').innerText(),/6 работ/);
  assert.match(await page.locator('#scheduleSummary').innerText(),/Из выполненных с опозданием · Нет данных/);
  assert.match(await row(page,'Подготовка основания').innerText(),/Отмечена задержка/);
  assert.doesNotMatch(await row(page,'Подготовка основания').innerText(),/\+\d/);
  assert.match(await row(page,'Проверка отметок').innerText(),/Нет данных/);
  assert.doesNotMatch(await row(page,'Проверка отметок').innerText(),/Просрочено/);
  assert.equal(await row(page,'Монтаж опалубки').locator('.sg-plan-bar').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
  await page.evaluate(()=>window.scrollTo(0,0));
  const graphBounds=await page.locator('#page-schedule > .panel').first().boundingBox();
  const originalViewport=page.viewportSize();
  await page.setViewportSize({width,height:Math.ceil(graphBounds.y+graphBounds.height+16)});
  await page.screenshot({path:path.join(out,`vg02-screen-${width}.png`)});
  await page.setViewportSize(originalViewport);
  pass(`${width}px object stages, honest absence of fact, leaf totals and readable layout`);

  await page.locator('#scheduleSearch').fill('фундамент');
  assert.equal(await page.locator('.sg-row').count(),3);
  assert.equal(await page.locator('.sg-lane').count(),6);
  await page.locator('#scheduleStatus').selectOption('late');
  assert.equal(await page.locator('.sg-row').count(),2);
  await page.locator('#scheduleSort').selectOption('title');
  await page.locator('#scheduleSearch').fill('неизвестная строка');
  assert.equal(await page.locator('.sg-row').count(),0);
  assert.match(await page.locator('#scheduleTimeline').innerText(),/По выбранным условиям/);
  await page.locator('#scheduleStatus').selectOption('');
  await page.locator('#scheduleSearch').fill('');
  assert.equal(await page.locator('.sg-row').count(),7);
  const name=page.getByRole('button',{name:'Подготовка основания',exact:true});
  await name.scrollIntoViewIfNeeded();
  const originalX=(await name.boundingBox()).x;
  await page.locator('.sg-calendar').first().evaluate(calendar=>{calendar.scrollLeft=160;calendar.dispatchEvent(new Event('scroll'))});
  await page.waitForFunction(()=>{
   const scrolls=Array.from(document.querySelectorAll('.sg-calendar'),e=>e.scrollLeft);
   return scrolls.every(x=>x===scrolls[0]);
  });
  assert.equal((await name.boundingBox()).x,originalX);
  if(width<=390){
   const calendar=page.locator('.sg-row .sg-calendar').first();
   await calendar.scrollIntoViewIfNeeded();
   await calendar.evaluate(el=>{el.scrollLeft=0;el.dispatchEvent(new Event('scroll'))});
   const bounds=await calendar.boundingBox();
   const session=await context.newCDPSession(page);
   const x=bounds.x+bounds.width-20,y=bounds.y+20;
   await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
   for(let step=1;step<=8;step++){
    await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-step*18,y}]});
    await new Promise(resolve=>setTimeout(resolve,16));
   }
   await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await page.waitForFunction(()=>document.querySelector('.sg-row .sg-calendar').scrollLeft>20);
   await session.detach();
   pass(width+'px emulated touch swipe scrolls the calendar');
  }
  const scroll=await page.locator('.sg-calendar').first().evaluate(el=>el.scrollLeft);
  await page.evaluate(()=>{showPage('objects');renderAll();showPage('schedule')});
  assert.equal(await page.locator('.sg-calendar').first().evaluate(el=>el.scrollLeft),scroll);
  if(width<=390)await name.tap();else await name.click();
  assert.equal(await page.locator('#scheduleWorkDialog').isVisible(),true);
  assert.match(await page.locator('#scheduleWorkBody').innerText(),/Источник фактических дат/);
  assert.match(await page.locator('#scheduleWorkBody').innerText(),/Отмечена задержка/);
  await page.locator('#scheduleWorkClose').click();
  assert.equal(await page.locator('.sg-calendar').first().evaluate(el=>el.scrollLeft),scroll);
  await name.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.getElementById('scheduleWorkDialog').contains(document.activeElement)),true);
  await page.keyboard.press('Escape');
  assert.equal(await name.evaluate(el=>el===document.activeElement),true);
  assert.deepEqual(await snapshot(page),before);
  pass(`${width}px search, filter, sort, calendar scroll, tap and keyboard preserve raw JSON, DataStore, history and photos`);
  if(width===1440){
   await row(page,'Земляные работы / разработка котлована и вывоз грунта').getByRole('button').click();
   const details=await page.locator('#scheduleWorkBody').innerText();
   assert.match(details,/Окончание неизвестно/);
   assert.doesNotMatch(details,/Выполнено в срок/);
   assert.equal(await page.locator('#scheduleWorkBody img').count(),0);
   assert.equal(await page.evaluate(()=>!!window.injected),false);
   await page.locator('#scheduleWorkClose').click();
   await page.locator('#scheduleViewStart').fill('2026-12-27');
   await page.locator('#scheduleViewStart').dispatchEvent('change');
   assert.match(await page.locator('.sg-day').last().innerText(),/09.01/);
   for(const days of ['30','60','90']){
    await page.locator('#scheduleViewDays').selectOption(days);
    assert.equal(await page.locator('.sg-day').count(),Number(days));
   }
   assert.equal(await page.locator('.sg-day').count(),90);
   assert.equal(await page.locator('.sg-row').count(),7);
   await page.locator('#scheduleViewStart').fill('2026-11-24');
   await page.locator('#scheduleViewStart').dispatchEvent('change');
   const dueRow=row(page,'Одинаковое название').filter({has:page.locator('.sg-working')});
   assert.equal(await dueRow.count(),1);
   await page.clock.setFixedTime(new Date('2026-11-30T21:00:01Z'));
   await page.evaluate(()=>{showPage('objects');showPage('schedule')});
   assert.equal(await row(page,'Одинаковое название').filter({has:page.locator('.sg-working')}).count(),0);
   assert.match(await page.locator('#scheduleAssessment').innerText(),/01.12.2026/);
   await page.clock.setFixedTime(new Date('2026-11-30T20:59:59Z'));
   await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
   assert.equal(await row(page,'Одинаковое название').filter({has:page.locator('.sg-working')}).count(),1);
   assert.deepEqual(await snapshot(page),before);
   pass('year boundary, 90-day window, local midnight and return to screen refresh the assessment without writes');
   const done=page.getByRole('button',{name:'Земляные работы / разработка котлована и вывоз грунта',exact:true});
   await done.click();
   await page.locator('#scheduleWorkEdit').click();
   assert.equal(await page.locator('#scheduleForm input[name=id]').inputValue(),'done');
   assert.equal(await page.locator('#scheduleForm input[name=title]').inputValue(),'Земляные работы / разработка котлована и вывоз грунта');
   assert.deepEqual(await snapshot(page),before);
   pass('detail card opens the existing controlled plan editor');
   await page.evaluate(()=>{
    db.schedule[0].substeps[0].start='2026-12-02';
    renderSchedule();
   });
   const damaged=await snapshot(page);
   assert.match(await row(page,'Одинаковое название').first().innerText(),/Сверить плановые даты/);
   assert.equal(await row(page,'Одинаковое название').first().locator('.sg-plan-bar').count(),0);
   await page.locator('#scheduleSort').selectOption('start');
   assert.deepEqual(await snapshot(page),damaged);
   pass('a synthetic invalid interval warns without drawing a false bar or saving a repair');
  }
  await context.close();
 }
 const {page:empty,context:emptyContext}=await open(390,{...fixture,schedule:[]});
 assert.equal(await empty.locator('.sg-row').count(),0);
 assert.match(await empty.locator('#scheduleTimeline').innerText(),/пока нет работ/);
 assert.match(await empty.locator('#scheduleSummary').innerText(),/0 работ/);
 await emptyContext.close();
 pass('empty schedule');
 const many={...fixture,schedule:Array.from({length:501},(_,i)=>({id:'many-'+i,objectId:'site',title:i===500?'Очень длинное название вида работ '.repeat(12):'Работа '+i,start:date,end:date,status:'В работе'}))};
 for(const width of [1440,390]){
  const {page,context}=await open(width,many),before=await snapshot(page);
  await page.locator('#scheduleViewDays').selectOption('90');
  const elapsed=await page.evaluate(()=>{const begin=performance.now();renderScheduleTimeline();return performance.now()-begin});
  assert.equal(await page.locator('.sg-row').count(),501);
  assert.equal(await page.locator('.sg-lane').count(),1002);
  assert.equal(await page.locator('.sg-day').count(),90);
  await page.locator('#scheduleSearch').fill('очень длинное');
  assert.equal(await page.locator('.sg-row').count(),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
  assert.deepEqual(await snapshot(page),before);
  fs.writeFileSync(path.join(out,`vg02-performance-${width}.json`),JSON.stringify({browser:browser.version(),width,logicalWorks:501,days:90,renderMilliseconds:elapsed,node:process.version,platform:process.platform,processors:require('node:os').cpus().length,cpu:require('node:os').cpus()[0]?.model},null,2));
  pass(`${width}px 501 works / 90 days rendered in ${elapsed.toFixed(0)} ms; long names and storage retained`);
  await context.close();
 }
 assert.deepEqual(errors,[]);
 console.log(`VG02 screen scenarios: ${passed}/${passed} PASS`);
})().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{
 if(browser)await browser.close();
 if(server)server.close();
});
