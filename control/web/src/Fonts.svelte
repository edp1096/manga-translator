<script>
 import {onMount} from 'svelte';

 let {request, locked, remote} = $props();
 let fonts = $state({builtIn: [], added: []});
 let busy = $state(false), message = $state(''), error = $state(''), pendingDelete = $state('');

 async function refresh() {
  fonts = await request('fonts');
 }

 onMount(() => { refresh().catch(e => error = e.message); });

 async function change(action, success) {
  if (busy || locked()) return;
  busy = true;
  error = message = '';
  try {
   await action();
   await refresh();
   message = success;
  } catch (e) {
   error = e.message;
  } finally {
   busy = false;
  }
 }

 async function send(path, method, file) {
  const response = await fetch('/api/fonts' + path, {
   method, headers: {'Content-Type': 'application/octet-stream', 'X-Manga-Control': '1'},
   body: file, signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw Error((await response.json()).error || '글꼴 처리에 실패했습니다.');
 }

 function importFile(event) {
  const input = event.currentTarget, file = input.files[0];
  input.value = '';
  if (file) change(() => send('?name=' + encodeURIComponent(file.name), 'POST', file), '글꼴을 등록했습니다.');
 }

 function deleteFont(id) {
  pendingDelete = '';
  change(() => send('/' + id, 'DELETE'), '글꼴을 삭제했습니다.');
 }
</script>

<section class="card font-card">
 <div class="card-heading"><h2>글꼴</h2></div>
 <div class="font-actions">
  <label>글꼴 가져오기 <input type="file" accept=".ttf,.otf" onchange={importFile} disabled={busy || locked()}/></label>
  {#if !remote}
   <button class="button secondary" disabled={busy || locked()} onclick={() => request('open/fonts', {}).catch(e => error = e.message)}>글꼴 폴더 열기</button>
  {/if}
 </div>
 {#if remote}<p class="subtle">이 관리 앱이 실행 중인 기기의 확장 폴더에 저장합니다. 이 PC에 설치한 확장에 추가하려면 이 PC의 관리 페이지를 여세요.</p>{/if}
 {#if error}<p role="alert">{error}</p>{/if}
 {#if message}<p role="status">{message}</p>{/if}
 <ul class="font-list">
  {#each fonts.added as font (font.id)}
   <li><span>{font.name}</span>
    {#if pendingDelete === font.id}
     <div class="font-actions">
      <button class="button secondary" disabled={busy || locked()} onclick={() => deleteFont(font.id)}>삭제 확인</button>
      <button class="button secondary" onclick={() => pendingDelete = ''}>취소</button>
     </div>
    {:else}
     <button class="button secondary" aria-label={font.name + ' 삭제'} disabled={busy || locked()} onclick={() => pendingDelete = font.id}>삭제</button>
    {/if}
   </li>
  {/each}
  {#each fonts.builtIn as font (font.id)}
   <li><span>{font.name}</span><a href={font.publisherPage} target="_blank" rel="noreferrer" aria-label={font.name + ' 배포처'}>배포처</a></li>
  {/each}
 </ul>
</section>

<style>
 .font-card { margin-top: 16px; padding: 20px; }
 .font-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; }
 .font-actions label { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
 .font-list { list-style: none; padding: 0; margin: 12px 0 0; }
 .font-list li { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 36px; padding: 4px 0; }
 .font-list li span { overflow-wrap: anywhere; }
</style>
