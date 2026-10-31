const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
(async()=>{
 const browser=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:true});
 try{
  const page=await browser.newPage();await page.setContent('<body></body>');await page.addScriptTag({path:path.resolve(__dirname,'../extension/render.js')});
  const checked=await page.evaluate(async()=>{
   const ensure=(condition,message)=>{if(!condition)throw Error(message);},overlap=(first,second)=>Math.max(0,Math.min(first[2],second[2])-Math.max(first[0],second[0]))*Math.max(0,Math.min(first[3],second[3])-Math.max(first[1],second[1]));
   const context=document.createElement('canvas').getContext('2d'),translations=['읽기 쉬운 번역문입니다!','A readable translation, with punctuation!','これは長い台詞です。','👩🏽‍🚀 café\n새로운 문장?!'];
   let cases=0;
   function fixture(scale,shape,count){
    const side=100,bits=new Uint8Array(side*side),runs=[];
    for(let row=15;row<55;row++)for(let column=15;column<65;column++){
     const horizontal=(column-40)/25,vertical=(row-35)/20;
     bits[row*side+column]=shape==='rectangle'||(shape==='ellipse'?horizontal**2+vertical**2<1:Math.abs(horizontal)<.9-Math.abs(vertical)*.15);
    }
    for(let offset=0;offset<bits.length;){if(!bits[offset]){offset++;continue;}const start=offset;while(bits[offset])offset++;runs.push(start,offset-start);}
    const box=[150,150,650,550].map(value=>value*scale),regions=[];
    for(let index=0;index<count;index++){const left=(count===1?330:260+index*110)*scale,top=300*scale,bbox=[left,top,left+35*scale,top+45*scale];regions.push({id:index+1,type:'text',bbox,box:[...bbox],mode:index%2?'replace':'tooltip',fontSize:24,text:'Original '+index,translation:translations[index%translations.length]});}
    return {result:{width:1000*scale,height:1000*scale,regions},geometry:{version:2,width:1000*scale,height:1000*scale,bubbles:[{width:side,height:side,runs,bbox:box,confidence:.96}]}};
   }
   for(const scale of [.72,1,2])for(const shape of ['rectangle','ellipse','irregular'])for(const count of [1,2,3]){
    const {result,geometry}=fixture(scale,shape,count),before=JSON.stringify(result),shown=MangaRender.presentation(result,'white',geometry);
    ensure(JSON.stringify(result)===before,'Base mutated');ensure(shown.regions.every(region=>region.mode==='white'),'Eligible group was rejected');
    for(const region of shown.regions){
     ensure(MangaRender.coverage(region.whiteBackground,shown,region.box)>=.98,'Layout left the bubble');
     const layout=MangaRender.textLayout(region);ensure(layout&&layout.fontSize>=8,'No readable fit');context.font=`600 ${layout.fontSize}px "Noto Sans CJK KR", "Malgun Gothic", sans-serif`;
     ensure(layout.lines.every(line=>context.measureText(line).width<=region.box[2]-region.box[0]-4),'Horizontal clipping');ensure(layout.height<=region.box[3]-region.box[1]-4,'Vertical clipping');
     ensure(layout.metrics.every(metric=>metric.width<=region.box[2]-region.box[0]-4&&metric.ascent+metric.descent<=metric.height),'Actual glyph bounds clipped');
     ensure(layout.lines.every(line=>!/^\s*[,.;:!?。？！]/u.test(line)),'Punctuation alone at line start');
     ensure(shown.regions.every(other=>other===region||overlap(other.box,region.box)===0),'Translations overlap');
    }
    const edited=structuredClone(shown);edited.regions[0].translation='Edited text';const base=MangaRender.editedBase(edited,result);ensure(JSON.stringify(base.regions[0].box)===JSON.stringify(result.regions[0].box),'Automatic layout baked into base');
    edited.regions[0].layoutOverride=true;ensure(JSON.stringify(MangaRender.editedBase(edited,result).regions[0].box)===JSON.stringify(edited.regions[0].box),'Manual layout lost');
    cases++;
   }
   for(const mutation of ['original','manual','displayOverride','empty','untranslated','truncated','ocrTruncated','deleted','unknown']){
    const {result,geometry}=fixture(1,'rectangle',2),peer=result.regions[1];
    if(mutation==='original')peer.mode='original';else if(mutation==='empty')peer.text='';else if(mutation==='untranslated')peer.translation='';else if(mutation==='deleted'){result.regions.pop();result.preservedRegions=[peer];}else if(mutation==='unknown'){result.regions.pop();geometry.bubbles[0].supports=[{bbox:peer.bbox,confidence:.9,inside:1,interior:1}];}else peer[mutation]=true;
    const shown=MangaRender.presentation(result,'white',geometry);ensure(shown.regions.every(region=>region.mode!=='white'),'Protected dialogue erased: '+mutation);cases++;
   }
   for(const verified of [false,true]){
    const {result,geometry}=fixture(1,'ellipse',1),bubble=geometry.bubbles[0],region=result.regions[0];region.type='effect';bubble.confidence=.7;bubble.verifiedWhite=verified;bubble.supports=[{bbox:region.bbox,confidence:.9,inside:1,interior:1}];
    ensure((MangaRender.presentation(result,'white',geometry).regions[0].mode==='white')===verified,'Effect promotion without closed white evidence');cases++;
   }
   const unsupported=fixture(1,'ellipse',1);unsupported.geometry.bubbles[0].confidence=.8;ensure(MangaRender.presentation(unsupported.result,'white',unsupported.geometry).regions[0].mode==='tooltip','Unsupported low confidence accepted');
   for(const mutation of ['none','bubble','text','interior','confidence','large']){
    const detail=fixture(1,'rectangle',1),region=detail.result.regions[0],bubble=detail.geometry.bubbles[0];region.type='effect';region.translation='확인';region.bbox=[180,185,200,205];region.box=[...region.bbox];bubble.bbox=[150,150,250,250];bubble.confidence=.7;bubble.verifiedWhite=false;bubble.detailVerified=true;bubble.runs=[];
    for(let row=15;row<25;row++)bubble.runs.push(row*100+15,10);
    const support={bbox:region.bbox,confidence:.4,inside:1,interior:1,detailVerified:true};bubble.supports=[support];
    if(mutation==='bubble')bubble.detailVerified=false;else if(mutation==='text')support.detailVerified=false;else if(mutation==='interior')support.interior=.97;else if(mutation==='confidence')support.confidence=.34;else if(mutation==='large')bubble.bbox=[100,100,300,300];
    ensure((MangaRender.presentation(detail.result,'white',detail.geometry).regions[0].mode==='white')===(mutation==='none'),'Unverified detail promoted: '+mutation);cases++;
   }
   for(const interior of [.97,1]){
    const padded=fixture(1,'rectangle',1),region=padded.result.regions[0],bubble=padded.geometry.bubbles[0];region.bbox=[140,300,240,345];region.box=[...region.bbox];bubble.confidence=.8;bubble.supports=[{bbox:region.bbox,confidence:.9,inside:1,interior}];
    ensure((MangaRender.presentation(padded.result,'white',padded.geometry).regions[0].mode==='white')===(interior===1),'Empty bounding-box padding overruled actual text support');cases++;
   }
   const tapered=fixture(1,'rectangle',1),taperedBubble=tapered.geometry.bubbles[0],taperedRegion=tapered.result.regions[0];taperedBubble.runs=[];taperedBubble.bbox=[150,150,650,700];
   for(let row=15;row<70;row++)taperedBubble.runs.push(row*100+(row<32?15:25),row<32?50:30);
   taperedRegion.bbox=[330,420,370,600];taperedRegion.box=[...taperedRegion.bbox];taperedRegion.translation='아직 안 끝났어!!';
   const centered=MangaRender.presentation(tapered.result,'white',tapered.geometry).regions[0];ensure(centered.mode==='white'&&(centered.box[1]+centered.box[3])/2>400,'Text drifted into the wider top of a tapered bubble');cases++;
   const invalid=fixture(1,'rectangle',1);invalid.geometry.bubbles[0].runs=[100,200,150,30];ensure(MangaRender.presentation(invalid.result,'white',invalid.geometry).regions[0].mode==='tooltip','Invalid mask accepted');
   const long=fixture(1,'ellipse',2);long.result.regions[1].translation='너무 긴 대사 '.repeat(2000);ensure(MangaRender.presentation(long.result,'white',long.geometry).regions.every(region=>region.mode!=='white'),'Unfittable peer was erased');
   const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=1000;const surface=canvas.getContext('2d');surface.fillStyle='#678';surface.fillRect(0,0,1000,1000);const original=canvas.toDataURL();surface.fillStyle='#f00';surface.fillRect(0,0,1000,1000);const clean=canvas.toDataURL();
   const sample=fixture(1,'ellipse',2),shown=MangaRender.presentation(sample.result,'white',sample.geometry);await MangaRender.render(canvas,shown,original,clean);const pixels=surface.getImageData(0,0,1000,1000).data;
   for(let row=0;row<1000;row++)for(let column=0;column<1000;column++)if(column<140||column>660||row<140||row>560){const offset=(row*1000+column)*4;ensure(pixels[offset]===102&&pixels[offset+1]===119&&pixels[offset+2]===136,'Pixels outside bubble changed');}
   const empty={width:1000,height:1000,regions:[{...sample.result.regions[0],mode:'replace',translation:''}]};await MangaRender.render(canvas,empty,original,clean);ensure(canvas.toDataURL()===original,'Empty translation erased original');
   return {cases:cases+5,shapes:3,scales:3,multilingual:true,groups:true,protectedText:true,fit:true,outsidePixelsUnchanged:true,paddedTextMask:true,taperedBubbleCenter:true};
  });
  assert(checked.cases>40);console.log(JSON.stringify({ok:true,browser:browser.version(),...checked}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
