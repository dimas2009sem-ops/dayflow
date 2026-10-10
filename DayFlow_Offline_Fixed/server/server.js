const fs=require('fs');
const path=require('path');
const express=require('express');
const cors=require('cors');
const webpush=require('web-push');

const PORT=process.env.PORT||3000;
const PUBLIC_KEY=process.env.VAPID_PUBLIC_KEY||'';
const PRIVATE_KEY=process.env.VAPID_PRIVATE_KEY||'';
const SUBJECT=process.env.VAPID_SUBJECT||'mailto:you@example.com';
const DATA_DIR=path.join(__dirname,'data');
const DATA_FILE=path.join(DATA_DIR,'push-data.json');
fs.mkdirSync(DATA_DIR,{recursive:true});
let db={devices:{}};
try{db=JSON.parse(fs.readFileSync(DATA_FILE,'utf8'))}catch(e){}
if(!db.devices)db.devices={};
function persist(){fs.writeFileSync(DATA_FILE,JSON.stringify(db,null,2))}
if(!PUBLIC_KEY||!PRIVATE_KEY)console.warn('Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY. Generate them and put them in .env.');
else webpush.setVapidDetails(SUBJECT,PUBLIC_KEY,PRIVATE_KEY);

const app=express();
app.use(cors());
app.use(express.json({limit:'256kb'}));
app.use(express.static(path.join(__dirname,'public')));

app.get('/api/health',(req,res)=>res.json({ok:true,service:'dayflow-push'}));
app.get('/api/config',(req,res)=>res.json({publicKey:PUBLIC_KEY}));

app.post('/api/subscribe',(req,res)=>{
  const {deviceId,subscription,language='uk',timeZone='UTC'}=req.body||{};
  if(!deviceId||!subscription?.endpoint)return res.status(400).json({error:'invalid subscription'});
  db.devices[deviceId]={...(db.devices[deviceId]||{}),deviceId,subscription,language,timeZone,tasks:db.devices[deviceId]?.tasks||[],sent:db.devices[deviceId]?.sent||{}};
  persist();
  res.json({ok:true});
});

app.post('/api/sync',(req,res)=>{
  const {deviceId,subscription,language='uk',timeZone='UTC',tasks=[]}=req.body||{};
  if(!deviceId||!subscription?.endpoint)return res.status(400).json({error:'invalid device'});
  db.devices[deviceId]={...(db.devices[deviceId]||{}),deviceId,subscription,language,timeZone,tasks:Array.isArray(tasks)?tasks:[],sent:db.devices[deviceId]?.sent||{}};
  // Keep only recent sent markers to prevent unbounded growth.
  const cutoff=Date.now()-7*24*60*60*1000;
  for(const [k,v] of Object.entries(db.devices[deviceId].sent)){if(v<cutoff)delete db.devices[deviceId].sent[k]}
  persist();
  res.json({ok:true,count:db.devices[deviceId].tasks.length});
});

app.post('/api/unsubscribe',(req,res)=>{
  const {deviceId,endpoint}=req.body||{};
  if(deviceId&&db.devices[deviceId]){
    if(!endpoint||db.devices[deviceId].subscription?.endpoint===endpoint)delete db.devices[deviceId];
    persist();
  }
  res.json({ok:true});
});

function localParts(timeZone){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date());
  const o={};for(const p of parts)if(p.type!=='literal')o[p.type]=p.value;
  if(o.hour==='24')o.hour='00';
  return {date:`${o.year}-${o.month}-${o.day}`,time:`${o.hour}:${o.minute}`};
}
function textFor(device,task){
  const lang=device.language||'uk';
  if(lang==='ru')return {title:'Время задания',body:`${task.title}${task.note?' — '+task.note:''}`};
  if(lang==='en')return {title:'Task reminder',body:`${task.title}${task.note?' — '+task.note:''}`};
  return {title:'Час виконати завдання',body:`${task.title}${task.note?' — '+task.note:''}`};
}
async function tick(){
  if(!PUBLIC_KEY||!PRIVATE_KEY)return;
  let changed=false;
  for(const [deviceId,device] of Object.entries(db.devices)){
    const now=localParts(device.timeZone||'UTC');
    for(const task of device.tasks||[]){
      if(!task?.id||!task.date||!task.time||!task.title)continue;
      if(task.date!==now.date||task.time!==now.time)continue;
      const key=`${task.date}_${task.time}_${task.id}`;
      if(device.sent?.[key])continue;
      try{
        const copy=textFor(device,task);
        await webpush.sendNotification(device.subscription,JSON.stringify({title:copy.title,body:copy.body,tag:`dayflow-${task.id}`,url:'/'}));
        device.sent[key]=Date.now();changed=true;
      }catch(err){
        const code=err?.statusCode;
        if(code===404||code===410){delete db.devices[deviceId];changed=true;}
      }
    }
  }
  if(changed)persist();
}
setInterval(tick,15000);

app.use((req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`DayFlow push server running on port ${PORT}`));
