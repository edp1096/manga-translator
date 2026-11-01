(()=>{
 const keys=stored=>Object.keys(stored).filter(k=>k.startsWith('page:')||k.startsWith('edit:'));
 async function stats(){const stored=await chrome.storage.local.get(null),selected=keys(stored);return {pages:selected.filter(k=>k.startsWith('page:')).length,edits:selected.filter(k=>k.startsWith('edit:')).length,bytes:await chrome.storage.local.getBytesInUse(selected)};}
 async function prune(ids,all){if(!all&&(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id))))throw Error('잘못된 작업 목록');const wanted=new Set(ids||[]),stored=await chrome.storage.local.get(null),remove=[],changed={};for(const key of keys(stored)){if(all){remove.push(key);continue;}if(key.startsWith('edit:')){if(wanted.has(key.slice(5)))remove.push(key);continue;}const value=stored[key],items=(value?.items||[]).filter(x=>!wanted.has(x.id));if(items.length===(value?.items||[]).length)continue;if(items.length)changed[key]={...value,items};else remove.push(key);}if(remove.length)await chrome.storage.local.remove(remove);if(Object.keys(changed).length)await chrome.storage.local.set(changed);return stats();}
 globalThis.MangaJobCache={stats,prune};
})();
