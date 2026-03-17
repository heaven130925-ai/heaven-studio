/**
 * 프롬프트 시스템 (단순화 버전)
 * - 핵심 규칙만 유지
 * - 미사용 코드 제거
 */

// 캐릭터 기본 설명
export const VAR_BASE_CHAR = `Simple 2D stick figure. Circle head, dot eyes, line mouth, thin line body/arms/legs. Black outline only.`;

// 분위기 규칙
export const VAR_MOOD_ENFORCER = `
MOOD: NEGATIVE=dark/cold, POSITIVE=bright/warm, NEUTRAL=balanced.
`;

// 시스템 지시문
export const SYSTEM_INSTRUCTIONS = {
  CHIEF_ART_DIRECTOR: `
당신은 문장을 이미지로 변환하는 아트 디렉터입니다.

## 핵심 원칙
- 문장의 의미를 그대로 시각화하라
- "나무" → 나무를 그려라
- "빛나는 별" → 빛나는 별을 그려라
- 수식어 반영: "거대한"→크게, "빛나는"→광택, "조용한"→고요한 분위기

## 시각화 규칙
- 물리적 형태 있으면 → 그대로 그려라
- 숫자/데이터 → 그래프, 화살표, 시각적 형태로 표현 (텍스트 규칙 우선 적용)
- 추상 개념 → 관련 사물이나 상징으로 표현
- 감정/분위기 → 색상, 빛, 날씨로 표현

## 캐릭터 등장 규칙
- 주어가 사람 → 캐릭터 등장 (STANDARD)
- 주어가 사물/자연/추상개념 → 캐릭터 없음 (NO_CHAR)
- 예: "하나님이 말씀하셨다"→STANDARD, "빛이 생겨났다"→NO_CHAR

## 구도
- NO_CHAR: 캐릭터 없음
- MICRO (5-15%): 작은 캐릭터 + 큰 사물
- STANDARD (30-40%): 캐릭터와 사물 상호작용
- MACRO (60-80%): 캐릭터 클로즈업
`,

  TREND_RESEARCHER: `다양한 분야의 흥미로운 주제를 발굴하는 리서처입니다.`,

  MANUAL_VISUAL_MATCHER: `
대본을 시각화하는 전문가입니다.
- 대본 내용 수정 금지
- 씬 분할과 시각적 연출만 수행
- 같은 개념은 같은 모습으로 그려라
`,

  REFERENCE_MATCH: `참조 이미지의 화풍을 따르되 졸라맨 규칙을 적용하라.`,

  CHARACTER_CONSISTENT_DIRECTOR: `
당신은 캐릭터 일관성 전문 스토리보드 작가입니다.
사용자가 캐릭터 참조 이미지를 제공했습니다. 이 캐릭터의 외모는 참조 이미지로 고정됩니다.

## 핵심 규칙
- image_prompt_english에 캐릭터의 외모를 절대 묘사하지 말 것 (머리색, 눈색, 피부색, 체형, 나이, 성별 등 일체 금지)
- 캐릭터가 등장하는 씬에서는 반드시 "THE CHARACTER" 로 표현할 것
- 씬의 배경(location), 행동(action), 주변 사물(objects), 감정(mood), 조명(lighting)에만 집중할 것
- 대본 내용 수정 금지, 씬 분할과 시각화만 수행
- 문장 의미를 그대로 이미지화하되 캐릭터 외모 묘사는 모두 생략

## 올바른 예시
나레이션: "김지영은 조용한 카페에서 커피를 마시고 있었다"
image_prompt_english: "THE CHARACTER sits at a small table in a quiet cozy café, holding a coffee cup, warm soft lighting, calm atmosphere, wooden interior"

## 잘못된 예시 (금지)
image_prompt_english: "A young woman with long black hair and fair skin sits at a café..." ← 외모 묘사 금지
`
};

/**
 * 최종 이미지 프롬프트 생성
 */
export const getFinalVisualPrompt = (scene: any, hasCharacterRef: boolean = false, artStylePrompt?: string, textMode: string = 'auto', aspectRatio: string = '16:9') => {
  const basePrompt = scene.visualPrompt || "";
  const analysis = scene.analysis || {};
  // none 모드에서는 keywords 완전 무시 (텍스트 렌더링 유발 방지)
  const keywords = textMode === 'none' ? '' : (scene.visual_keywords || "");
  const type = analysis.composition_type || "STANDARD";
  const sentiment = analysis.sentiment || "NEUTRAL";

  // 분위기
  const mood = sentiment === 'NEGATIVE' ? 'Dark, cold lighting.'
    : sentiment === 'POSITIVE' ? 'Bright, warm lighting.'
    : 'Balanced lighting.';

  // 캐릭터 (화풍 적용)
  const styleNote = artStylePrompt ? ` Render in ${artStylePrompt} style.` : '';
  const sizeNote = type === 'MICRO' ? '5-15% of frame' : type === 'MACRO' ? '60-80% of frame' : '30-40% of frame';
  const charPrompt = type === 'NO_CHAR'
    ? `NO CHARACTER - objects only. No human figures.${styleNote}`
    : hasCharacterRef
    ? `Use CHARACTER REFERENCE image.${styleNote}`
    : artStylePrompt
    ? `Human figure in ${artStylePrompt} style. Size: ${sizeNote}. NO stick figures, NO simple outlines — fully rendered in art style.`
    : `Stick figure (${sizeNote}).`;

  // 스타일
  const style = artStylePrompt
    ? `STYLE: ${aspectRatio}, ${artStylePrompt}. Consistent style, high quality illustration.`
    : `STYLE: ${aspectRatio}, 2D hand-drawn, crayon texture. Consistent style, high quality illustration.`;

  const char = hasCharacterRef
    ? `CHARACTER: Match reference image.${styleNote}`
    : artStylePrompt
    ? `CHARACTER: Fully rendered human in ${artStylePrompt} style. STRICTLY NO stick figures, NO simple line figures, NO minimalist outlines.`
    : `CHARACTER: ${VAR_BASE_CHAR}`;

  // ── 절대 금지 규칙 (프롬프트 맨 앞 + 맨 뒤 이중 적용) ──────────────
  // 단일 프레임 강제 (항상)
  const singleFrameTop = `⛔ ABSOLUTE RULE #1 — ONE SINGLE IMAGE: Generate exactly ONE continuous, unified image. The entire canvas = one scene. FORBIDDEN: panels, comic strips, split-screens, grids, multiple cuts, storyboard layouts, before/after comparisons, triptychs, diptychs, collages, any borders or lines dividing the image. ONE scene = ONLY valid output. Multiple frames = INSTANT FAILURE.`;
  const singleFrameBottom = `⛔ FINAL CHECK — SINGLE FRAME: ONE image, ONE scene, NO panels, NO splits, NO borders, NO divided canvas of any kind.`;

  // 텍스트 규칙
  let textTop = '';
  let textBottom = '';
  let textRule = ''; // 중간 삽입용 (auto 모드)

  if (textMode === 'none') {
    textTop = `⛔ ABSOLUTE RULE #2 — ZERO TEXT: Do NOT render any text, letters, words, numbers, signs, logos, labels, captions, watermarks, or written characters ANYWHERE in the image. This is a pure visual scene with NO readable text whatsoever. Including text = CRITICAL FAILURE.`;
    textBottom = `⛔ FINAL CHECK — ZERO TEXT: No Korean (한글), no English, no numbers, no symbols, no written language of ANY kind. Pure visual only.`;
  } else if (textMode === 'english') {
    textTop = `⚠️ TEXT RULE: English/Latin characters ONLY. Korean (한글), Chinese, Japanese, Arabic forbidden.`;
    textBottom = keywords
      ? `⚠️ FINAL TEXT: Render "${keywords}" in ENGLISH ONLY. FORBIDDEN: Korean, Chinese, Japanese, Arabic.`
      : `⚠️ FINAL TEXT: Latin/English only. FORBIDDEN: Korean (한글), Chinese, Japanese, Arabic.`;
  } else if (textMode === 'numbers') {
    textTop = `⚠️ TEXT RULE: Only Arabic numerals (0-9) allowed. No words, no letters of any kind.`;
    textBottom = `⚠️ FINAL TEXT: ONLY digits (0-9) and basic symbols. NO letters, NO words, NO Korean, NO English words.`;
  } else {
    // auto: 기존 동작
    textRule = keywords ? `TEXT: "${keywords}"` : '';
  }

  return `
${singleFrameTop}
${textTop ? textTop + '\n' : ''}
${basePrompt}

MOOD: ${mood}
${charPrompt}

${style}
${char}
${VAR_MOOD_ENFORCER}
QUALITY: Sharp lines, clean composition, consistent art style. No blurry or low-quality elements.
${textRule ? `\n${textRule}` : ''}

${singleFrameBottom}
${textBottom ? textBottom : ''}
`.trim();
};

// 트렌드 검색 프롬프트
export const getTrendSearchPrompt = (category: string, _usedTopicsString: string) =>
  `Search for 4 interesting and trending "${category}" topics suitable for video content. Return JSON: [{rank, topic, reason}]`;

// 스크립트 생성 프롬프트
export const getScriptGenerationPrompt = (
  topic: string,
  sourceContext?: string | null,
  maxScenes?: number,
  preSegmented?: boolean,   // JS에서 [SCENE_BLOCK_N] 으로 미리 분할된 경우
  hasCharacterRef?: boolean  // 캐릭터 참조 이미지 여부
) => {
  const isManual = !!sourceContext;

  // ─── 자동 주제 모드: 주제어로부터 대본 직접 생성 ───────────────────────
  if (!isManual) {
    const sceneTarget = maxScenes ? `정확히 ${maxScenes}개` : `5~10개`;
    return `
# Task: "${topic}" 주제로 한국어 영상 대본 생성

## 지시사항
주제 "${topic}"에 대해 시청자가 흥미롭게 볼 수 있는 영상 나레이션 대본을 직접 작성하라.

## 씬 구성
- 씬 수: ${sceneTarget}
- 각 씬 narration: 자연스러운 한국어 나레이션 문장 1~3개 (읽기 좋은 속도)
- 도입 → 전개 → 결말 구조로 구성
- 같은 내용 반복 금지

## 시각화 (image_prompt_english 작성 규칙)
나레이션 문장의 핵심 내용을 구체적으로 시각화하라. 반드시 아래 요소를 포함:
- **WHO**: 누가 등장하는가 (사람→THE CHARACTER 또는 사물/개념)
- **WHAT**: 무엇을 하고 있는가 (구체적 행동/상태)
- **WHERE**: 어디에서 (구체적 장소/배경)
- **KEY OBJECTS**: 씬에 반드시 있어야 할 핵심 사물
- **MOOD/LIGHTING**: 분위기, 조명
- 나레이션에 나온 고유명사(삼성, NVIDIA, 서울 등)는 반드시 영문 프롬프트에 포함
- 주어가 사람/인격체 → STANDARD, 주어가 사물/자연/추상 → NO_CHAR
- 추상 개념(경제, 시장, 성장 등) → 그래프, 화살표, 상징적 오브젝트로 표현
${hasCharacterRef ? `
## ⚠️ 캐릭터 참조 이미지 모드 (CRITICAL)
- image_prompt_english에 캐릭터 외모를 절대 묘사 금지 (머리색/눈색/피부/체형/나이/성별 등)
- 사람이 등장하는 씬: 반드시 "THE CHARACTER" 로만 표현
- 씬의 배경, 행동, 사물, 분위기, 조명에만 집중
- 올바른 예: "THE CHARACTER stands in front of a large whiteboard presenting charts, modern office, bright lighting"
- 잘못된 예: "A young woman with black hair stands..." ← 외모 묘사 절대 금지
` : ''}

## 브랜드/고유명사
- 한국어 고유명사 → 한국어 그대로, 외국어 → 원어 그대로

### JSON 출력 형식 ###
{
  "scenes": [{
    "sceneNumber": 1,
    "narration": "이 씬의 한국어 나레이션 문장",
    "visual_keywords": "이미지에 표시할 텍스트 (없으면 빈 문자열)",
    "analysis": {
      "sentiment": "POSITIVE 또는 NEGATIVE 또는 NEUTRAL 중 하나",
      "composition_type": "MICRO 또는 STANDARD 또는 MACRO 또는 NO_CHAR 중 하나"
    },
    "image_prompt_english": "씬을 묘사하는 영문 이미지 프롬프트"
  }]
}

### 주의사항 ###
- narration은 반드시 한국어로 작성
- "나레이션"이라는 단어를 narration 값에 포함하지 말 것
- 주제: ${topic}
`;
  }

  // ─── 수동 대본 모드: 입력된 대본을 씬으로 분할 ───────────────────────
  const content = sourceContext;

  const sceneCountRule = preSegmented
    ? `⚠️ 사전 분할 모드 (STRICT):
- 입력 텍스트는 [SCENE_BLOCK_N] 블록으로 이미 균등 분할되어 있음
- 반드시 각 블록 = 정확히 1개 씬 (블록 수 == 출력 씬 수)
- 블록 안 모든 문장을 narration에 포함할 것
- 블록 순서 절대 유지, 건너뛰기 금지
- 블록 경계([SCENE_BLOCK_N] 태그)는 narration에 포함하지 말 것`
    : maxScenes
    ? `⚠️ 씬 수 제한: 정확히 ${maxScenes}개 씬 생성
- 전체 대본을 ${maxScenes}개 구간으로 균등 분할 후 각 구간 = 1씬
- 앞부분에 씬을 몰거나 뒷부분을 생략하는 것 절대 금지
- 마지막 씬은 반드시 대본의 마지막 내용을 포함해야 함`
    : `- 입력 문장 수 = 출력 씬 수 (전체 대본 빠짐없이 커버)`;

  return `
# Task: 대본 → 스토리보드 변환 (주제: "${topic}")

## ━━ STEP 1: 대본 완전 분석 (DEEP READ) ━━
아래 [입력 대본]을 스토리보드로 변환하기 전에 반드시 전체 내용을 완벽하게 파악하라.
분석 시 다음을 파악해야 한다:
- **핵심 주제**: 이 대본이 전달하고자 하는 중심 메시지는 무엇인가?
- **등장인물/주체**: 대본에 나오는 사람, 기업, 사물, 개념의 목록
- **서사 흐름**: 도입 → 전개 → 결말의 흐름과 각 문장의 역할
- **감정/톤**: 각 문장의 감정 (긍정/부정/중립)과 강도
- **고유명사**: 브랜드, 인명, 지명, 수치 등 반드시 이미지에 반영해야 할 요소
- **수식어/강조**: "거대한", "충격적인", "최초로" 등 시각적으로 강조해야 할 표현

이 분석을 바탕으로 각 씬의 시각화가 대본 내용과 100% 일치하도록 보장하라.
대본 내용을 파악하지 못한 채 generic한 이미지를 생성하는 것은 절대 금지.

## ━━ STEP 2: 씬 분할 ━━
${sceneCountRule}
- 같은 내용 반복 금지
- ⚠️ narration 필드: 입력된 대본 문장을 그대로 복사 (수정/요약/변형 절대 금지)
- "나레이션"이라는 단어를 절대 출력하지 말 것

## ━━ STEP 3: 시각화 (image_prompt_english) ━━
각 씬의 나레이션 문장을 깊이 이해한 뒤 영문 이미지 프롬프트를 작성하라.
반드시 아래 5가지 요소를 포함:
- **WHO**: 누가 등장하는가 (사람 → "THE CHARACTER" 또는 구체적 사물/브랜드명)
- **WHAT**: 구체적으로 무엇을 하고 있는가 (행동/상태를 동사로 명확히)
- **WHERE**: 구체적 장소/배경 (추상적 설명 금지 — "office" 대신 "glass-walled boardroom")
- **KEY OBJECTS**: 나레이션에 언급된 핵심 사물/브랜드/수치를 반드시 포함
- **MOOD/LIGHTING**: 분위기와 조명 (나레이션의 감정 톤을 시각적으로 반영)

추가 규칙:
- 수식어를 시각에 반영 ("거대한"→크게, "어두운"→dark dramatic lighting, "충격적"→sharp contrast)
- 고유명사(삼성, NVIDIA, 미국 연준 등)는 반드시 이미지 프롬프트에 포함
- 추상 개념(경제 성장, 인플레이션 등) → 구체적 그래프, 화살표, 숫자 게이지로 표현
- 주어가 사람/인격체 → STANDARD, 주어가 사물/자연현상/수치/시스템 → NO_CHAR

## 브랜드/고유명사
- 한국어 고유명사 → 한국어 그대로, 외국어 고유명사 → 원어 그대로

## 캐릭터
- 주어가 사람/인격체 → STANDARD
- 주어가 사물/자연현상/추상개념/수치/시스템 → NO_CHAR
${hasCharacterRef ? `
## ⚠️ 캐릭터 참조 이미지 모드 (CRITICAL)
- image_prompt_english에 캐릭터 외모를 절대 묘사 금지 (머리색/눈색/피부/체형/나이/성별 등)
- 사람이 등장하는 씬: 반드시 "THE CHARACTER" 로만 표현
- 씬의 배경, 행동, 사물, 분위기, 조명에만 집중
- 올바른 예: "THE CHARACTER walks through a crowded market at sunset, carrying a shopping bag, warm golden lighting, bustling stalls around"
- 잘못된 예: "A young woman with dark hair..." ← 외모 묘사 절대 금지
` : ''}
[수동 대본] 원문 수정 금지. STEP 1 분석 → STEP 2 씬 분할 → STEP 3 시각화 순서로 처리.

[입력 대본]
${content}

### JSON 출력 형식 ###
{
  "scenes": [{
    "sceneNumber": 1,
    "narration": "입력된 대본 문장을 여기에 그대로 복사",
    "visual_keywords": "이미지에 표시할 텍스트 (없으면 빈 문자열)",
    "analysis": {
      "sentiment": "POSITIVE 또는 NEGATIVE 또는 NEUTRAL 중 하나",
      "composition_type": "MICRO 또는 STANDARD 또는 MACRO 또는 NO_CHAR 중 하나"
    },
    "image_prompt_english": "씬을 묘사하는 구체적이고 상세한 영문 프롬프트 (최소 30단어 이상)"
  }]
}

### 최종 체크리스트 ###
- narration: 입력 텍스트의 각 문장을 그대로 사용 (수정 절대 금지)
- image_prompt_english: 나레이션 내용과 100% 일치하는 구체적 시각 묘사
- 고유명사/브랜드/수치 누락 금지
- "나레이션"이라는 단어 절대 출력 금지
`;
};
