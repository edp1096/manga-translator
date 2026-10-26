"""Developer monitor: NVML process allocations; GB10 shares physical system RAM."""
import ctypes as c,json,subprocess,sys,time
from pathlib import Path
n=c.CDLL('libnvidia-ml.so.1');assert n.nvmlInit_v2()==0;device=c.c_void_p();assert n.nvmlDeviceGetHandleByIndex_v2(0,c.byref(device))==0
class Process(c.Structure):_fields_=[('pid',c.c_uint),('usedGpuMemory',c.c_ulonglong),('gpuInstanceId',c.c_uint),('computeInstanceId',c.c_uint)]
class Util(c.Structure):_fields_=[('gpu',c.c_uint),('memory',c.c_uint)]
def processes():
 count=c.c_uint(128);rows=(Process*128)();ret=n.nvmlDeviceGetComputeRunningProcesses_v3(device,c.byref(count),rows)
 if ret:return {}
 return {r.pid:r.usedGpuMemory for r in rows[:count.value] if r.usedGpuMemory!=2**64-1}
u=Util();n.nvmlDeviceGetUtilizationRates(device,c.byref(u));before=processes();peak=0;samples=0
with open(sys.argv[1]+'.log','w') as log:
 p=subprocess.Popen(sys.argv[2:],stdout=log,stderr=log)
 while p.poll() is None:
  values=processes()
  if p.pid in values:peak=max(peak,values[p.pid]);samples+=1
  time.sleep(.01)
report={'exitCode':p.returncode,'processPeakGpuAllocationBytes':peak if samples else None,'sampleCount':samples,'sampleIntervalMs':10,'backgroundGpuUtilizationBefore':u.gpu,'backgroundAllocationsBytes':before,'note':'NVML allocation accounting on GB10 unified memory; do not add to RSS as independent physical VRAM.'}
Path(sys.argv[1]).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report));sys.exit(p.returncode)
