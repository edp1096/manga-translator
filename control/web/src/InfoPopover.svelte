<script>
 let {title, children} = $props();
 const id = 'info-' + crypto.randomUUID();
 let button, popup, open = $state(false);
 function position(){
  if(!popup?.matches(':popover-open')||!button)return;
  const edge=12, width=Math.min(360,innerWidth-edge*2), anchor=button.getBoundingClientRect();
  popup.style.width=width+'px';popup.style.maxHeight=Math.max(0,innerHeight-edge*2)+'px';
  const height=popup.getBoundingClientRect().height;
  popup.style.left=Math.max(edge,Math.min(anchor.right-width,innerWidth-width-edge))+'px';
  const top=anchor.bottom+8+height<=innerHeight-edge?anchor.bottom+8:anchor.top-height-8;
  popup.style.top=Math.max(edge,Math.min(top,innerHeight-height-edge))+'px';
 }
 function beforeToggle(event){open=event.newState==='open';if(open){popup.style.width=Math.min(360,innerWidth-24)+'px';popup.style.maxHeight=Math.max(0,innerHeight-24)+'px';popup.style.left='12px';popup.style.top='12px';}}
 function toggle(){open=!!popup?.matches(':popover-open');if(open){position();popup.querySelector('.info-close')?.focus({preventScroll:true});}}
</script>

<svelte:window onresize={position} onscroll={position}/>
<button bind:this={button} class="info-button" type="button" popovertarget={id} aria-label={title+' 설명'} aria-controls={id} aria-haspopup="dialog" aria-expanded={open}><span aria-hidden="true">i</span></button>
<div bind:this={popup} tabindex="-1" id={id} popover="auto" class="info-popover" role="dialog" aria-label={title+' 안내'} onbeforetoggle={beforeToggle} ontoggle={toggle}>
 <header><strong>{title}</strong><button class="info-close" type="button" popovertarget={id} popovertargetaction="hide" aria-label="설명 닫기">×</button></header>
 <div class="info-body">{@render children?.()}</div>
</div>

<style>
 .info-button{display:inline-flex;align-items:center;justify-content:center;flex:none;width:23px;height:23px;padding:0;border:1px solid #a9bec4;border-radius:50%;background:#f0f6f7;color:#125c69;font:700 13px/1 system-ui,sans-serif;cursor:pointer}
 .info-button:hover,.info-button[aria-expanded=true]{background:#dceef1;border-color:#16849a}.info-button:focus-visible,.info-close:focus-visible{outline:2px solid #16849a;outline-offset:3px}
 .info-popover{position:fixed;inset:auto;margin:0;padding:14px;box-sizing:border-box;border:1px solid #b8cbd0;border-radius:10px;background:#fff;color:#19232f;box-shadow:0 6px 24px #0003;overflow:auto;overflow-wrap:anywhere;font:13px/1.6 system-ui,sans-serif}
 header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}strong{font-size:13px;line-height:1.5}.info-close{flex:none;margin:0;padding:0 5px;border:0;background:transparent;color:#456;font-size:21px;line-height:23px;cursor:pointer}
 .info-body :global(p){margin:10px 0 0;font-size:13px;line-height:1.6}.info-body :global(.incompatible-note){color:#735c2c;font-weight:600}
</style>
