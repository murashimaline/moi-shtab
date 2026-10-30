const {test}=require('node:test');
const assert=require('node:assert/strict');
const {diagnoseRaw,createDataStore}=require('../storage.js');
const KEY='moiShtab_v03';
const fixture=()=>({version:3,_revision:{number:7,token:'original'},objects:[{id:'o',name:'Site'}],workers:[{id:'w',name:'Worker',rate:9000}],tasks:[],works:[],goals:[],attendance:[{id:'a',workerId:'w',objectId:'o',date:'2026-01-10',status:'Смена',shiftType:'day',shifts:1,hours:8,ratePerShift:6000}],payments:[],expenses:[]});
const check=data=>diagnoseRaw(JSON.stringify(data));
const has=(r,c)=>r.issues.some(i=>i.code===c);
const count=(r,c)=>r.issues.filter(i=>i.code===c).length;
const direction=(r,id)=>{assert.ok(Array.isArray(r.directions),'diagnostics exposes additive directions');const value=r.directions.find(x=>x.id===id);assert.ok(value,'missing direction '+id);return value};
const issueFor=(r,id,field)=>r.issues.filter(i=>i.record.id===id&&(field===undefined||i.field===field));
const onePixelPng='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2Nk+M/wHwAF/gL+5ewzAAAAAElFTkSuQmCC';
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
test('B0-05 completes supported stock and embedded-file checks without changing a valid raw snapshot',()=>{
 const d=fixture();d.warehouse=[
  {id:'tool',name:'Hammer',objectId:'o',baseQty:2,unit:'шт.',serial:'T-1'},
  {id:'cement',name:'Cement',objectId:'o',baseQty:1.5,unit:'кг',serial:'C-1'}
 ];
 d.warehouseMovements=[
  {id:'issue',itemId:'tool',date:'2026-01-10',kind:'issue',qty:1,assignee:'Worker',notes:'work'},
  {id:'restock',itemId:'cement',date:'2026-01-10',kind:'restock',qty:.25,assignee:'Store',notes:'delivery'}
 ];
 d.works=[{id:'work',date:'2026-01-10',objectId:'o',photos:[onePixelPng]}];
 d.expenses=[{id:'expense',date:'2026-01-10',objectId:'o',category:'Материалы',amount:1,paymentSource:'other',receipts:[{id:'receipt',name:'note.txt',data:'data:text/plain;base64,SGVsbG8=',verified:false}]}];
 const before=JSON.stringify(d),r=check(d);
 for(const id of ['warehouse_balances','warehouse_movements','warehouse_links','warehouse_duplicates','warehouse_serials','attachments']){
  const item=direction(r,id);assert.equal(item.status,'checked',id);assert.equal(item.problems,0,id);
 }
 assert.equal(r.issues.filter(i=>['warehouse','attachments'].includes(i.category)).length,0);
 assert.equal(JSON.stringify(d),before);
});
test('B0-05 identifies invalid warehouse inputs, does not infer a worker from assignee, and keeps execution status separate from findings',()=>{
 const d=fixture();d.warehouse=[
  {id:'tool',name:'Piece tool',objectId:'o',baseQty:1.5,unit:'шт.',serial:'T-1'},
  {id:'unknown',name:'Unknown unit',objectId:'o',baseQty:1.5,unit:'условная ед.',serial:'U-1'}
 ];
 d.warehouseMovements=[{id:'bad',itemId:'',date:'2026-02-30',kind:'transfer',qty:0,assignee:'not-a-worker-id',notes:''}];
 const r=check(d);
 for(const code of ['fractional_stock_quantity','unknown_warehouse_unit','invalid_warehouse_movement_quantity','invalid_warehouse_movement_kind'])assert.ok(has(r,code),code);
 assert.ok(has(r,'missing_link'),'missing itemId remains an explicit typed-link finding');
 assert.equal(issueFor(r,'bad','workerId').length,0,'assignee must remain a text field, not a workerId');
 assert.equal(direction(r,'warehouse_balances').status,'partial');
 assert.equal(direction(r,'warehouse_movements').status,'checked');
 assert.equal(direction(r,'warehouse_links').status,'checked');
 assert.ok(direction(r,'warehouse_movements').problems>=2);
 assert.ok(direction(r,'warehouse_links').problems>=1);
});
test('B0-05 applies fractional quantity rules to movements without guessing an unknown unit',()=>{
 const d=fixture();d.warehouse=[
  {id:'piece',name:'Piece',objectId:'o',baseQty:2,unit:'шт.'},
  {id:'material',name:'Material',objectId:'o',baseQty:2,unit:'кг'},
  {id:'unknown',name:'Unknown',objectId:'o',baseQty:2,unit:'условная ед.'}
 ];
 d.warehouseMovements=[
  {id:'piece-move',itemId:'piece',date:'2026-01-10',kind:'issue',qty:0.5,assignee:'',notes:''},
  {id:'material-move',itemId:'material',date:'2026-01-10',kind:'restock',qty:0.5,assignee:'',notes:''},
  {id:'unknown-move',itemId:'unknown',date:'2026-01-10',kind:'restock',qty:0.5,assignee:'',notes:''}
 ];
 const r=check(d);
 assert.equal(issueFor(r,'piece-move','qty').filter(i=>i.code==='fractional_stock_quantity').length,1);
 assert.equal(issueFor(r,'material-move','qty').filter(i=>i.code==='fractional_stock_quantity').length,0);
 assert.equal(direction(r,'warehouse_movements').status,'partial');
});
test('B0-05 calculates only final warehouse balance and never invents an order for same-date movements',()=>{
 const negative=fixture();negative.warehouse=[{id:'tool',name:'Tool',objectId:'o',baseQty:1,unit:'шт.'}];
 negative.warehouseMovements=[{id:'issue',itemId:'tool',date:'2026-01-10',kind:'issue',qty:2,assignee:'',notes:''}];
 const negativeReport=check(negative);assert.ok(has(negativeReport,'negative_warehouse_balance'));
 const unordered=fixture();unordered.warehouse=[{id:'tool',name:'Tool',objectId:'o',baseQty:0,unit:'шт.'}];
 unordered.warehouseMovements=[
  {id:'issue',itemId:'tool',date:'2026-01-10',kind:'issue',qty:1,assignee:'',notes:''},
  {id:'restock',itemId:'tool',date:'2026-01-10',kind:'restock',qty:1,assignee:'',notes:''}
 ];
 const r=check(unordered);assert.equal(has(r,'negative_warehouse_balance'),false);
 const order=direction(r,'warehouse_movement_order');assert.equal(order.status,'impossible');assert.match(order.reason,/врем|поряд/i);
});
test('B0-05 treats a distinct-date intermediate deficit as a candidate and never orders same-date movements',()=>{
 const chronological=fixture();chronological.warehouse=[{id:'tool',name:'Tool',objectId:'o',baseQty:1,unit:'шт.'}];
 chronological.warehouseMovements=[
  {id:'issue',itemId:'tool',date:'2026-01-10',kind:'issue',qty:3,assignee:'',notes:''},
  {id:'restock',itemId:'tool',date:'2026-01-11',kind:'restock',qty:5,assignee:'',notes:''}
 ];
 const before=JSON.stringify(chronological),r=check(chronological);
 const candidates=r.issues.filter(i=>i.code==='possible_warehouse_intermediate_negative_balance');
 assert.equal(candidates.length,1);assert.equal(candidates[0].severity,'warning');assert.match(candidates[0].reason,/неопредел|достовер|началь/i);
 assert.equal(has(r,'negative_warehouse_balance'),false,'final balance is positive');
 assert.equal(direction(r,'warehouse_chronology').status,'partial');assert.equal(JSON.stringify(chronological),before);

 const sameDate=fixture();sameDate.warehouse=[{id:'tool',name:'Tool',objectId:'o',baseQty:1,unit:'шт.'}];
 sameDate.warehouseMovements=[
  {id:'issue',itemId:'tool',date:'2026-01-10',kind:'issue',qty:3,assignee:'',notes:''},
  {id:'restock',itemId:'tool',date:'2026-01-10',kind:'restock',qty:5,assignee:'',notes:''}
 ];
 assert.equal(count(check(sameDate),'possible_warehouse_intermediate_negative_balance'),0,'one date has no provable operation order');
});
test('B0-05/08 treats decimal source quantities exactly and keeps the raw fixture unchanged',()=>{
 const exact=fixture();exact.warehouse=[{id:'cement',name:'Cement',objectId:'o',baseQty:0.3,unit:'кг'}];
 exact.warehouseMovements=[
  {id:'issue-one',itemId:'cement',date:'2026-01-10',kind:'issue',qty:0.1,assignee:'',notes:''},
  {id:'issue-two',itemId:'cement',date:'2026-01-11',kind:'issue',qty:0.2,assignee:'',notes:''}
 ];
 const before=JSON.stringify(exact),r=check(exact);
 assert.equal(has(r,'negative_warehouse_balance'),false,'0.3 − 0.1 − 0.2 is exactly zero in the JSON quantities');
 assert.equal(count(r,'possible_warehouse_intermediate_negative_balance'),0,'daily totals with exact fractional quantities must not create a false candidate');
 assert.equal(has(r,'warehouse_quantity_overflow'),false);assert.equal(JSON.stringify(exact),before);
});
test('B0-05/08 preserves detection of a genuinely tiny fractional deficit',()=>{
 const d=fixture();d.warehouse=[{id:'cement',name:'Cement',objectId:'o',baseQty:0.3,unit:'кг'}];
 d.warehouseMovements=[
  {id:'issue-one',itemId:'cement',date:'2026-01-10',kind:'issue',qty:0.1,assignee:'',notes:''},
  {id:'issue-two',itemId:'cement',date:'2026-01-10',kind:'issue',qty:0.20000000000000004,assignee:'',notes:''}
 ];
 const before=JSON.stringify(d),r=check(d);
 assert.equal(count(r,'negative_warehouse_balance'),1,'a real decimal deficit must not disappear behind an arbitrary tolerance');
 assert.equal(has(r,'warehouse_quantity_overflow'),false);assert.equal(JSON.stringify(d),before);
});
test('B0-05/08 applies exact fractional daily totals to chronology without ordering one date',()=>{
 const distinctDates=fixture();distinctDates.warehouse=[{id:'cement',name:'Cement',objectId:'o',baseQty:0.3,unit:'кг'}];
 distinctDates.warehouseMovements=[
  {id:'issue',itemId:'cement',date:'2026-01-10',kind:'issue',qty:0.4,assignee:'',notes:''},
  {id:'restock',itemId:'cement',date:'2026-01-11',kind:'restock',qty:0.1,assignee:'',notes:''}
 ];
 const distinct=check(distinctDates);
 assert.equal(count(distinct,'possible_warehouse_intermediate_negative_balance'),1,'a fractional deficit after a completed earlier day remains a manual-review candidate');
 assert.equal(has(distinct,'negative_warehouse_balance'),false,'the later fractional replenishment restores the final total');
 const sameDate=fixture();sameDate.warehouse=[{id:'cement',name:'Cement',objectId:'o',baseQty:0.3,unit:'кг'}];
 sameDate.warehouseMovements=[
  {id:'issue',itemId:'cement',date:'2026-01-10',kind:'issue',qty:0.4,assignee:'',notes:''},
  {id:'restock',itemId:'cement',date:'2026-01-10',kind:'restock',qty:0.1,assignee:'',notes:''}
 ];
 const before=JSON.stringify(sameDate),same=check(sameDate);
 assert.equal(count(same,'possible_warehouse_intermediate_negative_balance'),0,'operations sharing a date still have no invented order');
 assert.equal(has(same,'negative_warehouse_balance'),false);assert.equal(JSON.stringify(sameDate),before);
});
test('B0-05/08 accepts finite extreme decimal quantities without treating scale as overflow',()=>{
 const d=fixture();d.warehouse=[{id:'material',name:'Material',objectId:'o',baseQty:Number.MAX_VALUE,unit:'кг'}];
 d.warehouseMovements=[
  {id:'tiny-issue',itemId:'material',date:'2026-01-10',kind:'issue',qty:Number.MIN_VALUE,assignee:'',notes:''},
  {id:'tiny-restock',itemId:'material',date:'2026-01-11',kind:'restock',qty:Number.MIN_VALUE,assignee:'',notes:''}
 ];
 const before=JSON.stringify(d),r=check(d);
 for(const code of ['warehouse_quantity_overflow','negative_warehouse_balance','possible_warehouse_intermediate_negative_balance'])assert.equal(has(r,code),false,code);
 assert.equal(JSON.stringify(d),before);
});
test('B0-05/08 preserves raw numeric lexemes and reports unsupported precision explicitly',()=>{
 const d=fixture();d.warehouse=[{id:'material',objectId:'o',baseQty:'BASE',unit:'кг'}];
 d.warehouseMovements=[{id:'issue',itemId:'material',date:'2026-01-10',kind:'issue',qty:'QTY',notes:'escaped " 123 \\ 456'}];
 const raw=JSON.stringify(d).replace('"BASE"','0.3').replace('"QTY"','0.30000000000000000001');
 assert.equal(count(diagnoseRaw(raw),'negative_warehouse_balance'),1,'JSON.parse rounding must not erase the raw deficit');
 for(const base of ['0x10','1e-4097','0.'+'0'.repeat(4096)+'1']){
  d.warehouse[0].baseQty=base;d.warehouseMovements=[];
  const before=JSON.stringify(d),r=diagnoseRaw(before);
  assert.ok(has(r,'warehouse_quantity_precision_limit'));
  assert.equal(direction(r,'warehouse_balances').status,'partial');
  assert.equal(has(r,'negative_warehouse_balance'),false);assert.equal(JSON.stringify(d),before);
 }
 d.warehouse[0].baseQty='3e-300';d.warehouseMovements=[
  {id:'one',itemId:'material',date:'2026-01-10',kind:'issue',qty:'1e-300'},
  {id:'two',itemId:'material',date:'2026-01-11',kind:'issue',qty:'2e-300'}
 ];
 const r=check(d);for(const code of ['negative_warehouse_balance','possible_warehouse_intermediate_negative_balance','warehouse_quantity_precision_limit'])assert.equal(has(r,code),false,code);
});
const quantityRaw=(qty,unit='кг',base='10')=>{
 const d=fixture();d.warehouse=[{id:'material',name:'Material',objectId:'o',baseQty:'BASE',unit}];
 d.warehouseMovements=[{id:'move',itemId:'material',date:'2026-01-10',kind:'restock',qty:'QTY'}];
 return JSON.stringify(d).replace('"BASE"',base).replace('"QTY"',qty);
};
test('B0-05/10 accepts raw and string positive underflow quantities without a false zero error',()=>{
 for(const qty of ['1e-400','"1e-400"']){
  const raw=quantityRaw(qty),r=diagnoseRaw(raw);
  assert.equal(has(r,'invalid_warehouse_movement_quantity'),false);
  assert.equal(has(r,'warehouse_quantity_precision_limit'),false);
  assert.equal(direction(r,'warehouse_movements').status,'checked');
  const backing=disk(raw),store=createDataStore(backing,KEY,fixture);
  const state=store.status(),snapshot=store.readSnapshot(),entries=[...backing.values];
  diagnoseRaw(store.readRaw());
  assert.deepEqual(backing.writes,[]);assert.deepEqual([...backing.values],entries);
  assert.deepEqual(store.status(),state);assert.deepEqual(store.readSnapshot(),snapshot);
 }
});
test('B0-05/10 detects genuine zero and negative quantities including negative underflow',()=>{
 for(const qty of ['0','-0','0e-400','-1e-400','"-1e-400"','-1']){
  assert.ok(has(diagnoseRaw(quantityRaw(qty)),'invalid_warehouse_movement_quantity'),qty);
 }
 assert.ok(has(diagnoseRaw(quantityRaw('1','кг','-1e-400')),'invalid_number'));
 assert.equal(has(diagnoseRaw(quantityRaw('1','кг','0')),'invalid_number'),false,'zero opening balance is allowed');
});
test('B0-05/10 detects fractional discrete quantities before Number rounding for bases and movements',()=>{
 for(const qty of ['1.0000000000000001','"1.0000000000000001"','1e-400']){
  const r=diagnoseRaw(quantityRaw(qty,'шт.'));
  assert.ok(has(r,'fractional_stock_quantity'),qty);
  assert.equal(direction(r,'warehouse_balances').status,'partial');
 }
 const r=diagnoseRaw(quantityRaw('1','шт.','1.0000000000000001'));
 assert.ok(r.issues.some(i=>i.code==='fractional_stock_quantity'&&i.field==='baseQty'));
});
test('B0-05/10 accepts mathematically whole representations and fractional materials',()=>{
 for(const qty of ['1','1.0','1e0','10e-1','"+1.000"','10000000000000001']){
  const r=diagnoseRaw(quantityRaw(qty,'шт.'));
  assert.equal(has(r,'fractional_stock_quantity'),false,qty);
  assert.equal(has(r,'warehouse_quantity_precision_limit'),false,qty);
 }
 assert.equal(has(diagnoseRaw(quantityRaw('1.0000000000000001')),'fractional_stock_quantity'),false);
});
test('B0-05/10 marks uncheckable quantity precision partial without a false invalid-quantity error',()=>{
 for(const qty of ['1e-4097','"1e-4097"','"0x10"','"0.'+'0'.repeat(4096)+'1"']){
  const raw=quantityRaw(qty,'шт.'),r=diagnoseRaw(raw);
  assert.ok(has(r,'warehouse_quantity_precision_limit'),qty.slice(0,20));
  assert.equal(has(r,'invalid_warehouse_movement_quantity'),false);
  assert.equal(has(r,'fractional_stock_quantity'),false);
  assert.equal(direction(r,'warehouse_movements').status,'partial');
  assert.equal(direction(r,'warehouse_balances').status,'partial');
 }
});
test('B0-05/10 handles an unavailable exact engine and previously rounded legacy data',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),context={module:{exports:{}},BigInt:undefined};
 vm.runInNewContext(fs.readFileSync(require.resolve('../storage.js'),'utf8'),context);
 const r=context.module.exports.diagnoseRaw(quantityRaw('1','шт.'));
 assert.ok(has(r,'warehouse_quantity_precision_limit'));
 assert.equal(has(r,'invalid_warehouse_movement_quantity'),false);
 assert.equal(direction(r,'warehouse_movements').status,'partial');
 // A prior parse/serialization has already erased these lexemes; diagnostics
 // can only assess the saved values and must never invent lost precision.
 const rounded=JSON.stringify(JSON.parse(quantityRaw('1.0000000000000001','шт.')));
 assert.equal(has(diagnoseRaw(rounded),'fractional_stock_quantity'),false);
 const zero=JSON.stringify(JSON.parse(quantityRaw('1e-400')));
 assert.ok(has(diagnoseRaw(zero),'invalid_warehouse_movement_quantity'));
});
test('B0-05 marks warehouse links partial when the optional movement collection is absent',()=>{
 const d=fixture();d.warehouse=[{id:'tool',name:'Tool',objectId:'o',baseQty:1,unit:'шт.'}];
 const r=check(d),links=direction(r,'warehouse_links');
 assert.equal(links.status,'partial');assert.match(links.reason,/warehouseMovements|движени/i);
 assert.equal(r.complete,true,'optional collections stay absent in raw JSON without redefining B0-04 completeness');
});
test('B0-05/06–08 detects non-finite warehouse arithmetic without replacing it with zero',()=>{
 const d=fixture();d.warehouse=[{id:'tool',name:'Tool',objectId:'o',baseQty:Number.MAX_VALUE,unit:'шт.'}];
 d.warehouseMovements=[{id:'restock',itemId:'tool',date:'2026-01-10',kind:'restock',qty:Number.MAX_VALUE,assignee:'',notes:''}];
 const before=JSON.stringify(d),r=check(d);
 assert.ok(has(r,'warehouse_quantity_overflow'));
 assert.notEqual(direction(r,'warehouse_balances').status,'checked');assert.notEqual(direction(r,'warehouse_chronology').status,'checked');
 assert.equal(has(r,'negative_warehouse_balance'),false);assert.equal(JSON.stringify(d),before);
});
test('B0-05 flags exact movement candidates and serial matches after trim/case-folding without changing original strings',()=>{
 const d=fixture();d.warehouse=[
  {id:'one',name:'One',objectId:'o',baseQty:3,unit:'шт.',serial:'  AbC-42  '},
  {id:'two',name:'Two',objectId:'o',baseQty:3,unit:'шт.',serial:'abc-42'},
  {id:'three',name:'Three',objectId:'o',baseQty:3,unit:'шт.',serial:'   '}
 ];
 const base={itemId:'one',date:'2026-01-10',kind:'issue',qty:1,assignee:'Worker',notes:'Act'};
 d.warehouseMovements=[{id:'first',...base},{id:'second',...base},{id:'different-note',...base,notes:'Other'}];
 const before=JSON.stringify(d),r=check(d);
 assert.equal(count(r,'possible_duplicate_warehouse_movement'),2);
 assert.deepEqual(r.issues.filter(i=>i.code==='possible_duplicate_warehouse_movement').map(i=>i.record.id).sort(),['first','second']);
 assert.equal(count(r,'possible_duplicate_serial'),2);
 const serialIssues=r.issues.filter(i=>i.code==='possible_duplicate_serial');assert.ok(serialIssues.every(i=>i.related.length===1));
 assert.equal(JSON.stringify(d),before);
});
test('B0-05 bounds related records for large duplicate serial groups',()=>{
 const d=fixture();d.warehouse=Array.from({length:5000},(_,i)=>({id:'tool'+i,name:'Tool '+i,objectId:'o',baseQty:1,unit:'шт.',serial:'DUPLICATE-SERIAL'}));
 const r=check(d),duplicates=r.issues.filter(i=>i.code==='possible_duplicate_serial');
 assert.equal(duplicates.length,5000);assert.ok(duplicates.every(i=>i.related.length===10));
});
test('B0-05 reports only structurally or syntactically recognizable embedded attachment defects and never leaks payloads',()=>{
 const d=fixture();d.works=[
  {id:'empty-photo',date:'2026-01-10',objectId:'o',photos:['']},
  {id:'bad-photo',date:'2026-01-10',objectId:'o',photos:['data:image/png;base64,SGVsbG8=']},
  {id:'shape-photo',date:'2026-01-10',objectId:'o',photos:'not-an-array'}
 ];
 d.expenses=[
  {id:'empty-receipt',date:'2026-01-10',amount:1,category:'Материалы',paymentSource:'other',receipts:[{id:'r1',name:'',data:''}]},
  {id:'bad-receipt',date:'2026-01-10',amount:1,category:'Материалы',paymentSource:'other',receipts:[{id:'r2',name:'secret.pdf',data:'data:application/pdf;base64,SGVsbG8='}]},
  {id:'shape-receipt',date:'2026-01-10',amount:1,category:'Материалы',paymentSource:'other',receipts:'not-an-array'}
 ];
 const r=check(d);
 for(const code of ['empty_photo_attachment','corrupt_photo_attachment','invalid_photos_structure','empty_receipt_attachment','corrupt_receipt_attachment','invalid_receipts_structure'])assert.ok(has(r,code),code);
 assert.equal(direction(r,'attachments').status,'partial');
 assert.ok(!JSON.stringify(r).includes('SGVsbG8='));
 assert.equal(direction(r,'attachment_full_integrity').status,'impossible');
});
test('B0-05 exposes required unavailable directions separately from findings and complete',()=>{
 const r=check(fixture());
 for(const id of ['delivery_receiving','tolling_materials','inventory','kits','historical_responsible']){
  const item=direction(r,id);assert.equal(item.status,'impossible',id);assert.ok(item.reason);
 }
 assert.equal(r.complete,true,'unsupported B0-05 model areas must not redefine the B0-04 complete contract');
});
