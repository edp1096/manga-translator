package control

import (
	"encoding/binary"
	"fmt"
	"runtime"
	"sync"
	"unsafe"
)

// Driver ABI only: no helper process, CUDA context or GPU inference allocation.
var vulkanDevices = sync.OnceValue(func() []GPUInfo {
	var pins runtime.Pinner
	defer pins.Unpin()
	lib, err := openDriverLibrary("vulkan")
	if err != nil {
		return nil
	}
	type appInfo struct {
		SType                     uint32
		Next                      uintptr
		Name                      uintptr
		Version                   uint32
		Engine                    uintptr
		EngineVersion, APIVersion uint32
	}
	type instanceInfo struct {
		SType          uint32
		Next           uintptr
		Flags          uint32
		App            *appInfo
		LayerCount     uint32
		Layers         uintptr
		ExtensionCount uint32
		Extensions     uintptr
	}
	var create func(*instanceInfo, uintptr, *uintptr) int32
	var destroy func(uintptr, uintptr)
	var enumerate func(uintptr, *uint32, *uintptr) int32
	var properties func(uintptr, uintptr)
	var extensions func(uintptr, uintptr, *uint32, uintptr) int32
	if !bindDriver(lib, "vkCreateInstance", &create) || !bindDriver(lib, "vkDestroyInstance", &destroy) || !bindDriver(lib, "vkEnumeratePhysicalDevices", &enumerate) || !bindDriver(lib, "vkGetPhysicalDeviceProperties2", &properties) || !bindDriver(lib, "vkEnumerateDeviceExtensionProperties", &extensions) {
		return nil
	}
	app := appInfo{APIVersion: 1<<22 | 1<<12}
	info := instanceInfo{SType: 1, App: &app}
	pins.Pin(&app)
	pins.Pin(&info)
	var instance uintptr
	if create(&info, 0, &instance) != 0 {
		return nil
	}
	defer destroy(instance, 0)
	var count uint32
	if enumerate(instance, &count, nil) != 0 || count == 0 || count > 128 {
		return nil
	}
	devices := make([]uintptr, count)
	if enumerate(instance, &count, &devices[0]) != 0 {
		return nil
	}
	var result []GPUInfo
	for i, device := range devices[:count] {
		type idProperties struct {
			SType            uint32
			Next             uintptr
			UUID, DriverUUID [16]byte
			LUID             [8]byte
			Mask, Valid      uint32
		}
		type pciProperties struct {
			SType                         uint32
			Next                          uintptr
			Domain, Bus, Device, Function uint32
		}
		type deviceProperties struct {
			SType uint32
			Next  uintptr
			Data  [512]uint64
		}
		id := idProperties{SType: 1000071004}
		pci := pciProperties{SType: 1000212000}
		pins.Pin(&id)
		pins.Pin(&pci)
		var n uint32
		hasPCI := false
		if extensions(device, 0, &n, 0) == 0 && n > 0 && n < 4096 {
			entries := make([][260]byte, n)
			pins.Pin(&entries[0])
			if extensions(device, 0, &n, uintptr(unsafe.Pointer(&entries[0]))) == 0 {
				for _, e := range entries[:n] {
					if cText(e[:256]) == "VK_EXT_pci_bus_info" {
						hasPCI = true
					}
				}
			}
		}
		if hasPCI {
			id.Next = uintptr(unsafe.Pointer(&pci))
		}
		p := deviceProperties{SType: 1000059001, Next: uintptr(unsafe.Pointer(&id))}
		pins.Pin(&p)
		properties(device, uintptr(unsafe.Pointer(&p)))
		raw := unsafe.Slice((*byte)(unsafe.Pointer(&p.Data[0])), len(p.Data)*8)
		kind := binary.LittleEndian.Uint32(raw[16:20])
		if kind != 1 && kind != 2 {
			continue
		}
		stable := fmt.Sprintf("vulkan:%x", id.UUID)
		if id.Valid != 0 {
			stable = fmt.Sprintf("dxgi:%08x:%08x", binary.LittleEndian.Uint32(id.LUID[4:]), binary.LittleEndian.Uint32(id.LUID[:4]))
		} else if hasPCI {
			stable = fmt.Sprintf("%04x:%02x:%02x.%x", pci.Domain, pci.Bus, pci.Device, pci.Function)
		}
		index := i
		g := GPUInfo{ID: stable, Name: cText(raw[20:276]), Vendor: fmt.Sprintf("%04x", binary.LittleEndian.Uint32(raw[8:12])), MemoryKind: "unknown", Source: "Vulkan driver", VulkanIndex: &index}
		if kind == 1 {
			g.MemoryKind = "shared"
		}
		result = append(result, g)
	}
	return result
})

func executionGPUs(gpus []GPUInfo) []GPUInfo {
	result := append([]GPUInfo{}, gpus...)
	for _, v := range vulkanDevices() {
		match := -1
		for i, g := range result {
			if g.ID == v.ID {
				match = i
				break
			}
		}
		if match < 0 {
			matches := 0
			for i, g := range result {
				if g.Name == v.Name {
					match = i
					matches++
				}
			}
			if matches != 1 {
				match = -1
			}
		}
		if match < 0 && v.Vendor == "13b5" {
			// Panthor/Panfrost are the Linux DRM drivers for the same Mali GPU.
			candidates := 0
			for i, g := range result {
				if g.Vendor == "" && (g.Name == "panthor" || g.Name == "panfrost") {
					match = i
					candidates++
				}
			}
			if candidates != 1 {
				match = -1
			} else {
				result[match].ID = v.ID
				result[match].Name = v.Name
				result[match].Vendor = v.Vendor
				result[match].Source += " / Vulkan driver"
			}
		}
		if match < 0 {
			result = append(result, v)
		} else {
			result[match].VulkanIndex = v.VulkanIndex
		}
	}
	return result
}
