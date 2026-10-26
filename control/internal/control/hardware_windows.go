//go:build windows

package control

import (
	"encoding/binary"
	"fmt"
	"path/filepath"
	"runtime"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

func windowsHardwareString(key, name string) string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, key, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()
	s, _, _ := k.GetStringValue(name)
	return s
}

func probeCPU() CPUInfo {
	kernel := windows.NewLazySystemDLL("kernel32.dll")
	proc := kernel.NewProc("GetLogicalProcessorInformationEx")
	var cores []cpuCore
	if proc.Find() == nil {
		var size uint32
		proc.Call(0, 0, uintptr(unsafe.Pointer(&size)))
		if size > 0 && size < 4*1024*1024 {
			data := make([]byte, size)
			if ok, _, _ := proc.Call(0, uintptr(unsafe.Pointer(&data[0])), uintptr(unsafe.Pointer(&size))); ok != 0 {
				var allowed, system uintptr
				getAffinity := kernel.NewProc("GetProcessAffinityMask")
				if getAffinity.Find() == nil && runtime.NumCPU() <= 64 {
					getAffinity.Call(^uintptr(0), uintptr(unsafe.Pointer(&allowed)), uintptr(unsafe.Pointer(&system)))
				}
				cores, _ = decodeWindowsCores(data[:size], uint64(allowed))
			}
		}
	}
	// Windows EfficiencyClass is ordinal, not a proportional capacity value.
	lo, hi := 256, 0
	for _, core := range cores {
		lo = min(lo, core.capacity)
		hi = max(hi, core.capacity)
	}
	if hi > lo {
		for i := range cores {
			if cores[i].capacity == hi {
				cores[i].capacity = 1024
			} else {
				cores[i].capacity = 512
			}
		}
	}
	c := recommendCPU(cores, len(cores) > 0, 0)
	c.Name = windowsHardwareString(`HARDWARE\DESCRIPTION\System\CentralProcessor\0`, "ProcessorNameString")
	c.Board = windowsHardwareString(`HARDWARE\DESCRIPTION\System\BIOS`, "SystemProductName")
	c.Source = "Windows processor topology / registry"
	return c
}

func openDriverLibrary(kind string) (driverLibrary, error) {
	name := map[string]string{"nvml": "nvml.dll", "cuda": "nvcuda.dll", "vulkan": "vulkan-1.dll"}[kind]
	if name == "" {
		return driverLibrary{}, fmt.Errorf("unknown driver API")
	}
	dir, err := windows.GetSystemDirectory()
	if err != nil {
		return driverLibrary{}, err
	}
	dll, err := windows.LoadDLL(filepath.Join(dir, name))
	if err != nil {
		return driverLibrary{}, err
	}
	return driverLibrary{symbol: func(name string) (uintptr, error) {
		p, e := dll.FindProc(name)
		if e != nil {
			return 0, e
		}
		return p.Addr(), nil
	}}, nil
}

type comHardwareObject struct{ Methods *[16]uintptr }

func comHardwareCall(object *comHardwareObject, method int, args ...uintptr) uintptr {
	params := append([]uintptr{uintptr(unsafe.Pointer(object))}, args...)
	result, _, _ := syscall.SyscallN(object.Methods[method], params...)
	return result
}
func releaseHardwareObject(object *comHardwareObject) {
	if object != nil {
		comHardwareCall(object, 2)
	}
}

// D3D12's UMA flag distinguishes integrated/shared memory without guessing from
// a vendor name or incorrectly counting SharedSystemMemory as dedicated VRAM.
func dxgiMemoryKind(adapter *comHardwareObject) string {
	proc := windows.NewLazySystemDLL("d3d12.dll").NewProc("D3D12CreateDevice")
	if proc.Find() != nil {
		return "unknown"
	}
	iid := windows.GUID{Data1: 0x189819f1, Data2: 0x1db6, Data3: 0x4b57, Data4: [8]byte{0xbe, 0x54, 0x18, 0x21, 0x33, 0x9b, 0x85, 0xf7}}
	var device *comHardwareObject
	r, _, _ := proc.Call(uintptr(unsafe.Pointer(adapter)), 0xb000, uintptr(unsafe.Pointer(&iid)), uintptr(unsafe.Pointer(&device)))
	if int32(r) < 0 || device == nil {
		return "unknown"
	}
	defer releaseHardwareObject(device)
	var architecture [4]uint32
	if int32(comHardwareCall(device, 13, 1, uintptr(unsafe.Pointer(&architecture[0])), unsafe.Sizeof(architecture))) < 0 {
		return "unknown"
	}
	if architecture[2] != 0 {
		return "shared"
	}
	return "dedicated"
}

func probeGPUs() []GPUInfo {
	var gpus []GPUInfo
	proc := windows.NewLazySystemDLL("dxgi.dll").NewProc("CreateDXGIFactory1")
	if proc.Find() == nil {
		iid := windows.GUID{Data1: 0x770aae78, Data2: 0xf26f, Data3: 0x4dba, Data4: [8]byte{0xa8, 0x29, 0x25, 0x3c, 0x83, 0xd1, 0xb3, 0x87}}
		var factory *comHardwareObject
		result, _, _ := proc.Call(uintptr(unsafe.Pointer(&iid)), uintptr(unsafe.Pointer(&factory)))
		if int32(result) >= 0 && factory != nil {
			defer releaseHardwareObject(factory)
			for index := uintptr(0); index < 64; index++ {
				var adapter *comHardwareObject
				if int32(comHardwareCall(factory, 12, index, uintptr(unsafe.Pointer(&adapter)))) < 0 || adapter == nil {
					break
				}
				var desc [312]byte
				if int32(comHardwareCall(adapter, 10, uintptr(unsafe.Pointer(&desc[0])))) >= 0 && binary.LittleEndian.Uint32(desc[304:308])&2 == 0 {
					g := decodeDXGIDescription(desc[:])
					idx := int(index)
					g.DirectMLIndex = &idx
					g.MemoryKind = dxgiMemoryKind(adapter)
					if g.MemoryKind == "shared" {
						g.MemoryTotal = nil
					}
					gpus = append(gpus, g)
				}
				releaseHardwareObject(adapter)
			}
		}
	}
	return mergeGPUs(gpus, nvidiaGPUs())
}
