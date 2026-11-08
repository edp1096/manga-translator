(()=>{
 const pageBudget=4*1024*1024,owned=key=>key.startsWith('page:')||key.startsWith('edit:');
 async function allKeys(){return chrome.storage.local.getKeys?chrome.storage.local.getKeys():Object.keys(await chrome.storage.local.get(null));}
 async function keys(){return(await allKeys()).filter(owned);}
 async function pages(){const selected=(await allKeys()).filter(k=>k.startsWith('page:'));return selected.length?chrome.storage.local.get(selected):{};}
 async function stats(){const selected=await keys();return {pages:selected.filter(k=>k.startsWith('page:')).length,edits:selected.filter(k=>k.startsWith('edit:')).length,bytes:await chrome.storage.local.getBytesInUse(selected)};}
 async function writePage(key,value){
  if(!key.startsWith('page:'))throw Error('잘못된 페이지 캐시');
  const stored=await pages(),now=Date.now(),size=(key,value)=>new TextEncoder().encode(key+JSON.stringify(value)).length;
  stored[key]=value;const ordered=Object.entries(stored).sort((a,b)=>(a[1].updated||0)-(b[1].updated||0)),remove=[];let total=ordered.reduce((n,[k,v])=>n+size(k,v),0);
  for(const [k,v]of ordered){if(k===key)continue;if(now-(v.updated||0)>86400000||total>pageBudget){remove.push(k);total-=size(k,v);}}
  while(size(key,value)>pageBudget&&value.items?.length)value.items.shift();
  if(remove.length)await chrome.storage.local.remove(remove);
  if(value.items?.length)await chrome.storage.local.set({[key]:value});else await chrome.storage.local.remove([key]);
 }
 async function prune(ids,all){
  if(!all&&(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id))))throw Error('잘못된 작업 목록');
  const selected=await keys();if(all){if(selected.length)await chrome.storage.local.remove(selected);return stats();}
  const wanted=new Set(ids||[]),stored=await pages(),remove=[],changed={};
  for(const key of selected){if(key.startsWith('edit:')){if(wanted.has(key.slice(5)))remove.push(key);continue;}const value=stored[key],items=(value?.items||[]).filter(x=>!wanted.has(x.id));if(items.length===(value?.items||[]).length)continue;if(items.length)changed[key]={...value,items};else remove.push(key);}
  if(remove.length)await chrome.storage.local.remove(remove);if(Object.keys(changed).length)await chrome.storage.local.set(changed);return stats();
 }
 globalThis.MangaJobCache={stats,prune,writePage,pages,keys,pageBudget};
})();
