Manga Translator 0.3.8 — Local control app

Windows x64, Linux ARM64 and Linux x64. Go serves the bundled Svelte management interface.
Python, Node.js, Go, a C++ compiler and separately installed model tools are NOT
required by the end user. The native image API is bundled application code. Third-party inference runtimes
and model files download only after you press a download button. A verified ~6 MB
Koharu conversion patch is included to reproduce the selected model exactly.

Start
1. Extract the ZIP into a writable folder and launch its top-level executable.
   All configuration, models, runtimes and jobs stay inside that folder.
2. Windows: double-click MangaTranslator.exe.
   Linux: run ./manga-control.
3. The browser opens http://127.0.0.1:8794 without downloading models/runtimes.
   In 설치 관리, select a layout, OCR and translation model. Download models
   individually, or use 선택한 조합 다운로드·복구 for the selected combination.
   Required runtimes are included; unselected models are never downloaded.
   Downloads can be paused/resumed and are SHA-256 verified. Then start the API.
   Automatic API startup is optional and only uses installed, verified files.
   E2B/INT8 needs about 3 GB of downloads; E4B adds a larger 4.59 GB LLM file.
   Disk and memory estimates are shown before downloading.
4. In '크롬 확장', open the extension folder and chrome://extensions.
   Enable Developer mode, choose 'Load unpacked', then select the extension folder.
   Refresh the management page and click '확장 연결하기'. No token copying is needed.
5. Open a comic page and click the extension icon. The side panel belongs to
   that tab. Switching tabs closes it; returning does not reopen it automatically.
   Click the extension icon to open it again. Existing translation jobs continue.

The current user's Chrome profile is not modified to force-install extensions.
Chrome requires the unpacked-extension loading step to be performed by the user.
The extension has a fixed public ID across installations; private access keys are
created separately on each machine. The management page never receives that key.

Windows
- The Go launcher and native image API were cross-compiled for Windows x64 and
  their imported DLL dependencies were checked. Actual Windows model inference
  has NOT yet been validated on a Windows machine.
- ONNX Runtime, LiteRT and llama.cpp Windows binaries are downloaded from their
  upstream releases, using pinned versions and SHA-256 checksums.
- Required Microsoft Visual C++ DLLs are extracted from the pinned official
  package into bin/ and the selected llama.cpp runtime folder. The installer is never executed;
  no global installation, UAC prompt or user-profile runtime folder is used.
- The management page opens in Chrome when Chrome is installed. If Chrome was
  installed after the app started, launch the app again to open that page in Chrome.
- Use a Windows 10/11 x64 machine with sufficient memory; 16 GB is recommended.
  The 768 image API requires at least 3 GiB available after Gemma starts;
  the original 1152 choice requires at least 8 GiB before vision startup.

What is prepared
- Koharu 768 or original Koharu 2XL 1152, both with full segmentation masks.
  ONNX Runtime 1.31.0 is used. The original 1152 choice needs substantially more
  memory (8 GiB free before vision startup, 6 GiB vision RSS guard).
- Hayai v2 ONNX FP32 + KV cache (the original full-precision candidate),
  or LiteRT dynamic INT8 OCR. The UI selection changes the actual OCR backend.
  ONNX CPU/CUDA uses ONNX Runtime 1.31.0; Windows DirectML uses 1.24.4.
  LiteRT INT8 uses LiteRT 2.3.1 on CPU.
  LiteRT is loaded only for a LiteRT choice, so an ONNX-only setup needs no LiteRT.
- Gemma 4 E2B or E4B Q4_0, llama.cpp 0.7.0 (official binary b11669), CPU or Vulkan GPU.
The native pipeline derives the selected 768/1152 input and 192/288 mask sizes.
The selected Koharu model is reconstructed from its pinned upstream 1152 ONNX
using an embedded, verified binary conversion patch. The final model is byte-for-
byte the previously validated 768 model (SHA-256 120cc9d2a0a73c47382b2f3624b2b6be54258f0d5b143e4eb9b229cda1b63175).
No Python conversion, substituted model or external private release server is needed.
DOWNLOADS.json documents pinned upstream URLs and checksums. Editing that copy
cannot override the executable's embedded download catalog.

Portable layout
All application files stay in the extracted folder. The default data root is the
main executable's own directory, resolved to an absolute path. It never uses the
current working directory, ../config.json, HOME, XDG_DATA_HOME or LOCALAPPDATA.
No installation or implicit per-user data folder is created.

  manga-control        Linux main program (Windows: MangaTranslator.exe)
  config/              User and generated native API configuration
  models/              Only explicitly downloaded models
  runtime/             Native runtime libraries and llama.cpp
  bin/                 Managed native image server and its local dependencies
  data/                Private access keys, jobs, logs and resumable downloads
  extension/           Bundled Chrome extension, exported on first run
  licenses/            License notices

Launch only the top-level main program. Source code is not required. Moving the
whole folder while stopped preserves settings and model files; re-register the
extension folder with Chrome after moving it. --print-root reports the portable
root without writing files. An optional --root must be an explicit absolute path.

Execution profiles
- CPU low-memory: Koharu 768 + Hayai INT8 + Gemma E2B, all on CPU.
- CPU/GPU mixed: the same small models, with Gemma E2B on Vulkan GPU.
- GPU E2B / GPU E4B: Koharu and Hayai ONNX FP32 on CUDA (Linux NVIDIA) or
  DirectML (Windows), with the selected Gemma on Vulkan. Individual models and
  stage execution choices remain adjustable while stopped.
- Hayai INT8 remains visible but cannot be selected when OCR is configured for
  GPU. Choose a CPU/mixed profile to use it. Unsupported GPU requests fail
  explicitly; the controller never silently changes the requested stage to CPU.
- Select a GPU by name or let the app select a compatible GPU. Driver-native
  PCI/LUID/UUID mapping resolves backend device indices. Hardware discovery uses
  pure Go / OS driver APIs, no hardware-information helper executable.
- GPU packages and their dependencies are downloaded only for the selected
  configuration or an explicit runtime download. Linux ARM64 CUDA uses CUDA 13;
  Linux x64 CUDA uses CUDA 12. The matching vendor GPU driver must be installed.
- CPU model RAM figures and profile VRAM recommendations are estimates, not
  guaranteed limits. Actual use depends on input size, model and context.
- LiteRT WebGPU failed the current Hayai model's shader compilation on GB10
  with both FP16 and FP32. It is excluded from supported execution choices.

Management
- Select/unselect/download/delete models per layout, OCR and translation group.
  Stop APIs before switching or deleting. Unselect a model before deleting it.
  Deletion removes only that model and its partial download, preserving shared
  runtimes, access keys and translated pages. Switching does not delete models.
- Runtime cards show version, installation and whether the selected models need
  them. Unused runtimes and receipt-identified old versions can be removed.
  Required/shared files, models, settings and translation results are preserved.
- API start/stop, download pause/resume/repair, component verification, logs,
  automatic API startup preference and CPU thread count are in the local UI.
- 'API를 중지하고 앱 종료' stops managed processes and exits the app.
- Closing only the browser tab leaves the local app and APIs running.
- Ports: management 8794, image API 8793, Gemma 8792; all bind to 127.0.0.1.
- Existing unrelated services using these ports are not terminated automatically.
- If the extension files are updated, reload the extension in chrome://extensions.
- Images and dialogue are processed locally. Internet access is used to download
  application dependencies/models and retrieve comic images in the browser.

CLI
  --root ABS_PATH    Explicitly override the portable root with an absolute path.
  --print-root       Print the resolved data directory without creating files.
  --no-open          Start without opening a browser (e.g. a user service).
  --no-auto-setup    Disable startup of installed APIs (downloads are always manual).
  --version         Print the control app version.
  --hardware-info   Print OS hardware information without launching the app.

Licenses
Dependency notices are in licenses/ and the original sources.
Koharu weights retain their custom/Manga109-related terms; Gemma retains Google's
Gemma terms; Hayai/LiteRT use Apache-2.0; ONNX Runtime and llama.cpp use MIT.
No Python process or Python build packager is required.
