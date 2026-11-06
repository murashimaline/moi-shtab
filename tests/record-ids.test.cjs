const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createIdAllocator,createDataStore,validate}=require('../storage.js');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const empty=()=>({version:3,objects:[],tasks:[],works:[],goals:[],workers:[],attendance:[],payments:[],expenses:[]});

test('P3 allocator retries saved and reserved IDs within the collection',()=>{
 const ids=[uuid(1),uuid(2),uuid(2),uuid(3)];
 const allocate=createIdAllocator([{id:uuid(1)}],{randomUUID:()=>ids.shift()});
 assert.equal(allocate(),uuid(2));
 assert.equal(allocate(),uuid(3));
 assert.deepEqual(ids,[]);
});

test('P3 allocator uses secure random bytes when randomUUID is unavailable',()=>{
 const allocate=createIdAllocator([],{getRandomValues:bytes=>bytes.fill(0xab)});
 assert.equal(allocate(),'ab'.repeat(16));
 assert.throws(()=>allocate(),/8 попыток/);
});

test('P3 allocator bounds retries and stops on crypto failures',()=>{
 let attempts=0;
 const allocate=createIdAllocator([{id:uuid(1)}],{randomUUID:()=>{attempts++;return uuid(1)}});
 assert.throws(()=>allocate(),/8 попыток/);
 assert.equal(attempts,8);
 for(const crypto of [null,{}, {randomUUID:()=>{throw Error('denied')}}, {randomUUID:()=>''}]){
  assert.throws(()=>createIdAllocator([],crypto)(),/криптографического генератора/);
 }
});

test('P3 DataStore rejects a create disguised as replacement and edits with missing or stale targets',()=>{
 const fixture=validate({...empty(),objects:[{id:'old',name:'Original'}]});
 const original=JSON.stringify(fixture);
 let raw=original,writes=0;
 const store=createDataStore({getItem:()=>raw,setItem:(_,value)=>{writes++;raw=value}},'db',empty);
 const replacement={...fixture,objects:[{id:'old',name:'Replacement'}]};
 for(const [candidate,change] of [
  [replacement,{collection:'objects',id:'old',mode:'create'}],
  [{...fixture,objects:[...fixture.objects,{id:'missing',name:'New'}]},{collection:'objects',id:'missing',mode:'edit',previous:'{}'}],
  [replacement,{collection:'objects',id:'old',mode:'edit',previous:'{}'}],
  [{...fixture,objects:[{id:'another',name:'New ID'}]},{collection:'objects',id:'old',mode:'edit',previous:JSON.stringify(fixture.objects[0])}]
 ]){
  assert.equal(store.commit(candidate,{recordChanges:[change]}).ok,false);
  assert.equal(raw,original);
  assert.deepEqual(store.readSnapshot(),fixture);
 }
 assert.equal(writes,0);
 const result=store.commit(replacement,{recordChanges:[{collection:'objects',id:'old',mode:'edit',previous:JSON.stringify(fixture.objects[0])}]});
 assert.equal(result.ok,true);
 assert.deepEqual(result.value.objects,[{id:'old',name:'Replacement'}]);
});
