"""Developer-only oracle for the pinned upstream Baberu ONNX release."""
import sys,json,hashlib,os
from pathlib import Path
import onnxruntime as ort
from PIL import Image
base=Path(os.environ['BABERU_EVAL'])
sys.path.insert(0,str(base/'model'))
import onnx_infer
original_session=ort.InferenceSession
def session(path,options,**kw):
    options.intra_op_num_threads=4
    options.inter_op_num_threads=1
    return original_session(path,options,**kw)
ort.InferenceSession=session
samples=json.loads((base/'eval/samples.json').read_text())
for tier in ['fp16','int4']:
    model=onnx_infer.BaberuOnnxOCR(base/'model/onnx',base/'model/tokenizer',vision=f'vision_{tier}.onnx')
    results=[]
    for sample in samples:
        p=base/'eval'/sample['file']
        assert hashlib.sha256(p.read_bytes()).hexdigest()==sample['sha256']
        prediction=model(Image.open(p))
        results.append({**sample,'prediction':prediction})
        print(tier,sample['id'],repr(prediction),flush=True)
    (base/f'reference-{tier}.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
    del model
