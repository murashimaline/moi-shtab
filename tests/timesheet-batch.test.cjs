const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const storage=require('../storage.js');

const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
const extract=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end));
const plain=value=>JSON.parse(JSON.stringify(value));
const date='2027-01-02';
const row=(patch={})=>({id:'old',workerId:'w',date,status:'Смена',hours:8,shifts:1,shiftType:'day',ratePerShift:9000,fine:'100',deduction:50,...patch});
const data=(patch={})=>({
 version:3,workers:[{id:'w',name:'Тест',rate:12000},{id:'v',name:'Тест',rate:6000}],
 attendance:[],payments:[],objects:[],tasks:[],works:[],goals:[],expenses:[],...patch
});
const target=(workerId='w',day=date)=>({workerId,date:day});
const editTarget=record=>({id:record.id,workerId:record.workerId,date:record.date,previous:JSON.stringify(record)});
const fields=(patch={})=>({status:'Смена',hours:'8',shiftType:'day',objectId:'',notes:'',...patch});
function harness(db,crypto=require('node:crypto').webcrypto){
 const ProrabkaStorage={...storage,createIdAllocator:rows=>storage.createIdAllocator(rows,crypto)};
 const c=vm.createContext({db,ProrabkaStorage});
 vm.runInContext(extract('function wageCents','function attendanceWarnings'),c);
 vm.runInContext(extract('function attendanceStatusFields','function confirmedHistoricalRate'),c);
 vm.runInContext(extract('function wageWeekRange','function weeklyPayroll'),c);
 vm.runInContext(extract('function shiftTimesheetDate','const timesheetCalendar=document'),c);
 return c;
}

test('calendar uses Monday through Sunday across months and years',()=>{
 const c=harness(data());
 assert.deepEqual(plain(c.timesheetWeekDates(date)),['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01',date,'2027-01-03']);
 assert.deepEqual(plain(c.timesheetWeekDates('2028-02-29')).slice(0,4),['2028-02-28','2028-02-29','2028-03-01','2028-03-02']);
 assert.equal(c.timesheetDateInRange('2027-02-29'),false);
});

test('same names use different worker IDs and new shifts snapshot rates and calculate accruals',()=>{
 const db=data(),c=harness(db),before=JSON.stringify(db);
 const plan=c.prepareTimesheetBatch(db,'create',[target(),target('v')],fields({status:'Часы',hours:'2.5'}));
 assert.deepEqual(plain(plan.errors),[]);
 assert.deepEqual(plain(plan.entries.map(e=>[e.next.workerId,e.next.ratePerShift,e.next.shifts,e.after])),[
  ['w',12000,0.3125,3750],['v',6000,0.3125,1875]
 ]);
 const batch=c.timesheetBatchCandidate(db,plan.entries);
 assert.equal(new Set(batch.next.attendance.map(r=>r.id)).size,2);
 assert.deepEqual(plain(batch.recordChanges.map(change=>change.mode)),['create','create']);
 assert.deepEqual(plain(batch.next.attendance.map(r=>[r.fine,r.deduction])),[[0,0],[0,0]]);
 assert.equal(JSON.stringify(db),before);
});

test('new half and absent shifts use manual status rules and invalid rates fail',()=>{
 const db=data({workers:[{id:'w',rate:6000},{id:'v',rate:0}]}),c=harness(db);
 const half=c.prepareTimesheetBatch(db,'create',[target()],fields({status:'Половина смены',hours:'4'}));
 assert.equal(half.entries[0].next.shifts,0.5);
 assert.equal(half.after,3000);
 const absent=c.prepareTimesheetBatch(db,'create',[target('v')],fields({status:'Отсутствовал'}));
 assert.deepEqual(plain(absent.entries.map(({next,after})=>[next.shifts,next.hours,after])),[[0,0,0]]);
 assert.match(c.prepareTimesheetBatch(db,'create',[target('v')],fields()).errors[0].message,/Ставка неизвестна/);
 assert.match(c.prepareTimesheetBatch(db,'create',[target()],fields({status:'Часы',hours:'0'})).errors[0].message,/почасовой/);
});

test('final day is checked across stored and selected rows, with explicit day and night allowed',()=>{
 const db=data({attendance:[row()]}),c=harness(db);
 for(const patch of [{},{shiftType:'unspecified'},{shiftType:'night',status:'Отсутствовал'},{shiftType:'night',hours:'16.25'}]){
  assert.match(c.prepareTimesheetBatch(db,'create',[target('v'),target()],fields(patch)).errors[0].message,/конфликт/i);
 }
 assert.equal(c.prepareTimesheetBatch(db,'create',[target()],fields({shiftType:'night',hours:'16'})).errors.length,0);
 assert.match(c.prepareTimesheetBatch(db,'create',[target('v'),target('v')],fields()).errors[0].message,/повторно/);
 db.attendance.push(row({id:'night',shiftType:'night'}));
 const both=db.attendance.map(editTarget);
 assert.match(c.prepareTimesheetBatch(db,'edit',both,{hours:'13'}).errors[0].message,/больше 24/);
 assert.match(c.prepareTimesheetBatch(db,'edit',both,{status:'Отсутствовал'}).errors[0].message,/конфликт/i);
});

test('correction recalculates hours and shifts without replacing IDs, historical rates or deductions',()=>{
 const old=row({notes:'Прежнее',extra:'сохраняется'}),db=data({attendance:[old]});
 const c=harness(db),selected=[editTarget(old)];
 const plan=c.prepareTimesheetBatch(db,'edit',selected,{status:'Часы',hours:'4',notes:'Новое',ratePerShift:12000,workerId:'v'});
 assert.deepEqual(plain(plan.errors),[]);
 assert.deepEqual(plain(plan.entries[0].next),{...old,status:'Часы',hours:'4',shifts:0.5,notes:'Новое'});
 assert.deepEqual([plan.before,plan.after],[9000,4500]);
 assert.deepEqual(plain(c.timesheetBatchCandidate(db,plan.entries).recordChanges),[
  {collection:'attendance',id:old.id,mode:'edit',previous:JSON.stringify(old)}
 ]);
 const absent=c.prepareTimesheetBatch(db,'edit',selected,{status:'Отсутствовал'});
 assert.deepEqual(plain(absent.entries[0].next),{...old,status:'Отсутствовал',hours:0,shifts:0});
});

test('imported, missing-rate, absent-to-paid and stale shift edits are rejected',()=>{
 for(const [patch,message] of [
  [{importSourceKey:'legacy'},/Импортированная/],[{ratePerShift:null},/историческую ставку/],
  [{status:'Отсутствовал',hours:0,shifts:0},/индивидуальную форму/]
 ]){
  const old=row(patch),db=data({attendance:[old]}),c=harness(db);
  assert.match(c.prepareTimesheetBatch(db,'edit',[editTarget(old)],{status:'Смена'}).errors[0].message,message);
 }
 const old=row(),db=data({attendance:[old]}),c=harness(db),selected=editTarget(old);
 old.notes='Изменено';
 assert.match(c.prepareTimesheetBatch(db,'edit',[selected],{notes:'Новое'}).errors[0].message,/изменилась/);
 assert.match(c.prepareTimesheetBatch(db,'create',[target('deleted')],fields()).errors[0].message,/отсутствует/);
});

test('notes-only correction and re-entry of the same hours preserve legacy accrual',()=>{
 const old=row({shifts:'1.5'}),db=data({attendance:[old]}),c=harness(db),selected=[editTarget(old)];
 const plan=c.prepareTimesheetBatch(db,'edit',selected,{notes:'Комментарий',hours:'8'});
 assert.deepEqual(plain(plan.entries[0].next),{...old,notes:'Комментарий'});
 assert.deepEqual([plan.before,plan.after],[13500,13500]);
 assert.equal(c.prepareTimesheetBatch(db,'edit',selected,{hours:'8'}).entries.length,0);
});

test('approved reports and weekly payments guard the bulk path, ordinary payments are shown for reconciliation',()=>{
 const old=row(),paid={id:'pay',workerId:'w',kind:'Выплата',date:'2027-01-05',amount:3000,weeklyWeekStart:'2026-12-28',weeklyWeekEnd:'2027-01-03'};
 const advance={id:'advance',workerId:'w',kind:'Аванс',date:'2026-12-30',amount:500};
 const db=data({attendance:[old],payments:[paid,advance],advanceReports:{'2026-12':{status:'approved'},'2027-01':{status:'draft'}}}),c=harness(db);
 assert.match(c.prepareTimesheetBatch(db,'create',[target('w','2026-12-31')],fields()).errors[0].message,/Дата закрыта/);
 assert.match(c.prepareTimesheetBatch(db,'edit',[editTarget(old)],{notes:'Новое'}).errors[0].message,/недельная выплата/);
 assert.equal(c.prepareTimesheetBatch(db,'create',[target('w','2027-01-03')],fields()).errors.length,0);
 db.payments=[advance];
 const plan=c.prepareTimesheetBatch(db,'edit',[editTarget(old)],{status:'Половина смены'});
 assert.deepEqual(plain(plan.payments),[advance]);
 assert.deepEqual([plan.before,plan.after],[9000,4500]);
 db.advanceReports['2027-01'].status='approved';
 assert.match(c.prepareTimesheetBatch(db,'edit',[editTarget(old)],{notes:'Новое'}).errors[0].message,/Дата закрыта/);
});

test('ID allocation failure leaves candidate input untouched',()=>{
 const db=data(),before=JSON.stringify(db);
 const c=harness(db,{randomUUID:()=> '00000000-0000-4000-8000-000000000001'});
 const plan=c.prepareTimesheetBatch(db,'create',[target(),target('v')],fields());
 assert.throws(()=>c.timesheetBatchCandidate(db,plan.entries),/уникальный ID/);
 assert.equal(JSON.stringify(db),before);
 const unavailable=harness(db,{});
 assert.throws(()=>unavailable.timesheetBatchCandidate(db,plan.entries),/криптографического/);
});
