
/**
 * Heaven AI 전역 설정 파일
 * 보안을 위해 민감한 API 키는 이곳에 직접 입력하지 마세요.
 * 앱 내의 [설정] 메뉴를 통해 입력하면 브라우저에 안전하게 보관됩니다.
 */

// 이미지 생성 모델 목록
export const IMAGE_MODELS = [
  {
    id: 'gemini-3-pro-image-preview',
    name: 'Nano Banana Pro 🍌👑 NEW',
    provider: 'Google',
    pricePerImage: 0.06,
    description: '최고급 Nano Banana Pro — 최고품질, 1K 해상도, 유료 API키 필요',
    speed: '보통'
  },
  {
    id: 'gemini-3.1-flash-image-preview',
    name: 'Nano Banana 2 🍌 NEW',
    provider: 'Google',
    pricePerImage: 0.0315,
    description: '최신 Nano Banana 2 — 한글 텍스트 깨끗, Flash 속도, 유료 API키 필요',
    speed: '빠름'
  },
  {
    id: 'imagen-4.0-fast-generate-001',
    name: 'Imagen 4 Fast ⚡',
    provider: 'Google',
    pricePerImage: 0.02,
    description: '최신·빠름·저렴 — 유료 API키 필요',
    speed: '빠름'
  },
  {
    id: 'imagen-4.0-generate-001',
    name: 'Imagen 4 Standard 🔥',
    provider: 'Google',
    pricePerImage: 0.04,
    description: '최신 고품질, 색감/디테일 향상 — 유료 API키 필요',
    speed: '보통'
  },
  {
    id: 'imagen-4.0-ultra-generate-001',
    name: 'Imagen 4 Ultra ✨',
    provider: 'Google',
    pricePerImage: 0.06,
    description: '최고품질 2K해상도 — 유료 API키 필요',
    speed: '느림'
  },
  {
    id: 'imagen-3.0-fast-generate-001',
    name: 'Imagen 3 Fast',
    provider: 'Google',
    pricePerImage: 0.02,
    description: '텍스트 규칙 정확, 고품질, 저렴',
    speed: '빠름'
  },
  {
    id: 'imagen-3.0-generate-002',
    name: 'Imagen 3 Standard',
    provider: 'Google',
    pricePerImage: 0.04,
    description: '텍스트 렌더링 최우수',
    speed: '보통'
  },
  {
    id: 'gemini-2.5-flash-image',
    name: 'Gemini 2.5 Flash',
    provider: 'Google',
    pricePerImage: 0.0315,
    description: '참조이미지 지원, 화풍 일관성',
    speed: '보통'
  },
  {
    id: 'veo-3.1-generate-preview',
    name: 'Veo 3.1 Fast 영상',
    provider: 'Google',
    pricePerImage: 0,
    description: '실사 동영상 생성 (구독 20크레딧/영상, 2~5분 소요)',
    speed: '느림'
  },
  {
    id: 'veo-2.0-generate-001',
    name: 'Veo 2 영상',
    provider: 'Google',
    pricePerImage: 0,
    description: '실사 동영상 생성 (구독 5크레딧/영상, 2~5분 소요)',
    speed: '느림'
  },
] as const;

export type ImageModelId = typeof IMAGE_MODELS[number]['id'];

// Gemini 전용 스타일 카테고리 (3가지 핵심 화풍)
export const GEMINI_STYLE_CATEGORIES = [
  {
    id: 'main',
    name: '메인 화풍',
    styles: [
      {
        id: 'gemini-crayon',
        name: '크레용 (기본)',
        prompt: 'Hand-drawn crayon and colored pencil illustration style, waxy texture with rough organic strokes, warm nostalgic colors, childlike charm with innocent atmosphere, visible pencil texture on outlines and fills, soft analog warmth, 2D flat composition'
      },
      {
        id: 'gemini-korea-cartoon',
        name: '한국 경제 카툰',
        prompt: 'Korean economic cartoon style, digital illustration with clean bold black outlines, cel-shaded flat coloring, simple rounded stick figure character (white circle head, dot eyes), strong color contrasts with golden warm highlights vs cool gray tones, Korean text integration, modern webtoon infographic aesthetic, professional news graphic feel, dramatic lighting with sparkles and glow effects, 16:9 cinematic composition'
      },
      {
        id: 'gemini-watercolor',
        name: '수채화',
        prompt: 'Soft watercolor illustration style, gentle hand-drawn aesthetic, warm color palette by default, simple stick figure with white circle head and thin black line body, organic brush strokes with paint bleeding effects, soft diffused edges, analog texture. Use cool tones only when danger or twist elements appear. Focus on visualizing the exact meaning and context of the sentence.'
      },
      {
        id: 'gemini-webtoon',
        name: '웹툰',
        prompt: 'Korean webtoon style, clean digital line art with bold outlines, vibrant cel-shaded coloring, expressive characters with large eyes and dynamic poses, modern Korean manhwa aesthetic, strong contrast between light and shadow, speech bubble friendly composition, flat background with detailed foreground characters, 16:9 panel layout'
      },
      {
        id: 'gemini-realistic',
        name: '실사화',
        prompt: 'Photorealistic style, high-definition photography aesthetic, natural lighting with realistic shadows, detailed textures and materials, cinematic depth of field, professional DSLR camera look, true-to-life colors and proportions, 8K resolution quality, hyperrealistic rendering'
      },
    ]
  }
] as const;

export type GeminiStyleId = typeof GEMINI_STYLE_CATEGORIES[number]['styles'][number]['id'] | 'gemini-custom' | 'gemini-none';

// ─── 비주얼 스타일 (이미지 생성기 빠른 선택) ─────────────────────────────────
export const VISUAL_STYLES = [
  { id: 'custom',       name: '커스텀',         emoji: '✏️', bg: 'from-slate-700 to-slate-800',   prompt: '' },
  { id: 'cinematic',    name: '시네마틱 실사',  emoji: '🎬', bg: 'from-slate-700 to-slate-900',   prompt: 'Cinematic photorealistic style, Hollywood blockbuster film aesthetic, professional cinematography, dramatic volumetric lighting, shallow depth of field, 8K ultra-detailed, rich cinematic color grading' },
  { id: 'kdrama',       name: 'K-드라마 실사',  emoji: '🌸', bg: 'from-pink-800 to-rose-900',     prompt: 'Korean drama photorealistic style, soft romantic lighting, clean modern Korean aesthetics, beautiful actors with natural makeup, elegant drama set design, warm golden hour lighting, Netflix Korean drama quality' },
  { id: 'noir',         name: '누아르',         emoji: '🌑', bg: 'from-gray-800 to-black',         prompt: 'Film noir style, dramatic black and white with deep moody shadows, 1940s detective noir aesthetic, high contrast chiaroscuro lighting, rain-soaked atmospheric streets, expressionist shadows and silhouettes' },
  { id: 'webtoon',      name: '웹툰',           emoji: '📱', bg: 'from-blue-800 to-indigo-900',   prompt: 'Korean webtoon digital illustration style, clean bold black outlines, vibrant cel-shaded flat coloring, expressive characters, modern manhwa aesthetic, bright high contrast composition' },
  { id: 'comic-webtoon',name: '만화웹툰',       emoji: '💥', bg: 'from-orange-800 to-red-900',    prompt: 'Comic manga webtoon style, bold dynamic thick outlines, exaggerated expressive faces, speed action lines, vibrant saturated colors, halftone texture, manga-influenced Korean comic panel composition' },
  { id: '3d-animation', name: '3D 애니메이션',  emoji: '✨', bg: 'from-cyan-800 to-blue-900',     prompt: 'Pixar Disney quality 3D CGI animation style, smooth subsurface scattering render, expressive stylized 3D characters, vibrant rich colors, cinematic 3D studio lighting, Pixar movie aesthetic' },
  { id: 'claymation',   name: '클레이 애니',    emoji: '🧸', bg: 'from-amber-700 to-yellow-900',  prompt: 'Claymation stop-motion style, textured plasticine clay figures, handcrafted Aardman aesthetic, visible clay finger texture, warm cozy tones, tactile handmade quality, Shaun the Sheep style' },
  { id: 'fairy-tale',   name: '동화 일러스트',  emoji: '🧚', bg: 'from-purple-800 to-pink-900',   prompt: "Whimsical fairy tale children's picture book illustration, soft watercolor gouache technique, pastel dreamy color palette, gentle rounded organic shapes, magical glowing atmosphere, storybook quality" },
  { id: 'wool-doll',    name: '동화 양모인형',  emoji: '🪆', bg: 'from-rose-700 to-fuchsia-900',  prompt: 'Wool felt doll fairy tale style, handmade textile art aesthetic, needle felt puppet with visible soft fiber texture, cozy warm tones, artisan handcraft quality, miniature woolly characters' },
  { id: 'diorama',      name: '디오라마',       emoji: '🏠', bg: 'from-green-800 to-teal-900',    prompt: 'Miniature diorama tabletop style, tiny handcrafted scale model world, tilt-shift photography blur effect, warm studio lighting on miniatures, detailed scale buildings and props, toy-like railway model aesthetic' },
  { id: 'historical',   name: '사극 일러스트',  emoji: '⚔️', bg: 'from-amber-900 to-stone-900',  prompt: 'Korean historical drama illustration style, Joseon dynasty period aesthetic, traditional Korean Hanbok costumes and architecture, classical East Asian ink painting influence, elegant brushwork, rich jewel tones with gold accents' },
  { id: 'webnovel',     name: '웹소설 시그니쳐',emoji: '📖', bg: 'from-violet-800 to-purple-900', prompt: 'Korean web novel signature cover illustration style, dramatic fantasy character portrait, flowing hair and clothing in dynamic wind, intense gaze, glowing magical light effects, rich saturated fantasy colors' },
  { id: 'ghibli',       name: '지브리풍',       emoji: '🌿', bg: 'from-emerald-700 to-green-900', prompt: 'Studio Ghibli inspired animation style, hand-drawn watercolor painterly backgrounds with lush organic detail, warm nostalgic atmosphere, Hayao Miyazaki aesthetic, expressive simple characters, magical realism, soft natural color palette' },
  { id: 'stickman',     name: '스틱맨',         emoji: '🖊️', bg: 'from-slate-600 to-slate-800',  prompt: 'Simple stick figure illustration style, clean minimalist black line drawings on white background, xkcd-style stick figure characters, simple geometric shapes, hand-drawn marker whiteboard animation aesthetic' },
] as const;

export type VisualStyleId = typeof VISUAL_STYLES[number]['id'] | 'none';

// 가격 정보 (USD)
export const PRICING = {
  // 환율 (USD → KRW)
  USD_TO_KRW: 1450,

  IMAGE: {
    'gemini-3-pro-image-preview': 0.06,
    'gemini-3.1-flash-image-preview': 0.0315,
    'imagen-4.0-fast-generate-001': 0.02,
    'imagen-4.0-generate-001': 0.04,
    'imagen-4.0-ultra-generate-001': 0.06,
    'imagen-3.0-fast-generate-001': 0.02,
    'imagen-3.0-generate-002': 0.04,
    'gemini-2.5-flash-image': 0.0315,
  },
  // TTS (ElevenLabs) - 글자당 가격
  TTS: {
    perCharacter: 0.00003,  // 약 $0.03/1000자 (추정)
  },
  // 영상 생성 (PixVerse)
  VIDEO: {
    perVideo: 0.15,  // $0.15/video (5초)
  }
} as const;

// USD를 KRW로 변환
export function toKRW(usd: number): number {
  return Math.round(usd * PRICING.USD_TO_KRW);
}

// KRW 포맷 (예: 1,234원)
export function formatKRW(usd: number): string {
  const krw = toKRW(usd);
  return krw.toLocaleString('ko-KR') + '원';
}

// ElevenLabs 자막(타임스탬프) 지원 모델 목록
export const ELEVENLABS_MODELS = [
  { id: 'eleven_multilingual_v2', name: 'Multilingual v2', description: '다국어 29개, 고품질 (기본값)', supportsTimestamp: true },
  { id: 'eleven_v3', name: 'Eleven v3', description: '최신 모델, 70개 언어, 고표현력', supportsTimestamp: true },
  { id: 'eleven_turbo_v2_5', name: 'Turbo v2.5', description: '빠른 속도, 32개 언어', supportsTimestamp: true },
  { id: 'eleven_flash_v2_5', name: 'Flash v2.5', description: '초고속 ~75ms, 32개 언어', supportsTimestamp: true },
  { id: 'eleven_turbo_v2', name: 'Turbo v2', description: '빠른 속도, 영어 최적화', supportsTimestamp: true },
  { id: 'eleven_monolingual_v1', name: 'Monolingual v1', description: '영어 전용 (레거시)', supportsTimestamp: false },
] as const;

export type ElevenLabsModelId = typeof ELEVENLABS_MODELS[number]['id'];

// ElevenLabs 안정적인 음성 목록 (긴 텍스트에도 에러 없음)
// 미리듣기는 API Key를 사용해 "테스트 목소리입니다" 문구로 생성됨
export const ELEVENLABS_DEFAULT_VOICES = [
  // 여성 음성 (Female) - 안정성 검증된 음성만
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', gender: 'female' as const, accent: 'American', description: '⭐ 가장 안정적, 나레이션 최적화, 긴 텍스트 OK' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', gender: 'female' as const, accent: 'American', description: '부드럽고 친근함, 대화형 콘텐츠에 적합' },
  { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', gender: 'female' as const, accent: 'British', description: '세련된 영국식, 고급스러운 나레이션' },
  { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', gender: 'female' as const, accent: 'American', description: '젊고 활기찬 여성, 유튜브 콘텐츠에 적합' },
  // 남성 음성 (Male) - 안정성 검증된 음성만
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', gender: 'male' as const, accent: 'American', description: '⭐ 가장 안정적, 뉴스/다큐 스타일, 긴 텍스트 OK' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', gender: 'male' as const, accent: 'American', description: '젊고 역동적, 유튜브/엔터테인먼트에 적합' },
  { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', gender: 'male' as const, accent: 'American', description: '차분하고 신뢰감, 교육/설명 콘텐츠에 적합' },
] as const;

// 기본 음성 타입 정의
export type ElevenLabsDefaultVoice = typeof ELEVENLABS_DEFAULT_VOICES[number];
export type VoiceGender = 'male' | 'female';

// Google Gemini TTS 음성 목록
export const GEMINI_TTS_VOICES = [
  // 남성 (Male)
  { id: 'Charon',         name: 'Charon',         gender: 'male'   as const, description: '안정적, 깊고 차분한 남성 (기본값)' },
  { id: 'Fenrir',         name: 'Fenrir',         gender: 'male'   as const, description: '강렬하고 자신감 넘치는 남성' },
  { id: 'Orus',           name: 'Orus',           gender: 'male'   as const, description: '부드럽고 친근한 남성' },
  { id: 'Puck',           name: 'Puck',           gender: 'male'   as const, description: '활기차고 경쾌한 남성' },
  { id: 'Oberon',         name: 'Oberon',         gender: 'male'   as const, description: '권위있고 명확한 남성' },
  { id: 'Iapetus',        name: 'Iapetus',        gender: 'male'   as const, description: '차분하고 신뢰감 있는 남성' },
  { id: 'Gacrux',         name: 'Gacrux',         gender: 'male'   as const, description: '따뜻하고 풍부한 남성' },
  { id: 'Umbriel',        name: 'Umbriel',        gender: 'male'   as const, description: '깊고 성숙한 남성' },
  { id: 'Achernar',       name: 'Achernar',       gender: 'male'   as const, description: '밝고 에너지 넘치는 남성' },
  { id: 'Achird',         name: 'Achird',         gender: 'male'   as const, description: '편안하고 친근한 남성' },
  { id: 'Algenib',        name: 'Algenib',        gender: 'male'   as const, description: '명쾌하고 또렷한 남성' },
  { id: 'Algieba',        name: 'Algieba',        gender: 'male'   as const, description: '부드럽고 세련된 남성' },
  { id: 'Alnilam',        name: 'Alnilam',        gender: 'male'   as const, description: '단호하고 명확한 남성' },
  { id: 'Rasalgethi',     name: 'Rasalgethi',     gender: 'male'   as const, description: '풍부하고 표현력 있는 남성' },
  { id: 'Sadatoni',       name: 'Sadatoni',       gender: 'male'   as const, description: '차분하고 사려깊은 남성' },
  { id: 'Zubenelgenubi',  name: 'Zubenelgenubi',  gender: 'male'   as const, description: '깊고 인상적인 남성' },
  { id: 'Enceladus',      name: 'Enceladus',      gender: 'male'   as const, description: '젊고 역동적인 남성' },
  // 여성 (Female)
  { id: 'Kore',           name: 'Kore',           gender: 'female' as const, description: '부드럽고 따뜻한 여성' },
  { id: 'Aoede',          name: 'Aoede',          gender: 'female' as const, description: '맑고 청명한 여성' },
  { id: 'Leda',           name: 'Leda',           gender: 'female' as const, description: '우아하고 세련된 여성' },
  { id: 'Zephyr',         name: 'Zephyr',         gender: 'female' as const, description: '상쾌하고 경쾌한 여성' },
  { id: 'Autonoe',        name: 'Autonoe',        gender: 'female' as const, description: '자연스럽고 편안한 여성' },
  { id: 'Callirrhoe',     name: 'Callirrhoe',     gender: 'female' as const, description: '흐르는 듯 매끄러운 여성' },
  { id: 'Despina',        name: 'Despina',        gender: 'female' as const, description: '밝고 친근한 여성' },
  { id: 'Erinome',        name: 'Erinome',        gender: 'female' as const, description: '차분하고 신뢰감 있는 여성' },
  { id: 'Laomedeia',      name: 'Laomedeia',      gender: 'female' as const, description: '풍부하고 표현력 있는 여성' },
  { id: 'Schedar',        name: 'Schedar',        gender: 'female' as const, description: '또렷하고 명확한 여성' },
  { id: 'Sulafat',        name: 'Sulafat',        gender: 'female' as const, description: '따뜻하고 감성적인 여성' },
  { id: 'Vindemiatrix',   name: 'Vindemiatrix',   gender: 'female' as const, description: '세련되고 전문적인 여성' },
  { id: 'Ariel',          name: 'Ariel',          gender: 'female' as const, description: '생기있고 활발한 여성' },
] as const;

export type GeminiTtsVoiceId = typeof GEMINI_TTS_VOICES[number]['id'];

export const CONFIG = {
  // 기본 설정값들 (키 제외)
  DEFAULT_VOICE_ID: "pNInz6obpgDQGcFmaJgB",  // Adam - 기본 남성 음성
  DEFAULT_ELEVENLABS_MODEL: "eleven_multilingual_v2" as ElevenLabsModelId,
  DEFAULT_IMAGE_MODEL: "gemini-2.5-flash-image" as ImageModelId,
  DEFAULT_GEMINI_TTS_VOICE: "Charon" as GeminiTtsVoiceId,
  VIDEO_WIDTH: 1280,
  VIDEO_HEIGHT: 720,

  // 로컬 스토리지 키 이름 (내부 관리용)
  STORAGE_KEYS: {
    GEMINI_API_KEY: 'heaven_gemini_key',      // Gemini API 키 (사용자 직접 입력)
    ANTHROPIC_API_KEY: 'heaven_anthropic_key', // Claude API 키 (대본 생성용)
    ELEVENLABS_API_KEY: 'heaven_el_key',
    ELEVENLABS_VOICE_ID: 'heaven_el_voice',
    ELEVENLABS_MODEL: 'heaven_el_model',
    FAL_API_KEY: 'heaven_fal_key',  // PixVerse 영상 변환용
    IMAGE_MODEL: 'heaven_image_model',
    // Gemini 전용 화풍 설정
    GEMINI_STYLE: 'heaven_gemini_style',
    GEMINI_CUSTOM_STYLE: 'heaven_gemini_custom_style',
    IMAGE_TEXT_MODE: 'heaven_image_text_mode',
    SUBTITLE_CONFIG: 'heaven_subtitle_config',
    PROJECTS: 'heaven_projects',
    GEMINI_TTS_VOICE: 'heaven_gemini_tts_voice',
    TTS_PROVIDER: 'heaven_tts_provider',  // 'elevenlabs' | 'google' | 'gcloud' | 'azure'
    GCLOUD_TTS_API_KEY: 'heaven_gcloud_tts_key',  // Google Cloud TTS API 키
    GCLOUD_TTS_VOICE: 'heaven_gcloud_tts_voice',  // ko-KR-Neural2-A 등
    AZURE_TTS_API_KEY: 'heaven_azure_tts_key',    // Azure Speech API 키
    AZURE_TTS_REGION:  'heaven_azure_tts_region', // koreacentral 등
    AZURE_TTS_VOICE:   'heaven_azure_tts_voice',  // ko-KR-SunHiNeural 등
    VOICE_SPEED: 'heaven_voice_speed',          // '0.7' | '1.0' | '1.3'
    VOICE_STABILITY: 'heaven_voice_stability',   // '0'-'100' (ElevenLabs)
    VOICE_STYLE: 'heaven_voice_style',           // '0'-'100' (ElevenLabs expressiveness)
    ASPECT_RATIO: 'heaven_aspect_ratio',         // '16:9' | '9:16'
    VISUAL_STYLE_ID: 'heaven_visual_style_id',   // VisualStyleId
    LONGFORM_DURATION: 'heaven_longform_duration',   // seconds per scene (longform)
    SHORTFORM_DURATION: 'heaven_shortform_duration', // seconds per scene (shortform)
    CUSTOM_STYLE_PROMPT: 'heaven_custom_style_prompt', // 커스텀 스타일 프롬프트
    YOUTUBE_API_KEY: 'heaven_youtube_key',           // YouTube Data API 키
    CATEGORY_GUIDE_PREFIX: 'heaven_cat_guide_',      // + categoryId
  },

  // 애니메이션 설정
  ANIMATION: {
    ENABLED_SCENES: 10,      // 앞 N개 씬을 애니메이션으로 변환
    VIDEO_DURATION: 5        // 생성 영상 길이 (초) - PixVerse v5.5
  }
};
