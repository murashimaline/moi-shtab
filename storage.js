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
 const add=(code,category,severity,collection,index,row,field,message,reason,related=[])=>{
  issues.push({code,category,severity,record:{collection,index,id:typeof row?.id==='string'?row.id:null},
   field,message,reason,related:related.map(x=>({collection:x.collection,index:x.index,id:typeof x.row?.id==='string'?x.row.id:null}))});
 };
 const done=(complete=true)=>({readOnly:true,complete,issues,counts:issues.reduce((n,x)=>(n[x.severity]++,n),{error:0,warning:0,info:0})});
 if(raw===null)return done();
 let data;
 try{data=JSON.parse(raw)}catch{add('invalid_json','structure','error','$',null,null,'','JSON не читается','Синтаксис исходной базы повреждён; содержимое не изменено.');return done(false)}
 if(!object(data)||data.version!==3){add('unsupported_version','structure','error','$',null,null,'version','Формат базы не поддерживается','Диагностика рассчитана на JSON version 3.');return done(false)}
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
 return done(complete);
}
const api={diagnoseRaw,validate,create,createDataStore:create,reference,resolveReference,referenceTargets,protectClosedReports,financialChanges,salaryExpenseHint,salaryExpense,protectSalaryExpenses};if(typeof module!=='undefined')module.exports=api;else root.ProrabkaStorage=api;
})(globalThis);
