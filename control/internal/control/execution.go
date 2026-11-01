package control

import (
	"fmt"
	"strings"
)

func execution(value string) string {
	if value == "" {
		return "cpu"
	}
	return value
}

type ExecutionProfile struct {
	UnavailableReason string   `json:"unavailableReason,omitempty"`
	VRAMGiB           uint64   `json:"-"`
	MemoryRequired    bool     `json:"-"`
	Available         bool     `json:"available"`
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	Note              string   `json:"note"`
	Recommended       bool     `json:"recommended"`
	Settings          Settings `json:"settings"`
}

func (m *Manager) validateExecution(s Settings) error {
	if s.RestorationBackend != "" && s.RestorationBackend != "onnx" && s.RestorationBackend != "libtorch" {
		return fmt.Errorf("지원하지 않는 복원 실행 방식")
	}
	if s.RestorationBackend == "libtorch" && (m.runtimeByID("torch-cuda") == nil || m.modelForGroup("manga-lama-torch", "restoration") == nil) {
		return fmt.Errorf("이 플랫폼에는 LibTorch CUDA 복원 런타임이 없습니다")
	}
	if execution(s.LLMExecution) != "cpu" && s.LLMExecution != "vulkan" && s.LLMExecution != "cuda" {
		return fmt.Errorf("지원하지 않는 번역 실행 방식")
	}
	for _, b := range []string{s.LayoutExecution, s.OCRExecution} {
		switch execution(b) {
		case "cpu", "cuda", "directml":
		default:
			return fmt.Errorf("지원하지 않는 이미지 실행 방식: %s", b)
		}
	}
	if s.LayoutExecution == "webgpu" {
		return fmt.Errorf("탐지는 ONNX 실행 런타임을 사용합니다")
	}
	if err := validateOCRExecution(m.modelByID(s.OCR), execution(s.OCRExecution)); err != nil {
		return err
	}

	if s.LayoutExecution != "" && s.LayoutExecution != "cpu" && s.OCRExecution != "" && s.OCRExecution != "cpu" && s.LayoutExecution != s.OCRExecution {
		return fmt.Errorf("두 ONNX 단계는 같은 GPU 런타임을 사용해야 합니다")
	}
	for _, family := range []string{"llama", "ort", "litert"} {
		requested := s.LLMExecution
		if family == "ort" {
			requested = s.LayoutExecution
			if execution(s.OCRExecution) != "cpu" {
				requested = s.OCRExecution
			}
		}
		if family == "litert" {
			requested = "cpu"
		}
		if execution(requested) != "cpu" && m.runtimeForSettings(family, s) == nil {
			return fmt.Errorf("이 플랫폼에는 선택한 %s 실행 런타임이 없습니다", family)
		}
	}
	return nil
}

func (m *Manager) executionProfiles() []ExecutionProfile {
	return m.executionProfilesFor(hardwareSnapshot())
}

func (m *Manager) executionProfilesFor(hardware HardwareInfo) []ExecutionProfile {
	base := Settings{Layout: "koharu-768", OCR: "hayai-int8", Model: "gemma", ThreadsAuto: true, Threads: detectedCPU().RecommendedThreads, LLMExecution: "cpu", LayoutExecution: "cpu", OCRExecution: "cpu", Profile: "cpu"}
	profiles := []ExecutionProfile{{ID: "cpu", Name: "CPU · 저메모리", Note: "Koharu 768 / Hayai INT8 / Gemma E2B · 성능 코어 기준 자동 스레드", Recommended: true, Settings: base}}
	if m.runtimeByID("llama-vulkan") != nil {
		gpu := base
		gpu.Profile = "gpu-mixed"
		gpu.LLMExecution = "vulkan"
		profiles = append(profiles, ExecutionProfile{ID: gpu.Profile, Name: "CPU/GPU 병행 · 저용량", Note: "탐지·OCR은 CPU, Gemma E2B는 Vulkan GPU", Settings: gpu})
		backend := ""
		if m.runtimeByID("ort-cuda") != nil {
			backend = "cuda"
		}
		if m.runtimeByID("ort-directml") != nil {
			backend = "directml"
		}
		if backend != "" {
			gpu.Profile = "gpu-balanced"
			gpu.OCR = "hayai-onnx-fp32-kv"
			gpu.LayoutExecution = backend
			gpu.OCRExecution = backend
			profiles = append(profiles, ExecutionProfile{ID: gpu.Profile, Name: "GPU · Gemma E2B", Note: "탐지·OCR·번역을 GPU로 실행 · Hayai FP32 + 작은 번역 모델", Settings: gpu})
			gpu.Profile = "gpu-12gb"
			gpu.Model = "gemma-e4b"
			profiles = append(profiles, ExecutionProfile{ID: gpu.Profile, Name: "GPU · Gemma E4B", Note: "Hayai FP32 + 큰 번역 모델 · VRAM 8GB급 권장 (사용 환경에 따라 차이)", VRAMGiB: 8, Settings: gpu})
			if m.modelByID("gemma-12b-qat") != nil {
				gpu.Profile = "gpu-12b-qat"
				gpu.Model = "gemma-12b-qat"
				profiles = append(profiles, ExecutionProfile{ID: gpu.Profile, Name: "GPU · Gemma 12B QAT", Note: "Hayai FP32 + 12B QAT · VRAM 12GB급 이상", VRAMGiB: 12, MemoryRequired: true, Settings: gpu})
			}
		}
	}
	// Resolve the same presets against actual backend support and pin their GPU.
	for i := 1; i < len(profiles); i++ {
		s := profiles[i].Settings
		gpus := hardware.GPUs
		if profiles[i].MemoryRequired {
			gpus = nil
			for _, g := range hardware.GPUs {
				if profileMemoryFits(g, profiles[i].VRAMGiB, hardware.RAMAvailable) {
					gpus = append(gpus, g)
				}
			}
		}
		if m.runtimeByID("llama-cuda") != nil {
			s.LLMExecution = "cuda"
			if g, err := selectedGPU(s, gpus); err == nil {
				s.GPU = g.ID
				profiles[i].Settings = s
				profiles[i].Note = strings.ReplaceAll(profiles[i].Note, "Vulkan", "CUDA") + " · 번역 CUDA"
				if model := m.modelByID(s.Model); model != nil && model.LLM != nil && model.LLM.DraftBackend == "cuda" {
					profiles[i].Note += fmt.Sprintf(" · MTP%d", model.LLM.DraftTokens)
				}
				continue
			}
		}
		s.LLMExecution = "vulkan"
		if g, err := selectedGPU(s, gpus); err == nil {
			s.GPU = g.ID
		}
		profiles[i].Settings = s
		profiles[i].Note += " · 번역 Vulkan"
	}
	best := 0
	for i := range profiles {
		if i == 0 {
			continue
		}
		if g, err := selectedGPU(profiles[i].Settings, hardware.GPUs); err == nil && g.Vendor != "13b5" {
			if profileMemoryFits(g, profiles[i].VRAMGiB, hardware.RAMAvailable) {
				best = i
			}
		}
	}
	for i := range profiles {
		profiles[i].Recommended = i == best
		_, err := selectedGPU(profiles[i].Settings, hardware.GPUs)
		profiles[i].Available = err == nil
		if profiles[i].Available && profiles[i].MemoryRequired {
			g, _ := selectedGPU(profiles[i].Settings, hardware.GPUs)
			if !profileMemoryFits(g, profiles[i].VRAMGiB, hardware.RAMAvailable) {
				profiles[i].Available = false
				profiles[i].UnavailableReason = fmt.Sprintf("VRAM %dGB급 GPU가 필요합니다", profiles[i].VRAMGiB)
			}
		}
	}
	return profiles
}

func profileMemoryFits(g GPUInfo, gib uint64, availableRAM int64) bool {
	if gib == 0 {
		return true
	}
	if g.MemoryKind == "shared" {
		return availableRAM >= 24*1024*1024*1024
	}
	// NVML can report a few MiB less than the card's physical memory class.
	// Keep the allowance small enough that an 8GB card cannot qualify as 12GB.
	const driverReservation = 64 * 1024 * 1024
	return g.MemoryTotal != nil && *g.MemoryTotal >= gib*1024*1024*1024-driverReservation
}

func usesGPU(s Settings) bool {
	return s.RestorationBackend == "libtorch" || execution(s.LLMExecution) != "cpu" || execution(s.LayoutExecution) != "cpu" || execution(s.OCRExecution) != "cpu"
}

func selectedGPU(s Settings, gpus []GPUInfo) (GPUInfo, error) {
	if !usesGPU(s) {
		return GPUInfo{}, nil
	}
	compatible := func(g GPUInfo) bool {
		if (s.LLMExecution == "cuda" || s.RestorationBackend == "libtorch") && !llmCUDASupported(g) {
			return false
		}
		if s.LLMExecution == "vulkan" && g.VulkanIndex == nil {
			return false
		}
		if (s.LLMExecution == "cuda" || s.LayoutExecution == "cuda" || s.OCRExecution == "cuda") && g.CUDAIndex == nil {
			return false
		}
		if (s.LayoutExecution == "directml" || s.OCRExecution == "directml") && g.DirectMLIndex == nil {
			return false
		}
		return true
	}
	var selected *GPUInfo
	for i := range gpus {
		g := &gpus[i]
		if s.GPU != "" && s.GPU != g.ID {
			continue
		}
		if !compatible(*g) {
			continue
		}
		if selected == nil || (g.MemoryTotal != nil && (selected.MemoryTotal == nil || *g.MemoryTotal > *selected.MemoryTotal)) {
			selected = g
		}
	}
	if selected == nil {
		return GPUInfo{}, fmt.Errorf("선택한 실행 방식을 지원하는 GPU를 찾지 못했습니다. GPU 드라이버와 실행 설정을 확인하세요")
	}
	return *selected, nil
}

func onnxGPUIndex(s Settings, g GPUInfo) int {
	if (s.LayoutExecution == "cuda" || s.OCRExecution == "cuda") && g.CUDAIndex != nil {
		return *g.CUDAIndex
	}
	if (s.LayoutExecution == "directml" || s.OCRExecution == "directml") && g.DirectMLIndex != nil {
		return *g.DirectMLIndex
	}
	return 0
}

func validateOCRExecution(model *Model, backend string) error {
	if model == nil {
		return nil
	}
	if model.Backend == "litert" && backend != "cpu" {
		return fmt.Errorf("Hayai INT8는 CPU 전용입니다. GPU OCR에는 지원되는 ONNX 모델을 선택하세요")
	}
	if (model.Backend == "baberu-int4" || model.Backend == "baberu-fp16") && backend != "cpu" && backend != "cuda" {
		return fmt.Errorf("Baberu는 CPU 또는 CUDA 인코더 + CPU 디코더 구성을 지원합니다. 글자 인식을 CPU로 설정하세요")
	}
	return nil
}

// The input contains the CPU-only device/offload options immediately after -m.
func llmExecutionArgs(args []string, backend string) []string {
	if backend != "cuda" && backend != "vulkan" {
		return args
	}
	result := append([]string{}, args[:2]...)
	result = append(result, args[7:]...)
	device := "Vulkan0"
	if backend == "cuda" {
		device = "CUDA0"
	}
	return append(result, "--device", device, "--gpu-layers", "999", "-lv", "4")
}

func llmGPUEnvironment(backend string, gpu GPUInfo) map[string]string {
	if backend == "cuda" {
		return map[string]string{"CUDA_VISIBLE_DEVICES": fmt.Sprint(*gpu.CUDAIndex)}
	}
	return map[string]string{"GGML_VK_VISIBLE_DEVICES": fmt.Sprint(*gpu.VulkanIndex)}
}

// The packaged CUDA 13.4 build targets Turing (SM 7.5) and newer.
// CUDA 13.x minor-version compatibility requires a 13.x-capable driver.
func llmCUDASupported(g GPUInfo) bool {
	return g.Vendor == "10de" && g.CUDAIndex != nil && g.CUDAComputeCapability >= 75 && g.CUDADriverVersion >= 13000
}
