import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Storage } from './src/storage.mjs';
import { SecurityError, decodeEncryptionKey, detectMediaKind, isSameOrigin, newSessionId, parseCookies, safeJoin, safeName, verifyPassword } from './src/security.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const publicDir=path.join(root,'public');
const dataDir=path.join(root,'data');
const mediaDir=path.join(root,'media');
const stateFile=path.join(dataDir,'state.json');
const databaseFile=path.join(dataDir,'pageops.sqlite');
const port=Number(process.env.PORT||4173);
const host='127.0.0.1';
const graphVersion=process.env.META_GRAPH_VERSION||'v26.0';
const metaAppId=process.env.META_APP_ID||'';
const metaAppSecret=process.env.META_APP_SECRET||'';
const metaRedirectUri=process.env.META_REDIRECT_URI||'http://localhost:'+port+'/auth/meta/callback';
const adminUser=process.env.PAGEOPS_ADMIN_USER||'admin';
const adminPassword=process.env.PAGEOPS_ADMIN_PASSWORD||'';
const encryptionKey=decodeEncryptionKey(process.env.PAGEOPS_ENCRYPTION_KEY||'');
const maxJsonBody=2*1024*1024;
const maxUploadBody=200*1024*1024;
const allowedOrigins=new Set(['http://127.0.0.1:'+port,'http://localhost:'+port]);
const storage=new Storage(databaseFile,encryptionKey);

await fsp.mkdir(dataDir,{recursive:true});
await fsp.mkdir(mediaDir,{recursive:true});
await storage.migrateLegacy(stateFile);
let state=storage.loadState();
let saveQueue=Promise.resolve();
const sessions=new Map();
const oauthStates=new Map();
const loginAttempts=new Map();
const publishing=new Set();

function id(prefix){return prefix+'_'+crypto.randomUUID();}
function pageForPublish(page){return Boolean(page.token&&page.pageId);}
function publicState(){return {...state,pages:state.pages.map(({token,...page})=>({...page,hasToken:Boolean(token)}))};}
function resolveContentPageIds(groupIds=[],pageIds=[]){
  const selected=new Set(pageIds.map(String).filter(x=>state.pages.some(p=>p.id===x)));
  const groups=new Set(groupIds.map(String));
  state.pages.forEach(p=>{if(p.groupId&&groups.has(p.groupId))selected.add(p.id);});
  return [...selected];
}
function assertMediaType(value){if(!['text','image','video'].includes(value))throw new SecurityError('Loại nội dung không hợp lệ.',400);return value;}
function cookiesFor(req){return parseCookies(req.headers.cookie||'');}
function currentSession(req){
  const sid=cookiesFor(req).pageops_session;
  const item=sid?sessions.get(sid):null;
  if(!item)return null;
  if(item.expiresAt<Date.now()){sessions.delete(sid);return null;}
  item.expiresAt=Date.now()+12*60*60*1000;
  return {sid,...item};
}
function setSessionCookie(res,sid){
  res.setHeader('Set-Cookie','pageops_session='+encodeURIComponent(sid)+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200');
}
function clearSessionCookie(res){res.setHeader('Set-Cookie','pageops_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');}
function loginPage(message=''){
  return '<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Đăng nhập · Bách Gia Các</title><style>body{margin:0;background:#080b15;color:#f8fafc;font-family:Arial,sans-serif;display:grid;place-items:center;min-height:100vh}.box{width:min(420px,calc(100% - 40px));padding:32px;border:1px solid #26314b;border-radius:20px;background:#11182a;box-shadow:0 20px 70px #0008}h1{margin:0 0 8px}p{color:#aab7cf}label{display:block;margin:18px 0 6px}input{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #3c4a6b;background:#0a1020;color:#fff}button{margin-top:22px;width:100%;padding:12px;border:0;border-radius:10px;background:#7c5cff;color:#fff;font-weight:700;cursor:pointer}.error{color:#ff8d9b;background:#3a1722;padding:10px;border-radius:8px}</style></head><body><main class="box"><h1>Bách Gia Các</h1><p>Đăng nhập khu quản trị nội bộ</p>'+ (message?'<div class="error">'+escapeHtml(message)+'</div>':'') +'<form method="post" action="/api/auth/login"><label>Tài khoản</label><input name="username" autocomplete="username" required><label>Mật khẩu</label><input name="password" type="password" autocomplete="current-password" required><button>Đăng nhập</button></form></main></body></html>';
}
function escapeHtml(value){return String(value).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function send(res,status,payload,type='application/json'){
  const body=type==='application/json'?JSON.stringify(payload):payload;
  res.writeHead(status,{'Content-Type':type==='application/json'?'application/json; charset=utf-8':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://graph.facebook.com; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"});res.end(body);
}
function redirect(res,location){res.writeHead(303,{Location:location,'Cache-Control':'no-store'});res.end();}
async function readBody(req,limit){
  const length=Number(req.headers['content-length']||0);
  if(length>limit)throw new SecurityError('Dữ liệu gửi lên quá lớn.',413);
  const chunks=[];let total=0;
  for await(const chunk of req){total+=chunk.length;if(total>limit)throw new SecurityError('Dữ liệu gửi lên quá lớn.',413);chunks.push(chunk);}
  return Buffer.concat(chunks);
}
async function jsonBody(req){
  const raw=await readBody(req,maxJsonBody);
  if(!raw.length)return{};
  try{return JSON.parse(raw.toString('utf8'));}catch{throw new SecurityError('Dữ liệu JSON không hợp lệ.',400);}
}
async function formBody(req){return new URLSearchParams((await readBody(req,32*1024)).toString('utf8'));}
async function saveState(){
  saveQueue=saveQueue.then(()=>storage.replaceState(state));
  return saveQueue;
}
function requireSession(req,res){
  const session=currentSession(req);
  if(!session){send(res,401,{error:'Cần đăng nhập'});return null;}
  if(session.role!=='admin'){send(res,403,{error:'Không đủ quyền'});return null;}
  return session;
}
function requireSameOrigin(req,res){
  if(!isSameOrigin(req,allowedOrigins)){send(res,403,{error:'Nguồn yêu cầu không được phép'});return false;}
  return true;
}
function attemptAllowed(ip){
  const now=Date.now(),old=loginAttempts.get(ip);
  if(!old||old.resetAt<now){loginAttempts.set(ip,{count:0,resetAt:now+15*60*1000});return true;}
  return old.count<8;
}
function recordFailedAttempt(ip){const a=loginAttempts.get(ip)||{count:0,resetAt:Date.now()+15*60*1000};a.count+=1;loginAttempts.set(ip,a);}
function clearFailedAttempts(ip){loginAttempts.delete(ip);}
async function fetchJson(url,options={},timeout=20000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const response=await fetch(url,{...options,signal:controller.signal});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||payload.error)throw new Error(payload.error?.message||'Meta API HTTP '+response.status);
    return payload;
  }finally{clearTimeout(timer);}
}
function bearer(token){return {Authorization:'Bearer '+token};}
async function fetchAllPages(firstUrl,token){
  const rows=[];let next=firstUrl;
  while(next){
    const parsed=new URL(next);
    if(parsed.hostname!=='graph.facebook.com')throw new Error('Meta paging URL không hợp lệ');
    const payload=await fetchJson(parsed.toString(),{headers:bearer(token)});
    rows.push(...(payload.data||[]));next=payload.paging?.next||'';
  }
  return rows;
}
function oauthError(res,message){redirect(res,'/?oauth=error&message='+encodeURIComponent(message));}
async function metaAuth(req,res,url){
  const session=currentSession(req);
  if(!session)return oauthError(res,'Hãy đăng nhập trước');
  if(req.method==='GET'&&url.pathname==='/auth/meta'){
    if(!metaAppId||!metaAppSecret)return oauthError(res,'Chưa cấu hình Meta App');
    const value=crypto.randomBytes(24).toString('hex');
    oauthStates.set(value,{expiresAt:Date.now()+10*60*1000,sessionId:session.sid});
    const params=new URLSearchParams({client_id:metaAppId,redirect_uri:metaRedirectUri,state:value,response_type:'code',scope:process.env.META_OAUTH_SCOPES||'pages_show_list,pages_read_engagement,pages_manage_posts'});
    res.writeHead(302,{Location:'https://www.facebook.com/'+graphVersion+'/dialog/oauth?'+params.toString()});return res.end();
  }
  if(req.method==='GET'&&url.pathname==='/auth/meta/callback'){
    const returned=url.searchParams.get('state')||'',record=oauthStates.get(returned);oauthStates.delete(returned);
    if(!record||record.expiresAt<Date.now()||record.sessionId!==session.sid)return oauthError(res,'OAuth state không hợp lệ');
    const code=url.searchParams.get('code');if(!code)return oauthError(res,url.searchParams.get('error_description')||'Meta không trả về mã xác nhận');
    try{
      const tokenPayload=await fetchJson('https://graph.facebook.com/'+graphVersion+'/oauth/access_token',{method:'POST',body:new URLSearchParams({client_id:metaAppId,client_secret:metaAppSecret,redirect_uri:metaRedirectUri,code})});
      const userToken=tokenPayload.access_token;
      const incoming=await fetchAllPages('https://graph.facebook.com/'+graphVersion+'/me/accounts?fields=id,name,access_token,tasks&limit=100',userToken);
      let added=0;
      for(const item of incoming){
        const existing=state.pages.find(p=>p.pageId===String(item.id));
        const page={id:existing?.id||id('page'),name:item.name||'Page '+item.id,pageId:String(item.id),groupId:existing?.groupId||'',token:item.access_token||existing?.token||'',tasks:item.tasks||existing?.tasks||[]};
        if(existing)Object.assign(existing,page);else{state.pages.push(page);added++;}
      }
      await saveState();return redirect(res,'/?oauth=success&count='+incoming.length+'&added='+added);
    }catch(error){return oauthError(res,error.message);}
  }
  return false;
}
async function pageMetaApi(req,res,url){
  const match=url.pathname.match(/^\/api\/page\/([^/]+)\/meta\/([^/]+)$/);
  if(req.method!=='GET'||!match)return false;
  const page=state.pages.find(p=>p.id===decodeURIComponent(match[1])||p.pageId===decodeURIComponent(match[1]));
  if(!page||!page.pageId||!page.token){send(res,404,{error:'Page chưa có token'});return true;}
  const resource=match[2],base='https://graph.facebook.com/'+graphVersion+'/'+page.pageId;
  try{
    let payload;
    if(resource==='profile')payload=await fetchJson(base+'?fields=id,name,about,link,fan_count,followers_count,picture,cover',{headers:bearer(page.token)});
    else if(resource==='posts')payload=await fetchJson(base+'/feed?fields=id,message,created_time,permalink_url,full_picture&limit=25',{headers:bearer(page.token)});
    else if(resource==='insights')payload=await fetchJson(base+'/insights?metric=page_post_engagements,page_daily_follows,page_views_total&period=day',{headers:bearer(page.token)});
    else if(resource==='comments')payload=await fetchJson(base+'/feed?fields=id,message,created_time,comments.limit(25){message,created_time}&limit=25',{headers:bearer(page.token)});
    else if(resource==='conversations')payload=await fetchJson(base+'/conversations?fields=id,updated_time,snippet,participants&limit=25',{headers:bearer(page.token)});
    else{send(res,400,{error:'Tài nguyên Meta chưa hỗ trợ'});return true;}
    send(res,200,{resource,pageId:page.pageId,payload});return true;
  }catch(error){console.error('Meta read error:',error.message);send(res,502,{error:'Không lấy được dữ liệu từ Meta',resource});return true;}
}
async function handleMediaUpload(req,res){
  const raw=await readBody(req,maxUploadBody),type=req.headers['content-type']||'',match=type.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if(!match)throw new SecurityError('Multipart boundary không hợp lệ.',400);
  const boundary=Buffer.from('--'+(match[1]||match[2])),start=raw.indexOf(boundary);
  if(start<0)throw new SecurityError('Upload không hợp lệ.',400);
  const headerEnd=raw.indexOf(Buffer.from('\\r\\n\\r\\n'),start),end=raw.indexOf(boundary,headerEnd+4);
  if(headerEnd<0||end<0)throw new SecurityError('Upload không hợp lệ.',400);
  const headers=raw.subarray(start,headerEnd).toString('utf8'),nameMatch=headers.match(/filename="([^"]*)"/i),fileType=(headers.match(/\\r\\nContent-Type:\\s*([^\\r\\n]+)/i)?.[1]||'').trim().toLowerCase();
  const name=safeName(nameMatch?.[1]||'upload.bin'),file=raw.subarray(headerEnd+4,Math.max(headerEnd+4,end-2)),mediaType=String(req.headers['x-media-type']||'video');
  if(!['image','video'].includes(mediaType))throw new SecurityError('Chỉ cho phép upload hình ảnh hoặc video.',400);
  const detected=detectMediaKind(file);
  if(detected!==mediaType)throw new SecurityError('Nội dung file không khớp với loại đã chọn.',400);
  if(fileType&&mediaType==='image'&&!fileType.startsWith('image/'))throw new SecurityError('File không phải hình ảnh.',400);
  if(fileType&&mediaType==='video'&&!fileType.startsWith('video/'))throw new SecurityError('File không phải video.',400);
  const stored=Date.now()+'-'+crypto.randomUUID()+'-'+name;await fsp.writeFile(safeJoin(mediaDir,stored),file);
  return send(res,201,{name:stored,originalName:name,size:file.length,mediaType});
}
async function publishContent(content){
  if(publishing.has(content.id))return[];
  publishing.add(content.id);
  try{
    const targets=state.pages.filter(p=>(content.pageIds||[]).includes(p.id)),results=[];
    for(const page of targets){
      if(!pageForPublish(page)){results.push({pageId:page.id,pageName:page.name,status:'skipped',message:'Chưa có Page ID hoặc token'});continue;}
      try{
        const endpoint=content.mediaType==='video'?'videos':content.mediaType==='image'?'photos':'feed';
        const form=new FormData();form.append('access_token',page.token);
        if(content.caption)form.append(content.mediaType==='text'?'message':'description',content.caption);
        if(content.mediaName&&content.mediaType!=='text'){
          const filePath=safeJoin(mediaDir,content.mediaName);if(!fs.existsSync(filePath))throw new Error('Không tìm thấy file media');
          form.append('source',new Blob([await fsp.readFile(filePath)]),safeName(content.mediaName));
        }
        const payload=await fetchJson('https://graph.facebook.com/'+graphVersion+'/'+page.pageId+'/'+endpoint,{method:'POST',body:form});
        results.push({pageId:page.id,pageName:page.name,status:'published',message:'Đã đăng thành công',response:payload});
      }catch(error){results.push({pageId:page.id,pageName:page.name,status:'failed',message:error.message});}
    }
    state.logs.unshift({id:id('log'),contentId:content.id,createdAt:new Date().toISOString(),results});
    content.lastRunAt=new Date().toISOString();
    content.status=results.some(r=>r.status==='published')?'published':'failed';
    await saveState();return results;
  }finally{publishing.delete(content.id);}
}
async function api(req,res,url){
  const meta=await pageMetaApi(req,res,url);if(meta)return;
  if(req.method==='GET'&&url.pathname==='/api/state'){send(res,200,publicState());return;}
  if(req.method==='POST'&&url.pathname==='/api/media'){await handleMediaUpload(req,res);return;}
  if(req.method==='POST'&&url.pathname==='/api/groups'){
    const input=await jsonBody(req),name=String(input.name||'Nhóm mới').trim();
    if(!name)throw new SecurityError('Tên nhóm không được trống.',400);
    const group={id:id('group'),name,color:String(input.color||'#7c5cff')};
    if(state.groups.some(g=>g.name.toLowerCase()===name.toLowerCase()))return send(res,409,{error:'Tên nhóm đã tồn tại'});
    state.groups.push(group);await saveState();send(res,201,group);return;
  }
  if(req.method==='POST'&&url.pathname==='/api/pages'){
    const i=await jsonBody(req),page={id:id('page'),name:String(i.name||'Page chưa đặt tên').trim(),pageId:String(i.pageId||'').trim(),groupId:String(i.groupId||''),token:String(i.token||'').trim(),tasks:[]};
    state.pages.push(page);await saveState();send(res,201,{...page,token:page.token?'••••••••':''});return;
  }
  if(req.method==='POST'&&url.pathname==='/api/pages/import'){
    const i=await jsonBody(req),pages=Array.isArray(i.pages)?i.pages:[],added=pages.filter(p=>p&&p.name).map(p=>({id:id('page'),name:String(p.name).trim(),pageId:String(p.pageId||''),groupId:String(p.groupId||''),token:String(p.token||''),tasks:Array.isArray(p.tasks)?p.tasks:[]}));
    state.pages.push(...added);await saveState();send(res,201,{count:added.length});return;
  }
  if(req.method==='DELETE'&&url.pathname.startsWith('/api/pages/')){
    const pageId=url.pathname.split('/').pop();state.pages=state.pages.filter(p=>p.id!==pageId);await saveState();send(res,200,{ok:true});return;
  }
  if(req.method==='PATCH'&&url.pathname.startsWith('/api/pages/')&&url.pathname!=='/api/pages/bulk-group'){
    const page=state.pages.find(p=>p.id===url.pathname.split('/').pop());if(!page)return send(res,404,{error:'Page không tồn tại'});
    const i=await jsonBody(req);if(i.groupId!==undefined)page.groupId=String(i.groupId||'');if(i.name!==undefined)page.name=String(i.name||page.name).trim();if(i.description!==undefined)page.description=String(i.description||'');if(i.settings&&typeof i.settings==='object')page.settings={...(page.settings||{}),...i.settings};
    await saveState();send(res,200,{ok:true,page:{...page,token:page.token?'••••••••':''}});return;
  }
  if(req.method==='PATCH'&&url.pathname==='/api/pages/bulk-group'){
    const i=await jsonBody(req),ids=new Set(Array.isArray(i.pageIds)?i.pageIds.map(String):[]),groupId=String(i.groupId||'');let updated=0;
    state.pages.forEach(p=>{if(ids.has(p.id)){p.groupId=groupId;updated++;}});await saveState();send(res,200,{ok:true,updated});return;
  }
  if(req.method==='DELETE'&&url.pathname.startsWith('/api/groups/')){
    const groupId=url.pathname.split('/').pop();state.groups=state.groups.filter(g=>g.id!==groupId);state.pages.forEach(p=>{if(p.groupId===groupId)p.groupId='';});state.contents.forEach(c=>{c.groupIds=(c.groupIds||[]).filter(x=>x!==groupId);});await saveState();send(res,200,{ok:true});return;
  }
  if(req.method==='POST'&&url.pathname==='/api/content'){
    const i=await jsonBody(req),mediaType=assertMediaType(i.mediaType||'video'),groupIds=Array.isArray(i.groupIds)?i.groupIds.map(String):[],pageIds=resolveContentPageIds(groupIds,Array.isArray(i.pageIds)?i.pageIds:[]);
    if((mediaType==='image'||mediaType==='video')&&!i.mediaName)throw new SecurityError('Nội dung media phải có file.',400);
    const content={id:id('content'),title:String(i.title||'Nội dung chưa đặt tên').trim(),caption:String(i.caption||''),mediaName:String(i.mediaName||''),mediaType,groupIds,pageIds,scheduledAt:String(i.scheduledAt||''),status:i.scheduledAt?'scheduled':'draft',createdAt:new Date().toISOString()};
    state.contents.unshift(content);await saveState();send(res,201,content);return;
  }
  if((req.method==='PATCH'||req.method==='DELETE')&&url.pathname.startsWith('/api/content/')){
    const content=state.contents.find(c=>c.id===url.pathname.split('/').pop());if(!content)return send(res,404,{error:'Nội dung không tồn tại'});
    if(req.method==='DELETE'){const media=content.mediaName;state.contents=state.contents.filter(c=>c.id!==content.id);state.logs=state.logs.filter(l=>l.contentId!==content.id);if(media&&!state.contents.some(c=>c.mediaName===media))await fsp.rm(safeJoin(mediaDir,media),{force:true});await saveState();send(res,200,{ok:true});return;}
    const i=await jsonBody(req);if(i.title!==undefined)content.title=String(i.title).trim();if(i.caption!==undefined)content.caption=String(i.caption);if(Array.isArray(i.groupIds))content.groupIds=i.groupIds.map(String);if(Array.isArray(i.groupIds)||Array.isArray(i.pageIds))content.pageIds=resolveContentPageIds(content.groupIds||[],Array.isArray(i.pageIds)?i.pageIds:content.pageIds||[]);if(i.scheduledAt!==undefined){content.scheduledAt=String(i.scheduledAt||'');content.status=content.scheduledAt?'scheduled':'draft';}await saveState();send(res,200,content);return;
  }
  if(req.method==='POST'&&url.pathname.startsWith('/api/publish/')){
    const content=state.contents.find(c=>c.id===url.pathname.split('/').pop());if(!content)return send(res,404,{error:'Nội dung không tồn tại'});send(res,200,{results:await publishContent(content)});return;
  }
  send(res,404,{error:'Không tìm thấy đường dẫn'});
}
async function login(req,res){
  if(req.method!=='POST'){send(res,405,{error:'Method không được hỗ trợ'});return;}
  if(!requireSameOrigin(req,res))return;
  const ip=req.socket.remoteAddress||'unknown';if(!attemptAllowed(ip)){send(res,429,{error:'Thử đăng nhập quá nhiều. Hãy chờ 15 phút.'});return;}
  const body=await formBody(req),username=body.get('username')||'',password=body.get('password')||'';
  if(!adminPassword||username!==adminUser||!verifyPassword(password,adminPassword)){recordFailedAttempt(ip);send(res,401,loginPage('Tài khoản hoặc mật khẩu không đúng.'),'text/html');return;}
  clearFailedAttempts(ip);const sid=newSessionId();sessions.set(sid,{role:'admin',username:adminUser,expiresAt:Date.now()+12*60*60*1000});setSessionCookie(res,sid);redirect(res,'/');
}
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||'/', 'http://'+host+':'+port);
    if(url.pathname==='/api/auth/login')return await login(req,res);
    if(url.pathname==='/api/auth/logout'){if(req.method==='POST'&&!requireSameOrigin(req,res))return;const session=currentSession(req);if(session)sessions.delete(session.sid);clearSessionCookie(res);return redirect(res,'/');}
    if(url.pathname.startsWith('/auth/meta'))return await metaAuth(req,res,url);
    if(url.pathname==='/'&&!currentSession(req))return send(res,200,loginPage(),'text/html');
    const session=requireSession(req,res);if(!session)return;
    if(url.pathname.startsWith('/api/')){if(req.method!=='GET'&&!requireSameOrigin(req,res))return;return await api(req,res,url);}
    if(url.pathname.startsWith('/media/')){
      const mediaPath=safeJoin(mediaDir,decodeURIComponent(url.pathname.slice('/media/'.length)));
      if(!fs.existsSync(mediaPath))return send(res,404,{error:'Không tìm thấy media'});
      const ext=path.extname(mediaPath).toLowerCase(),types={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.mp4':'video/mp4','.webm':'video/webm'};
      res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'});return fs.createReadStream(mediaPath).pipe(res);
    }
    const requested=url.pathname==='/'?'/index.html':url.pathname;let filePath=safeJoin(publicDir,requested);
    if(!fs.existsSync(filePath)&&!path.extname(url.pathname))filePath=path.join(publicDir,'index.html');
    if(!fs.existsSync(filePath))return send(res,404,{error:'Không tìm thấy file'});
    const ext=path.extname(filePath).toLowerCase(),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml'};
    res.writeHead(200,{'Content-Type':(types[ext]||'application/octet-stream')+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return fs.createReadStream(filePath).pipe(res);
  }catch(error){
    console.error('Request error:',error);
    if(!res.headersSent)send(res,error.status||500,{error:error.status?error.message:'Máy chủ gặp lỗi'});
  }
});
server.listen(port,host,()=>console.log('Bách Gia Các local: http://'+host+':'+port));
const scheduler=setInterval(async()=>{const now=Date.now();for(const c of state.contents){if(c.status==='scheduled'&&c.scheduledAt&&Date.parse(c.scheduledAt)<=now){try{await publishContent(c);}catch(error){console.error('Scheduler error:',error.message);}}}},30000);
scheduler.unref();
process.on('SIGINT',()=>{storage.close();process.exit(0);});
process.on('SIGTERM',()=>{storage.close();process.exit(0);});
