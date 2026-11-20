package control

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func measuredTensorRTOCR(platform, ocr string, g GPUInfo) bool {
	if ocr != "hayai-supernova-fp32" && ocr != "hayai-onnx-fp32-kv" {
		return false
	}
	if !llmCUDASupported(g) || g.CUDAIndex == nil {
		return false
	}
	switch platform {
	case "windows-amd64":
		return g.DirectMLIndex != nil && g.CUDAComputeCapability == 89 && strings.HasSuffix(strings.ToUpper(g.Name), "RTX 4070 SUPER")
	case "linux-amd64":
		return ocr == "hayai-onnx-fp32-kv" && g.CUDAComputeCapability == 89 && strings.HasSuffix(strings.ToUpper(g.Name), "RTX 4070 SUPER")
	case "linux-arm64":
		return g.CUDAComputeCapability == 121 && strings.Contains(strings.ToUpper(g.Name), "GB10")
	}
	return false
}

// Include the automatic GPU choice only if it resolves to a supported device.
func (m *Manager) tensorRTOCRGPUs(ocr string, gpus []GPUInfo) []string {
	if m.runtimeByID("tensorrt") == nil {
		return nil
	}
	var ids []string
	for _, gpu := range gpus {
		if measuredTensorRTOCR(m.platform, ocr, gpu) {
			ids = append(ids, gpu.ID)
		}
	}
	if len(ids) > 0 {
		s := Settings{LLMExecution: "cuda", OCRExecution: "cuda"}
		if m.platform == "windows-amd64" {
			s.OCRExecution = "directml"
		}
		if gpu, err := selectedGPU(s, gpus); err == nil && measuredTensorRTOCR(m.platform, ocr, gpu) {
			ids = append(ids, "")
		}
	}
	return ids
}

// Building and executing a serialized engine requires the same precision override.
func (m *Manager) tensorRTEnvironment(env []string, s Settings) []string {
	if m.platform != "windows-amd64" && s.OCR == "hayai-onnx-fp32-kv" {
		// Its three plans disable TF32 in the builder. Preserve Koharu CUDA's usual precision.
		return env
	}
	return replaceEnvironment(env, map[string]string{"NVIDIA_TF32_OVERRIDE": "0"})
}

// Include the graph and all its external weights, runtime build, driver and device.
// A portable installation can move between machines or receive model updates.
func (m *Manager) tensorRTCache(s Settings, gpu GPUInfo) string {
	h := sha256.New()
	fmt.Fprintf(h, "hayai-fp32-v1/%s/%s/%d/%d", m.platform, gpu.Name, gpu.CUDAComputeCapability, gpu.CUDADriverVersion)
	if s.OCR == "hayai-onnx-fp32-kv" {
		value, present := os.LookupEnv("NVIDIA_TF32_OVERRIDE")
		if m.platform == "windows-amd64" {
			value, present = "0", true
		}
		fmt.Fprintf(h, "/v21-precision/%t/%s", present, value)
	}
	for _, a := range m.artifactsForSettings([]string{s.OCR}, true, s) {
		if a.Group == "ocr" || strings.Contains(a.ID, "supernova") || strings.HasPrefix(a.ID, "tensorrt-") {
			fmt.Fprint(h, "/", a.SHA256, "/", a.PatchSHA256)
		}
	}
	return fmt.Sprintf("data/cache/tensorrt/%x", h.Sum(nil)[:16])
}

type planReceipt struct {
	Size   int64
	SHA256 string
}

func planNames(ocr string) []string {
	names := []string{"prefill.plan", "decode.plan"}
	if ocr == "hayai-onnx-fp32-kv" {
		names = append(names, "encoder.plan")
	}
	return names
}

func inspectPlans(dir, ocr string) (map[string]planReceipt, error) {
	out := make(map[string]planReceipt, 2)
	for _, name := range planNames(ocr) {
		path := filepath.Join(dir, name)
		st, err := os.Lstat(path)
		if err != nil {
			return nil, err
		}
		if !st.Mode().IsRegular() || st.Size() == 0 {
			return nil, fmt.Errorf("invalid TensorRT plan %s", name)
		}
		digest, err := hashFile(path)
		if err != nil {
			return nil, err
		}
		out[name] = planReceipt{st.Size(), digest}
	}
	return out, nil
}

func validPlans(dir, ocr string) bool {
	raw, err := os.ReadFile(filepath.Join(dir, "receipt.json"))
	if err != nil {
		return false
	}
	var saved map[string]planReceipt
	if json.Unmarshal(raw, &saved) != nil {
		return false
	}
	current, err := inspectPlans(dir, ocr)
	return err == nil && maps.Equal(current, saved)
}

func (m *Manager) prepareTensorRT(ctx context.Context, s Settings) error {
	gpu, err := selectedGPU(s, executionGPUs(probeGPUs()))
	if err != nil {
		return err
	}
	dir, err := safeDestination(m.root, m.tensorRTCache(s, gpu))
	if err != nil {
		return err
	}
	if validPlans(dir, s.OCR) {
		return nil
	}
	if err = os.MkdirAll(filepath.Dir(dir), 0700); err != nil {
		return err
	}
	temp, err := os.MkdirTemp(filepath.Dir(dir), ".building-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temp)
	exe, err := m.runtimeExecutable("tensorrt")
	if err != nil {
		return err
	}
	libs, err := m.runtimeLibraryDirs("vision")
	if err != nil {
		return err
	}
	model, err := safeDestination(m.root, m.selectedPath("ocr"))
	if err != nil {
		return err
	}
	for _, path := range []string{"data/tmp", "data/cache/cuda"} {
		if err = os.MkdirAll(filepath.Join(m.root, path), 0700); err != nil {
			return err
		}
	}
	m.logf("Hayai TensorRT FP32 엔진을 현재 GPU에 맞춰 준비합니다")
	command := "--build-hayai"
	if s.OCR == "hayai-onnx-fp32-kv" {
		command = "--build-hayai-v21"
	}
	cmd := exec.CommandContext(ctx, exe, command, model, temp, fmt.Sprint(*gpu.CUDAIndex))
	cmd.Dir = m.root
	cmd.Env = m.tensorRTEnvironment(processEnvironment(m.root, libs), s)
	configureProcess(cmd)
	log, err := os.Create(filepath.Join(temp, "build.log"))
	if err != nil {
		return err
	}
	cmd.Stdout = log
	cmd.Stderr = log
	err = cmd.Run()
	log.Close()
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		logPath := filepath.Join(filepath.Dir(dir), "last-build.log")
		if copyErr := os.Rename(filepath.Join(temp, "build.log"), logPath); copyErr != nil {
			return fmt.Errorf("TensorRT 엔진 생성 실패: %w", err)
		}
		return fmt.Errorf("TensorRT 엔진 생성 실패 (%s): %w", logPath, err)
	}
	receipts, err := inspectPlans(temp, s.OCR)
	if err != nil {
		return err
	}
	if err = writeJSON(filepath.Join(temp, "receipt.json"), receipts); err != nil {
		return err
	}
	// Only the generated cache with this exact fingerprint may be replaced.
	if err = os.RemoveAll(dir); err != nil {
		return err
	}
	return os.Rename(temp, dir)
}
