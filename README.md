# Manga Translator

Go + Svelte 관리 앱과 크롬 확장으로 사용하는 로컬 만화 번역기입니다. 처음 실행하면 관리 화면만 열립니다. 탐지·OCR·번역 모델을 선택하고 다운로드 버튼을 눌러야 필요한 런타임과 모델을 설치합니다. 설치 후 API를 시작할 수 있으며, 자동 실행은 이미 설치된 모델에만 적용됩니다. 사용자 PC에 Python이나 Node.js를 설치할 필요가 없습니다.

- **관리 화면:** `http://127.0.0.1:8794`
- **이미지 API:** `http://127.0.0.1:8793`
- **번역 모델:** `http://127.0.0.1:8792/v1`
- **구성:** Koharu 768 전체 마스크 → Hayai 또는 Baberu OCR → Gemma 4 E2B/E4B Q4_0

## 포터블 실행과 저장 경로

`dist/`의 운영체제별 ZIP을 폴더에 풀고 최상위의 **manga-control**(Linux ARM64/x64) 또는 **MangaTranslator.exe**(Windows x64)를 실행합니다. 설정·모델·런타임·작업 데이터는 **압축을 푼 그 폴더 안에만** 저장됩니다.

```text
manga-translator/
├── manga-control          # Windows: MangaTranslator.exe
├── config/                # control.json, native_api.json
├── models/                # 선택해서 다운로드한 모델
├── runtime/               # ONNX Runtime, LiteRT, llama.cpp
├── bin/                   # 관리 앱이 실행하는 이미지 API
├── data/                  # 키, 작업, 다운로드, 로그
├── extension/             # 크롬 확장
└── licenses/
```

기본 경로는 주 실행 파일의 실제 위치를 기준으로 정합니다. 작업 디렉터리나 상위 폴더를 탐색하지 않고, 사용자 프로필 아래에 별도 저장소도 만들지 않습니다. `--print-root`로 실제 포터블 경로를 확인할 수 있고, 사용자 요청으로 다른 경로를 쓸 때만 `--root /절대/경로`를 지정합니다.

소스는 `control/`, `native/`, `extension/`에 있고, 배포물은 `dist/`에 둡니다. 이전 Python 서버와 Docker 구성은 제거했습니다. 현재 앱의 빌드와 실행에는 Python이 필요 없습니다.

프로젝트 최상위(`manga_translator/`)에서 한 번에 빌드합니다.

```sh
make dist
# 또는 ./build.sh
# Windows PowerShell: ./build.ps1
```

Go 1.26.5 이상과 Node.js 24가 필요합니다. 의존성 설치, Svelte 빌드, Go 검사, Linux ARM64·Linux x64·Windows x64 ZIP·소스 압축본·SHA256 목록 생성까지 수행하며 결과는 `dist/`에 저장합니다. 기본 빌드는 동봉된 C++ 엔진을 사용합니다. C++ 엔진까지 수정한 경우의 빌드는 [개발 안내](control/DEVELOPMENT.txt)를 참고하세요.

설치 관리에서 탐지는 **Koharu 768 / 원본 1152**, OCR은 **Baberu INT4·FP16 / Hayai LiteRT INT8·ONNX FP32+KV**, 번역은 **Gemma E2B / E4B**를 선택할 수 있습니다. Baberu는 인코더 INT4 또는 FP16과 공통 INT8 디코더를 사용하며, 공식 Apache-2.0 라이선스와 학습 데이터 고지를 함께 제공합니다. 모델 선택만으로 다운로드하지 않고, 다운로드 버튼을 눌러 필요한 파일만 받습니다.

[0.3.3 포터블 검증](archive/control-0.3.3/RESULTS.txt)과 [0.3.4 정리·빌드 기록](archive/control-0.3.4/RESULTS.txt)을 참고하세요.

## 플랫폼과 검증

Linux ARM64에서 빈 폴더 최초 다운로드, 1.7GB 지점 중단·이어받기, 모델 검증, 자동 API 시작, 실제 페이지 번역, 중지·재시작·종료를 검증했습니다. Orange Pi의 기존 모델/키를 재사용하도록 배포했고, 기존 94장의 번역 결과와 확장 설정을 보존했습니다.

Windows x64용 Go 실행 파일과 C++ 이미지 API를 빌드하고 34개 실행 파일/DLL의 의존성을 확인했습니다. **실제 Windows 기기에서의 추론 실행은 아직 검증하지 않았습니다.** 필요한 Visual C++ DLL은 공식 패키지에서 포터블 폴더로 추출합니다. 설치 파일 실행이나 관리자 권한은 요구하지 않습니다.

## 소스

| 경로 | 역할 |
|---|---|
| `control/` | Go 관리 서버, Svelte UI, 다운로드 카탈로그, 배포 도구 |
| `native/` | Linux/Windows 공용 C++ 이미지 API |
| `extension/` | Chrome 확장 |
| `deployment/orangepi/` | 배포 설정, 검증 기록 |
| `tests/` | 확장 및 기존 서버 회귀 검사 |
| `docs/` | 현재 모델 변환·출처 문서 |
| `archive/` | 이전 실험·배포 검증 기록 |

빌드 및 자세한 사용법은 [관리 앱 안내](control/README.txt)와 [개발 안내](control/DEVELOPMENT.txt)를 참고하세요. 모델·외부 라이브러리의 라이선스는 각각 유지합니다. 개별 고지는 `control/internal/assets/bundle/licenses/`에 있습니다. `data/`에는 개인 키와 번역 작업이 있으므로 배포하지 마세요.

`deployment/orangepi/services/`는 선택 사항인 Linux 자동 시작용 systemd 설정 예시입니다. 포터블 앱을 직접 실행할 때는 필요하지 않으며 배포 ZIP에도 포함하지 않습니다.

소스와 빌드 스크립트는 프로젝트 최상위에 있습니다. `make dist`의 출력은 최상위 `dist/`입니다.

런타임은 llama.cpp **0.7.0**, ONNX Runtime **1.31.0**, LiteRT **2.3.1**로 고정했습니다. [런타임 업그레이드 절차](control/RUNTIME_UPDATES.txt)와 [0.3.5 검증](archive/control-0.3.5/RESULTS.txt)을 참고하세요.


## 0.3.8 실행 구성

작업 원본과 빌드는 OP5P `192.168.100.25:/home/edp1096/workspace/manga_translator`에 둡니다. DGX Spark는 CUDA/Vulkan 검증에만 사용합니다.

CPU 저메모리, CPU/GPU 병행, GPU E2B, GPU E4B 프리셋을 제공합니다. 모델·단계별 실행 장치를 개별 조정할 수 있고, 선택한 구성의 모델과 런타임만 명시적으로 다운로드합니다. Hayai INT8은 CPU 전용으로 유지하며 GPU OCR 구성에서는 선택을 비활성화합니다. ONNX FP32는 CPU, Linux NVIDIA CUDA, Windows DirectML 경로를 지원합니다. Gemma E2B와 E4B 모두 CPU/Vulkan을 선택할 수 있습니다.

미사용 런타임 및 이전 버전의 삭제 화면을 추가했습니다. 현재 선택한 구성에 필요한 런타임과 다른 런타임이 공유하는 파일은 보호합니다. 크롬 패널은 탭마다 직접 열고 닫은 상태를 보존합니다. 다른 탭으로 이동해도 열린 상태를 버리지 않으며, 열지 않은 탭에 패널이 따라오지 않습니다.

OP5P의 실제 CPU 페이지 번역, GB10의 ONNX CUDA 페이지 번역과 llama.cpp Vulkan 레이어 배치를 확인했습니다. Windows와 Linux x64는 빌드·배포 파일 설치 검증이며 해당 하드웨어에서의 추론 검증은 별도입니다. 상세 결과는 `docs/control-0.3.8/`에 있습니다.

## 0.3.10 Baberu와 편집·저장

Baberu 두 모델을 OCR 선택지에 추가했습니다. CPU에서는 전체 CPU, CUDA에서는 인코더 GPU·디코더 CPU로 자동 실행합니다. DirectML 경로는 제공하지 않으며 Windows에서는 OCR을 CPU로 선택할 수 있습니다. 공유 디코더·토크나이저는 다른 Baberu 모델이 사용하는 동안 삭제하지 않습니다. 기존 모델 선택과 파일은 유지됩니다.

모델 선택은 각 단계에서 용량이 작은 순서로 표시합니다. 편집기에서 글상자를 추가·삭제할 수 있고, 확장의 **선택 저장**은 체크한 이미지를 목록 순서대로 하나의 ZIP에 담습니다. 성공 이미지는 최근 적용한 편집을 포함하고, 실패·대사 없음·미번역 이미지는 원본을 저장합니다. 원본도 가져올 수 없으면 해당 번호의 오류 파일을 포함합니다.

실측 비교와 CPU/GPU 연산 배치는 `docs/baberu-evaluation/RESULTS.txt`에 있습니다. Hayai FP32는 전체 GPU가 가장 빨랐고, Baberu는 CUDA 인코더 + CPU 디코더 조합이 가장 빨랐습니다. 제품 실행에는 Python이 필요 없습니다.

## 0.3.11 뷰어 지원

카도코미(가로·세로), 토나리노 영점프, 망가즈 뷰어에서 광고를 제외한 본문을 탐지합니다. 새로고침으로 페이지를 불러온 뒤 원래 읽던 위치로 돌아오며, 페이지 넘김·모드 전환 후에도 번역과 선택 상태를 보존합니다. 망가즈의 페이지별 주소 변경도 같은 책 안에서 구분해 처리합니다.

토나리노 영점프처럼 직접 읽을 수 없는 캔버스는 크롬의 활성 탭 화면 캡처를 이용합니다. 이때 만화 탭을 활성 상태로 유지해야 합니다. 페이지가 화면보다 크면 원래 크기에 맞춰 나눠 읽습니다. 웹사이트가 현재 제공하는 페이지와 뷰어의 이동 기능만 사용합니다.

실행 설정은 제목 위·선택 상자 아래의 두 줄 배치로 변경했습니다. 검증 기록은 `docs/control-0.3.11/`에 있습니다.
