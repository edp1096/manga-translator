const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require(process.env.MANGA_PLAYWRIGHT || 'playwright');

(async () => {
 const browser = await chromium.launch({headless:true,channel:process.env.MANGA_BROWSER_CHANNEL || 'chromium'});
 try {
  const page=await browser.newPage({viewport:{width:480,height:500}});
  await page.route('https://klmanga.black/**', r=>r.fulfill({contentType:'text/html',body:
   '<style>img{display:block;width:200px}</style><div class="go-open-popup-wrap"><a class="go-open-popup" href="#">Read</a></div><div class="z_content"></div><div class="premium-loading"></div>'}));
  await page.goto('https://klmanga.black/manga-raw/example/chapter-7.1/');
  await page.addScriptTag({path:path.resolve(__dirname,'../extension/readers.js')});
  const result=await page.evaluate(async()=>{
   const image=(colors)=>{
    const c=document.createElement('canvas');c.width=100;c.height=colors.length*140;
    const ctx=c.getContext('2d');
    colors.forEach((color,i)=>{ctx.fillStyle=color;ctx.fillRect(0,i*140,100,140);});
    const img=new Image();img.src=c.toDataURL();img.dataset.preload='yes';return img;
   };
   const root=document.querySelector('.z_content');
   document.querySelector('.go-open-popup').onclick=e=>{
    e.preventDefault();e.target.remove();
    root.append(image(['red','blue','lime','white']));
    setTimeout(()=>{root.append(image(['purple']));document.querySelector('.premium-loading').remove();},100);
   };
   const reader=MangaReaders.create();await reader.prepare();const closed=reader.pages().length;
   reader.openForPreload();await reader.prepare();
   const pages=reader.pages(),keys=pages.map(p=>p.sourceURL),colors=[];
   for(const p of pages){
    const record=await reader.read(p);const img=new Image();img.src=record.data;await img.decode();
    const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.drawImage(img,0,0,1,1);colors.push([...ctx.getImageData(0,0,1,1).data].slice(0,3));
   }
   reader.locate(pages[2]);const r=reader.bounds(pages[2]);
   await reader.prepare();
   return {closed,colors,dims:pages.map(p=>[p.width,p.height]),visible:r.top<innerHeight&&r.bottom>0,current:reader.currentIndex(),same:reader.pages().every((p,i)=>p.sourceURL===keys[i])};
  });
  assert.deepEqual(result,{closed:0,colors:[[255,0,0],[0,0,255],[0,255,0],[255,255,255],[128,0,128]],dims:Array(5).fill([100,140]),visible:true,current:2,same:true});
  console.log('PASS KLManga lazy chapter opening, stacked and single scans, slice pixels, navigation and stable page keys');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
