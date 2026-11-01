(() => {
if(globalThis.MangaRender)return;
const image=src=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error('이미지 로드 실패'));i.src=src;});
const direct=region=>['replace','white','restore'].includes(region.mode)&&!!region.translation?.trim()&&!!textLayout(region);
let manualAssetLoader;
const manualImages=new WeakMap();
function setAssetLoader(loader){manualAssetLoader=loader;}
function checkedManual(ref,result){
 if(ref?.version!==1||ref.width!==result.width||ref.height!==result.height||!/^manual-[0-9a-f]{32}\.png$/.test(ref.asset)||!/^[0-9a-f-]{36}$/.test(ref.job))throw Error('수동 복원 정보가 올바르지 않습니다. 다시 복원하세요.');
 restorationMaskCanvas(ref.mask,result);if(!ref.mask.runs.length)throw Error('지울 영역이 비어 있습니다.');return ref;
}
async function manualImage(ref,result){
 checkedManual(ref,result);if(!manualAssetLoader)throw Error('수동 복원 이미지를 불러올 수 없습니다. 편집기를 다시 여세요.');
 let saved=manualImages.get(ref);if(!saved||saved.asset!==ref.asset||saved.job!==ref.job){saved={asset:ref.asset,job:ref.job,promise:Promise.resolve().then(()=>manualAssetLoader(ref.job,ref.asset)).then(image)};manualImages.set(ref,saved);saved.promise.catch(()=>{if(manualImages.get(ref)===saved)manualImages.delete(ref);});}return saved.promise;
}
const masks=new WeakMap();
function whiteMask(background){
 if(masks.has(background))return masks.get(background);
 const {width,height,runs}=background;
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>512||height>512||!Array.isArray(runs)||runs.length%2||runs.length>width*height*2)throw Error('말풍선 경계 정보가 올바르지 않습니다.');
 const bits=new Uint8Array(width*height),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const context=canvas.getContext('2d');context.fillStyle='#fff';let end=0;
 for(let index=0;index<runs.length;index+=2){
  const start=runs[index],length=runs[index+1];
  if(!Number.isInteger(start)||!Number.isInteger(length)||start<end||length<1||start+length>bits.length)throw Error('말풍선 경계 정보가 올바르지 않습니다.');
  end=start+length;bits.fill(1,start,end);
  for(let position=start;position<end;){const column=position%width,count=Math.min(width-column,end-position);context.fillRect(column,Math.floor(position/width),count,1);position+=count;}
 }
 const value={bits,canvas,width,height,area:bits.reduce((sum,value)=>sum+value,0)/(width*height)};masks.set(background,value);return value;
}
function coverage(background,result,box){
 const mask=whiteMask(background);
 const left=Math.max(0,Math.floor(box[0]*mask.width/result.width)),top=Math.max(0,Math.floor(box[1]*mask.height/result.height));
 const right=Math.min(mask.width,Math.ceil(box[2]*mask.width/result.width)),bottom=Math.min(mask.height,Math.ceil(box[3]*mask.height/result.height));
 let inside=0,total=0;
 for(let row=top;row<bottom;row++)for(let column=left;column<right;column++){total++;inside+=mask.bits[row*mask.width+column];}
 return total?inside/total:0;
}
function whiteBackground(result,region,geometry){
 if(geometry.width!==result.width||geometry.height!==result.height||!Array.isArray(geometry.bubbles))throw Error('말풍선 경계와 이미지 크기가 다릅니다.');
 if(region.type==='effect')throw Error('효과음은 말풍선 내부를 자동으로 채우지 않습니다. 흰 배경 범위에서 글상자를 선택하세요.');
 const area=background=>background.runs.filter((value,index)=>index%2).reduce((sum,length)=>sum+length,0)/(background.width*background.height);
 const candidates=geometry.bubbles.filter(background=>background.confidence>=.85&&coverage(background,result,region.bbox)>=.98&&coverage(background,result,region.box)>=.98&&area(background)<=.4).sort((left,right)=>area(left)-area(right));
 const background=candidates[0];
 if(!background)throw Error('안전하게 채울 말풍선 경계를 찾지 못했습니다. 흰 배경 범위를 글상자로 바꾸거나 툴팁을 사용하세요.');
 if(result.regions.some(other=>other!==region&&other.text?.trim()&&coverage(background,result,other.bbox)>=.5))throw Error('같은 말풍선에 다른 글자가 있습니다. 다른 대사를 가리지 않도록 흰 배경 범위를 글상자로 선택하세요.');
 return {...background,kind:'bubble'};
}
const confirmedPanel=region=>!region.panelCandidate||(region.textVerification?.version===1&&['ocr-consensus','ocr-context'].includes(region.textVerification.method)&&['LABEL','DIALOGUE'].includes(region.textVerification.role)&&Array.isArray(region.textVerification.sources)&&region.textVerification.sources.length>0);
function punctuationMismatch(region,result){
 const p=region.punctuationMismatch,b=region.bbox;
 if(!p||p.version!==1||p.method!=='non-dot-connected-strokes'||p.id!==region.id||p.sourceText!==region.text||region.type!=='text'||region.textVerification||['manual','layoutOverride','displayOverride','ocrTruncated','truncated','panelCandidate'].some(k=>region[k])||!/^([.．・·…⋯\s])+$/.test(region.text||''))return false;
 if(!Array.isArray(b)||b.length!==4||!b.every(Number.isFinite)||!Array.isArray(p.sourceBox)||p.sourceBox.length!==4||!b.every((v,i)=>v===p.sourceBox[i])||!Number.isFinite(region.detectorConfidence)||Math.abs(region.detectorConfidence-p.sourceConfidence)>.0001||!Number.isFinite(p.sourceConfidence)||p.sourceConfidence<.2||p.sourceConfidence>1)return false;
 if(result&&(p.imageWidth!==result.width||p.imageHeight!==result.height))return false;
 const axis=Math.max(b[2]-b[0],b[3]-b[1]);
 return Array.isArray(p.evidence)&&p.evidence.length===3&&p.evidence.every((e,i)=>{const c=e.componentBox;if(e.threshold!==[80,128,176][i]||!Number.isInteger(e.totalInk)||e.totalInk<16||!Number.isInteger(e.componentInk)||e.componentInk<e.totalInk*.5||e.componentInk>e.totalInk||!Array.isArray(c)||c.length!==4||!c.every(Number.isFinite))return false;const a=c[2]-c[0],b=c[3]-c[1];return Math.min(a,b)>0&&Math.max(a,b)>=axis*.65&&Math.max(a,b)>=Math.min(a,b)*2.5;});
}
const whiteCandidate=region=>!region.automaticPunctuation&&confirmedPanel(region)&&['tooltip','replace'].includes(region.mode)&&['text','effect'].includes(region.type)&&!region.manual&&!region.displayOverride&&!region.truncated&&!region.ocrTruncated&&!!region.text?.trim()&&!!region.translation?.trim();
const intersection=(left,right)=>Math.max(0,Math.min(left[2],right[2])-Math.max(left[0],right[0]))*Math.max(0,Math.min(left[3],right[3])-Math.max(left[1],right[1]));
const boxArea=box=>Math.max(0,box[2]-box[0])*Math.max(0,box[3]-box[1]);
const validBox=(box,result)=>Array.isArray(box)&&box.length===4&&box.every(Number.isFinite)&&box[0]>=0&&box[1]>=0&&box[2]<=result.width&&box[3]<=result.height&&boxArea(box)>0;
const textContext=document.createElement('canvas').getContext('2d');
const font=points=>`600 ${points}px "Noto Sans CJK KR", "Malgun Gothic", sans-serif`;
const graphemes=new Intl.Segmenter(undefined,{granularity:'grapheme'});
const layouts=new WeakMap();
const closing=/^[,.;:!?…、。，．？！：；％%°)\]}>»”’」』】〕〉》☆♡♥]+$/u;
// Caches live for one synchronous presentation only: font loading or edits
// on later calls cannot reuse stale metrics. Bounds prevent large captions
// from retaining an unbounded number of layout candidates.
let presentationMeasures=null,presentationWraps=null,presentationSegments=null;
function measureText(context,text){
 if(!presentationMeasures)return context.measureText(text);
 let cache=presentationMeasures.get(context.font);
 if(!cache&&presentationMeasures.size<64){cache=new Map();presentationMeasures.set(context.font,cache);}
 if(cache?.has(text))return cache.get(text);
 const value=context.measureText(text);
 if(cache&&cache.size<2048)cache.set(text,value);
 return value;
}
function textSegments(text){
 if(presentationSegments?.has(text))return presentationSegments.get(text);
 const value=[...graphemes.segment(text)].map(item=>item.segment);
 if(presentationSegments&&presentationSegments.size<2048)presentationSegments.set(text,value);
 return value;
}
function wrapText(context,text,width,keepHangul=true){
 if(!presentationWraps)return wrapTextUncached(context,text,width,keepHangul);
 const key=JSON.stringify([context.font,text,width,keepHangul]);
 if(presentationWraps.has(key))return presentationWraps.get(key);
 const value=wrapTextUncached(context,text,width,keepHangul);
 if(presentationWraps.size<2048)presentationWraps.set(key,value);
 return value;
}
function wrapTextUncached(context,text,width,keepHangul=true){
 const lines=[];let breaks=0,grouped=false;
 for(const paragraph of text.replace(/\r\n?/g,'\n').split('\n')){
  let line='';
  for(const word of paragraph.trim().split(/\s+/u).filter(Boolean)){
   const joined=line?line+' '+word:word;
   if(measureText(context,joined).width<=width){line=joined;continue;}
   if(closing.test(word)&&line){line+=word;continue;}
   if(line){lines.push(line);line='';}
   if(measureText(context,word).width<=width){line=word;continue;}
   const units=[];
   // Keep fitting Hangul, Latin and numeric runs intact without splitting grapheme clusters.
   const clusters=textSegments(word),parts=[];
   for(let index=0;index<clusters.length;){
    const first=clusters[index++],hangul=keepHangul&&/^\p{Script=Hangul}\p{M}*$/u.test(first),latin=/^\p{Script=Latin}\p{M}*$/u.test(first),numeric=/^\p{N}$/u.test(first);let part=first;
    while(index<clusters.length){
     if(hangul&&/^\p{Script=Hangul}\p{M}*$/u.test(clusters[index])||latin&&/^\p{Script=Latin}\p{M}*$/u.test(clusters[index])||numeric&&/^\p{N}$/u.test(clusters[index]))part+=clusters[index++];
     else if(numeric&&/^[.,]$/.test(clusters[index])&&/^\p{N}$/u.test(clusters[index+1]||'')){part+=clusters[index++]+clusters[index++];}
     else break;
    }
    parts.push(part);if(hangul&&part.length>first.length&&measureText(context,part).width<=width)grouped=true;
   }
   for(const part of parts){
    const segments=measureText(context,part).width<=width?[part]:textSegments(part);
    for(const segment of segments){if(closing.test(segment)&&units.length)units[units.length-1]+=segment;else units.push(segment);}
   }
   for(const unit of units){if(line&&measureText(context,line+unit).width>width){lines.push(line);if(!/^\p{Pd}+$/u.test(line))breaks++;line='';}line+=unit;}
  }
  lines.push(line);
 }
 return {lines,breaks,grouped};
}
function textLayout(region,box=region.box,maximum=region.fontSize||24,minimum=8){
 if(!Array.isArray(box)||box.length!==4||!box.every(Number.isFinite)||typeof region.translation!=='string')return null;
 const requestedMaximum=Number.isFinite(region.automaticFontMaximum)?Math.max(maximum,region.automaticFontMaximum):maximum;
 const key=[...box,maximum,minimum,requestedMaximum,region.translation,!!region.manual,!!region.layoutOverride,!!region.displayOverride].join('\u0000'),cached=layouts.get(region);
 if(cached?.key===key)return cached.value;
 const width=box[2]-box[0]-4,height=box[3]-box[1]-4;
 if(width<=0||height<=0||region.translation.length>8192)return null;
 let best=null;
 for(let points=Math.min(256,Math.floor(maximum));points>=minimum;points--){
  textContext.font=font(points);const primary=wrapText(textContext,region.translation,width);
  // A fitting word must not force a much smaller paragraph. Retain the
  // previous grapheme layout as an alternative at the same measured font.
  for(const wrapped of primary.grouped?[primary,wrapText(textContext,region.translation,width,false)]:[primary]){
  const metrics=wrapped.lines.map(line=>{
   const measured=measureText(textContext,line),left=measured.actualBoundingBoxLeft,right=measured.actualBoundingBoxRight,ascent=measured.actualBoundingBoxAscent,descent=measured.actualBoundingBoxDescent;
   return {left,right,ascent,descent,width:Math.max(measured.width,left+right),height:Math.max(points*1.22,ascent+descent)};
  });
  const totalHeight=metrics.reduce((sum,metric)=>sum+metric.height,0);
  if(totalHeight>height||metrics.some(metric=>metric.width>width))continue;
  const layout={lines:wrapped.lines,breaks:wrapped.breaks,fontSize:points,height:totalHeight,metrics};
  if(!best||points===best.fontSize&&layout.breaks<best.breaks)best=layout;
  if(!wrapped.breaks){
   // Automatic text can trade at most a quarter of its requested size for whole words.
   // Keep already reduced captions and explicit edits on the established fitting rule.
   const wholeWords=!region.manual&&!region.layoutOverride&&!region.displayOverride&&points>=best.fontSize*.75&&points>=Math.min(best.fontSize,Math.round(requestedMaximum*.75));
   const singleWord=!region.manual&&!region.layoutOverride&&!region.displayOverride&&/^\p{P}*\p{Script=Latin}[\p{Script=Latin}\p{M}]*(?:['’\-][\p{Script=Latin}\p{M}]+)*\p{P}*$/u.test(region.translation.trim())&&points>=Math.min(best.fontSize,12);
   const value=points>=best.fontSize*.8||wholeWords||singleWord?layout:best;layouts.set(region,{key,value});return value;
  }
  }
 }
 layouts.set(region,{key,value:best});
 return best;
}
function maskRectangles(background,result,limit){
 const mask=whiteMask(background),left=Math.max(0,Math.ceil(limit[0]*mask.width/result.width)),right=Math.min(mask.width,Math.floor(limit[2]*mask.width/result.width));
 const top=Math.max(0,Math.ceil(limit[1]*mask.height/result.height)),bottom=Math.min(mask.height,Math.floor(limit[3]*mask.height/result.height));
 const heights=new Uint16Array(mask.width),buckets=new Map();
 for(let row=top;row<bottom;row++){
  for(let column=left;column<right;column++)heights[column]=mask.bits[row*mask.width+column]?heights[column]+1:0;
  const stack=[];
  for(let column=left;column<=right;column++){
   const height=column<right?heights[column]:0;let start=column;
   while(stack.length&&stack[stack.length-1].height>height){
    const prior=stack.pop();start=prior.start;
    if(column-prior.start<3||prior.height<3)continue;
    const box=[prior.start*result.width/mask.width,(row+1-prior.height)*result.height/mask.height,column*result.width/mask.width,(row+1)*result.height/mask.height];
    const bucket=Math.round(Math.log((box[2]-box[0])/(box[3]-box[1]))*4),candidates=buckets.get(bucket)||[];
    candidates.push(box);candidates.sort((first,second)=>boxArea(second)-boxArea(first));buckets.set(bucket,candidates.slice(0,3));
   }
   if(height&&(!stack.length||stack[stack.length-1].height<height))stack.push({start,height});
  }
 }
 return [...buckets.values()].flat();
}
function partition(regions,bounds,forcedAxis,cutFraction=.5,options){
 if(regions.length===2){options?.leaves?.push(regions);if(options?.override?.members.every(r=>regions.includes(r)))forcedAxis=options.override.axis;}
 if(regions.length===1)return new Map([[regions[0],bounds]]);
 let best;
 for(const axis of forcedAxis===undefined?[0,1]:[forcedAxis]){
  const sorted=[...regions].sort((first,second)=>(first.bbox[axis]+first.bbox[axis+2])-(second.bbox[axis]+second.bbox[axis+2]));
  for(let index=1;index<sorted.length;index++){
   const before=sorted[index-1],after=sorted[index],centerBefore=(before.bbox[axis]+before.bbox[axis+2])/2,centerAfter=(after.bbox[axis]+after.bbox[axis+2])/2;
   const score=(centerAfter-centerBefore)/(bounds[axis+2]-bounds[axis]);
   if(!best||score>best.score)best={axis,sorted,index,score,cut:centerBefore+(centerAfter-centerBefore)*cutFraction};
  }
 }
 if(!best||best.score<.08)return null;
 const first=[...bounds],second=[...bounds];first[best.axis+2]=best.cut;second[best.axis]=best.cut;
 const leading=partition(best.sorted.slice(0,best.index),first,undefined,.5,options),trailing=partition(best.sorted.slice(best.index),second,undefined,.5,options);
 return leading&&trailing?new Map([...leading,...trailing]):null;
}
function supportFor(background,region){
 return (background.supports||[]).filter(item=>intersection(item.bbox,region.bbox)/Math.max(boxArea(item.bbox),boxArea(region.bbox))>=.75).sort((first,second)=>second.confidence-first.confidence)[0];
}
function bubbleSupport(background,result,region){
 const contained=coverage(background,result,region.bbox),support=supportFor(background,region);
 if(background.detailVerified===true&&support?.detailVerified===true&&background.confidence>=.65&&support.confidence>=.35&&support.inside>=.98&&support.interior>=.98&&contained>=.94&&boxArea(background.bbox)<=result.width*result.height*.025&&boxArea(region.bbox)<=boxArea(background.bbox)*.5)return true;
 if(region.type==='effect')return background.confidence>=.65&&background.verifiedWhite===true&&support?.inside>=.98&&contained>=.94;
 if(background.confidence>=.85&&contained>=.98)return true;
 return background.confidence>=.75&&support?.inside>=.98&&support?.interior>=.98&&contained>=.8;
}
// Raw supports may describe the union of several already recognized labels.
// Accept that union only with independently supplied segmentation evidence.
function duplicateSupport(support,members,background,result){
 if(support.type!=='text'||!members.length)return false;
 const sameBox=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===4&&b.length===4&&a.every((v,i)=>v===b[i]);
 function decode(item){
  const m=item?.glyphMask,w=background.width,h=background.height;
  if(!m||m.version!==1||m.kind!=='detector-support'||m.imageWidth!==result.width||m.imageHeight!==result.height||m.width!==w||m.height!==h||!Number.isInteger(w)||!Number.isInteger(h)||w<3||h<3||w>512||h>512||!validBox(item.bbox,result)||!sameBox(m.sourceBox,item.bbox)||!Array.isArray(m.runs)||m.runs.length%2||m.runs.length>w*h*2||!Number.isInteger(m.pixels)||m.pixels<1)return null;
  const bits=new Uint8Array(w*h);let end=0,count=0;
  for(let i=0;i<m.runs.length;i+=2){
   const start=m.runs[i],length=m.runs[i+1];
   if(!Number.isInteger(start)||!Number.isInteger(length)||start<end||length<1||start+length>bits.length||Math.floor(start/w)!==Math.floor((start+length-1)/w))return null;
   for(let p=start;p<start+length;p++){
    const x=(p%w+.5)*result.width/w,y=(Math.floor(p/w)+.5)*result.height/h;
    if(x<item.bbox[0]||x>=item.bbox[2]||y<item.bbox[1]||y>=item.bbox[3])return null;
    bits[p]=1;
   }
   count+=length;end=start+length;
  }
  return count===m.pixels?bits:null;
 }
 const target=decode(support);if(!target)return false;
 const owners=[];
 for(const member of members){
  if(member.type!=='text'||member.manual||member.layoutOverride||member.displayOverride||member.ocrTruncated||member.truncated)continue;
  const owner=(background.supports||[]).find(s=>s!==support&&s.type==='text'&&sameBox(s.bbox,member.bbox));
  const bits=decode(owner);if(bits)owners.push(bits);
 }
 // A nested duplicate may be wholly owned by one retained detection.
 // Require exact pixel containment; the multi-owner rounding allowance does not apply.
 if(owners.length===1)return target.every((pixel,index)=>!pixel||owners[0][index]);
 if(owners.length<2)return false;
 const owned=new Uint8Array(target.length),unique=new Uint32Array(owners.length);
 let total=0,covered=0;
 for(let p=0;p<target.length;p++){
  let hits=0,index=-1;for(let i=0;i<owners.length;i++)if(owners[i][p]){hits++;index=i;}
  owned[p]=hits?1:0;if(!target[p])continue;total++;if(hits)covered++;if(hits===1)unique[index]++;
 }
 if(covered<total*.95||[...unique].filter(n=>n>=Math.max(2,total*.05)).length<2)return false;
 // At most one grid cell of edge rounding is allowed, never a new text island.
 const w=background.width,h=background.height;
 for(let p=0;p<target.length;p++)if(target[p]&&!owned[p]){
  const x=p%w,y=Math.floor(p/w);let adjacent=false;
  for(let dy=-1;dy<=1&&!adjacent;dy++)for(let dx=-1;dx<=1;dx++)if(x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<h&&owned[(y+dy)*w+x+dx]){adjacent=true;break;}
  if(!adjacent)return false;
 }
 return true;
}
function blocksWhiteBubble(background,region,result){
 if(!validBox(region.bbox,result))return false;
 const support=supportFor(background,region);return support?support.interior>=.05:coverage(background,result,region.bbox)>=.15;
}
function partialEffectBubble(background,members,protectedRegions,result){
 const polygon=globalThis.MangaPolygon,legacyBlocked=protectedRegions.some(region=>blocksWhiteBubble(background,region,result));
 if(!polygon?.overlap||!polygon?.subtract||!polygon?.validRegionMask)return legacyBlocked?null:background;
 const effects=[],intrusions=[];
 for(const region of protectedRegions){
  const legacy=blocksWhiteBubble(background,region,result);
  if(!['effect','text'].includes(region.type)||!polygon.validRegionMask(region,result)){if(legacy)return null;continue;}
  const measured=polygon.overlap(background,region.hitMask,result);if(!measured){if(legacy)return null;continue;}
  if(!legacy&&!measured.intersectionArea)continue;
  if(!measured.firstArea||measured.firstFraction>=.5)return null;
  effects.push(region);intrusions.push({id:region.id,sourceText:region.text,sourceBox:[...region.bbox],relationship:measured.secondFraction>=.5?'contained':'crossing',...measured});
 }
 if(!effects.length)return background;
 if(background.confidence<.85||effects.length>32)return null;
 const clipped=polygon.subtract(background,effects.map(region=>region.hitMask),result,1);
 if(!clipped||clipped.polygonOverlap.remainingFraction<.5)return null;
 // Preserve every source glyph cell already covered by the original balloon.
 // Existing coarse-grid spill outside its boundary is not new overlap. A ratio alone
 // cannot authorize hiding either a dialogue glyph or a protected effect.
 for(const region of members){if(!polygon.validRegionMask(region,result))return null;const before=polygon.overlap(region.hitMask,background,result),inside=polygon.overlap(region.hitMask,clipped,result);if(!before||!inside||!before.intersectionArea||Math.abs(before.intersectionArea-inside.intersectionArea)>.01)return null;}
 return {...clipped,effectIntrusions:intrusions};
}
function bubblePresentation(result,mode,geometry){
 if(mode!=='white'||!geometry||geometry.width!==result.width||geometry.height!==result.height||!Array.isArray(geometry.bubbles))return result;
 const candidates=geometry.bubbles.filter(background=>{try{return background.confidence>=.65&&validBox(background.bbox,result)&&whiteMask(background).area<=.4;}catch{return false;}}).sort((first,second)=>whiteMask(first).area-whiteMask(second).area);
 const assigned=new Map(),replacements=new Map();
 for(const region of result.regions){
  if(!whiteCandidate(region)||!validBox(region.bbox,result)||!validBox(region.box,result))continue;
  const background=candidates.find(background=>bubbleSupport(background,result,region));
  if(background){const members=assigned.get(background)||[];members.push(region);assigned.set(background,members);}
 }
 for(const [originalBackground,members]of assigned){
  const protectedRegions=[...result.regions.filter(region=>!members.includes(region)),...(result.preservedRegions||[])];
  const partial=partialEffectBubble(originalBackground,members,protectedRegions,result);
  // An uncertain shadow mask must not regress an existing supported layout.
  // Newly admitted groups still require the complete polygon protection path.
  const background=partial||(!protectedRegions.some(region=>blocksWhiteBubble(originalBackground,region,result))?originalBackground:null);if(!background)continue;
  const preservedEffect=support=>['effect','text'].includes(support.type)&&protectedRegions.some(region=>support.type===region.type&&background.effectIntrusions?.some(item=>item.id===region.id&&item.sourceText===region.text)&&JSON.stringify(support.bbox)===JSON.stringify(region.bbox)&&Math.abs(support.confidence-region.detectorConfidence)<.0001);
  if((background.supports||[]).some(support=>!preservedEffect(support)&&support.confidence>=.5&&support.inside>=.9&&support.interior>=.5&&!members.some(region=>intersection(support.bbox,region.bbox)/Math.max(boxArea(support.bbox),boxArea(region.bbox))>=.5)&&!duplicateSupport(support,members,background,result)))continue;
  const leafPairs=[],primary=partition(members,background.bbox,undefined,.5,{leaves:leafPairs});if(!primary)continue;
  const alternatives=[primary];let diagonal=false;
  // For diagonal pairs, right-to-left and top-to-bottom must agree before
  // considering another partition. Explicit layouts retain their chosen slots.
  if(members.length===2&&!members.some(region=>region.layoutOverride)){
   const [a,b]=members.map(region=>region.bbox),dx=a[0]+a[2]-b[0]-b[2],dy=a[1]+a[3]-b[1]-b[3];
   diagonal=dx*dy<0;
   if(diagonal)for(const axis of [0,1]){
    const candidate=partition(members,background.bbox,axis);
    if(candidate&&!alternatives.some(slots=>members.every(region=>slots.get(region).every((v,i)=>v===candidate.get(region)[i]))))alternatives.push(candidate);
   }
  }
  // Explore a concordant pair at an existing leaf of a larger source partition.
  // The surrounding tree and every other phrase retain their source slots.
  if(members.length>2&&!members.some(r=>r.layoutOverride)){
   for(const pair of leafPairs){
    const [a,b]=pair.map(r=>r.bbox),dx=a[0]+a[2]-b[0]-b[2],dy=a[1]+a[3]-b[1]-b[3];
    if(dx*dy>=0)continue;
    for(const axis of [0,1]){
     const slots=partition(members,background.bbox,undefined,.5,{override:{members:pair,axis}});
     if(slots&&!alternatives.some(prior=>members.every(r=>slots.get(r).every((v,k)=>v===prior.get(r)[k]))))alternatives.push(slots);
    }
   }
  }
  const fitGroup=slots=>{
  const rendered=[];let failed=false,totalScore=0;
  for(const region of members){
   const scale=Math.min(result.width,result.height)/720,minimum=Math.max(8,Math.round(8*scale)),maximum=region.layoutOverride?region.fontSize||32:Math.round(32*scale);
   const boxes=region.layoutOverride?[region.box]:maskRectangles(background,result,slots.get(region)),fitting=[];
   for(const box of boxes){
    if(coverage(background,result,box)<.98)continue;
    if(background.effectExclusions&&coverage(background.effectExclusions,result,box)>0)continue;
    const layout=textLayout(region,box,maximum,minimum);if(!layout)continue;
    const slot=slots.get(region),distance=Math.hypot((box[0]+box[2]-region.bbox[0]-region.bbox[2])/(2*(slot[2]-slot[0])),(box[1]+box[3]-region.bbox[1]-region.bbox[3])/(2*(slot[3]-slot[1])));
    const isolated=layout.lines.filter(line=>[...graphemes.segment(line)].length===1).length;
    const score=layout.fontSize-layout.breaks*3*scale-isolated*8*scale-distance*maximum*1.5;
    fitting.push({box,layout,score});
   }
   const intact=fitting.filter(candidate=>candidate.layout.breaks===0&&candidate.layout.fontSize>=12),singleWord=!region.manual&&!region.layoutOverride&&!region.displayOverride&&/^\p{P}*\p{Script=Latin}[\p{Script=Latin}\p{M}]*(?:['’\-][\p{Script=Latin}\p{M}]+)*\p{P}*$/u.test(region.translation.trim());
   const choices=singleWord&&intact.length?intact:fitting,largestFont=Math.max(0,...choices.map(candidate=>candidate.layout.fontSize)),best=choices.filter(candidate=>candidate.layout.fontSize>=largestFont*.8).sort((first,second)=>second.score-first.score)[0];
   if(!best){failed=true;break;}
   if(rendered.some(other=>intersection(other.box,best.box)>0)){failed=true;break;}
   totalScore+=best.score;
   rendered.push({...region,box:best.box,fontSize:best.layout.fontSize,automaticFontMaximum:Math.max(maximum,region.automaticFontMaximum||0),mode:'white',whiteScope:'bubble',whiteBackground:{...background,kind:'bubble'},automaticGroup:geometry.bubbles.indexOf(originalBackground),automaticLayout:true});
  }
  return failed?null:{rendered,score:totalScore};
  };
  const groups=alternatives.map(fitGroup).filter(Boolean),baseline=groups[0];
  const acceptable=group=>!baseline||group.rendered.every((region,i)=>region.fontSize>=baseline.rendered[i].fontSize)||
   (group.rendered.every((region,i)=>region.fontSize>=baseline.rendered[i].fontSize*.9&&textLayout(region).breaks<=textLayout(baseline.rendered[i]).breaks)&&group.rendered.some((region,i)=>textLayout(region).breaks<textLayout(baseline.rendered[i]).breaks))||
   (baseline.rendered.some(r=>textLayout(r).breaks>0)&&group.rendered.every((r,i)=>textLayout(r).breaks===0&&r.fontSize>=Math.round(baseline.rendered[i].fontSize*.8))&&Math.min(...group.rendered.map(r=>r.fontSize))>=Math.min(...baseline.rendered.map(r=>r.fontSize))*.9);
  let best=groups.filter(acceptable).sort((a,b)=>b.score-a.score)[0];
  // Keep the established layout unless a very uneven pair can increase its
  // smaller font without introducing word splits or reversing source order.
  if(best&&diagonal){
   const reference=best,smallest=Math.min(...reference.rendered.map(r=>r.fontSize)),largest=Math.max(...reference.rendered.map(r=>r.fontSize));
   if(largest>=smallest*1.8){
    const balanced=[];
    for(const axis of [0,1])for(const fraction of [.25,.75]){
     // Every cut remains between the two source centers.
     const slots=partition(members,background.bbox,axis,fraction);
     if(!slots||alternatives.some(prior=>members.every(r=>slots.get(r).every((v,i)=>v===prior.get(r)[i]))))continue;
     alternatives.push(slots);const group=fitGroup(slots);if(!group)continue;
     const minimum=Math.min(...group.rendered.map(r=>r.fontSize));
     if(minimum<smallest+Math.max(2,smallest*.15)||!group.rendered.every((r,i)=>r.fontSize>=reference.rendered[i].fontSize*.65&&textLayout(r).breaks<=textLayout(reference.rendered[i]).breaks))continue;
     balanced.push({...group,minimum});
    }
    best=balanced.sort((a,b)=>b.minimum-a.minimum||b.score-a.score)[0]||reference;
   }
  }
  for(let index=0;index<members.length;index++)replacements.set(members[index],best?best.rendered[index]:{...members[index],mode:'tooltip',automaticLayout:true});
 }
 return {...result,regions:result.regions.map(region=>replacements.get(region)||region)};
}
// Only previously tooltip-only regular text is eligible. Effects and explicit
// edits retain their presentation. Geometry is required before ruling out a bubble.
const outsideCandidate=region=>!region.automaticPunctuation&&confirmedPanel(region)&&region.mode==='tooltip'&&region.type==='text'&&!region.manual&&!region.displayOverride&&!region.truncated&&!region.ocrTruncated&&!!region.text?.trim()&&!!region.translation?.trim();
function outsidePresentation(result,geometry,shrinkForRestoration=false){
 if(!geometry||geometry.width!==result.width||geometry.height!==result.height||!Array.isArray(geometry.bubbles))return result;
 try{for(const bubble of geometry.bubbles){if(!validBox(bubble.bbox,result))return result;whiteMask(bubble);}}catch{return result;}
 const nearBubble=box=>geometry.bubbles.some(bubble=>coverage(bubble,result,box)>.05||intersection(bubble.bbox,box)/boxArea(box)>.25);
 const scale=Math.min(result.width,result.height)/720,minimum=Math.max(8,Math.round(8*scale));
 const protectedRegions=[...result.regions,...(result.preservedRegions||[])],painted=[];
 return {...result,regions:result.regions.map(region=>{
  if(!outsideCandidate(region)||!validBox(region.bbox,result)||!validBox(region.box,result)||boxArea(region.bbox)>result.width*result.height*.08||nearBubble(region.bbox))return region;
  const box=region.layoutOverride?region.box:region.bbox;
  if(nearBubble(box))return region;
  const paintedBoxes=[region.bbox,box].map(bounds=>[Math.max(0,bounds[0]-4),Math.max(0,bounds[1]-4),Math.min(result.width,bounds[2]+4),Math.min(result.height,bounds[3]+4)]);
  if(paintedBoxes.some(bounds=>painted.some(other=>intersection(bounds,other)>0)||protectedRegions.some(other=>other!==region&&[other.bbox,other.box].some(otherBox=>validBox(otherBox,result)&&intersection(bounds,otherBox)>0))))return region;
  let maximum=region.layoutOverride?region.fontSize||32:Math.round(32*scale);
  if(!region.layoutOverride&&box[3]-box[1]>(box[2]-box[0])*1.5&&[...graphemes.segment(region.translation)].length>4){
   const legacyMaximum=Math.min(maximum,Math.max(minimum,Math.floor((box[2]-box[0]-4)/2)));
   if(!shrinkForRestoration)maximum=legacyMaximum;
   else{
    // Vertical CJK captions can use one glyph per line. Keep Latin words and
    // numeric runs intact while choosing the larger automatic font.
    const runs=region.translation.match(/[\p{Script=Latin}\p{M}\p{N}]+(?:[.,][\p{N}]+)*/gu)||[];
    let fitting=maximum;
    for(;fitting>=8;fitting--){textContext.font=font(fitting);if(runs.every(run=>{const m=textContext.measureText(run);return Math.max(m.width,m.actualBoundingBoxLeft+m.actualBoundingBoxRight)<=box[2]-box[0]-4;}))break;}
    maximum=fitting>=8?fitting:legacyMaximum;
   }
  }
  let layout=textLayout(region,box,maximum,minimum);
  // Authorized restoration can retry narrow text at the absolute font floor.
  // White backgrounds and explicit layout edits keep their original limits.
  if(!layout&&shrinkForRestoration&&!region.layoutOverride&&minimum>8)layout=textLayout(region,box,maximum,8);
  if(!layout)return region;
  painted.push(...paintedBoxes);
  return {...region,box:[...box],fontSize:layout.fontSize,automaticFontMaximum:Math.max(maximum,region.automaticFontMaximum||0),mode:'white',whiteScope:'box',whiteBackground:{kind:'box'},automaticOutside:true,automaticLayout:true};
 })};
}
function verifiedTextMethod(row,result){
 const v=row.textVerification;if(v?.version!==1)return false;if(v.method==='ocr-consensus')return true;
 if(v.method!=='ocr-context'||!Array.isArray(v.contextProofs)||!v.contextProofs.length||v.contextProofs.length>4)return false;
 return v.contextProofs.every(p=>{
  if(!p||p.method!=='dictionary-context'||p.preprocessing!=='white-foreground-160'||p.first!==p.polarity||typeof p.text!=='string'||!row.text?.includes(p.text)||typeof p.term!=='string'||typeof p.rubyText!=='string'||!p.rubyText.match(/^[ぁ-ヺー]+$/u)||!validBox(p.bounds,result)||!validBox(p.mainBox,result)||!validBox(p.rubyBox,result))return false;
  const support=result.regions.find(r=>r.id===p.support?.id);if(!support||support.manual||support.ocrTruncated||support.detectorConfidence<.85||support.text!==p.support.text||JSON.stringify(support.bbox)!==JSON.stringify(p.support.bbox)||!support.text.includes(p.term)||intersection(row.bbox,support.bbox))return false;
  const a=Array.from(p.first||''),b=Array.from(p.second||''),c=Array.from(p.text),term=Array.from(p.term);if(a.length!==b.length||a.length!==c.length||term.length<3||term.length>8)return false;
  const diff=a.map((x,i)=>x!==b[i]?i:-1).filter(i=>i>=0);if(diff.length!==1)return false;const i=diff[0],han=x=>/^[\p{Script=Han}]$/u.test(x),kana=x=>/^[ぁ-ヺ]$/u.test(x);if(!(han(a[i])&&han(b[i]))&&!(p.kanaConfusion&&((han(a[i])&&kana(b[i]))||(kana(a[i])&&han(b[i])))))return false;
  return a.every((x,j)=>j===i||x===c[j])&&c[i]&&han(c[i])&&p.text.includes(p.term);
 });
}
function enclosureReadingProof(proof){
 const a=proof?.agreement;return proof?.version===1&&proof.method==='four-view-original-ocr'&&Array.isArray(a)&&a.length===4&&a.every(v=>typeof v==='boolean')&&a[0]&&a.filter(Boolean).length>=3;
}
function componentEffectProtection(mask,other,result,source,proof){
 try{
  const polygon=globalThis.MangaPolygon,p=proof.componentOwnership,g=proof.geometry,v=source.textVerification,same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===4&&b.length===4&&a.every((x,i)=>Number.isFinite(x)&&x===b[i]);
  if(source.panelCandidate||other.panelCandidate||other.ocrTruncated||other.truncated||mask.scope!=='outside'||!polygon?.overlap||!polygon?.subtract||!v||v.version!==1||!verifiedTextMethod(source,result)||!['LABEL','DIALOGUE'].includes(v.role)||!Array.isArray(v.sources)||v.sources.length<2||v.sources.length>8||!v.sources.every(b=>validBox(b,result)))return null;
  if(p?.version!==1||p.method!=='contained-verified-source-components'||p.sourceText!==source.text||!same(p.sourceBox,source.bbox)||p.sourceConfidence!==source.detectorConfidence||!Number.isFinite(p.compositeConfidence)||p.compositeConfidence<source.detectorConfidence-.0001||p.compositeConfidence>1||!Number.isInteger(p.compositeQuery)||!Number.isInteger(p.effectQuery)||p.compositeQuery<0||p.compositeQuery>=300||p.effectQuery<0||p.effectQuery>=300||p.compositeQuery===p.effectQuery)return null;
  if(proof.sourceConfidence!==source.detectorConfidence||proof.sourceText!==other.text||!same(proof.sourceBox,other.bbox)||!g||!same(g.bbox,other.bbox)||(!Number.isFinite(g.confidence)||Math.abs(g.confidence-other.detectorConfidence)>.0001)||!Array.isArray(p.components)||!p.components.length||p.components.length>8||!Array.isArray(p.sourceParts)||!p.sourceParts.length||p.sourceParts.length>12)return null;
  const decode=m=>{if(m?.width!==g.width||m?.height!==g.height||m.imageWidth!==result.width||m.imageHeight!==result.height)return null;const value=whiteMask(m),count=value.bits.reduce((a,b)=>a+b,0);return Number.isInteger(m.pixels)&&count===m.pixels?value.bits:null;};
  const original=decode(p.originalGeometry),claimed=decode(p.claimedGeometry),owned=decode(p.sourceGeometry),remaining=whiteMask(g).bits;
  if(!original||!claimed||!owned||![p.effectCells,p.sourceCells,p.claimedCells].every(n=>Number.isInteger(n)&&n>0)||p.effectCells!==p.originalGeometry.pixels||p.sourceCells!==p.sourceGeometry.pixels||p.claimedCells!==p.claimedGeometry.pixels||p.claimedCells>p.effectCells*.1||p.claimedCells>p.sourceCells*.1||p.claimedCells===p.effectCells||Math.abs(p.effectFraction-p.claimedCells/p.effectCells)>1e-9||Math.abs(p.sourceFraction-p.claimedCells/p.sourceCells)>1e-9)return null;
  const w=g.width,h=g.height;
  for(let i=0;i<original.length;i++){if(claimed[i]&&(!original[i]||!owned[i])||remaining[i]!==Number(original[i]&&!claimed[i]))return null;if(!claimed[i])continue;const x=i%w,y=Math.floor(i/w);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx>=0&&yy>=0&&xx<w&&yy<h&&original[yy*w+xx]&&!claimed[yy*w+xx])return null;}}
  for(const part of p.sourceParts){if(!validBox(part.bbox,result)||boxArea(part.bbox)>=boxArea(source.bbox)*.85||!Number.isInteger(part.query)||part.query<0||part.query>=300||!Number.isFinite(part.confidence)||part.confidence<.2||part.confidence>1)return null;
   if(part.kind==='ocr-source'){if(!v.sources.some(b=>same(b,part.bbox)))return null;}
   else if(part.kind==='owned-terminal-punctuation'){if(!(source.punctuationFragments||[]).some(q=>q.version===1&&q.method==='same-glyph-terminal-punctuation'&&q.owner===source.id&&q.ownerText===source.text&&same(q.ownerBox,source.bbox)&&q.ownerConfidence===source.detectorConfidence&&q.sourceQuery===part.query&&same(q.sourceBox,part.bbox)&&q.sourceConfidence===part.confidence&&q.imageWidth===result.width&&q.imageHeight===result.height))return null;}
   else return null;
  }
  const seen=new Uint8Array(original.length);let total=0;
  for(const c of p.components){if(!Number.isInteger(c.sourcePart)||c.sourcePart<0||c.sourcePart>=p.sourceParts.length||!Number.isInteger(c.cells)||c.cells<1||!Array.isArray(c.gridBox)||c.gridBox.length!==4||!c.gridBox.every(Number.isInteger)||c.gridBox[0]<0||c.gridBox[1]<0||c.gridBox[2]>w||c.gridBox[3]>h)return null;const b=p.sourceParts[c.sourcePart].bbox,m=whiteMask({width:w,height:h,runs:c.runs}).bits;let count=0,x0=w,y0=h,x1=0,y1=0;
   for(let i=0;i<m.length;i++)if(m[i]){const x=i%w,y=Math.floor(i/w),px=(x+.5)*result.width/w,py=(y+.5)*result.height/h;if(!claimed[i]||seen[i]||px<b[0]||px>=b[2]||py<b[1]||py>=b[3]||px<source.bbox[0]||px>=source.bbox[2]||py<source.bbox[1]||py>=source.bbox[3])return null;seen[i]=1;count++;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}
   if(count!==c.cells||!same(c.gridBox,[x0,y0,x1,y1]))return null;total+=count;
  }
  if(total!==p.claimedCells||claimed.some((v,i)=>v!==seen[i]))return null;
  const inSource=polygon.overlap(p.claimedGeometry,p.sourceGeometry,result),inEffect=polygon.overlap(p.claimedGeometry,p.originalGeometry,result),cut=polygon.subtract(p.originalGeometry,[p.claimedGeometry],result,0),equal=cut&&polygon.overlap(cut,g,result);
  if(!inSource||!inEffect||inSource.firstFraction<1-1e-9||inEffect.firstFraction<1-1e-9||!equal||equal.firstFraction<1-1e-9||equal.secondFraction<1-1e-9)return null;
  return g;
 }catch{return null;}
}
function effectProtection(mask,other,result){
 const p=mask.effectProtection,same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===4&&b.length===4&&a.every((v,i)=>Number.isFinite(v)&&v===b[i]);
 const source=result.regions.find(r=>r.id===mask.id);
 if(!source||source.manual||source.layoutOverride||source.displayOverride||source.ocrTruncated||source.truncated||source.type!=='text'||!Number.isFinite(source.detectorConfidence)||source.detectorConfidence<.2||source.detectorConfidence>1||source.text!==mask.sourceText||!same(source.bbox,mask.sourceBox))return null;
 if(p?.version!==1||p.method!=='weighted-effect-mask'||other.type!=='effect'||other.manual||other.layoutOverride||other.displayOverride||!Number.isFinite(other.detectorConfidence)||other.detectorConfidence<.2||other.detectorConfidence>=.3||!Array.isArray(p.regions)||p.regions.length>32)return null;
 const proofs=p.regions.filter(p=>p&&p.id===other.id);if(proofs.length!==1)return null;
 const proof=proofs[0],g=proof.geometry;
 if(proof.method==='verified-source-effect-components')return componentEffectProtection(mask,other,result,source,proof);
 if(source.detectorConfidence<.9)return null;
 if(proof.method==='enclosure-effect-mask'){const e=mask.enclosureProof;if(other.ocrTruncated||other.truncated||mask.scope!=='enclosure'||e?.version!==1||e.method!=='glyph-only-enclosure-intersection'||e.reading!=='multi-view-ocr-consensus'||e.sourceText!==source.text||!same(e.sourceBox,source.bbox)||!Number.isFinite(e.sourceConfidence)||Math.abs(e.sourceConfidence-source.detectorConfidence)>.0001||!enclosureReadingProof(e.readingProof))return null;}
 if(!['weighted-effect-mask','enclosure-effect-mask'].includes(proof.method)||!Number.isFinite(proof.sourceConfidence)||Math.abs(proof.sourceConfidence-source.detectorConfidence)>.0001||proof.sourceText!==other.text||!same(proof.sourceBox,other.bbox)||!g||!validBox(g.bbox,result)||!same(g.bbox,other.bbox)||!Number.isFinite(g.confidence)||Math.abs(g.confidence-other.detectorConfidence)>.0001||!Array.isArray(g.runs)||!g.runs.length)return null;
 try{whiteMask(g);}catch{return null;}return g;
}
function effectSafeLayout(region,box,maximum,minimum,guards,result){
 for(let size=maximum;size>=minimum;size--){const layout=textLayout(region,box,size,size);if(!layout)continue;let top=box[1]+(box[3]-box[1]-layout.height)/2,collision=false;const margin=Math.max(1,Math.ceil(size*.075+1));for(const m of layout.metrics){const x=(box[0]+box[2]+m.left-m.right)/2,y=top+(m.height-m.ascent-m.descent)/2+m.ascent;const ink=[x-m.left-margin,y-m.ascent-margin,x+m.right+margin,y+m.descent+margin];if(guards.some(g=>coverage(g,result,ink)>0))collision=true;top+=m.height;}if(!collision)return layout;}return null;
}
// Enclosure restoration erases glyphs only. Fit the actual translated ink and
// its halo inside the protected mask, rather than rejecting empty bbox corners.
function enclosureSafeLayout(region,box,maximum,minimum,enclosure,guards,result){
 for(let size=maximum;size>=minimum;size--){
  const layout=textLayout(region,box,size,size);if(!layout)continue;
  let top=box[1]+(box[3]-box[1]-layout.height)/2,safe=true;
  const margin=Math.max(1,Math.ceil(size*.075+1));
  for(const m of layout.metrics){
   const x=(box[0]+box[2]+m.left-m.right)/2,y=top+(m.height-m.ascent-m.descent)/2+m.ascent;
   const ink=[x-m.left-margin,y-m.ascent-margin,x+m.right+margin,y+m.descent+margin];
   if(ink[0]<box[0]||ink[1]<box[1]||ink[2]>box[2]||ink[3]>box[3]||coverage(enclosure,result,ink)<.98||guards.some(g=>coverage(g,result,ink)>0))safe=false;
   top+=m.height;
  }
  if(safe)return layout;
 }
 return null;
}
function segmentedNeighborProtection(mask,other,result){
 const p=mask.segmentedNeighborProtection,source=result.regions.find(r=>r.id===mask.id);
 const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===4&&b.length===4&&a.every((v,i)=>Number.isFinite(v)&&v===b[i]);
 const eligible=r=>r&&r.type==='text'&&!['manual','layoutOverride','displayOverride','ocrTruncated','truncated'].some(k=>r[k])&&Number.isFinite(r.detectorConfidence)&&r.detectorConfidence>=.9&&r.detectorConfidence<=1&&!!r.text?.trim();
 const v=source?.textVerification,verifiedEffect=source?.type==='text'&&other?.type==='effect'&&![source,other].some(r=>['manual','layoutOverride','displayOverride','ocrTruncated','truncated','panelCandidate'].some(k=>r[k]))&&[source,other].every(r=>Number.isFinite(r.detectorConfidence)&&r.detectorConfidence>=.2&&r.detectorConfidence<=1&&!!r.text?.trim())&&v?.version===1&&verifiedTextMethod(source,result)&&['LABEL','DIALOGUE'].includes(v.role)&&Array.isArray(v.sources)&&v.sources.length===1&&same(v.sources[0],source.bbox);
 const joined=mask.isolatedGlyphProof?.method==='isolated-joined-glyphs'&&isolatedGlyphProof(mask,source,result)&&eligible(other);
 if(mask.scope!=='outside'||(!(eligible(source)&&eligible(other))&&!verifiedEffect&&!joined)||source.id===other.id||source.text!==mask.sourceText||!same(source.bbox,mask.sourceBox)||p?.version!==1||p.method!=='detector-glyph-mask'||!Array.isArray(p.regions)||p.regions.length>32)return false;
 const matches=p.regions.filter(r=>r?.id===other.id);if(matches.length!==1)return false;const proof=matches[0],g=proof.geometry;
 if(verifiedEffect&&JSON.stringify(proof.sourceVerification)!==JSON.stringify(v))return false;
 if(proof.sourceText!==other.text||!same(proof.sourceBox,other.bbox)||!Number.isFinite(proof.sourceConfidence)||Math.abs(proof.sourceConfidence-source.detectorConfidence)>.0001||!g||!same(g.bbox,other.bbox)||!validBox(g.bbox,result)||!Number.isFinite(g.confidence)||Math.abs(g.confidence-other.detectorConfidence)>.0001||!Array.isArray(g.runs)||!g.runs.length)return false;
 try{whiteMask(g);}catch{return false;}return g;
}
function restorationProtectsNeighbor(mask,other,result){
 if(effectProtection(mask,other,result)||segmentedNeighborProtection(mask,other,result))return true;
 const proof=mask.neighborProtection,v=other.textVerification;
 if(other.manual||other.layoutOverride||other.displayOverride||!outsideCandidate(other)||!v||v.version!==1||!verifiedTextMethod(other,result)||!['LABEL','DIALOGUE'].includes(v.role)||!Array.isArray(v.sources)||!v.sources.length||v.sources.length>8||!v.sources.every(b=>validBox(b,result)))return false;
 if(proof?.version!==1||proof.method!=='verified-glyph-mask'||!Array.isArray(proof.regions))return false;
 return proof.regions.some(p=>p&&p.id===other.id&&p.sourceText===other.text&&JSON.stringify(p.sourceBox)===JSON.stringify(other.bbox)&&JSON.stringify(p.verification)===JSON.stringify(v));
}
function isolatedGlyphProof(mask,source,result){
 try{
  const p=mask.isolatedGlyphProof,same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),reading=s=>typeof s==='string'?Array.from(s).filter(c=>c.codePointAt(0)>32&&c.codePointAt(0)!==0x3000).join(''):null;
  const cross=p?.method==='isolated-cross-ocr-glyphs',joined=p?.method==='isolated-joined-glyphs',pixels=joined||p?.method==='isolated-pixel-components';
  if(mask.scope!=='outside'||!outsideCandidate(source)||source.layoutOverride||source.panelCandidate||!Number.isFinite(source.detectorConfidence)||source.detectorConfidence<(cross ? .5 : .65)||source.detectorConfidence>1||p?.version!==1||(!cross&&!pixels&&p.method!=='isolated-multiview-glyphs')||p.sourceText!==source.text||!same(p.sourceBox,source.bbox)||p.sourceConfidence!==source.detectorConfidence||p.protectedInkChanges!==0)return false;
  if(joined&&(['manual','layoutOverride','displayOverride','ocrTruncated','truncated','panelCandidate'].some(k=>source[k])||!validBox(source.bbox,result)||boxArea(source.bbox)>result.width*result.height*.02||Math.max(source.bbox[2]-source.bbox[0],source.bbox[3]-source.bbox[1])<2*Math.min(source.bbox[2]-source.bbox[0],source.bbox[3]-source.bbox[1])))return false;
  if(pixels&&(!Number.isFinite(p.foregroundResidualFraction)||p.foregroundResidualFraction<0||p.foregroundResidualFraction>.01||!Number.isInteger(p.sourceFringe)||p.sourceFringe<1||p.sourceFringe>Math.ceil(12*Math.min(result.width,result.height)/720)))return false;
  if(cross&&(!verifiedTextMethod(source,result)||!['LABEL','DIALOGUE'].includes(source.textVerification?.role)||source.textVerification?.sources?.length!==1||!same(source.textVerification.sources[0],source.bbox)||!same(p.sourceVerification,source.textVerification)))return false;
  for(const list of (cross?[p.originalReadings,p.isolatedReadings,p.verifierReadings,p.verifierIsolatedReadings]:[p.originalReadings,p.isolatedReadings]))if(!Array.isArray(list)||list.length!==4||!list.every(s=>reading(s)===reading(source.text)))return false;
  if(!cross&&(!Array.isArray(p.views)||p.views.length!==3||!p.views.every(v=>validBox(v.crop,result)&&Number.isFinite(v.confidence)&&v.confidence>=.2&&v.confidence<=1&&Number.isFinite(v.agreement)&&v.agreement>=.9&&v.agreement<=1)))return false;
  if(!Array.isArray(p.components)||!p.components.length||p.components.length>(pixels?1024:128)||!Number.isInteger(p.glyphPixels)||p.glyphPixels<8||p.glyphPixels>mask.maskPixels)return false;
  let total=0;
  for(const c of p.components){
   if(!validBox(c.bbox,result)||!Number.isInteger(c.pixels)||c.pixels<(pixels?1:4)||c.pixels>boxArea(c.bbox)||!Number.isInteger(c.corePixels)||c.corePixels<(pixels?1:4)||c.corePixels>c.pixels||!Number.isFinite(c.sourceFraction)||c.sourceFraction<.4||c.sourceFraction>1||!Number.isFinite(c.coreSourceFraction)||c.coreSourceFraction<.5||c.coreSourceFraction>1||!Array.isArray(c.viewFractions)||(cross?c.viewFractions.length!==0:c.viewFractions.length!==3||!c.viewFractions.every(v=>Number.isFinite(v)&&v>=(pixels?0:.25)&&v<=1)||!pixels&&c.viewFractions.filter(v=>v>=.5).length<2))return false;
   total+=c.pixels;
  }
  return total===p.glyphPixels;
 }catch{return false;}
}
function paragraphRestorationProof(mask,source,result){
 try{
  const p=mask.paragraphProof,v=source.paragraphCorrection,same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),reading=s=>typeof s==='string'?s.replace(/[\s\u3000]/gu,''):null;
  if(!p||p.version!==1||p.method!=='verified-paragraph-foreground'||mask.scope!=='outside'||!outsideCandidate(source)||source.layoutOverride||source.panelCandidate||p.sourceText!==source.text||!same(p.sourceBox,source.bbox)||p.sourceConfidence!==source.detectorConfidence||!Number.isFinite(p.sourceConfidence)||p.sourceConfidence<.5||p.sourceConfidence>1||!v||!same(p.columnProof,v)||v.version!==1||v.method!=='physical-vertical-paragraph-columns'||v.text!==source.text||!same(v.sourceBox,source.bbox)||v.sourceConfidence!==source.detectorConfidence||!Array.isArray(v.columns)||v.columns.length<3||v.columns.length>12)return false;
  if(!Number.isFinite(p.paperFraction)||p.paperFraction<.65||p.paperFraction>1||!Number.isInteger(p.fringe)||p.fringe<2||p.fringe>Math.ceil(12*Math.min(result.width,result.height)/720)||p.maskPixels!==mask.maskPixels||!Number.isInteger(p.maskPixels)||p.maskPixels<8||p.maskPixels>boxArea(source.bbox)*.9)return false;
  let text='',right=source.bbox[2];
  for(const c of v.columns){if(!validBox(c.bbox,result)||c.bbox[2]!==right||c.bbox[1]!==source.bbox[1]||c.bbox[3]!==source.bbox[3]||!Array.isArray(c.readings)||c.readings.length!==3||!c.readings.every(x=>reading(x)&&reading(x)===reading(c.readings[0])))return false;right=c.bbox[0];text+=c.readings[0];}
  return right===source.bbox[0]&&text===source.text;
 }catch{return false;}
}
function boundaryRestorationProof(mask,source,result){
 try{
  const p=mask.boundaryProof,same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),norm=s=>typeof s==='string'?Array.from(s).filter(c=>c.codePointAt(0)>32&&c.codePointAt(0)!==0x3000).join(''):null;
  if(mask.scope!=='boundary'||!outsideCandidate(source)||['manual','layoutOverride','displayOverride','ocrTruncated','truncated','panelCandidate'].some(k=>source[k])||source.textVerification||p?.version!==1||p.method!=='merged-boundary-foreground'||p.sourceText!==source.text||!same(p.sourceBox,source.bbox)||p.sourceConfidence!==source.detectorConfidence||!Number.isFinite(p.sourceConfidence)||p.sourceConfidence<.35||p.sourceConfidence>1||!same(p.duplicateProof,source.ocrDuplicateGeometry)||!Number.isFinite(p.coverage)||p.coverage<.5||p.coverage>=.95||!Number.isFinite(p.paperFraction)||p.paperFraction<.65||p.paperFraction>1||!validBox(source.bbox,result)||boxArea(source.bbox)>result.width*result.height*.08)return false;
  const d=p.duplicateProof;if(d?.version!==1||d.method!=='ocr-duplicate-box-union'||!same(d.sourceBox,source.bbox)||d.sourceText!==source.text||d.source.id!==source.id||d.source.text!==source.text||!Array.isArray(d.fragments)||d.fragments.length<2||d.fragments.length>4)return false;
  const expected=norm(source.text),readings=p.readings?.map(norm);if(!expected||!Array.isArray(readings)||readings.length!==4||readings[0]!==expected||readings[1]!==expected||readings.filter(x=>x===expected).length<3)return false;
  for(const reading of readings){if(!reading||Array.from(expected).length-Array.from(reading).length>3)return false;let at=0;for(const c of expected)if(c===Array.from(reading)[at])at++;if(at!==Array.from(reading).length)return false;}
  return true;
 }catch{return false;}
}
function smallTextRestorationProof(mask,source,result){
 try{
  const p=mask.smallTextProof,same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),norm=s=>typeof s==='string'?Array.from(s).filter(c=>c.codePointAt(0)>32&&c.codePointAt(0)!==0x3000).join(''):null;
  const body=s=>{const t=norm(s)?.replace(/[\uff01-\uff5e]/g,c=>String.fromCodePoint(c.codePointAt(0)-0xfee0));if(!t)return null;const pairs={'(':')','[':']','（':'）','「':'」','『':'』','【':'】'};return pairs[t[0]]===t.at(-1)?t.slice(1,-1):t;};
  if(mask.scope!=='small-text'||p?.version!==1||p.method!=='isolated-verified-small-glyphs'||source.type!=='text'||['manual','layoutOverride','displayOverride','ocrTruncated','truncated','panelCandidate'].some(k=>source[k])||source.ocrDuplicateGeometry||!['tooltip','replace'].includes(p.sourceMode)||!(source.mode===p.sourceMode||p.sourceMode==='replace'&&source.mode==='white'&&source.automaticLayout)||p.sourceText!==source.text||!same(p.sourceBox,source.bbox)||p.sourceConfidence!==source.detectorConfidence||!Number.isFinite(p.sourceConfidence)||p.sourceConfidence<.25||p.sourceConfidence>1||!validBox(source.bbox,result)||boxArea(source.bbox)>result.width*result.height*.02||p.protectedInkChanges!==0)return null;
  if(p.originalSourceClass!==undefined&&(p.originalSourceClass!==1||source.textVerification?.method!=='ocr-consensus'||!same(source.textVerification.sources,[source.bbox])))return null;
  if(source.textVerification){const v=source.textVerification;if(!verifiedTextMethod(source,result)||v.method!=='ocr-consensus'||!['LABEL','DIALOGUE'].includes(v.role)||!same(v.sources,[source.bbox])||!same(p.sourceVerification,v))return null;}else if(p.sourceVerification)return null;
  let expected=norm(source.text);const count=Array.from(expected||'').length;if(count<4||count>32||!source.translation?.trim()||!Number.isFinite(p.foregroundResidualFraction)||p.foregroundResidualFraction<0||p.foregroundResidualFraction>.01||!Number.isInteger(p.sourceFringe)||p.sourceFringe<1||p.sourceFringe>Math.ceil(12*Math.min(result.width,result.height)/720))return null;
  if(p.terminalPunctuation!==undefined){if(![44,46,12289,12290].includes(p.terminalPunctuation)||count<5||expected.codePointAt(expected.length-1)!==p.terminalPunctuation||p.terminalStroke||p.primaryAgreement)return null;const prefix=expected.slice(0,-1);if([p.originalReadings,p.isolatedReadings].some(l=>!Array.isArray(l)||l.length!==4||!l.every(t=>norm(t)===prefix)))return null;expected=prefix;}
  if(p.terminalStroke){const t=p.terminalStroke,c=t.component,b=source.bbox,z=c?.bbox,size=t.characterSize;if(t.method!=='retained-terminal-boundary-stroke'||![45,8212,12540].includes(t.codepoint)||expected.codePointAt(expected.length-1)!==t.codepoint||!Array.isArray(p.backgroundComponents)||!p.backgroundComponents.some(x=>same(x,c))||!c.edge||!Number.isInteger(c.ownedCore)||c.ownedCore<1||!validBox(z,result)||!Number.isFinite(size)||size!==mask.characterSize||size<8*Math.min(result.width,result.height)/720||size>48*Math.min(result.width,result.height)/720)return null;const vertical=b[3]-b[1]>1.5*(b[2]-b[0])&&z[1]>=b[1]+.65*(b[3]-b[1])&&z[1]<b[3]&&z[3]>=b[3]+size&&z[2]-z[0]<=size*.75,horizontal=b[2]-b[0]>1.5*(b[3]-b[1])&&z[0]>=b[0]+.65*(b[2]-b[0])&&z[0]<b[2]&&z[2]>=b[2]+size&&z[3]-z[1]<=size*.75;if(!vertical&&!horizontal)return null;expected=expected.slice(0,-1);}
  if(p.primaryCrop&&(p.primaryCrop.method!=='matched-source-bounds'||!same(p.primaryCrop.bbox,source.bbox)))return null;
  if(p.verifierCrop){const v=p.verifierCrop,c=p.components;if(v.method!=='antialiased-component-bounds'||![0,1].includes(v.padding)||!same(v.scales,[2,3])||!Array.isArray(c)||!c.length)return null;const b=[Math.max(0,Math.min(...c.map(x=>x.bbox[0]))-v.padding),Math.max(0,Math.min(...c.map(x=>x.bbox[1]))-v.padding),Math.min(result.width,Math.max(...c.map(x=>x.bbox[2]))+v.padding),Math.min(result.height,Math.max(...c.map(x=>x.bbox[3]))+v.padding)];if(!same(v.bbox,b))return null;}
  if(p.columnReading){
   const c=p.columnReading,q=c.recovery,cols=q?.columns,rs=q?.readings,old=norm(q?.prior),oldCount=Array.from(old||'').length;
   if(!same(q,source.textVerification?.columnRecovery)||q?.version!==1||q.method!=='detached-leading-column'||!same(q.sourceBox,source.bbox)||q.text!==source.text||oldCount<4||oldCount>16||count<oldCount+2||count>oldCount+4||!expected.endsWith(old)||!Array.isArray(cols)||cols.length!==2||cols.some(b=>!validBox(b,result)||b[0]<source.bbox[0]||b[1]<source.bbox[1]||b[2]>source.bbox[2]||b[3]>source.bbox[3])||cols[1][2]+2>cols[0][0]||!Array.isArray(rs)||rs.length!==2||rs.some(a=>!Array.isArray(a)||a.length!==4||Array.from(norm(a[0])||'').length<2||!a.every(t=>norm(t)===norm(a[0])))||norm(rs[0][0]+rs[1][0])!==expected||!Array.isArray(q.isolatedReadings)||q.isolatedReadings.length!==4||!q.isolatedReadings.every(t=>norm(t)===expected)||!Array.isArray(c.fullReadings)||c.fullReadings.length!==4||!c.fullReadings.every(t=>[old,expected].includes(norm(t))))return null;
   for(const [parts,combined]of [[c.originalColumns,p.originalReadings],[c.verifierColumns,p.verifierReadings]])if(!Array.isArray(parts)||parts.length!==4||!Array.isArray(combined)||combined.length!==4||parts.some((a,i)=>!Array.isArray(a)||a.length!==2||a.some(t=>typeof t!=='string'||!norm(t))||norm(a.join(''))!==norm(combined[i])))return null;
   if(c.originalColumns.some(a=>a.some((t,i)=>norm(t)!==norm(rs[i][0])))||p.verifierCrop||p.primaryCrop)return null;
  }else if(source.textVerification?.columnRecovery)return null;
  const unframe=s=>{const c=Array.from(norm(s)||'');let i=0,marks=0;while(i<c.length&&['.','…','⋯'].includes(c[i]))marks+=c[i++]==='.'?1:3;return (marks>=3?c.slice(i):c).join('');};
  if(p.primaryAgreement?.method==='ellipsis-framed-consensus'){
   const a=Array.from(expected),letter=c=>/^[A-Za-z\u3041-\u3096\u30a1-\u30fa\u3400-\u9fff\uac00-\ud7a3]$/.test(c);
   if(a.length<6||a.length>32||unframe(expected)!==expected||[p.originalReadings,p.isolatedReadings].some(l=>!Array.isArray(l)||l.length!==4)||!p.isolatedReadings.some(t=>norm(t)!==expected)||!p.isolatedReadings.every(t=>unframe(t)===expected))return null;
   let exact=0;for(const t of p.originalReadings){const c=Array.from(unframe(t));if(same(c,a)){exact++;continue;}let merge=false;if(c.length+1===a.length)for(let k=0;k+1<a.length;k++)merge||=[c[k],a[k],a[k+1]].every(letter)&&c[k]!==a[k]&&c[k]!==a[k+1]&&same(a.slice(0,k),c.slice(0,k))&&same(a.slice(k+2),c.slice(k+1));if(!merge)return null;}if(exact<3)return null;
  }
  else if(p.primaryAgreement?.method==='repeated-terminal-punctuation'){const v=p.primaryAgreement;if(!Number.isInteger(v.originalIndex)||v.originalIndex<0||v.originalIndex>=4||Array.from(expected).length<4||!/[!?！？]$/.test(expected)||!Array.isArray(p.originalReadings)||p.originalReadings.length!==4||!Array.isArray(p.isolatedReadings)||p.isolatedReadings.length!==4||!p.isolatedReadings.every(s=>norm(s)===expected)||!p.originalReadings.every((s,i)=>norm(s)===(i===v.originalIndex?expected+expected.at(-1):expected)))return null;}
  else if(p.primaryAgreement?.method==='anchored-wrapper-consensus'){const core=body(expected),unwrap=s=>norm(s)?.replace(/^[([（「『【]/,'').replace(/[)\]）」』】]$/,'');if(Array.from(expected).length!==Array.from(core||'').length+2||Array.from(core).length<4||!Array.isArray(p.originalReadings)||p.originalReadings.length!==4||!Array.isArray(p.isolatedReadings)||p.isolatedReadings.length!==4||!p.originalReadings.some(s=>norm(s)===expected)||!p.originalReadings.every(s=>unwrap(s)===core)||!p.isolatedReadings.every(s=>unwrap(s)===core&&norm(s)===norm(p.isolatedReadings[0])))return null;}
  else if(p.primaryAgreement){const v=p.primaryAgreement,core=body(expected);if(v.method!=='paired-bracket-variant'||!Number.isInteger(v.originalIndex)||v.originalIndex<0||v.originalIndex>=4||Array.from(expected).length!==Array.from(core||'').length+2||Array.from(core).length<4||!Array.isArray(p.originalReadings)||p.originalReadings.length!==4||!Array.isArray(p.isolatedReadings)||p.isolatedReadings.length!==4||!p.isolatedReadings.every(s=>norm(s)===expected))return null;for(let i=0;i<4;i++){const t=norm(p.originalReadings[i]);if(i===v.originalIndex){if(t===expected||t?.replace(/^[([（「『【]/,'').replace(/[)\]）」』】]$/,'')!==core)return null;}else if(t!==expected)return null;}}
  else for(const list of [p.originalReadings,p.isolatedReadings])if(!Array.isArray(list)||list.length!==4||!list.every(s=>norm(s)===expected))return null;
  let secondaryExpected=body(expected);
  if(p.secondaryAgreement?.method==='paired-secondary-segmentation'){
   const v=p.secondaryAgreement,a=Array.from(secondaryExpected),b=Array.from(body(v.reading)||''),k=v.position,letter=c=>/^[A-Za-z\u3041-\u3096\u30a1-\u30fa\u3400-\u9fff\uac00-\ud7a3]$/.test(c);
   if(!p.verifierCrop||a.length<4||a.length>32||b.length+1!==a.length||!Number.isInteger(k)||k<0||k+1>=a.length||![a[k],a[k+1],b[k]].every(letter)||b[k]===a[k]||b[k]===a[k+1]||!same(a.slice(0,k),b.slice(0,k))||!same(a.slice(k+2),b.slice(k+1)))return null;
   if([p.originalReadings,p.isolatedReadings].some(l=>!Array.isArray(l)||l.length!==4||!l.every(t=>norm(t)===expected))||[p.verifierReadings,p.verifierIsolatedReadings].some(l=>!Array.isArray(l)||l.length!==4))return null;
   let votes=0;for(let i=0;i<4;i++){const c=Array.from(body(p.verifierReadings[i])||'');if(body(p.verifierReadings[i])!==body(p.verifierIsolatedReadings[i]))return null;if(same(c,b)){votes++;continue;}if(same(c,a))continue;if(c.length!==b.length+1||!(letter(c[0])&&same(c.slice(1),b)||letter(c.at(-1))&&same(c.slice(0,-1),b)))return null;}if(votes<3)return null;secondaryExpected=null;
  }
  else if(p.secondaryAgreement){const v=p.secondaryAgreement,a=Array.from(secondaryExpected),reference=body(v.reading),b=Array.from(reference||'');if(!p.verifierCrop||!['paired-secondary-reading','bounded-secondary-readings','majority-secondary-readings'].includes(v.method)||a.length<(v.method==='majority-secondary-readings'?4:8)||a.length!==b.length)return null;const changed=[];const punctuation=c=>{const n=c.codePointAt(0);return n<=32||n<128&&!/[A-Za-z]/.test(c)||n>=0x2000&&n<=0x303f||n>=0xff00&&n<=0xff20||n>=0xff3b&&n<=0xff40||n>=0xff5b&&n<=0xff65;};for(let i=0;i<a.length;i++)if(a[i]!==b[i]){if(punctuation(a[i])||punctuation(b[i]))return null;changed.push(i);}if(v.method==='paired-secondary-reading'){if(!changed.length||changed.length>2||changed.length*5>a.length||!same(changed,v.substitutions))return null;secondaryExpected=reference;}else{const uncertain=new Set(),lists=[p.verifierReadings,p.verifierIsolatedReadings],letter=c=>/^[A-Za-z\u3041-\u3096\u30a1-\u30fa\u3400-\u9fff\uac00-\ud7a3]$/.test(c);if(lists.some(l=>!Array.isArray(l)||l.length!==4))return null;let pairs=0;for(let i=0;i<4;i++)pairs+=body(lists[0][i])===body(lists[1][i]);for(const l of lists)for(const t of l){const chars=Array.from(body(t)||'');if(chars.length!==a.length)return null;for(let i=0;i<a.length;i++)if(chars[i]!==a[i]){if(!letter(chars[i])||!letter(a[i]))return null;uncertain.add(i);}}const positions=[...uncertain].sort((a,b)=>a-b);if(v.method==='majority-secondary-readings'){if(pairs!==4||positions.length!==1||lists[0].filter(t=>body(t)===body(expected)).length!==3)return null;}else if(pairs<2||!positions.length||positions.length>2||positions.length*5>a.length)return null;if(!same(positions,v.substitutions)||v.reading!==p.verifierReadings[0])return null;secondaryExpected=null;}}
  for(const list of [p.verifierReadings,p.verifierIsolatedReadings])if(!Array.isArray(list)||list.length!==4||secondaryExpected!==null&&!list.every(s=>(p.primaryAgreement?.method==='ellipsis-framed-consensus'?unframe(body(s)):body(s))===secondaryExpected))return null;
  if(!Array.isArray(p.components)||!p.components.length||p.components.length>1024||!Number.isInteger(p.glyphPixels)||p.glyphPixels<8||p.glyphPixels>mask.maskPixels||p.sourceMode==='replace'&&(!Number.isInteger(p.remainingPixels)||p.remainingPixels<8||p.remainingPixels<p.glyphPixels*.02))return null;
  let total=0;for(const c of p.components){if(!validBox(c.bbox,result)||!Number.isInteger(c.pixels)||c.pixels<1||c.pixels>boxArea(c.bbox)||!Number.isInteger(c.corePixels)||c.corePixels<1||c.corePixels>c.pixels||!Number.isFinite(c.sourceFraction)||c.sourceFraction<.4||c.sourceFraction>1||!Number.isFinite(c.coreSourceFraction)||c.coreSourceFraction<.5||c.coreSourceFraction>1||!Array.isArray(c.viewFractions)||c.viewFractions.length)return null;total+=c.pixels;}
  if(total!==p.glyphPixels||!p.backgroundGeometry||!validBox(p.backgroundGeometry.bbox,result))return null;whiteMask(p.backgroundGeometry);
  if(!Array.isArray(p.effects)||p.effects.length>16)return null;const effects=new Map();
  for(const e of p.effects){const other=result.regions.find(r=>r.id===e.id);const label=e.verifiedLabelOverlap===true&&p.originalSourceClass===1&&source.textVerification?.method==='ocr-consensus'&&same(source.textVerification.sources,[source.bbox]);if(e.verifiedLabelOverlap&&!label)return null;if(!other||other.type!=='effect'||other.mode!=='tooltip'||['manual','layoutOverride','displayOverride','panelCandidate'].some(k=>other[k])||!label&&(other.ocrTruncated||other.truncated)||effects.has(e.id)||other.text!==e.sourceText||!same(other.bbox,e.sourceBox)||other.detectorConfidence!==e.confidence||e.confidence<.2||e.confidence>=(label||Array.from(norm(other.text)||'').length>0&&Array.from(norm(other.text)).length<=8&&Array.from(norm(other.text)).every(c=>c.codePointAt(0)>=0x2600&&c.codePointAt(0)<=0x27ff||c.codePointAt(0)>=0x1f300&&c.codePointAt(0)<=0x1faff)?.65:.3)||typeof e.duplicateText!=='boolean'||e.duplicateText&&(body(expected)===expected||Array.from(norm(other.text)||'').length<2||norm(other.text).length>=body(expected).length||!body(expected).includes(norm(other.text)))||!e.duplicateText&&e.claimedPixels>0&&(!p.components.every(c=>c.coreSourceFraction>=.98)||!label&&(body(expected)===expected||!Array.from(norm(other.text)||'').length||Array.from(norm(other.text)||'').length>8||!Array.from(norm(other.text)||'').every(c=>c.codePointAt(0)>=0x2600&&c.codePointAt(0)<=0x27ff||c.codePointAt(0)>=0x1f300&&c.codePointAt(0)<=0x1faff)))||!Number.isInteger(e.inkPixels)||e.inkPixels<1||!Number.isInteger(e.claimedPixels)||e.claimedPixels<0||e.claimedPixels>e.inkPixels*.5||Math.abs(e.claimedFraction-e.claimedPixels/e.inkPixels)>1e-9)return null;
   for(const g of [e.original,e.claimed,e.retained])if(!same(g.bbox,other.bbox)||g.confidence!==e.confidence||g.width!==512||g.height!==512)return null;
   const a=whiteMask(e.original).bits,b=whiteMask(e.claimed).bits,c=whiteMask(e.retained).bits;if(!c.some(Boolean)||a.some((v,i)=>b[i]&&!v||c[i]!==Number(v&&!b[i])))return null;
   if(e.claimedPixels){const overlap=globalThis.MangaPolygon?.overlap(e.claimed,e.original,result),cut=globalThis.MangaPolygon?.subtract(e.original,[e.claimed],result,0),equal=cut&&globalThis.MangaPolygon.overlap(cut,e.retained,result);if(!overlap||overlap.firstFraction<1-1e-9||!equal||equal.firstFraction<1-1e-9||equal.secondFraction<1-1e-9)return null;}else if(b.some(Boolean))return null;
   effects.set(e.id,e.retained);
  }
  return {proof:p,effects};
 }catch{return null;}
}
function smallTextInkLayout(source,boxes,maximum,guards,result){
 const masks=guards.map(whiteMask),canvas=document.createElement('canvas');
 for(const box of boxes.slice(0,24))for(let size=maximum;size>=8;size--){
  const candidate={...source,mode:'restore',box,fontSize:size,automaticFontMaximum:maximum},layout=textLayout(candidate);if(!layout||layout.fontSize!==size)continue;
  canvas.width=box[2]-box[0];canvas.height=box[3]-box[1];const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.translate(-box[0],-box[1]);drawRegion(ctx,candidate);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let collision=false;
  for(let y=0;y<canvas.height&&!collision;y++)for(let x=0;x<canvas.width;x++)if(pixels[(y*canvas.width+x)*4+3]){for(let i=0;i<guards.length;i++){const g=guards[i],gx=Math.min(g.width-1,Math.floor((x+box[0]+.5)*g.width/result.width)),gy=Math.min(g.height-1,Math.floor((y+box[1]+.5)*g.height/result.height));if(masks[i].bits[gy*g.width+gx]){collision=true;break;}}if(collision)break;}
  if(!collision)return {box,layout};
 }return null;
}
function smallTextNeighborProtection(mask,other,result,checked){
 const source=result.regions.find(r=>r.id===mask.id),p=mask.segmentedNeighborProtection,same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 if(!source||checked.proof!==mask.smallTextProof||mask.scope!=='small-text'||other.id===source.id||other.type!=='effect'||other.mode!=='tooltip'||['manual','layoutOverride','displayOverride','panelCandidate'].some(k=>other[k])||!Number.isFinite(other.detectorConfidence)||other.detectorConfidence<.2||other.detectorConfidence>1||!other.text||p?.version!==1||p.method!=='detector-glyph-mask'||!Array.isArray(p.regions)||p.regions.length>32)return null;
 const entries=p.regions.filter(r=>r.id===other.id);if(entries.length!==1)return null;const proof=entries[0],g=proof.geometry;
 if(proof.smallTextRawNeighbor!==true||proof.sourceText!==other.text||!same(proof.sourceBox,other.bbox)||proof.sourceConfidence!==source.detectorConfidence||!g||!same(g.bbox,other.bbox)||!validBox(g.bbox,result)||g.confidence!==other.detectorConfidence)return null;
 try{const parsed=whiteMask(g),w=mask.bounds[2]-mask.bounds[0],h=mask.bounds[3]-mask.bounds[1];if(!Array.isArray(mask.runs)||mask.runs.length%2)return null;let end=0;for(let i=0;i<mask.runs.length;i+=2){const start=mask.runs[i],count=mask.runs[i+1];if(!Number.isInteger(start)||!Number.isInteger(count)||start<end||count<=0||start+count>w*h)return null;end=start+count;for(let p=start;p<end;p++){const x=mask.bounds[0]+p%w,y=mask.bounds[1]+Math.floor(p/w),gx=Math.floor((x+.5)*g.width/result.width),gy=Math.floor((y+.5)*g.height/result.height);if(parsed.bits[gy*g.width+gx])return null;}}}catch{return null;}
 return g;
}
function smallTextPresentation(source,result,mask,checked){
 const peers=[...result.regions.filter(r=>r.id!==source.id),...(result.preservedRegions||[])],neighbors=new Map(peers.map(r=>[r.id,smallTextNeighborProtection(mask,r,result,checked)]).filter(([,g])=>g)),guards=[checked.proof.backgroundGeometry,...checked.effects.values(),...neighbors.values()];
 if(peers.some(r=>!checked.effects.has(r.id)&&!neighbors.has(r.id)&&!restorationProtectsNeighbor(mask,r,result)&&validBox(r.bbox,result)&&restorationMaskOverlaps(mask,result,r.bbox)))return source;
 const padding=Math.max(1,Math.ceil(Math.min(result.width,result.height)/720));let boxes=[source.bbox];
 for(const r of peers){if(checked.effects.has(r.id)||neighbors.has(r.id))continue;for(const obstacle of [r.bbox,r.box]){if(!validBox(obstacle,result))continue;const b=[obstacle[0]-padding,obstacle[1]-padding,obstacle[2]+padding,obstacle[3]+padding],next=[];for(const a of boxes){if(!intersection(a,b)){next.push(a);continue;}for(const box of [[a[0],a[1],Math.min(a[2],b[0]),a[3]],[Math.max(a[0],b[2]),a[1],a[2],a[3]],[a[0],a[1],a[2],Math.min(a[3],b[1])],[a[0],Math.max(a[1],b[3]),a[2],a[3]]])if(validBox(box,result))next.push(box);}boxes=next.sort((a,b)=>boxArea(b)-boxArea(a)).slice(0,16);}}
 const maximum=Math.round(32*Math.min(result.width,result.height)/720),choose=choices=>choices.map(box=>({box,layout:effectSafeLayout(source,box,maximum,8,guards,result)})).filter(x=>x.layout).sort((a,b)=>b.layout.fontSize-a.layout.fontSize||boxArea(b.box)-boxArea(a.box))[0];let best=choose(boxes);
 // Empty space in a tall annotation need not be centered over a background
 // stroke. Search a bounded set of insets, entirely within the original box.
 if(!best){const alternatives=[];for(const box of boxes.slice(0,4))for(const axis of [0,1]){const length=box[axis+2]-box[axis];for(const fraction of [.1,.2,.3,.4,.5])for(const end of [0,1]){const b=[...box];if(end)b[axis+2]-=Math.ceil(length*fraction);else b[axis]+=Math.ceil(length*fraction);if(validBox(b,result))alternatives.push(b);}}best=choose(alternatives);if(!best)best=smallTextInkLayout(source,[...boxes,...alternatives],maximum,guards,result);}if(!best)return source;
 const shown={...source,mode:'restore',box:[...best.box],fontSize:best.layout.fontSize,automaticFontMaximum:maximum,automaticLayout:true,automaticRestoration:true,restorationMask:mask,restorationScope:'small-text',color:'#111'};delete shown.whiteBackground;delete shown.whiteScope;return shown;
}
function restorationPresentation(result,geometry,restoration){
 if(restoration?.version!==1||restoration.width!==result.width||restoration.height!==result.height||!Array.isArray(restoration.regions))return result;
 const proposed=outsidePresentation(result,geometry,true);
 return {...proposed,regions:proposed.regions.map((region,index)=>{
  const original=result.regions[index],mask=restoration.regions.find(item=>item.id===region.id&&item.sourceText===region.text&&JSON.stringify(item.sourceBox)===JSON.stringify(region.bbox));
  if(!mask||!validBox(mask.bounds,result))return original;
  if(mask.scope==='small-text'||mask.smallTextProof){const small=smallTextRestorationProof(mask,original,result);return small?smallTextPresentation(original,result,mask,small):original;}
  if(mask.isolatedGlyphProof&&!isolatedGlyphProof(mask,original,result))return original;
  const boundary=boundaryRestorationProof(mask,original,result);if(mask.boundaryProof&&!boundary||mask.scope==='boundary'&&!boundary)return original;
  const paragraph=paragraphRestorationProof(mask,original,result);if(mask.paragraphProof&&!paragraph)return original;
  if(original.textVerification?.method==='ocr-context'&&!verifiedTextMethod(original,result))return original;
  if(region.automaticOutside&&(mask.scope==='outside'||mask.scope===undefined&&!mask.bubble&&!mask.enclosure&&!mask.enclosureProof)&&!geometry?.bubbles?.some(b=>intersection(b.bbox,region.box)>0))return {...region,mode:'restore',color:'#111',restorationMask:mask,restorationScope:'outside',automaticRestoration:true};
  // An authorized outside mask may be close to a balloon without painting it.
  // Strong ordinary detections can also use this layout after white-box padding
  // rejects them; exact source authorization and all neighbor guards still apply.
  // Fit the translated text in the remaining free rectangles; the white-box
  // mode intentionally retains its stricter whole-background requirements.
  if(mask.scope==='outside'&&outsideCandidate(original)&&((original.textVerification?.version===1&&verifiedTextMethod(original,result)&&['LABEL','DIALOGUE'].includes(original.textVerification?.role))||(Number.isFinite(original.detectorConfidence)&&original.detectorConfidence>=.9&&original.detectorConfidence<=1)||isolatedGlyphProof(mask,original,result)||paragraph)&&validBox(original.bbox,result)&&validBox(original.box,result)&&boxArea(original.bbox)<=result.width*result.height*(paragraph?.4:.16)){
   if(!geometry||geometry.width!==result.width||geometry.height!==result.height||!Array.isArray(geometry.bubbles))return original;
   const protectedRegions=[...result.regions.filter(other=>other!==original),...(result.preservedRegions||[])];
   const verifiedPeer=other=>!other.manual&&outsideCandidate(other)&&other.textVerification?.version===1&&verifiedTextMethod(other,result)&&['LABEL','DIALOGUE'].includes(other.textVerification?.role)&&restoration.regions.some(item=>item.id===other.id&&item.scope==='outside'&&item.sourceText===other.text&&JSON.stringify(item.sourceBox)===JSON.stringify(other.bbox));
   if(protectedRegions.some(other=>!verifiedPeer(other)&&!restorationProtectsNeighbor(mask,other,result)&&validBox(other.bbox,result)&&restorationMaskOverlaps(mask,result,other.bbox)))return original;
   const scale=Math.min(result.width,result.height)/720,minimum=Math.max(8,Math.round(8*scale)),padding=Math.max(2,Math.ceil(2*scale));
   let boxes=[original.layoutOverride?original.box:paragraph?[original.bbox[0]+mask.paragraphProof.fringe,original.bbox[1]+padding,original.bbox[2]-padding,original.bbox[3]-padding]:original.bbox];
   // Unpainted neighbors occupy their verified glyph masks, not the empty
   // corners of their detector rectangles. Rendered peers keep box guards.
   const neighborGuard=r=>r.mode==='tooltip'&&!restoration.regions.some(item=>item.id===r.id)?segmentedNeighborProtection(mask,r,result):null;
   const effectGuards=protectedRegions.map(r=>effectProtection(mask,r,result)||neighborGuard(r)).filter(Boolean);
   const obstacles=[...geometry.bubbles.map(b=>b.bbox),...protectedRegions.filter(r=>!effectProtection(mask,r,result)&&!neighborGuard(r)).flatMap(r=>[r.bbox,r.box])].filter(b=>validBox(b,result));
   for(const obstacle of obstacles){const b=[obstacle[0]-padding,obstacle[1]-padding,obstacle[2]+padding,obstacle[3]+padding],next=[];
    for(const a of boxes){if(!intersection(a,b)){next.push(a);continue;}if(original.layoutOverride)continue;
     for(const box of [[a[0],a[1],Math.min(a[2],b[0]),a[3]],[Math.max(a[0],b[2]),a[1],a[2],a[3]],[a[0],a[1],a[2],Math.min(a[3],b[1])],[a[0],Math.max(a[1],b[3]),a[2],a[3]]])if(validBox(box,result))next.push(box);
    }boxes=next.sort((a,b)=>boxArea(b)-boxArea(a)).slice(0,16);if(!boxes.length)return original;
   }
   const fitAt=minimum=>boxes.map(box=>({box,layout:effectGuards.length?effectSafeLayout(original,box,original.layoutOverride?original.fontSize||32:Math.round(32*scale),minimum,effectGuards,result):textLayout(original,box,original.layoutOverride?original.fontSize||32:Math.round(32*scale),minimum)})).filter(x=>x.layout);
   let fitting=fitAt(minimum);
   // Small source annotations can need a font below the page-scaled minimum.
   // Retry only automatic layouts, retaining the normal absolute 8px floor
   // and every original geometry/ink guard.
   if(!fitting.length&&!original.layoutOverride&&minimum>8)fitting=fitAt(8);
   const best=fitting.sort((a,b)=>b.layout.fontSize-a.layout.fontSize||boxArea(b.box)-boxArea(a.box))[0];if(!best)return original;
   return {...original,box:[...best.box],fontSize:best.layout.fontSize,automaticFontMaximum:Math.max(original.automaticFontMaximum||0,original.layoutOverride?original.fontSize||32:Math.round(32*scale)),mode:'restore',color:'#111',restorationMask:mask,restorationScope:'outside',automaticOutside:true,automaticRestoration:true,automaticLayout:true};
  }
  const bounded=mask.scope==='enclosure';
  if((mask.scope!=='bubble'&&!bounded&&!boundary)||!outsideCandidate(original)||!validBox(original.bbox,result)||!validBox(original.box,result))return original;
  if(bounded){
   if(original.layoutOverride||original.panelCandidate)return original;
   const p=mask.enclosureProof,source=original.detectorConfidence;
   if(!p||p.version!==1||p.method!=='glyph-only-enclosure-intersection'||p.sourceText!==original.text||JSON.stringify(p.sourceBox)!==JSON.stringify(original.bbox)||!Number.isFinite(source)||source<.2||source>1||!Number.isFinite(p.sourceConfidence)||Math.abs(source-p.sourceConfidence)>.0001||!['verified-ocr','high-confidence-text','original-ocr-consensus','multi-view-ocr-consensus'].includes(p.reading)||!Array.isArray(p.guards)||!p.guards.length||p.guards.length>8||p.guards.some(g=>!validBox(g?.bbox,result)||!Number.isFinite(g.confidence)||g.confidence<.25||g.confidence>=.65))return original;
   if(p.reading==='high-confidence-text'&&source<.9||p.reading==='original-ocr-consensus'&&source<.65)return original;
   if(p.reading==='multi-view-ocr-consensus'&&(source<.9||!enclosureReadingProof(p.readingProof)))return original;
   if(p.reading==='verified-ocr'&&(!verifiedTextMethod(original,result)||!['LABEL','DIALOGUE'].includes(original.textVerification?.role)))return original;
  }
  // The server authorizes only glyph pixels inside a verified balloon. Use
  // that interior to fit text as well; keep each connected speech's own slot.
  const bubble=bounded?mask.enclosure:mask.bubble;
  try{if(!bubble||!Number.isFinite(bubble.confidence)||bubble.confidence<(bounded ? .25 : .65)||(bounded&&bubble.confidence>=.65)||!validBox(bubble.bbox,result)||whiteMask(bubble).area>.4||!bounded&&!boundary&&coverage(bubble,result,original.bbox)<.8||boundary&&(coverage(bubble,result,original.bbox)<.5||boxArea(bubble.bbox)>result.width*result.height*.15))return original;}catch{return original;}
  const scale=Math.min(result.width,result.height)/720,minimum=Math.max(8,Math.round(8*scale));
  const boxes=original.layoutOverride?[original.box]:boundary?maskRectangles(bubble,result,bubble.bbox):[original.bbox,...maskRectangles(bubble,result,original.bbox)];
  const protectedRegions=[...result.regions.filter(other=>other!==original),...(result.preservedRegions||[])];
  if(protectedRegions.some(other=>!restorationProtectsNeighbor(mask,other,result)&&[other.bbox,other.box].some(bounds=>validBox(bounds,result)&&restorationMaskOverlaps(mask,result,bounds))))return original;
  const effectGuards=protectedRegions.map(r=>effectProtection(mask,r,result)).filter(Boolean);
  const fitting=[],fitAt=minimum=>{
   for(const box of boxes){
    if(!bounded&&coverage(bubble,result,box)<.98||protectedRegions.some(other=>!effectProtection(mask,other,result)&&[other.bbox,other.box].some(bounds=>validBox(bounds,result)&&intersection(box,bounds)>0)))continue;
    const maximum=original.layoutOverride?original.fontSize||32:Math.round(32*scale);
    const layout=bounded?enclosureSafeLayout(original,box,maximum,minimum,bubble,effectGuards,result):effectGuards.length?effectSafeLayout(original,box,maximum,minimum,effectGuards,result):textLayout(original,box,maximum,minimum);
    if(layout)fitting.push({box,layout});
   }
  };
  fitAt(minimum);if(!original.layoutOverride&&!fitting.length&&minimum>8)fitAt(8);
  const best=fitting.sort((a,b)=>b.layout.fontSize-a.layout.fontSize||boxArea(b.box)-boxArea(a.box))[0];
  if(!best)return original;
  return {...original,box:[...best.box],fontSize:best.layout.fontSize,automaticFontMaximum:Math.max(original.automaticFontMaximum||0,original.layoutOverride?original.fontSize||32:Math.round(32*scale)),mode:'restore',color:'#111',restorationMask:mask,restorationScope:bounded?'enclosure':'bubble',automaticRestoration:true,automaticLayout:true};
 })};
}
// Exclude a duplicate hover surface only when the same text is already visible.
// Keep source/edit records intact; this changes interaction, not stored geometry.
function boundaryTooltipArtifact(region,result){
 const p=region.boundaryArtifact;
 if(!p||p.version!==1||p.method!=='connected-thin-balloon-outline'||p.id!==region.id||p.imageWidth!==result.width||p.imageHeight!==result.height||p.sourceText!==region.text||p.sourceConfidence!==region.detectorConfidence||region.type!=='effect'||region.mode!=='tooltip')return false;
 if(['manual','layoutOverride','displayOverride','ocrTruncated','truncated','panelCandidate'].some(flag=>region[flag])||region.textVerification)return false;
 if(!Array.isArray(region.bbox)||!Array.isArray(p.sourceBox)||region.bbox.length!==4||p.sourceBox.length!==4||!region.bbox.every((v,i)=>Number.isFinite(v)&&v===p.sourceBox[i]))return false;
 if(!Number.isFinite(p.sourceConfidence)||p.sourceConfidence<.2||p.sourceConfidence>.6||!Number.isFinite(p.balloonConfidence)||p.balloonConfidence<.85||p.balloonConfidence>1)return false;
 const radius=Math.max(1,Math.ceil(3*Math.min(result.width,result.height)/960));
 return Array.isArray(p.strokeEvidence)&&p.strokeEvidence.length===3&&p.strokeEvidence.every((m,i)=>m.threshold===[80,128,176][i]&&Number.isInteger(m.ink)&&m.ink>=16&&Number.isInteger(m.connected)&&m.connected>=m.ink*.98&&m.connected<=m.ink&&Number.isInteger(m.radius)&&m.radius>=1&&m.radius<=radius);
}
function tooltipRegions(result){
 const visible=result.regions.filter(direct);
 const key=value=>typeof value==='string'?value.trim().normalize('NFC'):'';
 const bounds=box=>Array.isArray(box)&&box.length===4&&box.every(Number.isFinite)&&box[2]>box[0]&&box[3]>box[1];
 return result.regions.filter(region=>{
  if(direct(region)||!region.translation)return false;
  if(boundaryTooltipArtifact(region,result))return false;
  if(visible.some(owner=>owner.restorationScope==='small-text'&&owner.automaticRestoration&&!owner.manual&&!owner.displayOverride&&owner.restorationMask?.smallTextProof?.effects?.some(e=>e.duplicateText&&e.id===region.id&&e.sourceText===region.text&&JSON.stringify(e.sourceBox)===JSON.stringify(region.bbox))))return false;
  if(region.manual||region.displayOverride||region.ocrTruncated||region.truncated||!key(region.text)||!bounds(region.bbox))return true;
  return !visible.some(owner=>{
   if(!bounds(owner.bbox)||key(owner.text)!==key(region.text)||key(owner.translation)!==key(region.translation))return false;
   const a=region.bbox,b=owner.bbox,overlap=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
   const aa=(a[2]-a[0])*(a[3]-a[1]),ba=(b[2]-b[0])*(b[3]-b[1]);
   return overlap/Math.min(aa,ba)>=.9&&overlap/Math.max(aa,ba)>=.2;
  });
 });
}
// Share the exact painted mask between rendering and hover exclusion.
function paintedWhiteMask(background){
 const mask=whiteMask(background);
  if(!mask.smooth){
   const canvas=document.createElement('canvas');canvas.width=mask.width*4;canvas.height=mask.height*4;
   const surface=canvas.getContext('2d',{willReadFrequently:true});surface.filter='blur(3px)';surface.drawImage(mask.canvas,0,0,canvas.width,canvas.height);surface.filter='none';
   const pixels=surface.getImageData(0,0,canvas.width,canvas.height);
   for(let offset=0;offset<pixels.data.length;offset+=4){pixels.data[offset]=255;pixels.data[offset+1]=255;pixels.data[offset+2]=255;pixels.data[offset+3]=Math.max(0,Math.min(255,(pixels.data[offset+3]-128)*16));}
   surface.putImageData(pixels,0,0);
   if(background.effectExclusions){const protectedMask=whiteMask(background.effectExclusions);surface.globalCompositeOperation='destination-out';surface.imageSmoothingEnabled=false;surface.drawImage(protectedMask.canvas,0,0,canvas.width,canvas.height);surface.globalCompositeOperation='source-over';}
   mask.smooth=canvas;
  }
 return mask;
}
function whiteHoverCuts(region,result){
 if(region.mode!=='white')return [];
 if(region.whiteBackground?.kind!=='bubble')return (region.manual?[region.box]:[region.bbox,region.box]).map(box=>[Math.max(0,box[0]-4),Math.max(0,box[1]-4),Math.min(result.width,box[2]+4),Math.min(result.height,box[3]+4)]);
 const mask=paintedWhiteMask(region.whiteBackground),canvas=mask.smooth;
 if(!mask.opaqueRects){
  const w=canvas.width,h=canvas.height,data=canvas.getContext('2d').getImageData(0,0,w,h).data,rectangles=[];let active=new Map();
  // Retain the antialiased boundary: only fully opaque pixels with an opaque
  // one-pixel neighborhood are guaranteed covered after image scaling.
  const opaque=(x,y)=>{for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++)if(data[((y+j)*w+x+i)*4+3]!==255)return false;return true;};
  for(let y=1;y<h-1;y++){
   const next=new Map();
   for(let x=1;x<w-1;){if(!opaque(x,y)){x++;continue;}const left=x++;while(x<w-1&&opaque(x,y))x++;const key=left+':'+x,previous=active.get(key);
    if(previous){previous[3]=y+1;next.set(key,previous);}else{const rectangle=[left,y,x,y+1];rectangles.push(rectangle);next.set(key,rectangle);}
   }active=next;
  }mask.opaqueRects=rectangles;
 }
 return mask.opaqueRects.map(([x,y,right,bottom])=>[x*result.width/canvas.width,y*result.height/canvas.height,right*result.width/canvas.width,bottom*result.height/canvas.height]);
}
// Cache translated ink geometry once per presentation, not on pointer movement.
const tooltipInk=new WeakMap();
function tooltipContours(region,result){
 let cuts=tooltipInk.get(result);
 if(!cuts){
  cuts=[];
  for(const owner of result.regions.filter(direct)){
   cuts.push(...whiteHoverCuts(owner,result));
   const layout=textLayout(owner),box=owner.box;
   let top=box[1]+(box[3]-box[1]-layout.height)/2;
   for(const metric of layout.metrics){
    const x=(box[0]+box[2]+metric.left-metric.right)/2,y=top+(metric.height-metric.ascent-metric.descent)/2+metric.ascent;
    cuts.push([x-metric.left-2,y-metric.ascent-2,x+metric.right+2,y+metric.descent+2]);top+=metric.height;
   }
  }
  tooltipInk.set(result,cuts);
 }
 const base=region.bbox;
 if(!Array.isArray(base)||base.length!==4||!base.every(Number.isFinite)||base[2]<=base[0]||base[3]<=base[1])return null;
 const hoverCuts=[...cuts],ownArea=(base[2]-base[0])*(base[3]-base[1]);
 for(const peer of tooltipRegions(result)){
  if(peer===region||region.id!=null&&peer.id===region.id||!validBox(peer.bbox,result))continue;
  const b=peer.bbox,area=(b[2]-b[0])*(b[3]-b[1]);
  if(area<ownArea&&intersection(base,b)>0)hoverCuts.push(b);
 }
 const polygon=globalThis.MangaPolygon?.clip(region,result,hoverCuts,true);
 if(polygon!=null)return polygon;
 let pieces=[base],changed=false;
 for(const cut of hoverCuts){
  pieces=pieces.flatMap(box=>{
   const left=Math.max(box[0],cut[0]),top=Math.max(box[1],cut[1]),right=Math.min(box[2],cut[2]),bottom=Math.min(box[3],cut[3]);
   if(right<=left||bottom<=top)return [box];
   changed=true;
   return [[box[0],box[1],box[2],top],[box[0],bottom,box[2],box[3]],[box[0],top,left,bottom],[right,top,box[2],bottom]].filter(r=>r[2]>r[0]&&r[3]>r[1]);
  });
 }
 if(!changed)return null;
 return pieces.map(([left,top,right,bottom])=>[[left,top],[right,top],[right,bottom],[left,bottom]].map(([x,y])=>[(x-base[0])/(base[2]-base[0]),(y-base[1])/(base[3]-base[1])]));
}
// Retain the CSS form for geometry consumers. Live overlays use separate SVG
// contours: bridged CSS polygons can stall Edge's native hover hit testing.
function tooltipClip(region,result){
 const contours=tooltipContours(region,result);if(contours===null)return '';
 if(!contours.length)return 'polygon(0% 0%,0% 0%,0% 0%)';
 const points=['0% 0%'];
 for(const contour of contours){const p=contour.map(([x,y])=>`${x*100}% ${y*100}%`);if(p.length)points.push(...p,p[0],'0% 0%');}
 return `polygon(evenodd,${points.join(',')})`;
}
function presentation(result,mode,geometry,outsideMode='tooltip',restoration){
 const previousMeasures=presentationMeasures,previousWraps=presentationWraps,previousSegments=presentationSegments;presentationMeasures=new Map();presentationWraps=new Map();presentationSegments=new Map();
 try{
 const guarded={...result,regions:result.regions.map(r=>punctuationMismatch(r,result)?{...r,mode:'tooltip',automaticPunctuation:true}:r)};
 const shown=bubblePresentation(guarded,mode,geometry);
 if(outsideMode==='restore')return restorationPresentation(shown,geometry,restoration);
 return outsideMode==='white'?outsidePresentation(shown,geometry):shown;
 }finally{presentationMeasures=previousMeasures;presentationWraps=previousWraps;presentationSegments=previousSegments;}
}
function editedBase(result,base){
 if(!base)return result;
 return {...result,regions:result.regions.map(region=>{
  const prior=base.regions.find(candidate=>candidate.id===region.id);
  if(!prior)return region;
  const restored={...region};
  const keys=region.displayOverride?[]:['mode','whiteScope','whiteBackground','displayOverride','restorationMask'];
  if(!region.layoutOverride)keys.push('box','fontSize','color');
  for(const key of keys){
   if(Object.hasOwn(prior,key))restored[key]=prior[key];else delete restored[key];
  }
  delete restored.automaticFontMaximum;delete restored.automaticPunctuation;delete restored.automaticGroup;delete restored.automaticLayout;delete restored.automaticOutside;delete restored.automaticRestoration;delete restored.restorationScope;
  return restored;
 })};
}
function paintWhite(context,result,region){
 if(region.mode!=='white'||!region.translation?.trim()||!direct(region))return;
 if(region.whiteBackground?.kind==='bubble'){
  const mask=paintedWhiteMask(region.whiteBackground);
  context.drawImage(mask.smooth,0,0,result.width,result.height);return;
 }
 context.fillStyle='#fff';
 for(const box of region.manual?[region.box]:[region.bbox,region.box]){
  const left=Math.max(0,box[0]-4),top=Math.max(0,box[1]-4),right=Math.min(result.width,box[2]+4),bottom=Math.min(result.height,box[3]+4);
  context.fillRect(left,top,right-left,bottom-top);
 }
}
function drawRegion(ctx,r){
 if(!direct(r)||!r.translation)return;
 const [x1,y1,x2,y2]=r.box, w=x2-x1,h=y2-y1;
 const layout=textLayout(r);if(!layout)return;
 const size=layout.fontSize,lines=layout.lines;ctx.font=font(size);
 ctx.save();ctx.beginPath();ctx.rect(x1,y1,w,h);ctx.clip();

 ctx.fillStyle=r.mode==='white'?'#111':r.color||'#111';ctx.textAlign='left';ctx.textBaseline='alphabetic';
 let top=y1+(h-layout.height)/2;
 lines.forEach((line,index)=>{const metric=layout.metrics[index],x=(x1+x2+metric.left-metric.right)/2,y=top+(metric.height-metric.ascent-metric.descent)/2+metric.ascent;if(r.mode==='restore'){ctx.strokeStyle='#fff';ctx.lineWidth=Math.max(2,size*.15);ctx.lineJoin='round';ctx.strokeText(line,x,y);}ctx.fillText(line,x,y);top+=metric.height;});ctx.restore();
}
function prepare(result){return result;}
const restorationMasks=new WeakMap();
function restorationMaskCanvas(mask,result){
 if(restorationMasks.has(mask))return restorationMasks.get(mask).canvas;
 if(!validBox(mask.bounds,result)||!mask.bounds.every(Number.isInteger))throw Error('복원 범위가 올바르지 않습니다.');
 const [x0,y0,x1,y1]=mask.bounds,width=x1-x0,height=y1-y0,runs=mask.runs;
 if(width*height>4000000||!Array.isArray(runs)||runs.length%2||runs.length>200000)throw Error('복원 마스크가 올바르지 않습니다.');
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d'),data=ctx.createImageData(width,height),bits=new Uint8Array(width*height);let end=0;
 for(let i=0;i<runs.length;i+=2){const start=runs[i],length=runs[i+1];if(!Number.isInteger(start)||!Number.isInteger(length)||start<end||length<1||start+length>width*height)throw Error('복원 마스크가 올바르지 않습니다.');end=start+length;bits.fill(1,start,end);for(let p=start;p<end;p++)data.data[p*4+3]=255;}
 ctx.putImageData(data,0,0);restorationMasks.set(mask,{canvas,bits,width,height});return canvas;
}
function restorationMaskOverlaps(mask,result,box){
 if(!intersection(mask.bounds,box))return false;
 restorationMaskCanvas(mask,result);const {bits,width}=restorationMasks.get(mask),[x0,y0,x1,y1]=mask.bounds;
 // The enclosing rectangle includes unpainted padding. Protect nearby text
 // using the authorized pixels, including manual display boxes, instead.
 for(let y=Math.max(y0,Math.floor(box[1]));y<Math.min(y1,Math.ceil(box[3]));y++)for(let x=Math.max(x0,Math.floor(box[0]));x<Math.min(x1,Math.ceil(box[2]));x++)if(bits[(y-y0)*width+x-x0])return true;
 return false;
}
async function render(canvas,result,original,cleaned,restored){
 prepare(result);
 canvas.width=result.width;canvas.height=result.height;
 // These full-page buffers are copied/exported, not animated. Keep their
 // backing stores off the inference GPU and avoid delayed texture reclamation.
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(await image(original),0,0);
 const clean=await image(cleaned);
 const restoring=result.regions.filter(region=>region.mode==='restore'&&!region.manualRestoration&&direct(region));
 if(restoring.length){
  if(!restored)throw Error('복원 이미지가 아직 준비되지 않았습니다. 다시 적용하세요.');
  const restoredImage=await image(restored);
  if(restoredImage.width!==result.width||restoredImage.height!==result.height)throw Error('복원 이미지 크기가 다릅니다.');
  for(const region of restoring){const mask=region.restorationMask,alpha=restorationMaskCanvas(mask,result),[x0,y0,x1,y1]=mask.bounds;const patch=document.createElement('canvas');patch.width=x1-x0;patch.height=y1-y0;const surface=patch.getContext('2d',{willReadFrequently:true});try{surface.drawImage(restoredImage,x0,y0,patch.width,patch.height,0,0,patch.width,patch.height);surface.globalCompositeOperation='destination-in';surface.drawImage(alpha,0,0);ctx.drawImage(patch,x0,y0);}finally{patch.width=0;patch.height=0;}}
 }
 // Restore original per region when user chooses tooltip/original mode.
 for(const r of result.regions)if(r.mode==='replace'&&!r.manual&&direct(r)){
   const [x1,y1,x2,y2]=r.bbox;const x=Math.max(0,x1-3),y=Math.max(0,y1-3),w=Math.min(result.width,x2+3)-x,h=Math.min(result.height,y2+3)-y;
   ctx.drawImage(clean,x,y,w,h,x,y,w,h);
 }
 for(const region of result.regions)paintWhite(ctx,result,region);
 for(const r of result.regions)if(r.mode==='restore'&&r.manualRestoration){const ref=checkedManual(r.manualRestoration,result),patch=await manualImage(ref,result),b=ref.mask.bounds;if(patch.width!==b[2]-b[0]||patch.height!==b[3]-b[1])throw Error('수동 복원 이미지 크기가 다릅니다.');const layer=document.createElement('canvas');layer.width=patch.width;layer.height=patch.height;const c=layer.getContext('2d',{willReadFrequently:true});try{c.drawImage(patch,0,0);c.globalCompositeOperation='destination-in';c.drawImage(restorationMaskCanvas(ref.mask,result),0,0);ctx.drawImage(layer,b[0],b[1]);}finally{layer.width=0;layer.height=0;}}
 for(const r of result.regions)drawRegion(ctx,r);
 return canvas;
}
globalThis.MangaRender={setAssetLoader,image,render,prepare,direct,tooltipRegions,tooltipClip,tooltipContours,whiteBackground,coverage,whiteCandidate,outsideCandidate,presentation,editedBase,textLayout};
})();
