Manga Translator 0.3.7 — 포터블 관리 앱

실행 폴더: /home/edp1096/workspace/manga_translator/dist/manga-translator
실행: 위 폴더의 ./manga-control (또는 기존 Manga Translator 바로가기)
관리 화면: http://127.0.0.1:8794

설정·모델·런타임·키·작업·확장은 전부 이 실행 폴더 안에 저장합니다.
주 실행 파일의 실제 디렉터리를 기준으로 경로를 확정합니다.
작업 디렉터리나 ../config.json, 사용자 데이터 폴더는 탐색하지 않습니다.
--print-root로 경로를 확인할 수 있으며 별도 경로는 --root 절대경로로만 지정합니다.

구조
  manga-control   최상위 진입점
  config/         control.json, native_api.json
  models/         선택한 모델
  runtime/        ONNX Runtime / LiteRT / llama.cpp
  bin/            관리 앱이 실행하는 네이티브 이미지 API
  data/           개인 키, 작업, 다운로드, 로그
  extension/      크롬에 등록한 확장
  licenses/       라이선스 고지

소스: 프로젝트 최상위 control/, native/, extension/
배포 파일: 프로젝트 dist/의 운영체제별 ZIP
진행 기록: 프로젝트 archive/

선택지
- 탐지: Koharu 768 / 원본 Koharu 2XL 1152 (전체 마스크)
- OCR: Hayai ONNX FP32+KV / LiteRT Dynamic INT8 두 가지만 제공
- 번역: Gemma E2B / E4B
INT4는 제외했습니다. 모델은 다운로드 버튼을 눌러야 설치합니다.
1152는 고메모리 환경용이며 비전 시작 전 여유 메모리 8 GiB가 필요합니다.
현재 Orange Pi의 선택은 기존 Koharu 768 / Hayai INT8 / Gemma E2B입니다.

관리 앱이 이미지 API 8793과 번역 API 8792를 자식 프로세스로 관리합니다.
서비스와 바로가기도 같은 포터블 실행 파일을 가리킵니다.
사용자가 종료한 상태는 검증 후 그대로 유지합니다.

Windows ZIP도 같은 폴더 구조입니다. 필요한 VC DLL은 공식 패키지에서
폴더 내부로 추출하며 시스템 설치나 UAC를 요구하지 않습니다.
실제 Windows 장치 추론은 아직 검증하지 않았습니다.

빌드 소스는 0.3.7로 정리했습니다. 프로젝트 최상위에서 ./build.sh
명령 하나로 빌드합니다. Windows에서는 ./build.ps1을 사용합니다. Python 서버/컨테이너/빌드 스크립트는
제거했습니다. 이후 출처 점검에서 초기 서버 때문에 붙였던 앱 전체 GPL 표기를 제거했습니다.

선택 사항인 systemd 예시는 deployment/orangepi/services/에 있습니다.
직접 manga-control을 실행할 때는 필요하지 않습니다.

0.3.5 배포본은 llama.cpp 0.7.0 / ONNX Runtime 1.31.0 / LiteRT 2.3.1을 고정합니다.
런타임 버전·경로는 control/internal/assets/bundle/catalog.json에서 관리합니다.
