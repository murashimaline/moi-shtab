const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {create}=require('../storage.js');
const empty=()=>Object.fromEntries([['version',3],...['objects','tasks','works','goals','workers','attendance','payments','expenses'].map(key=>[key,[]])]);
const event=(id='old')=>({at:'2026-01-01T00:00:00.000Z',collection:'expenses',id,action:'create',before:'null',after:'{"amount":10}',source:'legacy'});
function harness(history=[]){
 const initial={...empty(),financeHistory:history};
 const values=new Map([['db',JSON.stringify(initial)],['db_before_import','prior backup']]);
 const disk={fail:false,getItem:key=>values.get(key)??null,setItem(key,value){
  if(this.fail&&key==='db')throw Error('Synthetic quota');
  values.set(key,value);
 }};
 return {disk,values,store:create(disk,'db',empty)};
}
function saved(store,candidate=store.readSnapshot(),options){
 const result=store.commit(candidate,options);
 assert.equal(result.ok,true,result.error);
 return result.value;
}

test('DI01 ordinary saves preserve every repeated event and ignore unconfirmed history edits',()=>{
 const history=[event(),event(),event('other'),event()];
 const {disk,store}=harness(history),next=store.readSnapshot();
 next.objects.push({id:'new',name:'New object'});
 next.financeHistory=[event('injected')];
 assert.deepEqual(saved(store,next).financeHistory,history);
 assert.deepEqual(saved(store).financeHistory,history);
 assert.deepEqual(create(disk,'db',empty).initial().financeHistory,history);
 assert.deepEqual(JSON.parse(store.prepareJsonExport()).financeHistory,history);
});
test('DI01 restore preserves occurrence counts from each side and is idempotent',()=>{
 for(const [existing,incoming] of [[0,2],[1,3],[3,1],[2,2]]){
  const history=Array.from({length:existing},()=>event());
  const {disk,values,store}=harness(history);
  const candidate={...empty(),financeHistory:[event('incoming'),...Array.from({length:incoming},()=>event()),event('incoming')]};
  const original=JSON.stringify(candidate),raw=values.get('db');
  let result=saved(store,candidate,{importing:true});
  assert.deepEqual(result.financeHistory.slice(0,history.length),history);
  assert.equal(result.financeHistory.filter(row=>row.id==='old').length,Math.max(existing,incoming));
  assert.equal(result.financeHistory.filter(row=>row.id==='incoming').length,2);
  assert.equal(values.get('db_before_import'),raw);
  const expected=result.financeHistory;
  for(let attempt=0;attempt<2;attempt++){
   result=saved(store,candidate,{importing:true});
   assert.deepEqual(result.financeHistory,expected);
  }
  assert.equal(JSON.stringify(candidate),original);
  assert.deepEqual(create(disk,'db',empty).initial().financeHistory,expected);
 }
});
test('DI01 old JSON without history keeps the existing events on restore',()=>{
 const history=[event(),event()],{store}=harness(history);
 assert.deepEqual(saved(store,empty(),{importing:true}).financeHistory,history);
 assert.deepEqual(saved(store).financeHistory,history);
});
test('DI01 new equal financial events are recorded individually, while no-op saves add none',()=>{
 const timestamp='2026-05-01T12:00:00.000Z';
 class FixedDate extends Date {
  constructor(...args){super(...(args.length?args:[timestamp]));}
  static now(){return Date.parse(timestamp);}
 }
 const context=vm.createContext({module:{exports:{}},Date:FixedDate});
 vm.runInContext(fs.readFileSync(require.resolve('../storage.js'),'utf8'),context);
 const {disk}=harness(),store=context.module.exports.create(disk,'db',empty);
 const row={id:'income',date:'2026-05-01',amount:100};
 let next=store.readSnapshot();next.income=[row];saved(store,next);
 next=store.readSnapshot();next.income=[];saved(store,next);
 next=store.readSnapshot();next.income=[row];
 const result=saved(store,next);
 assert.equal(result.financeHistory.length,3);
 assert.equal(JSON.stringify(result.financeHistory[0]),JSON.stringify(result.financeHistory[2]));
 assert.equal(saved(store).financeHistory.length,3);
});
test('DI01 ordinary and restore write failures preserve all events until successful retry',()=>{
 for(const importing of [false,true]){
  const history=[event(),event()],{disk,values,store}=harness(history);
  const next=store.readSnapshot();next.income=[{id:'income',date:'2026-05-01',amount:100}];
  if(importing)next.financeHistory.push(event());
  const raw=values.get('db'),original=JSON.stringify(next),snapshot=store.readSnapshot();
  disk.fail=true;
  assert.equal(store.commit(next,{importing}).ok,false);
  assert.equal(values.get('db'),raw);
  assert.deepEqual(store.readSnapshot(),snapshot);
  assert.equal(values.get('db_before_import'),importing?raw:'prior backup');
  disk.fail=false;
  const result=saved(store,next,{importing});
  assert.equal(result.financeHistory.length,importing?4:3);
  assert.deepEqual(result.financeHistory.slice(0,2),history);
  assert.equal(JSON.stringify(next),original);
 }
});
test('DI01 history preservation does not bypass closed periods or duplicate actual payments',()=>{
 const history=[event(),event()],{values,store}=harness(history);
 let next=store.readSnapshot();
 next.workers=[{id:'w',name:'Worker',rate:6000}];
 next.payments=[{id:'p',workerId:'w',date:'2026-01-15',amount:100,kind:'Выплата'}];
 next.advanceReports={'2026-01':{status:'approved'}};
 const result=saved(store,next);
 assert.deepEqual(result.financeHistory.slice(0,2),history);
 assert.deepEqual(saved(store,result,{importing:true}).financeHistory,result.financeHistory);
 const confirmed=store.readSnapshot(),changed=store.readSnapshot();changed.payments[0].amount=200;
 const before=values.get('db');
 assert.equal(store.commit(changed,{importing:true}).ok,false);
 assert.equal(values.get('db'),before);
 assert.deepEqual(store.readSnapshot(),confirmed);
});
