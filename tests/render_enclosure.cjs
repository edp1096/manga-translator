const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
(async()=>{const browser=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:true});try{
 const page=await browser.newPage();await page.addScriptTag({path:path.resolve(process.env.MANGA_RENDERER||path.join(__dirname,'../extension/render.js'))});
 const fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/restoration-enclosure.json')));
 const report=await page.evaluate(fixtures=>{
  let checks=0;const check=(value,message)=>{if(!value)throw Error(message);checks++;};const output=[];
  for(const f of fixtures){
   const before=JSON.stringify(f.result),source=f.result.regions.find(r=>r.id===f.id),base=MangaRender.presentation(f.result,'white',f.geometry,'restore',f.restoration),shown=base.regions.find(r=>r.id===f.id);
   check(shown.mode==='restore'&&shown.restorationScope==='enclosure','Real enclosure not displayed '+f.chapter);
   check(shown.box[0]>=source.bbox[0]&&shown.box[1]>=source.bbox[1]&&shown.box[2]<=source.bbox[2]&&shown.box[3]<=source.bbox[3],'Layout expanded beyond source');
   const serialized=JSON.parse(JSON.stringify(shown)),layout=MangaRender.textLayout(serialized),mask=f.restoration.regions.find(r=>r.id===f.id);
   check(layout&&layout.fontSize===shown.fontSize,'Serialized font changed '+f.chapter);
   let top=shown.box[1]+(shown.box[3]-shown.box[1]-layout.height)/2;
   const margin=Math.max(1,Math.ceil(layout.fontSize*.075+1));
   for(const metric of layout.metrics){const x=(shown.box[0]+shown.box[2]+metric.left-metric.right)/2,y=top+(metric.height-metric.ascent-metric.descent)/2+metric.ascent,ink=[x-metric.left-margin,y-metric.ascent-margin,x+metric.right+margin,y+metric.descent+margin];check(MangaRender.coverage(mask.enclosure,f.result,ink)>=.98,'Serialized ink/halo crosses enclosure '+f.chapter);top+=metric.height;}
   check(JSON.stringify(f.result)===before,'Source mutated');
   check(MangaRender.presentation(f.result,'white',f.geometry,'tooltip',f.restoration).regions.find(r=>r.id===f.id).mode==='tooltip','Toggle did not restore original');
   for(const mutation of ['missingProof','method','reading','sourceBox','sourceConfidence','emptyGuards','strongEnclosure','missingEnclosure','wrongScope','emptyMask','manual','layoutOverride','displayOverride','ocrTruncated','panelCandidate','effect','tooLong','foreignText']){
    const r=structuredClone(f.result),m=structuredClone(f.restoration),row=r.regions.find(x=>x.id===f.id),entry=m.regions.find(x=>x.id===f.id);
    if(mutation==='missingProof')delete entry.enclosureProof;
    else if(mutation==='method')entry.enclosureProof.method='unverified';
    else if(mutation==='reading')entry.enclosureProof.reading='guessed';
    else if(mutation==='sourceBox')entry.enclosureProof.sourceBox[0]++;
    else if(mutation==='sourceConfidence')entry.enclosureProof.sourceConfidence-=.1;
    else if(mutation==='emptyGuards')entry.enclosureProof.guards=[];
    else if(mutation==='strongEnclosure')entry.enclosure.confidence=.9;
    else if(mutation==='missingEnclosure')delete entry.enclosure;
    else if(mutation==='wrongScope')entry.scope='unknown';
    else if(mutation==='emptyMask')entry.enclosure.runs=[];
    else if(mutation==='effect')row.type='effect';
    else if(mutation==='tooLong')row.translation='unfittable '.repeat(1000);
    else if(mutation==='foreignText')r.preservedRegions=[{bbox:[...row.bbox]}];
    else row[mutation]=true;
    check(MangaRender.presentation(r,'white',f.geometry,'restore',m).regions.find(r=>r.id===f.id).mode==='tooltip','Enclosure guard failed '+mutation+' '+f.chapter);
   }
   output.push({chapter:f.chapter,font:layout.fontSize,lines:layout.lines});
  }
  return{checks,cases:output};
 },fixtures);
 assert(report.checks>=60);console.log(JSON.stringify({...report,browser:browser.version()}));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1});
