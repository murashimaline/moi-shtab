const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
const context=vm.createContext({today:()=> '2026-11-30'});
vm.runInContext(html.slice(html.indexOf('function scheduleScreenDate('),html.indexOf('function scheduleFlatRows()')),context);
const state=(status,start='2026-11-24',end='2026-11-30',date='2026-11-30')=>context.scheduleGetState({status,start,end},date);

test('VG02 work due today stays working and becomes overdue on the next calendar day',()=>{
 assert.equal(state('В работе').title,'В работе');
 assert.equal(state('В работе').days,null);
 assert.equal(state('В работе',undefined,undefined,'2026-12-01').detail,'Просрочено +1 дн.');
 assert.equal(state('Запланировано',undefined,undefined,'2026-12-02').days,2);
 assert.equal(state('В работе','2026-12-30','2026-12-31','2027-01-01').days,1);
});
test('VG02 explicit delays retain their reason before and after the planned end',()=>{
 assert.equal(state('Задержка').key,'delayed');
 assert.equal(state('Задержка').title,'Задержка');
 assert.equal(state('Задержка').detail,'Отмечена задержка');
 assert.equal(state('Задержка',undefined,undefined,'2026-12-01').detail,'Отмечена задержка · Просрочено +1 дн.');
});
test('VG02 completion never infers an actual finish or a zero delay',()=>{
 const completed=state('Выполнено','2026-01-01','2026-01-02');
 assert.equal(completed.title,'Выполнено');
 assert.equal(completed.detail,'Окончание неизвестно');
 assert.equal(completed.days,null);
});
for(const status of ['',null,undefined,'Новый статус','__proto__','constructor']){
 test(`VG02 unknown status ${String(status)} takes priority over elapsed dates`,()=>{
  assert.equal(state(status,'2026-01-01','2026-01-02').key,'unknown');
  assert.equal(state(status,'2026-01-01','2026-01-02').days,null);
 });
}
test('VG02 invalid and incomplete intervals warn and do not fabricate a duration',()=>{
 for(const [start,end] of [['','2026-11-29'],['2026-12-01','2026-11-29'],['2026-02-30','2026-11-29'],['2026-01-01',''],['bad','bad']]){
  const result=state('В работе',start,end);
  assert.equal(result.valid,false);
  assert.equal(result.days,null);
  assert.equal(result.warning,'Сверить плановые даты');
 }
 assert.equal(context.scheduleScreenDate('2024-02-29')!==null,true);
 assert.equal(context.scheduleScreenDate('0000-01-01'),null);
});
test('VG02 child object comes from the parent, while legacy and duplicate names retain separate identities',()=>{
 const input=[{id:'p',objectId:'o',title:'Родитель',substeps:[{title:'Одинаково',objectId:'other'},{id:'s',title:'Одинаково'},{title:'Одинаково'}]},
  {id:'p2',objectId:'other',title:'Другой',substeps:[{objectId:'o',title:'Чужая стадия'}]}];
 const before=JSON.stringify(input);
 const rows=context.scheduleScreenRows(input,'o','2026-11-30');
 assert.equal(rows.length,4);
 assert(rows.every(row=>row.objectId==='o'));
 assert.equal(rows.filter(row=>!row.context).length,3);
 assert.equal(new Set(rows.map(row=>row.key)).size,4);
 assert(rows[2].key.includes('"s"'));
 assert.deepEqual(Array.from(context.scheduleScreenRows(input,'o','2026-11-30'),r=>r.key),Array.from(rows,r=>r.key));
 assert.equal(JSON.stringify(input),before);
});
test('VG02 filtering searches parent names, keeps pairs as logical rows and excludes context from totals',()=>{
 const input=[{id:'p',title:'Фундамент',substeps:[{id:'a',title:'Арматура',status:'Выполнено'},{id:'b',title:'Арматура',status:'В работе'}]},
  {id:'q',title:'Монтаж',status:'Запланировано'}];
 const before=JSON.stringify(input),rows=context.scheduleScreenRows(input,'','2026-11-30');
 assert.equal(rows.filter(row=>!row.context).length,3);
 const filtered=context.scheduleScreenFilter(rows,'фУНДАМЕНТ','done','title');
 assert.equal(filtered.count,1);
 assert.equal(filtered.rows.length,2);
 assert.equal(filtered.rows[0].source.id,'p');
 assert.equal(filtered.rows[1].source.id,'a');
 assert.equal(context.scheduleScreenFilter(rows,'Арматура','','start').count,2);
 assert.equal(context.scheduleScreenFilter(rows,'missing','','start').rows.length,0);
 assert.equal(JSON.stringify(input),before);
});
test('VG02 duplicate legacy IDs stay distinct and empty input is handled',()=>{
 const rows=context.scheduleScreenRows([{id:'p',title:'P',substeps:[{id:'x'},{id:'x'}]},{id:'p',title:'P'}],'','2026-01-01');
 assert.equal(new Set(rows.map(r=>r.key)).size,4);
 assert.equal(context.scheduleScreenRows([],'o','2026-01-01').length,0);
});
test('VG02 view ignores unsupported factual extensions and preserves every original field',()=>{
 const input=[{id:'p',title:'Работа',start:'2026-11-01',end:'2026-11-30',status:'В работе',actualStart:'2026-11-02',actualEnd:'2026-11-28',progress:1,extension:{keep:true}}];
 const before=JSON.stringify(input);
 Object.freeze(input[0]);Object.freeze(input);
 const [row]=context.scheduleScreenRows(input,'','2026-11-30');
 assert.equal(row.state.title,'В работе');
 assert.equal(row.state.days,null);
 assert.equal(JSON.stringify(input),before);
});

test('VG02 CPU six categories remain distinct on end-date boundaries and invalid intervals',()=>{
 for(const date of ['2026-11-25','2026-12-05']){const r=state('Задержка','2026-11-01','2026-12-05',date);assert.equal(r.key,'delayed');assert.equal(r.days,null);assert.equal(r.detail,'Отмечена задержка');}
 assert.equal(state('Задержка','2026-11-01','2026-12-05','2026-12-06').key,'late');
 assert.equal(state('Задержка','2026-12-01','2026-11-01').key,'delayed');
 assert.equal(state('Задержка','2026-12-01','2026-11-01').days,null);
 const statuses=['Запланировано','В работе','Выполнено','Задержка','В работе','Unknown'],rows=context.scheduleScreenRows(statuses.map((status,i)=>({id:String(i),status,start:'2026-11-01',end:i===4?'2026-11-29':'2026-12-05'})),'','2026-11-30');
 assert.deepEqual(Array.from(rows,r=>r.state.key),['planned','working','done','delayed','late','unknown']);
 for(const key of ['planned','working','done','delayed','late','unknown'])assert.equal(context.scheduleScreenFilter(rows,'',key,'start').count,1);
});

test('VG02 unique historical empty and Unicode stage IDs remain stable when records reorder',()=>{
 const a={id:'',title:'Empty'},b={id:'legacy:α/1',title:'Unicode'},parent={id:'p',substeps:[a,b]};
 const first=context.scheduleScreenRows([parent],'','2026-11-30').slice(1);parent.substeps=[b,a];const second=context.scheduleScreenRows([parent],'','2026-11-30').slice(1);
 assert.equal(first[0].key,second[1].key);assert.equal(first[1].key,second[0].key);
});
