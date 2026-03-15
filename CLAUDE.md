# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

**TubeGen AI V9.2** - AI 기반 스토리보드 & 영상 자동 생성 앱

주요 기능:
- 키워드/대본 입력 → AI가 자동으로 스토리보드 생성
- 씬별 이미지 생성 (Gemini 2.5 Flash Image / Flux.1 Schnell)
- TTS 음성 생성 (ElevenLabs + 타임스탬프 자막)
- 이미지→영상 애니메이션 변환 (fal.ai PixVerse v5.5)
- MP4 렌더링 및 내보내기

## 개발 명령어

```bash
# 의존성 설치
npm install

# 개발 서버 실행 (포트 3000)
npm run dev

# 프로덕션 빌드
npm run build

# 빌드된 앱 미리보기
npm run preview
```

## 환경 변수 설정

`.env.local` 파일에 API 키 설정:
```
GEMINI_API_KEY=your_gemini_api_key
FAL_API_KEY=your_fal_api_key           # Flux 이미지 + PixVerse 영상용
ELEVENLABS_API_KEY=your_elevenlabs_key  # TTS용
ELEVENLABS_VOICE_ID=your_voice_id       # 선택적
```

앱 내 설정 패널에서도 API 키 입력 가능 (localStorage에 저장)

## 기술 스택

- **프레임워크**: React 19 + TypeScript
- **빌드 도구**: Vite 6
- **AI 서비스**:
  - Google Gemini API (`@google/genai`) - 스크립트 생성, 이미지 생성, TTS
  - fal.ai - Flux.1 이미지 생성, PixVerse 영상 변환
  - ElevenLabs - 고품질 TTS + 타임스탬프 자막

## 아키텍처

### 데이터 흐름
```
사용자 입력 (키워드/대본)
    ↓
[geminiService] 트렌드 검색 → 스크립트 생성 (씬 분할)
                └── 긴 대본(3000자+) → generateScriptChunked()로 청크 분할 처리
    ↓
[imageService] 씬별 이미지 생성 (Gemini or Flux 라우팅)
    ↓
[elevenLabsService] 나레이션 TTS + 자막 타임스탬프
    ↓
[falService] 이미지→영상 애니메이션 변환 (수동 버튼 방식)
    ↓
[videoService] MP4 렌더링 및 내보내기 (자막 하드코딩 옵션)
```

### 핵심 서비스 (`services/`)

| 파일 | 역할 |
|------|------|
| `geminiService.ts` | Gemini API 통합 (트렌드 검색, 스크립트 생성, 이미지 생성, TTS 폴백, 자막 분리) |
| `imageService.ts` | 이미지 생성 라우터 - 선택된 모델(Gemini/Flux)로 라우팅, 캐릭터 참조 처리 |
| `prompts.ts` | V10.0 프롬프트 엔진 - 의미 기반 시각화, 색상 시스템, 타이포그래피 규칙, 캐릭터 등장 판단 |
| `elevenLabsService.ts` | ElevenLabs TTS + 타임스탬프 자막 생성, AI 의미 단위 분리 |
| `falService.ts` | fal.ai 통합 (Flux.1 Schnell 이미지, PixVerse v5.5 영상) |
| `videoService.ts` | MP4 렌더링 (자막 하드코딩 포함) |
| `projectService.ts` | 프로젝트 저장/불러오기 (localStorage) |
| `srtService.ts` | SRT 자막 파일 생성 |

### 주요 타입 (`types.ts`)

- `ScriptScene` - 씬 데이터 (나레이션, visualPrompt, analysis)
- `GeneratedAsset` - 생성된 에셋 (이미지, 오디오, 자막, 영상, status 포함)
- `ReferenceImages` - 참조 이미지 (캐릭터/스타일 분리, 강도 조절 0~100)
- `SubtitleData` - 자막 타임스탬프 데이터 (단어별 + 의미 단위 청크)
- `CostBreakdown` - 비용 추적 (이미지, TTS, 영상별 비용 및 개수)

### 설정 (`config.ts`)

- `IMAGE_MODELS` - 이미지 생성 모델 목록 및 가격
- `FLUX_STYLE_CATEGORIES` / `GEMINI_STYLE_CATEGORIES` - 화풍 프리셋
- `ELEVENLABS_MODELS` - TTS 모델 목록
- `PRICING` - API 가격 정보 (USD→KRW 변환)
- `CONFIG.STORAGE_KEYS` - localStorage 키 이름
- `CONFIG.ANIMATION` - 애니메이션 설정 (ENABLED_SCENES, VIDEO_DURATION)

## 프롬프트 시스템 (`prompts.ts`)

V10.0 "문장→이미지 자동 생성 시스템" 핵심 원칙:

1. **의미 기반 시각화** - 문장의 의미를 이해하고 그대로 시각화
   - "컴퓨터" → 컴퓨터를 그려라
   - "발전된 자동차" → 미래적인 자동차를 그려라

2. **수식어 반영** - 형용사/부사를 시각에 반영
   - "거대한" → 크게, "빛나는" → 광택/발광

3. **캐릭터 등장 규칙**:
   - NO_CHAR: 주어가 수치/데이터/추상 시스템 ("GDP가 상승", "시장이 과열")
   - STANDARD/MICRO/MACRO: 주어가 사람 ("투자자가 고민", "소비자가 결정")

4. **구도 시스템**:
   - MICRO (5-15%): 작은 졸라맨 + 큰 사물
   - STANDARD (30-40%): 졸라맨과 사물 상호작용
   - MACRO (60-80%): 졸라맨 클로즈업
   - NO_CHAR: 캐릭터 없음 (사물/텍스트만)

5. **한국 금융 색상** - 상승=빨강, 하락=파랑 (미국과 반대)

6. **고유명사 표시** - 대본에 쓰인 언어 그대로 표시 (삼성→삼성, NVIDIA→NVIDIA)

## App.tsx 핵심 패턴

### 비용 추적 시스템
```typescript
// costRef로 실시간 비용 누적
const costRef = useRef<CostBreakdown>({...});
const addCost = (type: 'image' | 'tts' | 'video', amount: number, count: number) => {...};
```

### 병렬 처리
```typescript
// 이미지와 오디오 병렬 생성
await Promise.all([runAudio(), runImages()]);
```

### 재시도 로직
- 이미지/TTS 생성 실패 시 최대 2회 재시도
- Rate Limit 에러 시 대기 후 재시도
- 모든 재시도 실패 시 폴백 (ElevenLabs → Gemini TTS)

### 참조 이미지 처리
- `hasCharacterRef`가 true면 고정 캐릭터 프롬프트(`VAR_BASE_CHAR`) 제외
- 참조 이미지의 캐릭터를 따르도록 프롬프트 조정

## 컴포넌트 구조

- `App.tsx` - 메인 앱 로직 (생성 플로우, 상태 관리, 비용 추적)
- `components/InputSection.tsx` - 입력 폼 (키워드, 대본, 참조 이미지, 설정)
- `components/ResultTable.tsx` - 생성 결과 테이블 (이미지 재생성, 애니메이션 버튼)
- `components/ProjectGallery.tsx` - 저장된 프로젝트 갤러리
- `components/Header.tsx` - 헤더

## 주의사항

- 참조 이미지가 있으면 고정 캐릭터 프롬프트(`VAR_BASE_CHAR`) 제외
- Flux.1은 참조 이미지 미지원 → 스타일 프롬프트로 대체
- ElevenLabs 타임스탬프는 `with-timestamps` 엔드포인트 사용
- 영상 변환은 수동 버튼 클릭 방식 (자동 변환 비활성화)
- 비용 추적은 실시간으로 `costRef`에 누적
- 긴 대본(3000자 초과)은 `generateScriptChunked()`로 청크 분할 처리
- TTS Rate Limit 대응: 씬 간 1.5초 딜레이, 실패 시 3초 대기 후 재시도
