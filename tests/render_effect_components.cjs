const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
(async()=>{const browser=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:true});try{
 const page=await browser.newPage();for(const file of ['polygon.js','render.js'])await page.addScriptTag({path:path.resolve(__dirname,'../extension',file)});
 const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'../control/tests/native/fixtures/effect-components-render.json')));
 const report=await page.evaluate(f=>{
  let checks=0;const check=(v,m)=>{if(!v)throw Error(m);checks++;},id=f.restoration.regions[0].id;
  const present=(r=f.result,m=f.restoration)=>MangaRender.presentation(r,'white',f.geometry,'restore',m),base=JSON.stringify(f),shown=present(),owner=shown.regions.find(r=>r.id===id),mask=f.restoration.regions[0];
  check(owner.mode==='restore','Verified disconnected components still hide dialogue: '+owner.mode);
  const proof=mask.effectProtection.regions[0],fx=shown.regions.find(r=>r.id===proof.id);check(fx.mode==='tooltip','Effect changed');
  const layout=MangaRender.textLayout(structuredClone(owner));check(layout&&layout.fontSize===owner.fontSize,'Layout changed');
  let top=owner.box[1]+(owner.box[3]-owner.box[1]-layout.height)/2;const margin=Math.max(1,Math.ceil(layout.fontSize*.075+1));
  for(const m of layout.metrics){const x=(owner.box[0]+owner.box[2]+m.left-m.right)/2,y=top+(m.height-m.ascent-m.descent)/2+m.ascent;
   check(MangaRender.coverage(proof.geometry,f.result,[x-m.left-margin,y-m.ascent-margin,x+m.right+margin,y+m.descent+margin])===0,'Translated ink covers retained effect');top+=m.height;}
  check(MangaRender.presentation(f.result,'white',f.geometry,'tooltip',f.restoration).regions.find(r=>r.id===id).mode==='tooltip','Toggle failed');
  check(JSON.stringify(MangaRender.editedBase(shown,f.result))===JSON.stringify(f.result),'Presentation leaked into saved source');
  const cases={
   missingProof:(r,m,p)=>delete p.componentOwnership,
   unknownMethod:(r,m,p,o)=>o.method='guessed',
   sourceText:(r,m,p,o)=>o.sourceText+='x',sourceBox:(r,m,p,o)=>o.sourceBox[0]++,sourceScore:(r,m,p,o)=>o.sourceConfidence=.9,
   query:(r,m,p,o)=>o.compositeQuery=o.effectQuery,queryRange:(r,m,p,o)=>o.effectQuery=300,
   compositeScore:(r,m,p,o)=>o.compositeConfidence=.1,
   missingVerification:(r,m,p,o,s)=>delete s.textVerification,verificationRole:(r,m,p,o,s)=>s.textVerification.role='EFFECT',
   verificationSources:(r,m,p,o,s)=>s.textVerification.sources=[s.bbox],
   missingPart:(r,m,p,o)=>o.sourceParts=[],unknownPart:(r,m,p,o)=>o.sourceParts[0].kind='guessed',
   stalePart:(r,m,p,o)=>o.sourceParts[0].bbox[0]++,stalePunctuation:(r,m,p,o,s)=>s.punctuationFragments[0].ownerText='stale',
   missingPunctuation:(r,m,p,o,s)=>delete s.punctuationFragments,
   missingComponent:(r,m,p,o)=>o.components.pop(),duplicateComponent:(r,m,p,o)=>o.components.push(structuredClone(o.components[0])),
   componentPart:(r,m,p,o)=>o.components[0].sourcePart=99,componentBounds:(r,m,p,o)=>o.components[0].gridBox[0]++,
   componentCount:(r,m,p,o)=>o.components[0].cells++,componentRuns:(r,m,p,o)=>o.components[0].runs=[-1,1],
   effectCells:(r,m,p,o)=>o.effectCells++,sourceCells:(r,m,p,o)=>o.sourceCells++,claimedCells:(r,m,p,o)=>o.claimedCells++,
   effectFraction:(r,m,p,o)=>o.effectFraction=.9,sourceFraction:(r,m,p,o)=>o.sourceFraction=.9,
   missingOriginal:(r,m,p,o)=>delete o.originalGeometry,missingSource:(r,m,p,o)=>delete o.sourceGeometry,
   originalRuns:(r,m,p,o)=>o.originalGeometry.runs=[],sourceRuns:(r,m,p,o)=>o.sourceGeometry.runs=[],claimedRuns:(r,m,p,o)=>o.claimedGeometry.runs=[],
   grid:(r,m,p,o)=>o.originalGeometry.width++,imageSize:(r,m,p,o)=>o.sourceGeometry.imageWidth++,
   retainedRuns:(r,m,p)=>p.geometry.runs=[],retainedScore:(r,m,p)=>p.geometry.confidence+=.01,
   wrongScope:(r,m)=>m.scope='enclosure',duplicateProof:(r,m,p)=>m.effectProtection.regions.push(structuredClone(p)),
   foreignText:r=>r.preservedRegions=[{bbox:[...r.regions.find(r=>r.id===id).bbox]}],
   unfittable:(r,m,p,o,s)=>s.translation='unfittable '.repeat(1000)
  };
  for(const member of ['source','effect'])for(const flag of ['manual','layoutOverride','displayOverride','ocrTruncated','truncated','panelCandidate'])cases[member+flag]=(r,m,p,o,s,e)=>(member==='source'?s:e)[flag]=true;
  for(const [name,mutate]of Object.entries(cases)){const r=structuredClone(f.result),meta=structuredClone(f.restoration),m=meta.regions[0],p=m.effectProtection.regions[0],o=p.componentOwnership,s=r.regions.find(r=>r.id===id),e=r.regions.find(r=>r.id===p.id);mutate(r,m,p,o,s,e);const before=JSON.stringify(r);check(present(r,meta).regions.find(r=>r.id===id).mode==='tooltip','Guard failed '+name);check(JSON.stringify(r)===before,'Source mutated '+name);}
  const api=globalThis.MangaPolygon;globalThis.MangaPolygon=undefined;check(present().regions.find(r=>r.id===id).mode==='tooltip','Missing polygon bypassed guard');globalThis.MangaPolygon=api;
  check(JSON.stringify(f)===base,'Fixture mutated');return{checks,negativeCases:Object.keys(cases).length,font:layout.fontSize,lines:layout.lines};
 },fixture);assert(report.negativeCases>=45);console.log(JSON.stringify(report));
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
