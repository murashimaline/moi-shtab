const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {create,validate}=require('../storage.js');
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
const plain=x=>JSON.parse(JSON.stringify(x));
function fixture(){return {version:3,objects:[],workers:[{id:'w',name:'Тест',rate:9000,phone:'synthetic'}],warehouse:[],tasks:[],works:[],goals:[],attendance:[{id:'old',workerId:'w',date:'2026-04-01',status:'Смена',shifts:1}],payments:[],expenses:[],income:[],accountable:[],schedule:[],warehouseMovements:[]};}
function payload(paid=false){return {kind:'prorabka-timesheet-v1',year:2026,rate:6000,workers:[{name:'Тест',rate:6000}],entries:[{sourceKey:'t26_'+'a'.repeat(24),workerName:'Тест',date:'2026-05-01',shiftType:'day',sheet:'Май',cell:'A1',objectName:'Тестовый объект',shifts:1,rate:6000,paid,fill:paid?'00B050':'',accrued:6000,fine:0,paidAmount:paid?6000:0,rawValue:1}],payments:paid?[{sourceKey:'p26_'+'b'.repeat(24),workerName:'Тест',date:'2026-05-31',kind:'Выплата',amount:6000,sourceKeys:['t26_'+'a'.repeat(24)]}]:[],review:[]};}
function harness(data=fixture()){
 let serial=0;const disk={raw:JSON.stringify(data),fail:false,getItem(){return this.raw},setItem(k,v){if(this.fail)throw Error('quota');this.raw=v}};
 const persistence=create(disk,'db',fixture);
 const c=vm.createContext({db:persistence.initial(),persistence,uid:()=> 'new'+(++serial),document:{getElementById:()=>null},renderAll:()=>{},storageNotice:()=>{},alert:()=>{},console,esc:String,money:String,table:(headers,rows)=>headers.join('|')+rows.join('')});
 vm.runInContext(html.slice(html.indexOf('function wageCents'),html.indexOf('/* Finance extension')),c);
 vm.runInContext(html.slice(html.indexOf('const timesheetNorm='),html.indexOf('function attendanceAmount')),c);
 vm.runInContext(html.slice(html.indexOf('function periodOK'),html.indexOf('function renderPayroll')),c);
 vm.runInContext(html.slice(html.indexOf('function save(options)'),html.indexOf("window.addEventListener('storage'")),c);
 vm.runInContext(html.slice(html.indexOf('function prepareTimesheetImport'),html.indexOf('let pendingTimesheet=')),c);
 return {c,disk,persistence};
}
test('B0-01 preview and actual commit preserve 9000 legacy accrual and snapshot 6000 for new shift',()=>{
 const {c,disk}=harness(),before=JSON.stringify(c.db),raw=disk.raw,p=payload();
 const oldPayroll=plain(c.payrollCalc('2026-04-01','2026-04-30'));
 const plan=c.prepareTimesheetImport(p);
 assert.equal(JSON.stringify(c.db),before);assert.equal(disk.raw,raw);
 assert.equal(plan.next.workers[0].rate,9000);assert.deepEqual(plain(plan.next.attendance[0]),plain(c.db.attendance[0]));
 for(const completed of [false,true]){const preview=c.timesheetPlanHTML(plan,completed);assert.match(preview,/Ставки существующих сотрудников не меняются/);assert.match(preview,/6000 ₽/);assert.doesNotMatch(preview,/Обновится ставок|Обновлено ставок/);}
 const result=c.commitTimesheetImport(p);assert.deepEqual(plain(result.stats),plain(plan.stats));
 assert.equal(c.db.workers[0].rate,9000);assert.equal(c.attendanceAmount(c.db.attendance[0]),9000);
 assert.equal(c.db.attendance[0].ratePerShift,undefined);assert.equal(c.db.attendance[1].ratePerShift,6000);assert.equal(c.attendanceAmount(c.db.attendance[1]),6000);
 assert.deepEqual(plain(c.payrollCalc('2026-04-01','2026-04-30')),oldPayroll);
 assert.equal(c.payrollCalc('2026-05-01','2026-05-31')[0].accrued,6000);
 const reload=create(disk,'db',fixture).initial();assert.deepEqual(reload.attendance,plain(c.db.attendance));assert.equal(reload.workers[0].rate,9000);
});
test('B0-01 repeated paid import skips shifts and payments without changing workers or history',()=>{
 const {c}=harness(),p=payload(true);c.commitTimesheetImport(p);
 const workers=plain(c.db.workers),attendance=plain(c.db.attendance),payments=plain(c.db.payments),history=plain(c.db.financeHistory);
 const again=c.commitTimesheetImport(p);assert.equal(again.stats.entriesAdded,0);assert.equal(again.stats.paymentsAdded,0);assert.equal(again.stats.entriesSkipped,1);assert.equal(again.stats.paymentsSkipped,1);
 assert.deepEqual(plain(c.db.workers),workers);assert.deepEqual(plain(c.db.attendance),attendance);assert.deepEqual(plain(c.db.payments),payments);assert.deepEqual(plain(c.db.financeHistory),history);
});
test('B0-01 existing snapshots, missing and zero employee rates remain untouched; new workers get import rate',()=>{
 for(const rate of [null,0,'9000']){const data=fixture();data.workers[0].rate=rate;data.attendance[0].ratePerShift=7500;const {c}=harness(data);c.commitTimesheetImport(payload());assert.equal(c.db.workers[0].rate,rate);assert.equal(c.attendanceAmount(c.db.attendance[0]),7500);assert.equal(c.attendanceAmount(c.db.attendance[1]),6000);}
 const data=fixture();data.workers=[];data.attendance=[];const {c}=harness(data);const result=c.commitTimesheetImport(payload());assert.equal(result.stats.workersAdded,1);assert.equal(c.db.workers[0].rate,6000);assert.equal(c.attendanceAmount(c.db.attendance[0]),6000);
});
test('B0-01 malformed input and late payment conflicts leave memory and disk unchanged',()=>{
 for(const mode of ['invalid','payment-conflict']){const data=fixture();if(mode==='payment-conflict')data.payments=[{id:'manual',workerId:'w',date:'2026-05-15',kind:'Аванс',amount:100}];const {c,disk}=harness(data),before=JSON.stringify(c.db),raw=disk.raw,p=payload(true);if(mode==='invalid')p.entries[0].accrued=1;
 assert.throws(()=>c.commitTimesheetImport(p),mode==='invalid'?/Суммы/:/ручная выплата или аванс/);assert.equal(JSON.stringify(c.db),before);assert.equal(disk.raw,raw);}
});
test('B0-01 changed source fingerprints and manual shift conflicts still reject atomically',()=>{
 const {c,disk}=harness(),p=payload();c.commitTimesheetImport(p);const before=JSON.stringify(c.db),raw=disk.raw;p.entries[0].cell='B1';assert.throws(()=>c.commitTimesheetImport(p),/изменился/);assert.equal(JSON.stringify(c.db),before);assert.equal(disk.raw,raw);
 const data=fixture();data.attendance[0].date='2026-05-01';const h=harness(data),saved=h.disk.raw;assert.throws(()=>h.c.commitTimesheetImport(payload()),/ручная запись/);assert.equal(h.disk.raw,saved);
});
test('B0-01 failed storage write rolls back the entire import; retry succeeds',()=>{
 const {c,disk}=harness(),before=JSON.stringify(c.db),raw=disk.raw;disk.fail=true;
 assert.throws(()=>c.commitTimesheetImport(payload(true)),/не удалось сохранить/);assert.equal(JSON.stringify(c.db),before);assert.equal(disk.raw,raw);
 disk.fail=false;c.commitTimesheetImport(payload(true));assert.equal(c.db.attendance.length,2);assert.equal(c.db.payments.length,1);assert.equal(c.db.workers[0].rate,9000);
});
test('B0-01 closed reports and dangling references still block specialized import',()=>{
 for(const mode of ['closed','orphan']){const data=fixture();if(mode==='closed')data.advanceReports={'2026-05':{status:'approved'}};else data.attendance[0].workerId='missing';const {c,disk}=harness(data),before=JSON.stringify(c.db),raw=disk.raw;
 assert.throws(()=>c.commitTimesheetImport(payload(true)),/не удалось сохранить/);assert.equal(JSON.stringify(c.db),before);assert.equal(disk.raw,raw);}
});
test('B0-01 stale-tab protection rejects apply after successful preview',()=>{
 const {c,disk}=harness(),before=JSON.stringify(c.db);c.prepareTimesheetImport(payload());const other=validate(fixture());other.workers[0].rate=10000;disk.raw=JSON.stringify(other);const raw=disk.raw;
 assert.throws(()=>c.commitTimesheetImport(payload()),/не удалось сохранить/);assert.equal(disk.raw,raw);assert.equal(JSON.stringify(c.db),before);
});
