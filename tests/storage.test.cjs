const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {create,validate}=require('../storage.js');
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
const blank=()=>Object.fromEntries([['version',3],...['objects','tasks','works','goals','workers','attendance','payments','expenses'].map(k=>[k,[]])]);
function store(raw=null){const values=new Map(raw===null?[]:[['db',raw]]);return {values,fail:false,getItem:k=>values.get(k)??null,setItem(k,v){if(this.fail&&k==='db')throw Error('QuotaExceededError');values.set(k,v)}}}
test('quota failure preserves disk and confirmed memory, retry and reload succeed',()=>{
 const disk=store(JSON.stringify(blank())),p=create(disk,'db',blank),next=p.initial();next.objects.push({id:'o1',name:'Объект'});disk.fail=true;
 const result=p.commit(next);assert.equal(result.ok,false);assert.equal(result.value.objects.length,0);assert.equal(JSON.parse(disk.getItem('db')).objects.length,0);
 disk.fail=false;assert.equal(p.commit(next).ok,true);assert.equal(create(disk,'db',blank).initial().objects.length,1);
});
test('damaged, unsupported and malformed databases block writes and preserve exact bytes',()=>{
 for(const raw of ['{oops',JSON.stringify({...blank(),version:99}),JSON.stringify({...blank(),expenses:[null]})]){
  const disk=store(raw),p=create(disk,'db',blank);assert.equal(p.status().blocked,true);assert.equal(p.commit(blank()).ok,false);assert.equal(disk.getItem('db'),raw);
  assert.equal(p.commit(blank(),{importing:true}).ok,true);assert.equal(disk.getItem('db_before_import'),raw);
 }
});
test('invalid records, nested values, dates, duplicates and relationships cannot replace disk',()=>{
 const cases=[{expenses:[null]},{workers:[{id:'w',name:45}]},{objects:[{id:'a',name:'A'},{id:'a',name:'B'}]},{attendance:[{id:'a',workerId:'missing',date:'2026-10-25'}]},{expenses:[{id:'e',date:'2026-02-30',amount:10}]},{works:[{id:'w',date:'2026-10-25',photos:{}}]},{payments:[{id:'p',date:'2026-10-25',workerId:'w',amount:'oops'}]},{schedule:[{id:'s',title:'S',substeps:[null]}]}];
 for(const patch of cases){const raw=JSON.stringify(blank()),disk=store(raw),p=create(disk,'db',blank);assert.equal(p.commit({...blank(),...patch},{importing:true}).ok,false);assert.equal(disk.getItem('db'),raw)}
});
test('failed import preserves primary, keeps previous bytes and allows retry',()=>{
 const raw=JSON.stringify(blank()),disk=store(raw),p=create(disk,'db',blank);disk.fail=true;
 assert.equal(p.commit({...blank(),objects:[{id:'o',name:'O'}]},{importing:true}).ok,false);
 assert.equal(disk.getItem('db'),raw);assert.equal(disk.getItem('db_before_import'),raw);assert.equal(p.initial().objects.length,0);
});
test('two tabs reject stale revision even before storage event; event and clear lock writes',()=>{
 const disk=store(),a=create(disk,'db',blank),b=create(disk,'db',blank);assert.equal(a.commit(blank()).ok,true);assert.equal(b.commit(blank()).ok,false);
 const c=create(disk,'db',blank);assert.equal(c.observe({key:'db',newValue:null}),true);assert.equal(c.commit(blank()).ok,false);
 const d=create(disk,'db',blank);assert.equal(d.observe({key:null,newValue:null}),true);assert.equal(d.commit(blank()).ok,false);
});
test('legacy numeric strings, optional collections, receipts and import provenance survive round trip',()=>{
 const x=blank();x.workers=[{id:'w',name:'Иван',rate:null}];x.attendance=[{id:'a',workerId:'w',date:'2026-10-25',shifts:'0.5',hours:'',ratePerShift:6000,importSourceKey:'t26_abc',sourcePaid:false}];
 x.expenses=[{id:'e',date:'2026-10-25',amount:'12.34',receipts:[{name:'Чек',data:'data:image/png;base64,abc'}]}];
 const disk=store(JSON.stringify(x)),p=create(disk,'db',blank);assert.equal(p.commit(validate(x),{importing:true}).ok,true);assert.deepEqual(create(disk,'db',blank).initial().attendance,x.attendance);
});
function harness(){
 const disk=store(),p=create(disk,'db',blank),handlers={},forms={objectForm:{value:{name:'Дом'},addEventListener:(type,fn)=>handlers[type]=fn}};
 const context=vm.createContext({persistence:p,db:p.initial(),document:{getElementById:id=>forms[id]},alert:()=>{},storageNotice:()=>{},console:{error:()=>{}},renderAll:()=>{},formData:f=>({...f.value}),resetForm:()=>{context.resets++},uid:()=> 'new',activeObjectId:'',resets:0});
 vm.runInContext(html.slice(html.indexOf('function save(options)'),html.indexOf("window.addEventListener('storage'")),context);
 vm.runInContext(html.slice(html.indexOf('function submitCollection('),html.indexOf("document.getElementById('workForm').addEventListener")),context);
 vm.runInContext("submitCollection('objectForm','objects')",context);
 return {disk,p,context,submit:()=>handlers.submit({preventDefault(){},currentTarget:forms.objectForm})};
}
test('actual common form retains input on quota failure and clears only after successful commit',()=>{
 const h=harness();h.disk.fail=true;h.submit();assert.equal(h.context.resets,0);assert.equal(h.context.db.objects.length,0);
 h.disk.fail=false;h.submit();assert.equal(h.context.resets,1);assert.equal(h.context.db.objects.length,1);
});
test('actual save distinguishes render failure after successful write and reload restores saved record',()=>{
 const h=harness();h.context.renderAll=()=>{throw Error('render failed')};h.submit();assert.equal(h.context.resets,1);assert.equal(h.context.db.objects.length,1);assert.equal(create(h.disk,'db',blank).initial().objects.length,1);
});
test('all inline application scripts parse',()=>{for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1])});
test('financial calculations survive persistence unchanged, including opening cash balance',()=>{
 const x=blank();x.workers=[{id:'w',name:'Иван',rate:'6000'}];
 x.attendance=[{id:'a',workerId:'w',date:'2026-01-25',shifts:'0.5',ratePerShift:6000,fine:'100',deduction:'50'}];
 x.payments=[{id:'p',workerId:'w',date:'2026-01-26',kind:'Аванс',amount:'500',paymentSource:'accountable'}];
 x.accountable=[{id:'c',date:'2026-01-01',kind:'receipt',amount:'5000'}];
 x.expenses=[{id:'e',date:'2026-01-27',amount:'200.25',paymentSource:'accountable'}];
 function calculate(db){const c=vm.createContext({db});
  vm.runInContext(html.slice(html.indexOf('function attendanceAmount'),html.indexOf('/* Finance extension')),c);
  vm.runInContext("const finRound=n=>Math.round((Number(n)||0)*100)/100;",c);
  vm.runInContext(html.slice(html.indexOf('function periodOK'),html.indexOf('function renderPayroll')),c);
  vm.runInContext(html.slice(html.indexOf('function accountableCalc'),html.indexOf('function advanceMonthRange')),c);
  return JSON.parse(vm.runInContext("JSON.stringify({pay:payrollCalc('2026-01-01','2026-01-31'),cash:accountableCalc('2026-02-01','2026-02-28')})",c));}
 const before=calculate(x),disk=store(),p=create(disk,'db',blank);assert.equal(p.commit(x,{importing:true}).ok,true);
 assert.deepEqual(calculate(create(disk,'db',blank).initial()),before);assert.equal(before.pay[0].balance,2350);assert.equal(before.cash.opening,4299.75);assert.equal(before.cash.overall,4299.75);
});
test('specialized timesheet import remains valid and repeated application skips prior records',()=>{
 const c=vm.createContext({db:validate(blank()),uid:(()=>{let i=0;return ()=> 'id'+(++i)})()});
 vm.runInContext(html.slice(html.indexOf('const timesheetNorm='),html.indexOf('function attendanceAmount')),c);
 vm.runInContext(html.slice(html.indexOf('function prepareTimesheetImport'),html.indexOf('function commitTimesheetImport')),c);
 const payload={kind:'prorabka-timesheet-v1',year:2026,rate:6000,workers:[{name:'Иван',rate:6000}],entries:[{sourceKey:'t26_'+'a'.repeat(24),workerName:'Иван',date:'2026-05-01',shiftType:'day',sheet:'Май',cell:'A1',objectName:null,shifts:1,rate:6000,paid:false,accrued:6000,fine:0,paidAmount:0,rawValue:1}],payments:[],review:[]};
 c.payload=payload;const plan=vm.runInContext('prepareTimesheetImport(payload)',c);assert.equal(plan.stats.entriesAdded,1);
 const disk=store(),p=create(disk,'db',blank);assert.equal(p.commit(plan.next,{importing:true}).ok,true);c.db=create(disk,'db',blank).initial();
 const again=vm.runInContext('prepareTimesheetImport(payload)',c);assert.equal(again.stats.entriesAdded,0);assert.equal(again.stats.entriesSkipped,1);
});
