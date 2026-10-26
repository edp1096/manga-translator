"""Save upstream tensors to verify native preprocessing and ONNX boundaries."""
import os,sys,json
from pathlib import Path
import numpy as np
import onnxruntime as ort
from PIL import Image
base=Path(os.environ['BABERU_EVAL']);sys.path.insert(0,str(base/'model'));import onnx_infer
session=ort.InferenceSession
def make(p,o,**kw):
 o.intra_op_num_threads=4;o.inter_op_num_threads=1
 return session(p,o,**kw)
ort.InferenceSession=make
for tier in ['fp16','int4']:
 model=onnx_infer.BaberuOnnxOCR(base/'model/onnx',base/'model/tokenizer',vision=f'vision_{tier}.onnx')
 for s in json.loads((base/'eval/samples.json').read_text()):
  d=base/f'oracle-{tier}'/s['id'];d.mkdir(parents=True,exist_ok=True)
  x=onnx_infer.preprocess(Image.open(base/'eval'/s['file']));v=model.vis.run(['vision_embeds'],{'pixel_values':x})[0];p=model.pre.run(None,{'vision_embeds':v,'input_ids':np.array([[1]],np.int64)})
  v.tofile(d/'vision.f32');p[0][0,-1].tofile(d/'first_logits.f32')
 print('saved',tier,flush=True)
 del model
