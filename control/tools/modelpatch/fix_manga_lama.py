"""Freeze only public input/output shapes; preserve all trained weights.

Source: mayocream/lama-manga-onnx revision b55497aadbfcb9740e1ed16f008268d71b4f3f79.
Run with onnx installed, then use modelpatch to create the embedded BSDIFF patch.
"""
import sys
import onnx

model = onnx.load(sys.argv[1])
assert [v.name for v in model.graph.input] == ["image", "mask"]
assert [v.name for v in model.graph.output] == ["output"]
for value in [*model.graph.input, *model.graph.output]:
    shape = [1, 1 if value.name == "mask" else 3, 512, 512]
    assert len(value.type.tensor_type.shape.dim) == len(shape)
    for dim, size in zip(value.type.tensor_type.shape.dim, shape):
        assert not dim.HasField("dim_value") or dim.dim_value == size
        dim.ClearField("dim_param")
        dim.dim_value = size
onnx.checker.check_model(model)
onnx.save(model, sys.argv[2])
