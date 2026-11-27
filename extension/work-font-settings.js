(() => {
const feedReaders=new Set(['tonarinoyj.jp','www.sunday-webry.com','shonenjumpplus.com','comic-days.com','comic-earthstar.com']);
const workFromChapter=[
 ['pocket.shonenmagazine.com', /^\/title\/\d+(?=\/|$)/],
 ['www.manga-up.com', /^\/titles\/\d+(?=\/|$)/],
 ['mangataro.org', /^\/read\/[^/]+(?=\/|$)/]
];

function pageAddress(value){
 try {
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.href.length>8192)return null;
  url.hash='';
  return url;
 }catch{return null;}
}

async function scope(value,tabId){
 const url=pageAddress(value);
 if(!url)return '';
 for(const [host,pattern] of workFromChapter){
  if(url.hostname!==host)continue;
  const match=url.pathname.match(pattern);
  if(match)return url.origin+match[0];
 }
 if(feedReaders.has(url.hostname)&&/^\/episode\/[^/]+\/?$/.test(url.pathname)&&Number.isInteger(tabId)){
  try{
   const [script]=await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},args:[url.origin,url.pathname],func:(origin,pathname)=>{
    if(location.origin!==origin||location.pathname!==pathname)return '';
    const series=new Set();
    for(const link of document.querySelectorAll('link[rel=alternate]')){
     const feed=new URL(link.href,location.href);
     const match=feed.pathname.match(/^\/(?:atom|rss)\/series\/(\d+)\/?$/);
     if(feed.origin===origin&&match)series.add(origin+'/series/'+match[1]);
    }
    return series.size===1?[...series][0]:'';
   }});
   if(script?.result)return script.result;
  }catch{}
 }
 if(feedReaders.has(url.hostname)&&/^\/(?:episode|series)\/[^/]+\/?$/.test(url.pathname))return url.origin+url.pathname.replace(/\/$/,'');
 return MangaNames.identity(url.href);
}

let writes=Promise.resolve();
async function read(value,tabId){
 const key=await scope(value,tabId);
 if(!key)return {key:'',profile:null};
 const state=(await chrome.storage.local.get('workFontPolicies')).workFontPolicies||{};
 const item=Object.hasOwn(state,key)?state[key]:null;
 return {key,profile:MangaFonts.normalizeWorkPolicy(item)};
}
function save(key,input){
 const url=pageAddress(key);
 if(!url||url.href!==key)throw Error('작품 주소를 다시 확인하세요.');
 const task=writes.catch(()=>{}).then(async()=>{
  const state=(await chrome.storage.local.get('workFontPolicies')).workFontPolicies||{};
  const preset=MangaFonts.presetPolicy(input?.preset);
  const profile=preset?MangaFonts.normalizeWorkPolicy({...input,version:preset.version}):null;
  if(input&&!profile)throw Error('글꼴 프리셋을 선택하세요.');
  if(profile)state[key]=profile;
  else delete state[key];
  await chrome.storage.local.set({workFontPolicies:state});
  return profile;
 });
 writes=task;return task;
}

globalThis.MangaWorkFonts={read,save};
})();
