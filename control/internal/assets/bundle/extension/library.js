// Persistent rereading uses the controller, without starting inference models.
(()=>{
 async function request(path,options={}){const s=await settings(),u=new URL(s.server);u.port='8794';u.pathname='/api/library'+path;u.search='';const q=path.indexOf('?');if(q>=0){u.pathname='/api/library'+path.slice(0,q);u.search=path.slice(q)};const r=await fetch(u.href,{...options,headers:{...options.headers,...(options.method?{Authorization:'Bearer '+s.token}: {})},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('저장 결과 서버 '+r.status);return r;}
 async function restore(url,tabId){const s=await settings();if(Number.isInteger(tabId)){const override=(await chrome.storage.session.get('libraryTarget:'+tabId))['libraryTarget:'+tabId];if(override?.url===MangaReaders.pageIdentity(url))s.target=override.target;}const key=pageCacheKey(url),cache=(await chrome.storage.local.get(key))[key];let saved;
 try{saved=await(await request('/restore?pageURL='+encodeURIComponent(MangaReaders.pageIdentity(url))+'&target='+encodeURIComponent(s.target))).json();}catch{ return cache?.server===s.server?(cache.items||[]).filter(x=>Date.now()-x.updated<86400000&&x.result?.target===s.target):[]; }
 if(!Array.isArray(saved))throw Error('저장 결과 목록 형식 오류');
 return saved.map(item=>{const prior=cache?.server===s.server?cache.items?.find(x=>x.id===item.id&&x.sourceURL===item.sourceURL&&x.result?.target===s.target):null;return prior&&prior.updated>=item.updated?{...item,...prior}:item;});
 }
 async function remember(msg){catalog=null;await request('/presentation/'+encodeURIComponent(msg.id),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result:msg.result,bubbles:msg.bubbles})});}
 let catalog=null,catalogAt=0,catalogServer='';
 async function known(url){const s=await settings();if(!catalog||Date.now()-catalogAt>30000||catalogServer!==s.server){catalog=(await(await request('')).json()).chapters;catalogAt=Date.now();catalogServer=s.server;}return catalog.some(c=>MangaReaders.pageIdentity(c.url)===MangaReaders.pageIdentity(url));}
 chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.target)chrome.storage.session.get(null).then(all=>chrome.storage.session.remove(Object.keys(all).filter(k=>k.startsWith('libraryTarget:'))));});
 globalThis.MangaLibrary={request,restore,remember,known};
})();
