/* Shared font specimens for settings and editor; no OS font installation. */
(() => {
const sample='오늘은 어떤 이야기가 펼쳐질까?';
function attach(select,read){
 const selected=select.value;
 for(const option of [...select.options])if(Object.hasOwn(MangaFonts.catalog,option.value))option.remove();
 for(const group of MangaFonts.groups)for(const id of group.ids)select.append(new Option('학교안심 '+MangaFonts.catalog[id],id));
 select.value=selected;

 const root=document.createElement('div');root.className='font-preview';
 const caption=document.createElement('small'),text=document.createElement('div');text.className='font-preview-sample';
 const details=document.createElement('details'),summary=document.createElement('summary'),grid=document.createElement('div');
 summary.textContent=select.closest('.font-policy-row')?'글꼴 비교':'글꼴 비교 · 눌러서 선택';grid.className='font-preview-grid';details.append(summary,grid);root.append(caption,text,details);select.closest('label').after(root);
 let sequence=0;
 async function update(){
  const seq=++sequence,{region={},target='Korean',light=false,fontDefaults}=read();
  const result={target,fontDefaults,regions:[region]};text.textContent='글꼴 불러오는 중…';
  await MangaFonts.ensure(result,light);if(seq!==sequence)return;
  const id=MangaFonts.choice(region,target,light),decorated=MangaFonts.decorate(result,light).regions[0];
  caption.textContent=(select.value==='mixed'?'현재 영역: ':select.value==='auto'?'자동 → ':'')+(MangaFonts.catalog[id]||'기본 글꼴')+(light?' · 경량 처리':'');
  text.style.font=MangaFonts.css(23,decorated);text.textContent=region.translation||sample;
  text.title=text.textContent;
  if(details.open)await compare(seq,region,fontDefaults);
 }
 async function compare(seq,region,fontDefaults){
  const result={target:'Korean',fontDefaults,regions:MangaFonts.groups.flatMap(group=>group.ids).map(fontChoice=>({...region,fontChoice}))};
  await MangaFonts.ensure(result);if(seq!==sequence||!details.open)return;
  grid.replaceChildren();
  const decorated=MangaFonts.decorate(result).regions;
  for(const group of MangaFonts.groups){
   for(const id of group.ids){const r=decorated.find(r=>r.fontChoice===id);
   const button=document.createElement('button');button.type='button';button.disabled=select.disabled;
   button.setAttribute('aria-pressed',String(select.value===r.fontChoice));
   const name=document.createElement('small'),specimen=document.createElement('span');name.textContent=MangaFonts.catalog[r.fontChoice];specimen.textContent=sample;specimen.style.font=MangaFonts.css(22,r);button.append(name,specimen);
   button.onclick=()=>{if(select.disabled)return;select.value=r.fontChoice;select.dispatchEvent(new Event('change',{bubbles:true}));};grid.append(button);
   }
  }
 }
 details.addEventListener('toggle',()=>{if(details.open)update();});
 select.addEventListener('change',update);
 return {update};
}
globalThis.MangaFontPreview={attach};
})();
