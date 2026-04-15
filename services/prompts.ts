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

  TREND_RESEARCHER: `당신은 한국 유튜브 트렌드 전문 리서처입니다.

## 핵심 역할
- Google 검색으로 지금 한국 유튜브에서 실제로 조회수가 폭발하는 주제를 발굴
- 카테고리를 절대 벗어나지 않음 — 지정된 카테고리 외 주제 추천 = 즉각 실패
- "요즘 뜨는", "최근 화제", "지금 유행" 등 시의성 높은 내용 우선

## 추천 기준 (중요도 순)
1. 조회수 100만+ 또는 바이럴 지수 높은 포맷
2. 댓글/공유가 많은 자극적 제목 형태
3. 썸네일 클릭률 높은 후킹 포인트 포함
4. 한국인 정서에 맞는 소재 (공감, 분노, 충격, 감동)

## 절대 금지
- 카테고리 혼재 (쇼핑에 종교, 역사에 쇼핑 등)
- 진부하고 뻔한 주제
- 검색량 낮은 비주류 주제`,

  MANUAL_VISUAL_MATCHER: `
대본을 시각화하는 전문가입니다.
- 대본 내용 수정 금지
- 씬 분할과 시각적 연출만 수행
- 같은 개념은 같은 모습으로 그려라
`,

  REFERENCE_MATCH: `참조 이미지의 화풍을 따르되 졸라맨 규칙을 적용하라.`,

  VIRAL_SCRIPT_WRITER: `당신은 한국 유튜브 바이럴 콘텐츠 전문 대본 작가입니다.
조회수 10만~100만을 기록한 영상들의 패턴을 분석한 결과, 성공의 핵심은 이미지나 편집이 아니라 대본 품질임을 알고 있습니다.

## 당신의 역할
- 시청자가 첫 5초 안에 스크롤을 멈추게 만드는 훅 설계
- 감정 트리거(공포, 호기심, 공감, 분노, 욕망)를 활용한 나레이션 작성
- 구체적 수치, 실화, 반전을 통한 몰입 유지
- 자연스러운 구어체 대화 톤 (딱딱한 글 읽기 느낌 금지)

## 대본 품질 기준
1. 훅: 첫 문장에서 시청자를 낚아야 함 (인사말, 자기소개 절대 금지)
2. 전개: 매 씬마다 새로운 정보 또는 감정 자극 포함
3. 몰입: "하지만 여기서 더 충격적인 것은..." 같은 클리프행어 활용
4. 마무리: 핵심 메시지 압축 + 여운 또는 다음 영상 궁금증 유발

Output ONLY a valid JSON. No markdown code fences, no explanation text.`,

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
  } else if (textMode === 'korean') {
    textTop = `⚠️ TEXT RULE: If text appears in the image, use Korean (한글) ONLY. Keep text minimal — at most 1 short word or phrase (2~5 characters) as a natural part of the scene (e.g. sign, label, title). DO NOT fill the image with text. The scene is primarily VISUAL. English, Latin, Chinese, Japanese, Arabic forbidden.`;
    textBottom = keywords
      ? `⚠️ FINAL TEXT: If showing text, render "${keywords}" in KOREAN (한글). Keep it short and natural. FORBIDDEN: English, Latin, Chinese, Japanese. Do NOT cover the image with text.`
      : `⚠️ FINAL TEXT: Minimal Korean (한글) text only if naturally part of the scene. Do NOT flood the image with text. FORBIDDEN: English, Latin, Chinese, Japanese, Arabic.`;
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
// 카테고리별 강력한 주제 가이드
export const CATEGORY_GUIDES: Record<string, { keywords: string[]; hotFormats: string[]; examples: string[]; forbidden: string[] }> = {
  '쇼핑/제품리뷰': {
    keywords: ['알리익스프레스 꿀템', '다이소 신상', '올리브영 추천', '언박싱', '역대급 가성비', '살면서 꼭 사야 할'],
    hotFormats: ['OO원짜리 vs OO원짜리 비교', '알리에서 산 OO 실제로 써봤더니', '다이소에서 발견한 레전드 제품 TOP5', '이거 안 쓰면 손해 아이템'],
    examples: ['알리익스프레스 꿀템 10개 직접 써봤습니다 (실망vs만족)', '다이소 신상 뷰티템 올리브영이랑 비교해봤더니', '2025 역대급 가성비 생활용품 TOP7'],
    forbidden: ['종교', '역사', '철학', '심리치료', '성경', '불교', '의학', '정치'],
  },
  '경제/재테크/투자': {
    keywords: ['부동산', '주식', '절세', '직장인 부업', '월 OO만원', '파이어족', '코인', '배당주', '재테크 실패'],
    hotFormats: ['직장인이 부업으로 월 OO만원 버는 법', '30대에 OO억 모은 사람들의 공통점', '절대 하면 안 되는 재테크 실수', '이것만 알면 세금 OO만원 아낍니다'],
    examples: ['직장인 월급으로 5년 안에 1억 모으는 현실적인 방법', '2025 부동산 지금 사야 할까 팔아야 할까', '코인 투자로 날린 3000만원 실화 (반면교사)'],
    forbidden: ['종교', '역사', '쇼핑', '연예', '스포츠', '유머', '성경', '기도'],
  },
  '한국사/세계사': {
    keywords: ['조선시대', '일제강점기', '충격 사건', '숨겨진 역사', '세계사 반전', '실존인물', '역사 미스터리'],
    hotFormats: ['알고 보면 충격적인 조선시대 OO', '교과서에 없는 역사의 진실', '세계사를 바꾼 OO의 결정', '한국인이 모르는 일제강점기 실화'],
    examples: ['조선시대 왕들의 충격적인 식습관 TOP5', '일제강점기 독립운동가들이 숨겨둔 비밀 이야기', '교과서에 나오지 않는 세계 역사의 뒤통수'],
    forbidden: ['쇼핑', '주식', '연예인', '종교 교리', '제품리뷰', '심리상담'],
  },
  '과학/우주/자연': {
    keywords: ['블랙홀', '외계인', '지구 종말', '양자역학', '동물의 신비', '우주 최신 발견', 'AI 미래'],
    hotFormats: ['과학자들이 숨기고 싶은 OO의 진실', 'NASA가 공개한 충격적인 발견', '이 동물의 능력을 알면 소름 돋습니다', '10년 안에 지구에 일어날 일'],
    examples: ['블랙홀 안에 들어가면 실제로 어떻게 될까?', '인류가 아직 설명 못하는 자연현상 TOP7', 'AI가 2030년까지 바꿀 직업들 (충격적인 결과)'],
    forbidden: ['쇼핑', '연예인 가십', '종교 교리', '투자', '역사인물'],
  },
  '뉴스/시사/사회': {
    keywords: ['최근 사건', '사회 이슈', '논란', '충격 사건', '화제의', '요즘 한국'],
    hotFormats: ['요즘 한국에서 논란인 OO 실상', '충격적인 사건의 전말', '아무도 말 안 해주는 OO의 진실', '이 뉴스 뒤에 숨겨진 이야기'],
    examples: ['최근 화제가 된 사건 뒤에 숨겨진 충격적인 진실', '한국 사회에서 절대 사라지지 않는 OO 문제', '요즘 MZ세대가 열받는 이유 TOP5'],
    forbidden: ['제품리뷰', '쇼핑', '우주', '동물', '역사유물', '종교 기적'],
  },
  '종교/영성/철학': {
    keywords: ['사후세계', '기적 실화', '종말론', '명상', '영적 체험', '운명', '인생의 의미', '기도 응답'],
    hotFormats: ['죽음 직전 체험한 사람들의 공통적인 이야기', '기적이라고밖에 설명 안 되는 실화', '이 한 가지를 알면 인생이 달라집니다', '성경/불경에 숨겨진 충격적인 이야기'],
    examples: ['임사체험자 100명이 공통적으로 말하는 사후세계', '기적이라 부를 수밖에 없는 실화 모음', '불교에서 말하는 행복의 진짜 의미'],
    forbidden: ['쇼핑', '주식', '연예인', '스포츠 경기', '제품리뷰'],
  },
  '건강/의학': {
    keywords: [
      // 음식/식품
      '같이 먹으면 독이 되는 음식', '설탕보다 나쁜 식품', '100세 장수 식단', '과일과 먹으면 안 되는 것', '공복에 먹으면 안 되는 음식', '전자레인지 발암',
      // 신체 부위별
      '치아 건강', '손톱으로 보는 건강', '혀 색깔 건강 신호', '눈 건강', '장 건강', '간 건강', '혈관 나이',
      // 나이별/시기별
      '50대 이후 절대 먹으면 안 되는 것', '40대부터 시작해야 할 습관', '80세 못 사는 사람들의 공통점', '100세까지 사는 사람들의 비결',
      // 생활습관
      '수면 자세', '걷기 vs 달리기', '냉수 vs 온수', '아침 공복 물', '햇빛 노출',
      // 충격/반전
      '건강식품인 줄 알았는데 독', '매일 먹으면 망가지는 장기', '병원도 모르는 자연치유', '의사들이 본인은 안 먹는 것',
    ],
    hotFormats: [
      '같이 먹으면 독 되는 음식 조합 TOP5',
      '80세를 못 넘기는 사람들의 공통점 OO가지',
      'OO세 넘으면 절대 먹으면 안 되는 음식',
      '손톱/치아/혀로 알 수 있는 내 몸의 이상 신호',
      '100세 장수 노인들이 매일 하는 딱 한 가지',
      '설탕보다 더 치명적인 음식의 정체',
      '과일과 함께 먹으면 독이 되는 음식들',
      '의사들이 본인은 절대 안 먹는 식품',
    ],
    examples: [
      '바나나+우유 같이 먹으면 안 되는 이유 (충격적인 진실)',
      '손톱 모양으로 알 수 있는 건강 이상 신호 7가지',
      '80세까지 못 사는 사람들의 충격적인 공통점 4가지',
      '50세 넘으면 절대 먹으면 안 되는 음식 TOP5',
      '설탕보다 100배 나쁘다는 이 식품의 정체',
      '치아 건강이 수명을 결정한다 (치과의사 충격 발언)',
      '100세 장수 노인 마을의 식단을 분석해봤더니',
      '아침 공복에 절대 먹으면 안 되는 음식 5가지',
    ],
    forbidden: ['쇼핑', '주식', '종교 기적', '연예인', '역사', '스포츠'],
  },
  '심리/정신건강': {
    keywords: ['나르시시스트', 'MBTI', '불안장애', '공황장애', '번아웃', '애착유형', '트라우마', '심리 테스트'],
    hotFormats: ['이 특징 3개 이상이면 OO입니다', '나르시시스트가 꼭 하는 말 TOP7', 'OO 타입이 연애에서 반드시 망하는 이유', '심리학자가 말하는 OO에서 벗어나는 방법'],
    examples: ['나르시시스트 옆에 있으면 나타나는 신체 증상들', '번아웃 온 사람들의 공통적인 행동 패턴', 'MBTI별 절대 하면 안 되는 연애 실수'],
    forbidden: ['쇼핑', '주식', '역사', '우주', '종교 교리', '스포츠 경기'],
  },
  '연예/문화': {
    keywords: ['아이돌', '충격 폭로', '연예인 재산', '열애설', '역대급 무대', 'K팝 해외반응', '드라마 명장면'],
    hotFormats: ['연예인 과거 vs 현재 충격적인 변화', 'OO가 숨겨온 충격적인 과거', '외국인들이 K팝에 미치는 진짜 이유', '역대 최악의 연예인 논란 TOP5'],
    examples: ['외국인들이 K팝에 완전히 빠져드는 충격적인 이유', '역대 한국 최고 드라마 명장면 모음 (소름 주의)', '아무도 몰랐던 유명 아이돌의 숨겨진 재능'],
    forbidden: ['주식', '쇼핑 제품', '의학', '과학이론', '역사유물', '종교 교리'],
  },
  '스포츠': {
    keywords: ['손흥민', '류현진', '한국 축구', '올림픽', '역대급 경기', '스포츠 실패담', '감동 실화'],
    hotFormats: ['역대 최고의 OO 순간 TOP5', '아무도 예상 못 했던 역전 드라마', 'OO 선수의 충격적인 비하인드', '한국 스포츠 역사상 가장 감동적인 장면'],
    examples: ['손흥민 커리어 하이라이트 중 외국인도 소름 돋는 장면들', '한국 축구 역사상 가장 충격적인 반전 경기 TOP5', '올림픽 금메달리스트들의 숨겨진 훈련 비화'],
    forbidden: ['쇼핑', '종교', '주식', '의학', '연예인 가십'],
  },
  '유머/웃긴영상': {
    keywords: ['직장인 공감', '실수 모음', '황당한 썰', '민폐 손님', '알바 실화', '웃긴 상황', '빵 터지는'],
    hotFormats: ['이게 실제로 일어난 일이라고? 황당한 실화 모음', '직장에서 있었던 역대급 민폐 TOP5', '절대 따라하지 마세요 레전드 실패 모음', '공감되서 더 웃긴 일상 코미디'],
    examples: ['편의점 알바 10년차가 겪은 역대급 진상 손님 TOP7', '회사에서 절대 하면 안 되는 행동 (실화 모음)', '이거 겪어본 사람 다 공감하는 황당한 상황들'],
    forbidden: ['종교 교리', '의학 진단', '주식 투자', '역사 유물', '진지한 심리분석'],
  },
  '영화/드라마/애니': {
    keywords: ['숨겨진 명작', '결말 해석', '반전 모음', '역대급 OST', '애니 추천', '드라마 포기각', '영화 뒷이야기'],
    hotFormats: ['이 영화 결말의 진짜 의미 (감독이 숨겨둔 것)', '알면 더 재미있는 OO 숨겨진 디테일', '역대 최고 반전 영화 TOP10', '이 드라마 1화에서 이미 결말을 예고했습니다'],
    examples: ['알고 보면 소름 돋는 영화 속 숨겨진 복선들', '역대 한국 드라마 역대급 반전 장면 모음', '지브리 명작에 숨겨진 충격적인 메시지들'],
    forbidden: ['쇼핑', '주식', '실제 역사', '의학', '종교 교리'],
  },
  '한국 야담/기담/미스터리': {
    keywords: ['실화 귀신', '한국 도시전설', '미스터리 사건', '해결 안 된 실종', '귀신 목격담', '소름 돋는 실화'],
    hotFormats: ['아직까지 해결 안 된 한국 미스터리 TOP5', '실제로 있었던 소름 돋는 귀신 목격담', '이 사건은 아직도 설명이 안 됩니다', '한국에 실존하는 저주받은 장소들'],
    examples: ['지금도 미해결인 한국 충격 실종 사건 TOP5', '실제 목격자가 증언한 소름 돋는 귀신 이야기', '한국 도시전설 중 실제로 일어난 것들'],
    forbidden: ['쇼핑', '주식', '스포츠', '연예인 가십', '의학 치료'],
  },
};

export const getTrendSearchPrompt = (category: string, usedTopicsString: string) => {
  const used = usedTopicsString ? `\n⛔ 이미 사용된 주제 (절대 중복 금지): ${usedTopicsString}` : '';

  // 카테고리별 가이드 매칭
  const guide = CATEGORY_GUIDES[category];
  const categorySection = guide ? `
## 이 카테고리에서 터지는 키워드
${guide.keywords.map(k => `- ${k}`).join('\n')}

## 지금 한국 유튜브에서 조회수 폭발하는 포맷
${guide.hotFormats.map(f => `- ${f}`).join('\n')}

## 참고 예시 (그대로 복사 금지, 유사한 새 주제 생성)
${guide.examples.map(e => `- ${e}`).join('\n')}

## ⛔ 이 카테고리에서 절대 나오면 안 되는 내용
${guide.forbidden.map(f => `- ${f} 관련 주제`).join('\n')}` : '';

  const seed = Math.floor(Math.random() * 10000);
  return `지금 한국 유튜브에서 "${category}" 카테고리로 조회수 폭발하는 주제 10개를 추천하라. [seed:${seed}]
${categorySection}
${used}

## 필수 조건
- ⚠️ 주제와 이유는 100% 한국어 (영어 절대 금지)
- ⚠️ 반드시 "${category}" 카테고리에만 해당하는 주제 (다른 카테고리 혼재 = 즉각 실패)
- 지금 구글/유튜브에서 실제로 검색량 높은 시의성 있는 주제
- 클릭을 유발하는 자극적이고 구체적인 제목 형태
- 5~15분 분량 영상으로 만들 수 있는 내용
- 뻔하고 진부한 주제 금지

## ⚠️ 다양성 필수 원칙 (위반 시 즉각 실패)
- 10개 주제는 서로 완전히 다른 소재/인물/사건이어야 함
- 같은 인물·사건·소재를 다른 제목으로 반복 금지
- 아래 10가지 형식을 하나씩 사용 (각 번호당 1개):
  1. 실존 인물의 충격적인 실화
  2. 최근 6개월 내 화제 사건/이슈
  3. 대부분 모르는 숨겨진 사실/비화
  4. TOP N 랭킹/비교 형식
  5. 논란/반전이 있는 주제
  6. 감동·눈물 유발 스토리
  7. 공포·소름·섬뜩한 소재
  8. 돈·생활·실용 정보성 주제
  9. 해외 사례나 글로벌 이슈
  10. 국내 최신 트렌드/신조어/문화

JSON 배열로만 반환 (다른 텍스트 없이):
[{"rank": 1, "topic": "주제명", "reason": "선정 이유 — 왜 지금 조회수가 터지는지"}]`;
};

// 스크립트 생성 프롬프트
export const getScriptGenerationPrompt = (
  topic: string,
  sourceContext?: string | null,
  maxScenes?: number,
  preSegmented?: boolean,   // JS에서 [SCENE_BLOCK_N] 으로 미리 분할된 경우
  hasCharacterRef?: boolean,  // 캐릭터 참조 이미지 여부
  writingGuide?: string,      // 사용자 글쓰기 지침
  referenceVideoContext?: string,  // 레퍼런스 영상 분석 결과
  category?: string,          // 선택된 카테고리 (콘텐츠 제약용)
  targetMinutes?: number,     // 목표 영상 분 수 (대본 길이 제어)
  blueprint?: string,         // 대본 구조 설계 (섹션별 분량 + 내용 지침)
  chunkContext?: string        // 청크 생성 시 이전 씬 컨텍스트 (연속성 유지)
) => {
  const isManual = !!sourceContext;

  // ─── 자동 주제 모드: 주제어로부터 대본 직접 생성 ───────────────────────
  if (!isManual) {
    const sceneTarget = maxScenes ? `정확히 ${maxScenes}개 (이 숫자를 절대 어기지 말 것)` : `5~10개`;
    const guideSection = writingGuide?.trim() ? `\n## 글쓰기 지침 (반드시 따를 것)\n${writingGuide.trim()}\n` : '';
    const charReplaceNote = (referenceVideoContext?.trim() && hasCharacterRef)
      ? `\n⚠️ 레퍼런스 채널에 등장하는 캐릭터/인물은 사용자가 업로드한 캐릭터로 교체하라. 캐릭터의 성격·역할·행동 패턴은 동일하게 유지하되, 외형 묘사(image_prompt_english)에서는 반드시 "THE CHARACTER" 키워드를 사용하라.\n`
      : '';
    const refVideoSection = referenceVideoContext?.trim()
      ? `\n## 레퍼런스 채널 분석 (스타일 복제 — 반드시 참고)\n${referenceVideoContext.trim()}${charReplaceNote}\n⚠️ 위 레퍼런스 채널과 동일한 스타일/톤/씬 구성/자막 말투로 대본을 작성하라.\n`
      : '';

    // 카테고리 부분 일치 지원: '심리학' → '심리/정신건강' 자동 매핑
    const resolvedGuide = category
      ? CATEGORY_GUIDES[category]
        ?? Object.entries(CATEGORY_GUIDES).find(([k]) =>
            k.includes(category) || category.includes(k.split('/')[0])
          )?.[1]
      : null;
    const resolvedCategory = category
      ? (CATEGORY_GUIDES[category] ? category
        : Object.keys(CATEGORY_GUIDES).find(k =>
            k.includes(category) || category.includes(k.split('/')[0])
          ) ?? category)
      : '';

    const categoryConstraint = resolvedGuide ? `
## ⛔ 카테고리 제약 — 반드시 준수 (위반 시 즉각 실패)
이 영상은 "${resolvedCategory}" 카테고리입니다. 나레이션 전체가 반드시 이 카테고리에만 해당해야 합니다.

### 이 카테고리에서 절대 나오면 안 되는 내용
${resolvedGuide.forbidden.map(f => `- ❌ ${f} 관련 내용/표현/어투 일체 금지`).join('\n')}

### 이 카테고리에서 다뤄야 할 내용
${resolvedGuide.keywords.map(k => `- ✅ ${k}`).join('\n')}

나레이션에 위 금지 항목과 관련된 단어, 어투, 개념이 단 하나라도 등장하면 실패입니다.
종교적 어투(올리나이다, 주여, 아멘, 기도 등), 성경 말씀 형식, 기복적 표현은 "${resolvedCategory}" 카테고리가 아닌 한 절대 사용 금지.
` : '';

    // 목표 분 수 → 씬당 나레이션 길이 가이드
    const secPerScene = maxScenes && targetMinutes ? Math.round((targetMinutes * 60) / maxScenes) : null;
    const durationSection = targetMinutes ? `
## 영상 길이 제어 (반드시 준수)
- 목표 영상 길이: ${targetMinutes}분
- 각 씬 나레이션 읽기 시간: 약 ${secPerScene ?? 8}초 (한국어 기준 약 ${Math.round((secPerScene ?? 8) * 3.5)}자)
- 나레이션이 너무 짧으면 영상이 짧아짐 → 각 씬 나레이션을 충분히 길게 작성할 것
- 씬 수와 씬별 나레이션 길이를 합산하면 총 ${targetMinutes}분 분량이 되어야 함
` : '';

    // 대본 구조 설계 (블루프린트)
    const blueprintSection = blueprint?.trim() ? `
## ━━ 대본 구조 설계 — 반드시 이 구조를 따를 것 ━━
사용자가 다음 구조로 대본을 설계했습니다. 각 섹션의 분량, 내용, 감정선을 정확히 지켜서 작성하라.

${blueprint.trim()}

⚠️ 위 구조를 무시하면 즉각 실패. 각 섹션 전환 시 나레이션 흐름이 자연스럽게 이어지게 하라.
` : '';

    // 이전 청크 컨텍스트 (롱폼 청크 생성 시 연속성 유지)
    const chunkContextSection = chunkContext?.trim() ? `
## ━━ 이전 내용 (연속성 유지 필수) ━━
아래는 바로 앞 부분의 마지막 내용입니다. 이 내용과 자연스럽게 이어지도록 작성하라. 이미 나온 내용을 반복하지 말 것.

${chunkContext.trim()}
` : '';

    return `
# Task: "${topic}" 주제로 한국어 유튜브 영상 대본 생성
${categoryConstraint}${durationSection}${blueprintSection}${chunkContextSection}${guideSection}${refVideoSection}
## ━━ STEP 1: 콘텐츠 전략 수립 (대본 작성 전 반드시 분석) ━━

주제 "${topic}"에 대해 아래 4가지를 먼저 정하라. (출력에는 포함하지 않음, 내부 사고용)

**1. 핵심 감정 트리거** (하나 선택)
- 공포/충격: "이거 모르면 큰일 납니다", "지금 당장 멈춰야 하는 이유"
- 호기심/미스터리: "아무도 안 알려주는 비밀", "교과서에 없는 진짜 이야기"
- 공감/분노: "나만 몰랐던 것", "우리가 속아왔던 것"
- 욕망/이익: "이것만 알면 달라진다", "상위 1%가 하는 방법"

**2. 강력한 훅 설계** (첫 1~2개 씬, 5~10초)
- 시청자가 스크롤을 멈추게 만드는 충격적 사실, 역설, 질문, 또는 수치로 시작
- 절대 금지: "안녕하세요", "오늘은~에 대해 알아보겠습니다", 평범한 인사말

**3. 핵심 포인트 3~5개** 추출
- 이 주제에서 시청자가 가장 놀랄 사실, 반전, 구체적 사례를 선정

**4. 마무리 전략**
- 여운 남기는 질문, 교훈, 또는 "다음에 볼 영상" 연결

## ━━ STEP 2: 대본 작성 규칙 ━━

### 훅 (씬 1~2) — 절대적 기준
- 첫 문장에서 시청자의 뇌를 강타하라
- 구체적 수치, 충격적 사실, 또는 강렬한 질문으로 시작
- 좋은 예: "전 세계 인구 중 단 3%만 알고 있는 사실이 있습니다."
- 좋은 예: "여러분이 매일 하는 이 행동이, 사실은 당신을 망치고 있었습니다."
- 좋은 예: "2023년, 한 연구팀이 발표한 결과에 과학계가 발칵 뒤집혔습니다."
- 나쁜 예: "안녕하세요, 오늘은 OO에 대해 알아보겠습니다."

### 본론 (씬 3~마지막-1) — 몰입 유지
- 각 씬은 새로운 정보 or 반전을 포함 (지루함 금지)
- 구체적 사례, 실화, 데이터, 숫자를 적극 활용
- 중간에 클리프행어 삽입: "하지만 여기서 더 충격적인 사실이 있습니다."
- 시청자에게 직접 말 걸기: "여러분도 한번 생각해보세요", "믿기 어렵겠지만"
- 감정 기복 유지: 충격 → 설명 → 또 다른 충격 → 교훈

### 마무리 (마지막 씬) — 여운
- 핵심 메시지 한 문장으로 압축
- 시청자에게 행동/사고의 변화를 촉구
- 또는 "다음 영상"으로 이어지는 궁금증 유발

### 나레이션 문체
- 구어체, 자연스러운 대화 톤 (글 읽는 느낌 금지)
- 짧고 강한 문장 위주 (긴 문장은 2개로 분리)
- 감탄사 활용: "놀랍게도", "충격적인 건", "사실은", "그런데"
- 각 씬 나레이션: ${secPerScene ? `약 ${secPerScene}초 분량 (한국어 ${Math.round((secPerScene ?? 8) * 3.5)}자 내외)` : '2~4문장, 자연스러운 호흡'}

## ━━ STEP 3: 씬 수 및 구조 ━━
- 씬 수: ${sceneTarget}
- 씬 1~2: 훅/인트로 (시청자 낚기)
- 씬 3~(N-2): 본론 (핵심 포인트 전개, 각 포인트는 1~2씬)
- 씬 (N-1)~N: 반전/결론/여운
- 같은 내용 절대 반복 금지

## ━━ STEP 4: 시각화 (image_prompt_english) ━━
나레이션 내용을 구체적으로 시각화하라. 반드시 포함:
- **WHO**: 누가 등장하는가 (사람 → THE CHARACTER, 사물/추상 개념은 그 자체)
- **WHAT**: 무엇을 하고 있는가 (구체적 행동/상태, 동사 명확히)
- **WHERE**: 구체적 장소/배경 (추상 금지 — "office" 대신 "glass-walled boardroom")
- **KEY OBJECTS**: 나레이션에 언급된 핵심 사물/브랜드/수치 반드시 포함
- **MOOD**: 나레이션 감정 톤 반영 (충격 → dramatic contrast, 희망 → warm golden light)
- 고유명사(삼성, NVIDIA, 서울 등) → 영문 프롬프트에 반드시 포함
- 주어가 사람/인격체 → STANDARD, 주어가 사물/자연/추상 → NO_CHAR
- 추상 개념(경제 성장, 인플레이션) → 그래프, 화살표, 수치 게이지로 표현
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
- 첫 씬 나레이션은 반드시 강력한 훅으로 시작 (인사말 절대 금지)
- 주제: ${topic}
`;
  }

  // ─── 수동 대본 모드: 입력된 대본을 씬으로 분할 ───────────────────────
  const content = sourceContext;

  const sceneCountRule = preSegmented
    ? `⚠️ 사전 분할 모드 (STRICT) — 반드시 정확히 ${maxScenes}개 씬 출력:
- 입력 텍스트는 [SCENE_BLOCK_1] ~ [SCENE_BLOCK_${maxScenes}] 블록으로 이미 균등 분할되어 있음
- 블록 수 = 출력 씬 수 = ${maxScenes} (이 숫자를 절대 어기지 말 것)
- 반드시 각 블록 = 정확히 1개 씬, 건너뛰기·병합 절대 금지
- 블록 안 모든 문장을 narration에 그대로 포함할 것
- 블록 경계 태그([SCENE_BLOCK_N])는 narration에 포함하지 말 것`
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
⚠️ 가장 중요한 규칙: 나레이션 내용을 그대로 시각화하라. 임의로 다른 장면을 만들지 말 것.

### 감정/상황 반영 규칙 (절대 준수)
- 나레이션이 부정적/어두운 내용 → 이미지도 반드시 어둡고 우울하게
  - "힘들다/우울/고통/지쳐/끔찍/두렵다" → dark oppressive lighting, slumped posture, bleak atmosphere
  - "지옥철/만원버스/꽉 찬" → overcrowded suffocating space, miserable exhausted faces
  - "무서운 상상/끔찍한 생각" → dark surreal visual, threatening shadows, anxious expression
  - 웃는 표정, 밝은 조명, 행복한 분위기는 나레이션이 긍정적일 때만 허용
- 나레이션의 장소를 그대로 사용: "지하철"→subway, "집으로 가는 길"→commute/street at night
- 나레이션에 없는 장소(미술관, 고급 인테리어 등)를 임의로 넣지 말 것

각 씬의 나레이션 문장을 깊이 이해한 뒤 영문 이미지 프롬프트를 작성하라.
반드시 아래 5가지 요소를 포함:
- **WHO**: 누가 등장하는가 (사람 → "THE CHARACTER" 또는 구체적 사물/브랜드명)
- **WHAT**: 구체적으로 무엇을 하고 있는가 (행동/상태를 동사로 명확히)
- **WHERE**: 나레이션에 나오는 장소 (없으면 나레이션 상황에 맞는 자연스러운 공간)
- **KEY OBJECTS**: 나레이션에 언급된 핵심 사물/브랜드/수치를 반드시 포함
- **MOOD/LIGHTING**: 나레이션 감정 톤 그대로 반영 (부정적 내용→어두운 조명/분위기)

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

/**
 * 대본 검수 프롬프트
 * - 중복/반복 내용 탐지
 * - 시간 순서 오류
 * - 훅 효과 평가
 * - 재미없는 씬 지적 + 개선안
 */
export const getScriptReviewPrompt = (narrations: string, topic: string, totalScenes: number): string => `
당신은 10년 경력의 한국 유튜브 콘텐츠 편집장입니다.
아래 "${topic}" 주제의 대본(총 ${totalScenes}개 씬)을 철저히 검수하라.

## 검수 항목
1. **중복/반복**: 같거나 비슷한 내용이 두 번 이상 나오는 씬 번호 → 삭제 또는 통합 제안
2. **시간 순서 오류**: 앞뒤 흐름이 맞지 않는 씬 → 순서 조정 또는 수정 제안
3. **재미 없는 씬**: 지루하거나 임팩트 없는 씬 → 더 자극적/감정적인 표현으로 개선
4. **훅 품질**: 첫 1~2씬이 충분히 시청자를 낚는지 → 미흡하면 더 강한 훅으로 교체
5. **마무리 품질**: 마지막 씬이 여운 있게 끝나는지 → 미흡하면 개선
6. **전체 흐름**: 감정 기복이 있는지 → 조언

## 출력 형식 (JSON)
{
  "score": 8,
  "summary": "전체 대본 평가 한 줄 요약",
  "issues": [
    {
      "type": "duplicate|sequence|boring|weak_hook|weak_ending|flow",
      "scenes": [3, 7],
      "problem": "문제 설명 (한국어)",
      "fix": "수정된 나레이션 또는 개선 방향 (한국어)"
    }
  ],
  "fixedNarrations": {
    "3": "수정된 씬 3 나레이션",
    "7": "수정된 씬 7 나레이션"
  }
}

- score: 1~10
- issues가 없으면 빈 배열 []
- fixedNarrations: 실제로 수정이 필요한 씬 번호만 포함 (수정 없으면 빈 객체 {})

## 검수할 대본
${narrations}
`;

/**
 * 바이럴 제목 + 썸네일 제안 프롬프트
 */
export const getTitleSuggestionPrompt = (narrationSummary: string, topic: string): string => `
당신은 한국 유튜브 조회수 1억+ 채널의 제목/썸네일 전문가입니다.
아래 대본 내용을 바탕으로 최대한 클릭을 유발하는 제목과 썸네일을 설계하라.

## 대본 핵심 내용
주제: ${topic}
${narrationSummary}

## 제목 작성 규칙
- 클릭 유발 키워드 활용: "충격", "실화", "모르면 손해", "역대급", "비밀", "아무도 안 알려주는"
- 숫자 포함 시 클릭률 상승: "TOP 5", "3가지", "단 1분"
- 질문형, 부정형, 숫자형 제목 혼합
- 30자 이내 (유튜브 모바일 기준)

## 출력 형식 (JSON)
{
  "titles": [
    {"title": "제목 1", "reason": "왜 클릭 유발하는지 설명"},
    {"title": "제목 2", "reason": "..."},
    {"title": "제목 3", "reason": "..."},
    {"title": "제목 4", "reason": "..."},
    {"title": "제목 5", "reason": "..."}
  ],
  "thumbnails": [
    {"keywords": "썸네일 핵심 텍스트 1~3단어", "image": "이미지 소재 설명", "emotion": "유발할 감정"},
    {"keywords": "...", "image": "...", "emotion": "..."}
  ]
}
`;
