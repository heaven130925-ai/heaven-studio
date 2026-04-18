import { Modality } from '@google/genai';
import { CONFIG } from '../config';
import { getAI, GEMINI_MODELS } from './geminiCore';

export const generateThumbnailWithText = async (
  imageBase64: string,
  titleText: string,
  ratio: '16:9' | '9:16' = '16:9'
): Promise<string | null> => {
  const ai = getAI();
  const rawBase64 = imageBase64.startsWith('data:') ? imageBase64.split(',')[1] : imageBase64;
  const models = [...GEMINI_MODELS.IMAGE_GEN_FALLBACKS];
  const orientation = ratio === '9:16' ? 'vertical YouTube Shorts thumbnail' : 'horizontal YouTube thumbnail';
  const prompt = `You are a professional YouTube thumbnail designer.

Take this image and redesign it as a ${orientation} with the following Korean title text prominently displayed:

TITLE: "${titleText}"

Design requirements:
- Place the Korean title text at the TOP of the image with large, bold, white Korean characters
- Add a strong black stroke/outline around each Korean character (at least 8px)
- Add a dark semi-transparent gradient overlay at the top (top 40% of image) so text is clearly readable
- Keep the main subject/character of the original image visible and prominent
- Make the text VERY LARGE — it should be the most visually dominant element
- Use a heavy/black weight Korean font style
- The Korean text must be perfectly legible and correctly rendered
- Professional, eye-catching YouTube thumbnail quality

Output: single edited image with the Korean title text added. No panels, no borders.`;

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: {
          parts: [
            { inlineData: { data: rawBase64, mimeType: 'image/jpeg' } },
            { text: prompt }
          ]
        },
        config: { responseModalities: [Modality.TEXT, Modality.IMAGE] }
      });
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if ((part as any).inlineData?.data) return (part as any).inlineData.data;
      }
      console.warn(`[Thumbnail] ${model} 응답에 이미지 없음`);
    } catch (e) {
      console.warn(`[Thumbnail] ${model} 실패:`, e);
    }
  }
  return null;
};

export const pickBestThumbnailScene = async (
  topic: string,
  scenes: Array<{ narration: string; imageData: string | null }>,
  count: number = 1
): Promise<number[]> => {
  const ai = getAI();
  const imagesWithIdx = scenes
    .map((s, i) => ({ i, imageData: s.imageData, narration: s.narration }))
    .filter(s => s.imageData);
  if (imagesWithIdx.length === 0) return [0];
  const needed = Math.min(count, imagesWithIdx.length);
  if (imagesWithIdx.length <= needed || !ai) {
    return imagesWithIdx.slice(0, needed).map(s => s.i);
  }
  try {
    const parts: any[] = [
      { text: `YouTube 썸네일로 클릭률이 높을 이미지 상위 ${needed}개를 선택하세요. 주제: "${topic}"\n각 이미지 인덱스(0부터)를 쉼표로 구분해 ${needed}개 숫자만 응답하세요. 예: 2,5,8` }
    ];
    imagesWithIdx.forEach(({ i, imageData, narration }) => {
      parts.push({ text: `[씬 ${i}] ${narration}` });
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: imageData! } });
    });
    const res = await ai.models.generateContent({ model: GEMINI_MODELS.TEXT, contents: [{ role: 'user', parts }] });
    const text = (res.text || '').trim();
    const parsed = text.split(/[,\s]+/).map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    const valid = parsed.filter(n => imagesWithIdx.some(s => s.i === n));
    if (valid.length >= needed) return valid.slice(0, needed);
    // 부족하면 나머지를 채움
    const fallback = imagesWithIdx.map(s => s.i).filter(i => !valid.includes(i));
    return [...valid, ...fallback].slice(0, needed);
  } catch {
    return imagesWithIdx.slice(0, needed).map(s => s.i);
  }
};

/**
 * 유튜브 썸네일 생성
 * @param topic 주제
 * @param overlayText 썸네일에 넣을 텍스트 (선택)
 */
export const generateThumbnail = async (topic: string, overlayText?: string): Promise<string | null> => {
  const ai = getAI();
  if (!ai) return null;

  const textInstruction = overlayText
    ? `썸네일 이미지 상단 또는 하단에 굵은 한국어 텍스트로 "${overlayText}"를 명확하게 표시하라.`
    : `주제를 잘 나타내는 임팩트 있는 한국어 텍스트를 썸네일에 포함하라.`;

  const prompt = `유튜브 썸네일 이미지를 생성하라. 16:9 비율 (1280x720).
주제: "${topic}"
${textInstruction}
요구사항:
- 강렬하고 눈길을 끄는 비주얼
- 밝고 대비가 강한 색상
- 텍스트는 크고 굵게, 읽기 쉽게
- 전문적인 유튜브 썸네일 스타일
- 클릭을 유도하는 감정적인 표현`;

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODELS.IMAGE_GEN,
      contents: prompt,
      config: {
        responseModalities: [Modality.IMAGE],
        imageConfig: { aspectRatio: '16:9' },
      },
    });

    const parts = response.candidates?.[0]?.content?.parts;
    if (parts) {
      for (const part of parts) {
        if ((part as any).inlineData?.data) {
          return (part as any).inlineData.data;
        }
      }
    }
    return null;
  } catch (e) {
    console.error('[Thumbnail] 생성 실패:', e);
    return null;
  }
};

// ── 썸네일 전략 분석 (3가지 방향) ────────────────────────────────────────────
export interface ThumbnailVariantStrategy {
  type: '호기심유발' | '가치제안' | '스토리감정';
  title: string;       // YouTube 제목 (A/B 테스트용)
  mainText: string;    // 썸네일 메인 문구 (10자 이내)
  subText: string;     // 썸네일 서브 문구 (15자 이내)
  imagePrompt: string; // 이미지 생성 프롬프트 (영어)
  description: string; // SEO 설명문 첫 2줄
  tags: string;        // 태그 (쉼표 구분)
}

export const analyzeThumbnailStrategy = async (params: {
  topic: string;
  characterEnabled: boolean;
  characterType: string;
  characterDetails: string;
  targetAudience: string;
}): Promise<ThumbnailVariantStrategy[] | null> => {
  const ai = getAI();
  if (!ai) return null;

  const charDesc = params.characterEnabled
    ? `등장 피사체: ${params.characterType} - ${params.characterDetails}`
    : '피사체 없음 (배경/사물 중심)';

  const prompt = `당신은 유튜브 SEO 및 썸네일 전략 전문가입니다. 다음 영상 정보를 바탕으로 YouTube A/B 테스트용 3가지 전략을 생성하세요.

영상 주제: "${params.topic}"
${charDesc}
시청 타겟: ${params.targetAudience}

3가지 전략 방향:
1. 호기심유발형: 결과가 궁금해서 클릭하게 만드는 미스터리한 접근 (의문형, 반전, 충격)
2. 가치제안형: 시청자가 얻을 수 있는 이득을 명확하게 강조 (구체적 숫자, 방법, 혜택)
3. 스토리감정형: 강렬한 감정적 후기나 서사적 긴장감 활용 (경험, 감정, 공감)

각 전략마다 다음 필드를 생성하세요:
- type: 전략 유형 (호기심유발 / 가치제안 / 스토리감정)
- title: YouTube 제목 30자 이내 한국어
- mainText: 썸네일 메인 문구 8자 이내 한국어
- subText: 썸네일 서브 문구 12자 이내 한국어
- imagePrompt: 썸네일 배경 이미지 생성용 영어 프롬프트 (텍스트 없는 배경, 고대비, YouTube 스타일, 구체적 장면)
- description: SEO 설명문 100자 이내 한국어
- tags: 관련 태그 5개 쉼표 구분 한국어`;

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODELS.TEXT,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'array' as any,
          items: {
            type: 'object' as any,
            properties: {
              type:        { type: 'string' as any },
              title:       { type: 'string' as any },
              mainText:    { type: 'string' as any },
              subText:     { type: 'string' as any },
              imagePrompt: { type: 'string' as any },
              description: { type: 'string' as any },
              tags:        { type: 'string' as any },
            },
            required: ['type', 'title', 'mainText', 'subText', 'imagePrompt', 'description', 'tags'],
          },
        },
      },
    });
    const raw = response.text || '';
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    console.error('[ThumbnailStrategy] 분석 실패:', e);
    return null;
  }
};

// ── 썸네일 V2 생성 ────────────────────────────────────────────────────────────
export const generateThumbnailV2 = async (params: {
  topic: string;
  mainText: string;
  subText: string;
  imagePrompt: string;
  borderStyle: string;
  thumbnailRatio?: '16:9' | '9:16';
  characterEnabled: boolean;
  characterType: string;
  characterDetails: string;
  targetAudience: string;
  showChannelName: boolean;
  channelName: string;
  editRequest?: string;
  model?: string;
  inputImage?: string; // base64 — 업로드된 배경 이미지 (Nano Banana에 직접 전달)
}): Promise<string | null> => {
  const ai = getAI();
  if (!ai) return null;

  const borderDesc: Record<string, string> = {
    none: '',
    solid: '테두리: 굵은 단색 테두리로 텍스트 강조.',
    neon: '테두리: 네온 글로우 효과로 텍스트 발광.',
    sketch: '테두리: 손그림/낙서 스타일 테두리.',
  };

  const charDesc = params.characterEnabled ? `등장 피사체: ${params.characterDetails} (${params.characterType})` : '';
  const channelDesc = params.showChannelName && params.channelName
    ? `채널명 "${params.channelName}"을 썸네일 하단 모서리에 작게 표시.`
    : '';
  const editDesc = params.editRequest
    ? `\n수정 요청 (아래 사항만 변경하고 나머지 구도·색상·스타일·분위기는 완전히 동일하게 유지할 것): ${params.editRequest}`
    : '';
  const ratio = params.thumbnailRatio || '16:9';
  const sizeDesc = ratio === '9:16' ? '9:16 비율 (1080×1920) 세로형 숏츠' : '16:9 비율 (1280×720) 가로형';

  // 선택된 모델이 Gemini 계열이면 그대로, 아니면 기본 이미지 모델 사용
  const thumbnailModel = (params.model && params.model.startsWith('gemini')) ? params.model : GEMINI_MODELS.IMAGE_GEN;
  const isNanoBanana = thumbnailModel.startsWith('gemini-3');

  // Nano Banana 2: 텍스트 포함 완성 썸네일 생성 (이미지 안에 텍스트 직접 렌더링)
  // 일반 Gemini: 배경만 생성 (텍스트는 Canvas 오버레이로 별도 추가)
  const prompt = isNanoBanana
    ? `Generate a complete YouTube thumbnail image. ${sizeDesc}.

Topic: "${params.topic}"
Target audience: ${params.targetAudience}
${charDesc}
${channelDesc}${editDesc}

Visual direction: ${params.imagePrompt}
${borderDesc[params.borderStyle] ? '\n' + borderDesc[params.borderStyle] : ''}

TEXT TO RENDER IN THE IMAGE (required, render clearly):
- Main title (very large, bold, top 30% of image): "${params.mainText}"
- Subtitle (medium size, below main title): "${params.subText}"

Requirements:
- Korean text must be rendered beautifully with high contrast and strong outline/shadow
- Main title: extremely large, bold, highly visible, impactful
- Strong visual impact, bright high-contrast colors, professional YouTube thumbnail style
- ONE single continuous image. No panels, no splits, no borders.`
    : `Generate a YouTube thumbnail BACKGROUND IMAGE ONLY. ${sizeDesc}.

Topic: "${params.topic}"
Target audience: ${params.targetAudience}
${charDesc}
${borderDesc[params.borderStyle] || ''}
${channelDesc}${editDesc}

Visual direction: ${params.imagePrompt}

⛔ ABSOLUTE RULES — VIOLATION = FAILURE:
1. ZERO TEXT: Do NOT render ANY text, letters, words, numbers, Korean characters, Latin characters, signs, captions, watermarks, or any written symbols ANYWHERE in the image. Text will be added as a separate overlay. Any text in the image = complete failure.
2. SINGLE FRAME: One continuous scene only. No panels, no split screens, no comic strips, no borders dividing the image.
3. BACKGROUND ONLY: Leave the upper 30% area relatively open (gradient or solid color) for text overlay placement.
4. Strong visual impact, bright high-contrast colors, professional YouTube thumbnail style.`;

  // 업로드 이미지가 있으면 이미지+텍스트 같이 전달 (Nano Banana 이미지 편집)
  const contents = (isNanoBanana && params.inputImage)
    ? { parts: [
        { inlineData: { data: params.inputImage, mimeType: 'image/jpeg' } },
        { text: `이 이미지를 기반으로 유튜브 썸네일을 만들어줘. 이미지 구도와 분위기는 최대한 유지하면서 아래 텍스트를 크고 선명하게 추가해줘.\n\n${prompt}` }
      ]}
    : prompt;

  // 시도할 모델 목록 — Nano는 단일 모델, 일반은 fallback 순서
  const modelsToTry = isNanoBanana
    ? [thumbnailModel]
    : [thumbnailModel, ...GEMINI_MODELS.IMAGE_GEN_FALLBACKS.filter(m => m !== thumbnailModel)];

  for (const model of modelsToTry) {
    const modelIsNano = model.startsWith('gemini-3');
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: modelIsNano
          ? { responseModalities: [Modality.TEXT, Modality.IMAGE] }
          : { responseModalities: [Modality.IMAGE], imageConfig: { aspectRatio: ratio === '9:16' ? '9:16' : '16:9' } },
      });
      const parts = response.candidates?.[0]?.content?.parts;
      if (parts) {
        for (const part of parts) {
          if ((part as any).inlineData?.data) return (part as any).inlineData.data;
        }
      }
      console.warn(`[ThumbnailV2] ${model} 응답에 이미지 없음`);
    } catch (e) {
      console.warn(`[ThumbnailV2] ${model} 실패:`, e);
    }
  }
  return null;
};

