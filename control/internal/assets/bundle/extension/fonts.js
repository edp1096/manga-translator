/* Packaged, unmodified KERIS school-safe fonts; see fonts/LICENSE.txt. */
(() => {
if(globalThis.MangaFonts)return;
const catalog=Object.freeze({dialogue:'바른돋움',reflective:'날개',narration:'바른바탕',shout:'여행',impact:'투호'});
const legacy=size=>`600 ${size}px "Noto Sans CJK KR", "Malgun Gothic", sans-serif`;
let loader,revision=0;const pending=new Map(),loaded=new Set();
function choice(region,target,light=false){
 if(light)return 'default';
 if(region.fontChoice==='friendly')return 'dialogue';
 if(region.fontChoice==='default'||Object.hasOwn(catalog,region.fontChoice))return region.fontChoice;
 if(target!=='Korean')return 'default';
 const role=region.fontStyle?.role;
 const short=typeof region.translation==='string'&&!!region.translation.trim()&&[...region.translation.replace(/\s/gu,'')].length<=24;
 const effect=region.type==='effect'&&!['DIALOGUE','LABEL'].includes(region.textVerification?.role);
 // Old emotional labels are not enough evidence to change body typography.
 if(role==='impact'&&effect&&short)return 'impact';
 if(role==='narration'&&!effect)return 'narration';
 if(role==='shout'&&short&&!effect)return 'shout';
 return 'dialogue';
}
async function ensure(result,light=result._fontLight===true){
 const ids=new Set(result.regions.map(r=>choice(r,result.target,light)));
 await Promise.all([...ids].filter(id=>id!=='default').map(id=>{
  if(!pending.has(id))pending.set(id,(async()=>{
   try{
    if(!loader||typeof FontFace==='undefined')return;
    const data=await loader(id),bytes=typeof data==='string'?Uint8Array.from(atob(data.slice(data.indexOf(',')+1)),c=>c.charCodeAt(0)):data;
    const face=await new FontFace('MangaSchool_'+id,bytes,{weight:'400'}).load();
    document.fonts.add(face);loaded.add(id);revision++;
   }catch(error){console.warn('Manga font fallback:',id,error.message);}
  })());
  return pending.get(id);
 }));
}
function decorate(result,light=result._fontLight===true){return {...result,_fontLight:light,regions:result.regions.map(r=>({...r,_fontId:choice(r,result.target,light),_fontLight:light}))};}
function weight(region){
 if(region?._fontLight)return 400;
 if(region?.fontWeight===400||region?.fontWeight===700)return region.fontWeight;
 // Reuse semantic classification; punctuation alone does not make speech bold.
 return ['shout','impact'].includes(choice({...region,fontChoice:undefined},'Korean'))?700:400;
}
function css(size,region){const id=region?._fontId;return loaded.has(id)?`${weight(region)} ${size}px "MangaSchool_${id}", "Noto Sans CJK KR", "Malgun Gothic", sans-serif`:!region?._fontLight&&(region?.fontWeight===400||region?.fontWeight===700)?`${region.fontWeight} ${size}px "Noto Sans CJK KR", "Malgun Gothic", sans-serif`:legacy(size);}
globalThis.MangaFonts={catalog,choice,weight,ensure,decorate,css,get revision(){return revision;},setLoader(value){loader=value;}};
})();
