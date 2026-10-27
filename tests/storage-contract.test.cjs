const {test}=require('node:test');
const assert=require('node:assert/strict');
const {create,createDataStore,validate,reference,resolveReference,referenceTargets}=require('../storage.js');
const KEY='moiShtab_v03';
function fixture(){return {version:3,objects:[{id:'same',name:'Объект'}],workers:[{id:'same',name:'Сотрудник',rate:'9000'}],tasks:[],works:[],goals:[],attendance:[{id:'old',workerId:'same',date:'2026-04-01',shifts:1}],payments:[],expenses:[]};}
function disk(raw=JSON.stringify(fixture())){
 const values=new Map(raw===null?[]:[[KEY,raw]]),writes=[];
 return {values,writes,failRead:false,failKey:null,getItem(k){if(this.failRead)throw Error('read denied');return values.get(k)??null},setItem(k,v){if(this.failKey===k)throw Error('quota');writes.push([k,v]);values.set(k,v)}};
}
test('DataStore factory is backward compatible; reads isolate snapshots without writes or revision changes',()=>{
 assert.equal(createDataStore,create);
 const d=disk(),raw=d.getItem(KEY),s=createDataStore(d,KEY,fixture);
 const a=s.initial(),b=s.readSnapshot();a.workers[0].rate=1;b.attendance.length=0;
 assert.equal(s.readSnapshot().workers[0].rate,'9000');assert.equal(s.readSnapshot().attendance.length,1);
 assert.equal(s.status().raw,raw);assert.equal(s.readSnapshot()._revision,undefined);assert.deepEqual(d.writes,[]);
 const cap=s.capabilities();assert.equal(cap.schemaVersion,3);assert.equal(cap.synchronous,true);
 assert.equal(cap.crossTabCompareAndSwap,false);assert.equal(cap.fileTransactions,false);assert.ok(Object.isFrozen(cap));
});
test('legacy orphans remain readable without repair; strict commit still rejects them',()=>{
 const data=fixture();data.attendance[0].workerId='missing';const d=disk(JSON.stringify(data)),raw=d.getItem(KEY),s=createDataStore(d,KEY,fixture);
 assert.equal(s.status().blocked,false);assert.equal(s.readSnapshot().attendance[0].workerId,'missing');
 assert.equal(s.commit(s.readSnapshot()).ok,false);assert.equal(d.getItem(KEY),raw);assert.deepEqual(d.writes,[]);
});
test('damaged source remains available; backup missing, empty and inaccessible are distinct',()=>{
 const d=disk('{broken'),s=createDataStore(d,KEY,fixture);
 assert.equal(s.status().blocked,true);assert.equal(s.status().raw,'{broken');assert.equal(s.readPreviousBackup(),null);
 d.values.set(KEY+'_before_import','');assert.equal(s.readPreviousBackup(),'');
 d.values.set(KEY+'_before_import','exact\r\nbytes');assert.equal(s.readPreviousBackup(),'exact\r\nbytes');
 d.failRead=true;assert.throws(()=>s.readPreviousBackup(),/read denied/);
 assert.equal(s.status().raw,'{broken');assert.deepEqual(d.writes,[]);
});
test('serialization, validation and quota failures preserve the confirmed snapshot and allow retry',()=>{
 for(const mode of ['cycle','invalid','quota']){
 const d=disk(),s=createDataStore(d,KEY,fixture),before=s.readSnapshot(),raw=d.getItem(KEY),next=s.readSnapshot();
 if(mode==='cycle')next.cycle=next;else if(mode==='invalid')next.workers.push({...next.workers[0]});else {next.workers[0].name='Changed';d.failKey=KEY;}
 const result=s.commit(next);assert.equal(result.ok,false);assert.deepEqual(result.value,before);assert.deepEqual(s.readSnapshot(),before);assert.equal(d.getItem(KEY),raw);
 d.failKey=null;assert.equal(s.commit(s.readSnapshot()).ok,true);
 }
});
test('import backup failure blocks replacement; primary failure preserves confirmed state and exact backup',()=>{
 for(const failedKey of [KEY+'_before_import',KEY]){
 const raw=JSON.stringify(fixture(),null,2),d=disk(raw),s=createDataStore(d,KEY,fixture),before=s.readSnapshot();
 const next=s.readSnapshot();next.objects[0].name='Imported';d.failKey=failedKey;
 assert.equal(s.commit(next,{importing:true}).ok,false);assert.equal(d.getItem(KEY),raw);assert.deepEqual(s.readSnapshot(),before);
 if(failedKey===KEY)assert.equal(s.readPreviousBackup(),raw);
 d.failKey=null;assert.equal(s.commit(next,{importing:true}).ok,true);assert.equal(s.readPreviousBackup(),raw);
 }
});
test('successful roundtrip preserves IDs, attachments, extension fields and unknown legacy rate',()=>{
 const data=fixture();data.attendance[0].objectId='same';data.works=[{id:'work',date:'2026-04-01',workerIds:['same'],objectId:'same',photos:['data:image/png;base64,AA==']}];
 data.expenses=[{id:'expense',date:'2026-04-01',amount:'100',objectId:'same',receipts:[{name:'synthetic.pdf',data:'data:application/pdf;base64,AA==',verified:true}]}];data.custom='keep';
 const d=disk(JSON.stringify(data)),s=createDataStore(d,KEY,fixture),result=s.commit(s.readSnapshot());
 assert.equal(result.ok,true);assert.equal(result.then,undefined);assert.equal(result.value.version,3);assert.equal(result.value._revision.number,1);
 result.value.works[0].photos.length=0;
 const restored=createDataStore(d,KEY,fixture).readSnapshot();assert.deepEqual(restored.works,data.works);assert.deepEqual(restored.expenses,data.expenses);
 assert.deepEqual(restored.attendance,data.attendance);assert.deepEqual(restored.workers,data.workers);assert.equal(restored.custom,'keep');
 assert.ok(restored.financeHistory.every(e=>!e.after.includes('base64')));
});
test('typed references distinguish identical IDs in collections and do not coerce or rewrite them',()=>{
 const data=validate(fixture()),worker=reference('workers','same'),obj=reference('objects','same');
 assert.ok(Object.isFrozen(worker));assert.equal(resolveReference(data,worker).name,'Сотрудник');assert.equal(resolveReference(data,obj).name,'Объект');
 assert.equal(resolveReference(data,{collection:'workers',id:1}),undefined);assert.equal(resolveReference(data,reference('workers','absent')),undefined);
 assert.throws(()=>reference('financeHistory','same'));assert.throws(()=>reference('workers',1));
 assert.equal(resolveReference(data,{collection:'__proto__',id:'same'}),undefined);assert.ok(Object.isFrozen(referenceTargets));
 assert.deepEqual(data.workers,fixture().workers);
});
test('conflicting writes remain blocked before an event and after clear; foreign key events are ignored',()=>{
 const d=disk(),one=createDataStore(d,KEY,fixture),two=createDataStore(d,KEY,fixture);
 assert.equal(two.observe({key:'unrelated',newValue:'changed'}),false);
 assert.equal(one.commit(one.readSnapshot()).ok,true);const saved=d.getItem(KEY);
 assert.equal(two.commit(two.readSnapshot()).ok,false);assert.equal(two.status().conflict,true);assert.equal(d.getItem(KEY),saved);
 const three=createDataStore(d,KEY,fixture);assert.equal(three.observe({key:null,newValue:null}),true);assert.equal(three.commit(three.readSnapshot()).ok,false);
});
