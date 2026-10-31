const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
(async()=>{const browser=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:true});try{
 const page=await browser.newPage();for(const name of ['polygon.js','render.js'])await page.addScriptTag({path:path.resolve(__dirname,'../extension',name)});
 const report=await page.evaluate(f=>{
  const check=(v,m)=>{if(!v)throw Error(m)}, cases=[
   ['valid',()=>{},'restore'],
   ['manual',s=>s.manual=true],
   ['truncated',s=>s.ocrTruncated=true],
   ['stale text',s=>s.text+='x'],
   ['stale source',s=>s.bbox[0]++],
   ['low confidence',s=>s.detectorConfidence=.49],
   ['missing proof',(s,m)=>delete m.isolatedGlyphProof.sourceVerification],
   ['multiple sources',s=>s.textVerification.sources.push([...s.bbox])],
   ['primary disagreement',(s,m)=>m.isolatedGlyphProof.originalReadings[0]+='x'],
   ['isolated disagreement',(s,m)=>m.isolatedGlyphProof.isolatedReadings[0]+='x'],
   ['verifier disagreement',(s,m)=>m.isolatedGlyphProof.verifierReadings[0]+='x'],
   ['verifier isolated disagreement',(s,m)=>m.isolatedGlyphProof.verifierIsolatedReadings[0]+='x'],
   ['missing verifier',(s,m)=>delete m.isolatedGlyphProof.verifierReadings],
   ['wrong count',(s,m)=>m.isolatedGlyphProof.glyphPixels++],
   ['changed background',(s,m)=>m.isolatedGlyphProof.protectedInkChanges=1],
   ['unowned component',(s,m)=>m.isolatedGlyphProof.components[0].coreSourceFraction=.49],
  ];  for(const[name,mutate,mode='tooltip']of cases){const a=structuredClone(f),s=a.result.regions.find(r=>r.id===13),m=a.restoration.regions.find(r=>r.id===13);mutate(s,m,a.result);const before=JSON.stringify(a.result),shown=MangaRender.presentation(a.result,'white',a.geometry,'restore',a.restoration);check(shown.regions.find(r=>r.id===13).mode===mode,name);check(JSON.stringify(a.result)===before,'mutated source '+name);for(const e of a.result.regions.filter(r=>r.type==='effect'))check(shown.regions.find(r=>r.id===e.id).mode==='tooltip','effect changed');}
  return{cases:cases.length};
 },require('./fixtures/cross-ocr-glyphs.json'));assert.equal(report.cases,16);console.log(JSON.stringify(report));
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
