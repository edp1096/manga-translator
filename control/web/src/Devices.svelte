<script>
 import {onMount} from 'svelte';
 let {request}=$props();
 let devices=$state([]),code=$state(''),expires=$state(0),now=$state(Date.now()),busy=$state(false),error=$state(''),notice=$state('');
 const address=location.origin;
 async function load(){try{devices=(await request('devices')).devices}catch(e){error=e.message}}
 async function issue(){busy=true;error='';try{const next=await request('devices/code',{});code=next.code;expires=Date.now()+next.expiresIn*1000;}catch(e){error=e.message}finally{busy=false}}
 async function revoke(device){busy=true;error='';try{await request('devices/revoke',{id:device.id});if(device.current){location.href='/';return}notice='해당 기기의 관리 페이지와 확장 연결을 해제했습니다.';await load()}catch(e){error=e.message}finally{busy=false}}
 onMount(()=>{load();const clock=setInterval(()=>now=Date.now(),1000);return()=>clearInterval(clock)});
</script>
<section class="page-heading"><div><h1>기기 연결</h1><p>연결 코드는 한 번만 입력하면 됩니다. 기억한 브라우저는 90일 동안 유지됩니다.</p></div><button class="button secondary" onclick={load} disabled={busy}>목록 새로고침</button></section>
{#if error}<p role="alert">{error}</p>{/if}{#if notice}<p role="status">{notice}</p>{/if}
<section class="card connection"><h2>새 기기 연결</h2><p>연결할 기기에서 <strong>{address}</strong>를 열고 아래 코드를 입력하세요.</p><button class="button primary" onclick={issue} disabled={busy}>새 연결 코드</button>{#if code}<output aria-label="연결 코드">{expires>now?code:'만료됨'}</output><small>{expires>now?`${Math.ceil((expires-now)/1000)}초 남음 · 한 번 사용 · 새로 발급하면 이전 코드는 취소됩니다.`:'새 코드를 발급하세요.'}</small>{/if}</section>
<section class="card connection"><h2>등록 기기</h2>{#if !devices.length}<p>등록한 브라우저가 없습니다.</p>{/if}{#each devices as device (device.id)}<div class="device"><div><strong>{device.name}</strong>{#if device.current}<span> · 현재 브라우저</span>{/if}<small>등록 {new Date(device.created*1000).toLocaleDateString()} · 만료 {new Date(device.expires*1000).toLocaleDateString()}</small></div><button class="button secondary" disabled={busy} onclick={()=>revoke(device)}>연결 해제</button></div>{/each}<p>연결 해제 시 이 브라우저와 여기서 연결한 확장의 서버 접근이 함께 중지됩니다. 번역 결과는 유지됩니다.</p></section>
<style>.connection{padding:22px;margin-bottom:20px}.connection h2{margin-bottom:12px}.connection p{line-height:1.6;margin:12px 0}.connection small{display:block;color:#64746f;margin-top:8px}.connection output{display:block;font:700 30px monospace;letter-spacing:3px;margin-top:16px}.device{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:14px 0;border-bottom:1px solid #e4eae7}.device strong{overflow-wrap:anywhere}</style>
