<script>
 import {onMount} from 'svelte';
 import Icon from './Icon.svelte';
 import InfoPopover from './InfoPopover.svelte';
 let state=$state(null),view=$state('overview'),error=$state(''),notice=$state(''),offline=$state(false),quitting=$state(false);
 let extension=$state({installed:false,connected:false}),probing=$state(false),acting=$state(false),logTab=$state('control'),logText=$state('기록을 불러오는 중…');
 let draftLLM=$state('cpu'),draftLayout=$state('cpu'),draftOCR=$state('cpu'),draftGPU=$state('');
 let importSource=$state('');
 let draftThreads=$state(0),draftAuto=$state(false),draftLoaded=false,deleteID=$state('');
 const modelGroups=[['layout','말풍선·글자 탐지'],['ocr','글자 인식 (OCR)'],['translation','대사 번역 (언어모델)'],['restoration','배경 이미지 복원']];
 const isBaberu=model=>model?.backend?.startsWith('baberu-');
 const incompatible=model=>model.group==='ocr'&&((model.backend==='litert'&&state?.settings.ocrExecution&&state.settings.ocrExecution!=='cpu')||(isBaberu(model)&&state?.settings.ocrExecution==='directml'));
 const engineLabel=model=>isBaberu(model)?`ONNX Runtime · ${model.backend==='baberu-int4'?'INT4':'FP16'} 인코더 / INT8 디코더`:model.backend==='onnx-v2-kv'?'ONNX Runtime · FP32 + KV 캐시':'LiteRT · KV 캐시';
 const chosen=()=>Boolean(state?.settings.layout&&state?.settings.ocr&&state?.settings.model);
 const locked=()=>acting||state?.busy||running()||quitting;
 const selectedName=group=>group==='restoration'?(state?.models?.some(m=>m.group===group&&m.installed)?'설치됨 · 복원 사용 가능':'선택 기능 · 복원하려면 다운로드하세요'):state?.models?.find(m=>m.group===group&&m.selected)?.name||'모델을 선택하세요';
 const menus=[['overview','grid','개요'],['setup','download','설치 관리'],['extension','chrome','크롬 확장'],['logs','activity','실행 기록']];
 const groupIcons={application:'server',runtime:'cpu',layout:'bubble',ocr:'text',translation:'translate'};
 const descriptions={application:'페이지 분석부터 번역 결과까지 처리합니다.',runtime:'이 기기에 맞는 네이티브 실행 환경입니다.',layout:'Koharu 768 · 말풍선과 글자 영역을 찾습니다.',ocr:'Hayai v2 INT8 · 원문을 읽습니다.',translation:'선택한 언어모델로 대사를 옮깁니다.'};
 const stages={verifying:'파일 확인 중',downloading:'다운로드 중',installing:'설치 중',prerequisites:'실행 환경 확인',done:'준비 완료',paused:'일시 정지',error:'준비 실패'};
 const bytes=n=>n>=1024**3?(n/1024**3).toFixed(1)+' GiB':n>=1024**2?(n/1024**2).toFixed(0)+' MiB':(n/1024).toFixed(0)+' KiB';
 const running=()=>state?.phase==='running';
 const platform=()=>state?.platform==='windows-amd64'?'Windows x64':state?.platform==='linux-arm64'?'Linux ARM64':state?.platform||'환경 확인 중';
 const percent=()=>Math.min(100,Math.round((state?.progress.bytes||0)/Math.max(1,state?.progress.total||1)*100));
 const title=()=>running()?'번역 준비가 완료됐습니다.':state?.phase==='starting'?'번역 API를 시작하고 있습니다.':state?.phase==='preparing'?'이 기기의 번역 환경을 준비합니다.':state?.phase==='paused'?'준비를 잠시 멈췄습니다.':state?.ready?'번역 API를 시작해 보세요.':'사용할 모델을 먼저 선택하세요.';
 async function request(path,body){const options=body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Manga-Control':'1'},body:JSON.stringify(body)};const response=await fetch('/api/'+path,{...options,signal:AbortSignal.timeout(12000)});const value=await response.json();if(!response.ok)throw Error(value.error||'요청을 처리하지 못했습니다.');return value;}
 async function refresh(){if(quitting)return;try{const priorPhase=state?.phase;state=await request('state');offline=false;if(state.phase==='imported'&&priorPhase!=='imported')draftLoaded=false;if(!draftLoaded){draftThreads=state.settings.threadsAuto?0:state.settings.threads;draftAuto=state.settings.autoStart;draftLLM=state.settings.llmExecution||'cpu';draftLayout=state.settings.layoutExecution||'cpu';draftOCR=state.settings.ocrExecution||'cpu';draftGPU=state.settings.gpu||'';draftLoaded=true;}}catch(e){offline=true;}}
 async function applyProfile(profile){draftLoaded=false;await act('settings',{...profile.settings,autoStart:state.settings.autoStart});}
 async function act(path,body={}){if(acting)return;acting=true;error='';notice='';try{await request(path,body);if(['settings','models/select','models/clear'].includes(path))draftLoaded=false;await refresh();}catch(e){error=e.message;}finally{acting=false;}}
 function extensionMessage(message){return new Promise((resolve,reject)=>{if(!globalThis.chrome?.runtime?.sendMessage||!state?.extensionId){reject(Error('확장을 설치한 뒤 이 화면을 새로고침하세요.'));return;}chrome.runtime.sendMessage(state.extensionId,message,response=>{if(chrome.runtime.lastError){reject(Error('확장이 아직 연결되지 않았습니다. 설치 후 이 화면을 새로고침하세요.'));return;}if(!response?.ok){reject(Error(response?.error||'확장 응답을 받지 못했습니다.'));return;}resolve(response.value);});});}
 async function probe(){if(probing)return;probing=true;try{extension=await extensionMessage({type:'control-status'});}catch{extension={installed:false,connected:false};}finally{probing=false;}}
 async function pair(){error='';notice='';acting=true;try{const {code}=await request('pair-code',{});extension=await extensionMessage({type:'control-pair',code});notice=extension.connected?'크롬 확장이 로컬 API에 연결됐습니다.':'연결 설정을 저장했습니다. API가 시작되면 번역할 수 있습니다.';}catch(e){error=e.message;}finally{acting=false;}}
 async function copy(text){try{await navigator.clipboard.writeText(text);notice='클립보드에 복사했습니다.';}catch{error='복사하지 못했습니다. 표시된 경로를 직접 선택해 복사하세요.';}}
 async function logs(){try{logText=(await request('logs?name='+logTab)).text;}catch(e){logText=e.message;}}
 async function quit(){error='';try{await request('quit',{});quitting=true;}catch(e){error=e.message;}}
 onMount(()=>{let stopped=false,timer,iteration=0;async function poll(){await refresh();if(state&&iteration++%5===0)probe();if(!stopped&&!quitting)timer=setTimeout(poll,1000);}poll();return()=>{stopped=true;clearTimeout(timer);};});
 $effect(()=>{if(view==='logs'){logTab;logs();}});
</script>

<svelte:head><title>Manga Translator · 관리</title></svelte:head>
<div class="app-shell">
 <aside class="sidebar">
  <a class="brand" href="#overview" onclick={(e)=>{e.preventDefault();view='overview';}}><span class="brand-icon"><Icon name="bubble" size={24}/></span><span>Manga Translator<small>LOCAL WORKSPACE</small></span></a>
  <div class="nav-label">워크스페이스</div>
  <nav aria-label="관리 메뉴">{#each menus as [id,icon,label]}<button class:chosen={view===id} onclick={()=>{view=id;error='';notice='';}}><Icon name={icon}/><span>{label}</span>{#if id==='extension'&&extension.connected}<span class="nav-dot"></span>{/if}</button>{/each}</nav>
  <div class="sidebar-bottom"><button class="exit" onclick={quit} disabled={quitting}><Icon name="power" size={16}/>API를 중지하고 앱 종료</button><span class="version">v{state?.version||'…'}</span></div>
 </aside>
 <div class="workspace">
  <header class="topbar"><span class="breadcrumb">워크스페이스 <span>/</span> <strong>{menus.find(m=>m[0]===view)?.[2]}</strong></span><div class="top-actions"><span class="platform"><Icon name="cpu" size={15}/>{platform()}</span><button class="icon-button" aria-label="상태 새로고침" onclick={()=>{refresh();probe();}} disabled={quitting}><Icon name="refresh" size={17}/></button></div></header>
  <main>
   {#if quitting}<div class="banner neutral" role="status"><Icon name="check"/>관리 앱과 API가 종료되었습니다. 이 탭을 닫아도 됩니다.</div>
   {:else if offline}<div class="banner danger" role="alert"><Icon name="warning"/>관리 앱에 연결할 수 없습니다. Manga Translator를 다시 실행하세요.</div>{/if}
   {#if error||state?.error}<div class="banner danger" role="alert"><Icon name="warning"/><span>{error||state.error}</span><button aria-label="메시지 닫기" onclick={()=>{error='';if(state)state={...state,error:''};}}>×</button></div>{/if}
   {#if notice}<div class="banner success" role="status"><Icon name="check"/>{notice}<button aria-label="알림 닫기" onclick={()=>notice=''}>×</button></div>{/if}
   {#if state&&!state.supported}<div class="banner danger"><Icon name="warning"/>현재 배포판은 Windows x64, Linux ARM64와 x64를 지원합니다.</div>{/if}
   {#if view==='overview'}
    <section class="page-heading"><div><div class="eyebrow">OVERVIEW</div><h1>번역 준비 현황</h1><p>설치부터 API 실행, 크롬 확장 연결까지 한곳에서 관리하세요.</p></div><button class="button secondary" onclick={()=>view='setup'}><Icon name="download" size={17}/>설치 관리</button></section>
    <section class="hero" class:ready={running()}>
     <div class="hero-copy"><span class="status-pill" class:live={running()}><span class="dot" class:pulse={state?.busy}></span>{running()?'실행 중':state?.busy?'준비 중':state?.ready?'실행 대기':'첫 실행'}</span><h2>{title()}</h2><p>{running()?'만화 페이지에서 크롬 확장을 열고 번역을 시작하세요.':state?.phase==='preparing'?'필요한 파일을 확인하고, 없는 파일만 다운로드합니다.':'탐지·OCR·번역 모델을 선택하고 다운로드를 눌러 설치하세요. 앱을 여는 것만으로 다운로드하지 않습니다.'}</p><div class="hero-buttons">
      {#if state?.phase==='preparing'}<button class="button secondary" onclick={()=>act('pause')} disabled={acting}><Icon name="pause" size={16}/>일시 정지</button>
      {:else if running()||state?.phase==='starting'}<button class="button secondary" onclick={()=>act('stop')} disabled={acting}><Icon name="stop" size={16}/>API 중지</button><button class="button primary" onclick={()=>view='extension'}>확장 연결 확인<Icon name="arrow" size={16}/></button>
      {:else if state?.ready}<button class="button primary" onclick={()=>act('start')} disabled={acting||state.busy||quitting}><Icon name="play" size={16}/>API 시작</button>
      {:else}<button class="button primary" onclick={()=>view='setup'} disabled={quitting}><Icon name="download" size={17}/>모델 선택·다운로드</button>{/if}
     </div></div>
     <div class="hero-summary"><div class="summary-item"><span>준비된 구성</span><strong>{state?.components.filter(c=>c.ready).length||0}<em> / 5</em></strong></div><div class="summary-item"><span>시스템 RAM · 사용 가능</span><strong>{state?bytes(state.system.memoryAvailable):'—'}<em> / {state?bytes(state.system.memoryTotal):'—'}</em></strong></div><div class="summary-caption"><Icon name="cpu" size={15}/>CPU · {state?.settings.threads||'—'}개 스레드</div></div>
    </section>
    <div class="section-heading"><h2>하드웨어</h2><span>현재 추론 장치: CPU</span></div>
    <section class="hardware-grid">
     <article class="card hardware-card"><h3>{state?.hardware?.cpu?.board||'CPU'}</h3><p class="hardware-name">{state?.hardware?.cpu?.name||'CPU 모델명 확인 불가'}</p><p>사용 가능한 논리 CPU <strong>{state?.hardware?.cpu?.logical||'—'}개</strong> · 물리 코어 {state?.hardware?.cpu?.physical||'확인 불가'}{#if state?.hardware?.cpu?.physical}개{/if}</p>{#if state?.hardware?.cpu?.performance}<p>성능 코어 <strong>{state.hardware.cpu.performance}개</strong></p>{/if}<p>권장 CPU 스레드 <strong>{state?.hardware?.cpu?.recommendedThreads||'—'}개</strong></p><small>{state?.hardware?.cpu?.threadBasis||'OS 정보 확인 중'}</small></article>
     {#each state?.hardware?.gpus||[] as gpu}
      <article class="card hardware-card"><h3>{gpu.name}</h3>{#if gpu.memoryKind==='shared'}<p class="hardware-name">시스템 RAM 공유</p><p>별도 VRAM으로 중복 계산하지 않습니다.</p>{:else}<p class="hardware-name">{gpu.memoryKind==='dedicated'?'전용 VRAM':'GPU 메모리'}</p><p>전체 <strong>{gpu.memoryTotal!=null?bytes(gpu.memoryTotal):'확인 불가'}</strong></p><p>사용 중 <strong>{gpu.memoryUsed!=null?bytes(gpu.memoryUsed):'확인 불가'}</strong> · 사용 가능 <strong>{gpu.memoryFree!=null?bytes(gpu.memoryFree):'확인 불가'}</strong></p>{/if}</article>
     {/each}
     {#if !(state?.hardware?.gpus?.length)}<article class="card hardware-card"><h3>GPU</h3><p>{!state||state.hardware?.gpuStatus==='probing'?'OS·드라이버 정보 확인 중':'OS·드라이버에서 확인된 GPU 정보가 없습니다.'}</p></article>{/if}
    </section>
    {#if state?.phase==='preparing'||state?.phase==='paused'}<section class="transfer-card"><div class="transfer-heading"><span><Icon name="download" size={18}/><strong>{stages[state.progress.stage]||'준비 중'}</strong></span><span>{state.progress.completed} / {state.progress.count} 단계</span></div><div class="transfer-name">{state.progress.name||'환경을 확인하고 있습니다.'}</div><div class="progress-track" role="progressbar" aria-label="현재 파일 다운로드" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent()}><div style:width={percent()+'%'}></div></div><div class="transfer-footer"><span>{state.progress.stage==='downloading'?bytes(state.progress.bytes)+' / '+bytes(state.progress.total):'기존 파일과 체크섬을 확인합니다.'}</span><span>{state.progress.stage==='downloading'?percent()+'%':''}</span></div></section>{/if}
    <div class="section-heading"><h2>번역을 시작하는 세 단계</h2><span>한 번 연결하면 다음부터 바로 사용할 수 있어요.</span></div>
    <section class="steps-grid">
     {#each [{n:'01',icon:'download',title:'실행 환경 준비',text:'모델을 직접 선택하고 필요한 파일만 다운로드합니다.',done:state?.ready,view:'setup',action:'파일 확인'},{n:'02',icon:'server',title:'로컬 API 실행',text:'글자 인식과 번역을 이 기기에서 실행합니다.',done:running(),view:'overview',action:running()?'실행 상태 확인':'API 시작'},{n:'03',icon:'chrome',title:'크롬 확장 연결',text:'만화 페이지에서 번역과 편집을 시작합니다.',done:extension.connected,view:'extension',action:'확장 설정'}] as step}
      <article class="step-card"><div class="step-top"><span class="step-icon" class:complete={step.done}><Icon name={step.done?'check':step.icon} size={21}/></span><span class="step-number">{step.n}</span></div><h3>{step.title}{#if step.done}<span class="mini-label">완료</span>{/if}</h3><p>{step.text}</p><button class="text-button" onclick={()=>{if(step.n==='02'&&!running()){act('start');}else view=step.view;}} disabled={step.n==='02'&&(!state?.ready||state?.busy)}>{step.action}<Icon name="arrow" size={15}/></button></article>
     {/each}
    </section>
    <section class="overview-bottom"><article class="card services-card"><div class="card-heading"><h3>API 상태</h3><span class="subtle">로컬 연결</span></div>{#each state?.services||[] as service}<div class="service-row"><span class="service-icon"><Icon name={service.name==='llm'?'translate':'bubble'} size={18}/></span><div><strong>{service.name==='llm'?'대사 번역':'이미지 처리'}</strong><small>{service.url||'확인 중'}</small></div><span class="service-status" class:online={service.ready}><span class="dot"></span>{service.ready?(service.active?service.active+'개 작업 중':'정상'):'중지됨'}</span></div>{/each}</article><article class="card storage-card"><div class="card-heading"><h3>저장 공간</h3><Icon name="folder" size={19}/></div><strong class="storage-size">{state?bytes(state.system.diskFree):'—'} <span>사용 가능</span></strong><p class="path-label" title={state?.root}>{state?.root||'설치 위치를 확인하고 있습니다.'}</p><button class="text-button" onclick={()=>act('open/root')}>데이터 폴더 열기<Icon name="external" size={14}/></button></article></section>
   {:else if view==='setup'}
    <section class="page-heading"><div><div class="eyebrow">INSTALLATION</div><div class="heading-title"><h1>모델 선택과 설치</h1><InfoPopover title="설치 관리"><p>탐지·OCR·번역 모델을 각각 선택하세요. 다운로드를 눌러야 설치하며 필요한 런타임만 함께 받습니다.</p><p>파일 복구나 실행 설정 변경은 API를 중지한 뒤 진행할 수 있습니다.</p><p>Koharu 1152는 768보다 더 많은 메모리가 필요합니다. 모델 설치와 API 실행은 별도로 할 수 있습니다.</p>{#if state?.platform==='windows-amd64'}<p>Windows에서는 필요한 실행 라이브러리를 앱 폴더 안에 준비합니다. 별도의 Visual C++ 설치나 관리자 권한은 필요하지 않습니다.</p>{/if}</InfoPopover></div></div><button class="button primary" onclick={()=>act('setup')} disabled={locked()||!chosen()}><Icon name="download" size={17}/>{state?.phase==='paused'?'선택한 조합 이어받기':'선택한 조합 다운로드·복구'}</button></section>

    {#if state?.busy&&state.phase==='preparing'}<section class="transfer-card"><div class="transfer-heading"><strong>{stages[state.progress.stage]}</strong><button class="text-button" onclick={()=>act('pause')}>일시 정지</button></div><p>{state.progress.name}</p><div class="progress-track"><div style:width={percent()+'%'}></div></div><div class="transfer-footer"><span>{bytes(state.progress.bytes)} / {bytes(state.progress.total)}</span><span>{state.progress.completed} / {state.progress.count} 단계</span></div></section>{/if}
    <section class="card migration-card">
     <div class="card-heading"><h3>이전 버전 데이터 가져오기</h3><InfoPopover title="새 버전으로 데이터 이전"><p>이전 앱과 API를 종료한 뒤, 새 배포본을 별도 폴더에 풀어 실행하세요. 이전 폴더의 모델·런타임·설정·인증키·번역 결과·이어받기 파일을 복사하며 원본은 보존합니다.</p><p>새 실행 파일과 확장 코드는 유지합니다. 복사가 끝나면 선택한 조합 다운로드·복구로 새 버전에 필요한 구성만 준비하세요.</p><p>브라우저 안의 명칭 사전과 편집 기록은 같은 확장 프로필에 남습니다. 새 확장 폴더를 등록할 때 기존 확장을 삭제하면 브라우저 데이터가 지워질 수 있습니다.</p></InfoPopover></div>
     <label for="import-source">이전 앱 폴더의 전체 경로</label>
     <input id="import-source" bind:value={importSource} disabled={locked()} placeholder="이전 실행 파일이 있는 폴더"/>
     <button class="button secondary" onclick={()=>act('import',{source:importSource})} disabled={locked()||!importSource.trim()||chosen()||Boolean(state?.settings.model||state?.settings.layout||state?.settings.ocr)}>데이터 가져오기</button>
     {#if state?.phase==='importing'}<p role="status">복사·검증 중 · {state.progress.completed} / {state.progress.count} 파일 · {bytes(state.progress.bytes)} / {bytes(state.progress.total)}</p><p class="path-label">{state.progress.name}</p><button class="text-button" onclick={()=>act('pause')}>가져오기 취소</button>
     {:else if state?.phase==='imported'}<p role="status">가져오기가 완료됐습니다. 선택한 조합 다운로드·복구를 눌러 새 버전에 필요한 파일을 확인하세요.</p>
     {:else}<p>모델을 선택하거나 데이터를 저장하기 전의 새 폴더에서 사용하세요.</p>{/if}
    </section>
    <section class="model-section"><div class="section-heading"><h2>실행 프리셋</h2><span>적용 후 필요한 파일을 다운로드하세요.</span></div><div class="model-grid">{#each state?.profiles||[] as profile}<article class="card model-card preset-card"><div class="card-heading"><h3>{profile.name}</h3><InfoPopover title={profile.name}>{#if !profile.available}<p>{profile.unavailableReason||'지원 GPU가 필요합니다.'}</p>{/if}{#if profile.recommended}<p>현재 기기에 권장하는 프리셋입니다.</p>{/if}<p>{profile.note}</p></InfoPopover></div><button class="button secondary" disabled={locked()||!profile.available} onclick={()=>applyProfile(profile)}>프리셋 적용</button></article>{/each}</div></section>
    {#each modelGroups as [group,label]}
     <section class="model-section"><div class="section-heading"><h2>{label}</h2><span>{selectedName(group)}</span></div>
      <div class="model-grid">{#each state?.models?.filter(m=>m.group===group)||[] as model}
       <article class="card model-card" class:selected={model.selected} class:incompatible={incompatible(model)}>
        <div class="card-heading"><h3>{model.name}</h3><div class="model-tools"><InfoPopover title={model.name}><p>{model.selected?'선택됨':model.installed?'설치됨':model.present?'파일 있음':'미설치'} · 모델 {bytes(model.size)}</p>
         <p>{model.note}</p>{#if incompatible(model)}<p class="incompatible-note">{#if isBaberu(model)}CPU·CUDA 지원 · DirectML 미지원<br/>설정에서 글자 인식을 CPU로 바꾸면 선택할 수 있습니다.{:else}CPU 전용 · GPU OCR 미지원<br/>CPU 또는 CPU/GPU 병행 프리셋에서 선택할 수 있습니다.{/if}</p>{/if}
         {#if model.backend}<p>실행 엔진: {engineLabel(model)}</p>{/if}<p>{model.memoryGiB} GiB {group==='translation'?'시스템 RAM 권장':'여유 메모리 권장 (추정)'}</p><p>필요한 다운로드 {bytes(model.downloadSize)} · 런타임 포함, 이어받기 전 전체 파일 기준</p>
        </InfoPopover></div></div>

        <div class="inline-actions">{#if group!=='restoration'}<button class="button secondary" disabled={locked()||incompatible(model)} onclick={()=>act(model.selected?'models/clear':'models/select',{id:model.id})}>{incompatible(model)?'선택 불가':model.selected?'선택 해제':'이 모델 선택'}</button>{/if}<button class="button primary" disabled={locked()} onclick={()=>act('models/download',{id:model.id})}>{model.installed?'파일 확인·복구':'다운로드·이어받기'}</button>
        {#if model.present&&!model.selected}<button class="text-button" disabled={locked()} onclick={()=>deleteID=model.id}>삭제</button>{/if}</div>
        {#if deleteID===model.id}<div class="delete-confirm"><p>이 모델 파일과 미완료 다운로드를 삭제합니다. 다른 모델이 사용하는 공유 파일, 공용 런타임과 번역 결과는 보존됩니다.</p><button class="button secondary" disabled={locked()} onclick={async()=>{await act('models/delete',{id:model.id});deleteID='';}}>삭제 확인</button><button class="text-button" onclick={()=>deleteID=''}>취소</button></div>{/if}
       </article>
      {/each}</div>
     </section>
    {/each}

    <section class="card component-list"><div class="list-heading"><span>구성 요소</span><span>다운로드 크기 / 상태</span></div>{#each state?.components||[] as component}<div class="component-row"><span class="component-icon"><Icon name={groupIcons[component.id]} size={23}/></span><div class="component-info"><h3>{component.name}</h3><p>{['layout','ocr','translation'].includes(component.id)?selectedName(component.id):descriptions[component.id]}</p></div><span class="component-size">{bytes(component.size)}</span><span class="component-state" class:installed={component.ready}><Icon name={component.ready?'check':'download'} size={14}/>{component.ready?'준비됨':'준비 필요'}</span></div>{/each}</section>
    <section class="model-section"><div class="section-heading"><h2>실행 런타임</h2><span>버전별 설치·삭제</span></div><div class="model-grid">
     {#each state?.runtimes||[] as runtime}<article class="card model-card"><div class="card-heading"><h3>{runtime.name}</h3><InfoPopover title={runtime.name}><p>{runtime.required?'현재 선택에 필요':runtime.installed?'설치됨':runtime.present?'일부 파일 있음':'미설치'}</p><p>{runtime.version||'이전 버전'} · {runtime.backend||'CPU'} · {bytes(runtime.diskBytes)}</p></InfoPopover></div>
      <div class="inline-actions">{#if !runtime.legacyRoot}<button class="button secondary" disabled={locked()} onclick={()=>act('runtimes/download',{id:runtime.id})}>{runtime.installed?'확인·복구':'다운로드'}</button>{/if}{#if runtime.removable}<button class="text-button" disabled={locked()} onclick={()=>deleteID='runtime:'+runtime.id}>삭제</button>{/if}</div>
      {#if deleteID==='runtime:'+runtime.id}<div class="delete-confirm"><p>이 런타임의 사용하지 않는 파일을 삭제합니다. 모델과 번역 결과는 보존됩니다.</p><button class="button secondary" disabled={locked()} onclick={async()=>{await act('runtimes/delete',{id:runtime.id});deleteID='';}}>삭제 확인</button><button class="text-button" onclick={()=>deleteID=''}>취소</button></div>{/if}
     </article>{/each}</div></section>
    <section class="card settings-card"><div><h3>실행 설정</h3><p>관리 앱을 열 때 API를 자동으로 시작할 수 있습니다.</p></div><div class="settings-fields"><label class="toggle-label"><input type="checkbox" bind:checked={draftAuto} disabled={running()||state?.busy}/><span>설치가 완료된 선택 모델로 API 자동 실행</span></label><label class="threads-label"><span>사용할 CPU 스레드</span><select bind:value={draftThreads} disabled={!state||running()||state?.busy}><option value={0}>자동 · {state?.hardware?.cpu?.recommendedThreads||'—'}개 권장</option>{#each Array.from({length:state?.system.cpus||1},(_,i)=>i+1) as count}<option value={count}>{count}개</option>{/each}</select></label><label class="threads-label"><span>대사 번역</span><select bind:value={draftLLM} disabled={locked()}><option value="cpu">CPU</option>{#if state?.runtimes?.some(r=>r.id==='llama-vulkan')}<option value="vulkan">GPU · Vulkan</option>{/if}{#if state?.runtimes?.some(r=>r.id==='llama-cuda')}<option value="cuda">GPU · CUDA (NVIDIA)</option>{/if}</select></label>
<label class="threads-label"><span>영역 탐지</span><select bind:value={draftLayout} disabled={locked()}><option value="cpu">CPU</option>{#if state?.runtimes?.some(r=>r.id==='ort-cuda')}<option value="cuda">GPU · CUDA</option>{/if}{#if state?.runtimes?.some(r=>r.id==='ort-directml')}<option value="directml">GPU · DirectML</option>{/if}</select></label>
<label class="threads-label"><span>글자 인식</span><select bind:value={draftOCR} disabled={locked()}><option value="cpu">CPU</option>{#if state?.models?.find(m=>m.id===state.settings.ocr)?.backend!=='litert'}{#if state?.runtimes?.some(r=>r.id==='ort-cuda')}<option value="cuda">GPU · CUDA</option>{/if}{#if state?.runtimes?.some(r=>r.id==='ort-directml')&&!isBaberu(state?.models?.find(m=>m.id===state.settings.ocr))}<option value="directml">GPU · DirectML</option>{/if}{/if}</select></label>
<label class="threads-label"><span>사용할 GPU</span><select bind:value={draftGPU} disabled={locked()}><option value="">자동 · 실행 방식에 맞는 GPU</option>{#each state?.hardware?.gpus||[] as gpu}<option value={gpu.id}>{gpu.name}</option>{/each}</select></label>
<button class="button secondary" onclick={()=>act('settings',{...state.settings,profile:'custom',llmExecution:draftLLM,layoutExecution:draftLayout,ocrExecution:draftOCR,gpu:draftGPU,autoStart:draftAuto,threads:Number(draftThreads),threadsAuto:Number(draftThreads)===0})} disabled={running()||state?.busy||acting}>설정 저장</button></div></section>
    <section class="sources"><h3>라이선스 및 출처</h3><p>모델과 외부 라이브러리에는 각각의 이용 조건이 적용됩니다.</p><div>{#each state?.licenses||[] as license}<a href={license.url} target="_blank" rel="noreferrer">{license.name}<span>{license.license}</span><Icon name="external" size={13}/></a>{/each}</div></section>

   {:else if view==='extension'}
    <section class="page-heading"><div><div class="eyebrow">CHROME EXTENSION</div><div class="heading-title"><h1>만화 페이지와 연결하기</h1><InfoPopover title="확장 연결"><p>확장을 한 번 설치하면 번역 API에 연결할 수 있습니다.</p><p>확장 설치 단계는 브라우저에서 직접 진행해야 합니다. 설치 후 툴바에서 Manga Translator를 고정할 수 있습니다.</p></InfoPopover></div></div><span class="connection-badge" class:connected={extension.connected}><span class="dot"></span>{extension.connected?'연결 완료':extension.installed?'확장 설치됨':'확장 설치 필요'}</span></section>
    {#if extension.connected}<section class="connected-card"><span class="connected-icon"><Icon name="check" size={27}/></span><div><h2>이제 만화 페이지에서 번역하세요.</h2><p>Manga Translator {extension.version} · 로컬 API에 연결됐습니다.</p></div><button class="button secondary" onclick={probe} disabled={probing}><Icon name="refresh" size={16}/>다시 확인</button></section>{/if}
    <section class="card extension-guide"><article><span class="guide-number">1</span><div><h3>확장 폴더를 확인하세요.</h3><p>아래 폴더는 관리 앱이 준비한 크롬 확장입니다.</p><div class="copy-path"><code>{state?.extensionPath||'확인 중'}</code><button class="icon-button" aria-label="확장 폴더 경로 복사" onclick={()=>copy(state.extensionPath)}><Icon name="copy" size={17}/></button></div><div class="inline-actions"><button class="button secondary" onclick={()=>act('open/extension')}><Icon name="folder" size={17}/>폴더 열기</button><a class="text-button" href="/extension.zip" download>확장 ZIP 받기<Icon name="download" size={15}/></a></div></div></article><article><span class="guide-number">2</span><div><h3>크롬에 확장을 추가하세요.</h3><p>확장 관리 화면에서 <strong>개발자 모드</strong>를 켜고, <strong>압축해제된 확장 프로그램을 로드</strong>를 눌러 위 폴더를 선택하세요.</p><button class="button secondary" onclick={()=>act('open/chrome')}><Icon name="chrome" size={17}/>크롬 확장 관리 열기<Icon name="external" size={14}/></button><small class="guide-note">자동으로 열리지 않으면 크롬 주소창에 chrome://extensions 를 입력하세요.</small></div></article><article><span class="guide-number">3</span><div><h3>로컬 API와 연결하세요.</h3><p>주소나 접근 키를 직접 입력할 필요 없이, 관리 앱에서 연결 설정을 전달합니다.</p><div class="inline-actions">{#if extension.installed}<button class="button primary" onclick={pair} disabled={acting||quitting}><Icon name="link" size={17}/>{extension.connected?'연결 설정 다시 적용':'확장 연결하기'}</button>{:else}<button class="button primary" onclick={()=>location.reload()}><Icon name="refresh" size={17}/>설치 후 다시 확인</button>{/if}<span class="subtle">{extension.installed?'설치 확인 · v'+extension.version:'확장 설치 후 이 화면을 새로고침합니다.'}</span></div></div></article></section>

   {:else if view==='logs'}
    <section class="page-heading"><div><div class="eyebrow">ACTIVITY</div><h1>실행 기록</h1><p>다운로드와 API 실행 상태를 확인하세요.</p></div><button class="button secondary" onclick={logs}><Icon name="refresh" size={17}/>새로고침</button></section>
    <section class="card log-card"><div class="log-toolbar"><div class="log-tabs">{#each [['control','관리 앱'],['llm','대사 번역'],['vision','이미지 처리']] as [id,label]}<button class:active={logTab===id} onclick={()=>logTab=id}>{label}</button>{/each}</div><button class="icon-button" aria-label="실행 기록 복사" onclick={()=>copy(logText)}><Icon name="copy" size={17}/></button></div><pre>{logText}</pre><div class="log-footer"><span>최근 300줄 · 이 기기에만 저장됩니다.</span><span>{logTab}.log</span></div></section>
   {/if}
  </main>
 </div>
</div>

<style>
 .heading-title{display:flex;align-items:center;gap:10px}.heading-title h1{margin:0}
 .hardware-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:16px;margin-bottom:28px}.hardware-card{padding:22px;min-width:0}.hardware-card h3{font-size:15px;overflow-wrap:anywhere}.hardware-card p{font-size:13px;line-height:1.6;color:#64746f;overflow-wrap:anywhere}.hardware-card .hardware-name{color:#1c3834}.hardware-card small{font-size:11px;color:#64746f}

 .model-card.incompatible{background:#f4f6f5;border-style:dashed}.model-card .incompatible-note{color:#735c2c;font-weight:600}.model-card.incompatible .card-heading h3{color:#65736e}
 .model-section{margin:28px 0}.model-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,310px),1fr));gap:16px}.model-card{padding:18px;min-width:0}.model-tools{display:flex;align-items:center;gap:8px;flex:none}.model-card .card-heading{margin-bottom:14px}.model-card.selected{border-color:#0b8274;box-shadow:0 0 0 1px #0b8274}.model-card p{line-height:1.6;color:#64746f;font-size:13px}.model-card .inline-actions{flex-wrap:wrap;gap:10px}.delete-confirm{margin-top:16px;border-top:1px solid #e4eae7;padding-top:12px}.model-card .card-heading{align-items:flex-start;gap:10px}.model-card h3{line-height:1.5}
</style>
