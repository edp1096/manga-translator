const path=require('path'),{chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
(async()=>{const browser=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:true});try{const page=await browser.newPage();await page.addScriptTag({path:path.resolve(__dirname,'../extension/render.js')});const report=await page.evaluate(()=>{
 const check=(x,m)=>{if(!x)throw Error(m)},row={id:1,type:'text',mode:'replace',text:'...',translation:'...',bbox:[100,100,128,214],box:[100,100,140,214],detectorConfidence:.55,fontSize:20},result={width:480,height:640,regions:[row]};
 row.punctuationMismatch={version:1,method:'non-dot-connected-strokes',id:1,sourceText:'...',sourceBox:[100,100,128,214],sourceConfidence:.55,imageWidth:480,imageHeight:640,evidence:[80,128,176].map(threshold=>({threshold,totalInk:1000,componentInk:800,componentBox:[105,104,120,209]}))};
 const before=JSON.stringify(result),shown=MangaRender.presentation(result,'auto',null);
 check(shown.regions[0].mode==='tooltip','Mismatch was overwritten');check(JSON.stringify(result)===before,'Source mutated');check(JSON.stringify(MangaRender.editedBase(shown,result))===before,'Automatic guard leaked into edit');
 let cases=1;for(const change of ['manual','layoutOverride','displayOverride','sourceText','sourceBox','confidence','imageSize','evidence','id','method','normalDots']){
  const r=structuredClone(result),x=r.regions[0],p=x.punctuationMismatch;
  if(['manual','layoutOverride','displayOverride'].includes(change))x[change]=true;
  else if(change==='sourceText')x.text='Corrected';else if(change==='sourceBox')p.sourceBox[0]++;else if(change==='confidence')p.sourceConfidence=.9;else if(change==='imageSize')p.imageWidth++;
  else if(change==='evidence')p.evidence[0].threshold=79;else if(change==='id')p.id=2;else if(change==='method')p.method='unknown';else p.evidence.forEach(e=>e.componentBox=[105,104,115,114]);
  check(MangaRender.presentation(r,'auto',null).regions[0].mode==='replace','Invalid or overridden evidence applied: '+change);cases++;
 }
 return{cases,originalRetained:true,explicitEditsPreserved:true};});console.log(JSON.stringify({ok:true,browser:browser.version(),...report}));}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
