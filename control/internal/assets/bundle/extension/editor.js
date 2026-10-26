const $=id=>document.getElementById(id),job=new URLSearchParams(location.search).get('job');
const rpc=async msg=>{const r=await chrome.runtime.sendMessage(msg);if(!r?.ok)throw Error(r?.error||'확장 오류');return r.value;};
let result,original,cleaned,selected=0,showOriginal=false,drawSeq=0;
const tell=t=>$('status').textContent=t;
async function draw(){
 const seq=++drawSeq;const canvas=document.createElement('canvas');
 if(showOriginal){canvas.width=result.width;canvas.height=result.height;canvas.getContext('2d').drawImage(await MangaRender.image(original),0,0);}else await MangaRender.render(canvas,result,original,cleaned);
 if(seq!==drawSeq)return;$('canvas').width=canvas.width;$('canvas').height=canvas.height;$('canvas').getContext('2d').drawImage(canvas,0,0);handles();
}
function refreshRegions(){
 $('regions').replaceChildren();for(const [i,r]of result.regions.entries())$('regions').append(new Option(`${i+1}. ${r.text.slice(0,24)||'새 글상자'}`,String(i)));
 $('add').disabled=result.regions.length>=150;select(selected);
}
function select(i){selected=i;const r=result.regions[i];
 for(const id of ['source','translation','mode','font','reset','delete','regions'])$(id).disabled=!r;
 $('regions').value=r?String(i):'';$('source').value=r?.text||'';$('translation').value=r?.translation||'';$('mode').value=r?.mode||'replace';$('font').value=r?.fontSize||24;handles();
}
$('add').onclick=()=>{
 if(!result||result.regions.length>=150)return;
 const w=Math.min(result.width,Math.max(24,result.width*.25)),h=Math.min(result.height,Math.max(24,result.height*.12));
 const x=(result.width-w)/2,y=(result.height-h)/2,box=[x,y,x+w,y+h];
 result.regions.push({id:crypto.randomUUID(),manual:true,bbox:[...box],box,text:'',translation:'',mode:'replace',fontSize:24,color:'#111'});
 selected=result.regions.length-1;showOriginal=false;$('toggle').textContent='원본 보기';refreshRegions();draw();$('translation').focus();tell('글상자를 추가했습니다. 번역문을 입력하고 위치를 조정하세요.');
};
$('delete').onclick=()=>{if(!result?.regions[selected])return;result.regions.splice(selected,1);selected=Math.max(0,Math.min(selected,result.regions.length-1));refreshRegions();draw();tell('선택한 글상자를 삭제했습니다. 페이지에 적용하면 저장됩니다.');};
document.addEventListener('keydown',e=>{if(e.key==='Delete'&&!e.target.closest('input,textarea,select,[contenteditable]')){e.preventDefault();$('delete').click();}});
function handles(){
 $('handles').replaceChildren();if(showOriginal)return;
 result.regions.forEach((r,i)=>{
  const box=document.createElement('div');box.className='box'+(i===selected?' selected':'');const [x1,y1,x2,y2]=r.box;
  Object.assign(box.style,{left:x1/result.width*100+'%',top:y1/result.height*100+'%',width:(x2-x1)/result.width*100+'%',height:(y2-y1)/result.height*100+'%'});
  const resize=document.createElement('span');resize.className='resize';box.append(resize);
  box.onpointerdown=e=>{
   e.preventDefault();selected=i;const r=result.regions[i];$('regions').value=String(i);$('source').value=r.text;$('translation').value=r.translation;$('mode').value=r.mode;$('font').value=r.fontSize;
   const start=[e.clientX,e.clientY],old=[...r.box],s=result.width/$('canvas').getBoundingClientRect().width,isResize=e.target===resize;
   box.setPointerCapture(e.pointerId);
   box.onpointermove=ev=>{const dx=(ev.clientX-start[0])*s,dy=(ev.clientY-start[1])*s;
    if(isResize)r.box=[old[0],old[1],Math.min(result.width,Math.max(old[0]+12,old[2]+dx)),Math.min(result.height,Math.max(old[1]+12,old[3]+dy))];
    else{const x=Math.max(0,Math.min(result.width-(old[2]-old[0]),old[0]+dx)),y=Math.max(0,Math.min(result.height-(old[3]-old[1]),old[1]+dy));r.box=[x,y,x+old[2]-old[0],y+old[3]-old[1]];}
    const b=r.box;Object.assign(box.style,{left:b[0]/result.width*100+'%',top:b[1]/result.height*100+'%',width:(b[2]-b[0])/result.width*100+'%',height:(b[3]-b[1])/result.height*100+'%'});
   };box.onpointerup=()=>{box.onpointermove=null;draw();};
  };$('handles').append(box);
 });
}
for(const [id,prop]of [['source','text'],['translation','translation'],['mode','mode'],['font','fontSize']])$(id).oninput=()=>{if(!result?.regions[selected])return;result.regions[selected][prop]=id==='font'?Math.max(8,Math.min(100,Number($(id).value)||24)):$(id).value;draw();};
$('regions').onchange=()=>select(Number($('regions').value));
$('reset').onclick=()=>{if(result.regions[selected]){result.regions[selected].box=[...result.regions[selected].bbox];draw();}};
$('toggle').onclick=()=>{showOriginal=!showOriginal;$('toggle').textContent=showOriginal?'번역 보기':'원본 보기';draw();};
$('apply').onclick=async()=>{try{await rpc({type:'apply',id:job,result});tell('원본 페이지에 적용했습니다.');}catch(e){tell(e.message);}};
function download(url,name){const a=document.createElement('a');a.href=url;a.download=name;a.click();}
$('png').onclick=async()=>{try{const c=document.createElement('canvas');await MangaRender.render(c,result,original,cleaned);download(c.toDataURL('image/png'),`translated-${job}.png`);}catch(e){tell(e.message);}};
$('project').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));download(url,`translation-${job}.json`);setTimeout(()=>URL.revokeObjectURL(url),10000);};
(async()=>{try{const saved=(await chrome.storage.local.get('edit:'+job))['edit:'+job];if(!saved)throw Error('페이지의 편집 버튼으로 열어주세요.');result=MangaRender.prepare(saved.result);[original,cleaned]=await Promise.all(['original.png','cleaned.png'].map(name=>rpc({type:'asset',id:job,name})));refreshRegions();await draw();tell(`${result.regions.length}개 영역`);}catch(e){tell(e.message);}})();
