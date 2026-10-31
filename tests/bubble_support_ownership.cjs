const assert=require('node:assert/strict'),path=require('node:path');const {chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
(async()=>{const browser=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:true});try{const page=await browser.newPage();await page.addScriptTag({path:path.resolve(__dirname,'../extension/render.js')});const report=await page.evaluate(()=>{
 const runs=(x,y,w,h)=>Array.from({length:h},(_,i)=>[(y+i)*40+x,w]).flat();
 const mask=(box,r)=>({version:1,kind:'detector-support',imageWidth:400,imageHeight:400,width:40,height:40,sourceBox:[...box],pixels:r.filter((_,i)=>i%2).reduce((a,b)=>a+b,0),runs:r});
 const support=(box,r)=>({bbox:box,type:'text',confidence:.9,inside:1,interior:1,glyphMask:mask(box,r)});
 const a=[50,50,70,90],b=[130,110,150,150],merged=[50,50,150,150];
 const result={width:400,height:400,regions:[a,b].map((box,i)=>({id:i,type:'text',bbox:box,box,mode:'replace',fontSize:20,text:'source'+i,translation:'Text'}))};
 const geometry={width:400,height:400,bubbles:[{bbox:[20,20,200,200],confidence:1,width:40,height:40,runs:runs(2,2,18,18),supports:[support(a,runs(5,5,2,4)),support(b,runs(13,11,2,4)),support(merged,[...runs(5,5,2,4),...runs(13,11,2,4)])]}]};
 const tests=[];function check(name,modify,expected){const r=structuredClone(result),g=structuredClone(geometry);modify?.(r,g);const before=JSON.stringify({r,g}),out=MangaRender.presentation(r,'white',g);const actual=out.regions.every(x=>x.mode==='white');tests.push({name,ok:actual===expected&&before===JSON.stringify({r,g}),actual});}
 check('two recognized masks cover merged detection',null,true);
 check('legacy lacks mask',(r,g)=>delete g.bubbles[0].supports[2].glyphMask,false);
 check('wrong source box',(r,g)=>g.bubbles[0].supports[2].glyphMask.sourceBox[0]++,false);
 check('wrong page dimensions',(r,g)=>g.bubbles[0].supports[2].glyphMask.imageWidth++,false);
 check('invalid pixel count',(r,g)=>g.bubbles[0].supports[2].glyphMask.pixels++,false);
 check('overlapping runs',(r,g)=>g.bubbles[0].supports[2].glyphMask.runs.splice(2,0,205,2),false);
 check('unknown isolated glyph',(r,g)=>{const m=g.bubbles[0].supports[2].glyphMask;m.runs.splice(8,0,9*40+9,1);m.pixels++;},false);
 check('nearby unknown exceeds coverage',(r,g)=>{const m=g.bubbles[0].supports[2].glyphMask;m.runs[1]=4;m.pixels+=2;},false);
 check('one-cell rounding',(r,g)=>{const m=g.bubbles[0].supports[2].glyphMask;m.runs[1]=3;m.pixels++;},false);
 // 16 source pixels allow no rounding under the95%coveragefloor.
 check('bounded edge rounding with sufficient coverage',(r,g)=>{const a=[50,50,90,130],b=[130,110,170,190],m=[50,50,170,190];r.regions.forEach((v,i)=>{v.bbox=i?b:a;v.box=[...v.bbox]});const merged=[...runs(5,5,4,8),...runs(13,11,4,8)];const pairs=[];for(let i=0;i<merged.length;i+=2)pairs.push(merged.slice(i,i+2));pairs.sort((a,b)=>a[0]-b[0]);pairs[0][1]++;g.bubbles[0].supports=[support(a,runs(5,5,4,8)),support(b,runs(13,11,4,8)),support(m,pairs.flat())];},true);
 check('one missing owner',(r,g)=>delete g.bubbles[0].supports[0].glyphMask,false);
 check('manual owner',(r,g)=>r.regions[0].manual=true,false);
 check('edited owner',(r,g)=>r.regions[0].layoutOverride=true,false);
 check('source bbox changed',(r,g)=>r.regions[0].bbox=[51,50,70,90],false);
 check('effect support cannot be waived',(r,g)=>g.bubbles[0].supports[2].type='effect',false);
 check('oversized grid',(r,g)=>g.bubbles[0].supports[2].glyphMask.width=513,false);
 check('invalid version',(r,g)=>g.bubbles[0].supports[2].glyphMask.version=2,false);
 const nested=(r,g)=>{r.regions=[{...r.regions[0],bbox:merged,box:merged}];g.bubbles[0].supports=[support(merged,[...runs(5,5,2,4),...runs(13,11,2,4)]),support(a,runs(5,5,2,4))];};
 check('single owner fully contains nested support',nested,true);
 check('single owner unknown pixel',(r,g)=>{nested(r,g);const m=g.bubbles[0].supports[1].glyphMask;m.runs[1]++;m.pixels++;},false);
 check('single owner lacks mask',(r,g)=>{nested(r,g);delete g.bubbles[0].supports[0].glyphMask;},false);
 check('single owner manual edit',(r,g)=>{nested(r,g);r.regions[0].manual=true;},false);
 check('single owner stale bbox',(r,g)=>{nested(r,g);r.regions[0].bbox=[51,50,150,150];},false);
 return tests;
 });assert(report.every(x=>x.ok),JSON.stringify(report.filter(x=>!x.ok)));console.log(JSON.stringify({ok:true,checks:report.length,browser:browser.version()}));}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
