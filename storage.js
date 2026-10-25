/* Version 3 stays readable by existing exports. Revisions are additive metadata. */
(function(root){
'use strict';
const collections=['objects','tasks','works','goals','workers','attendance','payments','expenses','schedule','income','accountable','warehouse','warehouseMovements','timesheetImports'];
const required=collections.slice(0,8);
const clone=x=>JSON.parse(JSON.stringify(x));
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
function validate(data,{links=true}={}){
 const fail=path=>{throw Error('Некорректные данные: '+path)};
 if(!object(data)||data.version!==3)fail('неподдерживаемая версия базы');
 const next=clone(data);
 if(next._revision!==undefined&&(!object(next._revision)||!Number.isSafeInteger(next._revision.number)||next._revision.number<0||typeof next._revision.token!=='string'))fail('_revision');
 for(const k of collections){
  if(next[k]===undefined&&!required.includes(k))next[k]=[];
  if(!Array.isArray(next[k]))fail(k);
  const ids=new Set();
  for(const [i,r] of next[k].entries()){
   const path=k+'['+i+']';
   if(!object(r)||typeof r.id!=='string'||!r.id||! /^[a-zA-Z0-9_-]+$/.test(r.id)||ids.has(r.id))fail(path+'.id');ids.add(r.id);
   for(const [key,v] of Object.entries(r)){
    if(['name','title','notes','address','manager','trade','phone','objectId','workerId','itemId','status','kind','assignee','category','vendor','source','paymentSource','shiftType','importSourceKey','importFingerprint','serial','unit','condition','adjustmentReason','objectName','sourceFile'].includes(key)&&v!=null&&typeof v!=='string')fail(path+'.'+key);
    if(['photos','workerIds','sourceKeys'].includes(key)){if(!Array.isArray(v)||v.some(s=>typeof s!=='string'))fail(path+'.'+key)}
    else if(['receipts','substeps','review'].includes(key)){if(!Array.isArray(v)||v.some(s=>!object(s)))fail(path+'.'+key)}
    else if(v!==null&&!['string','number','boolean'].includes(typeof v))fail(path+'.'+key);
    if(['amount','rate','ratePerShift','shifts','hours','fine','deduction','qty','baseQty','workersCount'].includes(key)&&v!==null&&(typeof v!=='number'&&typeof v!=='string'||!Number.isFinite(Number(v))||Number(v)<0))fail(path+'.'+key);
    if(['date','due','start','end'].includes(key)&&v!==''&&v!=null&&(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v))fail(path+'.'+key);
   }
   if(['works','attendance','payments','expenses','income','accountable','warehouseMovements'].includes(k)&&!validDate(r.date))fail(path+'.date');
   if(k==='schedule'&&(!validDate(r.start)||!validDate(r.end)||r.end<r.start))fail(path+'.start/end');
   if(links){
    if(k==='attendance'&&(r.shifts==null||r.shifts===''||!Number.isFinite(Number(r.shifts))))fail(path+'.shifts');
    if(['payments','expenses','income','accountable'].includes(k)&&(r.amount==null||r.amount===''||!(Number(r.amount)>0)))fail(path+'.amount');
    if(k==='payments'&&!['Аванс','Выплата','Штраф','Удержание'].includes(r.kind))fail(path+'.kind');
    if(k==='accountable'&&!['receipt','return'].includes(r.kind))fail(path+'.kind');
    if(k==='warehouseMovements'&&(!['issue','return','restock','writeoff'].includes(r.kind)||!(Number(r.qty)>0)))fail(path+'.kind/qty');
   }
   for(const field of (['objects','workers','warehouse'].includes(k)?['name']:['tasks','schedule'].includes(k)?['title']:[]))if(typeof r[field]!=='string'||!r[field].trim())fail(path+'.'+field);
   for(const receipt of r.receipts||[])if(typeof receipt.data!=='string'||typeof receipt.name!=='string'||receipt.verified!==undefined&&typeof receipt.verified!=='boolean')fail(path+'.receipts');
   for(const s of r.substeps||[])if(typeof s.title!=='string'||!s.title.trim()||!validDate(s.start)||!validDate(s.end)||s.end<s.start||Object.values(s).some(v=>typeof v!=='string'))fail(path+'.substeps');
   for(const row of r.review||[])if(!validDate(row.date)||['sheet','cell','workerName','reason'].some(key=>typeof row[key]!=='string')||!['string','number'].includes(typeof row.rawValue))fail(path+'.review');
  }
 }
 if(next.advanceReports===undefined)next.advanceReports={};
 if(!object(next.advanceReports))fail('advanceReports');
 if(next.financeHistory!==undefined&&(!Array.isArray(next.financeHistory)||next.financeHistory.some(r=>!object(r)||['at','collection','id','action','before','after'].some(k=>typeof r[k]!=='string'))))fail('financeHistory');
 for(const event of next.financeHistory||[])for(const field of ['before','after']){
  let record;try{record=JSON.parse(event[field])}catch{fail('financeHistory.'+field)}
  if(record!==null&&(!object(record)||record.receipts!==undefined&&(!Array.isArray(record.receipts)||record.receipts.some(r=>!object(r)||typeof r.name!=='string'))))fail('financeHistory.'+field);
 }
 for(const [month,r] of Object.entries(next.advanceReports))if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!object(r)||typeof r.status!=='string')fail('advanceReports.'+month);
 if(links)for(const k of collections)for(const r of next[k]){
  for(const [field,target] of [['objectId','objects'],['workerId','workers'],['itemId','warehouse']])if(r[field]&&!next[target].some(x=>x.id===r[field]))fail(k+'.'+field);
  if(['attendance','payments'].includes(k)&&!r.workerId)fail(k+'.workerId');
  if(k==='warehouseMovements'&&!r.itemId)fail(k+'.itemId');
  for(const id of r.workerIds||[])if(!next.workers.some(x=>x.id===id))fail(k+'.workerIds');
 }
 return next;
}
function create(storage,key,empty){
 let raw=null,confirmed=empty(),blocked=false,conflict=false,error='';
 try{raw=storage.getItem(key);if(raw!==null)confirmed=validate(JSON.parse(raw),{links:false})}catch(e){blocked=true;error=e.message}
 return {
  initial:()=>clone(confirmed), status:()=>({blocked,conflict,error,raw}),
  observe(event){if(event.key===key||event.key===null){if(event.newValue!==raw){conflict=true;return true}}return false},
  commit(candidate,{importing=false}={}){
   try{
    if(blocked&&!importing)throw Error('База не загружена. Сначала восстановите резервную копию.');
    if(conflict||storage.getItem(key)!==raw){conflict=true;throw Error('Данные изменены в другой вкладке. Сохраните введённое отдельно и перезагрузите страницу.');}
    const next=validate(candidate,{links:importing});
    protectClosedReports(confirmed,next);
    const history=importing?[...(confirmed.financeHistory||[]),...(next.financeHistory||[])]:confirmed.financeHistory||[];
    next.financeHistory=[...new Map(history.map(r=>[JSON.stringify(r),r])).values(),...financialChanges(confirmed,next)];
    next._revision={number:(Number(confirmed._revision?.number)||0)+1,token:Date.now().toString(36)+Math.random().toString(36).slice(2)};
    const encoded=JSON.stringify(next);
    // A single setItem is atomic. Failure leaves the previous primary value intact.
    // Save the exact previous bytes before a destructive replacement, including damaged JSON.
    if(importing&&raw!==null)storage.setItem(key+'_before_import',raw);
    storage.setItem(key,encoded);
    raw=encoded;confirmed=next;blocked=false;error='';
    return {ok:true,value:clone(confirmed)};
   }catch(e){return {ok:false,value:clone(confirmed),error:e.message}}
  }
 };
}
function financialChanges(before,after){
 const entries=[],at=new Date().toISOString();
 const snapshot=row=>JSON.stringify(row==null?null:{...row,...(row.receipts?{receipts:row.receipts.map(({data,...r})=>r)}:{})});
 for(const collection of ['accountable','expenses','payments','income']){
  const old=new Map((before[collection]||[]).map(r=>[r.id,r])),fresh=new Map((after[collection]||[]).map(r=>[r.id,r]));
  for(const id of new Set([...old.keys(),...fresh.keys()]))if(JSON.stringify(old.get(id))!==JSON.stringify(fresh.get(id)))entries.push({at,collection,id,action:!old.has(id)?'create':!fresh.has(id)?'delete':'update',before:snapshot(old.get(id)),after:snapshot(fresh.get(id))});
 }
 for(const month of new Set([...Object.keys(before.advanceReports||{}),...Object.keys(after.advanceReports||{})]))if(JSON.stringify(before.advanceReports?.[month])!==JSON.stringify(after.advanceReports?.[month]))entries.push({at,collection:'advanceReports',id:month,action:'status',before:JSON.stringify(before.advanceReports?.[month]||null),after:JSON.stringify(after.advanceReports?.[month]||null)});
 return entries;
}
function protectClosedReports(before,after){
 const closed=Object.keys(before.advanceReports||{}).filter(m=>before.advanceReports[m].status==='approved').sort();
 for(const month of closed){
  const previous=before.advanceReports[month],next=after.advanceReports?.[month];
  if(JSON.stringify(previous)!==JSON.stringify(next)){
   if(month!==closed.at(-1)||!next||!['draft','review'].includes(next.status)||typeof next.reopenReason!=='string'||!next.reopenReason.trim()||next.reopenedAt===previous.reopenedAt)throw Error('Сначала откройте последний закрытый отчёт '+closed.at(-1)+' с указанием причины.');
  }
  // Reopening and changing source data must be separate successful saves.
  const end=month+'-31';
  for(const collection of ['accountable','expenses','payments']){
   const old=(before[collection]||[]).filter(r=>r.date<=end),fresh=(after[collection]||[]).filter(r=>r.date<=end);
   const canonical=rows=>JSON.stringify([...rows].sort((a,b)=>a.id.localeCompare(b.id)));
   if(canonical(old)!==canonical(fresh))throw Error('Отчёт '+month+' закрыт. Откройте его перед изменением операций или входящего остатка.');
  }
  for(const [collection,field,rows] of [['objects','objectId',(before.expenses||[]).filter(r=>r.date<=end&&r.paymentSource==='accountable')],['workers','workerId',(before.payments||[]).filter(r=>r.date<=end&&r.paymentSource==='accountable'&&['Аванс','Выплата'].includes(r.kind))]])for(const id of new Set(rows.map(r=>r[field]).filter(Boolean))){
   if(before[collection].find(r=>r.id===id)?.name!==after[collection].find(r=>r.id===id)?.name)throw Error('Название используется в закрытом отчёте '+month+'. Сначала откройте отчёт.');
  }
 }
}
const api={validate,create,protectClosedReports,financialChanges};if(typeof module!=='undefined')module.exports=api;else root.ProrabkaStorage=api;
})(globalThis);
