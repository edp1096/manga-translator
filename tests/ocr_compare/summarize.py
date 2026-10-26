"""Score the frozen 20-crop fixture with the same normalizer as the Hayai evaluation."""
import json,math,statistics,sys,unicodedata
from pathlib import Path
base=Path(sys.argv[1]);summary={}
def normalize(s,content=False):
 s=unicodedata.normalize('NFKC',s).casefold()
 return ''.join(c for c in s if not c.isspace() and not(content and unicodedata.category(c).startswith('P')))
def distance(a,b):
 row=list(range(len(b)+1))
 for i,x in enumerate(a,1):
  nxt=[i]
  for j,y in enumerate(b,1):nxt.append(min(nxt[-1]+1,row[j]+1,row[j-1]+(x!=y)))
  row=nxt
 return row[-1]
for path in sorted(base.glob('*.json')):
 if not path.stem.startswith(('cpu-','gpu-','dgx-cpu-','mixed-')):continue
 report=json.loads(path.read_text());rows=report['samples'];first=[r for r in rows if r['pass']==0];out={k:report[k] for k in ['mode','backend','load_ms','passes','threads','max_rss_kib']};out['quality']={}
 assert len(rows)==20*report['passes'] and len(first)==20
 for lang in ['all','ja','en']:
  subset=[r for r in first if lang=='all' or r['language']==lang];chars=edits=exact=cc=ce=0
  for r in subset:
   a,b=normalize(r['truth']),normalize(r['prediction']);chars+=len(a);edits+=distance(a,b);exact+=a==b;a,b=normalize(r['truth'],True),normalize(r['prediction'],True);cc+=len(a);ce+=distance(a,b)
  out['quality'][lang]={'count':len(subset),'cer_percent':100*edits/chars,'content_cer_percent':100*ce/cc,'exact_count':exact,'edits':edits,'reference_chars':chars}
 out['timing']={}
 for name in ['prepare_ms','vision_ms','prefill_ms','decode_ms','total_ms']:
  values=[r[name] for r in rows];out['timing'][name]={'mean':statistics.mean(values),'median':statistics.median(values),'p95':sorted(values)[math.ceil(.95*len(values))-1]}
 out['truncated']=sum(not r['stopped'] for r in first);out['repetitions_consistent']=all(len({tuple(r['ids']) for r in rows if r['id']==one['id']})==1 for one in first)
 out['predictions']=[{k:r[k] for k in ['id','truth','prediction','stopped']} for r in first];summary[path.stem]=out
(base/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
for name,r in summary.items():
 print(name,'mean',round(r['timing']['total_ms']['mean'],2),'p95',round(r['timing']['total_ms']['p95'],2),'JA CER',round(r['quality']['ja']['cer_percent'],2),'EN CER',round(r['quality']['en']['cer_percent'],2),'EM',r['quality']['all']['exact_count'],'RSS MiB',round(r['max_rss_kib']/1024,1),'truncated',r['truncated'])
