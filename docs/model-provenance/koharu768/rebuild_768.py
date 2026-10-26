from pathlib import Path
import hashlib,json
import numpy as np,onnx,torch
from onnx import numpy_helper
p=Path('/work');src=p/'original.onnx';ref=p/'upstream-rfdetr-seg-2xlarge.onnx';assert hashlib.sha256(src.read_bytes()).hexdigest()=='7cc10d4316371946b8441da3512261a8e148b129abcdb0ea6235ed1d1d06d351';a=onnx.load(src);b=onnx.load(ref)
# Only fixed spatial dimensions change. Attention head/channel dimensions are preserved.
spatial={96:64,48:32,9216:4096,9220:4100,2304:1024,2305:1025,288:192}
changes=[];reference_nodes={n.name:n for n in b.graph.node}
for n in a.graph.node:
 t=reference_nodes[n.name]
 if n.SerializeToString()==t.SerializeToString():continue
 assert n.op_type==t.op_type=='Constant' and len(n.attribute)==len(t.attribute)==1,n.name
 arr=numpy_helper.to_array(n.attribute[0].t);out=arr.copy()
 if n.name=='/transformer/Constant_5':
  assert np.array_equal(arr,np.arange(96,dtype=arr.dtype)[:,None]);out=np.arange(64,dtype=arr.dtype)[:,None]
 elif n.name=='/transformer/Constant_6':
  assert np.array_equal(arr,np.arange(96,dtype=arr.dtype)[None,:]);out=np.arange(64,dtype=arr.dtype)[None,:]
 elif n.name=='/transformer/Constant_12':
  assert arr.shape==(1,96,96,2) and np.all(arr==np.float32(.05));out=np.full((1,64,64,2),.05,dtype=arr.dtype)
 else:
  for old,new in spatial.items():out[arr==old]=new
 expected=numpy_helper.to_array(t.attribute[0].t);assert np.array_equal(out,expected),(n.name,arr,expected)
 old_name=n.attribute[0].t.name;n.attribute[0].t.CopyFrom(numpy_helper.from_array(out,name=old_name));changes.append(n.name)
name='backbone.0.encoder.encoder.embeddings.position_embeddings';ai=next(i for i in a.graph.initializer if i.name==name);bi=next(i for i in b.graph.initializer if i.name==name);positions=numpy_helper.to_array(ai).copy();torch.set_num_threads(2);patch=torch.from_numpy(positions[:,1:,:]).reshape(1,96,96,384).permute(0,3,1,2);small=torch.nn.functional.interpolate(patch,size=(64,64),mode='bicubic',align_corners=False,antialias=False).permute(0,2,3,1).reshape(1,4096,384).numpy();reduced=np.concatenate([positions[:,:1,:],small],axis=1);delta=float(abs(reduced-numpy_helper.to_array(bi)).max());assert delta<1e-6,delta;ai.CopyFrom(numpy_helper.from_array(reduced,name=name))
for i in [2,3]:a.graph.input[0].type.tensor_type.shape.dim[i].dim_value=768;a.graph.output[2].type.tensor_type.shape.dim[i].dim_value=192
# Stored intermediate dimensions originated in the 1152 export; regenerate instead of retaining stale hints.
del a.graph.value_info[:]
a=onnx.shape_inference.infer_shapes(a);onnx.checker.check_model(a)
meta=json.loads(next(x.value for x in a.metadata_props if x.key=='rfdetr_notes'));meta['input']['shape']=[1,3,768,768];meta['conversion']={'source_onnx_sha256':hashlib.sha256(src.read_bytes()).hexdigest(),'position_resize':'96x96 -> 64x64 bicubic align_corners=False antialias=False; CLS unchanged','mask_head_retained':True,'shape_constants_changed':len(changes),'reference_full768_revision':'ed8e6078b9e119f6b1db89c7aea39f08046d65f8'};next(x for x in a.metadata_props if x.key=='rfdetr_notes').value=json.dumps(meta)
onnx.save(a,p/'koharu-768-fullmask.onnx');report={'shape_constants_changed':len(changes),'changed_node_names':changes,'position_reference_max_abs':delta,'nodes_retained':len(a.graph.node),'initializers':len(a.graph.initializer),'outputs':[(o.name,[d.dim_value for d in o.type.tensor_type.shape.dim]) for o in a.graph.output],'sha256':hashlib.sha256((p/'koharu-768-fullmask.onnx').read_bytes()).hexdigest()};(p/'conversion-report.json').write_text(json.dumps(report,indent=2));print({k:v for k,v in report.items() if k!='changed_node_names'})
