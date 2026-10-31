const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
(async()=>{const browser=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:true});try{const page=await browser.newPage();await page.addScriptTag({path:path.resolve(process.env.MANGA_RENDERER||path.join(__dirname,'../extension/render.js'))});const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/restoration-enclosure-effect.json')));const report=await page.evaluate(f=>{
 let checks=0;const check=(v,m)=>{if(!v)throw Error(m);checks++;},output=[];const before=JSON.stringify(f.result),shown=MangaRender.presentation(f.result,'white',f.geometry,'restore',f.restoration);
 for(const id of f.ids){const source=f.result.regions.find(r=>r.id===id),entry=f.restoration.regions.find(r=>r.id===id),placed=shown.regions.find(r=>r.id===id);check(placed.mode==='restore'&&placed.restorationScope==='enclosure','Real overlapping effect hides source '+id);const layout=MangaRender.textLayout(JSON.parse(JSON.stringify(placed)));check(layout&&layout.fontSize===placed.fontSize,'Serialized layout changed '+id);const margin=Math.max(1,Math.ceil(layout.fontSize*.075+1));let top=placed.box[1]+(placed.box[3]-placed.box[1]-layout.height)/2;
  for(const m of layout.metrics){const x=(placed.box[0]+placed.box[2]+m.left-m.right)/2,y=top+(m.height-m.ascent-m.descent)/2+m.ascent,ink=[x-m.left-margin,y-m.ascent-margin,x+m.right+margin,y+m.descent+margin];check(MangaRender.coverage(entry.enclosure,f.result,ink)>=.98,'Ink or halo leaves enclosure '+id);check(entry.effectProtection.regions.every(p=>MangaRender.coverage(p.geometry,f.result,ink)===0),'Ink covers protected effect '+id);top+=m.height;}
  check(shown.regions.find(r=>r.id===f.effectId).mode==='tooltip','Foreign effect altered');check(MangaRender.presentation(f.result,'white',f.geometry,'tooltip',f.restoration).regions.find(r=>r.id===id).mode==='tooltip','Toggle original failed');
  for(let bits=0;bits<16;bits++){const meta=structuredClone(f.restoration),agreement=Array.from({length:4},(_,i)=>!!(bits&(1<<i)));meta.regions.find(r=>r.id===id).enclosureProof.readingProof.agreement=agreement;const expected=agreement[0]&&agreement.filter(Boolean).length>=3?'restore':'tooltip';check(MangaRender.presentation(f.result,'white',f.geometry,'restore',meta).regions.find(r=>r.id===id).mode===expected,'OCR evidence combination '+bits+' source '+id);}
  for(const mutation of ['missingProof','method','reading','sourceBox','sourceConfidence','missingReadingProof','readingMethod','nonBooleanVotes','unknownScope','sourceManual','sourceLayout','sourceDisplay','sourceTruncated','sourcePanel','weakSource','effectManual','effectTruncated','effectStaleBox','effectStaleScore','missingEffectProof','duplicateEffectProof','unknownEffectMethod','emptyEffectMask','inkCollision','foreignText','unfittable']){
   const result=structuredClone(f.result),meta=structuredClone(f.restoration),row=result.regions.find(r=>r.id===id),mask=meta.regions.find(r=>r.id===id),effect=result.regions.find(r=>r.id===f.effectId),effectProof=mask.effectProtection.regions.find(r=>r.id===f.effectId);
   if(mutation==='missingProof')delete mask.enclosureProof;
   else if(mutation==='method')mask.enclosureProof.method='unverified';
   else if(mutation==='reading')mask.enclosureProof.reading='high-confidence-text';
   else if(mutation==='sourceBox')mask.enclosureProof.sourceBox[0]++;
   else if(mutation==='sourceConfidence')mask.enclosureProof.sourceConfidence=.95;
   else if(mutation==='missingReadingProof')delete mask.enclosureProof.readingProof;
   else if(mutation==='readingMethod')mask.enclosureProof.readingProof.method='guessed';
   else if(mutation==='nonBooleanVotes')mask.enclosureProof.readingProof.agreement=[1,true,true,true];
   else if(mutation==='unknownScope')mask.scope='outside';
   else if(mutation==='sourceManual')row.manual=true;
   else if(mutation==='sourceLayout')row.layoutOverride=true;
   else if(mutation==='sourceDisplay')row.displayOverride=true;
   else if(mutation==='sourceTruncated')row.ocrTruncated=true;
   else if(mutation==='sourcePanel')row.panelCandidate=true;
   else if(mutation==='weakSource'){row.detectorConfidence=.89;mask.enclosureProof.sourceConfidence=.89;for(const p of mask.effectProtection.regions)p.sourceConfidence=.89;}
   else if(mutation==='effectManual')effect.manual=true;
   else if(mutation==='effectTruncated')effect.ocrTruncated=true;
   else if(mutation==='effectStaleBox')effect.bbox[0]++;
   else if(mutation==='effectStaleScore')effect.detectorConfidence+=.01;
   else if(mutation==='missingEffectProof')mask.effectProtection.regions=mask.effectProtection.regions.filter(r=>r.id!==f.effectId);
   else if(mutation==='duplicateEffectProof')mask.effectProtection.regions.push(structuredClone(effectProof));
   else if(mutation==='unknownEffectMethod')effectProof.method='unverified';
   else if(mutation==='emptyEffectMask')effectProof.geometry.runs=[];
   else if(mutation==='inkCollision'){const g=effectProof.geometry;g.runs=[0,g.width*g.height];}
   else if(mutation==='foreignText')result.preservedRegions=[{bbox:[...row.bbox]}];
   else if(mutation==='unfittable')row.translation='unfittable '.repeat(1000);
   check(MangaRender.presentation(result,'white',f.geometry,'restore',meta).regions.find(r=>r.id===id).mode==='tooltip','Guard failed '+mutation+' source '+id);
  }
  output.push({id,font:layout.fontSize,lines:layout.lines});
 }
 check(JSON.stringify(f.result)===before,'Stored result mutated');return{checks,cases:output};
},fixture);assert(report.checks>=90);console.log(JSON.stringify({...report,browser:browser.version()}));}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1});
