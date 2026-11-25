// Isolate the old scanner in a killable process; never run its unbounded regex in CI's main thread.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const storage=require('../storage.js');
const baseline='02a11c4c674a399d8309361ea913b76a460db4c9';
const old=execFileSync('git',['show',baseline+':storage.js'],{encoding:'utf8',cwd:path.join(__dirname,'..')});
const scanner=old.slice(old.indexOf('function assertJsonNumberSafety'),old.indexOf('function parseJsonSafely'));
if(process.argv[2]==='--baseline'){
 const {raw}=JSON.parse(fs.readFileSync(0,'utf8'));const ctx=vm.createContext({});vm.runInContext(scanner,ctx);
 const start=performance.now();try{ctx.assertJsonNumberSafety(raw)}catch{}
 process.stdout.write(JSON.stringify({ms:performance.now()-start}));
}else{
 const measurements=[];
 for(const size of [80000,200000,1048576])for(const kind of ['escaped-valid','escaped-broken','long-number','large-exponent','zero-run']){
  const escape=String.fromCharCode(92,34).repeat(Math.ceil(size/2));
  const raw=kind==='escaped-valid'?'{"notes":"'+escape+'"}':kind==='escaped-broken'?'{"notes":"'+escape: '{"n":'+(kind==='long-number'?'1'.repeat(size):kind==='zero-run'?'1.'+'0'.repeat(size)+'1':'1e'+'9'.repeat(size))+'}';
  let before;
  try{before=JSON.parse(execFileSync(process.execPath,[__filename,'--baseline'],{input:JSON.stringify({raw}),encoding:'utf8',timeout:5000}));}
  catch(error){if(error.code!=='ETIMEDOUT')throw error;before={timeoutMs:5000};}
  const start=performance.now();let errorCode=null;
  try{storage.parseJsonSafely(raw)}catch(error){errorCode=error.code||error.name;}
  const afterMs=performance.now()-start;
  assert.ok(afterMs<5000,'new checker completes under 5 seconds');
  assert.equal(errorCode,kind==='escaped-valid'?null:kind==='escaped-broken'?'SyntaxError':'JSON_NUMBER_PRECISION');
  measurements.push({kind,bytes:Buffer.byteLength(raw),before,afterMs,errorCode});
 }
 const output=process.env.BROWSER_OUTPUT||path.join(__dirname,'..','.browser-results');fs.mkdirSync(output,{recursive:true});
 const result={baseline,node:process.version,platform:os.platform(),release:os.release(),cpu:os.cpus()[0].model,oldProcessTimeoutMs:5000,measurements};
 fs.writeFileSync(path.join(output,'json-node-stress.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
}
