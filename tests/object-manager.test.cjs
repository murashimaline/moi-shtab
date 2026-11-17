const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validate,create,diagnoseRaw}=require('../storage.js');
const legacy={id:'site',name:'Участок',manager:' Иванов И.  ',extra:'keep'};
const fixture=(patch={})=>({
 version:3,objects:[legacy],workers:[{id:'w',name:'Иванов Иван'}],
 tasks:[],works:[],goals:[],attendance:[],payments:[],expenses:[],...patch
});
function harness(initial){
 const disk=new Map([['db',JSON.stringify(initial)],['db_before_import','old backup']]);
 const writes=[];
 const store=create({getItem:key=>disk.get(key)??null,setItem:(key,value)=>{
  writes.push(key);
  disk.set(key,value);
 }},'db',fixture);
 return {store,disk,writes};
}
test('JSON v3 distinguishes absent managerId, explicit null and a valid reference',()=>{
 for(const object of [legacy,{...legacy,managerId:null},{...legacy,managerId:'w'}]){
  const {store}=harness(fixture({objects:[object]}));
  assert.deepEqual(JSON.parse(store.prepareJsonExport()).objects,[object]);
  assert.equal(store.commit(fixture({objects:[object]}),{importing:true}).ok,true);
  assert.deepEqual(store.readSnapshot().objects,[object]);
 }
 for(const managerId of ['',false,17,'w w']){
  assert.throws(()=>validate(fixture({objects:[{...legacy,managerId}]})),/managerId/);
 }
 assert.throws(()=>validate(fixture({tasks:[{id:'task',title:'Задача',managerId:'w'}]})),/tasks.*managerId/);
});
test('broken manager links remain readable and diagnostics identify every missing manager',()=>{
 const objects=[{...legacy,managerId:'missing'},{id:'two',name:'Второй',managerId:'another'}];
 const {store,disk,writes}=harness(fixture({objects}));
 assert.deepEqual(store.readSnapshot().objects,objects);
 assert.throws(()=>store.prepareJsonExport(),/Участок.*missing/);
 const report=diagnoseRaw(disk.get('db'));
 assert.equal(report.issues.filter(f=>f.code==='missing_target'&&f.record.collection==='objects'&&f.field==='managerId').length,2);
 const next=store.readSnapshot();
 next.objects[0].managerId=null;
 assert.match(store.commit(next).error,/Второй.*another/);
 assert.deepEqual(writes,[]);
 next.objects[1].managerId='w';
 assert.equal(store.commit(next).ok,true);
 assert.deepEqual(writes,['db']);
 assert.equal(disk.get('db_before_import'),'old backup');
 assert.deepEqual(store.readSnapshot().objects,[{...objects[0],managerId:null},{...objects[1],managerId:'w'}]);
});
test('dangling import and deletion of a referenced worker refuse before any write',()=>{
 const object={...legacy,managerId:'w'};
 const {store,disk,writes}=harness(fixture({objects:[object]}));
 const raw=disk.get('db');
 assert.match(store.commit(fixture({objects:[{...object,managerId:'missing'}]}),{importing:true}).error,/managerId/);
 assert.match(store.commit(fixture({objects:[object],workers:[]})).error,/managerId/);
 assert.deepEqual(writes,[]);
 assert.equal(disk.get('db'),raw);
 assert.equal(disk.get('db_before_import'),'old backup');
});
