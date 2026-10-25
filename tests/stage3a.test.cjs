const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {create,validate}=require('../storage.js');
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
const blank=()=>({version:3,objects:[{id:'o',name:'A'}],workers:[{id:'w',name:'W',rate:6000}],warehouse:[{id:'i',name:'Tool'}],tasks:[],works:[],goals:[],attendance:[],payments:[],expenses:[],income:[],accountable:[],schedule:[],warehouseMovements:[]});
function store(data=blank()){const disk=new Map([['db',JSON.stringify(data)]]);return {disk,p:create({getItem:k=>disk.get(k)??null,setItem:(k,v)=>disk.set(k,v)},'db',blank)}}
const date='2026-01-10';
for(const [collection,record,target] of [
 ['attendance',{workerId:'w',date,shifts:1},'workers'],
 ['payments',{workerId:'w',date,amount:100,kind:'Выплата'},'workers'],
 ['works',{workerIds:['w'],date},'workers'],
 ['tasks',{objectId:'o',title:'T'},'objects'],
 ['works',{objectId:'o',date},'objects'],
 ['schedule',{objectId:'o',title:'S',start:date,end:date},'objects'],
 ['expenses',{objectId:'o',date,amount:10},'objects'],
 ['income',{objectId:'o',date,amount:10},'objects'],
 ['attendance',{workerId:'w',objectId:'o',date,shifts:1},'objects'],
 ['warehouse',{id:'i',name:'Tool',objectId:'o'},'objects'],
 ['warehouseMovements',{itemId:'i',workerId:'w',date,kind:'issue',qty:1},'workers'],
 ['warehouseMovements',{itemId:'i',date,kind:'restock',qty:1},'warehouse']
])test(`R1 rejects deletion referenced by ${collection} -> ${target} and restores exact history`,()=>{
 const data=blank();data[collection]=[{id:'r',...record}];const {disk,p}=store(data),raw=disk.get('db'),next=p.initial();next[target]=[];
 assert.equal(p.commit(next).ok,false);assert.equal(disk.get('db'),raw);assert.deepEqual(p.initial(),validate(data));
 const fresh=store();assert.equal(fresh.p.commit(JSON.parse(raw),{importing:true}).ok,true);assert.deepEqual(fresh.p.initial()[collection],data[collection]);
});
test('R1 payment references and newly introduced dangling links are rejected atomically',()=>{
 const data=blank();data.payments=[{id:'p',workerId:'w',date,kind:'Выплата',amount:10}];data.expenses=[{id:'e',date,amount:10,paymentId:'p'}];const {p,disk}=store(data),raw=disk.get('db'),n=p.initial();n.payments=[];assert.equal(p.commit(n).ok,false);assert.equal(disk.get('db'),raw);
 n.payments=data.payments;n.works=[{id:'x',date,workerIds:['missing']}];assert.equal(p.commit(n).ok,false);
});
test('R1 unreferenced deletion succeeds and complete export reloads and imports with history',()=>{
 const {p,disk}=store();let n=p.initial();n.expenses=[{id:'e',date,amount:10,objectId:'o'}];assert.equal(p.commit(n).ok,true);n=p.initial();n.workers=[];assert.equal(p.commit(n).ok,true);
 const exported=JSON.parse(disk.get('db'));assert.deepEqual(validate(exported),exported);const fresh=store();assert.equal(fresh.p.commit(exported,{importing:true}).ok,true);assert.ok(fresh.p.initial().financeHistory.some(e=>e.collection==='expenses'));assert.deepEqual(fresh.p.initial().expenses,exported.expenses);
});
test('R1 preexisting orphan is readable but cannot be silently rewritten or automatically migrated',()=>{
 const data=blank();data.attendance=[{id:'a',date,workerId:'missing',shifts:1}];const {p,disk}=store(data),raw=disk.get('db');assert.equal(p.initial().attendance.length,1);assert.equal(p.commit(p.initial()).ok,false);assert.equal(disk.get('db'),raw);
});
function payroll(){const c=vm.createContext({db:blank()});vm.runInContext(html.slice(html.indexOf('function wageCents'),html.indexOf('/* Finance extension')),c);vm.runInContext(html.slice(html.indexOf('function periodOK'),html.indexOf('function renderPayroll')),c);return c}
test('R7 reversed range rejected; equal dates and open boundaries remain supported',()=>{const c=payroll();c.db.attendance=[{id:'a',date,workerId:'w',shifts:1,ratePerShift:6000}];assert.throws(()=>c.payrollCalc('2026-02-01','2026-01-01'),/Начало/);assert.equal(c.payrollCalc(date,date)[0].accrued,6000);assert.equal(c.payrollCalc('',date)[0].accrued,6000);assert.equal(c.payrollCalc(date,'')[0].accrued,6000)});
test('R7 UI clears stale results and refuses Excel download for reversed dates',()=>{
 const c=payroll(),handlers={},elements={payFrom:{value:'2026-02-01'},payTo:{value:'2026-01-01'},payrollList:{textContent:'stale'}};c.document={getElementById:id=>elements[id]||{addEventListener:(_,fn)=>handlers[id]=fn}};c.alert=message=>c.message=message;c.excelXML=()=>{throw Error('download called')};c.today=()=>date;
 vm.runInContext(html.slice(html.indexOf('function renderPayroll'),html.indexOf('// Draft amounts')),c);c.renderPayroll();assert.match(elements.payrollList.textContent,/Начало/);
 vm.runInContext(html.split('\n').find(l=>l.startsWith("document.getElementById('exportPayrollExcel').")),c);handlers.exportPayrollExcel();assert.match(c.message,/Начало/);
});
test('R8 duplicate names retain separate IDs in actual table and Excel object rows',()=>{
 const c=payroll();c.db.objects=[{id:'o',name:'A'},{id:'o2',name:'A'}];c.db.income=[{id:'i1',date,objectId:'o',amount:100},{id:'i2',date,objectId:'o2',amount:200}];c.objName=id=>c.db.objects.find(o=>o.id===id)?.name;c.amountTotal=rows=>rows.reduce((s,r)=>s+Number(r.amount),0);c.table=(_,rows)=>rows.join('');c.esc=String;c.money=String;
 vm.runInContext(html.slice(html.indexOf('function financeMetrics'),html.indexOf('function renderFinance()')),c);const table=c.financeObjectTable('','', 'o2');assert.match(table,/>200</);assert.doesNotMatch(table,/>100</);
 const handlers={};c.document={getElementById:id=>({addEventListener:(_,fn)=>handlers[id]=fn})};c.financeRange=()=>({from:'',to:'',oid:'o2'});c.excelXML=(file,headers,rows)=>c.rows=rows;c.alert=()=>{};c.today=()=>date;c.renderFinance=()=>true;c.possibleSalaryDuplicates=()=>[];
 const start=html.indexOf("document.getElementById('exportFinanceExcel').addEventListener");vm.runInContext(html.slice(start,html.indexOf("document.getElementById('printFinance')",start)),c);handlers.exportFinanceExcel();const rows=c.rows.filter(r=>r[0]==='ОБЪЕКТ'&&r[2]==='Поступления');assert.equal(rows.length,1);assert.equal(rows[0][3],200);
});
test('daily report counts selected IDs, timesheet fallback, absence, overlap and distinct objects',()=>{
 const c=vm.createContext({});vm.runInContext(html.slice(html.indexOf('function dailyWorkerCount'),html.indexOf("document.getElementById('makeReport')")),c);
 assert.equal(c.dailyWorkerCount([{objectId:'o',workersCount:''}],[{objectId:'o',workerId:'w',status:'Смена'}]),1);
 assert.equal(c.dailyWorkerCount([{workerIds:['w','w2'],workersCount:1}],[{workerId:'w'},{workerId:'absent',status:'Отсутствовал'}]),2);
 assert.equal(c.dailyWorkerCount([{objectId:'o',workersCount:5},{objectId:'o',workersCount:3},{objectId:'o2',workersCount:4}],[]),9);
 assert.equal(c.dailyWorkerCount([],[]),0);
});

test('warehouse UI does not cascade-delete movements',()=>{const data=blank();data.warehouseMovements=[{id:'m',itemId:'i',date,kind:'issue',qty:1}];const c=vm.createContext({db:data,alert:message=>c.message=message,removeItem:()=>{throw Error('unexpected deletion')}});const start=html.indexOf('function removeWarehouse(id)');vm.runInContext(html.slice(start,html.indexOf('function removeWarehouseMove',start)),c);c.removeWarehouse('i');assert.match(c.message,/истор/);assert.equal(data.warehouseMovements.length,1);assert.equal(data.warehouse.length,1)});
test('normal backup never labels an orphaned legacy database as restorable; raw recovery remains available',()=>{const data=blank();data.workers=[];data.attendance=[{id:'a',workerId:'w',date,shifts:1}];const handlers={},status={textContent:''};const c=vm.createContext({db:data,ProrabkaStorage:require('../storage.js'),document:{getElementById:id=>id==='backupStatus'?status:{addEventListener:(_,fn)=>handlers[id]=fn}},storageNotice:message=>c.message=message,Blob:()=>{throw Error('invalid backup download')}});vm.runInContext(html.split('\n').find(l=>l.startsWith("document.getElementById('exportBtn').addEventListener")),c);handlers.exportBtn();assert.match(status.textContent,/требует сверки/);assert.match(c.message,/Скачайте исходные/);assert.equal(data.attendance.length,1)});
