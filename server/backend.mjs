import { legacy, seed } from './seed.mjs';

const enc = new TextEncoder();
const COOKIE = '__Host-gapology_session';
const MAX_BYTES = 750000;
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const text = (value, max = 30000) => String(value ?? '').replace(/\s*\u2014\s*/g, '; ').slice(0, max);
function url(value) {
 if (!value) return '';
 try { const u = new URL(String(value).trim()); if (!['http:','https:'].includes(u.protocol) || u.username || u.password) return ''; return u.href; } catch { return ''; }
}
function identifier(value) {
 if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(value)) throw new HttpError(400, 'Catalog IDs must be unique letters, digits, hyphens, or underscores.');
 return value;
}
function step(value) {
 const v = value && typeof value === 'object' ? value : {instructions: value};
 return {title:text(v.title,240), instructions:text(v.instructions), imageUrl:url(v.imageUrl), videoUrl:url(v.videoUrl)};
}
function legacySteps(item, overrides) {
 const result = [];
 function lines(values, prefix, id) {
  values = Array.isArray(values) ? values : [];
  const count = overrides[`${prefix}:${id}:_count`];
  const size = Math.min(500, count === undefined ? values.length : Math.max(0,parseInt(count,10)||0));
  return Array.from({length:size},(_,n)=>text(overrides[`${prefix}:${id}:${n}`] ?? values[n] ?? '')).map((v,n)=>`${n+1}. ${v}`).join('\n');
 }
 for (const id of (item.bases || item.BASES || [])) {
  const base = legacy.bases[id]; if (base) result.push(step({title:base.title,instructions:lines(base.steps,'base',id)}));
 }
 const extra = [item.extraSteps,item.steps,item.EXTRASTEPS,item.STEPS].find(a=>Array.isArray(a)&&a.length) || [];
 const assembly = lines(extra,'extra',item.id); if (assembly) result.push(step({title:'Assembly',instructions:assembly}));
 const plating = overrides[`plating:${item.id}`] ?? item.plating; if (plating) result.push(step({title:'Serving',instructions:plating}));
 return result;
}
export function normalizeState(input) {
 if (!input || !Array.isArray(input.catalog) || input.catalog.length > 100) throw new HttpError(400, 'Provide a catalog array with at most 100 categories.');
 const texts = input.customTexts && typeof input.customTexts === 'object' ? input.customTexts : {};
 const videos = input.videoLinks && typeof input.videoLinks === 'object' ? input.videoLinks : {};
 const catIds=new Set(), subIds=new Set(), itemIds=new Set(); let total=0;
 const catalog = input.catalog.map(cat=>{
  const id=identifier(cat?.id); if(catIds.has(id)) throw new HttpError(400,'Duplicate category ID.');catIds.add(id);
  if(!Array.isArray(cat.sublists) || cat.sublists.length>300) throw new HttpError(400,'Each category needs a sublists array.');
  return {id,name:text(cat.name,240),icon:text(cat.icon||'📋',24),sublists:cat.sublists.map(sub=>{
   const sid=identifier(sub?.id);if(subIds.has(sid))throw new HttpError(400,'Duplicate sublist ID.');subIds.add(sid);
   if(!Array.isArray(sub.items))throw new HttpError(400,'Each sublist needs an items array.');
   return {id:sid,name:text(sub.name,240),items:sub.items.map(item=>{
    const iid=identifier(item?.id);if(itemIds.has(iid))throw new HttpError(400,'Duplicate item ID.');itemIds.add(iid);
    if(++total>2000)throw new HttpError(400,'The catalog supports up to 2,000 items.');
    const steps=Array.isArray(item.sopSteps)?item.sopSteps.map(step):legacySteps(item,texts);
    if(steps.length>120)throw new HttpError(400,'An item supports up to 120 steps.');
    const video=Object.hasOwn(item,'videoUrl')?item.videoUrl:Object.hasOwn(videos,iid)?videos[iid]:legacy.videoLinks[iid];
    return {id:iid,name:text(item.name,240),summary:text(texts[`summary:${iid}`]??item.summary,4000),staffVisible:item.staffVisible===true,
     staffVideoVisible:item.staffVisible===true && item.staffVideoVisible!==false,imageUrl:url(item.imageUrl),videoUrl:url(video),sopSteps:steps};
   })};
  })};
 });
 const raw=input.mediaLibrary||{nextIndex:1,assets:[]};if(!Array.isArray(raw.assets)||raw.assets.length>2000)throw new HttpError(400,'Invalid media library.');
 const ids=new Set();const assets=raw.assets.map(a=>{
  const id=identifier(a?.id);if(ids.has(id))throw new HttpError(400,'Duplicate media ID.');ids.add(id);
  if(!['image','video'].includes(a.type)||!url(a.url))throw new HttpError(400,'Library entries need a web link and an image/video type.');
  return {id,name:text(a.name,240),type:a.type,url:url(a.url)};
 });
 const result={catalog,mediaLibrary:{nextIndex:Math.max(1,parseInt(raw.nextIndex,10)||1),assets},customTexts:{}};
 if(enc.encode(JSON.stringify(result)).length>MAX_BYTES)throw new HttpError(413,'Catalog is too large. Export a backup and reduce its size.');
 return result;
}
export function staffView(state) {
 return {catalog:state.catalog.map(cat=>({...cat,sublists:cat.sublists.map(sub=>({...sub,items:sub.items.filter(i=>i.staffVisible===true).map(item=>{
  const copy=structuredClone(item);if(!copy.staffVideoVisible){copy.videoUrl='';copy.sopSteps=copy.sopSteps.map(s=>({...s,videoUrl:''}));}return copy;
 })})).filter(sub=>sub.items.length)})).filter(cat=>cat.sublists.length),mediaLibrary:{nextIndex:1,assets:[]},customTexts:{}};
}
function summary(before, after) {
 const result=[];
 function flatten(state){const m=new Map();for(const c of state.catalog){m.set('Category:'+c.id,{name:c.name,order:state.catalog.indexOf(c)});for(const s of c.sublists){m.set('Sublist:'+s.id,{name:s.name,parent:c.id,order:c.sublists.indexOf(s)});for(const i of s.items)m.set('Item:'+i.id,{...i,parent:s.id,order:s.items.indexOf(i)});}}for(const a of state.mediaLibrary.assets)m.set('Media:'+a.id,a);return m;}
 const a=flatten(before),b=flatten(after);
 for(const [id,value] of b){if(!a.has(id))result.push('Added '+id+' '+value.name);else{const prev=a.get(id);const fields=Object.keys(value).filter(k=>JSON.stringify(prev[k])!==JSON.stringify(value[k]));if(fields.length)result.push('Updated '+id+' '+value.name+' ('+fields.join(', ')+')');}}
 for(const [id,value]of a)if(!b.has(id))result.push('Removed '+id+' '+value.name);
 return result.slice(0,100);
}
function json(data,status=200,extra={}) {
 return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie',...extra}});
}
function base64(bytes){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function unbase64(str){const raw=atob(str.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
async function sign(value,secret){const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return base64(new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(value))));}
async function equal(a,b){const x=new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(a))),y=new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(b)));let different=0;for(let i=0;i<x.length;i++)different|=x[i]^y[i];return different===0;}
async function session(request,env){
 try{const match=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));if(!match||!env.SESSION_SECRET)return null;
 const token=match.slice(COOKIE.length+1),[payload,sig]=token.split('.');if(!sig||!await equal(sig,await sign(payload,env.SESSION_SECRET)))return null;
 const data=JSON.parse(new TextDecoder().decode(unbase64(payload)));return data.role==='manager'&&data.exp>Date.now()?data:null;}catch{return null;}
}
function checkOrigin(request){if(request.headers.get('Origin')!==new URL(request.url).origin)throw new HttpError(403,'This request must come from the same website.');}
async function body(request){
 if(!request.headers.get('Content-Type')?.includes('application/json'))throw new HttpError(415,'Send application/json.');
 const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'Missing request body.');const chunks=[];let length=0;
 while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_BYTES+10000){await reader.cancel();throw new HttpError(413,'Request is too large.');}chunks.push(value);}
 const all=new Uint8Array(length);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder().decode(all));}catch{throw new HttpError(400,'Invalid JSON.');}
}
async function stateRow(env){const row=await env.DB.prepare("SELECT * FROM app_state WHERE id='main'").first();if(!row)throw new HttpError(503,'Run the database migration first.');return row;}
function packet(row,manager){const data=JSON.parse(row.data);return {revision:row.revision,updatedAt:row.updated_at,role:manager?"manager":"staff",data:manager?data:staffView(data)};}
function requireManager(identity){if(!identity)throw new HttpError(401,'Sign in as manager to continue.');}
export async function handleRequest(request,env){
 try{
  const path=new URL(request.url).pathname.replace(/\/$/,'');const method=request.method;
  if(!env.DB)throw new HttpError(503,'D1 is not connected. Add the DB binding and run the migration.');
  if(!['GET','POST','PUT'].includes(method))return json({error:'Method not allowed.'},405,{'Allow':'GET, POST, PUT'});
  if(method!=='GET')checkOrigin(request);
  const configured=typeof env.ADMIN_PASSWORD==='string'&&env.ADMIN_PASSWORD.length>=12&&typeof env.SESSION_SECRET==='string'&&env.SESSION_SECRET.length>=32;
  const identity=configured?await session(request,env):null;
  if(path==='/api/session'&&method==='GET')return json({manager:!!identity,configured});
  if(path==='/api/logout'&&method==='POST')return json({ok:true},200,{'Set-Cookie':`${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`});
  if(path==='/api/login'&&method==='POST'){
   if(!configured)throw new HttpError(503,'Set ADMIN_PASSWORD (12+ characters) and SESSION_SECRET (32+ characters) in Cloudflare secrets.');
   const data=await body(request);if(typeof data.password!=='string'||data.password.length>256)throw new HttpError(400,'Enter a valid manager password.');
   const now=Date.now(),window=Math.floor(now/900000);const bucket=await sign((request.headers.get('CF-Connecting-IP')||'unknown')+':'+window,env.SESSION_SECRET);
   const attempt=await env.DB.prepare('INSERT INTO login_attempts(bucket,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(bucket,now+900000).first();
   if(attempt.attempts>10) return json({error:'Too many login attempts. Try again in 15 minutes.'},429,{'Retry-After':'900'});
   if(!await equal(data.password,env.ADMIN_PASSWORD))throw new HttpError(401,'Incorrect manager password.');
   await env.DB.prepare('DELETE FROM login_attempts WHERE expires_at < ?').bind(now).run();
   const payload=base64(enc.encode(JSON.stringify({role:'manager',actor:text(env.ADMIN_NAME||'Manager',100),exp:now+8*3600000})));
   return json({ok:true},200,{'Set-Cookie':`${COOKIE}=${payload}.${await sign(payload,env.SESSION_SECRET)}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800`});
  }
  if(path==='/api/state'&&method==='GET'){
   const row=await stateRow(env),manager=!!identity&&new URL(request.url).searchParams.get('view')!=='staff';
   const etag=`"${manager?'manager':'staff'}-${row.revision}"`;
   if(request.headers.get('If-None-Match')===etag)return new Response(null,{status:304,headers:{ETag:etag,'Cache-Control':'private, no-store','Vary':'Cookie'}});
   return json(packet(row,manager),200,{ETag:etag});
  }
  if(path==='/api/migration-data'&&method==='GET'){requireManager(identity);return json({legacy,seed});}
  if(path==='/api/state'&&method==='PUT'){
   requireManager(identity);const input=await body(request);
   if(!Number.isInteger(input.revision)||input.revision<0||typeof input.operationId!=='string'||!/^[a-f0-9-]{36}$/.test(input.operationId))throw new HttpError(400,'Provide a revision and unique operation ID.');
   const data=normalizeState(input.data),serialized=JSON.stringify(data);
   const previous=await env.DB.prepare('SELECT revision, after_json FROM edit_history WHERE operation_id=?').bind(input.operationId).first();
   if(previous){if(previous.after_json!==serialized)throw new HttpError(409,'This operation ID was already used for different content.');return json({revision:previous.revision,replayed:true});}
   const row=await stateRow(env);if(row.revision!==input.revision)return json({error:'Another administrator saved newer changes. Download your draft and load the latest version before editing again.',revision:row.revision},409);
   const before=JSON.parse(row.data),changes=summary(before,data),when=new Date().toISOString();
   if(!changes.length)return json({revision:row.revision,updatedAt:row.updated_at});
   const result=await env.DB.batch([
    env.DB.prepare("UPDATE app_state SET revision=revision+1, data=?, updated_at=?, last_operation=? WHERE id='main' AND revision=?").bind(serialized,when,input.operationId,input.revision),
    env.DB.prepare("INSERT INTO edit_history(revision,operation_id,actor,action,created_at,summary,before_json,after_json) SELECT revision,?, ?, ?, ?, ?, ?, ? FROM app_state WHERE id='main' AND last_operation=?").bind(input.operationId,identity.actor,text(input.action||'Updated catalog',100),when,JSON.stringify(changes),row.data,serialized,input.operationId)
   ]);
   if(!result[0].meta.changes)return json({error:'A newer change was saved. Load the latest version first.'},409);
   return json({revision:row.revision+1,updatedAt:when});
  }
  if(path==='/api/history'&&method==='GET'){
   requireManager(identity);const before=Math.max(1,parseInt(new URL(request.url).searchParams.get('before'),10)||Number.MAX_SAFE_INTEGER);
   const result=await env.DB.prepare('SELECT revision,actor,action,created_at,summary FROM edit_history WHERE revision < ? ORDER BY revision DESC LIMIT 50').bind(before).all();
   return json({entries:result.results.map(row=>({...row,summary:JSON.parse(row.summary)}))});
  }
  const match=path.match(/^\/api\/history\/([0-9]+)$/);
  if(match&&method==='GET'){requireManager(identity);const row=await env.DB.prepare('SELECT revision,actor,action,created_at,summary,before_json,after_json FROM edit_history WHERE revision=?').bind(Number(match[1])).first();if(!row)throw new HttpError(404,'Revision not found.');return json({...row,summary:JSON.parse(row.summary),before:JSON.parse(row.before_json),after:JSON.parse(row.after_json),before_json:undefined,after_json:undefined});}
  return json({error:'API route not found.'},404);
 }catch(error){if(error instanceof HttpError)return json({error:error.message},error.status);console.error('Gapology API error',error?.message);return json({error:'Server storage error. Check the D1 binding and migrations; your browser draft has not been confirmed saved.'},500);}
}
