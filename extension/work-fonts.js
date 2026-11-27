(() => {
const $=id=>document.getElementById(id);
const query=new URLSearchParams(location.search);
const pageURL=query.get('page');
const tabId=query.has('tab')?Number(query.get('tab')):undefined;
const form=$('work-font-form'),preset=$('work-preset'),roles=$('work-roles'),status=$('status'),save=form.querySelector('button');
const fields=new Map();
let workKey,working;

async function rpc(message){
 const response=await chrome.runtime.sendMessage(message);
 if(!response?.ok)throw Error(response?.error||'작품 글꼴 설정을 불러오지 못했습니다.');
 return response.value;
}

MangaFonts.setLoader((id,weight)=>rpc({type:'font',id,weight}));

for(const [id,label] of Object.entries(MangaFonts.workPresets))preset.add(new Option(label,id));

function buildRole(id,title,rule){
 const fieldset=document.createElement('fieldset');
 const legend=document.createElement('legend');legend.textContent=title;
 const row=document.createElement('div');row.className='font-policy-row';
 const label=document.createElement('label');label.className='font-policy-choice';label.textContent='기본 글꼴';
 const select=document.createElement('select');select.id='work-font-'+id;select.add(new Option('기본 글꼴','default'));
 const boldLabel=document.createElement('label');boldLabel.className='font-policy-bold';
 const bold=document.createElement('input');bold.type='checkbox';bold.id='work-bold-'+id;bold.checked=rule.bold;
 label.append(select);boldLabel.append(bold,' 볼드 사용');row.append(label,boldLabel);
 const details=document.createElement('details');details.className='candidate-fonts';
 const summary=document.createElement('summary'),list=document.createElement('div');list.className='candidate-list';
 const choices=new Map();
 for(const group of MangaFonts.groups)for(const font of group.ids){
  const option=document.createElement('label'),input=document.createElement('input');
  input.type='checkbox';input.checked=rule.candidates.includes(font);
  option.append(input,MangaFonts.label(font));list.append(option);choices.set(font,input);
 }
 function syncCandidates(){
  const count=[...choices.values()].filter(input=>input.checked&&!input.disabled).length;
  summary.textContent='자동 후보'+(count?' '+count+'개':' 없음');
 }
 function syncFallback(){
  for(const [font,input] of choices)input.disabled=font===select.value;
  syncCandidates();
 }
 details.append(summary,list);fieldset.append(legend,row,details);roles.append(fieldset);
 const preview=MangaFontPreview.attach(select,()=>({region:{fontChoice:select.value,fontWeight:bold.checked?700:400}}));
 select.value=[...select.options].some(option=>option.value===rule.fallback)?rule.fallback:MangaFonts.presetPolicy(preset.value).roles[id].fallback;
 syncFallback();
 select.addEventListener('change',syncFallback);
 bold.addEventListener('change',preview.update);
 list.addEventListener('change',syncCandidates);
 fields.set(id,{select,bold,choices});
 preview.update();
}
function display(profile){
 fields.clear();roles.replaceChildren();
 preset.value=profile?.preset||'inherit';
 roles.hidden=!profile;
 if(profile)for(const [id,title] of Object.entries(MangaFonts.roles))buildRole(id,title,profile.roles[id]);
}
preset.addEventListener('change',()=>{
 display(MangaFonts.presetPolicy(preset.value));
 status.textContent='';
});
form.addEventListener('submit',async event=>{
 event.preventDefault();
 if(working||!workKey)return;
 let profile=null;
 if(preset.value!=='inherit'){
  const values={};
  for(const [role,{select,bold,choices}] of fields)values[role]={
   fallback:select.value,bold:bold.checked,candidates:[...choices].filter(([,input])=>input.checked&&!input.disabled).map(([font])=>font)
  };
  profile={preset:preset.value,roles:values};
 }
 working=true;save.disabled=true;
 try{
  await rpc({type:'saveWorkFontPolicy',key:workKey,profile});
  status.textContent='저장했습니다.';
 }catch(error){status.textContent=error.message;}
 finally{working=false;save.disabled=false;}
});

(async()=>{
 try{
  if(!pageURL)throw Error('만화 패널의 표시 옵션에서 작품 글꼴을 여세요.');
  const preferences=await rpc({type:'settings',pageURL,tabId});
  if(!preferences.workFontKey)throw Error('작품 주소를 찾지 못했습니다.');
  workKey=preferences.workFontKey;
  MangaFonts.registerAdded(preferences.addedFonts);
  const title=query.get('title');
  if(title){$('work-title').textContent=title;$('work-title').hidden=false;}
  $('work-scope').textContent=workKey;
  display(preferences.workFontPolicy);
  preset.disabled=save.disabled=false;
 }catch(error){status.textContent=error.message;}
})();
})();
