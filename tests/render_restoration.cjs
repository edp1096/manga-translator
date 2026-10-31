const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
(async()=>{const browser=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:true});try{
 const page=await browser.newPage();await page.setContent('<body/>');await page.addScriptTag({path:path.resolve(__dirname,'../extension/render.js')});
 const report=await page.evaluate(async()=>{
  const check=(v,m)=>{if(!v)throw Error(m)},result={width:720,height:1020,regions:[{id:1,type:'text',mode:'tooltip',bbox:[200,300,320,450],box:[200,300,320,450],fontSize:32,text:'Outside thought',translation:'생각입니다'}]},geometry={version:3,width:720,height:1020,bubbles:[]};
  const mask={id:1,sourceText:result.regions[0].text,sourceBox:result.regions[0].bbox,bounds:[195,295,325,455],runs:[]};for(let y=0;y<160;y++)mask.runs.push(y*130,15);
  const meta={version:1,width:720,height:1020,regions:[mask]},before=JSON.stringify(result),shown=MangaRender.presentation(result,'auto',geometry,'restore',meta);
  check(shown.regions[0].mode==='restore','Valid text not restored');check(JSON.stringify(result)===before,'Base mutated');check(JSON.stringify(MangaRender.editedBase(shown,result))===before,'Auto mode leaked into edit');
  let guarded=0;for(const change of ['manual','displayOverride','effect','tooLong','missingMask','wrongSource','wrongBox','wrongSize']){
   const r=structuredClone(result),m=structuredClone(meta);if(change==='effect')r.regions[0].type='effect';else if(change==='tooLong')r.regions[0].translation='Long '.repeat(1000);else if(change==='missingMask')m.regions=[];else if(change==='wrongSource')m.regions[0].sourceText='different';else if(change==='wrongBox')m.regions[0].sourceBox[0]++;else if(change==='wrongSize')m.width--;else r.regions[0][change]=true;
   check(MangaRender.presentation(r,'auto',geometry,'restore',m).regions[0].mode==='tooltip','Guard failed: '+change);guarded++;
  }
  const bubbleRuns=[];for(let y=26;y<49;y++)bubbleRuns.push(y*72+16,20);
  const bubble={bbox:[160,260,360,490],width:72,height:102,runs:bubbleRuns,confidence:.72};
  const bubbleGeometry={...geometry,bubbles:[bubble]},bubbleMeta=structuredClone(meta);Object.assign(bubbleMeta.regions[0],{scope:'bubble',bubble});
  const balloon=MangaRender.presentation(result,'white',bubbleGeometry,'restore',bubbleMeta);
  check(balloon.regions[0].mode==='restore'&&balloon.regions[0].restorationScope==='bubble','Connected balloon not restored');
  check(JSON.stringify(MangaRender.editedBase(balloon,result))===before,'Balloon presentation leaked into saved edit');
  check(MangaRender.presentation(result,'white',bubbleGeometry,'tooltip',bubbleMeta).regions[0].mode==='tooltip','Balloon restoration did not switch off');
  const paddingNeighbor=structuredClone(result);paddingNeighbor.preservedRegions=[{bbox:[322,440,330,460]}];
  check(MangaRender.presentation(paddingNeighbor,'white',bubbleGeometry,'restore',bubbleMeta).regions[0].mode==='restore','Empty mask padding blocked a safe restoration');
  for(const change of ['missingAuthorization','weakBubble','missingBubble','badMask','manual','displayOverride','effect','unfittable','preservedNeighbor','manualOverlap']){
   const r=structuredClone(result),m=structuredClone(bubbleMeta);
   if(change==='missingAuthorization')delete m.regions[0].scope;
   else if(change==='weakBubble')m.regions[0].bubble.confidence=.6;
   else if(change==='missingBubble')delete m.regions[0].bubble;
   else if(change==='badMask')m.regions[0].bubble.runs=[-1,50];
   else if(change==='effect')r.regions[0].type='effect';
   else if(change==='unfittable')r.regions[0].translation='Long '.repeat(1000);
   else if(change==='preservedNeighbor')r.preservedRegions=[{bbox:[195,295,210,310]}];
   else if(change==='manualOverlap'){r.regions[0].layoutOverride=true;r.regions[0].box=[200,300,350,470];r.regions.push({id:2,bbox:[330,400,350,460],box:[330,400,350,460]});}
   else r.regions[0][change]=true;
   check(MangaRender.presentation(r,'white',bubbleGeometry,'restore',m).regions[0].mode==='tooltip','Balloon guard failed: '+change);guarded++;
  }
  const outsideNear=structuredClone(result);outsideNear.regions[0].textVerification={version:1,method:'ocr-consensus',role:'LABEL'};
  const nearBubble={...bubble,bbox:[160,260,240,490],runs:[]};for(let y=26;y<49;y++)nearBubble.runs.push(y*72+16,8);
  const nearGeometry={...geometry,bubbles:[nearBubble]},outsideMeta=structuredClone(meta);outsideMeta.regions[0].scope='outside';outsideMeta.regions[0].runs=[];for(let y=0;y<160;y++)outsideMeta.regions[0].runs.push(y*130+55,15);
  const nearShown=MangaRender.presentation(outsideNear,'white',nearGeometry,'restore',outsideMeta);
  check(nearShown.regions[0].mode==='restore','Verified nearby label not restored');check(nearShown.regions[0].box[0]>=242,'Label painted over neighboring balloon');
  check(JSON.stringify(MangaRender.editedBase(nearShown,outsideNear))===JSON.stringify(outsideNear),'Nearby restoration leaked into edit');
  check(MangaRender.presentation(outsideNear,'white',nearGeometry,'white',outsideMeta).regions[0].mode==='tooltip','White rectangle bypassed balloon protection');
  for(const change of ['missingVerification','manual','effect','overlappingGlyph','noSpace']){
   const r=structuredClone(outsideNear),g=structuredClone(nearGeometry);if(change==='missingVerification')delete r.regions[0].textVerification;else if(change==='effect')r.regions[0].type='effect';else if(change==='manual')r.regions[0].manual=true;else if(change==='overlappingGlyph')r.preservedRegions=[{bbox:[250,300,270,350]}];else g.bubbles[0].bbox=[150,250,350,490];
   check(MangaRender.presentation(r,'white',g,'restore',outsideMeta).regions[0].mode==='tooltip','Nearby label guard failed: '+change);guarded++;
  }
  // A small bbox overlap can evade the coarse near-balloon threshold. Restored
  // contours still need the same free-space layout as larger overlaps.
  const slightGeometry={...geometry,bubbles:[{...bubble,bbox:[310,260,400,490],runs:[]}]};
  for(let y=26;y<49;y++)slightGeometry.bubbles[0].runs.push(y*72+32,8);
  const slight=MangaRender.presentation(outsideNear,'white',slightGeometry,'restore',outsideMeta);
  check(slight.regions[0].mode==='restore'&&slight.regions[0].box[2]<=308,'Small balloon overlap bypassed restored-text placement');guarded++;
  const adjacent=structuredClone(outsideNear),adjacentMeta=structuredClone(outsideMeta);
  adjacent.regions.push({...structuredClone(adjacent.regions[0]),id:2,bbox:[250,400,360,550],box:[250,400,360,550],text:'Neighbor name',translation:'이름'});
  const peerMask={id:2,scope:'outside',sourceText:'Neighbor name',sourceBox:[250,400,360,550],bounds:[245,395,365,555],runs:[]};for(let y=0;y<160;y++)peerMask.runs.push(y*120+95,10);adjacentMeta.regions.push(peerMask);
  check(MangaRender.presentation(adjacent,'white',nearGeometry,'restore',adjacentMeta).regions.every(r=>r.mode==='restore'),'Verified neighbor rectangles blocked authorized masks');
  const manualPeer=structuredClone(adjacent);manualPeer.regions[1].manual=true;
  check(MangaRender.presentation(manualPeer,'white',nearGeometry,'restore',adjacentMeta).regions[0].mode==='tooltip','Verified peer bypassed manual protection');guarded++;
  const missingPeer=structuredClone(adjacentMeta);missingPeer.regions.pop();
  check(MangaRender.presentation(adjacent,'white',nearGeometry,'restore',missingPeer).regions[0].mode==='tooltip','Missing peer authorization ignored');guarded++;
  // Ordinary high-confidence dialogue already has an authorized erasure mask.
  // It must get the same free-space placement as independently verified labels.
  const ordinary=structuredClone(outsideNear);delete ordinary.regions[0].textVerification;ordinary.regions[0].detectorConfidence=.94;
  const ordinaryBefore=JSON.stringify(ordinary),ordinaryShown=MangaRender.presentation(ordinary,'white',nearGeometry,'restore',outsideMeta);
  check(ordinaryShown.regions[0].mode==='restore'&&ordinaryShown.regions[0].box[0]>=242,'Authorized ordinary dialogue stuck in tooltip');
  check(JSON.stringify(ordinary)===ordinaryBefore,'Ordinary source mutated');
  check(JSON.stringify(MangaRender.editedBase(ordinaryShown,ordinary))===ordinaryBefore,'Ordinary layout leaked into edit');
  check(MangaRender.presentation(ordinary,'white',nearGeometry,'white',outsideMeta).regions[0].mode==='tooltip','Ordinary white box bypassed protection');
  check(MangaRender.presentation(ordinary,'white',nearGeometry,'tooltip',outsideMeta).regions[0].mode==='tooltip','Ordinary tooltip toggle failed');
  for(const change of ['lowConfidence','invalidConfidence','stringConfidence','missingMask','wrongSource','wrongBox','manual','effect','overlappingGlyph','noSpace','tooLong','manualOverlap']){
   const r=structuredClone(ordinary),g=structuredClone(nearGeometry),m=structuredClone(outsideMeta);
   if(change==='lowConfidence')r.regions[0].detectorConfidence=.89;
   else if(change==='invalidConfidence')r.regions[0].detectorConfidence=1.1;
   else if(change==='stringConfidence')r.regions[0].detectorConfidence='.94';
   else if(change==='missingMask')m.regions=[];
   else if(change==='wrongSource')m.regions[0].sourceText='stale';
   else if(change==='wrongBox')m.regions[0].sourceBox[0]++;
   else if(change==='manual')r.regions[0].manual=true;
   else if(change==='effect')r.regions[0].type='effect';
   else if(change==='overlappingGlyph')r.preservedRegions=[{bbox:[250,300,270,350]}];
   else if(change==='noSpace')g.bubbles[0].bbox=[150,250,350,490];
   else if(change==='tooLong')r.regions[0].translation='Long '.repeat(1000);
   else {r.regions[0].layoutOverride=true;r.regions[0].box=[200,300,320,450];}
   check(MangaRender.presentation(r,'white',g,'restore',m).regions[0].mode==='tooltip','Ordinary protection failed: '+change);guarded++;
  }
  const segmented=structuredClone(adjacent),segmentedMeta=structuredClone(adjacentMeta);
  for(const r of segmented.regions){delete r.textVerification;r.detectorConfidence=.94;}
  const neighborRuns=[];for(let y=40;y<55;y++)neighborRuns.push(y*72+34,1);
  segmentedMeta.regions[0].segmentedNeighborProtection={version:1,method:'detector-glyph-mask',regions:[{id:2,sourceText:segmented.regions[1].text,sourceBox:segmented.regions[1].bbox,sourceConfidence:.94,geometry:{width:72,height:102,bbox:segmented.regions[1].bbox,confidence:.94,runs:neighborRuns}}]};
  const segmentedBefore=JSON.stringify(segmented),segmentedShown=MangaRender.presentation(segmented,'white',nearGeometry,'restore',segmentedMeta);
  check(segmentedShown.regions[0].mode==='restore','Proven segmented neighbor blocked source restoration');
  check(JSON.stringify(segmented)===segmentedBefore,'Segmented source mutated');
  for(const change of ['missingProof','wrongMethod','wrongSource','wrongBox','wrongScore','weakNeighbor','weakSource','manualNeighbor','manualSource','editedNeighbor','duplicate','emptyMask','invalidMask','wrongGeometry','wrongScope']){
   const r=structuredClone(segmented),m=structuredClone(segmentedMeta),proof=m.regions[0].segmentedNeighborProtection,entry=proof.regions[0];
   if(change==='missingProof')delete m.regions[0].segmentedNeighborProtection;
   else if(change==='wrongMethod')proof.method='unverified';
   else if(change==='wrongSource')entry.sourceText='stale';
   else if(change==='wrongBox')entry.sourceBox=[251,400,360,550];
   else if(change==='wrongScore')entry.sourceConfidence=.99;
   else if(change==='weakNeighbor')r.regions[1].detectorConfidence=.5;
   else if(change==='weakSource')r.regions[0].detectorConfidence=.5;
   else if(change==='manualNeighbor')r.regions[1].manual=true;
   else if(change==='manualSource')r.regions[0].manual=true;
   else if(change==='editedNeighbor')r.regions[1].layoutOverride=true;
   else if(change==='duplicate')proof.regions.push(structuredClone(entry));
   else if(change==='emptyMask')entry.geometry.runs=[];
   else if(change==='invalidMask')entry.geometry.runs=[-1,2];
   else if(change==='wrongGeometry')entry.geometry.bbox=[251,400,360,550];
   else m.regions[0].scope='unverified';
   check(MangaRender.presentation(r,'white',nearGeometry,'restore',m).regions[0].mode==='tooltip','Segmented neighbor guard failed: '+change);guarded++;
  }
  const tiny={width:960,height:1360,regions:[{id:1,type:'text',mode:'tooltip',bbox:[100,100,117,148],box:[100,100,117,148],fontSize:32,text:'Annotation',translation:'주석문',textVerification:{version:1,method:'ocr-consensus',role:'LABEL',sources:[[100,100,117,148]]}}]};
  const tinyBubble={bbox:[90,146,180,300],width:96,height:136,confidence:.95,runs:[]};for(let y=15;y<30;y++)tinyBubble.runs.push(y*96+9,9);
  const tinyGeometry={width:960,height:1360,bubbles:[tinyBubble]},tinyMask={id:1,sourceText:'Annotation',sourceBox:[100,100,117,148],scope:'outside',bounds:[99,99,119,149],runs:[]};for(let y=5;y<40;y++)tinyMask.runs.push(y*20+5,7);
  const tinyMeta={version:1,width:960,height:1360,regions:[tinyMask]},tinyShown=MangaRender.presentation(tiny,'auto',tinyGeometry,'restore',tinyMeta).regions[0];
  check(tinyShown.mode==='restore'&&tinyShown.fontSize>=8&&tinyShown.fontSize<11,'Small annotation did not shrink before tooltip');
  check(tinyShown.box[3]<=143,'Small annotation crossed neighboring balloon');
  const tinyManual=structuredClone(tiny);tinyManual.regions[0].layoutOverride=true;tinyManual.regions[0].box=[100,100,117,143];
  check(MangaRender.presentation(tinyManual,'auto',tinyGeometry,'restore',tinyMeta).regions[0].mode==='tooltip','Automatic shrinking changed explicit layout');guarded++;
  const tinyLong=structuredClone(tiny);tinyLong.regions[0].translation='Long '.repeat(500);
  check(MangaRender.presentation(tinyLong,'auto',tinyGeometry,'restore',tinyMeta).regions[0].mode==='tooltip','Small annotation bypassed absolute font floor');guarded++;
  const narrow={width:960,height:1360,regions:[{id:1,type:'text',mode:'tooltip',bbox:[200,300,222,442],box:[200,300,222,442],fontSize:32,text:'A narrow thought',translation:'글자...',detectorConfidence:.88}]};
  const narrowGeometry={width:960,height:1360,bubbles:[]},narrowMask={id:1,sourceText:'A narrow thought',sourceBox:[200,300,222,442],scope:'outside',bounds:[198,298,224,444],runs:[]};for(let y=4;y<140;y++)narrowMask.runs.push(y*26+4,18);
  const narrowMeta={version:1,width:960,height:1360,regions:[narrowMask]};
  const narrowShown=MangaRender.presentation(narrow,'white',narrowGeometry,'restore',narrowMeta).regions[0];
  check(narrowShown.mode==='restore'&&narrowShown.fontSize>=8&&narrowShown.fontSize<11,'Narrow punctuation did not shrink for authorized restoration');
  check(MangaRender.presentation(narrow,'white',narrowGeometry,'white',narrowMeta).regions[0].mode==='tooltip','Restoration retry changed white mode');guarded++;
  const readable=structuredClone(narrow);Object.assign(readable.regions[0],{bbox:[200,300,226,472],box:[200,300,226,472],translation:'이게 다야.'});
  const readableMask={...narrowMask,sourceBox:[200,300,226,472],bounds:[200,300,226,472],runs:[0,26*172]},readableMeta={...narrowMeta,regions:[readableMask]};
  const readableShown=MangaRender.presentation(readable,'white',narrowGeometry,'restore',readableMeta).regions[0];
  check(readableShown.mode==='restore'&&readableShown.fontSize>=16,'Restored vertical caption remained artificially tiny: '+JSON.stringify({mode:readableShown.mode,fontSize:readableShown.fontSize,layout:MangaRender.textLayout(readableShown)}));
  check(JSON.stringify(readableShown.box)===JSON.stringify(readable.regions[0].bbox),'Larger caption expanded its placement box');
  check(MangaRender.presentation(readable,'white',narrowGeometry,'white',readableMeta).regions[0].fontSize<=11,'Restoration font changed white box typography');guarded++;
  for(const [translation,token]of[['수는 839개.','839'],['값은 1.24다.','1.24'],['go NOW','NOW']]){
   const r=structuredClone(readable);r.regions[0].translation=translation;
   const shown=MangaRender.presentation(r,'white',narrowGeometry,'restore',readableMeta).regions[0],layout=MangaRender.textLayout(shown);
   check(shown.mode==='restore'&&layout&&layout.lines.some(line=>line.includes(token)),'Restored caption split a numeric/Latin run: '+token);guarded++;
  }

  for(const change of ['manual','layoutOverride','displayOverride','missingMask','staleMask','tooLong','neighbor']){
   const r=structuredClone(narrow),m=structuredClone(narrowMeta);
   if(change==='missingMask')m.regions=[];else if(change==='staleMask')m.regions[0].sourceText='stale';else if(change==='tooLong')r.regions[0].translation='Long '.repeat(500);else if(change==='neighbor')r.preservedRegions=[{bbox:[200,300,222,442]}];else r.regions[0][change]=true;
   check(MangaRender.presentation(r,'white',narrowGeometry,'restore',m).regions[0].mode==='tooltip','Narrow restoration guard failed: '+change);guarded++;
  }
  const strongGeometry=structuredClone(bubbleGeometry);strongGeometry.bubbles[0].confidence=.96;
  check(MangaRender.presentation(result,'white',strongGeometry,'restore',bubbleMeta).regions[0].mode==='white','Restoration overrode existing white balloon');
  const c=document.createElement('canvas');c.width=720;c.height=1020;const x=c.getContext('2d');x.fillStyle='#567';x.fillRect(0,0,720,1020);const original=c.toDataURL();x.fillStyle='#f00';x.fillRect(0,0,720,1020);const restored=c.toDataURL();
  const canvas=document.createElement('canvas');await MangaRender.render(canvas,shown,original,original,restored);const pixels=canvas.getContext('2d').getImageData(0,0,720,1020).data;
  const at=(x,y)=>Array.from(pixels.slice((y*720+x)*4,(y*720+x)*4+3)).join(',');check(at(196,296)==='255,0,0','Mask missing');check(at(324,296)==='85,102,119','Rectangle outside mask was erased');check(at(100,100)==='85,102,119','Unrelated image changed');
  const impossible=structuredClone(result);impossible.regions[0].translation='Long '.repeat(1000);await MangaRender.render(canvas,MangaRender.presentation(impossible,'auto',geometry,'restore',meta),original,original,restored);check(canvas.toDataURL()===original,'Unfittable translation erased source');
  await MangaRender.render(canvas,MangaRender.presentation(result,'auto',geometry,'tooltip',meta),original,original,restored);check(canvas.toDataURL()===original,'Tooltip failed to restore source');
  let rejected=0;for(const runs of [[-1,10],[0,50000],[0,20,10,20],[0,0],[1.5,10],[0]]){const bad=structuredClone(meta);bad.regions[0].runs=runs;try{await MangaRender.render(canvas,MangaRender.presentation(result,'auto',geometry,'restore',bad),original,original,restored)}catch{rejected++}}
  check(rejected===6,'Malformed masks accepted');let missing=false;try{await MangaRender.render(canvas,shown,original,original)}catch{missing=true}check(missing,'Missing asset erased original');return{guarded,rejected,exactMask:true,unfittablePreserved:true,basePreserved:true,reversible:true};
 });console.log(JSON.stringify({ok:true,browser:browser.version(),...report}));}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
