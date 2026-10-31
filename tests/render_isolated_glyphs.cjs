const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
(async()=>{const browser=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:true});try{
 const page=await browser.newPage();for(const file of ['polygon.js','render.js'])await page.addScriptTag({path:path.resolve(__dirname,'../extension',file)});
 const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'../control/tests/native/fixtures/isolated-glyph-render.json')));
 const report=await page.evaluate(f=>{
  let checks=0;const check=(v,m)=>{if(!v)throw Error(m);checks++;},mask=f.restoration.regions.find(r=>r.isolatedGlyphProof),id=mask.id;
  const present=(r=f.result,m=f.restoration)=>MangaRender.presentation(r,'white',f.geometry,'restore',m).regions.find(r=>r.id===id),base=JSON.stringify(f),shown=present();
  check(shown.mode==='restore','Isolated dialogue is hidden');check(MangaRender.textLayout(shown)?.fontSize===shown.fontSize,'Text does not fit');
  check(MangaRender.presentation(f.result,'white',f.geometry,'tooltip',f.restoration).regions.find(r=>r.id===id).mode==='tooltip','Tooltip toggle failed');
  const changes={
   method:(r,m,p)=>p.method='guessed',version:(r,m,p)=>p.version=2,
   text:(r,m,p)=>p.sourceText+='x',box:(r,m,p)=>p.sourceBox[0]++,confidence:(r,m,p)=>p.sourceConfidence=.9,
   background:(r,m,p)=>p.protectedInkChanges=1,
   originalReading:(r,m,p)=>p.originalReadings[0]='different',isolatedReading:(r,m,p)=>p.isolatedReadings.pop(),
   views:(r,m,p)=>p.views.pop(),agreement:(r,m,p)=>p.views[0].agreement=.89,
   detailConfidence:(r,m,p)=>p.views[0].confidence=.19,
   components:(r,m,p)=>p.components=[],glyphCount:(r,m,p)=>p.glyphPixels++,
   core:(r,m,p)=>p.components[0].corePixels=0,sourceSupport:(r,m,p)=>p.components[0].sourceFraction=.39,
   coreSupport:(r,m,p)=>p.components[0].coreSourceFraction=.49,
   detailSupport:(r,m,p)=>p.components[0].viewFractions=[.9,.49,.49],
   unsupportedView:(r,m,p)=>p.components[0].viewFractions=[.9,.9,.24],
   missingSourceBox:(r,m,p)=>delete p.sourceBox,
   manual:r=>r.manual=true,layoutOverride:r=>r.layoutOverride=true,displayOverride:r=>r.displayOverride=true,
   truncated:r=>r.ocrTruncated=true,panelCandidate:r=>r.panelCandidate=true,effect:r=>r.type='effect'
  };
  for(const [name,change]of Object.entries(changes)){const r=structuredClone(f.result),m=structuredClone(f.restoration),source=r.regions.find(r=>r.id===id),item=m.regions.find(r=>r.id===id);change(source,item,item.isolatedGlyphProof);check(present(r,m).mode!=='restore','Invalid proof accepted: '+name);}
  // Regression: the peer bbox encloses the source, but its actual ink is
  // elsewhere. Restore and place against its mask; retain real collisions.
  {
   const r=structuredClone(f.result),m=structuredClone(f.restoration),source=r.regions.find(x=>x.id===id),item=m.regions.find(x=>x.id===id);
   source.detectorConfidence=.95;item.isolatedGlyphProof.sourceConfidence=.95;
   const peer={...structuredClone(source),id:999,bbox:[700,940,900,1240],box:[700,940,900,1240],text:'neighbor',translation:'',mode:'tooltip'};
   delete peer.hitMask;delete peer.ocrDuplicateGeometry;r.regions.push(peer);
   const runs=[];for(let y=950;y<1230;y++)runs.push(y*r.width+870,10);
   const g={width:r.width,height:r.height,bbox:peer.bbox,confidence:.95,runs};
   // Geometry masks are capped at 512; use a proportional page grid.
   g.width=240;g.height=341;g.runs=[];for(let y=240;y<305;y++)g.runs.push(y*240+218,2);
   item.segmentedNeighborProtection={version:1,method:'detector-glyph-mask',regions:[{id:peer.id,sourceText:peer.text,sourceBox:peer.bbox,sourceConfidence:.95,geometry:g}]};
   const shown=present(r,m);check(shown.mode==='restore','Empty peer bbox still blocks isolated text');
   check(!!MangaRender.textLayout(shown),'Segmented placement has no text');
   g.runs=[];for(let y=235;y<312;y++)g.runs.push(y*240+175,50);
   check(present(structuredClone(r),structuredClone(m)).mode!=='restore','Actual peer ink collision was ignored');
   delete item.segmentedNeighborProtection;
   check(present(r,m).mode!=='restore','Missing peer segmentation bypassed protection');
  }
  check(JSON.stringify(f)===base,'Fixture mutated');return{checks,negativeCases:Object.keys(changes).length,font:shown.fontSize,box:shown.box,lines:MangaRender.textLayout(shown).lines};
 },fixture);assert(report.checks>25);console.log(JSON.stringify(report));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
