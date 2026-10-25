const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
function context(){
 let serial=0;const c=vm.createContext({uid:()=> 'new'+(++serial),db:{workers:[{id:'w',name:'Тест',rate:6000}],attendance:[],payments:[]}});
 vm.runInContext(html.slice(html.indexOf('function wageCents'),html.indexOf('/* Finance extension')),c);
 vm.runInContext(html.slice(html.indexOf('function periodOK'),html.indexOf('function renderPayroll')),c);return c;
}
const row=(patch={})=>({id:'a',workerId:'w',date:'2026-01-10',status:'Смена',shifts:1,hours:8,shiftType:'day',fine:0,deduction:0,...patch});
test('full, half and absent follow status; legacy source is untouched',()=>{
 const c=context();for(const [status,expected] of [['Смена',6000],['Половина смены',3000],['Отсутствовал',0]]){const a=row({status});assert.equal(c.attendanceAmount(a),expected);assert.equal(a.shifts,1)}
 assert.equal(c.attendanceAmount(row({status:undefined,shifts:'1.5',ratePerShift:'6000'})),9000);
});
test('new manual records snapshot rate; subsequent rate change and editing preserve accrual',()=>{
 const c=context(),a=c.prepareManualAttendance(row({status:'Половина смены',shifts:99}));assert.equal(a.shifts,0.5);assert.equal(a.ratePerShift,6000);c.db.attendance.push(a);c.db.workers[0].rate=8000;assert.equal(c.attendanceAmount(a),3000);
 assert.equal(c.prepareManualAttendance({...a,notes:'правка'}).ratePerShift,6000);assert.equal(c.prepareManualAttendance(row({id:'b',date:'2026-01-11'})).ratePerShift,8000);
});
test('unknown rate blocks paid new shifts, warns for legacy records, allows absence',()=>{
 const c=context();c.db.workers[0].rate=null;assert.throws(()=>c.prepareManualAttendance(row()),/Ставка/);assert.ok(c.attendanceWarnings(row()).length);assert.equal(c.attendanceAmount(row()),0);assert.equal(c.prepareManualAttendance(row({status:'Отсутствовал'})).shifts,0);
});
test('legacy missing rate keeps approved live fallback with warnings until explicit confirmation',()=>{
 const c=context(),a=row();c.db.attendance.push(a);assert.throws(()=>c.prepareManualAttendance({...a,notes:'правка'}),/Историческая ставка/);c.db.workers[0].rate=7000;assert.equal(c.attendanceAmount(a),7000);assert.equal(a.ratePerShift,undefined);assert.ok(c.attendanceWarnings(a).length);assert.equal(c.attendanceAmount({...a,ratePerShift:''}),7000);
});
test('duplicate, unspecified and absence conflict; explicit separate day/night allowed',()=>{
 const c=context();c.db.attendance.push(row({ratePerShift:6000}));for(const shiftType of ['day','unspecified',''])assert.throws(()=>c.prepareManualAttendance(row({id:'b',shiftType})),/конфликт/);
 assert.throws(()=>c.prepareManualAttendance(row({id:'b',shiftType:'night',status:'Отсутствовал'})),/конфликт/);assert.equal(c.prepareManualAttendance(row({id:'b',shiftType:'night'})).shifts,1);assert.equal(c.prepareManualAttendance(row({ratePerShift:6000})).id,'a');
});
test('imported records cannot be silently reinterpreted by editing; missing legacy hours warn',()=>{
 const c=context(),a=row({importSourceKey:'t26_source',ratePerShift:6000});c.db.attendance.push(a);assert.throws(()=>c.prepareManualAttendance(a),/Импортированную/);const legacy=row({status:'Часы',hours:'',shifts:'0.25'});assert.equal(c.attendanceAmount(legacy),1500);assert.match(c.attendanceWarnings(legacy).join(' '),/Часы неизвестны/);
});
test('fine/deduction cannot repeat between attendance and payments in either order',()=>{
 for(const [field,kind] of [['fine','Штраф'],['deduction','Удержание']]){const c=context(),a=row({[field]:100,ratePerShift:6000}),p={id:'p',workerId:'w',date:a.date,kind,amount:'100'};c.db.attendance.push(a);assert.throws(()=>c.checkPayment(p),/повторное/);c.db.attendance=[];c.db.payments.push(p);assert.throws(()=>c.prepareManualAttendance(a),/повторное/)}
});
test('duplicate payments blocked; editing the same payment allowed',()=>{
 const c=context(),p={id:'p',workerId:'w',date:'2026-01-31',kind:'Выплата',amount:100};c.db.payments.push(p);assert.doesNotThrow(()=>c.checkPayment(p));assert.throws(()=>c.checkPayment({...p,id:'q'}),/дубль/);
});
test('decimal half kopecks round away from zero; rounded source amounts sum exactly',()=>{
 const c=context();for(const [v,n] of [[1.005,101],[10.075,1008],[-1.005,-101],['0.0049',0],[1e-7,0],[1e5,10000000]])assert.equal(c.wageCents(v),n);assert.equal(c.wageSum([0.105,0.105]),0.22);
 c.db.attendance=[row({ratePerShift:0.21,status:'Половина смены'}),row({id:'b',ratePerShift:0.21,status:'Половина смены',date:'2026-01-11'})];assert.equal(c.payrollCalc('2026-01-01','2026-01-31')[0].accrued,0.22);
});
test('fines and deductions remain separate from cash payments',()=>{
 const c=context();c.db.attendance=[row({ratePerShift:6000,fine:100,deduction:50})];c.db.payments=[{workerId:'w',date:'2026-01-31',kind:'Штраф',amount:25},{workerId:'w',date:'2026-01-31',kind:'Аванс',amount:500}];const r=c.payrollCalc('2026-01-01','2026-01-31')[0];assert.equal(r.fines,125);assert.equal(r.deductions,50);assert.equal(r.advances,500);assert.equal(r.balance,5325);
});
test('payroll export uses actual calculated values and labels period movement',()=>{
 const c=context(),handlers={};c.db.attendance=[row({status:'Половина смены',ratePerShift:6000})];c.document={getElementById:id=>({value:id==='payFrom'?'2026-01-01':'2026-01-31',addEventListener:(_,fn)=>handlers[id]=fn})};c.today=()=> '2026-01-31';c.excelXML=(...args)=>c.exported=args;
 const start=html.indexOf("document.getElementById('exportPayrollExcel').addEventListener");vm.runInContext(html.slice(start,html.indexOf('\n',start)),c);handlers.exportPayrollExcel();assert.equal(c.exported[2][0][2],3000);assert.ok(c.exported[1].some(h=>/Движение периода/.test(h)));
});
test('January debt, February payment and subsequent overpayment use actual dates',()=>{
 const c=context();c.db.attendance=[row({ratePerShift:6000})];c.db.payments=[{id:'p',workerId:'w',date:'2026-02-10',kind:'Выплата',amount:6000}];
 let jan=c.payrollCalc('2026-01-01','2026-01-31')[0],feb=c.payrollCalc('2026-02-01','2026-02-28')[0];assert.deepEqual([jan.openingDebt,jan.movement,jan.closingDebt],[0,6000,6000]);assert.deepEqual([feb.openingDebt,feb.movement,feb.closingDebt],[6000,-6000,0]);
 c.db.payments[0].amount=7000;feb=c.payrollCalc('2026-02-01','2026-02-28')[0];assert.equal(feb.closingDebt,-1000);assert.equal(c.payrollCalc('2026-03-01','2026-03-31')[0].openingDebt,-1000);assert.equal(c.payrollCalc('2026-01-01','2026-01-31')[0].closingDebt,6000);
});
test('debt carries through empty months and year boundary, partial periods split exactly once',()=>{
 const c=context();c.db.attendance=[row({date:'2025-12-31',ratePerShift:6000,fine:100,deduction:50})];c.db.payments=[{workerId:'w',date:'2026-02-01',kind:'Аванс',amount:1000},{workerId:'w',date:'2026-02-28',kind:'Выплата',amount:4850}];
 assert.equal(c.payrollCalc('2026-01-01','2026-01-31')[0].closingDebt,5850);assert.equal(c.payrollCalc('2026-02-01','2026-02-01')[0].closingDebt,4850);assert.equal(c.payrollCalc('2026-02-02','2026-02-28')[0].openingDebt,4850);assert.equal(c.payrollCalc('2026-02-02','2026-02-28')[0].closingDebt,0);assert.equal(c.payrollCalc('','2026-02-28')[0].closingDebt,0);
});
test('removed employee historical debt is still included without rewriting source data',()=>{
 const c=context();c.db.attendance=[row({ratePerShift:6000})];c.db.workers=[];const r=c.payrollCalc('2026-02-01','2026-02-28')[0];assert.equal(r.w.missing,true);assert.equal(r.openingDebt,6000);assert.equal(c.db.workers.length,0);
});
test('approved hourly rule uses shift rate / 8 * hours and snapshots it; rejects invalid hours',()=>{
 const c=context(),a=c.prepareManualAttendance(row({status:'Часы',hours:'2.5',shifts:99}));assert.equal(a.shifts,0.3125);assert.equal(a.ratePerShift,6000);assert.equal(c.attendanceAmount(a),1875);c.db.workers[0].rate=8000;assert.equal(c.attendanceAmount(a),1875);
 for(const hours of ['',0,-1,25,'oops'])assert.throws(()=>c.prepareManualAttendance(row({status:'Часы',hours})),/укажите часы/);
 assert.equal(c.attendanceAmount(row({status:'Часы',hours:4,shifts:1,ratePerShift:6000})),3000);
});
test('payroll and financial wage totals share source rounding; cash functions are untouched',()=>{
 const c=context();c.db.expenses=[];c.db.income=[];c.db.attendance=[row({ratePerShift:0.21,status:'Половина смены',fine:0.005}),row({id:'b',date:'2026-01-11',ratePerShift:0.21,status:'Половина смены'})];
 vm.runInContext(html.slice(html.indexOf('function financeMetrics'),html.indexOf('function financeCategories')),c);const pay=c.payrollCalc('2026-01-01','2026-01-31')[0],fin=c.financeMetrics('2026-01-01','2026-01-31');assert.equal(fin.accrued,pay.accrued);assert.equal(fin.fines,pay.fines);assert.equal(fin.wagesNet,pay.netAccrued);
});
test('weekly preview separates weekly earnings, weekly cash and debt as of payment date',()=>{
 const c=context();c.db.attendance=[row({date:'2026-01-10',ratePerShift:6000}),row({id:'b',date:'2026-02-02',status:'Половина смены',ratePerShift:6000,fine:100})];c.db.payments=[{workerId:'w',date:'2026-02-03',kind:'Аванс',amount:1000}];
 const w=c.weeklyPayroll('2026-02-04','2026-02-06')[0];assert.deepEqual([w.from,w.to,w.accrued,w.netAccrued,w.weekPaid,w.totalDebt,w.suggestedPayment],['2026-02-02','2026-02-08',3000,2900,1000,7900,2900]);assert.equal(c.weeklyPayroll('2026-02-04','2026-02-01')[0].totalDebt,6000);
});
test('weekly actual payments keep date, employee and source; duplicate week blocked across dates',()=>{
 const c=context(),p=c.prepareWeeklyPayments([{workerId:'w',amount:'123.45'}],'2026-01-31','2026-02-02','accountable')[0];assert.deepEqual([p.date,p.workerId,p.kind,p.amount,p.paymentSource,p.weeklyWeekStart,p.weeklyWeekEnd],['2026-02-02','w','Выплата',123.45,'accountable','2026-01-26','2026-02-01']);c.db.payments.push(p);assert.throws(()=>c.prepareWeeklyPayments([{workerId:'w',amount:200}],'2026-01-30','2026-02-03','other'),/уже сохранена/);assert.equal(c.db.payments.length,1);
});
test('weekly batch preparation is atomic; empty/zero skip workers, custom amounts allowed',()=>{
 const c=context();c.db.workers.push({id:'v',name:'Второй',rate:5000});assert.throws(()=>c.prepareWeeklyPayments([{workerId:'w',amount:100},{workerId:'v',amount:-1}],'2026-02-01','2026-02-02','other'),/отрицательной/);assert.equal(c.db.payments.length,0);
 const p=c.prepareWeeklyPayments([{workerId:'w',amount:''},{workerId:'v',amount:7000}],'2026-02-01','2026-02-02','other');assert.equal(p.length,1);assert.equal(p[0].workerId,'v');assert.equal(p[0].amount,7000);assert.throws(()=>c.prepareWeeklyPayments([{workerId:'w',amount:0}],'2026-02-01','2026-02-02','other'),/положительную/);
});
test('weekly range handles month/year boundaries and rejects invalid dates',()=>{
 const c=context();assert.deepEqual(Object.values(c.wageWeekRange('2026-01-01')),['2025-12-29','2026-01-04']);assert.throws(()=>c.wageWeekRange('2026-02-30'),/Некорректная/);assert.throws(()=>c.wageWeekRange(''),/Выберите/);
});
test('manual historical rate confirmation freezes only selected legacy record and preserves source',()=>{
 const c=context(),a=row({hours:'',status:undefined,shifts:'0.5',importSourceKey:'t26_legacy',importFingerprint:'original',fine:'50',sourcePaid:true});c.db.attendance=[a,row({id:'b',date:'2026-01-11'})];const snapshot=JSON.stringify(a),fixed=c.confirmedHistoricalRate('a','5500','Документ 15/01');assert.equal(JSON.stringify(a),snapshot);assert.equal(fixed.ratePerShift,5500);assert.equal(fixed.importFingerprint,'original');assert.equal(fixed.sourcePaid,true);assert.equal(fixed.shifts,'0.5');assert.equal(fixed.rateBeforeConfirmation,null);assert.equal(fixed.rateConfirmationReason,'Документ 15/01');assert.ok(fixed.rateConfirmedAt);c.db.attendance[0]=fixed;c.db.workers[0].rate=9000;assert.equal(c.attendanceAmount(fixed),2750);assert.equal(c.attendanceAmount(c.db.attendance[1]),9000);assert.equal(c.attendanceWarnings(fixed).length,0);
 assert.throws(()=>c.confirmedHistoricalRate('a','','Основание'),/ставку/);assert.throws(()=>c.confirmedHistoricalRate('a',5000,''),/основание/);
});

