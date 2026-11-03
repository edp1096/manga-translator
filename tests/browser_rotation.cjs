const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
(async()=>{const browser=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:true});try{const page=await browser.newPage();await page.setContent('<canvas id="preview"></canvas>');for(const name of ['polygon.js','rotation.js','render.js'])await page.addScriptTag({path:path.join(__dirname,'../extension',name)});
const report=await page.evaluate(async()=>{
 const check=(x,m)=>{if(!x)throw Error(m)};
 function fixture(degrees,shape='long'){
  const result={width:600,height:600,target:'Korean',regions:[]},side=300,runs=[],c=Math.cos(degrees*Math.PI/180),s=Math.sin(degrees*Math.PI/180);let n=0,l=600,t=600,r=0,b=0;
  for(let y=0;y<side;y++){let start=-1;for(let x=0;x<=side;x++){const px=(x+.5)*2-300,py=(y+.5)*2-300,u=px*c+py*s,v=-px*s+py*c;const on=x<side&&Math.abs(u)<(shape==='square'?55:150)&&Math.abs(v)<(shape==='square'?55:16);if(on){n++;l=Math.min(l,x*2);t=Math.min(t,y*2);r=Math.max(r,(x+1)*2);b=Math.max(b,(y+1)*2);}if(on&&start<0)start=x;if(!on&&start>=0){runs.push(y*side+start,x-start);start=-1;}}}
  const bbox=[l,t,r,b],region={id:1,type:'effect',bbox,box:[180,180,420,420],text:'原文',translation:'콰앙!',mode:'replace',fontSize:24,hitMask:{version:1,kind:'detector-text-region',imageWidth:600,imageHeight:600,width:side,height:side,sourceBox:bbox,sourceText:'原文',runs,pixels:n}};result.regions=[region];return result;
 }
 const estimates=[];for(const degrees of [-30,-15,0,15,30,90]){const f=fixture(degrees),a=MangaRotation.estimate(f.regions[0],f);check(Math.abs(a-(degrees===90?0:degrees))<2,'Wrong source direction '+degrees+': '+a);estimates.push({degrees,angle:a});}
 const square=fixture(20,'square');check(MangaRotation.estimate(square.regions[0],square)===0,'Square incorrectly rotated');
 const f=fixture(20),before=JSON.stringify(f),shown=MangaRender.presentation(f,'auto');check(Math.abs(shown.regions[0]._rotation-20)<2,'Automatic angle not applied');check(JSON.stringify(f)===before,'Source mutated');
 check(MangaRender.presentation(f,'auto',null,'tooltip',null,true).regions[0]._rotation===undefined,'Lightweight auto rotation');
 const zero=structuredClone(f);zero.regions[0].rotation=0;check(MangaRotation.angle(MangaRender.presentation(zero,'auto').regions[0])===0,'Explicit zero ignored');
 const stale=structuredClone(f);stale.regions[0].text='changed';check(MangaRotation.estimate(stale.regions[0],stale)===0,'Stale source mask accepted');
 const explicit=structuredClone(f);explicit.regions[0].rotation=-25;check(MangaRotation.angle(MangaRender.presentation(explicit,'auto',null,'tooltip',null,true).regions[0])===-25,'Manual angle lost in light mode');
 const old=[100,110,260,210];for(const handle of ['nw','n','ne','e','se','s','sw','w']){const resized=MangaRotation.resize(old,30,handle,20,15);check(resized[2]-resized[0]>=12&&resized[3]-resized[1]>=12,'Resize inverted');const p=MangaRotation.corners(old,30),q=MangaRotation.corners(resized,30);const fixed=handle==='nw'?2:handle==='ne'?3:handle==='se'?0:handle==='sw'?1:null;if(fixed!==null)check(Math.hypot(p[fixed][0]-q[fixed][0],p[fixed][1]-q[fixed][1])<.001,'Opposite corner moved '+handle);}
 const white=document.createElement('canvas');white.width=600;white.height=600;white.getContext('2d').fillStyle='#aaa';white.getContext('2d').fillRect(0,0,600,600);const image=white.toDataURL(),canvas=document.querySelector('canvas');await MangaRender.render(canvas,shown,image,image);const auto=canvas.toDataURL();const saved=MangaRender.editedBase(shown,f);check(!saved.regions[0]._rotation&&!saved.regions[0].automaticRotation,'Transient rotation persisted');check(JSON.stringify(saved.regions[0].box)===JSON.stringify(f.regions[0].box),'Automatic box persisted');
 await MangaRender.render(canvas,MangaRender.presentation(JSON.parse(JSON.stringify(saved)),'auto'),image,image);check(auto===canvas.toDataURL(),'Rotation changed on reload/export');
 // Box fallback must preserve the original pixels of another tooltip region.
 const effect={...f.regions[0],bbox:[100,100,350,350],box:[100,100,350,350],mode:'white',displayOverride:true,rotation:0,whiteBackground:{kind:'box'}},peer={id:2,type:'text',bbox:[110,110,160,160],box:[110,110,160,160],text:'other',translation:'',mode:'tooltip'};
 const protectedResult={width:600,height:600,regions:[effect,peer]};await MangaRender.render(canvas,protectedResult,image,image);const ctx=canvas.getContext('2d');check(ctx.getImageData(120,120,1,1).data[0]===170,'Other dialogue painted white');check(ctx.getImageData(180,180,1,1).data[0]===255,'Own box not painted');
 const deleted={...protectedResult,regions:[effect],preservedRegions:[peer]};await MangaRender.render(canvas,deleted,image,image);check(canvas.getContext('2d').getImageData(120,120,1,1).data[0]===170,'Deleted original region erased');
 // Explicit safe bubble fill accepts an effect only with full containment and no peers.
 const bubble={width:60,height:60,runs:[],confidence:.99};for(let y=8;y<38;y++)bubble.runs.push(y*60+8,30);
 check(MangaRender.whiteBackground({width:600,height:600,regions:[effect]},effect,{width:600,height:600,bubbles:[bubble]}).kind==='bubble','Safe manual effect bubble denied');
 let blocked=false;try{MangaRender.whiteBackground(protectedResult,effect,{width:600,height:600,bubbles:[bubble]});}catch(e){blocked=e.code==='NO_SAFE_BUBBLE';}check(blocked,'Occupied bubble permitted');
 const protectedAuto=fixture(20);protectedAuto.regions.push({...peer,bbox:[180,180,420,420],box:[180,180,420,420]});check(!MangaRender.presentation(protectedAuto,'auto').regions[0]._rotation,'Auto rotated into neighbor');
 await MangaRender.render(canvas,shown,image,image);return {estimates,automatic:true,manual:true,resizeAnchors:true,lightweight:true,saveReloadExport:true,neighborProtection:true};
});console.log(JSON.stringify(report));if(process.env.MANGA_EVIDENCE){fs.mkdirSync(process.env.MANGA_EVIDENCE,{recursive:true});await page.screenshot({path:path.join(process.env.MANGA_EVIDENCE,'rotation.png')});}assert.equal(report.automatic,true);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
