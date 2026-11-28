(() => {
 const allowed = new Set(['kakuyomu.jp','comic-walker.com','www.kadokawa.co.jp','store.kadokawa.co.jp','shonenjumpplus.com','tonarinoyj.jp','comic-days.com','www.sunday-webry.com','urasunday.com','manga-one.com','pocket.shonenmagazine.com','younganimal.com','comic-earthstar.com','manga-mee.jp','palcy.jp','www.manga-up.com','ynjn.jp','yanmaga.jp','ncode.syosetu.com']);
 // Generic roles remain dialogue vocabulary even when the source annotates them.
 const commonRoles=new Set(['先生','老師','師匠','師父','教官','院長','先生さま','シスター','神父','エージェント','生徒','隊長','団長','社長']);
 function lookupTerms(terms,corpus,known=new Set()){
  const unique=new Set();
  const add=term=>{if(term&&term.length>=2&&!known.has(term)&&!commonRoles.has(term)&&corpus.some(line=>line.includes(term)))unique.add(term);};
  for(const term of terms){
   const parts=term.split(/(?<=\p{Script=Han})[—―ー](?=\p{Script=Han})/u);
   for(const part of parts)add(part);
   for(const prefix of terms)if(prefix!==term&&term.startsWith(prefix)){
    const suffix=term.slice(prefix.length);
    if(corpus.some(line=>line.includes(suffix)&&!line.includes(term)))add(suffix);
   }
  }
  return [...unique];
 }
 const searchable = text => String(text||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
 const cleanTitle = title => String(title||'').replace(/\s+(?:raw|raw free|chapter|episode|제?\s*\d+화|第\d+話)\b.*$/iu,'').split(/\s+[|｜]\s+/)[0].trim().slice(0,110);
 function official(value) {
  try {
   const url = new URL(value);
   if(url.protocol!=='https:'||url.username||url.password||url.port||!allowed.has(url.hostname))return null;
   url.hash='';url.search='';
   return url;
  } catch { return null; }
 }
 function oneGlyphApart(a,b) {
  const first=[...a],second=[...b];
  return first.length>=2&&first.length===second.length&&first.filter((x,i)=>x!==second[i]).length===1;
 }
 function resultLinks() {
  return [...document.querySelectorAll('a[data-testid="result-title-a"], article h2 a')].slice(0,16).map(anchor=>{
   const href=new URL(anchor.href);
   return {url:href.searchParams.get('uddg')||href.href,title:anchor.textContent.trim()};
  });
 }
 function pageEvidence(terms) {
  const trim=value=>value.replace(/\s+/gu,' ').trim();
  const root=document.querySelector('.widget-episodeBody, article, main')||document.body;
  const lines=[...root.querySelectorAll('p, h1, h2, h3, dt, dd, figcaption')].map(p=>trim(p.textContent)).filter(p=>p&&p.length<=420);
  const rubies=[...root.querySelectorAll('ruby')].map(node=>{
   const reading=trim(node.querySelector('rt')?.textContent||'');
   const copy=node.cloneNode(true);copy.querySelectorAll('rt,rp').forEach(part=>part.remove());
   return {term:trim(copy.textContent),reading};
  }).filter(r=>r.term.length>=2&&/^[ぁ-ヿー]+$/u.test(r.reading));
  const meta=document.querySelector('meta[property="og:title"]')?.content||'';
  return {title:[document.title,meta,document.querySelector('h1')?.textContent||''].join(' ').slice(0,550),rubies:rubies.slice(0,300),
   lines:lines.filter(line=>terms.some(term=>line.includes(term))||rubies.some(row=>terms.some(term=>term.includes(row.term))&&line.includes(row.term))).slice(0,100)};
 }
 async function navigate(tab,url,fn,args=[],search=false) {
  await chrome.tabs.update(tab,{url,active:true});
  const until=Date.now()+10500;
  do {
   await new Promise(resolve=>setTimeout(resolve,380));
   const state=await chrome.tabs.get(tab);
   if(state.status!=='complete')continue;
   const current=new URL(state.url);
   if(search?current.origin!=='https://duckduckgo.com'||current.searchParams.get('q')!==new URL(url).searchParams.get('q'):official(current)?.href!==official(url)?.href)continue;
   try {
    const data=(await chrome.scripting.executeScript({target:{tabId:tab,frameIds:[0]},func:fn,args}))[0]?.result;
    if(data&&(!search||data.length))return data;
   } catch {}
  }while(Date.now()<until);
  return null;
 }
 function records(doc,url,terms,corpus,known) {
  const out=[];
  function add(term,reading,alias) {
   if(known.has(term)||commonRoles.has(term)||out.some(x=>x.term===term))return;
   const useful=doc.lines.filter(line=>line.includes(term));
   const address=line=>line.includes(term+'くん')||line.includes(term+'さん')||line.includes(term+'君')||/名前|名付|呼び名/.test(line);
   useful.sort((a,b)=>Number(address(b))-Number(address(a)));
   if(!useful.length)return;
   out.push({term,reading,reference:url,context:[...new Set(useful)].slice(0,4).map(line=>line.slice(0,170)),...(alias?{alias}:{})});
  }
  for(const term of terms) {
   const exact=doc.rubies.filter(row=>row.term===term||(term.includes(row.term)&&/[—―・ー（）「」]/u.test(term)&&corpus.some(line=>line.includes(row.term))));
   for(const item of exact)if(!exact.some(other=>other.term===item.term&&other.reading!==item.reading))add(item.term,item.reading);
   if(!exact.length&&(doc.lines.filter(line=>line.includes(term)).length>=2||(doc.title.includes(term)&&doc.lines.some(line=>line.includes(term)))))add(term,'');
   // A spelling difference is eligible only if the canonical term is present
   // elsewhere in this chapter and its official reading is unambiguous.
   const close=doc.rubies.filter(r=>oneGlyphApart(r.term,term)&&corpus.some(line=>line.includes(r.term)));
   if(!exact.length&&new Set(close.map(x=>x.term+'\0'+x.reading)).size===1)add(close[0].term,close[0].reading,term);
  }
  return out;
 }
 async function discover({title,corpus,known,terms,source}) {
  const evidence=new Map();
  const titleKey=searchable(title);
  if(titleKey.length<3)throw Error('검색에 사용할 작품명을 입력하세요.');
  const windowTab=await chrome.tabs.create({url:'about:blank',active:true});
  try {
   if(source) {
    const url=official(source);
    if(!url)throw Error('지원하는 원작·출판사 페이지 주소를 입력하세요.');
    const doc=await navigate(windowTab.id,url.href,pageEvidence,[terms]);
    if(!doc||!searchable(doc.title).includes(titleKey))throw Error('출처에서 현재 작품명을 확인하지 못했습니다. 원작 제목을 확인하세요.');
    for(const row of records(doc,url.href,terms,corpus,known))evidence.set(row.term,row);
   }else {
    const visited=new Set();
    for(const term of terms.slice(0,5)){
     if(evidence.has(term))continue;
     const query='https://duckduckgo.com/?q='+encodeURIComponent(title+' '+term);
     const links=await navigate(windowTab.id,query,resultLinks,[],true);
     if(!links)break;
     const references=links.map(link=>({url:official(link.url),title:link.title})).filter(link=>link.url&&!visited.has(link.url.href)&&searchable(link.title).includes(titleKey));
     references.sort((a,b)=>Number(/\/episodes?\//.test(b.url.pathname))-Number(/\/episodes?\//.test(a.url.pathname)));
     for(const {url} of references.slice(0,2)){
      if(visited.has(url.href))continue;
      visited.add(url.href);
      const doc=await navigate(windowTab.id,url.href,pageEvidence,[terms]);
      if(!doc||!searchable(doc.title).includes(titleKey))continue;
      for(const row of records(doc,url.href,terms,corpus,known))if(!evidence.has(row.term))evidence.set(row.term,row);
      if(evidence.has(term)||evidence.size>=10)break;
     }
     if(evidence.size>=10)break;
    }
   }
  }finally { await chrome.tabs.remove(windowTab.id).catch(()=>{}); }
  return [...evidence.values()].slice(0,10);
 }
 globalThis.MangaGlossary={discover,cleanTitle,lookupTerms};
})();
