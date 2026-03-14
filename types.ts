
// 참조 이미지 타입 (캐릭터/스타일 분리 + 강도 조절)
export interface ReferenceImages {
  character: string[];      // 캐릭터 참조 이미지 (최대 2장) - 캐릭터 외모/스타일 참조
  style: string[];          // 스타일 참조 이미지 (최대 2장) - 화풍/분위기 참조
  characterStrength: number; // 캐릭터 참조 강도 (0~100, 기본 70)
  styleStrength: number;     // 스타일 참조 강도 (0~100, 기본 70)
  characterDescription?: string; // Gemini Vision으로 자동 추출한 캐릭터 특징 텍스트 (일관성 강화)
}

// 기본 참조 이미지 설정
export const DEFAULT_REFERENCE_IMAGES: ReferenceImages = {
  character: [],
  style: [],
  characterStrength: 70,
  styleStrength: 70,
  characterDescription: ''
};

export interface SceneAnalysis {
  composition_type: 'MICRO' | 'STANDARD' | 'MACRO';
  composition_explanation: string; // 구도_설명
  camera: {
    view: string;    // 시점
    distance: string; // 거리
    angle: string;    // 각도
  };
  composition_setup: {
    main_element: string; // 주요_요소
    sub_element: string;  // 보조_요소
    character_positioning: string; // 캐릭터_포지셔닝 (위치, 크기%, 역할)
  };
  visual_metaphor: {
    concept: string;     // 핵심개념
    object: string;      // 메타포_오브젝트
    interaction: string; // 캐릭터_상호작용
  };
  metaphor_category: string; // 8대 카테고리
  color_plan: {
    anchor_colors: Record<string, string>; // 캐릭터 고정색
    background_colors: {
      primary: string;   // 주조색
      sub: string;       // 보조톤
      accent: string;    // 강조색
      metaphor: string;  // 메타포색
      bg: string;        // 배경색
    };
    emotion_match: string; // 감정매칭
  };
  detail_level: 'Minimal(1)' | 'Enhanced(2)' | 'Detailed(3)';
  emotional_amplification_technique: string; // 감정_증폭_기법
  differentiation_point: string; // 차별화포인트
  motion_type: '정적' | '동적';
  motion_detail: string; // 동작디테일
}

export interface ScriptScene {
  sceneNumber: number;
  narration: string;
  visualPrompt: string;
  analysis?: SceneAnalysis;
}

// ElevenLabs 타임스탬프 자막 데이터
export interface SubtitleWord {
  word: string;
  start: number;  // 시작 시간 (초)
  end: number;    // 끝 시간 (초)
}

// AI가 분리한 의미 단위 청크 (타이밍 매핑용)
export interface MeaningChunk {
  text: string;       // 청크 텍스트
  startTime: number;  // 시작 시간 (초)
  endTime: number;    // 끝 시간 (초)
}

export interface SubtitleData {
  words: SubtitleWord[];
  fullText: string;
  meaningChunks?: MeaningChunk[];  // AI가 분리한 의미 단위 청크 (타이밍 포함)
}

// 자막 설정 옵션
export interface SubtitleConfig {
  wordsPerLine: number;      // 한 줄당 단어 수 (기본: 5)
  maxLines: number;          // 최대 줄 수 (기본: 2)
  fontSize: number;          // 폰트 크기 (기본: 40)
  fontFamily: string;        // 폰트
  fontWeight: number;        // 굵기 (100~900)
  bottomMargin: number;      // 상하 여백
  backgroundColor: string;   // 배경색
  textColor: string;         // 텍스트 색상
  strokeColor: string;       // 테두리 색상
  strokeWidth: number;       // 테두리 굵기 (0 = 없음)
  position: 'top' | 'middle' | 'bottom';  // 자막 위치 (하위호환)
  yPercent?: number;  // 수직 위치 0(상단)~100(하단), position보다 우선
  maxCharsPerChunk?: number;  // 자막 청크당 최대 글자 수 (기본 15, 숏폼은 10 권장)
}

// 기본 자막 설정
export const DEFAULT_SUBTITLE_CONFIG: SubtitleConfig = {
  wordsPerLine: 5,
  maxLines: 1,
  fontSize: 40,
  fontFamily: '"Noto Sans KR", "Malgun Gothic", sans-serif',
  fontWeight: 700,
  bottomMargin: 80,
  backgroundColor: 'rgba(0, 0, 0, 0.75)',
  textColor: '#FFFFFF',
  strokeColor: '#000000',
  strokeWidth: 4,
  position: 'bottom',
  yPercent: 85,
  maxCharsPerChunk: 15
};

export interface GeneratedAsset extends ScriptScene {
  imageData: string | null;
  audioData: string | null;
  audioDuration: number | null;  // 실제 오디오 길이 (초) - SRT 싱크용
  subtitleData: SubtitleData | null;  // 자막 타임스탬프 데이터
  videoData: string | null;      // 애니메이션 영상 URL (앞 N개 씬만)
  videoDuration: number | null;  // 영상 길이 (초) - 보통 4~5초 고정
  status: 'pending' | 'generating' | 'completed' | 'error';
}

export enum GenerationStep {
  IDLE = 'IDLE',
  SCRIPTING = 'SCRIPTING',
  SCRIPT_READY = 'SCRIPT_READY',  // 대본 완성 → 사용자 확인 후 이미지 생성 대기
  ASSETS = 'ASSETS',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

// 비용 추적
export interface CostBreakdown {
  images: number;      // 이미지 생성 비용
  tts: number;         // TTS 비용
  videos: number;      // 영상 생성 비용
  total: number;       // 총 비용
  imageCount: number;  // 생성된 이미지 수
  ttsCharacters: number; // TTS 글자 수
  videoCount: number;  // 생성된 영상 수
}

// 프로젝트 설정 저장용 타입
export interface ProjectSettings {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;

  // 이미지 모델 설정
  imageModel: string;

  // TTS 설정
  elevenLabsVoiceId: string;
  elevenLabsModel: string;
}

// 생성된 콘텐츠 포함 저장 프로젝트
export interface SavedProject {
  id: string;
  name: string;
  createdAt: number;
  topic: string;  // 생성 키워드/주제

  // 설정
  settings: {
    imageModel: string;
    elevenLabsModel: string;
  };

  // 생성된 콘텐츠 (전체 에셋 저장)
  assets: GeneratedAsset[];

  // 썸네일 (첫 번째 이미지 축소)
  thumbnail: string | null;

  // 비용 정보 (선택적 - 이전 버전 호환)
  cost?: CostBreakdown;
}
