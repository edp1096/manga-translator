package control

import "fmt"

func execution(value string) string {
	if value == "" {
		return "cpu"
	}
	return value
}

type ExecutionProfile struct {
	Available   bool     `json:"available"`
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Note        string   `json:"note"`
	Recommended bool     `json:"recommended"`
	Settings    Settings `json:"settings"`
}

func (m *Manager) validateExecution(s Settings) error {
	if execution(s.LLMExecution) != "cpu" && s.LLMExecution != "vulkan" {
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
			profiles = append(profiles, ExecutionProfile{ID: gpu.Profile, Name: "GPU · Gemma E4B", Note: "Hayai FP32 + 큰 번역 모델 · VRAM 12 GiB 이상 권장 (구성 추정)", Settings: gpu})
		}
	}
	hardware := hardwareSnapshot()
	best := 0
	for i := range profiles {
		if i == 0 {
			continue
		}
		if g, err := selectedGPU(profiles[i].Settings, hardware.GPUs); err == nil && g.Vendor != "13b5" {
			if profiles[i].ID != "gpu-12gb" || (g.MemoryTotal != nil && *g.MemoryTotal >= 12*1024*1024*1024) || (g.MemoryKind == "shared" && hardware.RAMAvailable >= 24*1024*1024*1024) {
				best = i
			}
		}
	}
	for i := range profiles {
		profiles[i].Recommended = i == best
		_, err := selectedGPU(profiles[i].Settings, hardware.GPUs)
		profiles[i].Available = err == nil
	}
	return profiles
}

func usesGPU(s Settings) bool {
	return execution(s.LLMExecution) != "cpu" || execution(s.LayoutExecution) != "cpu" || execution(s.OCRExecution) != "cpu"
}

func selectedGPU(s Settings, gpus []GPUInfo) (GPUInfo, error) {
	if !usesGPU(s) {
		return GPUInfo{}, nil
	}
	compatible := func(g GPUInfo) bool {
		if s.LLMExecution == "vulkan" && g.VulkanIndex == nil {
			return false
		}
		if (s.LayoutExecution == "cuda" || s.OCRExecution == "cuda") && g.CUDAIndex == nil {
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
