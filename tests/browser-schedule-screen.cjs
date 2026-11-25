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
  {id:'parent',objectId:'site',title:'Фундамент',start:'2026-11-24',end:'2026-12-01',status:'В работе',assignee:'Мастер',extension:{nested:[1,null,{keep:true}]},progress:12.5,actualStart:'2026-11-25',substeps:[
   {title:'Одинаковое название',start:'2026-11-24',end:date,status:'В работе',notes:'Legacy без ID',extension:{nested:['keep',false]},progress:7.5},
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
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:process.env.BROWSER_HEADED!=='1'});
 async function open(width,data=fixture){
  const context=await browser.newContext({viewport:{width,height:1050},isMobile:width<=390,hasTouch:width<=390,timezoneId:'Europe/Moscow',acceptDownloads:true});
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  await context.addInitScript(data=>{
   if(location.protocol!=='http:')return;
   if(localStorage.getItem('moiShtab_v03')===null){localStorage.setItem('moiShtab_v03',JSON.stringify(data,null,2));
   localStorage.setItem('moiShtab_v03_before_import','Исходная предимпортная копия');}
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
 const focusProof=[];
 const row=(page,name)=>page.locator('.sg-row').filter({has:page.getByRole('button',{name,exact:true})});


 for(const width of [1440,390])for(const close of ['Escape','button','filtered']){
  const {page,context}=await open(width),before=await snapshot(page);const button=page.getByRole('button',{name:'Подготовка основания',exact:true});
  await page.locator('#scheduleSearch').fill('Подготовка');await page.locator('#scheduleStatus').selectOption('delayed');await page.locator('#scheduleSort').selectOption('title');await page.locator('#scheduleViewDays').selectOption('60');await page.locator('.sg-calendar').first().evaluate(el=>{el.scrollLeft=120;el.dispatchEvent(new Event('scroll'))});await button.click();
  const view=await page.evaluate(()=>({search:document.getElementById('scheduleSearch').value,status:document.getElementById('scheduleStatus').value,sort:document.getElementById('scheduleSort').value,start:document.getElementById('scheduleViewStart').value,days:document.getElementById('scheduleViewDays').value,scroll:document.querySelector('.sg-calendar').scrollLeft}));
  await page.evaluate(()=>{window.focusEvents=[];window.previousOpener=Array.from(document.querySelectorAll('[data-schedule-key]')).find(el=>el.dataset.scheduleKey===scheduleDialogKey);window.addEventListener('focus',event=>focusEvents.push({type:'focus',trusted:event.isTrusted,phase:window.focusPhase}));document.addEventListener('visibilitychange',event=>focusEvents.push({type:document.visibilityState,trusted:event.isTrusted,phase:window.focusPhase}))});
  // Playwright otherwise forces every page to remain focused, hiding this real browser regression.
  const focusSession=await context.newCDPSession(page);await focusSession.send('Emulation.setFocusEmulationEnabled',{enabled:false});const separateWindows=process.env.BROWSER_HEADED==='1';const otherContext=separateWindows?await browser.newContext():context;const other=await otherContext.newPage();const otherSession=await otherContext.newCDPSession(other);await otherSession.send('Emulation.setFocusEmulationEnabled',{enabled:false});const originalWindow=await focusSession.send('Browser.getWindowForTarget'),otherWindow=await otherSession.send('Browser.getWindowForTarget');if(separateWindows)assert.notEqual(originalWindow.windowId,otherWindow.windowId,'separate browser windows');await page.evaluate(()=>{focusEvents=[];focusPhase='away';previousOpener=Array.from(document.querySelectorAll('[data-schedule-key]')).find(el=>el.dataset.scheduleKey===scheduleDialogKey)});await other.bringToFront();await page.waitForTimeout(100);await page.evaluate(()=>{focusPhase='return'});await page.bringToFront();
  await page.waitForFunction(()=>!previousOpener.isConnected);const events=await page.evaluate(()=>focusEvents);assert.ok(events.some(event=>event.trusted&&event.phase==='return'),'trusted browser focus/visibility after returning');
  if(close==='filtered')await page.evaluate(()=>{document.getElementById('scheduleSearch').value='Одинаковое';renderScheduleTimeline()});
  if(close==='Escape')await page.keyboard.press('Escape');else await page.locator('#scheduleWorkClose').click();
  // Native dialog close is queued; observe its completed focus restoration before asserting.
  await page.waitForFunction(filtered=>filtered?document.activeElement===document.getElementById('scheduleSearch'):document.activeElement?.dataset.scheduleKey===scheduleDialogKey,close==='filtered',{timeout:3000});
  if(close==='filtered')assert.equal(await page.locator('#scheduleSearch').evaluate(el=>el===document.activeElement),true);else{assert.equal(await button.evaluate(el=>el===document.activeElement),true);assert.deepEqual(await page.evaluate(()=>({search:document.getElementById('scheduleSearch').value,status:document.getElementById('scheduleStatus').value,sort:document.getElementById('scheduleSort').value,start:document.getElementById('scheduleViewStart').value,days:document.getElementById('scheduleViewDays').value,scroll:document.querySelector('.sg-calendar').scrollLeft})),view);}
  focusProof.push({width,close,originalWindow:originalWindow.windowId,otherWindow:otherWindow.windowId,events});assert.deepEqual(await snapshot(page),before);if(separateWindows)await otherContext.close();else await other.close();await context.close();pass(width+'px real browser '+(separateWindows?'window':'tab')+' focus return '+close+' '+JSON.stringify({originalWindow:originalWindow.windowId,otherWindow:otherWindow.windowId,events}));
 }
 assert.equal(focusProof.length,6);
 fs.writeFileSync(path.join(out,'vg02-focus-'+(process.env.BROWSER_HEADED==='1'?'windows':'tabs')+'.json'),JSON.stringify({mode:process.env.BROWSER_HEADED==='1'?'headed-windows':'headless-tabs',browser:browser.version(),platform:process.platform,node:process.version,implementationSHA256:require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).digest('hex'),cases:focusProof},null,2));
 if(process.env.BROWSER_FOCUS_ONLY==='1'){assert.deepEqual(errors,[]);console.log(`VG02 window focus scenarios: ${passed}/${passed} PASS`);return;}
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
  assert.doesNotMatch(await row(page,'Подготовка основания').innerText(),/Просрочено|\+\d/);
  assert.equal(await page.locator('#scheduleSummary .sg-delayed b').textContent(),'1');assert.equal(await page.locator('#scheduleSummary .sg-late b').textContent(),'1');assert.equal(await page.locator('#scheduleSummary > span').count(),8);
  await page.locator('#scheduleStatus').selectOption('delayed');assert.equal(await page.locator('.sg-row').count(),1);assert.match(await page.locator('.sg-row').innerText(),/Подготовка основания/);await page.locator('#scheduleStatus').selectOption('');
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
   await page.evaluate(()=>new Promise(resolve=>{
    const calendar=document.querySelector('.sg-row .sg-calendar');
    let previous=calendar.scrollLeft,stableFrames=0;
    function settled(){
     const current=calendar.scrollLeft;
     stableFrames=current===previous?stableFrames+1:0;
     previous=current;
     if(stableFrames>=8)resolve();else requestAnimationFrame(settled);
    }
    requestAnimationFrame(settled);
   }));
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

 {const {page,context}=await open(1440),before=await snapshot(page);
  for(const [now,late,delayed] of [['2026-11-25T10:00:00Z',false,true],['2026-12-05T10:00:00Z',false,true],['2026-12-06T10:00:00Z',true,false]]){
   await page.clock.setFixedTime(new Date(now));await page.evaluate(()=>renderSchedule());const text=await row(page,'Подготовка основания').innerText();assert.equal(text.includes('Просрочено'),late);assert.equal(await row(page,'Подготовка основания').locator('.sg-delayed').count(),delayed?1:0);if(late)assert.match(text,/Отмечена задержка · Просрочено \+1 дн./);
   await page.locator('#scheduleStatus').selectOption(late?'late':'delayed');assert.equal(await row(page,'Подготовка основания').count(),1);await page.locator('#scheduleStatus').selectOption(late?'delayed':'late');assert.equal(await row(page,'Подготовка основания').count(),0);await page.locator('#scheduleStatus').selectOption('');
  }
  assert.deepEqual(await snapshot(page),before);await context.close();pass('CPU delay boundaries Nov25 Dec5 Dec6 in rows, summary and mutually exclusive filters');
 }
 {const {page,context}=await open(1440),before=await snapshot(page);const stageRow=row(page,'Одинаковое название').first();await stageRow.getByRole('button').click();assert.match(await page.locator('#scheduleWorkBody').innerText(),/Мастерская — испытание ВГ02/);await page.locator('#scheduleWorkEdit').click();assert.equal(await page.locator('#scheduleForm [name=id]').inputValue(),'parent');await page.locator('#scheduleForm [name=notes]').fill('Изменено через карточку стадии');await page.evaluate(()=>document.getElementById('scheduleForm').requestSubmit());
  const after=await snapshot(page),expected=JSON.parse(before.memory);expected.schedule[0].notes='Изменено через карточку стадии';delete expected._revision;const actual=JSON.parse(after.memory);delete actual._revision;assert.deepEqual(actual,expected);assert.deepEqual(JSON.parse(after.raw).schedule,expected.schedule);assert.deepEqual(after.confirmed.schedule,expected.schedule);assert.equal(after.backup,before.backup);assert.deepEqual(after.writes,['moiShtab_v03']);await page.reload();assert.deepEqual((await snapshot(page)).confirmed.schedule,expected.schedule);await context.close();pass('stage card saves through accepted safe editor with nested extras, IDs, history and reload preserved');
 }

 {const data=JSON.parse(JSON.stringify(fixture));data.schedule=[data.schedule[0]];data.schedule[0].substeps=[0,1,2].map(i=>({title:'Стадия '+(i+1),start:date,end:'2026-12-05',status:'В работе',extension:{keep:i}}));const {page,context}=await open(1440,data),before=await snapshot(page);assert.equal(await page.locator('.sg-row').count(),4);assert.match(await page.locator('#scheduleSummary').innerText(),/3 работ/);assert.equal(await page.locator('#scheduleSummary .sg-working b').textContent(),'3');for(let i=1;i<=3;i++){await page.getByRole('button',{name:'Стадия '+i,exact:true}).click();assert.match(await page.locator('#scheduleWorkBody').innerText(),/Мастерская — испытание ВГ02/);assert.match(await page.locator('#scheduleWorkBody').innerText(),/Фундамент/);await page.locator('#scheduleWorkClose').click();}assert.deepEqual(await snapshot(page),before);await context.close();pass('three stages without objectId inherit read-only context and count exactly three leaves');
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
