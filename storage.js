/* Version 3 stays readable by existing exports. Revisions are additive metadata. */
(function(root){
'use strict';
const collections=['objects','tasks','works','goals','workers','attendance','payments','expenses','schedule','income','accountable','warehouse','warehouseMovements','timesheetImports'];
const required=collections.slice(0,8);
const referenceTargets=Object.freeze({objectId:'objects',workerId:'workers',itemId:'warehouse',paymentId:'payments'});
// Typed references are an in-memory API only; version 3 keeps its existing fields.
function reference(collection,id){
 if(!collections.includes(collection)||typeof id!=='string'||!id||! /^[a-zA-Z0-9_-]+$/.test(id))throw Error('Некорректная ссылка');
 return Object.freeze({collection,id});
}
function resolveReference(data,ref){
 if(!ref||!collections.includes(ref.collection))return undefined;
 return (data[ref.collection]||[]).find(row=>row.id===ref.id);
}
const capabilities=Object.freeze({backend:'localStorage',schemaVersion:3,synchronous:true,atomicPrimaryWrite:true,crossTabCompareAndSwap:false,fileTransactions:false});

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
  for(const [field,target] of Object.entries(referenceTargets))if(r[field]&&!resolveReference(next,{collection:target,id:r[field]}))fail(k+'.'+field+' — ссылка должна вести на существующую запись; удаление связанных записей запрещено');
  if(['attendance','payments'].includes(k)&&!r.workerId)fail(k+'.workerId');
  if(k==='warehouseMovements'&&!r.itemId)fail(k+'.itemId');
  for(const id of r.workerIds||[])if(!resolveReference(next,{collection:'workers',id}))fail(k+'.workerIds — ссылка должна вести на существующего сотрудника; удаление связанных записей запрещено');
 }
 return next;
}
function create(storage,key,empty){
 let raw=null,confirmed=empty(),blocked=false,conflict=false,error='';
 try{raw=storage.getItem(key);if(raw!==null)confirmed=validate(JSON.parse(raw),{links:false})}catch(e){blocked=true;error=e.message}
 return {
  initial:()=>clone(confirmed), readSnapshot:()=>clone(confirmed),
  capabilities:()=>capabilities,
  readPreviousBackup:()=>storage.getItem(key+'_before_import'),
  readRaw:()=>storage.getItem(key),
  status:()=>({blocked,conflict,error,raw}),
  observe(event){if(event.key===key||event.key===null){if(event.newValue!==raw){conflict=true;return true}}return false},
  commit(candidate,{importing=false}={}){
   try{
    if(blocked&&!importing)throw Error('База не загружена. Сначала восстановите резервную копию.');
    if(conflict||storage.getItem(key)!==raw){conflict=true;throw Error('Данные изменены в другой вкладке. Сохраните введённое отдельно и перезагрузите страницу.');}
    // Every successful save must be restorable with the same strict validator.
    // Reject dangling references rather than cascading away historical records.
    const next=validate(candidate);
    protectClosedReports(confirmed,next);
    protectSalaryExpenses(confirmed,next,{importing});
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
function salaryExpenseHint(row){
 return /зарплат|з\s*\/\s*п|оплата труда|аванс(?:ы)? рабоч/iu.test([row.category,row.notes].filter(Boolean).join(' '));
}
function salaryExpense(row,data){
 // A direct payment link is evidence; equal dates/amounts alone are not.
 return salaryExpenseHint(row)||!!row.paymentId&&(data.payments||[]).some(p=>p.id===row.paymentId&&['Аванс','Выплата'].includes(p.kind));
}
function protectSalaryExpenses(before,after,{importing=false}={}){
 const old=new Map((before.expenses||[]).map(row=>[row.id,row]));
 const economic=row=>JSON.stringify(['date','amount','paymentSource','objectId','workerId','paymentId'].map(k=>k==='amount'?Number(row[k]):row[k]||''));
 for(const row of after.expenses||[]){
  if(!salaryExpense(row,after))continue;
  const previous=old.get(row.id);
  // JSON restore may contain historical payroll expenses unknown to this store.
  // Preserve those records under the existing manual-reconciliation policy.
  // Import must still not convert or move an already known expense.
  if(importing&&!previous)continue;
  // Existing historical entries remain readable and may receive documents or
  // corrections to their description. No new payroll expense or financial move.
  if(!previous||!salaryExpense(previous,before)||economic(previous)!==economic(row))throw Error('Зарплату и авансы рабочим внесите в разделе «Зарплата», чтобы не учитывать их дважды. Старый расход сверьте вручную.');
 }
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
// B0-04: isolated parsing only; no normalization, writes or mutation.
function diagnoseRaw(raw){
 const issues=[];
 const directionOrder=['warehouse_balances','warehouse_chronology','warehouse_movements','warehouse_links','warehouse_duplicates','warehouse_serials','attachments','warehouse_movement_order','attachment_full_integrity','delivery_receiving','tolling_materials','inventory','kits','historical_responsible'];
 const directions=new Map([
  ['warehouse_balances',{title:'Остатки',status:'checked',reason:'Проверяются доступные исходные количества и итоговый расчётный остаток.'}],
  ['warehouse_chronology',{title:'Хронология движений',status:'partial',reason:'Движения разных дат сверяются по дневному итогу. warehouse.baseQty не имеет даты, поэтому исторический остаток является кандидатом для ручной сверки.'}],
  ['warehouse_movements',{title:'Движения',status:'checked',reason:'Проверяются доступные даты, виды операций и количества.'}],
  ['warehouse_links',{title:'Связи склада',status:'checked',reason:'Проверяются только явные постоянные ID-ссылки из исходного JSON.'}],
  ['warehouse_duplicates',{title:'Повторные операции',status:'checked',reason:'Проверяются совпадения доступных реквизитов движения.'}],
  ['warehouse_serials',{title:'Инвентарные номера',status:'checked',reason:'Проверяются совпадения непустых инвентарных номеров.'}],
  ['attachments',{title:'Вложения',status:'checked',reason:'Проверяется доступная структура встроенных вложений и их синтаксис.'}],
  ['warehouse_movement_order',{title:'Порядок движений в одну дату',status:'impossible',reason:'В модели нет времени операций; порядок записей одной даты достоверно установить нельзя.'}],
  ['attachment_full_integrity',{title:'Полная целостность файлов',status:'impossible',reason:'В JSON v3 нет FileStore или внешнего источника, поэтому доступность и полную целостность файлов проверить нельзя.'}],
  ['delivery_receiving',{title:'Доставка и приёмка',status:'impossible',reason:'В JSON v3 нет самостоятельных записей доставки и приёмки.'}],
  ['tolling_materials',{title:'Давальческие материалы',status:'impossible',reason:'В JSON v3 нет модели давальческих материалов.'}],
  ['inventory',{title:'Инвентаризация',status:'impossible',reason:'В JSON v3 нет результатов фактической инвентаризации для сверки.'}],
  ['kits',{title:'Комплекты',status:'impossible',reason:'В JSON v3 нет состава и движения комплектов.'}],
  ['historical_responsible',{title:'Исторические ответственные',status:'impossible',reason:'Поле assignee — текст, а исторической ID-связи с сотрудником в складских движениях нет.'}]
 ].map(([id,value])=>[id,{id,...value,problems:0}]));
 const directionRank={checked:0,partial:1,impossible:2};
 const setDirection=(id,status,reason)=>{
  const direction=directions.get(id);if(!direction||directionRank[status]<directionRank[direction.status])return;
  direction.status=status;if(reason)direction.reason=reason;
 };
 const partial=(id,reason)=>setDirection(id,'partial',reason);
 const impossible=(id,reason)=>setDirection(id,'impossible',reason);
 const countProblem=id=>{const direction=directions.get(id);if(direction)direction.problems++;};
 const unavailable=reason=>{
  for(const id of ['warehouse_balances','warehouse_chronology','warehouse_movements','warehouse_links','warehouse_duplicates','warehouse_serials','attachments'])impossible(id,reason);
 };
 const add=(code,category,severity,collection,index,row,field,message,reason,related=[])=>{
  issues.push({code,category,severity,record:{collection,index,id:typeof row?.id==='string'?row.id:null},
   field,message,reason,related:related.map(x=>({collection:x.collection,index:x.index,id:typeof x.row?.id==='string'?x.row.id:null}))});
 };
 const directionReport=()=>directionOrder.map(id=>({...directions.get(id)}));
 const done=(complete=true)=>({readOnly:true,complete,issues,counts:issues.reduce((n,x)=>(n[x.severity]++,n),{error:0,warning:0,info:0}),directions:directionReport()});
 if(raw===null){unavailable('Сохранённая база отсутствует, поэтому направление проверить невозможно.');return done()}
 let data;
 try{data=JSON.parse(raw)}catch{add('invalid_json','structure','error','$',null,null,'','JSON не читается','Синтаксис исходной базы повреждён; содержимое не изменено.');unavailable('Исходный JSON не читается, поэтому направление проверить невозможно.');return done(false)}
 if(!object(data)||data.version!==3){add('unsupported_version','structure','error','$',null,null,'version','Формат базы не поддерживается','Диагностика рассчитана на JSON version 3.');unavailable('Поддерживается только читаемый JSON version 3.');return done(false)}
 const missing=v=>v===undefined||v===null||typeof v==='string'&&!v.trim();
 const number=v=>!missing(v)&&(typeof v==='number'||typeof v==='string')&&Number.isFinite(Number(v))&&Number(v)>=0;
 const idOK=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]+$/.test(v);
 const rows={},indexes={};
 let complete=true;
 for(const collection of collections){
  rows[collection]=[];indexes[collection]=new Map();
  if(data[collection]===undefined&&!required.includes(collection))continue;
  if(!Array.isArray(data[collection])){add('invalid_collection','structure','error',collection,null,null,'','Коллекция отсутствует или повреждена','Эту коллекцию невозможно проверить полностью.');complete=false;continue}
  data[collection].forEach((row,index)=>{
   if(!object(row)){add('invalid_record','structure','error',collection,index,null,'','Запись не является объектом','Поля и связи записи невозможно проверить.');complete=false;return}
   const entry={collection,index,row};rows[collection].push(entry);
   if(!idOK(row.id))add('invalid_id','links','error',collection,index,row,'id','Некорректный ID','ID должен быть непустой строкой; автоматической перенумерации нет.');
   else {const group=indexes[collection].get(row.id)||[];group.push(entry);indexes[collection].set(row.id,group)}
  });
  for(const group of indexes[collection].values())if(group.length>1)for(const e of group)
   add('duplicate_id','links','error',collection,e.index,e.row,'id','Повторяющийся ID внутри коллекции','Связь по этому ID неоднозначна. Индекс различает исходные записи.');
 }
 const report=(e,code,cat,sev,field,msg,why,related)=>add(code,cat,sev,e.collection,e.index,e.row,field,msg,why,related);
 const checkLink=(e,field,target,value,requiredLink=false)=>{
  if(missing(value)){if(requiredLink)report(e,'missing_link','links','error',field,'Отсутствует обязательная ссылка','Нельзя достоверно определить связанную запись.');return}
  if(!idOK(value)){report(e,'invalid_link','links','error',field,'Неверный тип или формат ссылки','Ожидается постоянный строковый ID, без преобразования типов.');return}
  const matches=indexes[target].get(value)||[];
  if(matches.length>1)report(e,'ambiguous_link','links','error',field,'Ссылка неоднозначна','В целевой коллекции несколько записей с этим ID.');
  else if(!matches.length){
   const other=collections.filter(k=>k!==target&&indexes[k].has(value));
   report(e,other.length?'wrong_target_type':'missing_target','links','error',field,
    other.length?'ID найден только в другом типе сущности':'Связанная запись не найдена',
    'Поле '+field+' должно ссылаться на '+target+'.'+(other.length?' Совпадения: '+other.join(', ')+'.':''));
  }
 };
 for(const collection of collections)for(const e of rows[collection]){
  const r=e.row;
  for(const [field,target] of Object.entries(referenceTargets))checkLink(e,field,target,r[field],
   field==='workerId'&&['attendance','payments'].includes(collection)||field==='itemId'&&collection==='warehouseMovements');
  if(r.workerIds!==undefined){
   if(!Array.isArray(r.workerIds))report(e,'invalid_worker_list','links','error','workerIds','Список сотрудников повреждён','Ожидается массив ID.');
   else {r.workerIds.forEach((v,i)=>checkLink(e,'workerIds['+i+']','workers',v,true));
    if(new Set(r.workerIds).size!==r.workerIds.length)report(e,'repeated_worker_link','links','warning','workerIds','Сотрудник повторяется в списке','Проверьте учёт количества работников.')}
  }
  for(const field of ['amount','rate','ratePerShift','shifts','hours','fine','deduction','qty','baseQty','workersCount'])
   if(!missing(r[field])&&!number(r[field]))report(e,'invalid_number','values','error',field,'Некорректное числовое значение','Ожидается конечное неотрицательное число или числовая строка.');
  for(const field of ['date','due','start','end'])if(!missing(r[field])&&!validDate(r[field]))
   report(e,'invalid_date','values','error',field,'Некорректная дата','Дата должна существовать в календаре и иметь формат YYYY-MM-DD.');
  if(['works','attendance','payments','expenses','income','accountable','warehouseMovements'].includes(collection)&&missing(r.date))
   report(e,'missing_date','values','error','date','Дата отсутствует','Невозможно достоверно определить период записи.');
  if(r.paymentId&&indexes.payments.get(r.paymentId)?.length===1){
   const p=indexes.payments.get(r.paymentId)[0];
   for(const field of ['workerId','objectId'])if(!missing(r[field])&&!missing(p.row[field])&&r[field]!==p.row[field])
    report(e,'contradictory_payment_link','links','error',field,'Связанные операции указывают разные сущности','Поле '+field+' не совпадает со связанной выплатой.',[p]);
  }
 }
 const groupBy=(entries,key,code,category,message,reason)=>{
  const groups=new Map();
  for(const e of entries){const k=key(e.row);if(k===null)continue;const a=groups.get(k)||[];a.push(e);groups.set(k,a)}
  for(const a of groups.values())if(a.length>1)for(const e of a)report(e,code,category,'warning','',message,reason);
 };
 for(const e of rows.attendance){
  const r=e.row;
  if(missing(r.ratePerShift))report(e,'missing_rate','attendance','warning','ratePerShift','Ставка смены не сохранена','Текущая ставка сотрудника не доказывает историческую. Сверьте первичный табель.');
  if(!number(r.shifts))report(e,'missing_shift_quantity','attendance','warning','shifts','Количество смен отсутствует или неопределённо','Начисление нельзя подтвердить по исходной записи.');
  if(missing(r.hours))report(e,'missing_hours','attendance','warning','hours','Часы не указаны','Не подставляем часы по догадке; для непочасовой смены поле может быть справочным.');
  if(!['Смена','Половина смены','Часы','Отсутствовал'].includes(r.status))
   report(e,'unknown_shift_status','attendance','warning','status','Статус смены неизвестен','Правило расчёта нужно сверить с первичным табелем.');
  if(!missing(r.shiftType)&&!['day','night','unspecified'].includes(r.shiftType))
   report(e,'unknown_shift_type','attendance','warning','shiftType','Неизвестное время смены','Нельзя уверенно отличить дневную смену от ночной.');
  if(r.status==='Часы'){
   if(!number(r.hours)||Number(r.hours)<=0||Number(r.hours)>24)report(e,'invalid_hourly_hours','attendance','error','hours','Недопустимые часы почасовой смены','Для почасовой оплаты нужны часы больше 0 и не больше 24.');
   else if(number(r.shifts)&&Math.abs(Number(r.shifts)-Number(r.hours)/8)>1e-9)
    report(e,'inconsistent_hours','attendance','warning','shifts','Часы и количество смен противоречат друг другу','Сверьте исходник: действующее правило почасовой оплаты использует часы / 8.');
  }else if(number(r.hours)&&Number(r.hours)>24)report(e,'excessive_hours','attendance','warning','hours','Указано больше 24 часов','Проверьте единицу измерения и дату.');
  const expected=r.status==='Отсутствовал'?0:r.status==='Половина смены'?0.5:null;
  if(expected!==null&&number(r.shifts)&&Number(r.shifts)!==expected)
   report(e,'inconsistent_shift_quantity','attendance','warning','shifts','Статус и количество смен противоречат друг другу','Проверьте исходный табель; расчёт и запись не изменены.');
 }
 const shifts=new Map();
 for(const e of rows.attendance)if(idOK(e.row.workerId)&&validDate(e.row.date)){
  const key=JSON.stringify([e.row.workerId,e.row.date]);const a=shifts.get(key)||[];a.push(e);shifts.set(key,a);
 }
 for(const a of shifts.values())if(a.length>1){
  const type=r=>['day','night'].includes(r.shiftType)?r.shiftType:'unspecified';
  const counts=new Map();for(const e of a){const t=type(e.row);counts.set(t,(counts.get(t)||0)+1)}
  const ambiguous=a.some(e=>e.row.status==='Отсутствовал'||type(e.row)==='unspecified');
  for(const e of a)if(ambiguous||counts.get(type(e.row))>1)
   report(e,'shift_conflict','attendance','warning','date','Возможный дубль начисления или конфликт смен','Совпадают сотрудник и дата; время смены совпадает либо неоднозначно. Это кандидат на сверку, не доказанный дубль.');
 }
 const moneyCollections=['payments','expenses','income','accountable'];
 for(const collection of moneyCollections)for(const e of rows[collection]){
  const r=e.row;
  if(!number(r.amount)||Number(r.amount)<=0)report(e,'invalid_amount','finance','error','amount','Сумма отсутствует или недопустима','Финансовая операция должна иметь положительную конечную сумму.');
  if(collection==='expenses'||collection==='payments'&&['Аванс','Выплата'].includes(r.kind)){
   if(!['other','accountable'].includes(r.paymentSource))report(e,'unknown_payment_source','finance','warning','paymentSource','Источник оплаты отсутствует или неизвестен','Нельзя уверенно отнести операцию к подотчётным или другим средствам.');
  }
  if(missing(r.objectId))report(e,'unattributed_object','finance','info','objectId','Объект операции не указан','Это может быть общей операцией. Распределение по объектам нельзя определить автоматически.');
  const knownKind=collection==='payments'?['Аванс','Выплата','Штраф','Удержание'].includes(r.kind):collection==='accountable'?['receipt','return'].includes(r.kind):true;
  if(!knownKind||collection==='expenses'&&missing(r.category)&&missing(r.notes)||collection==='income'&&missing(r.source)&&missing(r.notes))
   report(e,'unknown_purpose','finance','warning','kind/category/source','Назначение операции требует уточнения','Тип или описание не позволяют достоверно определить назначение.');
 }
 for(const collection of moneyCollections)groupBy(rows[collection],r=>validDate(r.date)&&number(r.amount)&&Number(r.amount)>0?
  JSON.stringify([r.date,Number(r.amount),r.workerId??'',r.objectId??'',r.kind??'',r.paymentSource??'',r.category??'',r.vendor??'',r.source??'']):null,
  'possible_duplicate_operation','finance','Возможная повторная финансовая операция','Совпадают дата, сумма и основные реквизиты. Законные отдельные платежи также могут совпадать; автоматического объединения нет.');
 groupBy(rows.payments,r=>idOK(r.workerId)&&validDate(r.weeklyWeekStart)&&validDate(r.weeklyWeekEnd)&&['Аванс','Выплата'].includes(r.kind)?
  JSON.stringify([r.workerId,r.weeklyWeekStart,r.weeklyWeekEnd]):null,'repeated_weekly_payment','finance','Возможная повторная выплата за неделю','Совпадают сотрудник и недельный период; проверьте, не были ли это отдельные частичные выплаты.');
 for(const collection of ['attendance','payments'])groupBy(rows[collection],r=>typeof r.importSourceKey==='string'&&r.importSourceKey?r.importSourceKey:null,
  'repeated_import_source',collection==='attendance'?'attendance':'finance','Повторяется ключ исходной строки импорта','Сверьте записи с первичным источником; записи не объединены.');
 const wages=new Map(),adjustments=new Map();
 for(const e of rows.payments){const r=e.row;if(!validDate(r.date)||!number(r.amount))continue;
  const key=JSON.stringify([r.date,Number(r.amount)]);const a=wages.get(key)||[];if(['Аванс','Выплата'].includes(r.kind)){a.push(e);wages.set(key,a)}
  if(['Штраф','Удержание'].includes(r.kind)){const k=JSON.stringify([r.workerId,r.date,r.kind,Number(r.amount)]);const b=adjustments.get(k)||[];b.push(e);adjustments.set(k,b)}
 }
 for(const e of rows.expenses){
  const r=e.row,linked=indexes.payments.get(r.paymentId)||[];
  const matches=linked.length?linked:number(r.amount)?wages.get(JSON.stringify([r.date,Number(r.amount)]))||[]:[];
  if(matches.length&&(r.paymentId||salaryExpenseHint({category:typeof r.category==='string'?r.category:'',notes:typeof r.notes==='string'?r.notes:''})))
   report(e,'possible_salary_double_count','finance','warning','paymentId','Расход может повторять зарплатную операцию','Есть ссылка на выплату или зарплатное назначение с совпадением даты и суммы; требуется сверка.',matches.slice(0,10));
 }
 for(const e of rows.attendance)for(const [field,kind] of [['fine','Штраф'],['deduction','Удержание']]){
  const r=e.row;if(!number(r[field])||Number(r[field])<=0)continue;
  const a=adjustments.get(JSON.stringify([r.workerId,r.date,kind,Number(r[field])]))||[];
  if(a.length)report(e,'possible_double_deduction','finance','warning',field,'Возможное повторное удержание','Та же сумма удержания указана в табеле и отдельной зарплатной операции.',a.slice(0,10));
 }

  // B0-05 reads only the parsed raw JSON. It deliberately does not call validate(),
  // which is a write-time contract and can normalise optional collections in memory.
  const collectionState=collection=>data[collection]===undefined?'absent':Array.isArray(data[collection])?'available':'damaged';
  const collectionReason=(collection,state)=>state==='absent'?'В исходном JSON нет коллекции '+collection+'.':'Коллекция '+collection+' повреждена и недоступна для полной проверки.';
  const warehouseState=collectionState('warehouse'),movementState=collectionState('warehouseMovements');
  const warehouseRowsComplete=warehouseState==='available'&&rows.warehouse.length===data.warehouse.length;
  const movementRowsComplete=movementState==='available'&&rows.warehouseMovements.length===data.warehouseMovements.length;
  const b05Report=(direction,e,code,category,severity,field,message,reason,related=[])=>{
   report(e,code,category,severity,field,message,reason,related);countProblem(direction);
  };
  const knownMovementKinds=['issue','return','restock','writeoff'];
  const unitRule=value=>{
   if(typeof value!=='string'||!value.trim())return 'unknown';
   const unit=value.trim().toLocaleLowerCase('ru-RU').replace(/\s+/g,'').replace(/\./g,'').replace(/²/g,'2').replace(/³/g,'3');
   if(['шт','штука','штуки','штук','ед','единица','единицы','единиц','pc','pcs','piece','pieces'].includes(unit))return 'discrete';
   if(['кг','килограмм','килограмма','килограммов','г','гр','грамм','грамма','граммов','т','тонна','тонны','тонн','л','литр','литра','литров','мл','миллилитр','миллилитра','миллилитров','м','метр','метра','метров','см','мм','м2','квм','квадратныйметр','квадратныхметров','м3','кубм','кубическийметр','кубическихметров','мп','погм','kg','g','t','l','ml','m','cm','mm','m2','m3','sqm','cbm'].includes(unit))return 'fractional';
   return 'unknown';
  };
  const uniqueEntry=(collection,id)=>idOK(id)&&(indexes[collection].get(id)||[]).length===1;
  const textPart=value=>missing(value)?'':typeof value==='string'?value:null;
  const itemFacts=new Map(),movementByItem=new Map(),serialGroups=new Map(),movementGroups=new Map();

  if(warehouseState!=='available'){
   const reason=collectionReason('warehouse',warehouseState);
   impossible('warehouse_balances',reason);impossible('warehouse_chronology',reason);impossible('warehouse_links',reason);impossible('warehouse_serials',reason);
   if(movementState==='available'){
    partial('warehouse_movements',reason+' Поля движения доступны, но ссылки на инструмент проверить полностью нельзя.');
    partial('warehouse_duplicates',reason+' Полные совпадения не подтверждаются без доступного инструмента.');
   }else{impossible('warehouse_movements',collectionReason('warehouseMovements',movementState));impossible('warehouse_duplicates',collectionReason('warehouseMovements',movementState));}
  }
  if(movementState!=='available'){
   const reason=collectionReason('warehouseMovements',movementState);
   if(warehouseState==='available'){
    partial('warehouse_balances',reason+' Итоговый остаток нельзя определить без полного журнала движений.');
    partial('warehouse_links',reason+' Ссылки карточек инструмента проверены, но связи движений недоступны.');
   }
   impossible('warehouse_chronology',reason+' Последовательность между датами недоступна без журнала движений.');
   impossible('warehouse_movements',reason);impossible('warehouse_duplicates',reason);
  }
  if(warehouseState==='available'&&!warehouseRowsComplete){
   partial('warehouse_balances','Часть записей warehouse не является объектом, поэтому остатки проверены не полностью.');
   partial('warehouse_chronology','Часть карточек warehouse не является объектом, поэтому начальные остатки для хронологии определены не полностью.');
   partial('warehouse_links','Часть записей warehouse не является объектом, поэтому ссылки проверены не полностью.');
   partial('warehouse_serials','Часть записей warehouse не является объектом, поэтому номера проверены не полностью.');
  }
  if(movementState==='available'&&!movementRowsComplete){
   partial('warehouse_balances','Часть записей warehouseMovements не является объектом, поэтому остатки проверены не полностью.');
   partial('warehouse_chronology','Часть записей warehouseMovements не является объектом, поэтому последовательность между датами проверена не полностью.');
   partial('warehouse_movements','Часть записей warehouseMovements не является объектом, поэтому журнал проверен не полностью.');
   partial('warehouse_duplicates','Часть записей warehouseMovements не является объектом, поэтому дубли проверены не полностью.');
  }

  for(const e of rows.warehouse){
   const r=e.row,unit=unitRule(r.unit),hasBase=!missing(r.baseQty)&&number(r.baseQty),baseNumber=hasBase?Number(r.baseQty):null;
   let baseOK=hasBase,unitOK=true;
   if(missing(r.baseQty))b05Report('warehouse_balances',e,'missing_warehouse_base_quantity','warehouse','error','baseQty','Начальное количество отсутствует','Расчётный остаток нельзя определить без warehouse.baseQty.');
   else if(!number(r.baseQty))countProblem('warehouse_balances');
   if(unit==='discrete'&&hasBase&&!Number.isInteger(baseNumber)){
    b05Report('warehouse_balances',e,'fractional_stock_quantity','warehouse','error','baseQty','Дробное количество штучного инструмента','Для распознанной штучной единицы измерения количество должно быть целым.');baseOK=false;unitOK=false;
   }
   if(unit==='unknown'){
    b05Report('warehouse_balances',e,'unknown_warehouse_unit','warehouse','info','unit','Единица измерения не определена','Нельзя достоверно решить, допустимо ли дробное количество; исходное значение не изменено.');
    partial('warehouse_balances','Для части записей единица измерения не распознана, поэтому правило дробных количеств применено не полностью.');
   }
   if(missing(r.objectId)){b05Report('warehouse_links',e,'missing_warehouse_object_link','warehouse','error','objectId','Отсутствует ссылка на объект','Карточка инструмента должна содержать явный objectId; по названию объекта ссылка не восстанавливается.');partial('warehouse_links','Часть карточек не содержит явной ссылки на объект.');}
   else if(!uniqueEntry('objects',r.objectId)){countProblem('warehouse_links');partial('warehouse_links','Часть ссылок на объект нельзя однозначно разрешить.');}
   if(!missing(r.serial)&&typeof r.serial!=='string'){
    b05Report('warehouse_serials',e,'invalid_warehouse_serial','warehouse','error','serial','Инвентарный номер имеет неверный формат','Для сравнения нужен текстовый инвентарный номер.');
    partial('warehouse_serials','Часть инвентарных номеров имеет неверный формат.');
   }else if(typeof r.serial==='string'&&r.serial.trim()){
    const key=r.serial.trim().toLocaleLowerCase('ru-RU'),group=serialGroups.get(key)||[];group.push(e);serialGroups.set(key,group);
   }
   if(idOK(r.id)&&uniqueEntry('warehouse',r.id))itemFacts.set(r.id,{entry:e,unit,baseOK,unitOK,base:Number(r.baseQty)});
  }

  for(const e of rows.warehouseMovements){
   const r=e.row,dateOK=validDate(r.date),kindOK=knownMovementKinds.includes(r.kind),qtyOK=number(r.qty)&&Number(r.qty)>0;
   const itemOK=uniqueEntry('warehouse',r.itemId),item=itemOK?itemFacts.get(r.itemId):undefined;
   let unitOK=true;
   if(!dateOK)countProblem('warehouse_movements');
   if(!kindOK)b05Report('warehouse_movements',e,'invalid_warehouse_movement_kind','warehouse','error','kind','Неизвестный вид складской операции','Допустимы выдача, возврат, пополнение или списание; запись не изменена.');
   if(!qtyOK)b05Report('warehouse_movements',e,'invalid_warehouse_movement_quantity','warehouse','error','qty','Количество движения отсутствует или недопустимо','Для движения нужно положительное конечное количество.');
   if(!itemOK){
    countProblem('warehouse_links');partial('warehouse_balances','Часть движений нельзя связать с единственной карточкой инструмента, поэтому остатки рассчитаны не полностью.');
    partial('warehouse_duplicates','Часть движений нельзя сопоставить с инструментом, поэтому дубли проверены не полностью.');
   }
   if(item&&item.unit==='discrete'&&qtyOK&&!Number.isInteger(Number(r.qty))){
    b05Report('warehouse_movements',e,'fractional_stock_quantity','warehouse','error','qty','Дробное количество штучного инструмента','Для распознанной штучной единицы измерения количество движения должно быть целым.');unitOK=false;
   }
   if(item&&item.unit==='unknown'&&qtyOK&&!Number.isInteger(Number(r.qty)))partial('warehouse_movements','Для части движений единица измерения не распознана, поэтому правило дробных количеств применено не полностью.');
   if(itemOK){const list=movementByItem.get(r.itemId)||[];list.push({entry:e,dateOK,kindOK,qtyOK,unitOK});movementByItem.set(r.itemId,list)}
   const assignee=textPart(r.assignee),notes=textPart(r.notes);
   if(itemOK&&dateOK&&kindOK&&qtyOK&&assignee!==null&&notes!==null){
    const key=JSON.stringify([r.itemId,r.date,r.kind,Number(r.qty),assignee,notes]),group=movementGroups.get(key)||[];group.push(e);movementGroups.set(key,group);
   }else if(assignee===null||notes===null)partial('warehouse_duplicates','Часть текстовых реквизитов движения имеет неверный формат, поэтому дубли проверены не полностью.');
  }
  for(const [entries,fields] of [[rows.warehouse,[['workerId','workers'],['itemId','warehouse']]],[rows.warehouseMovements,[['objectId','objects'],['workerId','workers']]]])for(const e of entries)for(const [field,target] of fields)if(!missing(e.row[field])&&!uniqueEntry(target,e.row[field]))countProblem('warehouse_links');

  const relatedEntries=(group,current)=>{
   const related=[];
   for(const other of group){if(other!==current)related.push(other);if(related.length===10)break;}
   return related;
  };
  for(const group of serialGroups.values())if(group.length>1)for(const e of group)
   b05Report('warehouse_serials',e,'possible_duplicate_serial','warehouse','warning','serial','Возможное совпадение инвентарного номера','Номера совпадают без учёта регистра и пробелов по краям. Сверьте связанные карточки вручную.',relatedEntries(group,e));
  for(const group of movementGroups.values())if(group.length>1)for(const e of group)
   b05Report('warehouse_duplicates',e,'possible_duplicate_warehouse_movement','warehouse','warning','','Возможный дубль движения','Совпадают инструмент, дата, вид, количество, получатель и примечание. Это кандидат для ручной сверки; записи не объединены.',relatedEntries(group,e));

  const reportQuantityOverflow=(item,related=[])=>{
   b05Report('warehouse_balances',item.entry,'warehouse_quantity_overflow','warehouse','error','baseQty','Расчёт количества выходит за пределы конечного числа','Промежуточный или итоговый остаток невозможно определить достоверно; ошибочное значение не заменяется нулём.',related);
   countProblem('warehouse_chronology');
   partial('warehouse_balances','Для части карточек расчёт количества выходит за пределы конечного числа.');
   partial('warehouse_chronology','Для части карточек междневный расчёт выходит за пределы конечного числа.');
  };
   // Number is retained as an overflow guard, but it is not reliable for a sign
   // comparison of fractional quantities (for example, 0.3 - 0.1 - 0.2). Keep a
   // finite decimal coefficient and its base-10 scale for that comparison instead.
   // Preserve JSON number lexemes before JSON.parse can round them. Quoted JSON
   // strings are matched first and left intact; only unquoted numbers are quoted
   // in this private read-only copy. Validation still uses the original data.
   const quantitySources=warehouseState==='available'&&movementState==='available'?JSON.parse(raw.replace(/"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g,token=>token[0]==='"'?token:JSON.stringify(token))):null;
   const sourceQuantity=(entry,field)=>quantitySources[entry.collection][entry.index][field];
   const exactDecimalLimit=4096,decimalBigIntAvailable=typeof BigInt==='function',decimalZero=decimalBigIntAvailable?BigInt(0):null,decimalOne=decimalBigIntAvailable?BigInt(1):null,decimalTen=decimalBigIntAvailable?BigInt(10):null,decimalPowers=new Map(decimalBigIntAvailable?[[0,decimalOne]]:[]);
   const decimalPower=power=>{
    if(!decimalBigIntAvailable||!Number.isSafeInteger(power)||power<0||power>exactDecimalLimit)return null;
    if(!decimalPowers.has(power))decimalPowers.set(power,decimalTen**BigInt(power));
    return decimalPowers.get(power);
   };
   const exactDecimal=value=>{
    if(!decimalBigIntAvailable)return null;
    const source=typeof value==='string'?value.trim():typeof value==='number'?String(value):'';
    if(source.length>exactDecimalLimit)return null;
    const match=/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(source);
    if(!match)return null;
    const whole=match[2]||'0',fraction=match[4]===undefined?(match[3]||''):match[4],exponent=Number(match[5]||0);
    if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>exactDecimalLimit)return null;
    const digits=(whole+fraction).replace(/^0+/,'')||'0',rawScale=fraction.length-exponent;
    if(digits.length>exactDecimalLimit||Math.abs(rawScale)>exactDecimalLimit)return null;
    let coefficient;
    try{coefficient=BigInt(digits)}catch{return null}
    if(match[1]==='-')coefficient=-coefficient;
    if(rawScale<0){
     const multiplier=decimalPower(-rawScale);if(multiplier===null||digits.length-rawScale>exactDecimalLimit)return null;
     coefficient*=multiplier;
    }
    return {coefficient,scale:Math.max(0,rawScale)};
   };
   const decimalDigits=coefficient=>(coefficient<decimalZero?-coefficient:coefficient).toString().length;
   const addExactDecimal=(left,right)=>{
    const scale=Math.max(left.scale,right.scale),leftShift=scale-left.scale,rightShift=scale-right.scale;
    if(scale>exactDecimalLimit||decimalDigits(left.coefficient)+leftShift>exactDecimalLimit||decimalDigits(right.coefficient)+rightShift>exactDecimalLimit)return null;
    const leftPower=decimalPower(leftShift),rightPower=decimalPower(rightShift);
    if(leftPower===null||rightPower===null)return null;
    const coefficient=left.coefficient*leftPower+right.coefficient*rightPower;
    return decimalDigits(coefficient)>exactDecimalLimit?null:{coefficient,scale};
   };
   const signedExactMovement=(movement)=>{
    const quantity=exactDecimal(sourceQuantity(movement.entry,'qty'));if(!quantity)return null;
    return ['return','restock'].includes(movement.entry.row.kind)?quantity:{coefficient:-quantity.coefficient,scale:quantity.scale};
   };
   const reportQuantityPrecisionLimit=(item,entry=item.entry,field='baseQty',related=[])=>{
    b05Report('warehouse_balances',entry,'warehouse_quantity_precision_limit','warehouse','warning',field,'Точная десятичная проверка количества недоступна','Исходное число нельзя надёжно представить или сложить как конечную десятичную запись в поддерживаемом диапазоне. Результат не подменяется нулём и не считается проверенным.',related);
    countProblem('warehouse_chronology');
    partial('warehouse_balances','Для части карточек точное сравнение количеств недоступно.');
    partial('warehouse_chronology','Для части карточек точное междневное сравнение количеств недоступно.');
   };
  if(warehouseState==='available'&&movementState==='available')for(const [id,item] of itemFacts){
   const movements=movementByItem.get(id)||[];
   if(!item.baseOK||!item.unitOK||movements.some(m=>!m.kindOK||!m.qtyOK||!m.unitOK)){
    partial('warehouse_balances','Для части карточек остаток нельзя определить из-за некорректных исходных количеств или движений.');
    partial('warehouse_chronology','Для части карточек последовательность между датами нельзя определить из-за некорректных исходных количеств или движений.');
    continue;
   }
    let numberBalance=item.base,exactBalance=exactDecimal(sourceQuantity(item.entry,'baseQty')),calculationOK=Number.isFinite(numberBalance),exactCalculationOK=!!exactBalance;
    if(!exactCalculationOK){reportQuantityPrecisionLimit(item);continue}
    const exactDeltas=new Map();
   for(const movement of movements){
     const r=movement.entry.row,q=Number(r.qty),delta=['return','restock'].includes(r.kind)?q:-q,next=numberBalance+delta;
    if(!Number.isFinite(next)){reportQuantityOverflow(item,movements.map(m=>m.entry).slice(0,10));calculationOK=false;break;}
     const exactDelta=signedExactMovement(movement),exactNext=exactDelta&&addExactDecimal(exactBalance,exactDelta);
     if(!exactNext){reportQuantityPrecisionLimit(item,movement.entry,'qty',[item.entry,...movements.filter(other=>other!==movement).map(other=>other.entry).slice(0,9)]);exactCalculationOK=false;break;}
     numberBalance=next;exactBalance=exactNext;exactDeltas.set(movement,exactDelta);
   }
    if(!calculationOK||!exactCalculationOK)continue;
    if(exactBalance.coefficient<decimalZero)b05Report('warehouse_balances',item.entry,'negative_warehouse_balance','warehouse','error','baseQty','Отрицательный расчётный остаток','Формула использует начальное количество и доступные движения. Порядок операций внутри одной даты не устанавливался.',movements.map(m=>m.entry).slice(0,10));
    if(item.entry.row.condition==='Списан'&&exactBalance.coefficient>decimalZero)b05Report('warehouse_balances',item.entry,'warehouse_condition_balance_mismatch','warehouse','warning','condition','Статус карточки сам по себе не уменьшает количество. Проверьте, не отсутствует ли операция списания.',movements.map(m=>m.entry).slice(0,10));

   if(movements.some(m=>!m.dateOK)){
    partial('warehouse_chronology','Часть движений имеет некорректную дату, поэтому последовательность между датами проверена не полностью.');
    continue;
   }
   const days=new Map();let chronologyOK=true;
   for(const movement of movements){
    const r=movement.entry.row,q=Number(r.qty),delta=['return','restock'].includes(r.kind)?q:-q;
     const day=days.get(r.date)||{numberDelta:0,exactDelta:{coefficient:decimalZero,scale:0},entries:[]},nextDelta=day.numberDelta+delta;
    if(!Number.isFinite(nextDelta)){reportQuantityOverflow(item,[movement.entry]);chronologyOK=false;break;}
     const exactNextDelta=addExactDecimal(day.exactDelta,exactDeltas.get(movement));
     if(!exactNextDelta){reportQuantityPrecisionLimit(item,movement.entry,'qty',[item.entry,...day.entries.slice(0,9)]);chronologyOK=false;break;}
     day.numberDelta=nextDelta;day.exactDelta=exactNextDelta;day.entries.push(movement.entry);days.set(r.date,day);
   }
   if(!chronologyOK||days.size<2)continue;
    let historicalNumberBalance=item.base,historicalExactBalance=exactDecimal(sourceQuantity(item.entry,'baseQty'));
   for(const [date,day] of [...days.entries()].sort(([a],[b])=>a.localeCompare(b))){
     const next=historicalNumberBalance+day.numberDelta;
     if(!Number.isFinite(next)){reportQuantityOverflow(item,[item.entry,...day.entries.filter(entry=>entry!==item.entry).slice(0,9)]);break;}
     const exactNext=addExactDecimal(historicalExactBalance,day.exactDelta);
     if(!exactNext){reportQuantityPrecisionLimit(item,item.entry,'baseQty',[...day.entries.slice(0,10)]);break;}
     historicalNumberBalance=next;historicalExactBalance=exactNext;
     if(historicalExactBalance.coefficient<decimalZero){
     const record=day.entries[0],related=[item.entry,...relatedEntries(day.entries,record)].slice(0,10);
     b05Report('warehouse_chronology',record,'possible_warehouse_intermediate_negative_balance','warehouse','warning','date','Возможен отрицательный промежуточный остаток','После дневного итога за '+date+' расчётный остаток отрицателен. warehouse.baseQty не имеет даты, поэтому достоверность начального исторического остатка ограничена; операции одной даты не упорядочиваются. Это кандидат для ручной сверки, не доказанная ошибка.',related);
    }
   }
  }

  const base64Info=value=>{
   if(typeof value!=='string'||!value||value!==value.trim())return {valid:false};
   const match=/^data:([^;,]+);base64,([A-Za-z0-9+/=]*)$/i.exec(value);if(!match)return {valid:false};
   const mime=match[1].toLowerCase(),payload=match[2],equals=payload.indexOf('=');
   if(!payload||payload.length%4!==0||equals!==-1&&equals<payload.length-2||!/^[A-Za-z0-9+/]*={0,2}$/.test(payload))return {valid:false};
   let bytes=null;try{if(typeof atob==='function'){const sample=payload.length>64?payload.slice(0,64):payload;bytes=atob(sample)}}catch{return {valid:false}}
   return {valid:true,mime,bytes};
  };
  const hasBytes=(bytes,values,offset=0)=>typeof bytes==='string'&&values.every((value,index)=>bytes.charCodeAt(offset+index)===value);
  const signatureState=(mime,bytes)=>{
   if(!bytes)return 'unknown';
   if(mime==='image/png')return hasBytes(bytes,[137,80,78,71,13,10,26,10])?'valid':'corrupt';
   if(['image/jpeg','image/jpg'].includes(mime))return hasBytes(bytes,[255,216,255])?'valid':'corrupt';
   if(mime==='image/gif')return hasBytes(bytes,[71,73,70,56])?'valid':'corrupt';
   if(mime==='image/webp')return hasBytes(bytes,[82,73,70,70])&&hasBytes(bytes,[87,69,66,80],8)?'valid':'corrupt';
   if(mime==='image/bmp')return hasBytes(bytes,[66,77])?'valid':'corrupt';
   if(mime==='application/pdf')return hasBytes(bytes,[37,80,68,70,45])?'valid':'corrupt';
   if(['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(mime))return hasBytes(bytes,[80,75,3,4])?'valid':'corrupt';
   return 'unknown';
  };
  const worksState=collectionState('works'),expensesState=collectionState('expenses');
  const attachmentAvailable=worksState==='available'||expensesState==='available';
  if(!attachmentAvailable)impossible('attachments','Коллекции works и expenses недоступны для проверки вложений.');
  else if(worksState!=='available'||expensesState!=='available')partial('attachments','Доступна только часть коллекций с вложениями.');
  if(worksState==='available'&&rows.works.length!==data.works.length)partial('attachments','Часть записей works не является объектом, поэтому вложения проверены не полностью.');
  if(expensesState==='available'&&rows.expenses.length!==data.expenses.length)partial('attachments','Часть записей expenses не является объектом, поэтому вложения проверены не полностью.');
  for(const e of rows.works){
   const photos=e.row.photos;if(photos===undefined)continue;
   if(!Array.isArray(photos)){b05Report('attachments',e,'invalid_photos_structure','attachments','error','photos','Список фотографий имеет неверный формат','Ожидается массив встроенных ссылок; содержимое не изменено.');partial('attachments','Часть списков фотографий имеет неверный формат.');continue;}
   photos.forEach((photo,index)=>{
    const field='photos['+index+']';if(typeof photo!=='string'){b05Report('attachments',e,'invalid_photo_attachment','attachments','error',field,'Фотография имеет неверный формат','Ожидается строка data URL; содержимое вложения не выводится.');partial('attachments','Часть фотографий имеет неверный формат.');return}
    if(!photo.trim()){b05Report('attachments',e,'empty_photo_attachment','attachments','error',field,'Фотография пуста','Встроенная строка вложения отсутствует.');return}
   const info=base64Info(photo);if(!info.valid||!info.mime.startsWith('image/')){
    const isDataUrl=/^data:/i.test(photo);
    b05Report('attachments',e,isDataUrl?'corrupt_photo_attachment':'invalid_photo_attachment','attachments','error',field,isDataUrl?'Фотография распознаётся как повреждённая':'Фотография имеет неподдерживаемый формат',isDataUrl?'Проверяется только синтаксис встроенного image data URL; содержимое вложения не выводится.':'Проверяются только встроенные image data URL; доступность внешнего файла не заявляется.');
    if(!isDataUrl)partial('attachments','Часть фотографий не является встроенным image data URL и недоступна для полной проверки.');
    return;
   }
    if(signatureState(info.mime,info.bytes)==='corrupt')b05Report('attachments',e,'corrupt_photo_attachment','attachments','warning',field,'Фотография распознаётся как повреждённая','Тип data URL не соответствует распознаваемому заголовку файла. Полная проверка изображения не выполнялась.');
   });
  }
  const receiptMimes=new Set(['image/png','image/jpeg','image/jpg','image/gif','image/webp','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain','text/csv']);
  for(const e of rows.expenses){
   const receipts=e.row.receipts;if(receipts===undefined)continue;
   if(!Array.isArray(receipts)){b05Report('attachments',e,'invalid_receipts_structure','attachments','error','receipts','Список документов имеет неверный формат','Ожидается массив встроенных документов; содержимое не изменено.');partial('attachments','Часть списков документов имеет неверный формат.');continue;}
   receipts.forEach((receipt,index)=>{
    const prefix='receipts['+index+']';if(!object(receipt)){b05Report('attachments',e,'invalid_receipt_attachment','attachments','error',prefix,'Документ имеет неверный формат','Ожидается объект со встроенными данными и именем файла.');partial('attachments','Часть документов имеет неверный формат.');return}
    if(typeof receipt.name!=='string'||!receipt.name.trim())b05Report('attachments',e,'empty_receipt_attachment','attachments','warning',prefix+'.name','У документа отсутствует имя','Имя вложения пусто или имеет неверный формат.');
    if(typeof receipt.data!=='string'||!receipt.data.trim()){b05Report('attachments',e,'empty_receipt_attachment','attachments','error',prefix+'.data','Документ пуст','Встроенная строка вложения отсутствует.');return}
   const info=base64Info(receipt.data);if(!info.valid){
    const isDataUrl=/^data:/i.test(receipt.data);
    b05Report('attachments',e,isDataUrl?'corrupt_receipt_attachment':'invalid_receipt_attachment','attachments','error',prefix+'.data',isDataUrl?'Документ распознаётся как повреждённый':'Документ имеет неподдерживаемый формат',isDataUrl?'Проверяется только синтаксис data URL; содержимое вложения не выводится.':'Проверяются только встроенные data URL; доступность внешнего файла не заявляется.');
    if(!isDataUrl)partial('attachments','Часть документов не является встроенным data URL и недоступна для полной проверки.');
    return;
   }
   if(!receiptMimes.has(info.mime)){b05Report('attachments',e,'unsupported_receipt_attachment','attachments','warning',prefix+'.data','Тип документа не поддерживается для проверки','Доступна только проверка встроенных изображений, PDF, DOCX, XLSX, TXT и CSV.');partial('attachments','Часть документов имеет неподдерживаемый тип для доступной проверки.');return}
    if(signatureState(info.mime,info.bytes)==='corrupt')b05Report('attachments',e,'corrupt_receipt_attachment','attachments','warning',prefix+'.data','Документ распознаётся как повреждённый','Тип data URL не соответствует распознаваемому заголовку файла. Полная проверка документа не выполнялась.');
    if(receipt.verified!==undefined&&typeof receipt.verified!=='boolean')b05Report('attachments',e,'invalid_receipt_attachment','attachments','warning',prefix+'.verified','Статус проверки документа имеет неверный формат','Ожидается логическое значение статуса; содержимое документа не изменено.');
   });
  }
 return done(complete);
}
const api={diagnoseRaw,validate,create,createDataStore:create,reference,resolveReference,referenceTargets,protectClosedReports,financialChanges,salaryExpenseHint,salaryExpense,protectSalaryExpenses};if(typeof module!=='undefined')module.exports=api;else root.ProrabkaStorage=api;
})(globalThis);
