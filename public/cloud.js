/* Shared saving adapter. Recipe data and manager credentials are supplied by the server. */
var cloudMemory = {}, cloudRevision = 0, cloudReady = false, cloudDirty = false;
var cloudEditSequence = 0, cloudSaveTimer = null, cloudSaving = null, cloudConflict = false;
var cloudPendingRequest = null, cloudPoll = null, cloudLoginBusy = false, cloudEtag = '';
var cloudDraftKey = 'gapology-shared-draft:' + location.pathname;
var cloudHistoryBefore = null;

function cloudStatus(message, kind) {
  var el = document.getElementById('cloudStatus');
  el.textContent = message; el.dataset.kind = kind || 'info';
  document.getElementById('cloudRetry').hidden = !cloudDirty || kind === 'saving';
  document.getElementById('cloudLoadLatest').hidden = !cloudConflict;
  document.getElementById('cloudDownloadDraft').hidden = !cloudDirty;
}
async function cloudApi(path, options) {
  options = options || {};
  var response = await fetch('/api/' + path, Object.assign({credentials:'same-origin',cache:'no-store'}, options));
  if (response.status === 304) return {unchanged:true};
  var result;
  try { result = await response.json(); } catch (error) { throw new Error('The shared API is unavailable. Deploy this folder with Pages Functions and connect D1.'); }
  if (!response.ok) { if(response.status===401 && accessRole==='manager') cloudExpireSession(); var failure = new Error(result.error || 'Shared storage request failed.'); failure.status = response.status; throw failure; }
  if(result.role==='staff' && accessRole==='manager'){cloudExpireSession();var expired=new Error('Manager session expired. Sign in again.');expired.status=401;throw expired;}
  if (response.headers.get('ETag')) cloudEtag = response.headers.get('ETag');
  return result;
}
function cloudSnapshot() {
  return {catalog:CATALOG.map(function(cat) {
    return {id:cat.id,name:cat.name,icon:cat.icon||'📋',sublists:(cat.sublists||[]).map(function(sub) {
      return {id:sub.id,name:sub.name,items:(sub.items||[]).map(function(item) {
        return {id:item.id,name:item.name,summary:savedText(textKey('summary',item.id),item.summary||''),
          staffVisible:item.staffVisible===true,staffVideoVisible:item.staffVideoVisible===true,
          imageUrl:item.imageUrl||'',videoUrl:effectiveVideoUrl(item.id)||'',sopSteps:getItemSteps(item)};
      })};
    })};
  }),mediaLibrary:lsGet(LS_MEDIA_LIBRARY),customTexts:{}};
}
function cloudDownload(value, filename) {
  var blob = new Blob([JSON.stringify(value,null,2)],{type:'application/json'});
  var url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=filename;
  document.body.appendChild(anchor);anchor.click();anchor.remove();URL.revokeObjectURL(url);
}
function cloudStoreDraft() {
  try { sessionStorage.setItem(cloudDraftKey,JSON.stringify({revision:cloudRevision,data:cloudSnapshot()})); } catch (error) { /* Online saving continues if session storage is unavailable. */ }
}
function cloudMarkDirty() {
  if (!cloudReady || accessRole !== 'manager') return;
  cloudDirty=true;cloudEditSequence++;cloudStoreDraft();
  if (cloudConflict) { cloudStatus('Conflict: your draft is kept in this tab. Download it, then load the latest shared version.','error');return; }
  cloudStatus(navigator.onLine ? 'Changes pending. Saving online...' : 'Offline: draft kept in this tab. Not saved online.','saving');
  clearTimeout(cloudSaveTimer);cloudSaveTimer=setTimeout(cloudFlush,350);
}
async function cloudFlush() {
  clearTimeout(cloudSaveTimer);
  if (cloudSaving) return cloudSaving;
  if (!cloudDirty || accessRole !== 'manager' || cloudConflict) return;
  cloudSaving=(async function() {
    while(cloudDirty && accessRole==='manager' && !cloudConflict) {
      var snapshot=cloudSnapshot(), serialized=JSON.stringify(snapshot), sequence=cloudEditSequence;
      if (!cloudPendingRequest || cloudPendingRequest.serialized !== serialized) cloudPendingRequest={operationId:crypto.randomUUID(),serialized:serialized};
      cloudStatus('Saving online...','saving');
      try {
        var result=await cloudApi('state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:cloudRevision,operationId:cloudPendingRequest.operationId,action:'Administrator edit',data:snapshot})});
        cloudRevision=result.revision;cloudPendingRequest=null;cloudEtag='';
        if(sequence===cloudEditSequence) {
          cloudDirty=false;try{sessionStorage.removeItem(cloudDraftKey);}catch(error){}
          cloudStatus('Saved online · revision '+cloudRevision,'saved');
        } else {cloudStoreDraft();}
      } catch(error) {
        if(error.status===409)cloudConflict=true;
        cloudStatus(error.message+' Your draft is still in this tab.','error');return;
      }
    }
  })();
  try{await cloudSaving;}finally{cloudSaving=null;}
}
function cloudRender() {
  if (!CATALOG.some(function(cat){return cat.id===currentCatId;})) {currentCatId='all';currentSublistId=null;}
  rebuildIndex();updateItemCountLabel();renderMainCatTabs();renderCatNav();renderGrid();
  if(accessRole==='manager'){renderAdminHierarchy();populateAdminSelects();}
  if(_currentDetailId){if(!ITEM_INDEX[_currentDetailId]||(accessRole==='staff'&&!ITEM_INDEX[_currentDetailId].staffVisible))goToList();else refreshDetail();}
}
function cloudApply(packet) {
  cloudReady=false;cloudRevision=packet.revision;
  cloudMemory={};cloudMemory[LS_CATALOG]=packet.data.catalog;cloudMemory[LS_TEXT]=packet.data.customTexts||{};
  cloudMemory[LS_VIDEOS]={};cloudMemory[LS_MEDIA_LIBRARY]=packet.data.mediaLibrary||{nextIndex:1,assets:[]};
  CATALOG=JSON.parse(JSON.stringify(packet.data.catalog));cloudRender();cloudReady=true;
}
function cloudIsEditing() {
  return accessRole==='manager' && (_editMode || document.getElementById('adminModal').classList.contains('show') || document.getElementById('itemEditorModal').classList.contains('show'));
}
async function cloudRefresh(force) {
  if(!accessRole||(!force&&(cloudDirty||cloudSaving||document.hidden||cloudIsEditing())))return;
  try{
    var packet=await cloudApi('state'+(accessRole==='staff'?'?view=staff':''),{headers:!force&&cloudEtag?{'If-None-Match':cloudEtag}:{}});
    if(!force && cloudIsEditing()){cloudEtag='';return;}
    if(packet.unchanged)return;
    if(!force&&packet.revision===cloudRevision)return;
    cloudApply(packet);cloudStatus((accessRole==='staff'?'Shared content updated':'Shared content loaded')+' · revision '+cloudRevision,'saved');
  }catch(error){if(!cloudDirty)cloudStatus('Unable to refresh shared content. '+error.message,'error');}
}
async function cloudStart(role) {
  cloudReady=false;cloudDirty=false;cloudConflict=false;cloudPendingRequest=null;cloudEtag='';
  if(role==='manager'){
    var migration=await cloudApi('migration-data');BASES=migration.legacy.bases;VIDEO_LINKS=migration.legacy.videoLinks;DEFAULT_CATALOG=migration.seed.catalog;
  }else{BASES={};VIDEO_LINKS={};DEFAULT_CATALOG=[];}
  var packet=await cloudApi('state'+(role==='staff'?'?view=staff':''));
  accessRole=role;document.body.classList.toggle('staff-mode',role==='staff');
  document.getElementById('loginScreen').style.display='none';document.getElementById('app').classList.add('show');
  currentCatId='all';currentSublistId=null;goToList();cloudApply(packet);
  cloudStatus('Connected to shared storage · revision '+cloudRevision,'saved');
  clearInterval(cloudPoll);cloudPoll=setInterval(function(){cloudRefresh(false);},30000);
  document.getElementById('cloudStarter').hidden=role!=='manager'||CATALOG.length>0;
  document.getElementById('cloudDraftNotice').hidden=true;
  if(role==='manager')try{if(sessionStorage.getItem(cloudDraftKey))document.getElementById('cloudDraftNotice').hidden=false;}catch(error){}
}
async function handleLoginSubmit() {
  if(cloudLoginBusy)return;cloudLoginBusy=true;
  var errorEl=document.getElementById('loginError');errorEl.textContent='Connecting...';
  try{
    var role=document.getElementById('loginRole').value;
    if(role==='staff'){await cloudApi('logout',{method:'POST'});await cloudStart('staff');}
    else{
      var password=document.getElementById('pwInput').value;
      await cloudApi('login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:password})});
      document.getElementById('pwInput').value='';await cloudStart('manager');
    }
    errorEl.textContent='';
  }catch(error){errorEl.textContent=error.message;}finally{cloudLoginBusy=false;}
}
function cloudExpireSession() {
  if(cloudDirty)cloudStoreDraft();
  clearInterval(cloudPoll);cloudReady=false;accessRole=null;_editMode=false;document.body.classList.remove('edit-mode');
  document.getElementById('app').classList.remove('show');document.getElementById('loginScreen').style.display='flex';
  document.querySelectorAll('#adminModal, #itemEditorModal').forEach(function(el){el.classList.remove('show');});
  document.getElementById('loginError').textContent='Manager session expired. Sign in again to restore your pending draft.';
}
async function cloudLogout() {
  await cloudFlush();if(cloudDirty){cloudStatus('Save or download your pending draft before logging out.','error');return;}
  try{await cloudApi('logout',{method:'POST'});}catch(error){cloudStatus('Logout could not reach the server. Try again.','error');return;}
  clearInterval(cloudPoll);cloudReady=false;accessRole=null;cloudMemory={};CATALOG=[];ALL_ITEMS=[];ITEM_INDEX={};BASES={};DEFAULT_CATALOG=[];VIDEO_LINKS={};
  try{sessionStorage.removeItem(cloudDraftKey);}catch(error){}
  document.body.classList.remove('staff-mode','edit-mode');_editMode=false;
  document.getElementById('editToggleBtn').classList.remove('active');document.getElementById('editToggleBtn').textContent='✏️ Edit mode';
  document.querySelectorAll('#adminModal, #itemEditorModal').forEach(function(el){el.classList.remove('show');});
  document.getElementById('app').classList.remove('show');document.getElementById('loginScreen').style.display='flex';
  document.getElementById('detailContent').innerHTML='';document.getElementById('itemStepsEditor').innerHTML='';document.getElementById('mediaLibraryRows').innerHTML='';
  document.getElementById('loginError').textContent='';
}
async function cloudLoadLatest() {
  if(cloudDirty&&!confirm('Discard the unsaved draft and load the latest shared content? Download your draft first if you need to keep it.'))return;
  clearTimeout(cloudSaveTimer);
  try{
    var packet=await cloudApi('state'+(accessRole==='staff'?'?view=staff':''));
    cloudApply(packet);cloudDirty=false;cloudConflict=false;cloudPendingRequest=null;
    try{sessionStorage.removeItem(cloudDraftKey);}catch(error){}
    document.getElementById('itemEditorModal').classList.remove('show');
    cloudStatus('Latest shared content loaded · revision '+cloudRevision,'saved');
  }catch(error){cloudStatus('Could not load shared content. Your draft is retained. '+error.message,'error');}
}
function cloudRestoreDraft() {
  try{
    var draft=JSON.parse(sessionStorage.getItem(cloudDraftKey)||'null');if(!draft)return;
    if(draft.revision!==cloudRevision){cloudDownload(draft.data,'gapology-unsynced-draft.json');cloudStatus('Draft downloaded. Shared content changed since it was created; restore only the changes you still need.','error');return;}
    cloudApply({revision:cloudRevision,data:draft.data});cloudMarkDirty();document.getElementById('cloudDraftNotice').hidden=true;
  }catch(error){cloudStatus('Could not restore the browser draft. '+error.message,'error');}
}
function cloudLoadStarter() {
  if(accessRole!=='manager'||!confirm('Load the starter catalog into shared storage? All starter items begin hidden from staff.'))return;
  cloudReady=false;CATALOG=JSON.parse(JSON.stringify(DEFAULT_CATALOG));cloudMemory[LS_TEXT]={};cloudMemory[LS_VIDEOS]={};cloudMemory[LS_MEDIA_LIBRARY]={nextIndex:1,assets:[]};
  cloudRender();cloudReady=true;saveCatalog();document.getElementById('cloudStarter').hidden=true;
}
async function renderCloudHistory(older) {
  if(accessRole!=='manager')return;
  var table=document.getElementById('cloudHistoryRows');
  try{
    var data=await cloudApi('history'+(older&&cloudHistoryBefore?'?before='+cloudHistoryBefore:''));
    if(!older)table.innerHTML='';
    if(!data.entries.length&&!older)table.innerHTML='<tr><td colspan="5">No edits have been saved online yet.</td></tr>';
    data.entries.forEach(function(entry){
      var row=document.createElement('tr');row.innerHTML='<td>'+entry.revision+'</td><td>'+escapeHtml(new Date(entry.created_at).toLocaleString())+'</td><td>'+escapeHtml(entry.actor)+'</td><td>'+entry.summary.map(escapeHtml).join('<br>')+'</td><td><button type="button" class="cloud-history-download" data-revision="'+entry.revision+'">Download revision</button></td>';table.appendChild(row);
    });
    if(data.entries.length)cloudHistoryBefore=data.entries[data.entries.length-1].revision;
    document.getElementById('cloudHistoryOlder').hidden=data.entries.length<50;
  }catch(error){table.innerHTML='<tr><td colspan="5">'+escapeHtml(error.message)+'</td></tr>';}
}
async function cloudDownloadRevision(revision) {
  try{var record=await cloudApi('history/'+revision);cloudDownload(Object.assign({revision:record.revision,exportDate:record.created_at},record.after),'gapology-revision-'+revision+'.json');}catch(error){cloudStatus(error.message,'error');}
}
window.addEventListener('beforeunload',function(event){if(cloudDirty){event.preventDefault();event.returnValue='';}});
window.addEventListener('online',function(){if(cloudDirty&&!cloudConflict)cloudFlush();else cloudRefresh(false);});
window.addEventListener('focus',function(){cloudRefresh(false);});
document.addEventListener('visibilitychange',function(){if(!document.hidden)cloudRefresh(false);});
document.getElementById('cloudRetry').addEventListener('click',cloudFlush);
document.getElementById('cloudLoadLatest').addEventListener('click',cloudLoadLatest);
document.getElementById('cloudDownloadDraft').addEventListener('click',function(){cloudDownload(cloudSnapshot(),'gapology-unsynced-draft.json');});
document.getElementById('cloudRestoreDraft').addEventListener('click',cloudRestoreDraft);
document.getElementById('cloudDiscardDraft').addEventListener('click',function(){sessionStorage.removeItem(cloudDraftKey);document.getElementById('cloudDraftNotice').hidden=true;});
document.getElementById('cloudStarter').addEventListener('click',cloudLoadStarter);
document.getElementById('cloudHistoryRefresh').addEventListener('click',function(){renderCloudHistory(false);});
document.getElementById('cloudHistoryOlder').addEventListener('click',function(){renderCloudHistory(true);});
document.getElementById('cloudHistoryRows').addEventListener('click',function(event){var button=event.target.closest('[data-revision]');if(button)cloudDownloadRevision(button.getAttribute('data-revision'));});
cloudApi('session').then(function(info){if(!info.configured)document.getElementById('loginError').textContent='Setup needed: connect D1 and set the manager secrets in Cloudflare.';}).catch(function(error){document.getElementById('loginError').textContent=error.message;});
