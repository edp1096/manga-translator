const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
(async()=>{const b=await chromium.launch({headless:true});try{
 const p=await b.newPage({viewport:{width:1100,height:800},deviceScaleFactor:1.25});
 await p.route('**/*',async route=>{if(route.request().resourceType()==='image')await new Promise(r=>setTimeout(r,350));await route.continue();});
 await p.goto('https://vw.mangaz.com/virgo/view/287048/i:0',{waitUntil:'domcontentloaded'});await p.waitForTimeout(1800);
 await p.addScriptTag({path:path.resolve(__dirname,'../extension/readers.js')});
 await p.evaluate(()=>{
  window.clicks=0;window.dropped=0;
  document.addEventListener('click',e=>{if(!e.target.closest('.btnNext,.btnBack'))return;if(++clicks%4===1){dropped++;e.stopImmediatePropagation();e.preventDefault();}},true);
 });
 const report=await p.evaluate(async()=>{
  const rounds=[];
  for(let round=0;round<3;round++){
   const r=MangaReaders.create(),pages=r.pages(),order=round%2?[...pages].reverse():pages,results=[];
   for(const page of order){const before=performance.now();try{await r.locate(page);const data=await r.read(page);results.push({index:page.index,ok:true,width:data.width,height:data.height,ms:Math.round(performance.now()-before)});}catch(e){results.push({index:page.index,ok:false,error:e.message,debug:{url:location.href,current:document.querySelector('.current-number')?.textContent,adapter:r.currentIndex(),images:[...document.querySelectorAll('#book .page_unit img')].map(i=>({no:i.getAttribute('no'),cls:i.className,style:i.getAttribute('style'),rect:i.getBoundingClientRect().toJSON(),parent:i.parentElement.outerHTML.slice(0,350)})),buttons:[...document.querySelectorAll('.btnNext,.btnBack')].map(b=>({cls:b.className,style:b.getAttribute('style'),disabled:b.disabled}))}});}}
   rounds.push(results);
  }
  return {rounds,clicks,dropped};
 });

 const evidence=process.env.MANGA_EVIDENCE||path.resolve(__dirname,'../docs/control-0.3.15');fs.mkdirSync(evidence,{recursive:true});
 fs.writeFileSync(path.join(evidence,'mangaz-navigation-stress.json'),JSON.stringify({browser:b.version(),imageDelayMs:350,viewport:{width:1100,height:800},deviceScaleFactor:1.25,...report},null,2)+'\n');
 assert(report.rounds.every(r=>r.length===7&&r.every(p=>p.ok)),JSON.stringify(report));assert(report.dropped>0);
 console.log(JSON.stringify({ok:true,reads:21,droppedClicks:report.dropped,clicks:report.clicks,imageDelayMs:350}));
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
