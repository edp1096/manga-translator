const assert=require('node:assert/strict'),path=require('node:path');const {chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
(async()=>{const browser=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:true});try{const page=await browser.newPage();for(const file of ['polygon.js','render.js'])await page.addScriptTag({path:path.resolve(__dirname,'../extension',file)});const report=await page.evaluate(()=>{
 const mask={version:1,kind:'detector-text-region',imageWidth:100,imageHeight:100,width:10,height:10,sourceBox:[10,10,90,90],sourceText:'test',runs:[11,3,21,1,31,1],pixels:5},row={mode:'tooltip',text:'test',translation:'Test',bbox:[10,10,90,90],hitMask:mask},result={width:100,height:100,regions:[row]},before=JSON.stringify(result);
 const clip=MangaPolygon.clip(row,result,[]),tests=[{name:'valid concave mask',ok:typeof clip==='string'&&clip.startsWith('polygon(')}];
 const invalid=[{version:2},{kind:'other'},{imageWidth:101},{sourceText:'changed'},{sourceBox:[10,10,80,90]},{width:513},{height:0},{runs:[11,0]},{runs:[11,3,12,1],pixels:4},{runs:[19,3],pixels:3},{runs:[99,2],pixels:2},{runs:[11,.5],pixels:.5},{runs:[11]},{runs:[]},{pixels:6}];
 invalid.forEach((change,i)=>tests.push({name:'invalid '+i,ok:MangaPolygon.clip({...row,hitMask:{...mask,...change}},result,[])===null}));
 for(const flag of ['manual','layoutOverride'])tests.push({name:flag,ok:MangaPolygon.clip({...row,[flag]:true},result,[])===null});
 tests.push({name:'empty after protection',ok:MangaPolygon.clip(row,result,[[0,0,100,100]])==='polygon(0% 0%,0% 0%,0% 0%)'});
 tests.push({name:'legacy result',ok:MangaRender.tooltipClip({...row,hitMask:undefined},result)===''});
 const provisional={...row,type:'text',panelCandidate:true};
 tests.push({name:'provisional panel cannot whiten',ok:!MangaRender.whiteCandidate(provisional)&&!MangaRender.outsideCandidate(provisional)});
 const confirmed={...provisional,textVerification:{version:1,method:'ocr-consensus',role:'LABEL',sources:[row.bbox]}};
 tests.push({name:'verified panel eligible',ok:MangaRender.whiteCandidate(confirmed)&&MangaRender.outsideCandidate(confirmed)});
 const module=MangaPolygon;globalThis.MangaPolygon=undefined;tests.push({name:'missing library fallback',ok:MangaRender.tooltipClip(row,result)===''});globalThis.MangaPolygon=module;
 tests.push({name:'immutable source',ok:JSON.stringify(result)===before});return tests;
 });assert(report.every(t=>t.ok),JSON.stringify(report));console.log(JSON.stringify({ok:true,checks:report.length,browser:browser.version()}));}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
