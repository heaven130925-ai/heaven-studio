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

  REFERENCE_MATCH: `참조 이미지의 화풍을 따르되 졸라맨 규칙을 적용하라.`
};

/**
 * 최종 이미지 프롬프트 생성
 */
export const getFinalVisualPrompt = (scene: any, hasCharacterRef: boolean = false, artStylePrompt?: string, textMode: string = 'auto', aspectRatio: string = '16:9') => {
  const basePrompt = scene.visualPrompt || "";
  const analysis = scene.analysis || {};
  const keywords = scene.visual_keywords || "";
  const type = analysis.composition_type || "STANDARD";
  const sentiment = analysis.sentiment || "NEUTRAL";

  // 분위기
  const mood = sentiment === 'NEGATIVE' ? 'Dark, cold lighting.'
    : sentiment === 'POSITIVE' ? 'Bright, warm lighting.'
    : 'Balanced lighting.';

  // 캐릭터 (화풍 적용)
  const styleNote = artStylePrompt ? ` Render in ${artStylePrompt} style.` : '';
  const charPrompt = type === 'NO_CHAR'
    ? `NO CHARACTER - objects only. No human figures.${styleNote}`
    : hasCharacterRef
    ? `Use CHARACTER REFERENCE image.${styleNote}`
    : `Stick figure (${type === 'MICRO' ? '5-15%' : type === 'MACRO' ? '60-80%' : '30-40%'}).${styleNote}`;

  // 스타일
  const style = artStylePrompt
    ? `STYLE: ${aspectRatio}, ${artStylePrompt}. Consistent style, high quality illustration.`
    : `STYLE: ${aspectRatio}, 2D hand-drawn, crayon texture. Consistent style, high quality illustration.`;

  const char = hasCharacterRef
    ? `CHARACTER: Match reference image.${styleNote}`
    : `CHARACTER: ${VAR_BASE_CHAR}${styleNote}`;

  // 텍스트 규칙 (프롬프트 앞 prefix + 뒤 FINAL OVERRIDE 이중 적용)
  let textPrefix = '';
  let textRule = '';

  if (textMode === 'none') {
    textPrefix = '🚫 TEXT RESTRICTION ACTIVE: Do NOT include any text, letters, words, or numbers anywhere in the image.\n\n';
    textRule = '🚫 ABSOLUTE FINAL OVERRIDE - ZERO TEXT: Do NOT render ANY text, letters, words, numbers, labels, captions, signs, or written characters of ANY kind in ANY language. IGNORE any text instructions above. Pure visual imagery only. No exceptions.';
  } else if (textMode === 'english') {
    textPrefix = '⚠️ TEXT RESTRICTION: English/Latin characters only. Korean/Chinese/Japanese forbidden.\n\n';
    textRule = keywords
      ? `⚠️ FINAL TEXT RULE: ONLY Latin/English characters allowed. Render "${keywords}" in English ONLY. STRICTLY FORBIDDEN: Korean (한글), Chinese, Japanese, Arabic, or any non-Latin script.`
      : '⚠️ FINAL TEXT RULE: ONLY Latin/English characters allowed. STRICTLY FORBIDDEN: Korean (한글), Chinese, Japanese, Arabic, or any non-Latin script.';
  } else if (textMode === 'numbers') {
    textPrefix = '⚠️ TEXT RESTRICTION: Only Arabic numerals (0-9) allowed. No Korean, no English words, no letters of any kind.\n\n';
    textRule = '⚠️ FINAL TEXT RULE: ONLY Arabic numerals (0-9) and basic symbols (+, -, %, $, .) allowed. NO letters. NO words. NO Korean (한글). NO English words. NO written language of any kind.';
  } else {
    // auto: 기존 동작
    textRule = keywords ? `TEXT: "${keywords}"` : '';
  }

  return `
${textPrefix}${basePrompt}

MOOD: ${mood}
${charPrompt}

${style}
${char}
${VAR_MOOD_ENFORCER}
QUALITY: Sharp lines, clean composition, consistent art style across all scenes. No blurry or low-quality elements.
${textRule ? `\n${textRule}` : ''}
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
  preSegmented?: boolean   // JS에서 [SCENE_BLOCK_N] 으로 미리 분할된 경우
) => {
  const isManual = !!sourceContext;
  const content = sourceContext || topic;

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
# Task: Generate Storyboard for "${topic}"

## 씬 분할 규칙
${sceneCountRule}
- 같은 내용 반복 금지
- ⚠️ narration 필드: 입력된 대본 문장을 그대로 복사 (절대 "나레이션"이라고 쓰지 말 것)

## 시각화
- 문장 의미를 그대로 이미지화
- 수식어 반영 ("거대한"→크게)

## 브랜드/고유명사
- 한국어 고유명사 → 한국어 그대로, 외국어 고유명사 → 원어 그대로

## 캐릭터
- 주어가 사람/인격체 → STANDARD
- 주어가 사물/자연현상/추상개념 → NO_CHAR

${isManual ? '[수동 대본] 원문 수정 금지, 씬 분할만' : ''}

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
    "image_prompt_english": "씬을 묘사하는 영문 프롬프트"
  }]
}

### 중요 ###
- narration: 입력 텍스트의 각 문장을 그대로 사용할 것!
- "나레이션"이라는 단어를 절대 출력하지 말 것
`;
};
