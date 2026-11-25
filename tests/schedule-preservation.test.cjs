const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const storage=require('../storage.js');
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
const stage=(extra={})=>({title:'Одинаковое название',start:'2026-11-01',end:'2026-12-01',...extra});
const schedule=(extra={})=>({id:'plan',...stage(),...extra});
const blank=()=>({version:3,objects:[],workers:[],tasks:[],works:[],goals:[],attendance:[],payments:[],expenses:[],schedule:[]});
function merger(){const ctx=vm.createContext({});vm.runInContext(html.slice(html.indexOf('function scheduleChangedFields'),html.indexOf('function substepFields')),ctx);return (...args)=>JSON.parse(JSON.stringify(ctx.scheduleChangedFields(...args)));}
test('schedule merge only changes edited form values and preserves opaque nested values',()=>{
 const merge=merger(),original=schedule({extension:{nested:[null,{text:'Русский 🏗',n:1.25}]},actualStart:'2026-11-02',progress:12.5,notes:'  untouched  '});
 const before=JSON.stringify(original),initial={notes:'  untouched  ',status:'Запланировано'};
 const result=merge(original,{notes:'updated',status:'Запланировано'},initial);
 assert.deepEqual(result,{...original,notes:'updated'});assert.equal(JSON.stringify(original),before);
});
test('missing optional fields, unknown statuses and original whitespace are not normalized',()=>{
 const original=stage({status:'Исторический статус',notes:'  Старое  '});
 assert.deepEqual(merger()(original,{status:'',notes:'  Старое  ',assignee:''},{status:'',notes:'  Старое  ',assignee:''}),original);
});
function collector(originals,rows){
 const target={},editor={target,originals},bindings=new WeakMap(),elements=[];
 for(const row of rows){
  const original=row.original??originals[row.source],el={dataset:Object.hasOwn(original,'id')?{subid:original.id}:{},querySelector:selector=>({value:row.values?.[selector.slice(5)]??original[selector.slice(5)]??''})};
  elements.push(el);bindings.set(el,{editor,source:row.source,original,fields:Object.fromEntries(['title','start','end','assignee','status','notes'].map(key=>[key,original[key]??'']))});
 }
 const ctx=vm.createContext({scheduleEditor:editor,scheduleRowSources:bindings,formEdits:new Map([['scheduleForm',target]]),document:{querySelectorAll:()=>elements}});
 vm.runInContext(html.slice(html.indexOf('function scheduleChangedFields'),html.indexOf('function substepRow')),ctx);
 vm.runInContext(html.slice(html.indexOf('function collectSubsteps'),html.indexOf('/* Планирование')),ctx);
 return {collect:()=>JSON.parse(JSON.stringify(ctx.collectSubsteps())),elements,bindings};
}
test('legacy token mapping preserves distinct unnamed identities through reorder and explicit removal',()=>{
 const originals=[stage({extra:'first'}),stage({extra:'second',extension:{n:[1,2]}}),stage({id:'historical_id',notes:'  keep  '})];
 const before=JSON.stringify(originals),c=collector(originals,[{source:2},{source:1,values:{notes:'changed'}}]);
 assert.deepEqual(c.collect(),[originals[2],{...originals[1],notes:'changed'}]);assert.equal(JSON.stringify(originals),before);
});
for(const ids of [['same','same'],['bad/id'],['']])test('ambiguous/damaged stage IDs refuse saving: '+JSON.stringify(ids),()=>{
 const originals=ids.map(id=>stage({id}));assert.throws(()=>collector(originals,originals.map((_,source)=>({source}))).collect(),/ID стадий/);
});
test('new stages have their own IDs and inherit no extension from deleted neighbors',()=>{
 const original=stage({id:'old',extension:{keep:true}}),fresh={id:'new_id'};
 assert.deepEqual(collector([original],[{original:fresh,values:{title:'New',start:'2026-11-01',end:'2026-12-01'}}]).collect(),[{id:'new_id',title:'New',start:'2026-11-01',end:'2026-12-01',assignee:'',status:'',notes:''}]);
});
test('unbound or substituted row and changed identity are rejected',()=>{
 const c=collector([stage({id:'old'})],[{source:0}]);c.elements[0].dataset.subid='replacement';assert.throws(c.collect,/ID стадии/);
 delete c.elements[0].dataset.subid;c.bindings.delete(c.elements[0]);assert.throws(c.collect,/сопоставить строку/);
});
test('real DataStore keeps nested schedule extensions in raw JSON across save, export/import and reload',()=>{
 const data=blank();data.schedule=[schedule({extension:{a:[false,3,{text:'𐐷'}]},actualStart:'2026-11-02',progress:33.33,substeps:[stage({id:'legacy',objectId:'retained',extension:{a:[1,null]},progress:0.1}),stage({notes:'legacy without ID'})]})];
 const disk=new Map([['db',JSON.stringify(data)]]),adapter={getItem:k=>disk.get(k)??null,setItem:(k,v)=>disk.set(k,v)},p=storage.create(adapter,'db',blank);
 assert.equal(p.status().blocked,false);const next=p.initial();next.schedule[0].notes='updated';
 assert.equal(p.commit(next).ok,true);const raw=JSON.parse(disk.get('db'));
 assert.deepEqual(raw.schedule,[{...data.schedule[0],notes:'updated'}]);assert.deepEqual(storage.create(adapter,'db',blank).initial().schedule,raw.schedule);
 const restored=storage.create({getItem:()=>null,setItem:()=>{}},'new',blank);assert.equal(restored.commit(raw,{importing:true}).ok,true);assert.deepEqual(restored.initial().schedule,raw.schedule);
});
test('schedule extension support keeps structural validation and unrelated collections strict',()=>{
 for(const plan of [schedule({title:{bad:true}}),schedule({start:'2026-02-30'}),schedule({substeps:[stage({notes:{bad:true}})]}),schedule({substeps:[stage({objectId:1})]}),schedule({substeps:[null]})])assert.throws(()=>storage.validate({...blank(),schedule:[plan]}),/Некорректные/);
 assert.throws(()=>storage.validate({...blank(),workers:[{id:'w',name:'W',extension:{notAllowed:true}}]}),/Некорректные/);
 assert.throws(()=>storage.validate({...blank(),works:[{id:'w',date:'2026-11-01',substeps:[stage({extension:{notAllowed:true}})]}]}),/Некорректные/);
});
