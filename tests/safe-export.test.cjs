const {test}=require('node:test'),assert=require('node:assert/strict');
const {createDataStore,validate}=require('../storage.js');
const fixture=()=>({version:3,_revision:{number:9,token:'saved'},objects:[{id:'o',name:'Site',extra:'retained'}],tasks:[],works:[{id:'work',date:'2026-01-10',photos:['data:image/png;base64,ORIGINAL'],extra:'work extension'}],goals:[{id:'goal',title:'Historical'}],workers:[{id:'w',name:'Worker',rate:6000}],attendance:[{id:'a',date:'2026-01-10',workerId:'w',shifts:1,ratePerShift:6000}],payments:[],expenses:[{id:'e',date:'2026-01-10',amount:1,receipts:[{id:'r',name:'Receipt',data:'data:application/pdf;base64,ORIGINAL'}]}],extension:{nested:['untouched']},financeHistory:[{at:'old',collection:'expenses',id:'e',action:'create',before:'null',after:'{"amount":1}'},{at:'old',collection:'expenses',id:'e',action:'create',before:'null',after:'{"amount":1}'}]});
function setup(raw=JSON.stringify(fixture(),null,2)+'\r\n'){
 const values=new Map([['db_before_import','previous backup\r\n']]);if(raw!==null)values.set('db',raw);
 const disk={values,writes:[],fail:false,getItem(k){if(this.fail)throw Error('Read denied');return values.get(k)??null},setItem(k,v){this.writes.push([k,v]);values.set(k,v)}};
 return {disk,store:createDataStore(disk,'db',fixture),raw};
}
const state=({disk,store})=>({entries:[...disk.values],status:store.status(),snapshot:store.readSnapshot()});
test('P2 exports exact saved JSON, preserving whitespace, extensions, attachments and repeated history',()=>{
 const s=setup(),before=state(s);for(let i=0;i<3;i++)assert.equal(s.store.prepareJsonExport(),s.raw);
 assert.deepEqual(state(s),before);assert.deepEqual(s.disk.writes,[]);assert.equal(JSON.parse(s.raw).financeHistory.length,2);
 const exported=JSON.parse(s.store.prepareJsonExport());assert.deepEqual(validate(exported).works,exported.works);
});
test('P2 exports raw numeric lexemes without a parse/serialize round trip',()=>{
 const data=fixture();data.objects[0].first='FIRST';data.objects[0].second='SECOND';data.objects[0].third='THIRD';
 const raw=JSON.stringify(data).replace('"FIRST"','1.0000000000000001').replace('"SECOND"','1e-400').replace('"THIRD"','9007199254740993');
 const s=setup(raw),before=state(s);assert.equal(s.store.prepareJsonExport(),raw);assert.deepEqual(state(s),before);assert.deepEqual(s.disk.writes,[]);
});
test('P2 never serializes an edited UI snapshot or fills absent optional collections',()=>{
 const s=setup(),edited=s.store.readSnapshot();edited.objects[0].name='unsaved';edited.works[0].photos=[];
 assert.equal(s.store.prepareJsonExport(),s.raw);assert.equal(JSON.parse(s.store.prepareJsonExport()).objects[0].name,'Site');
 assert.equal('warehouseMovements' in JSON.parse(s.store.prepareJsonExport()),false);assert.deepEqual(s.disk.writes,[]);
});
test('P2 rejects missing, damaged, unsupported and blocked sources without exporting fallback data',()=>{
 for(const raw of [null,'','{broken',JSON.stringify({...fixture(),version:99}),JSON.stringify({...fixture(),workers:{}})]){
  const s=setup(raw),before=state(s);assert.throws(()=>s.store.prepareJsonExport());assert.deepEqual(state(s),before);assert.deepEqual(s.disk.writes,[]);
 }
});
test('P2 rejects legacy dangling links without changing readable history or source',()=>{
 const data=fixture();data.attendance[0].workerId='missing';const s=setup(JSON.stringify(data)),before=state(s);
 assert.equal(s.store.status().blocked,false);assert.throws(()=>s.store.prepareJsonExport(),/ссылк/);
 assert.deepEqual(state(s),before);assert.deepEqual(s.disk.writes,[]);
});
test('P2 rejects known conflict even if the disk returns to the old bytes',()=>{
 const s=setup();s.store.observe({key:'db',newValue:'foreign'});const before=state(s);
 assert.throws(()=>s.store.prepareJsonExport(),/конфликт/);assert.deepEqual(state(s),before);assert.deepEqual(s.disk.writes,[]);
});
test('P2 detects foreign changes and deletion before any storage event without accepting them',()=>{
 for(const next of ['foreign',null]){
  const s=setup();if(next===null)s.disk.values.delete('db');else s.disk.values.set('db',next);const before=state(s);
  assert.throws(()=>s.store.prepareJsonExport(),/изменилась/);assert.deepEqual(state(s),before);assert.deepEqual(s.disk.writes,[]);
 }
});
test('P2 detects source changes during validation and propagates read failures without mutation',()=>{
 const s=setup(),before=state(s),original=s.disk.getItem.bind(s.disk);let reads=0;
 s.disk.getItem=k=>k==='db'&&++reads===2?'changed during export':original(k);
 assert.throws(()=>s.store.prepareJsonExport(),/во время/);assert.deepEqual(state(s),before);
 s.disk.getItem=original;s.disk.fail=true;assert.throws(()=>s.store.prepareJsonExport(),/Read denied/);
 assert.deepEqual(state(s),before);assert.deepEqual(s.disk.writes,[]);
});
