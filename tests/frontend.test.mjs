import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { Blob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { D1 } from './d1-helper.mjs';
import { createTestDOM } from './dom-helper.mjs';
import { handleRequest } from '../server/backend.mjs';

export async function runFrontendChecks(){
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8'),adapter=await readFile(new URL('../public/cloud.js',import.meta.url),'utf8');
 const code=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
 assert(!html.includes('asd123qwe'));assert(!html.includes('Once cooked, fluff gently'));assert(!html.includes('type="file"'));assert(!html.includes('editItemPrice'));assert(!html.includes('\u2014'));
 new vm.Script(code);new vm.Script(adapter);
 const DB=new D1();DB.db.exec(await readFile(new URL('../migrations/0001_shared_state.sql',import.meta.url),'utf8'));
 const env={DB,ADMIN_PASSWORD:'Example-test-password-123!',SESSION_SECRET:'a-test-session-secret-of-more-than-32-characters'};
 const origin='https://test.pages.dev', dom=createTestDOM(html), cache=new Map(),alerts=[];let cookie='',afterNextWrite=null,throwAfterNextCommit=false,failNextRead=false;
 const timers=new Map();let sequence=0;
 const ctx={Date,JSON,Math,Object,Array,String,Number,Promise,URL,Blob,TextEncoder,TextDecoder,crypto:webcrypto,console,
  document:dom.document,location:{pathname:'/'},navigator:{onLine:true},
  setTimeout(f){const n=++sequence;timers.set(n,f);return n},clearTimeout(n){timers.delete(n)},setInterval(){return 1},clearInterval(){},addEventListener(){},
  sessionStorage:{getItem(k){return cache.get(k)||null},setItem(k,v){cache.set(k,v)},removeItem(k){cache.delete(k)}},
  confirm(){return true},alert(m){alerts.push(m)},scrollTo(){},
  async fetch(path,options={}){
   if(failNextRead && path.startsWith('/api/state') && !options.method){failNextRead=false;throw new Error('Simulated failed refresh');}
   const method=options.method||'GET',headers={...(options.headers||{}),...(cookie?{Cookie:cookie}:{}),...(method==='GET'?{}:{Origin:origin}),'CF-Connecting-IP':'192.0.2.25'};
   const request=new Request(origin+path,{method,headers,...(options.body?{body:options.body}:{})});
   if(method==='PUT'&&afterNextWrite){const hook=afterNextWrite;afterNextWrite=null;hook();}
   const response=await handleRequest(request,env);const set=response.headers.get('Set-Cookie');if(set)cookie=set.includes('Max-Age=0')?'':set.split(';')[0];
   if(method==='PUT'&&throwAfterNextCommit){throwAfterNextCommit=false;throw new Error('Simulated connection lost after database commit');}
   return response;
  }
 };
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(code,ctx);vm.runInContext(adapter,ctx);
 const el=id=>dom.ids.get(id);
 el('loginRole').value='manager';el('pwInput').value=env.ADMIN_PASSWORD;await ctx.handleLoginSubmit();
 assert.equal(ctx.accessRole,'manager');assert.equal(ctx.CATALOG.length,0);
 ctx.cloudLoadStarter();assert.equal(ctx.ALL_ITEMS.length,95);assert.equal(ctx.cloudDirty,true);await ctx.cloudFlush();
 assert.equal(ctx.cloudDirty,false);assert.equal(ctx.cloudRevision,1);assert.match(el('cloudStatus').textContent,/Saved online/);
 const first=ctx.ALL_ITEMS[0].id;
 ctx.adminToggleStaffVisibility(first);await ctx.cloudFlush();assert.equal(ctx.cloudRevision,2);
 assert.equal(ctx.ITEM_INDEX[first].staffVisible,true);
 // An edit that occurs while a save is in flight must be sent in a subsequent revision.
 ctx.ITEM_INDEX[first].name='First in-flight value';ctx.saveCatalog();
 afterNextWrite=()=>{ctx.ITEM_INDEX[first].name='Latest in-flight value';ctx.saveCatalog();};await ctx.cloudFlush();
 assert.equal(ctx.cloudRevision,4);assert.equal(ctx.cloudDirty,false);
 let remote=await (await handleRequest(new Request(origin+'/api/state',{headers:{Cookie:cookie}}),env)).json();
 assert.equal(remote.data.catalog[0].sublists[0].items[0].name,'Latest in-flight value');
 // The server can commit even if a response is lost. Retrying must not create a duplicate revision.
 ctx.ITEM_INDEX[first].summary='Retry exactly once';ctx.saveCatalog();throwAfterNextCommit=true;await ctx.cloudFlush();
 assert.equal(ctx.cloudDirty,true);assert.match(el('cloudStatus').textContent,/draft/);const oldRevision=ctx.cloudRevision;await ctx.cloudFlush();assert.equal(ctx.cloudRevision,oldRevision+1);assert.equal(ctx.cloudDirty,false);
 // Another administrator changes the database between reads.
 remote=await (await handleRequest(new Request(origin+'/api/state',{headers:{Cookie:cookie}}),env)).json();remote.data.catalog[0].name='Other manager change';
 const other=await handleRequest(new Request(origin+'/api/state',{method:'PUT',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({revision:remote.revision,operationId:crypto.randomUUID(),data:remote.data})}),env);assert.equal(other.status,200);
 el('adminModal').classList.add('show');const editingRevision=ctx.cloudRevision;await ctx.cloudRefresh(false);assert.equal(ctx.cloudRevision,editingRevision);
 ctx.ITEM_INDEX[first].summary='Unsaved conflicting draft';ctx.saveCatalog();await ctx.cloudFlush();assert.equal(ctx.cloudConflict,true);assert.equal(ctx.cloudDirty,true);assert(cache.size>0);
 failNextRead=true;await ctx.cloudLoadLatest();assert.equal(ctx.cloudDirty,true);assert(cache.size>0);
 await ctx.cloudLoadLatest();assert.equal(ctx.cloudDirty,false);assert.equal(ctx.CATALOG[0].name,'Other manager change');el('adminModal').classList.remove('show');
 // Structured step and media library editing remain functional.
 ctx.adminOpenItemEditor(first);const rows=el('itemStepsEditor').children;rows[0].querySelector('[data-step-field="title"]').value='Shared step title';
 rows[0].querySelector('[data-step-field="imageUrl"]').value='https://example.com/step.jpg';rows[0].querySelector('[data-step-field="videoUrl"]').value='https://example.com/step.mp4';
 el('itemEditorForm').listeners.submit[0]({preventDefault(){}});await ctx.cloudFlush();assert.equal(ctx.cloudDirty,false);assert.equal(ctx.ITEM_INDEX[first].sopSteps[0].title,'Shared step title');
 ctx.beginMediaAssetEdit('');el('mediaAssetName').value='Unused shared image';el('mediaAssetType').value='image';el('mediaAssetUrl').value='https://example.com/library.jpg';ctx.saveMediaLibraryAsset();await ctx.cloudFlush();
 remote=await (await handleRequest(new Request(origin+'/api/state',{headers:{Cookie:cookie}}),env)).json();assert(remote.data.mediaLibrary.assets.some(a=>a.name==='Unused shared image'));
 cookie='__Host-gapology_session=invalid';await ctx.cloudRefresh(true);assert.equal(ctx.accessRole,null);assert.match(el('loginError').textContent,/expired/);
 el('loginRole').value='manager';el('pwInput').value=env.ADMIN_PASSWORD;await ctx.handleLoginSubmit();assert.equal(ctx.accessRole,'manager');
 const managerCookie=cookie;
 await ctx.cloudLogout();assert.equal(ctx.accessRole,null);assert.equal(cache.size,0);
 el('loginRole').value='staff';await ctx.handleLoginSubmit();assert.equal(ctx.accessRole,'staff');assert.equal(ctx.ALL_ITEMS.length,1);assert.equal(Object.keys(ctx.BASES).length,0);
 ctx.showDetail(first);assert(el('detailContent').innerHTML.includes('Shared step title'));assert(el('detailContent').innerHTML.includes('<video '));
 assert.equal(ctx.lsGet(ctx.LS_MEDIA_LIBRARY).assets.length,0);
 // Hide a page remotely, then refresh the staff session: data and DOM are removed.
 remote=await (await handleRequest(new Request(origin+'/api/state',{headers:{Cookie:managerCookie}}),env)).json();remote.data.catalog[0].sublists[0].items[0].staffVisible=false;
 const hidden=await handleRequest(new Request(origin+'/api/state',{method:'PUT',headers:{Cookie:managerCookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({revision:remote.revision,operationId:crypto.randomUUID(),data:remote.data})}),env);assert.equal(hidden.status,200);
 await ctx.cloudRefresh(true);assert.equal(ctx.ALL_ITEMS.length,0);assert.equal(ctx._currentDetailId,null);assert.equal(el('detailContent').innerHTML,'');
 assert.equal(alerts.length,0);
 DB.db.close();return {items:95,checks:'two-session synchronization, concurrent local edits, response-loss retry, conflict handling, draft retention, step media, library persistence, staff filtering, and hidden-page removal'};
}
export const frontendResult=await runFrontendChecks();
await test('Cloud saving and existing UI work against the shared API',()=>assert.equal(frontendResult.items,95));
