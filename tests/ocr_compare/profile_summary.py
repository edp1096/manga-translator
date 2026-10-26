import json,gzip,sys,math
from pathlib import Path
from collections import Counter,defaultdict
root=Path(sys.argv[1]);report={}
for model in ['fp16','int4','hayai']:
 stages={}
 for p in sorted((root/f'profile-{model}/data/cache').glob('*.json')):
  rows=[e for e in json.loads(p.read_text()) if e.get('cat')=='Node' and e.get('args',{}).get('provider')];providers=Counter(e['args']['provider'] for e in rows);ops=defaultdict(Counter);max_cpu_elements=0
  for e in rows:
   a=e['args'];ops[a['provider']][a.get('op_name')]+=1
   if a['provider']=='CPUExecutionProvider':
    for tensor in a.get('output_type_shape',[]):
     for dims in tensor.values():max_cpu_elements=max(max_cpu_elements,math.prod(dims))
  stage=next(x for x in ['vision','prefill','step'] if x in p.name)
  stages[stage]={'providerNodeEvents':dict(providers),'opsByProvider':{k:dict(v) for k,v in ops.items()},'largestCpuOutputElements':max_cpu_elements,'source':str(p.relative_to(root))}
  with gzip.open(str(p)+'.gz','wb') as f:f.write(p.read_bytes())
 report[model]={'sampleIds':['ja_a_02','en_a_06'],'includesWarmup':True,'timingsExcludedFromBenchmark':True,'stages':stages}
(root/'provider-summary.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({m:{s:v['providerNodeEvents'] for s,v in r['stages'].items()} for m,r in report.items()},indent=2))
