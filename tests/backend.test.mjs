import assert from 'node:assert/strict';
import { test } from 'node:test';
import { D1 } from './d1-helper.mjs';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { handleRequest, normalizeState } from '../server/backend.mjs';
import { seed } from '../server/seed.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
export async function runBackendChecks(){
 const DB=new D1();DB.db.exec(await readFile(new URL('../migrations/0001_shared_state.sql',import.meta.url),'utf8'));
 const env={DB,ADMIN_PASSWORD:'Example-only-password!123',SESSION_SECRET:'a-test-secret-with-at-least-thirty-two-characters',ADMIN_NAME:'Test manager'};
 const origin='https://gapology-test.pages.dev';let cookie='';let requests=0;
 async function request(path,method='GET',data,opts={}){
  requests++;const headers={'CF-Connecting-IP':opts.ip||'192.0.2.20',...(method==='GET'?{}:{Origin:origin,'Content-Type':'application/json'}),...(opts.manager?{Cookie:cookie}:{}),...(opts.headers||{})};
  const response=await handleRequest(new Request(origin+'/api/'+path,{method,headers,...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
  return {response,status:response.status,json:response.status===304?null:await response.json()};
 }
 let result=await request('session');assert.equal(result.json.configured,true);assert.equal(result.json.manager,false);
 assert.equal((await request('migration-data')).status,401);assert.equal((await request('history')).status,401);
 assert.equal((await request('state','PUT',{revision:0,operationId:crypto.randomUUID(),data:{catalog:[]}})).status,401);
 assert.equal((await request('login','POST',{password:'wrong'})).status,401);
 assert.equal((await request('login','POST',{password:env.ADMIN_PASSWORD},{headers:{Origin:'https://evil.example'}})).status,403);
 result=await request('login','POST',{password:env.ADMIN_PASSWORD});assert.equal(result.status,200);
 const setCookie=result.response.headers.get('Set-Cookie');assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/Secure/);assert.match(setCookie,/SameSite=Strict/);cookie=setCookie.split(';')[0];
 assert.equal((await request('session','GET',undefined,{manager:true})).json.manager,true);
 const invalid=cookie.slice(0,-1)+(cookie.endsWith('a')?'b':'a');assert.equal((await request('migration-data','GET',undefined,{headers:{Cookie:invalid}})).status,401);
 assert.equal((await request('migration-data','GET',undefined,{manager:true})).status,200);
 const data=normalizeState(seed),items=data.catalog.flatMap(c=>c.sublists.flatMap(s=>s.items));assert.equal(items.length,95);assert.equal(data.catalog.length,3);assert(items.some(i=>i.sopSteps.length));
 items[0].staffVisible=true;items[0].staffVideoVisible=true;items[0].sopSteps[0].imageUrl='https://example.com/public-step.jpg';items[0].sopSteps[0].videoUrl='https://example.com/public-step.mp4';
 items[1].imageUrl='https://example.com/HIDDEN-ADMIN-IMAGE.jpg';items[1].name='HIDDEN ADMIN ITEM';
 items[2].staffVisible=true;items[2].staffVideoVisible=false;items[2].videoUrl='https://example.com/RESTRICTED.mp4';items[2].sopSteps=[{title:'Video denied',instructions:'Visible instruction',imageUrl:'',videoUrl:'https://example.com/RESTRICTED-STEP.mp4'}];
 data.mediaLibrary.assets=[{id:'M0001',type:'image',name:'Private library',url:'https://example.com/PRIVATE-LIBRARY.jpg'}];
 const operation=crypto.randomUUID();result=await request('state','PUT',{revision:0,operationId:operation,actor:'Spoofed admin',data},{manager:true});assert.equal(result.status,200);assert.equal(result.json.revision,1);
 let staff=await request('state');assert.equal(staff.status,200);assert.equal(staff.json.data.catalog.flatMap(c=>c.sublists.flatMap(s=>s.items)).length,2);
 const staffJSON=JSON.stringify(staff.json);assert(!staffJSON.includes('HIDDEN-ADMIN'));assert(!staffJSON.includes('HIDDEN ADMIN ITEM'));assert(!staffJSON.includes('PRIVATE-LIBRARY'));assert(!staffJSON.includes('RESTRICTED'));assert.equal(staff.json.data.mediaLibrary.assets.length,0);
 const staffETag=staff.response.headers.get('ETag');assert.equal((await request('state','GET',undefined,{headers:{'If-None-Match':staffETag}})).status,304);
 assert.equal((await request('state','GET',undefined,{manager:true})).json.data.mediaLibrary.assets.length,1);
 assert.equal((await request('state?view=staff','GET',undefined,{manager:true})).json.data.mediaLibrary.assets.length,0);
 let history=await request('history','GET',undefined,{manager:true});assert.equal(history.json.entries.length,1);assert.equal(history.json.entries[0].actor,'Test manager');
 assert.equal((await request('history/1')).status,401);assert.equal((await request('history/1','GET',undefined,{manager:true})).json.after.catalog.length,3);
 // Retrying a committed operation is idempotent, without adding a history revision.
 assert.equal((await request('state','PUT',{revision:0,operationId:operation,data},{manager:true})).json.replayed,true);
 assert.equal((await request('history','GET',undefined,{manager:true})).json.entries.length,1);
 // Stale edits cannot overwrite current content.
 items[0].name='Stale draft';assert.equal((await request('state','PUT',{revision:0,operationId:crypto.randomUUID(),data},{manager:true})).status,409);
 assert.notEqual((await request('state','GET',undefined,{manager:true})).json.data.catalog[0].sublists[0].items[0].name,'Stale draft');
 result=await request('state','PUT',{revision:1,operationId:crypto.randomUUID(),data},{manager:true});assert.equal(result.json.revision,2);
 assert.equal((await request('history','GET',undefined,{manager:true})).json.entries.length,2);
 // Invalid media schemes and price fields are discarded on migration.
 const unsafe=structuredClone(seed);unsafe.catalog[0].sublists[0].items[0].imageUrl='javascript:alert(1)';unsafe.catalog[0].sublists[0].items[0].price=9;
 const clean=normalizeState(unsafe);assert.equal(clean.catalog[0].sublists[0].items[0].imageUrl,'');assert(!JSON.stringify(clean).includes('"price":'));
 const duplicate=structuredClone(data);duplicate.catalog[0].sublists[0].items[1].id=duplicate.catalog[0].sublists[0].items[0].id;
 assert.equal((await request('state','PUT',{revision:2,operationId:crypto.randomUUID(),data:duplicate},{manager:true})).status,400);
 assert.throws(()=>DB.db.prepare('DELETE FROM edit_history WHERE revision=1').run(),/append-only/);
 // The state and history entry roll back together if inserting history fails.
 DB.db.exec("CREATE TRIGGER fail_third_history BEFORE INSERT ON edit_history WHEN NEW.revision=3 BEGIN SELECT RAISE(ABORT,'forced test failure'); END;");
 const failedData=structuredClone(data);failedData.catalog[0].name='Should roll back';
 assert.equal((await request('state','PUT',{revision:2,operationId:crypto.randomUUID(),data:failedData},{manager:true})).status,500);
 assert.equal((await request('state','GET',undefined,{manager:true})).json.revision,2);assert.equal((await request('history','GET',undefined,{manager:true})).json.entries.length,2);
 DB.db.exec('DROP TRIGGER fail_third_history;');
 const raceA=structuredClone(data),raceB=structuredClone(data);raceA.catalog[0].name='Race A';raceB.catalog[0].name='Race B';
 const raced=await Promise.all([request('state','PUT',{revision:2,operationId:crypto.randomUUID(),data:raceA},{manager:true}),request('state','PUT',{revision:2,operationId:crypto.randomUUID(),data:raceB},{manager:true})]);
 assert.deepEqual(raced.map(r=>r.status).sort(),[200,409]);assert.equal((await request('history','GET',undefined,{manager:true})).json.entries.length,3);
 // Login abuse is limited by the server, not the frontend.
 for(let i=0;i<10;i++)assert.equal((await request('login','POST',{password:'wrong'},{ip:'192.0.2.99'})).status,401);
 assert.equal((await request('login','POST',{password:env.ADMIN_PASSWORD},{ip:'192.0.2.99'})).status,429);
 assert.equal((await request('logout','POST',undefined,{manager:true})).status,200);
 assert.match((await request('logout','POST')).response.headers.get('Set-Cookie'),/Max-Age=0/);
 const unsupported=await handleRequest(new Request(origin+'/api/state',{method:'DELETE',headers:{Origin:origin,Cookie:cookie}}),env);assert.equal(unsupported.status,405);
 DB.db.close();return {requests,items:items.length,checks:'authentication, CSRF, rate limits, staff filtering, atomic history, conflicts, migration, idempotency, and append-only history'};
}
export const backendResult=await runBackendChecks();
await test('Shared D1 API security, persistence, and history',()=>assert.equal(backendResult.items,95));
