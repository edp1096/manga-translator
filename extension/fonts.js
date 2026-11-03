/* Packaged, unmodified KERIS school-safe fonts; see fonts/LICENSE.txt. */
(() => {
if(globalThis.MangaFonts)return;
const catalog=Object.freeze({dialogue:'바른돋움',friendly:'우주',reflective:'가을소풍',narration:'바른바탕',shout:'물결'});
const legacy=size=>`600 ${size}px "Noto Sans CJK KR", "Malgun Gothic", sans-serif`;
let loader,revision=0;const pending=new Map(),loaded=new Set();
function choice(region,target,light=false){
 if(light)return 'default';
 if(region.fontChoice==='default'||Object.hasOwn(catalog,region.fontChoice))return region.fontChoice;
 if(target!=='Korean')return 'default';
 const role=region.fontStyle?.role;
 if(Object.hasOwn(catalog,role))return role;
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
function decorate(result,light=result._fontLight===true){return {...result,_fontLight:light,regions:result.regions.map(r=>({...r,_fontId:choice(r,result.target,light)}))};}
function css(size,region){const id=region?._fontId;return loaded.has(id)?`400 ${size}px "MangaSchool_${id}", "Noto Sans CJK KR", "Malgun Gothic", sans-serif`:legacy(size);}
globalThis.MangaFonts={catalog,choice,ensure,decorate,css,get revision(){return revision;},setLoader(value){loader=value;}};
})();
