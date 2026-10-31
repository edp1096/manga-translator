package control

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"sync"

	"github.com/ebitengine/purego"
)

type driverLibrary struct{ symbol func(string) (uintptr, error) }

func bindDriver(lib driverLibrary, name string, fn any) bool {
	address, err := lib.symbol(name)
	if err != nil || address == 0 {
		return false
	}
	purego.RegisterFunc(fn, address)
	return true
}

// Driver libraries remain loaded for this process's lifetime. No CUDA context,
// inference runtime or GPU allocation is created for device-information queries.
var nvmlLibrary = sync.OnceValues(func() (driverLibrary, error) { return openDriverLibrary("nvml") })
var cudaLibrary = sync.OnceValues(func() (driverLibrary, error) { return openDriverLibrary("cuda") })

type cudaHardware struct {
	ComputeCapability int
	DriverVersion     int
	Index             int
	Shared            bool
	LUID              string
}

var integratedCUDA = sync.OnceValue(func() map[string]cudaHardware {
	result := map[string]cudaHardware{}
	lib, err := cudaLibrary()
	if err != nil {
		return result
	}
	var initialize func(uint32) int32
	var count func(*int32) int32
	var get func(*int32, int32) int32
	var attr func(*int32, int32, int32) int32
	var pci func(*byte, int32, int32) int32
	var luid func(*byte, *uint32, int32) int32
	bindDriver(lib, "cuDeviceGetLuid", &luid)
	if !bindDriver(lib, "cuInit", &initialize) || !bindDriver(lib, "cuDeviceGetCount", &count) || !bindDriver(lib, "cuDeviceGet", &get) || !bindDriver(lib, "cuDeviceGetAttribute", &attr) || !bindDriver(lib, "cuDeviceGetPCIBusId", &pci) || initialize(0) != 0 {
		return result
	}
	var driverVersion int32
	var version func(*int32) int32
	if bindDriver(lib, "cuDriverGetVersion", &version) {
		version(&driverVersion)
	}
	var n int32
	if count(&n) != 0 || n < 0 || n > 128 {
		return result
	}
	for i := int32(0); i < n; i++ {
		var device, value int32
		var bus [32]byte
		if get(&device, i) == 0 && attr(&value, 18, device) == 0 && pci(&bus[0], int32(len(bus)), device) == 0 {
			info := cudaHardware{Shared: value != 0, Index: int(i), DriverVersion: int(driverVersion)}
			var major, minor int32
			if attr(&major, 75, device) == 0 && attr(&minor, 76, device) == 0 {
				info.ComputeCapability = int(major*10 + minor)
			}
			if luid != nil {
				var bytes [8]byte
				var nodeMask uint32
				if luid(&bytes[0], &nodeMask, device) == 0 {
					info.LUID = fmt.Sprintf("dxgi:%08x:%08x", binary.LittleEndian.Uint32(bytes[4:]), binary.LittleEndian.Uint32(bytes[:4]))
				}
			}
			result[pciID(cText(bus[:]))] = info
		}
	}
	return result
})

func cText(data []byte) string {
	if i := bytes.IndexByte(data, 0); i >= 0 {
		data = data[:i]
	}
	return string(data)
}

type nvmlMemory struct{ Total, Free, Used uint64 }
type nvmlPCI struct {
	Legacy                                   [16]byte
	Domain, Bus, Device, DeviceID, Subsystem uint32
	BusID                                    [32]byte
}

func nvidiaGPUs() []GPUInfo {
	lib, err := nvmlLibrary()
	if err != nil {
		return nil
	}
	var initialize, shutdown func() int32
	var count func(*uint32) int32
	var handle func(uint32, *uintptr) int32
	var name func(uintptr, *byte, uint32) int32
	var memory func(uintptr, *nvmlMemory) int32
	var pci func(uintptr, *nvmlPCI) int32
	if !bindDriver(lib, "nvmlInit_v2", &initialize) || !bindDriver(lib, "nvmlShutdown", &shutdown) || !bindDriver(lib, "nvmlDeviceGetCount_v2", &count) || !bindDriver(lib, "nvmlDeviceGetHandleByIndex_v2", &handle) || !bindDriver(lib, "nvmlDeviceGetName", &name) || !bindDriver(lib, "nvmlDeviceGetMemoryInfo", &memory) || !bindDriver(lib, "nvmlDeviceGetPciInfo_v3", &pci) || initialize() != 0 {
		return nil
	}
	defer shutdown()
	var n uint32
	if count(&n) != 0 || n > 128 {
		return nil
	}
	integrated := integratedCUDA()
	var result []GPUInfo
	for i := uint32(0); i < n; i++ {
		var device uintptr
		var label [96]byte
		var bus nvmlPCI
		var mem nvmlMemory
		if handle(i, &device) != 0 || name(device, &label[0], uint32(len(label))) != 0 {
			continue
		}
		id := fmt.Sprintf("nvidia:%d", i)
		if pci(device, &bus) == 0 {
			id = pciID(cText(bus.BusID[:]))
		}
		g := GPUInfo{ID: id, Name: cText(label[:]), Vendor: "10de", MemoryKind: "unknown", Source: "NVML / CUDA driver"}
		info, found := integrated[id]
		if found {
			index := info.Index
			g.CUDAIndex = &index
			g.CUDAComputeCapability = info.ComputeCapability
			g.CUDADriverVersion = info.DriverVersion
		}
		if info.LUID != "" {
			g.ID = info.LUID
		}
		if info.Shared {
			g.MemoryKind = "shared"
		} else if memory(device, &mem) == 0 && mem.Total > 0 {
			g.MemoryKind = "dedicated"
			g.MemoryTotal = &mem.Total
			g.MemoryUsed = &mem.Used
			g.MemoryFree = &mem.Free
		}
		result = append(result, g)
	}
	return result
}
