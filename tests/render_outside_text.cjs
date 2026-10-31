const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
(async()=>{
 const browser=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:true});
 try{
  const page=await browser.newPage();await page.setContent('<body></body>');await page.addScriptTag({path:path.resolve(__dirname,'../extension/render.js')});
  const report=await page.evaluate(async()=>{
   const ensure=(condition,message)=>{if(!condition)throw Error(message);};let cases=0;
   const fixture=()=>({width:720,height:1000,regions:[{id:1,type:'text',bbox:[100,300,220,450],box:[100,300,220,450],text:'Outside dialogue',translation:'말풍선 밖의 생각입니다.',fontSize:32,mode:'tooltip'}]});
   const geometry={version:3,width:720,height:1000,bubbles:[]};
   for(const translation of ['말풍선 밖의 생각입니다.','A thought outside a balloon.','这是气泡外的独白。','これは心の声です。','¡Un pensamiento!','Um pensamento.']){
    const result=fixture();result.regions[0].translation=translation;const before=JSON.stringify(result),shown=MangaRender.presentation(result,'auto',geometry,'white');
    ensure(shown.regions[0].automaticOutside&&MangaRender.direct(shown.regions[0]),'Outside translation did not fit: '+translation);
    ensure(JSON.stringify(result)===before,'Saved result mutated');
    ensure(JSON.stringify(MangaRender.presentation(result,'auto',geometry,'tooltip'))===before,'Off switch changed result');
    const edited=MangaRender.editedBase(shown,result);ensure(JSON.stringify(edited)===before,'Automatic white presentation persisted');cases++;
   }
   for(const mutation of ['effect','manual','displayOverride','ocrTruncated','truncated','original','empty','untranslated','alreadyDirect','tooLong','oversize','invalid','overlap','deletedPeer','manualLayoutOverlap']){
    const result=fixture(),region=result.regions[0];
    if(mutation==='effect')region.type='effect';else if(mutation==='original')region.mode='original';else if(mutation==='empty')region.text='';else if(mutation==='untranslated')region.translation='';else if(mutation==='alreadyDirect')region.mode='replace';else if(mutation==='tooLong')region.translation='Too long '.repeat(1000);else if(mutation==='oversize')region.bbox=[0,0,700,500];else if(mutation==='invalid')region.box=[-10,0,100,100];
    else if(mutation==='overlap')result.regions.push({...region,id:2,type:'effect',bbox:[200,440,260,480],box:[200,440,260,480]});
    else if(mutation==='deletedPeer')result.preservedRegions=[{bbox:[200,440,260,480]}];
    else if(mutation==='manualLayoutOverlap'){region.layoutOverride=true;region.box=[100,300,300,500];result.regions.push({...region,id:2,type:'effect',bbox:[280,480,320,550],box:[280,480,320,550]});}
    else region[mutation]=true;
    ensure(!MangaRender.presentation(result,'auto',geometry,'white').regions[0].automaticOutside,'Protected region changed: '+mutation);cases++;
   }
   const runs=[];for(let row=25;row<50;row++)runs.push(row*72+5,25);
   const bubble={bbox:[50,250,300,500],width:72,height:100,runs,confidence:.96};
   for(const changed of [undefined,{...geometry,width:719},{...geometry,bubbles:[bubble]},{...geometry,bubbles:[{...bubble,runs:[100,200,150,20]}]}]){
    ensure(!MangaRender.presentation(fixture(),'auto',changed,'white').regions[0].automaticOutside,'Missing/unsafe/bubble geometry treated as outside');cases++;
   }
   const result=fixture(),shown=MangaRender.presentation(result,'auto',geometry,'white');
   const changed=structuredClone(shown);changed.regions[0].displayOverride=true;changed.regions[0].mode='tooltip';
   const manual=MangaRender.editedBase(changed,result);ensure(MangaRender.presentation(manual,'white',geometry,'white').regions[0].mode==='tooltip','Manual tooltip overridden');cases++;
   const source=document.createElement('canvas');source.width=720;source.height=1000;const surface=source.getContext('2d');surface.fillStyle='#567';surface.fillRect(0,0,720,1000);const original=source.toDataURL();surface.fillStyle='#f00';surface.fillRect(0,0,720,1000);const clean=source.toDataURL();
   const canvas=document.createElement('canvas');await MangaRender.render(canvas,shown,original,clean);const pixels=canvas.getContext('2d').getImageData(0,0,720,1000).data;
   for(let y=0;y<1000;y++)for(let x=0;x<720;x++)if(x<96||x>=224||y<296||y>=454){const offset=(y*720+x)*4;ensure(pixels[offset]===85&&pixels[offset+1]===102&&pixels[offset+2]===119,'Background outside text card altered');}
   await MangaRender.render(canvas,MangaRender.presentation(result,'auto',geometry,'tooltip'),original,clean);ensure(canvas.toDataURL()===original,'Tooltip did not restore original image');cases++;
   return {cases,multilingual:true,protectedEffectsAndEdits:true,geometryRequired:true,collisionGuard:true,basePreserved:true,offRestoresOriginal:true,outsidePixelsUnchanged:true};
  });assert(report.cases>=25);console.log(JSON.stringify({ok:true,browser:browser.version(),...report}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
