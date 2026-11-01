<script>
 import {onMount} from 'svelte';
 let {request,extensionMessage,locked}= $props();
 let data=$state(null),query=$state(''),busy=$state(false),error=$state(''),notice=$state('');
 let groups=$derived.by(()=>{const map=new Map();for(const c of data?.chapters||[]){if(!map.has(c.work))map.set(c.work,[]);map.get(c.work).push(c)}return [...map].map(([work,chapters])=>({work,chapters:chapters.sort((a,b)=>a.url.localeCompare(b.url,undefined,{numeric:true})||a.target.localeCompare(b.target))}));});
 async function load(){busy=true;error='';try{data=await request('library?q='+encodeURIComponent(query),undefined,120000)}catch(e){error=e.message}finally{busy=false}}
 async function read(c){error='';try{await extensionMessage({type:'control-read',url:c.url,target:c.target})}catch(e){error=e.message+' 원본 링크를 직접 연 뒤 확장 패널에서 저장된 번역 언어를 선택해 불러올 수도 있습니다.'}}
 async function keep(c,value){busy=true;error='';try{for(let i=0;i<c.ids.length;i+=500)await request('jobs/keep',{ids:c.ids.slice(i,i+500),keep:value});notice=value?'회차를 보관했습니다. 자동 정리에서 제외됩니다.':'회차 보관을 해제했습니다.';await load()}catch(e){error=e.message}finally{busy=false}}
 onMount(load);
</script>
<section class="page-heading"><div><h1>번역 서재</h1><p>저장된 회차를 찾아 재번역 없이 다시 읽습니다.</p></div><button class="button secondary" onclick={load} disabled={busy}>목록 새로고침</button></section>
<form class="jobs-toolbar" onsubmit={e=>{e.preventDefault();load()}}><input aria-label="서재 검색" placeholder="작품 제목·회차 주소 검색" bind:value={query}/><button class="button secondary" disabled={busy}>검색</button></form>
{#if error}<p role="alert">{error}</p>{/if}{#if notice}<p role="status">{notice}</p>{/if}
{#if data}<p>{data.policy.retentionDays?`미보관 작업은 ${data.policy.retentionDays}일 후 자동 정리 대상입니다. 계속 읽을 회차는 보관하세요.`:'자동 삭제 안 함'} · 삭제·정리 설정은 작업 데이터에서 관리합니다.</p>{#if data.unlinked}<p>주소 없는 이전 작업 {data.unlinked}개는 작업 데이터에서 확인할 수 있습니다.</p>{/if}{/if}
{#if busy}<p role="status">저장 목록 확인 중…</p>{/if}
{#each groups as group (group.work)}
<details class="card" open><summary><strong>{group.chapters[0].title||group.work}</strong> · {group.chapters.length}개 회차·언어</summary><small>{group.work}</small>
{#each group.chapters as c (c.url+'\n'+c.target)}<article class="chapter">
 <div><strong>{c.title||c.url}</strong><a href={c.url} target="_blank" rel="noreferrer">{c.url}</a><small>{c.target} · 다시 읽기 {c.ready}/{c.pages}장 · 실패 {c.failed}개 작업 · 보관 {c.kept}/{c.ids.length}개 작업</small></div>
 <div class="actions"><button class="button primary" disabled={!c.ready||busy} onclick={()=>read(c)}>다시 읽기</button><button class="button secondary" disabled={busy||locked()} onclick={()=>keep(c,c.kept!==c.ids.length)}>{c.kept===c.ids.length?'보관 해제':'회차 보관'}</button></div>
</article>{/each}</details>
{/each}
{#if data&&!groups.length&&!busy}<p>조건에 맞는 저장 회차가 없습니다.</p>{/if}
<style>
 .jobs-toolbar{display:flex;gap:10px;margin:18px 0}.jobs-toolbar input{flex:1;min-width:180px;padding:10px 12px;border:1px solid #d5dde5;border-radius:8px;font:inherit}.page-heading{display:flex;justify-content:space-between;gap:16px;align-items:center}.page-heading p{color:#687b8e}details{margin-top:16px;padding:16px 20px}summary{cursor:pointer;padding:8px 0}small{display:block;color:#687b8e;overflow-wrap:anywhere}.chapter{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:16px 0;border-top:1px solid #e3e9ed;margin-top:10px}.chapter>div:first-child{min-width:0}.chapter a{display:block;overflow-wrap:anywhere;font-size:12px;margin:6px 0}.actions{display:flex;gap:8px;flex-shrink:0}@media(max-width:850px){.chapter{align-items:flex-start;flex-direction:column}}
</style>
