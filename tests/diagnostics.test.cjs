const {test}=require('node:test');
const assert=require('node:assert/strict');
const {diagnoseRaw,createDataStore}=require('../storage.js');
const KEY='moiShtab_v03';
const fixture=()=>({version:3,_revision:{number:7,token:'original'},objects:[{id:'o',name:'Site'}],workers:[{id:'w',name:'Worker',rate:9000}],tasks:[],works:[],goals:[],attendance:[{id:'a',workerId:'w',objectId:'o',date:'2026-01-10',status:'Смена',shiftType:'day',shifts:1,hours:8,ratePerShift:6000}],payments:[],expenses:[]});
const check=data=>diagnoseRaw(JSON.stringify(data));
const has=(r,c)=>r.issues.some(i=>i.code===c);
const count=(r,c)=>r.issues.filter(i=>i.code===c).length;
function disk(raw){const values=new Map([[KEY,raw],[KEY+'_before_import','exact backup\r\n']]);return {values,writes:[],fail:false,getItem(k){if(this.fail)throw Error('denied');return values.get(k)??null},setItem(k,v){this.writes.push([k,v]);values.set(k,v)}}}
test('clean snapshot and absent primary have no findings; numeric strings and zero historical rate are valid',()=>{
 const d=fixture();assert.equal(check(d).issues.length,0);assert.equal(diagnoseRaw(null).issues.length,0);
 Object.assign(d.attendance[0],{ratePerShift:'0',hours:'8',shifts:'1'});assert.equal(check(d).issues.length,0);
});
test('legacy rate and hours remain unknown; current rate never fills history',()=>{
 const d=fixture();delete d.attendance[0].ratePerShift;d.attendance[0].hours='';d.attendance[0].shifts=null;
 const before=JSON.stringify(d),r=check(d);assert.ok(has(r,'missing_rate'));assert.ok(has(r,'missing_hours'));assert.ok(has(r,'missing_shift_quantity'));assert.equal(JSON.stringify(d),before);
});
test('hourly contradictions, invalid numbers and calendar dates are detected',()=>{
 const d=fixture();Object.assign(d.attendance[0],{status:'Часы',hours:4,shifts:1,ratePerShift:-1,date:'2026-02-30'});
 let r=check(d);for(const c of ['inconsistent_hours','invalid_number','invalid_date'])assert.ok(has(r,c),c);
 for(const hours of [null,' ',0,25,true,{},'abc']){d.attendance[0].hours=hours;assert.ok(has(check(d),'invalid_hourly_hours'))}
});
test('half and absent conflicts, unknown shift status/type and excessive hours are reported',()=>{
 const d=fixture();
 for(const status of ['Половина смены','Отсутствовал']){d.attendance[0].status=status;assert.ok(has(check(d),'inconsistent_shift_quantity'))}
 Object.assign(d.attendance[0],{status:'unknown',shiftType:'unknown',hours:25});
 for(const c of ['unknown_shift_status','unknown_shift_type','excessive_hours'])assert.ok(has(check(d),c));
});
test('explicit day/night are distinct; unspecified and absent conflict across objects',()=>{
 const d=fixture();d.attendance.push({...d.attendance[0],id:'b',shiftType:'night',objectId:''});
 assert.equal(count(check(d),'shift_conflict'),0);
 for(const change of [{shiftType:'day'},{shiftType:'unspecified'},{shiftType:'night',status:'Отсутствовал'}]){
  Object.assign(d.attendance[1],change);assert.equal(count(check(d),'shift_conflict'),2);
 }
});
test('duplicate ID references distinguish index; same ID across collections is valid',()=>{
 const d=fixture();d.objects[0].id='w';d.attendance[0].objectId='w';assert.equal(check(d).issues.length,0);
 d.workers.push({...d.workers[0]});const r=check(d);assert.equal(count(r,'duplicate_id'),2);assert.ok(has(r,'ambiguous_link'));
 assert.deepEqual(r.issues.filter(i=>i.code==='duplicate_id').map(i=>i.record.index),[0,1]);
});
test('missing, wrong-type, invalid and required references including worker arrays are detected',()=>{
 const d=fixture();d.attendance[0].workerId='o';d.attendance[0].objectId='absent';
 d.works=[{id:'work',date:'2026-01-10',workerIds:['w','w','o',''],objectId:{collection:'objects',id:'o'}}];
 d.payments=[{id:'p',date:'2026-01-10',amount:1,kind:'Выплата'}];
 const r=check(d);for(const c of ['wrong_target_type','missing_target','invalid_link','missing_link','repeated_worker_link'])assert.ok(has(r,c),c);
 d.works[0].workerIds={};assert.ok(has(check(d),'invalid_worker_list'));
});
test('linked financial worker and object contradictions are reported, without inferring from current worker card',()=>{
 const d=fixture();d.objects.push({id:'o2',name:'Other'});d.workers.push({id:'w2',name:'Other'});
 d.payments=[{id:'p',date:'2026-01-10',kind:'Выплата',amount:100,workerId:'w',objectId:'o',paymentSource:'other'}];
 d.expenses=[{id:'e',date:'2026-01-10',amount:100,workerId:'w2',objectId:'o2',paymentId:'p',category:'Материалы',paymentSource:'other'}];
 assert.equal(count(check(d),'contradictory_payment_link'),2);
 d.workers[0].objectId='o2';d.expenses=[];assert.equal(count(check(d),'contradictory_payment_link'),0);
});
test('missing and unknown payment sources; fines are not cash source errors',()=>{
 const d=fixture();d.payments=['','unknown','other','accountable'].map((paymentSource,i)=>({id:'p'+i,date:'2026-01-10',amount:100+i,kind:'Выплата',workerId:'w',paymentSource}));
 d.payments.push({id:'fine',date:'2026-01-10',amount:1,kind:'Штраф',workerId:'w'});
 assert.equal(count(check(d),'unknown_payment_source'),2);
 d.expenses=[{id:'e',date:'2026-01-10',amount:3}];assert.equal(count(check(d),'unknown_payment_source'),3);
});
test('unattributed objects and unclear purpose are explicit; absent object is informational',()=>{
 const d=fixture();d.payments=[{id:'p',date:'2026-01-10',amount:1,workerId:'w',kind:'???'}];d.income=[{id:'i',date:'2026-01-10',amount:2}];
 const r=check(d);assert.equal(count(r,'unknown_purpose'),2);assert.equal(count(r,'unattributed_object'),2);
 assert.ok(r.issues.filter(i=>i.code==='unattributed_object').every(i=>i.severity==='info'));
});
test('possible duplicates do not collapse rows or claim proven duplicates',()=>{
 const d=fixture();d.payments=[{id:'p',workerId:'w',date:'2026-01-10',amount:100,kind:'Выплата',paymentSource:'other'}];
 d.payments.push({...d.payments[0],id:'q',amount:'100'});const before=JSON.stringify(d);const r=check(d);
 assert.equal(count(r,'possible_duplicate_operation'),2);assert.equal(JSON.stringify(d),before);
 assert.ok(r.issues.filter(i=>i.code==='possible_duplicate_operation').every(i=>i.severity==='warning'&&i.reason.includes('автоматического объединения нет')));
});
test('weekly periods and import keys find repeats across dates',()=>{
 const d=fixture();d.payments=[{id:'p',workerId:'w',date:'2026-01-10',amount:100,kind:'Выплата',weeklyWeekStart:'2026-01-05',weeklyWeekEnd:'2026-01-11',importSourceKey:'src'}];
 d.payments.push({...d.payments[0],id:'q',date:'2026-01-12',amount:200});
 d.attendance.push({...d.attendance[0],id:'b',date:'2026-01-11',importSourceKey:'a_src'});d.attendance[0].importSourceKey='a_src';
 assert.equal(count(check(d),'repeated_weekly_payment'),2);assert.equal(count(check(d),'repeated_import_source'),4);
});
test('salary expenses and repeated deductions identify cross-collection candidates',()=>{
 const d=fixture();d.attendance[0].fine=50;d.attendance[0].deduction=40;
 d.payments=[{id:'p',workerId:'w',date:'2026-01-10',amount:100,kind:'Выплата'},
 {id:'f',workerId:'w',date:'2026-01-10',amount:50,kind:'Штраф'},{id:'u',workerId:'w',date:'2026-01-10',amount:40,kind:'Удержание'}];
 d.expenses=[{id:'e',date:'2026-01-10',amount:100,category:'Зарплата'}];
 assert.equal(count(check(d),'possible_salary_double_count'),1);assert.equal(count(check(d),'possible_double_deduction'),2);
 d.expenses[0].category='Материалы';assert.equal(count(check(d),'possible_salary_double_count'),0);
});
test('malformed JSON, unsupported schema and malformed collections are incomplete, never clean',()=>{
 for(const raw of ['', '{broken','null','[]','{"version":4}']){const r=diagnoseRaw(raw);assert.equal(r.complete,false);assert.ok(r.issues.length)}
 const d=fixture();d.workers={};d.attendance.push(null,[],5);const r=check(d);assert.equal(r.complete,false);assert.equal(count(r,'invalid_record'),3);assert.ok(has(r,'invalid_collection'));
});
test('adversarial JSON values cannot execute code or crash numeric coercion',()=>{
 const d=fixture();const bad={toString:1,valueOf:1};Object.assign(d.attendance[0],{id:bad,ratePerShift:bad,hours:bad,workerId:bad,date:bad});
 d.expenses=[{id:'e',date:'2026-01-10',amount:bad,notes:bad,category:bad}];
 assert.doesNotThrow(()=>check(d));assert.ok(has(check(d),'invalid_number'));
});
test('raw reads and repeated diagnostics preserve exact disk bytes, revision, backups, state and calculations inputs',()=>{
 for(const raw of [JSON.stringify(fixture(),null,2)+'\r\n','{broken',JSON.stringify({...fixture(),workers:[{id:'w'},{id:'w'}]})]){
  const d=disk(raw),store=createDataStore(d,KEY,fixture),state=store.status(),snap=store.readSnapshot(),entries=[...d.values];
  for(let i=0;i<3;i++){const r=diagnoseRaw(store.readRaw());r.issues.length=0}
  assert.deepEqual([...d.values],entries);assert.deepEqual(store.status(),state);assert.deepEqual(store.readSnapshot(),snap);assert.deepEqual(d.writes,[]);
 }
});
test('readRaw sees current external bytes without accepting them as confirmed or clearing conflicts',()=>{
 const d=disk(JSON.stringify(fixture())),s=createDataStore(d,KEY,fixture),before=s.readSnapshot(),status=s.status();
 d.values.set(KEY,'{external');assert.equal(s.readRaw(),'{external');assert.ok(has(diagnoseRaw(s.readRaw()),'invalid_json'));assert.deepEqual(s.status(),status);assert.deepEqual(s.readSnapshot(),before);
 s.observe({key:KEY,newValue:'{external'});diagnoseRaw(s.readRaw());assert.equal(s.status().conflict,true);assert.deepEqual(d.writes,[]);
});
test('read errors propagate without writes or stale successful report',()=>{
 const d=disk(JSON.stringify(fixture())),s=createDataStore(d,KEY,fixture),status=s.status();d.fail=true;
 assert.throws(()=>s.readRaw(),/denied/);assert.deepEqual(s.status(),status);assert.deepEqual(d.writes,[]);
});
test('all findings carry category, severity, location and reason without copying attachment contents',()=>{
 const d=fixture();d.expenses=[{id:'<img src=x onerror=alert(1)>',date:'bad',amount:null,receipts:[{data:'SECRET_PAYLOAD',name:'secret'}]}];
 const r=check(d);for(const i of r.issues){assert.ok(i.message&&i.reason&&i.category&&i.severity);assert.ok(Object.hasOwn(i.record,'index'))}
 assert.ok(!JSON.stringify(r).includes('SECRET_PAYLOAD'));
});
test('large duplicate group yields linear number of findings, not pairwise explosion',()=>{
 const d=fixture();d.attendance=Array.from({length:5000},(_,i)=>({...d.attendance[0],id:'a'+i}));
 const r=check(d);assert.equal(count(r,'shift_conflict'),5000);assert.equal(r.issues.length,5000);
});
