<script>
 import {onMount} from 'svelte';
 import {deleteLibraryJobs} from './library-delete.mjs';
 let {request,extensionMessage,locked}= $props();
 let data=$state(null),query=$state(''),busy=$state(false),error=$state(''),notice=$state(''),selection=$state([]),editing=$state(null),workTitle=$state('');
 let chapterSelection=$state([]),pendingDelete=$state(null),expanded=$state({}),expandDefault=$state(true);
 const chapterKey=c=>c.url+'\n'+c.target;
 function expandAll(value){expandDefault=value;expanded={};}
 let groups=$derived.by(()=>{const map=new Map();for(const c of data?.chapters||[]){const key=c.groupID?'group:'+c.groupID:'source:'+c.work;if(!map.has(key)){const saved=data.groups?.find(g=>g.id===c.groupID);map.set(key,{key,id:c.groupID,title:c.groupTitle||c.title||c.work,sources:saved?.sources||[c.work],chapters:[]})}map.get(key).chapters.push(c)}return [...map.values()].map(g=>({...g,chapters:g.chapters.sort((a,b)=>compareChapters(a,b))}));});
 async function load(){busy=true;error='';try{data=await request('library?q='+encodeURIComponent(query),undefined,120000);selection=[];chapterSelection=[];pendingDelete=null}catch(e){error=e.message}finally{busy=false}}
 async function read(c){error='';try{await extensionMessage({type:'control-read',url:c.url,target:c.target})}catch(e){error=e.message+' 원본 링크를 직접 연 뒤 확장 패널에서 저장된 번역 언어를 선택해 불러올 수도 있습니다.'}}
 async function keep(c,value){busy=true;error='';try{for(let i=0;i<c.ids.length;i+=500)await request('jobs/keep',{ids:c.ids.slice(i,i+500),keep:value});notice=value?'회차를 보관했습니다. 자동 정리에서 제외됩니다.':'회차 보관을 해제했습니다.';await load()}catch(e){error=e.message}finally{busy=false}}
 function beginMerge(items){editing=[...new Set(items.flatMap(g=>g.sources))];workTitle=items.length===1?items[0].title:'';error='';notice=''}
 async function merge(){busy=true;error='';try{await request('library/groups/merge',{title:workTitle,sources:editing});editing=null;notice='작품 연결을 저장했습니다. 연결한 작품 주소의 새 회차도 함께 표시됩니다.';await load()}catch(e){error=e.message}finally{busy=false}}
 async function detach(group,source=''){busy=true;error='';try{await request('library/groups/detach',{id:group.id,source});editing=null;notice='작품 연결을 해제했습니다. 번역 결과는 각 원본 주소에 그대로 남습니다.';await load()}catch(e){error=e.message}finally{busy=false}}
 async function beginDelete(sources=[],keys=[]){
  if(busy||locked())return;busy=true;error='';notice='';editing=null;pendingDelete=null;
  try{
   // Resolve whole works from the unfiltered library, never just search hits.
   const full=await request('library',undefined,120000);
   const chapters=full.chapters.filter(c=>sources.includes(c.work)||keys.includes(chapterKey(c)));
   const ids=[...new Set(chapters.flatMap(c=>c.ids))];
   if(!ids.length)throw Error('삭제할 작업이 없습니다. 목록을 새로고침하세요.');
   pendingDelete={chapters,ids,kept:chapters.reduce((n,c)=>n+c.kept,0)};
  }catch(e){error=e.message}finally{busy=false}
 }
 async function remove(){
  if(busy||locked()||!pendingDelete||pendingDelete.kept)return;
  const ids=[...pendingDelete.ids];busy=true;error='';notice='';
  try{
   const outcome=await deleteLibraryJobs(ids,extensionMessage);
   await load();notice=outcome.deleted.length?`${outcome.deleted.length}개 작업을 삭제했습니다.`:'';
   error=[error,outcome.error,outcome.cacheError].filter(Boolean).join(' ');
  }finally{busy=false}
 }
 function chapterNumber(c){const path=new URL(c.url).pathname;return path.match(/(?:[-_](?:chapter|chap|ch|episode|ep)[-_]?|\/ch)(\d+(?:\.\d+)?)(?:[-_./]|$)/i)?.[1]||c.title?.match(/(?:chapter|chap|episode)\s*(\d+(?:\.\d+)?)/i)?.[1]||c.title?.match(/(\d+(?:\.\d+)?)\s*(?:화|話)/)?.[1]}
 function compareChapters(a,b){const x=chapterNumber(a),y=chapterNumber(b);return (x&&y?x.localeCompare(y,undefined,{numeric:true}):0)||a.url.localeCompare(b.url,undefined,{numeric:true})||a.target.localeCompare(b.target)}
 onMount(load);
</script>
<section class="page-heading"><div><h1>번역 서재</h1><p>저장된 회차를 찾아 재번역 없이 다시 읽습니다.</p></div><button class="button secondary" onclick={load} disabled={busy}>목록 새로고침</button></section>
<form class="jobs-toolbar" onsubmit={e=>{e.preventDefault();load()}}><input aria-label="서재 검색" placeholder="작품 제목·회차 주소 검색" bind:value={query}/><button class="button secondary" disabled={busy}>검색</button></form>
<div class="link-toolbar"><button class="button secondary" disabled={busy||!groups.length} onclick={()=>expandAll(true)}>모두 펼치기</button><button class="button secondary" disabled={busy||!groups.length} onclick={()=>expandAll(false)}>모두 접기</button></div>
<div class="link-toolbar"><span>작품 {selection.length}개 선택</span><button class="button secondary" disabled={busy||selection.length<2} onclick={()=>beginMerge(groups.filter(g=>selection.includes(g.key)))}>같은 작품으로 묶기</button><button class="button secondary" disabled={busy||locked()||!selection.length} onclick={()=>beginDelete(groups.filter(g=>selection.includes(g.key)).flatMap(g=>g.sources))}>선택 작품 삭제</button><button class="button secondary" disabled={busy||locked()||!chapterSelection.length} onclick={()=>beginDelete([],chapterSelection)}>선택 회차 삭제 ({chapterSelection.length})</button></div>
{#if editing}<form class="card link-editor" onsubmit={e=>{e.preventDefault();merge()}}><label>작품 이름<input aria-label="묶을 작품 이름" maxlength="120" required bind:value={workTitle} placeholder="서재에 표시할 작품 이름"/></label><ul>{#each editing as source}<li>{source}</li>{/each}</ul><p>선택한 작품 주소를 연결합니다. 같은 회차도 사이트별 번역을 각각 유지합니다.</p><div class="actions"><button class="button primary" disabled={busy||!workTitle.trim()}>연결 저장</button><button type="button" class="button secondary" disabled={busy} onclick={()=>editing=null}>취소</button></div></form>{/if}
{#if pendingDelete}<section class="card delete-confirm" aria-label="서재 삭제 확인"><strong>{pendingDelete.chapters.length}개 회차·언어 / {pendingDelete.ids.length}개 작업 삭제</strong><p>선택 범위의 원본·번역 결과·복원 이미지와 확장 캐시를 영구 삭제합니다. 작품 삭제는 검색에 숨겨진 회차와 다른 번역 언어도 포함합니다. 모델·설정·명칭 사전은 유지됩니다.</p><ul>{#each pendingDelete.chapters as c}<li>{c.title||c.url} · {c.target} · {c.ids.length}개 작업<small>{c.url}</small></li>{/each}</ul>{#if pendingDelete.kept}<p role="alert">보관된 작업 {pendingDelete.kept}개가 포함되어 있습니다. 먼저 회차 보관을 해제한 뒤 다시 삭제하세요.</p>{/if}{#if locked()}<p>앱의 진행 중인 관리 작업이 끝난 뒤 삭제할 수 있습니다.</p>{/if}<div class="actions"><button class="button secondary" disabled={busy||locked()||pendingDelete.kept>0} onclick={remove}>삭제 확인</button><button class="text-button" disabled={busy} onclick={()=>pendingDelete=null}>취소</button></div></section>{/if}
{#if error}<p role="alert">{error}</p>{/if}{#if notice}<p role="status">{notice}</p>{/if}
{#if data}<p>{data.policy.retentionDays?`미보관 작업은 ${data.policy.retentionDays}일 후 자동 정리 대상입니다. 계속 읽을 회차는 보관하세요.`:'자동 삭제 안 함'} · 자동 정리 설정은 작업 데이터에서 관리합니다. 삭제하려면 API를 중지하세요.</p>{#if data.unlinked}<p>주소 없는 이전 작업 {data.unlinked}개는 작업 데이터에서 확인할 수 있습니다.</p>{/if}{/if}
{#if busy}<p role="status">저장 목록 확인 중…</p>{/if}
{#each groups as group (group.key)}
<details class="card work-group" open={expanded[group.key]??expandDefault} ontoggle={e=>expanded={...expanded,[group.key]:e.currentTarget.open}}><summary><strong>{group.title}</strong> · {group.chapters.length}개 회차·언어</summary>
<div class="link-toolbar"><label><input type="checkbox" aria-label={'작품 선택 '+group.title} checked={selection.includes(group.key)} disabled={busy} onchange={e=>selection=e.currentTarget.checked?[...selection,group.key]:selection.filter(k=>k!==group.key)}/> 작품 선택</label><button class="text-button" disabled={busy||locked()} onclick={()=>beginDelete(group.sources)}>작품 삭제</button>{#if group.id}<span>연결 주소 {group.sources.length}개</span><button class="text-button" disabled={busy} onclick={()=>beginMerge([group])}>이름 변경</button><button class="text-button" disabled={busy} onclick={()=>detach(group)}>묶음 해제</button>{/if}</div>
{#if group.id}<details class="sources"><summary>연결한 작품 주소</summary>{#each group.sources as source}<div class="source"><small>{source}</small><button class="text-button" disabled={busy} aria-label={'연결 해제 '+source} onclick={()=>detach(group,source)}>연결 해제</button></div>{/each}</details>{:else}<small>{group.sources[0]}</small>{/if}
{#each group.chapters as c (c.url+'\n'+c.target)}<article class="chapter">
 <div><label class="chapter-select"><input type="checkbox" aria-label={'회차 선택 '+(c.title||c.url)+' '+c.target} checked={chapterSelection.includes(chapterKey(c))} disabled={busy} onchange={e=>chapterSelection=e.currentTarget.checked?[...chapterSelection,chapterKey(c)]:chapterSelection.filter(k=>k!==chapterKey(c))}/><strong>{c.title||c.url}</strong></label><a href={c.url} target="_blank" rel="noreferrer">{c.url}</a><small>{c.target} · 다시 읽기 {c.ready}/{c.pages}장 · 실패 {c.failed}개 작업 · 보관 {c.kept}/{c.ids.length}개 작업</small></div>
 <div class="actions"><button class="button primary" disabled={!c.ready||busy} onclick={()=>read(c)}>다시 읽기</button><button class="button secondary" disabled={busy||locked()} onclick={()=>keep(c,c.kept!==c.ids.length)}>{c.kept===c.ids.length?'보관 해제':'회차 보관'}</button><button class="text-button" disabled={busy||locked()} onclick={()=>beginDelete([],[chapterKey(c)])}>회차 삭제</button></div>
</article>{/each}</details>
{/each}
{#if data&&!groups.length&&!busy}<p>조건에 맞는 저장 회차가 없습니다.</p>{/if}
<style>
 .delete-confirm{padding:20px;margin:16px 0;border:1px solid #cbd5df}.delete-confirm ul{max-height:220px;overflow:auto;padding-left:20px}.delete-confirm li{margin:8px 0;overflow-wrap:anywhere}.chapter-select{display:flex;gap:8px;align-items:center}.actions{flex-wrap:wrap}
 .jobs-toolbar{display:flex;gap:10px;margin:18px 0;flex-wrap:wrap}.jobs-toolbar input{flex:1;min-width:180px}.jobs-toolbar input,.link-editor input{padding:10px 12px;border:1px solid #d5dde5;border-radius:8px;font:inherit;background:#fff;color:inherit}.jobs-toolbar input:focus-visible,.link-editor input:focus-visible{outline:2px solid #0b8274;outline-offset:2px}.page-heading{display:flex;justify-content:space-between;gap:16px;align-items:center}.page-heading p{color:#687b8e}.work-group{margin-top:16px;padding:16px 20px}summary{cursor:pointer;padding:8px 0}small{display:block;color:#687b8e;overflow-wrap:anywhere}.chapter{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:16px 0;border-top:1px solid #e3e9ed;margin-top:10px}.chapter>div:first-child{min-width:0}.chapter a{display:block;overflow-wrap:anywhere;font-size:12px;margin:6px 0}.actions{display:flex;gap:8px;flex-shrink:0}.link-toolbar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:12px 0}.link-toolbar label{display:flex;align-items:center;gap:6px}.link-editor{padding:20px;margin:16px 0}.link-editor label{display:grid;gap:8px}.link-editor li{overflow-wrap:anywhere}.source{display:flex;gap:14px;align-items:center;justify-content:space-between;margin:8px 0}.source button{flex-shrink:0}@media(max-width:850px){.chapter{align-items:flex-start;flex-direction:column}}
</style>
