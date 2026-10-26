import json,shutil,sys,hashlib,platform
from pathlib import Path
base=Path(sys.argv[1]);dest=Path(sys.argv[2]);dest.mkdir(parents=True,exist_ok=True)
summary=json.loads((base/'summary.json').read_text());manifest=json.loads((base/'model-manifest.json').read_text())
for name in ['summary.json','provider-summary.json','parity.json','model-manifest.json']:
 shutil.copy2(base/name,dest/name)
for pattern in ['cpu-*.json','gpu-*.json','dgx-cpu-*.json','mixed-*.json','reference-*.json','native-parity-*.json','memory-*.json']:
 for p in base.glob(pattern):shutil.copy2(p,dest/p.name)
for p in base.glob('profile-*/data/cache/*.json.gz'):
 target=dest/p.relative_to(base);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
fixture=dest/'fixtures';shutil.copytree(base/'eval',fixture,dirs_exist_ok=True)
# Remove the diagnostic BMP copy; the authoritative fixture remains the frozen PNG set.
for p in fixture.rglob('*.bmp'):p.unlink()
models={
 'baberu-fp16':[base/'model/onnx'/f for f in ['vision_fp16.onnx','decoder_prefill_int8.onnx','decoder_step_int8.onnx']],
 'baberu-int4':[base/'model/onnx'/f for f in ['vision_int4.onnx','decoder_prefill_int8.onnx','decoder_step_int8.onnx']],
 'hayai-fp32':list((base/'hayai-fp32/onnx').glob('*.onnx*')),
 'hayai-int8':list((base/'hayai-int8').glob('*.tflite'))}
sizes={name:{'weightMiB':sum(p.stat().st_size for p in paths)/1024**2,'files':[{'name':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in paths]} for name,paths in models.items()}
(dest/'weights.json').write_text(json.dumps(sizes,indent=2)+'\n')
lines=['Baberu / Hayai native comparison — 2026-10-26','',
'Primary source/build/evidence: OP5P 192.168.100.25. DGX Spark is only the CUDA verification host.',
'Frozen fixture: 20 crops (12 Japanese, 8 English), identical PNG hashes to the prior Hayai evaluation.',
'Fixture SHA256: '+hashlib.sha256((base/'eval/samples.json').read_bytes()).hexdigest(),
'Baberu upstream: genshiai-daichi/baberu-ocr @ '+manifest['revision'],
'All inference is native C++; Python is used only for upstream oracle, scoring and diagnostics.',
'Runtime: ONNX Runtime 1.31.0; DGX CUDA 13 runtime; LiteRT 2.3.1 CPU/XNNPACK.',
'OP5P: 4 performance cores, affinity 4-7; DGX: 4 ORT intra-op threads, 1 inter-op thread.',
'Each configuration: one unmeasured warm-up crop, then 3 passes x 20 crops; reverse sample order in the middle pass.',
'Models ran sequentially on each host. Loading, profiling and memory-monitor runs are excluded from timing statistics.',
'Baberu uses the published 256-token cap/repetition penalty/run limits. Hayai uses its production 64-token cap. No sample truncated.',
'Native Baberu parity: both tiers x all 20 crops have bit-exact RGB/pixel tensors, vision tensors and first logits, plus exact text against upstream ONNX CPU.',
'Pillow separable pass ordering is matched (including vertical-first shrink heuristic): https://github.com/python-pillow/Pillow/blob/main/src/libImaging/Resample.c',
'', 'Timing / process memory (lower is better; mean and p95 in milliseconds):',
'configuration | mean ms | p95 ms | load ms | peak process RSS MiB']
for name,r in summary.items():lines.append(f"{name} | {r['timing']['total_ms']['mean']:.2f} | {r['timing']['total_ms']['p95']:.2f} | {r['load_ms']:.2f} | {r['max_rss_kib']/1024:.1f}")
lines+=['','Quality (20 unique samples, not 60 independent samples):','model | JA CER % | EN CER % | exact / 20 | weight MiB']
for key in ['cpu-hayai-int8','cpu-hayai-fp32','cpu-baberu-int4','cpu-baberu-fp16']:
 r=summary[key];q=r['quality'];lines.append(f"{r['mode']} | {q['ja']['cer_percent']:.2f} | {q['en']['cer_percent']:.2f} | {q['all']['exact_count']}/20 | {sizes[r['mode']]['weightMiB']:.1f}")
lines+=['','CER uses NFKC + case folding + whitespace removal; punctuation is retained. Separate content CER and all predictions are in summary.json.',
'All repetitions produce consistent token sequences within each configuration. CUDA can change whitespace from CPU, but normalized quality scores match here.',
'This small frozen fixture does not establish broad language accuracy or a general model winner.',
'', 'Actual execution placement:',
'Baberu FP16 and INT4 vision: all profiled nodes CUDA. INT4 MatMulNBits is actually executed by CUDA.',
'Baberu INT8 prefill and step: DynamicQuantizeLinear and MatMulInteger execute on CPU even when CUDA is selected. Other GPU nodes create a split graph.',
'Hayai FP32: substantial matrix operations execute on CUDA in vision, prefill and step. CPU nodes handle small shape/index/scalar tensors.',
'Raw per-stage traces (gzip) and operator counts are retained. These profile runs use one JA and one EN crop plus warm-up and are not latency measurements.',
'', 'Decisions:',
'Keep current Hayai FP32 GPU execution: 63.24 ms mean; GPU vision / CPU decoder is 180.61 ms; CPU vision / GPU decoder is 197.94 ms.',
'If Baberu is added, prefer GPU vision + CPU decoder on this DGX: FP16 55.51 ms, INT4 60.34 ms. All-CUDA-provider requests are slower (75.95 / 81.40 ms).',
'On OP5P CPU, Baberu INT4 is faster and smaller than current Hayai LiteRT INT8, but Japanese CER is worse in this fixture. Keep Hayai as the current default; no unrequested catalog replacement.',
'LiteRT INT8 remains CPU-only because the supported native GPU route did not pass earlier runtime validation.',
'', 'GPU allocation accounting:']
for p in sorted(base.glob('memory-*.json')):
 if p.name.startswith('memory-run-'):continue
 r=json.loads(p.read_text());value=r.get('processPeakGpuAllocationBytes');lines.append(f"{p.stem}: {value/1024**2:.1f} MiB sampled NVML allocation (10 ms sampling)" if value is not None else f'{p.stem}: unavailable')
lines+=['GB10 uses unified system memory. NVML allocations and RSS are different accounting views and must not be added as separate physical RAM/VRAM.',
'Other resident DGX services were preserved; they occupied GPU memory. Background GPU utilization before memory runs was 0–1%.',
'', 'Reproduction:',
'Build on OP5P with tests/ocr_compare/build_native.sh. See native_compare.cpp command usage, baberu_reference.py, baberu_tensors.py, summarize.py, profile_summary.py and gpu_memory.py.',
'The per-character Unicode content class set is generated from the pinned vocabulary by upstream Vocab; it is an evaluation artifact, not a production Python dependency.',
'Native binary, downloaded pinned models and tensor dumps remain in ~/.cache/manga-translator-build/baberu-eval on OP5P.']
(dest/'RESULTS.txt').write_text('\n'.join(lines)+'\n')
print('Wrote',dest/'RESULTS.txt')
