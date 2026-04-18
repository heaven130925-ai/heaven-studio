
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { ScriptScene, ReferenceImages } from "../types";
import { SYSTEM_INSTRUCTIONS, getTrendSearchPrompt, getScriptGenerationPrompt, getFinalVisualPrompt, getScriptReviewPrompt, getTitleSuggestionPrompt } from "./prompts";
import { CONFIG, GEMINI_STYLE_CATEGORIES, GeminiStyleId, VISUAL_STYLES } from "../config";
import { faceSwapCharacter } from "./falService";
import { getVoiceSetting } from "../utils/voiceStorage";
import { generateGCloudTTS } from "./googleCloudTTSService";
import { getAI, getGeminiApiKey, wait, cleanJsonResponse, cleanNarration, sanitizePrompt, retryGeminiRequest, KEYWORD_ALTERNATIVES, GEMINI_MODELS } from "./geminiCore";


// ── Image generation internal helpers ──
const stylePreviewCache: Record<string, string> = {};

const fetchStylePreviewBase64 = async (imgPath: string): Promise<string | null> => {
  if (stylePreviewCache[imgPath]) return stylePreviewCache[imgPath];
  try {
    const resp = await fetch(imgPath);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = (reader.result as string).split(',')[1];
        stylePreviewCache[imgPath] = b64;
        resolve(b64);
      };
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};

const getSelectedGeminiStylePrompt = (): string => {
  // 비주얼 스타일 빠른 선택기 우선 적용
  const visualStyleId = localStorage.getItem(CONFIG.STORAGE_KEYS.VISUAL_STYLE_ID);
  if (visualStyleId && visualStyleId !== 'none') {
    const found = (VISUAL_STYLES as readonly { id: string; prompt: string }[]).find(s => s.id === visualStyleId);
    if (found) return found.prompt;
  }

  const styleId = localStorage.getItem(CONFIG.STORAGE_KEYS.GEMINI_STYLE) as GeminiStyleId || 'gemini-none';

  // 화풍 없음 선택
  if (styleId === 'gemini-none') {
    return '';
  }

  // 커스텀 스타일인 경우
  if (styleId === 'gemini-custom') {
    const customPrompt = localStorage.getItem(CONFIG.STORAGE_KEYS.GEMINI_CUSTOM_STYLE) || '';
    return customPrompt.trim();
  }

  // 프리셋 스타일 찾기
  for (const category of GEMINI_STYLE_CATEGORIES) {
    const style = category.styles.find(s => s.id === styleId);
    if (style) {
      return style.prompt;
    }
  }

  return '';
};

/**
 * 강도(0-100)를 언어적 표현으로 변환
 * @param strength - 강도 값 (0~100)
 * @returns 강도에 따른 언어적 표현
 */
const getStrengthDescription = (strength: number): { level: string; instruction: string } => {
  if (strength <= 20) {
    return {
      level: 'very loosely',
      instruction: 'Use as a very loose inspiration only. Feel free to deviate significantly.'
    };
  } else if (strength <= 40) {
    return {
      level: 'loosely',
      instruction: 'Use as a loose reference. Capture the general feel but allow creative interpretation.'
    };
  } else if (strength <= 60) {
    return {
      level: 'moderately',
      instruction: 'Follow the reference moderately. Balance between reference and scene requirements.'
    };
  } else if (strength <= 80) {
    return {
      level: 'closely',
      instruction: 'Follow the reference closely. Maintain strong similarity while adapting to the scene.'
    };
  } else {
    return {
      level: 'exactly',
      instruction: 'Match the reference as exactly as possible. Replicate with high precision.'
    };
  }
};

/**
 * Imagen 3으로 이미지 생성
 * - 참조 이미지 미지원 → 텍스트 프롬프트만 사용
 * - 텍스트 규칙 준수율이 Gemini보다 훨씬 높음
 */
const generateImageWithImagen3 = async (
  prompt: string,
  modelId: string = 'imagen-3.0-fast-generate-001',
  negativePrompt?: string
): Promise<string | null> => {
  return retryGeminiRequest("Imagen3 Generation", async () => {
    const ai = getAI();
    const ar = localStorage.getItem('heaven_aspect_ratio') || '16:9';
    const config: Record<string, any> = {
      numberOfImages: 1,
      aspectRatio: ar,
      outputMimeType: 'image/jpeg',
    };
    if (negativePrompt) config.negativePrompt = negativePrompt;
    const response = await (ai.models as any).generateImages({
      model: modelId,
      prompt,
      config,
    });
    const imageBytes = response?.generatedImages?.[0]?.image?.imageBytes;
    if (!imageBytes) return null;
    return imageBytes; // base64
  }, 2, 3000);
};

/**
 * 참조 이미지(캐릭터)에서 Gemini Vision으로 특징 텍스트 자동 추출
 * - 업로드 시 1회 실행, 이후 매 씬 생성에 재사용
 * @param imageBase64 - base64 이미지 (data:URL 또는 raw base64)
 * @returns 영어로 된 상세 캐릭터 묘사 텍스트
 */

// ── TTS internal helpers ──

/**
 * 긴 텍스트를 400자 단위로 자연스럽게 분할
 * - 문장 끝(. ? ! 。)에서 우선 분할
 * - 없으면 쉼표, 공백 순으로 분할
 */
function splitTtsText(text: string, maxChars: number = 400): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxChars) {
    let breakIdx = -1;
    const min = Math.floor(maxChars * 0.88);

    // 1순위: 문장 끝 기호
    for (let i = maxChars; i >= min; i--) {
      const c = remaining[i];
      if (c === '.' || c === '?' || c === '!' || c === '。' || c === '\n') {
        breakIdx = i + 1;
        break;
      }
    }
    // 2순위: 쉼표 / 공백
    if (breakIdx === -1) {
      for (let i = maxChars; i >= min; i--) {
        const c = remaining[i];
        if (c === ',' || c === '，' || c === ' ') {
          breakIdx = i + 1;
          break;
        }
      }
    }
    // 3순위: 강제 분할
    if (breakIdx === -1) breakIdx = maxChars;

    const chunk = remaining.slice(0, breakIdx).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(breakIdx).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

/**
 * PCM16 base64 끝에 무음 추가 (Gemini TTS 마지막 음절 클리핑 방지)
 * - 24kHz mono Int16 기준
 */
function appendPcmSilence(pcmBase64: string, durationSeconds: number = 0.6): string {
  const silenceBytes = new Uint8Array(Math.round(24000 * durationSeconds) * 2); // zero = silence
  const existing = Uint8Array.from(atob(pcmBase64), c => c.charCodeAt(0));
  const combined = new Uint8Array(existing.length + silenceBytes.length);
  combined.set(existing, 0);
  combined.set(silenceBytes, existing.length);
  let binary = '';
  for (let i = 0; i < combined.length; i += 65536) {
    binary += String.fromCharCode(...combined.subarray(i, i + 65536));
  }
  return btoa(binary);
}

/**
 * 여러 base64 PCM 오디오 청크를 하나로 이어붙이기
 * Gemini TTS 반환값은 raw Int16 PCM이므로 바이트 단순 연결로 충분
 */
function concatenatePcmBase64(chunks: string[]): string {
  const arrays = chunks.map(b64 => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  });

  const total = arrays.reduce((s, a) => s + a.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) { merged.set(arr, offset); offset += arr.length; }

  let binary = '';
  // 64KB씩 처리해서 call stack 초과 방지
  for (let i = 0; i < merged.length; i += 65536) {
    binary += String.fromCharCode(...merged.subarray(i, i + 65536));
  }
  return btoa(binary);
}

/**
 * TTS 설정을 한 곳에서 읽어 일관성 보장
 */
function getTtsConfig() {
  // 음성 설정은 sessionStorage에서 읽음 (창별 독립)
  const voiceName  = getVoiceSetting(CONFIG.STORAGE_KEYS.GEMINI_TTS_VOICE) || CONFIG.DEFAULT_GEMINI_TTS_VOICE;
  const voiceSpeed = getVoiceSetting(CONFIG.STORAGE_KEYS.VOICE_SPEED) || '1.0';
  const tone       = getVoiceSetting('heaven_google_tts_tone') || '';
  const mood       = getVoiceSetting('heaven_google_tts_mood') || '';

  // 속도 지시를 systemInstruction으로 전달 → 청크 전체에 일관 적용
  const speedInstruction =
    voiceSpeed === '0.7' ? 'Speak slowly and clearly. Maintain consistent pace throughout.' :
    voiceSpeed === '1.3' ? 'Speak quickly and energetically. Maintain consistent pace throughout.' :
                           'Speak at a natural, steady pace. Maintain consistent pace throughout.';

  const systemInstruction = [speedInstruction, tone, mood].filter(Boolean).join(' ');
  return { voiceName, systemInstruction };
}

/**
 * TTS 단일 청크 생성 (내부용) — 모델 폴백 포함
 */
async function generateTtsChunk(text: string): Promise<string> {
  const { voiceName, systemInstruction } = getTtsConfig();
  const models = [...GEMINI_MODELS.TTS_FALLBACKS];
  let lastError: any;
  for (const model of models) {
    try {
      // TTS는 429 재시도 금지 — 재시도할수록 일일 한도(100회)를 낭비함
      // maxRetries=1 = 단 1회 시도만
      return await retryGeminiRequest("TTS Generation", async () => {
        const ai = getAI();
        const response = await ai.models.generateContent({
          model,
          contents: { parts: [{ text }] },
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
            systemInstruction,
          }
        });
        const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!data) throw new Error('TTS returned empty audio');
        return data;
      }, 1); // maxRetries=1 → 429 시 즉시 포기 (한도 낭비 방지)
    } catch (e: any) {
      lastError = e;
      const msg = e?.message || JSON.stringify(e);
      const isQuota = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota');
      const isServerError = msg.includes('500') || msg.includes('INTERNAL') || msg.includes('503') || msg.includes('UNAVAILABLE');
      if (isQuota) {
        throw new Error(`Gemini TTS 일일 한도(100회) 초과 — 내일 다시 시도하거나 설정에서 다른 TTS(Azure/Google Cloud)로 전환하세요.`);
      }
      if (isServerError) {
        // 500/503: 구글 서버 일시 장애 — 3초 대기 후 같은 모델 1회 재시도
        console.warn(`[TTS] ${model} 서버 오류 — 3초 후 재시도`);
        await new Promise(r => setTimeout(r, 3000));
        try {
          const ai = getAI();
          const response = await ai.models.generateContent({
            model,
            contents: { parts: [{ text }] },
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
              systemInstruction,
            }
          });
          const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
          if (data) return data;
        } catch (e2: any) {
          lastError = new Error(`[${model}] ${e2?.message || e2}`);
          console.warn(`[TTS] ${model} 재시도도 실패:`, e2?.message);
        }
      }
      lastError = new Error(`[${model}] ${msg}`);
      console.warn(`[TTS] ${model} 실패:`, msg);
    }
  }
  throw lastError ?? new Error('모든 Gemini TTS 모델 실패 — API 키와 모델 접근 권한을 확인하세요');
}

/**
 * Google TTS 미리듣기 (특정 음성명으로 단일 생성)
 */

// Re-exports from domain service files
export * from './scriptService';
export * from './thumbnailService';

export const analyzeCharacterReference = async (imageBase64: string): Promise<string> => {
  try {
    const ai = getAI();
    const imageData = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;

    const response = await ai.models.generateContent({
      model: GEMINI_MODELS.TEXT,
      contents: {
        parts: [
          {
            text: `You are analyzing a character reference image to extract a STRICT CONSISTENCY BLUEPRINT for AI image generation.

Output in this EXACT format (no intro, no extra text):

FACE_SHAPE: [e.g., "oval face, defined jawline, high cheekbones"]
SKIN_TONE: [e.g., "warm medium beige, peachy undertone"]
EYES: [color + shape, e.g., "almond-shaped dark brown eyes, thick natural lashes, double eyelids"]
EYEBROWS: [e.g., "straight thick black eyebrows, natural arch"]
NOSE: [e.g., "small button nose, slightly upturned tip"]
LIPS: [e.g., "full lips, natural pink, slightly curved upper lip"]
HAIR_COLOR: [exact color, e.g., "jet black with subtle blue sheen"]
HAIR_STYLE: [e.g., "shoulder-length straight bob, blunt cut bangs"]
BODY_TYPE: [e.g., "slim petite build, small shoulders"]
SIGNATURE_FEATURES: [2-3 most distinctive features that make this character unique, e.g., "very large expressive eyes, small face, cute dimples when smiling"]
CLOTHING: [if identifiable, e.g., "white sailor school uniform with blue trim, red bow tie"]
OVERALL_VIBE: [one sentence capturing the character's essence, e.g., "A cute young Korean female character with large innocent eyes and a gentle expression"]

Be extremely precise. These features will be enforced rigidly across all generated images.`
          },
          { inlineData: { data: imageData, mimeType: 'image/jpeg' } }
        ]
      }
    });

    const description = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    console.log(`[Character Analysis] 추출 완료 (${description.length}자):`, description.slice(0, 150) + '...');
    return description;
  } catch (e) {
    console.warn('[Character Analysis] 분석 실패:', e);
    return '';
  }
};

/**
 * 씬에 대한 이미지 생성 (Gemini 사용)
 * @param scene - 씬 데이터
 * @param referenceImages - 분리된 참조 이미지 (캐릭터/스타일 + 강도)
 */
export const generateImageForScene = async (
  scene: ScriptScene,
  referenceImages: ReferenceImages
): Promise<string | null> => {
  // 캐릭터 참조 이미지가 있으면 고정 프롬프트 제외
  const hasCharacterRef = referenceImages.character && referenceImages.character.length > 0;
  const hasStyleRef = referenceImages.style && referenceImages.style.length > 0;


  // 선택된 이미지 모델 확인
  const selectedModel = localStorage.getItem(CONFIG.STORAGE_KEYS.IMAGE_MODEL) || CONFIG.DEFAULT_IMAGE_MODEL;
  const isImagen3 = selectedModel.startsWith('imagen-3');
  const isImagen4 = selectedModel.startsWith('imagen-4');
  const isImagenModel = isImagen3 || isImagen4;
  // Nano Banana 모델 (gemini-3-pro-image-preview, gemini-3.1-flash-image-preview)은 Gemini 경로 사용
  const isNanoBanana = selectedModel.startsWith('gemini-3');
  // 실제 Gemini 이미지 모델 ID 결정 (Nano Banana 선택 시 해당 모델 직접 사용)
  const geminiImageModel = isNanoBanana ? selectedModel : GEMINI_MODELS.IMAGE_GEN;

  const ar = localStorage.getItem(CONFIG.STORAGE_KEYS.ASPECT_RATIO) || '16:9';

  // Imagen 3/4 선택 시
  // 캐릭터 참조가 있으면 Imagen은 이미지 입력 불가 → Gemini Flash Image로 처리 (시각적 참조 필수)
  // 캐릭터 참조가 없으면 Imagen 직접 사용
  if (isImagenModel && !hasCharacterRef) {
    const textMode = localStorage.getItem(CONFIG.STORAGE_KEYS.IMAGE_TEXT_MODE) || 'none';
    const prompt = getFinalVisualPrompt(scene, false, getSelectedGeminiStylePrompt(), textMode, ar);
    console.log(`[Image Gen] Imagen 사용 (참조 없음): ${selectedModel}, 비율: ${ar}`);
    try {
      const negPrompt = textMode === 'none'
        ? 'text, letters, words, alphabet, numbers, signs, watermark, captions, labels, writing, typography, subtitles, overlay text'
        : undefined;
      const result = await generateImageWithImagen3(prompt, selectedModel, negPrompt);
      if (result) return result;
    } catch (e: any) {
      const msg = e?.message || '';
      const isPermissionError = msg.includes('403') || msg.includes('permission') || msg.includes('billing') || msg.includes('quota') || msg.includes('not found') || msg.includes('PERMISSION_DENIED') || msg.includes('serviceDisabled');
      if (isPermissionError) {
        console.warn(`[Image Gen] Imagen 권한 없음 → Gemini 2.5 Flash로 폴백`);
      } else {
        throw e;
      }
    }
    // Gemini Flash로 폴백
  }

  if (isImagenModel && hasCharacterRef) {
    console.log(`[Image Gen] Imagen 선택이지만 캐릭터 참조 있음 → Gemini Flash Image로 전환 (시각적 참조 필수)`);
  }

  // 스타일 참조 이미지가 없을 때만 선택된 화풍 적용 (스타일 참조 우선)
  // 화풍 프롬프트를 캐릭터에도 적용하기 위해 getFinalVisualPrompt에 전달
  const geminiStylePrompt = hasStyleRef ? undefined : getSelectedGeminiStylePrompt();
  const textMode = localStorage.getItem(CONFIG.STORAGE_KEYS.IMAGE_TEXT_MODE) || 'none';
  const basePrompt = getFinalVisualPrompt(scene, hasCharacterRef, geminiStylePrompt, textMode, ar);

  if (geminiStylePrompt) {
    console.log(`[Image Gen] 화풍이 캐릭터에 적용됨: ${geminiStylePrompt.slice(0, 50)}...`);
  }

  // 강도 정보 가져오기
  const characterStrength = referenceImages.characterStrength ?? 70;
  const styleStrength = referenceImages.styleStrength ?? 70;

  console.log(`[Image Gen] 캐릭터 강도: ${characterStrength}%, 스타일 강도: ${styleStrength}%`);

  // 비주얼 스타일 프리뷰 이미지 사전 로드 (AI 시각 참조용)
  const visualStyleId = localStorage.getItem(CONFIG.STORAGE_KEYS.VISUAL_STYLE_ID);
  const activeVisualStyle = (visualStyleId && visualStyleId !== 'none')
    ? (VISUAL_STYLES as readonly { id: string; prompt: string; name: string; img: string }[]).find(s => s.id === visualStyleId) ?? null
    : null;
  let stylePreviewBase64: string | null = null;
  if (activeVisualStyle?.img && !hasStyleRef) {
    stylePreviewBase64 = await fetchStylePreviewBase64(activeVisualStyle.img);
    if (stylePreviewBase64) console.log(`[Image Gen] 비주얼 스타일 프리뷰 이미지 로드 성공: ${activeVisualStyle.id}`);
  }

  const MAX_SANITIZE_ATTEMPTS = 3; // 대체어 시도 횟수
  let lastError: any;

  for (let sanitizeAttempt = 0; sanitizeAttempt < MAX_SANITIZE_ATTEMPTS; sanitizeAttempt++) {
    // 시도마다 다른 대체어 적용
    const sanitizedPrompt = sanitizeAttempt === 0
      ? basePrompt
      : sanitizePrompt(basePrompt, sanitizeAttempt - 1);

    if (sanitizeAttempt > 0) {
      console.log(`[Image Gen] 키워드 대체 시도 ${sanitizeAttempt}: 프롬프트 수정됨`);
    }

    try {
      const result = await retryGeminiRequest("Pro Image Generation", async () => {
        const ai = new GoogleGenAI({ apiKey: getGeminiApiKey() });
        const parts: any[] = [];
        const charTextDesc = referenceImages.characterDescription?.trim();

        // ── 절대 금지 규칙 (항상 첫 번째 part로 배치) ──────────────────
        const textModeRule = textMode === 'none'
          ? `⛔ RULE: ZERO TEXT — No text, letters, words, numbers, signs, labels, captions, or written characters of ANY kind anywhere in the image. Pure visual scene only. Including ANY text = CRITICAL FAILURE.`
          : textMode === 'numbers'
          ? `⚠️ RULE: Only Arabic numerals (0-9) allowed. No words, no letters.`
          : textMode === 'english'
          ? `⚠️ RULE: Only Latin/English characters allowed. No Korean (한글), no Chinese, no Japanese.`
          : textMode === 'korean'
          ? `⚠️ RULE: Korean (한글) ONLY if text appears. Keep text MINIMAL — 1 short word max. Scene must be primarily visual, NOT text-heavy.`
          : '';
        const absoluteRules = [
          `⛔ RULE #1 — ONE SINGLE IMAGE ONLY: Generate exactly ONE continuous, unified image filling the entire canvas.`,
          `FORBIDDEN FOREVER: panels, comic strips, split screens, grids, multiple cuts, storyboard layouts, borders/lines dividing the image, before/after comparisons, side-by-side images, triptychs, diptychs, collages. Any form of image division = INSTANT FAILURE.`,
          textModeRule,
        ].filter(Boolean).join('\n');
        parts.push({ text: absoluteRules });

        if (hasCharacterRef) {
          // ─── 캐릭터 일관성 모드 ───
          // 씬 프롬프트에서 캐릭터 외모 묘사 제거 (참조 이미지 우선)
          const sceneSentiment = (scene.analysis as any)?.sentiment || 'NEUTRAL';
          const expressionInstruction = sceneSentiment === 'NEGATIVE'
            ? `⚠️ MANDATORY EXPRESSION: The character must look SAD, WORRIED, DISTRESSED, or TROUBLED — absolutely NO smiling, NO happy face. The narration is negative/painful. Forced smiling = CRITICAL FAILURE.`
            : sceneSentiment === 'POSITIVE'
            ? `⚠️ MANDATORY EXPRESSION: Character looks HAPPY, CONFIDENT, or RELIEVED — positive expression matching the upbeat narration.`
            : `⚠️ MANDATORY EXPRESSION: Character looks NEUTRAL, THOUGHTFUL, or FOCUSED — calm, serious face matching the informational tone.`;
          // 나레이션을 primary anchor로 사용 — visualPrompt가 틀려도 나레이션으로 보정
          const narAnchor = scene.narration
            ? `⚑ SCENE CONTENT (what this image MUST depict — mandatory): "${scene.narration.slice(0, 200)}"`
            : '';
          const rawVisual = (scene.visualPrompt || sanitizedPrompt).slice(0, 300);
          // 외모 묘사 키워드가 있으면 THE CHARACTER로 대체
          const cleanedVisual = rawVisual
            .replace(/\b(young|old|elderly|woman|man|girl|boy|female|male|person)\s+(with|having|wearing)\s+[^,.]+/gi, 'THE CHARACTER')
            .replace(/\b(blonde|brunette|redhead|black-haired|white-haired|bald)\b/gi, '')
            .replace(/\b(tall|short|slim|fat|chubby|muscular|petite)\b/gi, '')
            .trim();
          const sceneAction = [narAnchor, cleanedVisual ? `Visual guide: ${cleanedVisual}` : ''].filter(Boolean).join('\n');

          const selectedVisualStyle = (() => {
            const vid = localStorage.getItem(CONFIG.STORAGE_KEYS.VISUAL_STYLE_ID);
            if (!vid || vid === 'none') return null;
            return (VISUAL_STYLES as readonly { id: string; prompt: string; name: string }[]).find(s => s.id === vid) ?? null;
          })();

          const styleHint = (() => {
            if (hasStyleRef) return '';
            const sp = getSelectedGeminiStylePrompt();
            return sp ? `\nArt style: ${sp}` : '';
          })();

          // 참조 이미지 나열
          referenceImages.character.forEach((img, idx) => {
            const imageData = img.includes(',') ? img.split(',')[1] : img;
            parts.push({
              text: idx === 0
                ? `This is the character reference image. Study this character's appearance carefully.`
                : `Same character, additional angle:`
            });
            parts.push({ inlineData: { data: imageData, mimeType: 'image/jpeg' } });
          });

          if (selectedVisualStyle) {
            // ─── 비주얼 스타일 선택 시: 스타일 프리뷰 이미지 + 캐릭터 참조 ───
            if (stylePreviewBase64) {
              parts.push({ text: `[TARGET ART STYLE — This is what every image MUST look like]:` });
              parts.push({ inlineData: { data: stylePreviewBase64, mimeType: 'image/jpeg' } });
            }
            parts.push({
              text: `⚠️ DUAL LOCK: CHARACTER IDENTITY + ART STYLE — both must be maintained perfectly.

━━━ CHARACTER IDENTITY (NON-NEGOTIABLE) ━━━
Reproduce the EXACT character from the character reference image(s).
${charTextDesc ? charTextDesc : `Same face, same hair color/style, same proportions — zero deviation.`}
The character must be INSTANTLY RECOGNIZABLE across all scenes.

━━━ ART STYLE (NON-NEGOTIABLE) ━━━
Render EVERYTHING in the exact art style shown in the style reference image above.
Style: ${selectedVisualStyle.prompt}

━━━ HOW TO BALANCE BOTH ━━━
→ Keep the character's IDENTITY (face shape, hair, features)
→ But TRANSLATE their appearance INTO the target art style
→ The character should look like they were originally drawn in this art style

━━━ SCENE ━━━
${sceneAction}

${expressionInstruction}`
            });
          } else {
            parts.push({
              text: `⛔ CHARACTER CONSISTENCY — ABSOLUTE TOP PRIORITY (overrides everything else)

The reference image(s) show the character type/species for this scene.
ALL characters in this scene — including secondary characters — MUST be the SAME species/type as the reference.
If the reference shows a gorilla, ALL characters must be gorillas. NEVER substitute humans or other animals.
⛔ HYBRID FORBIDDEN: NEVER put an animal head on a human body. NEVER create animal-human hybrids.
The ENTIRE body — head, torso, limbs — must match the reference species exactly.
You MUST reproduce this EXACT character. No exceptions. No creative liberties.

━━━ IDENTITY LOCK — COPY EXACTLY ━━━
${charTextDesc ? charTextDesc : `• Face shape, eyes, nose, lips: IDENTICAL to reference
• Hair: EXACT same color, length, texture, style — zero change
• Skin tone: EXACT same as reference
• Body proportions: SAME as reference`}

━━━ MANDATORY CHECKS ━━━
✅ Face: same shape, same eyes, same nose, same lips
✅ Hair: IDENTICAL color and style — if reference has black hair, black hair ONLY
✅ Skin tone: exact match to reference
✅ If someone would look at this image and the reference and say "same person" = SUCCESS
✅ If they would say "different person" = FAILURE — regenerate

❌ ABSOLUTE FAILURES (reject and regenerate):
• Hair color changed (e.g., reference: black → output: brown/blonde = FAILURE)
• Face looks like a different person
• Added/removed facial features
• Different body type or proportions
• Generic face not matching reference

━━━ SCENE (secondary to character identity) ━━━
${sceneAction}

${expressionInstruction}
${styleHint}`
            });
          }

        } else {
          // ─── 일반 모드 ───
          if (hasStyleRef) {
            const styleDesc = getStrengthDescription(styleStrength);
            parts.push({
              text: `[STYLE REFERENCE - Strength: ${styleStrength}%]
Match this art style ${styleDesc.level}.
${styleDesc.instruction}`
            });
            referenceImages.style.forEach(img => {
              const imageData = img.includes(',') ? img.split(',')[1] : img;
              parts.push({ inlineData: { data: imageData, mimeType: 'image/jpeg' } });
            });
          } else if (stylePreviewBase64 && activeVisualStyle) {
            // ─── 비주얼 스타일 프리뷰 이미지로 직접 참조 ───
            parts.push({ text: `[STYLE REFERENCE IMAGE — TOP PRIORITY]\nThis image shows the EXACT art style you MUST use. Match this style precisely for every scene.` });
            parts.push({ inlineData: { data: stylePreviewBase64, mimeType: 'image/jpeg' } });
            parts.push({ text: `Apply the art style from the reference image above. Additional style description: ${activeVisualStyle.prompt}` });
          } else {
            const geminiStylePrompt = getSelectedGeminiStylePrompt();
            if (geminiStylePrompt) {
              parts.push({ text: `[ART STYLE INSTRUCTION]\nApply this art style: ${geminiStylePrompt}` });
            }
          }
          // 나레이션을 primary anchor로 포함 — visualPrompt가 틀려도 나레이션으로 보정
          const narText = scene.narration
            ? `\n⚑ MANDATORY SCENE CONTENT (this narration MUST be depicted): "${scene.narration.slice(0, 200)}"\nIf the scene prompt conflicts with this narration, the narration takes absolute priority.`
            : '';
          parts.push({ text: `[SCENE PROMPT]\n${sanitizedPrompt}${narText}` });
        }

        // ── 마지막에도 이중 강제 ─────────────────────────────────────────
        parts.push({
          text: [
            `⛔ FINAL OVERRIDE — SINGLE FRAME: ONE image, ONE scene. NO panels. NO splits. NO borders.`,
            hasCharacterRef ? `⛔ FINAL CHARACTER CHECK: The character MUST be the exact same person from the reference. Same hair color, same face, same features. If it looks like a different person = FAILURE.` : '',
            textMode === 'none'    ? `⛔ FINAL OVERRIDE — ZERO TEXT: Absolutely no text, letters, numbers, or signs in the image.` : '',
            textMode === 'numbers' ? `⚠️ FINAL: Only digits (0-9). No letters, no words.` : '',
            textMode === 'english' ? `⚠️ FINAL: Only Latin/English. No Korean, no Chinese, no Japanese.` : '',
            textMode === 'korean'  ? `⚠️ FINAL: Only Korean (한글). No English, no Latin, no Chinese, no Japanese.` : '',
          ].filter(Boolean).join('\n')
        });

        const response = await ai.models.generateContent({
          model: geminiImageModel,
          contents: { parts },
          config: {
            responseModalities: [Modality.IMAGE],
            imageConfig: {
              aspectRatio: ar
            }
          }
        });

        for (const part of (response.candidates?.[0]?.content?.parts || [])) {
          if (part.inlineData) return part.inlineData.data;
        }
        return null;
      }, 2, 3000); // 각 대체어당 2회 재시도

      if (result) {
        // 캐릭터 참조가 있고 FAL 키가 있으면 face swap으로 얼굴 일관성 보장
        if (hasCharacterRef) {
          const faceRefRaw = referenceImages.character[0];
          const faceRef = faceRefRaw.includes(',') ? faceRefRaw.split(',')[1] : faceRefRaw;
          const swapped = await faceSwapCharacter(result, faceRef);
          if (swapped) {
            console.log('[Image Gen] Face swap 적용 완료');
            return swapped;
          }
          console.log('[Image Gen] Face swap 실패 또는 FAL 키 없음 → 원본 반환');
        }
        return result;
      }
    } catch (error: any) {
      lastError = error;
      const errorMsg = error.message || JSON.stringify(error);

      // 안전 필터/콘텐츠 정책 관련 에러인지 확인
      const isSafetyError =
        errorMsg.includes('safety') ||
        errorMsg.includes('blocked') ||
        errorMsg.includes('policy') ||
        errorMsg.includes('content') ||
        errorMsg.includes('SAFETY') ||
        errorMsg.includes('harmful') ||
        error.status === 400;

      if (isSafetyError && sanitizeAttempt < MAX_SANITIZE_ATTEMPTS - 1) {
        console.log(`[Image Gen] 안전 필터 감지됨. 대체 키워드로 재시도...`);
        await wait(1000);
        continue; // 다음 대체어로 재시도
      }

      // 안전 필터 에러가 아니거나 모든 대체어 소진 시 에러 throw
      throw error;
    }
  }

  throw lastError || new Error('이미지 생성 실패: 모든 대체어 시도 실패');
};

/**
 * 기존 이미지 + 편집 명령으로 이미지 수정 (image-in → image-out)
 * - 원본 이미지를 Gemini에 직접 전달하여 지정된 부분만 수정
 */
export const editImageWithGemini = async (imageBase64: string, command: string): Promise<string | null> => {
  const ai = getAI();
  // 이미지 편집: image input + image output 지원 모델 순서대로 시도
  // gemini-2.0-flash-exp는 2026년 삭제됨 → 대체 모델 사용
  const editModels = [...GEMINI_MODELS.IMAGE_GEN_FALLBACKS];
  let lastError: any;

  // base64에 data: prefix가 있으면 제거
  const rawBase64 = imageBase64.startsWith('data:') ? imageBase64.split(',')[1] : imageBase64;

  for (const editModel of editModels) {
    try {
      const response = await ai.models.generateContent({
        model: editModel,
        contents: {
          parts: [
            { inlineData: { data: rawBase64, mimeType: 'image/jpeg' } },
            {
              text: [
                `You are an image editor. Edit this exact image by applying ONLY the instruction below.`,
                `Keep EVERYTHING ELSE identical — same composition, characters, poses, background, colors, art style, lighting.`,
                `Do NOT redraw or regenerate. Do NOT change anything not mentioned in the instruction.`,
                ``,
                `INSTRUCTION: ${command}`,
                ``,
                `Output: one single edited image. No panels, no split screens, no borders, no before/after comparison.`,
              ].join('\n')
            }
          ]
        },
        config: {
          responseModalities: [Modality.TEXT, Modality.IMAGE],
        }
      });
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if ((part as any).inlineData?.data) return (part as any).inlineData.data;
      }
      console.warn(`[Image Edit] ${editModel} 응답에 이미지 없음:`, parts.map(p => Object.keys(p)));
    } catch (e) {
      console.warn(`[Image Edit] ${editModel} 실패, 다음 모델 시도:`, e);
      lastError = e;
    }
  }
  // 모든 모델 실패 시 에러 던지기 (호출부에서 사용자에게 표시)
  throw lastError || new Error('이미지 편집 실패: 모든 모델에서 이미지를 반환하지 않았습니다');
};

/**
 * 유튜브 썸네일: 씬 이미지 위에 AI가 직접 제목 텍스트를 합성
 * - editImageWithGemini와 달리 "기존 유지" 제약 없음 → 더 자유로운 텍스트 합성 가능
 */
export const generateGeminiTtsPreview = async (text: string, voiceName: string): Promise<string | null> => {
  return retryGeminiRequest("TTS Preview", async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: GEMINI_MODELS.TTS,
      contents: { parts: [{ text }] },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
      }
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
  });
};

/**
 * PCM base64 오디오를 비율 배열에 따라 분할
 * - PCM Int16 (24kHz mono) → 2바이트 정렬 보장
 */
const splitPcmBase64ByRatios = (pcmBase64: string, ratios: number[]): string[] => {
  const binStr = atob(pcmBase64);
  const total = binStr.length;
  const bytes = new Uint8Array(total);
  for (let i = 0; i < total; i++) bytes[i] = binStr.charCodeAt(i);

  const result: string[] = [];
  let offset = 0;

  for (let i = 0; i < ratios.length; i++) {
    const isLast = i === ratios.length - 1;
    let byteCount = isLast ? (total - offset) : Math.floor(total * ratios[i]);
    if (byteCount % 2 !== 0) byteCount++;
    if (offset + byteCount > total) byteCount = total - offset;
    if (byteCount <= 0) { result.push(''); continue; }

    const chunk = bytes.slice(offset, offset + byteCount);
    offset += byteCount;

    let binary = '';
    for (let j = 0; j < chunk.length; j += 65536) {
      binary += String.fromCharCode(...chunk.subarray(j, j + 65536));
    }
    result.push(btoa(binary));
  }

  return result;
};

/**
 * 전체 씬 나레이션을 하나의 TTS 세션으로 생성 (목소리 일관성 보장)
 * - 모든 씬 나레이션을 연결 → 500자 청크로 분할 → 연속 생성 → 씬별 비율 분할
 */

/**
 * 씬 나레이션 TTS 생성
 * - 400자 초과 시 청크 분할 후 이어붙이기
 */
export const generateAudioForScene = async (text: string): Promise<string | null> => {
  const provider = getVoiceSetting(CONFIG.STORAGE_KEYS.TTS_PROVIDER) || 'google';

  // Azure TTS 경로 (Neural — MP3 반환, 월 50만자 무료)
  if (provider === 'azure') {
    const apiKey = localStorage.getItem(CONFIG.STORAGE_KEYS.AZURE_TTS_API_KEY) || '';
    if (!apiKey) {
      console.warn('[TTS] Azure API 키 없음 → Gemini TTS 폴백');
    } else {
      try {
        const { generateAzureTTS } = await import('./azureTTSService');
        const chunks = splitTtsText(text, 4500);
        if (chunks.length === 1) return await generateAzureTTS(chunks[0]);
        const parts: string[] = [];
        for (const chunk of chunks) {
          const b64 = await generateAzureTTS(chunk);
          if (b64) parts.push(b64);
        }
        if (parts.length === 0) return null;
        if (parts.length === 1) return parts[0];
        const buffers = parts.map(b => Uint8Array.from(atob(b), c => c.charCodeAt(0)));
        const total = buffers.reduce((sum, b) => sum + b.length, 0);
        const merged = new Uint8Array(total);
        let off = 0;
        for (const buf of buffers) { merged.set(buf, off); off += buf.length; }
        let binary = '';
        for (let i = 0; i < merged.length; i += 65536) {
          binary += String.fromCharCode(...merged.subarray(i, i + 65536));
        }
        return btoa(binary);
      } catch (e) {
        console.warn('[TTS] Azure 실패 → Gemini TTS 폴백:', e);
      }
    }
  }

  // Google Cloud TTS 경로 (Neural2/Wavenet — MP3 반환, 한도 없음)
  if (provider === 'gcloud') {
    const apiKey = localStorage.getItem(CONFIG.STORAGE_KEYS.GCLOUD_TTS_API_KEY) || '';
    if (!apiKey) {
      console.warn('[TTS] gcloud API 키 없음 → Gemini TTS 폴백');
      // 아래 Gemini TTS 경로로 fall-through
    } else {
      try {
        const chunks = splitTtsText(text, 4500);
        if (chunks.length === 1) return await generateGCloudTTS(chunks[0]);
        // 청크별 MP3 생성 후 바이너리 이어붙이기 (MP3는 단순 concat 가능)
        const parts: string[] = [];
        for (const chunk of chunks) {
          const b64 = await generateGCloudTTS(chunk);
          if (b64) parts.push(b64);
        }
        if (parts.length === 0) return null;
        if (parts.length === 1) return parts[0];
        // base64 디코드 → 바이너리 합치기 → 다시 base64
        const buffers = parts.map(b => Uint8Array.from(atob(b), c => c.charCodeAt(0)));
        const total = buffers.reduce((sum, b) => sum + b.length, 0);
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const buf of buffers) { merged.set(buf, offset); offset += buf.length; }
        let binary = '';
        for (let i = 0; i < merged.length; i += 65536) {
          binary += String.fromCharCode(...merged.subarray(i, i + 65536));
        }
        return btoa(binary);
      } catch (e: any) {
        // gcloud 에러를 사용자가 볼 수 있도록 에러 메시지를 명확히 표시
        const rawMsg = e?.message || String(e);
        // Google API 오류 JSON에서 readable message 추출
        let readable = rawMsg;
        try {
          const jsonMatch = rawMsg.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            readable = parsed?.error?.message || rawMsg;
          }
        } catch {}
        // API 키 제한(CORS/referrer) 여부 안내 메시지 추가
        const isKeyRestriction = readable.includes('referer') || readable.includes('referrer') || readable.includes('API_KEY_HTTP_REFERRER_BLOCKED') || readable.includes('PERMISSION_DENIED');
        const hint = isKeyRestriction
          ? '\n→ Google Cloud Console에서 API 키의 HTTP 레퍼러 제한을 제거하거나 배포 도메인을 추가하세요.'
          : '';
        const displayErr = `[Cloud TTS 오류] ${readable}${hint}`;
        console.warn('[TTS] gcloud 실패:', displayErr, '→ Gemini TTS 폴백 시도');
        // gcloud 에러를 보존해서 최종 에러 시 사용자에게 보여줌
        (globalThis as any).__lastGcloudTtsError__ = displayErr;
        // 아래 Gemini TTS 경로로 fall-through
      }
    }
  }

  // Gemini TTS 경로 — 실패 시 Google Cloud TTS로 자동 폴백
  const tryGeminiTts = async (): Promise<string | null> => {
    const chunks = splitTtsText(text, 1000);
    if (chunks.length === 1) return appendPcmSilence(await generateTtsChunk(chunks[0]));
    console.log(`[TTS] 텍스트 ${text.length}자 → ${chunks.length}개 청크로 분할 생성`);
    const results: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      console.log(`[TTS] 청크 ${i + 1}/${chunks.length}: ${chunks[i].length}자`);
      results.push(await generateTtsChunk(chunks[i]));
    }
    if (results.length === 0) return null;
    const combined = results.length === 1 ? results[0] : concatenatePcmBase64(results);
    return appendPcmSilence(combined);
  };

  const tryGCloudFallback = async (): Promise<string | null> => {
    const apiKey = localStorage.getItem(CONFIG.STORAGE_KEYS.GCLOUD_TTS_API_KEY) || '';
    if (!apiKey) return null;
    console.warn('[TTS] Gemini TTS 할당량 초과 → Google Cloud TTS 자동 폴백');
    const chunks = splitTtsText(text, 4500);
    if (chunks.length === 1) return generateGCloudTTS(chunks[0]);
    const parts: string[] = [];
    for (const chunk of chunks) {
      const b64 = await generateGCloudTTS(chunk);
      if (b64) parts.push(b64);
    }
    if (parts.length === 0) return null;
    if (parts.length === 1) return parts[0];
    const buffers = parts.map(b => Uint8Array.from(atob(b), c => c.charCodeAt(0)));
    const total = buffers.reduce((sum, b) => sum + b.length, 0);
    const merged = new Uint8Array(total);
    let off = 0;
    for (const buf of buffers) { merged.set(buf, off); off += buf.length; }
    let binary = '';
    for (let i = 0; i < merged.length; i += 65536) binary += String.fromCharCode(...merged.subarray(i, i + 65536));
    return btoa(binary);
  };

  try {
    return await tryGeminiTts();
  } catch (e: any) {
    const msg = e?.message || '';
    const isQuota = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota') || msg.includes('한도');
    if (isQuota) {
      const fallback = await tryGCloudFallback().catch(() => null);
      if (fallback) return fallback;
    }
    // gcloud를 선택했는데 gcloud도 실패한 경우 → gcloud 에러를 앞에 붙여서 표시
    const savedGcloudErr = (globalThis as any).__lastGcloudTtsError__;
    if (savedGcloudErr && provider === 'gcloud') {
      (globalThis as any).__lastGcloudTtsError__ = null;
      throw new Error(`${savedGcloudErr}\n\nGemini 폴백도 실패: ${msg}`);
    }
    throw e;
  }
};

/**
 * AI 기반 자막 의미 단위 분리
 * - 나레이션을 의미가 통하는 단위로 분리
 * - 각 청크는 maxChars(기본 22자) 이하
 * - 반환: 분리된 텍스트 청크 배열
 */

/**
 * 대본과 이미지 프롬프트를 분석하여 애니메이션 움직임 프롬프트 생성
 * - 캐릭터 감정/동작 분석
 * - 상황에 맞는 움직임 제안
 */
export const generateMotionPrompt = async (
  narration: string,
  visualPrompt: string
): Promise<string> => {
  try {
    const ai = getAI();

    const prompt = `You are an animation director. Analyze the narration and visual description, then generate a motion prompt for image-to-video AI.

## Rules
1. Output in English only
2. Keep the original image style intact - NO style changes
3. Suggest subtle, natural character movements based on emotion/context
4. Camera: slow gentle zoom in
5. Keep movements minimal but expressive
6. Max 100 words
7. CRITICAL — Safety filter avoidance:
   - Do NOT include any character names or proper nouns (people's names, place names)
   - Replace suffering/pain/distress expressions with neutral equivalents:
     "slumping" → "sitting quietly", "lowering head" → "bowing head gently", "in a pit" → "in a dark space", "struggling" → "resting", "crying" → "eyes glistening"
   - Describe only visual motion, not emotional suffering
   - Avoid: pit, dungeon, prison, chains, torture, violence, death, blood, fear

## Narration (Korean)
${narration}

## Visual Description
${visualPrompt.slice(0, 300)}

## Output Format
Return ONLY the motion prompt, no explanation. Example:
"Slow gentle zoom in. A figure sits quietly, head bowing gently, subtle breathing motion. Background remains static. Maintain original art style consistency."`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODELS.TEXT,
      contents: prompt,
    });

    const motionPrompt = response.text?.trim() || '';
    console.log('[Motion Prompt] 생성됨:', motionPrompt.slice(0, 100) + '...');
    return motionPrompt;

  } catch (error) {
    console.warn('[Motion Prompt] 생성 실패, 기본 프롬프트 사용');
    // 폴백: 기본 프롬프트
    return `Slow gentle zoom in. Subtle natural movement. Maintain original art style. ${visualPrompt.slice(0, 100)}`;
  }
};

/**
 * AI 실패 시 폴백: 구두점 + 길이 기반 분리
 */
function fallbackSplit(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let current = '';

  // 구두점이나 공백 기준으로 분리
  const tokens = text.split(/(?<=[,.])|(?=\s)/);

  for (const token of tokens) {
    if ((current + token).length <= maxChars) {
      current += token;
    } else {
      if (current.trim()) chunks.push(current.trim());
      current = token.trimStart();
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

// ─── 캐릭터 추출 ───────────────────────────────────────────────────────────────

export interface CharacterInfo {
  name: string;           // 캐릭터 이름
  description: string;   // 외모/특징 설명 (한국어)
  imagePrompt: string;   // 이미지 생성용 영어 프롬프트
  imageData?: string | null; // 생성된 이미지 base64
}

/**
 * 대본/스토리보드에서 등장인물 추출
 * - Gemini로 분석 → 이름, 설명, 이미지 프롬프트 반환
 */
export const extractCharactersFromScript = async (script: string): Promise<CharacterInfo[]> => {
  const ai = getAI();

  const prompt = `아래 대본을 분석하여 등장인물(사람 캐릭터)을 모두 추출하세요.

대본:
${script}

각 인물에 대해 대본에서 언급된 나이, 성별, 직업, 외모(머리색/스타일, 눈색, 피부색, 체형), 복장, 성격을 파악하세요. 단서가 없으면 이야기 맥락에서 합리적으로 추론하세요.

반드시 아래 JSON 배열 형식으로만 응답하세요. 마크다운 없이 JSON만:
[{"name":"캐릭터이름","description":"한국어 상세묘사 3문장","imagePrompt":"Photorealistic portrait. Gender: female. Age: 30s. Hair: long black straight hair. Eyes: dark brown. Skin: fair. Build: slender. Wearing: white blouse and dark slacks. Expression: calm and composed. Professional studio portrait, soft lighting, neutral background, high quality."}]

주의: imagePrompt는 영어로, 문장 형식(마침표로 구분)으로 작성. 대괄호나 특수기호 사용 금지.
실제 등장인물이 없으면 빈 배열만 반환: []`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODELS.TEXT,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { temperature: 0.3 }
  });

  const raw = response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  console.log('[extractCharacters] raw 길이:', raw.length, '앞부분:', raw.slice(0, 120));

  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      console.log('[extractCharacters] 추출 완료:', parsed.length, '명', parsed.map((c: any) => c.name));
      return parsed as CharacterInfo[];
    }
  } catch (e) {
    console.error('[extractCharacters] JSON 파싱 실패:', e, '\nraw:', raw.slice(0, 400));
  }

  return [];
};

/**
 * 캐릭터 포트레이트 이미지 생성
 */
export const generateCharacterImage = async (character: CharacterInfo): Promise<string | null> => {
  const stylePrompt = getSelectedGeminiStylePrompt();
  const fullPrompt = stylePrompt
    ? `${character.imagePrompt} Style: ${stylePrompt}`
    : character.imagePrompt;

  const ar = localStorage.getItem(CONFIG.STORAGE_KEYS.ASPECT_RATIO) || '16:9';

  // Imagen3 모델 선택 시 Imagen3 사용
  const selectedModel = localStorage.getItem(CONFIG.STORAGE_KEYS.IMAGE_MODEL) || CONFIG.DEFAULT_IMAGE_MODEL;
  if (selectedModel.startsWith('imagen-3')) {
    return generateImageWithImagen3(fullPrompt, selectedModel);
  }

  // Gemini 이미지 생성
  return retryGeminiRequest("Character Image", async () => {
    const genAI = new GoogleGenAI({ apiKey: getGeminiApiKey() });
    const parts: any[] = [{ text: fullPrompt }];

    const response = await genAI.models.generateContent({
      model: GEMINI_MODELS.IMAGE_GEN,
      contents: { parts },
      config: {
        responseModalities: [Modality.IMAGE],
        imageConfig: { aspectRatio: ar }
      }
    });

    const imagePart = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));
    return imagePart?.inlineData?.data || null;
  });
};

/**
 * 생성된 씬 이미지 중 썸네일에 가장 적합한 씬 인덱스를 AI가 선택
 */
export const analyzeReferenceVideo = async (frames: string[]): Promise<string> => {
  const ai = getAI();
  const imageParts = frames.map(b64 => ({
    inlineData: { mimeType: 'image/jpeg', data: b64 }
  }));

  const prompt = `이 영상의 프레임들을 분석하여 아래 항목을 한국어로 간결하게 설명하라:

1. **전체 스타일/분위기**: (예: 다큐멘터리풍, 코믹, 드라마틱, 감성적 등)
2. **씬 구성 패턴**: 씬당 평균 길이, 컷 전환 빈도, 도입/전개/결말 구조
3. **시각적 특징**: 색감 팔레트, 조명 스타일, 카메라 앵글
4. **나레이션/자막 스타일**: 말투(반말/존댓말), 속도감, 문장 길이
5. **콘텐츠 특징**: 주요 주제, 타깃 시청자, 핵심 후킹 요소

분석 결과만 출력하라. 불필요한 서두/맺음말 없이 항목별로 출력.`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODELS.TEXT,
    contents: [{ role: 'user', parts: [...imageParts, { text: prompt }] }],
  });

  return response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '분석 결과 없음';
};

/**
 * YouTube 레퍼런스 채널을 분석하여 스타일 컨텍스트 반환
 * YouTube API 키가 있으면 실제 영상 데이터 사용, 없으면 Gemini 지식 기반 분석
 */
export const analyzeReferenceChannel = async (channelUrl: string): Promise<string> => {
  const ai = getAI();
  if (!ai) throw new Error('Gemini API 키가 없습니다. 설정에서 입력해주세요.');

  const ytApiKey = localStorage.getItem('heaven_youtube_key') || '';
  const BASE = 'https://www.googleapis.com/youtube/v3';

  if (ytApiKey) {
    try {
      // 채널 ID 해석
      const resolveChannelId = async (input: string): Promise<string | null> => {
        const raw = input.trim().replace(/\/$/, '');
        if (raw.startsWith('UC') && raw.length > 20) return raw;
        const channelMatch = raw.match(/\/channel\/(UC[\w\-]+)/);
        if (channelMatch) return channelMatch[1];
        const videoMatch = raw.match(/(?:v=|youtu\.be\/)([\w\-]{11})/);
        if (videoMatch) {
          const qs = new URLSearchParams({ part: 'snippet', id: videoMatch[1], key: ytApiKey });
          const res = await fetch(`${BASE}/videos?${qs}`);
          const data = await res.json();
          return data.items?.[0]?.snippet?.channelId || null;
        }
        const handleMatch = raw.match(/(?:youtube\.com\/)?@([\w\-\.]+)/);
        if (handleMatch) {
          const handle = handleMatch[1];
          const qs1 = new URLSearchParams({ part: 'id', forHandle: `@${handle}`, key: ytApiKey });
          const res1 = await fetch(`${BASE}/channels?${qs1}`);
          const data1 = await res1.json();
          if (data1.items?.[0]?.id) return data1.items[0].id;
          const qs2 = new URLSearchParams({ part: 'snippet', q: handle, type: 'channel', maxResults: '3', key: ytApiKey });
          const res2 = await fetch(`${BASE}/search?${qs2}`);
          const data2 = await res2.json();
          const found = data2.items?.find((it: any) =>
            it.snippet?.customUrl?.replace('@','').toLowerCase() === handle.toLowerCase()
          );
          return found?.snippet?.channelId || data2.items?.[0]?.snippet?.channelId || null;
        }
        const legacyMatch = raw.match(/youtube\.com\/(?:c|user)\/([^\/\?&]+)/);
        if (legacyMatch) {
          const qs = new URLSearchParams({ part: 'id', forUsername: legacyMatch[1], key: ytApiKey });
          const res = await fetch(`${BASE}/channels?${qs}`);
          const data = await res.json();
          return data.items?.[0]?.id || null;
        }
        return null;
      };

      const channelId = await resolveChannelId(channelUrl);
      if (channelId) {
        // 채널 기본 정보
        const chQs = new URLSearchParams({ part: 'snippet,statistics', id: channelId, key: ytApiKey });
        const chRes = await fetch(`${BASE}/channels?${chQs}`);
        const chData = await chRes.json();
        const ch = chData.items?.[0];

        // 최근 영상 20개
        const searchQs = new URLSearchParams({ part: 'snippet', channelId, order: 'date', type: 'video', maxResults: '20', key: ytApiKey });
        const searchRes = await fetch(`${BASE}/search?${searchQs}`);
        const searchData = await searchRes.json();
        const videos = searchData.items || [];

        const channelName = ch?.snippet?.title || channelUrl;
        const channelDesc = ch?.snippet?.description?.slice(0, 300) || '';
        const subCount = ch?.statistics?.subscriberCount ? `구독자 ${Number(ch.statistics.subscriberCount).toLocaleString()}명` : '';
        const titles = videos.slice(0, 20).map((v: any, i: number) => `${i+1}. ${v.snippet?.title}`).join('\n');

        const channelDataContext = `채널명: ${channelName}\n${subCount}\n채널 설명: ${channelDesc}\n\n최근 영상 제목:\n${titles}`;
        const prompt = `다음 YouTube 채널 데이터를 분석하여 아래 항목을 한국어로 간결하게 설명하라:

${channelDataContext}

1. **전체 스타일/분위기**: (예: 다큐멘터리풍, 코믹, 드라마틱, 감성적 등)
2. **씬 구성 패턴**: 주로 쓰는 영상 구조, 도입/전개/결말 패턴
3. **시각적 특징**: 썸네일 색감, 편집 느낌
4. **나레이션/자막 스타일**: 말투(반말/존댓말), 속도감, 문장 길이, 특유의 표현
5. **콘텐츠 특징**: 주요 주제, 타깃 시청자, 핵심 후킹 요소
6. **등장 캐릭터**: 채널에 등장하는 주요 캐릭터/인물 특징 (있다면)

분석 결과만 출력하라. 불필요한 서두/맺음말 없이 항목별로 출력.`;

        const response = await ai.models.generateContent({
          model: GEMINI_MODELS.TEXT,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        });
        return response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '분석 결과 없음';
      }
    } catch (e) {
      console.warn('[ChannelAnalysis] YouTube API 분석 실패, Gemini 지식 기반으로 폴백:', e);
    }
  }

  // YouTube API 없거나 실패 시 → Gemini 학습 지식 기반 분석
  const fallbackResponse = await ai.models.generateContent({
    model: GEMINI_MODELS.TEXT,
    contents: [{ role: 'user', parts: [{ text: `YouTube 채널 "${channelUrl}"에 대해 알고 있다면 아래 항목을 한국어로 분석하라. 채널을 모르면 URL이나 채널명으로 유추 가능한 스타일을 추정하라:

1. **전체 스타일/분위기**
2. **씬 구성 패턴**
3. **시각적 특징**
4. **나레이션/자막 스타일**
5. **콘텐츠 특징**
6. **등장 캐릭터**

분석 결과만 출력.` }] }],
  });
  return fallbackResponse.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '분석 결과 없음';
};

// ─────────────────────────────────────────────
// 순수 영상 스튜디오: 씬 플래닝 (이미지/영상 프롬프트)
// ─────────────────────────────────────────────

/**
 * 녹음 오디오 파일을 전사하여 씬별 타임스탬프 매핑 반환
 */
export const transcribeAudioForScenes = async (
  audioBase64: string,
  mimeType: string,
  narrations: string[]
): Promise<{ startSec: number; endSec: number }[]> => {
  const ai = getAI();

  const prompt = `오디오에서 각 씬 나레이션의 발화 구간을 찾아 정확한 시작/끝 시간을 반환하라.

씬 나레이션 목록 (순서대로):
${narrations.map((n, i) => `[${i}] ${n}`).join('\n')}

출력 형식 (JSON 배열만):
[{"sceneIndex":0,"startSec":0.00,"endSec":3.50},...]

규칙:
- startSec: 첫 음절이 시작되는 정확한 시점 (숨소리/노이즈 제외)
- endSec: 마지막 음절 발음이 완전히 끝나는 시점 (잔향 포함, 너무 일찍 자르지 말 것)
- 소수점 2자리 (예: 3.45)
- 씬 순서는 목록 순서와 동일
- 매칭 실패 씬은 startSec/endSec 모두 -1
- JSON 배열만 출력`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODELS.TEXT,
    contents: {
      parts: [
        { text: prompt },
        { inlineData: { data: audioBase64, mimeType } }
      ]
    }
  });

  const rawText = response.text || '[]';
  const cleaned = cleanJsonResponse(rawText);
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error('전사 결과 파싱 실패');

  const result: { startSec: number; endSec: number }[] = narrations.map(() => ({ startSec: -1, endSec: -1 }));
  for (const item of parsed) {
    if (typeof item.sceneIndex === 'number' && item.sceneIndex >= 0 && item.sceneIndex < narrations.length) {
      result[item.sceneIndex] = { startSec: item.startSec ?? -1, endSec: item.endSec ?? -1 };
    }
  }
  return result;
};

// ──────────────────────────────────────────────────────────────────────────────
// 오디오-퍼스트: 전체 오디오 → 씬 분리 + 타임스탬프 + 자막 청크
// ──────────────────────────────────────────────────────────────────────────────

export interface AudioFirstScene {
  narration: string;     // 전사 텍스트
  description: string;  // 이미지 생성용 한국어 시각 묘사
  startSec: number;     // 전체 오디오에서 씬 시작 (소수점 2자리)
  endSec: number;       // 전체 오디오에서 씬 종료 (소수점 2자리)
  subtitleChunks: { text: string; startSec: number; endSec: number }[];
}

/**
 * 오디오-퍼스트: 전체 오디오 파일을 AI가 분석 → 씬 자동 분리 + 자막 청크 생성
 * 오디오를 분리하지 않고 전체를 하나의 트랙으로 사용 → 오디오 끊김 완전 방지
 */
// ── 챗봇 명령 처리 ─────────────────────────────────────────────────────────
export interface ChatOperation {
  type: 'SET_ZOOM' | 'SET_SUBTITLE_CHARS' | 'GENERATE_VIDEO' | 'NONE';
  sceneRange?: [number, number];
  zoom?: { type: string; origin: string; intensity: number };
  maxChars?: number;
}
export interface ChatCommandResult {
  operations: ChatOperation[];
  reply: string;
}

export const processChatCommand = async (
  command: string,
  sceneCount: number
): Promise<ChatCommandResult> => {
  const ai = getAI();
  const prompt = `당신은 영상 편집 AI 어시스턴트입니다. 사용자 명령을 분석하고 JSON만 반환하세요.

씬 정보: 총 ${sceneCount}개 씬 (씬 번호 1~${sceneCount}, 인덱스 0~${sceneCount - 1})

사용자 명령: "${command}"

지원 조작:
- SET_ZOOM: 씬 범위에 줌/패닝 효과 설정
- SET_SUBTITLE_CHARS: 자막 최대 글자 수 변경 (전체 적용)
- GENERATE_VIDEO: 씬 범위에 영상 생성 요청
- NONE: 조작 없음

응답 JSON 형식:
{
  "operations": [
    {
      "type": "SET_ZOOM",
      "sceneRange": [0, 4],
      "zoom": { "type": "zoom-in", "origin": "center", "intensity": 30 }
    }
  ],
  "reply": "사용자에게 보낼 응답"
}

규칙:
- sceneRange: [시작인덱스, 끝인덱스] 0-based 포함, 전체=[-1,-1]
- "1~5씬" → [0,4], "전체" → [-1,-1], "3씬" → [2,2]
- zoom.type: "zoom-in" | "zoom-out" | "pan-right" | "pan-left" | "none"
- zoom.origin: "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right"
- zoom.intensity: 1~100
- JSON 배열만 출력, 마크다운 없이`;

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODELS.TEXT,
      contents: prompt
    });
    const raw = response.text || '{}';
    const cleaned = cleanJsonResponse(raw);
    const parsed = JSON.parse(cleaned) as ChatCommandResult;
    // sceneRange [-1,-1] → 전체
    parsed.operations = (parsed.operations || []).map(op => {
      if (op.sceneRange && op.sceneRange[0] === -1) op.sceneRange = [0, sceneCount - 1];
      return op;
    });
    return parsed;
  } catch {
    return { operations: [], reply: '명령을 이해하지 못했어요. 다시 시도해주세요.' };
  }
};

// 대본 텍스트를 maxChars 단위로 자막 청크 분리 (Gemini 없이)

/**
 * 나레이션 텍스트와 씬 길이로 자막 청크를 로컬 생성 (글자 수 비례 분배)
 */
function makeSubtitleChunksLocal(
  text: string,
  durationSec: number,
  maxChars: number = 15
): { text: string; startSec: number; endSec: number }[] {
  if (!text.trim() || durationSec <= 0) return [];
  const breakChars = ['.', '!', '?', '。', '，', ',', ' ', '~'];
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 0) {
    if (remaining.length <= maxChars) { chunks.push(remaining); break; }
    let cutAt = maxChars;
    for (let i = Math.min(maxChars, remaining.length - 1); i >= Math.floor(maxChars * 0.5); i--) {
      if (breakChars.includes(remaining[i])) { cutAt = i + 1; break; }
    }
    const chunk = remaining.slice(0, cutAt).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(cutAt).trim();
  }
  if (chunks.length === 0) return [];
  const totalChars = chunks.reduce((s, c) => s + c.length, 0);
  const result: { text: string; startSec: number; endSec: number }[] = [];
  let t = 0;
  for (let i = 0; i < chunks.length; i++) {
    const dur = (chunks[i].length / totalChars) * durationSec;
    const end = i === chunks.length - 1 ? durationSec : t + dur;
    result.push({ text: chunks[i], startSec: t, endSec: end });
    t = end;
  }
  return result;
}

export const transcribeAudioToScenes = async (
  audioBase64: string,
  mimeType: string,
  onProgress?: (msg: string) => void,
  targetSceneCount: number = 0,
  scriptText?: string,
  characterDescription?: string
): Promise<AudioFirstScene[]> => {
  const ai = getAI();
  onProgress?.('Gemini 2.5 Flash로 오디오 분석 중...');

  const sceneCountInstruction = targetSceneCount > 0
    ? `⚠️ 씬 수 고정: 반드시 정확히 ${targetSceneCount}개 씬. 더 많거나 적으면 절대 안 됩니다.`
    : '내용을 의미 단위로 씬 분리 (자연스러운 문장/주제 전환 기준, 보통 20~45초 단위)';

  const charLock = characterDescription
    ? `- ⚠️ CHARACTER LOCK: ALL characters in EVERY scene MUST be "${characterDescription}". NEVER substitute humans, other animals, or other species. If scene has characters, they are ALWAYS "${characterDescription}".`
    : `- ⚠️ CHARACTER CONSISTENCY: 레퍼런스의 캐릭터 종·유형 100% 유지. 절대 인간·다른 동물로 대체 금지`;

  const commonRules = `
- narration: 큰따옴표와 역슬래시 절대 사용 금지. 줄바꿈 금지
- description: 영어. 큰따옴표와 역슬래시 절대 사용 금지
${charLock}
- startSec/endSec: 초 단위 소수점 수만 허용. MM.SS 또는 MM:SS 형식 절대 금지 (예: 1분30초=90.00)
- subtitleChunks: 각 청크 15자 이하, 자연스러운 의미 단위
- JSON 배열만 출력 (마크다운 코드 블록 없이)${targetSceneCount > 0 ? `\n- 씬 수: 반드시 ${targetSceneCount}개 (초과/미달 절대 금지)` : ''}`;

  const distributionRules = `
## 씬 균등 분배 규칙 (반드시 준수)
- 오디오 전체 길이를 씬 수로 균등하게 분배할 것
- 가장 짧은 씬과 가장 긴 씬의 길이 차이가 2배를 넘지 말 것
- 씬 경계는 자연스러운 문장 끝 또는 의미 전환점에서 설정
- 10분 이상 오디오: 각 씬 최소 20초 이상 확보`;

  const charHint = characterDescription ? ` Character type: ${characterDescription}.` : '';
  const descriptionRule = `description: CRITICAL - English visual prompt that DIRECTLY illustrates the narration content. Read narration → identify the topic AND the emotional tone → describe: subject+action+relevant props+setting+camera angle+character expression. Must match narration topic AND emotion exactly — if narration is sad/painful, character must look distressed/worried (NOT smiling). If narration is joyful, character looks happy. NEVER use generic happy expressions for negative narrations.${charHint} No color/lighting/art-style. No quotes or backslashes.`;

  // 대본 제공 시: subtitleChunks 불필요 (splitScriptToSubtitleChunks로 생성) → JSON 크기 최소화
  // ✱ subtitleChunks를 AI에 요청하지 않음 → JSON 크기 ~70% 감소 → 토큰 한도 초과 방지
  // subtitleChunks는 로컬에서 글자 수 비례 분배로 생성 (정확도보다 안정성 우선)
  const prompt = scriptText?.trim()
    ? `당신은 오디오-대본 타임스탬프 정렬 전문가입니다.
제공된 대본과 오디오를 분석하여 대본 각 부분에 정확한 타임스탬프를 매핑하세요.

## 제공된 대본
${scriptText.trim()}

## 작업
1. 오디오를 들으며 대본의 각 단락/문장이 시작되는 정확한 시간 파악
2. ${sceneCountInstruction}
3. narration은 대본에서 그대로 가져올 것 (전사·재작성 금지)
${distributionRules}

## 출력 형식 (JSON 배열만 — subtitleChunks 필드 없음)
[{"narration":"대본 텍스트","description":"visual description","startSec":0.00,"endSec":15.50}]

## 규칙
- ${descriptionRule}
- narration: 큰따옴표와 역슬래시 절대 사용 금지. 줄바꿈 금지
- description: 영어. 큰따옴표와 역슬래시 절대 사용 금지
${charLock}
- startSec/endSec: 초 단위 소수점 수만 허용 (예: 1분30초=90.00)
${targetSceneCount > 0 ? `- 씬 수: 반드시 ${targetSceneCount}개` : ''}`
    : `당신은 오디오 콘텐츠 분석 전문가입니다. 주어진 오디오를 분석하여 JSON으로 씬을 분리하세요.

## 작업
1. 오디오 전체를 정확히 전사(transcription)
2. ${sceneCountInstruction}
3. 각 씬에 대해 JSON 출력
${distributionRules}

## 출력 형식 (JSON 배열만 — subtitleChunks 필드 없음)
[{"narration":"전사 텍스트","description":"visual description","startSec":0.00,"endSec":15.50}]

## 규칙
- narration: 발화된 내용을 그대로 전사. ${commonRules.trimStart()}`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODELS.TEXT,
    contents: {
      parts: [
        { text: prompt },
        { inlineData: { data: audioBase64, mimeType } }
      ]
    },
    config: {
      responseMimeType: 'application/json',
      maxOutputTokens: 65536,         // 최대 허용치 (오디오+씬 많아도 잘리지 않도록)
      thinkingConfig: { thinkingBudget: 0 }, // 오디오 전사는 thinking 불필요 → 출력 토큰 절약
    },
  });

  const rawText = response.text || '[]';
  // Gemini가 1분 이상 오디오에서 타임스탬프를 MM.SS.cc 또는 MM:SS.cc 형식으로 출력하는 버그 수정
  // 예: "startSec": 1.00.80 → 60.80 / "startSec": 1:00.30 → 60.30
  const fixedText = rawText.replace(
    /"(startSec|endSec)"\s*:\s*(\d+)[.:](\d{2})\.(\d+)/g,
    (_m: string, key: string, min: string, sec: string, frac: string) => {
      const total = parseInt(min, 10) * 60 + parseInt(sec, 10) + parseFloat('0.' + frac);
      return `"${key}": ${total.toFixed(2)}`;
    }
  );
  const cleaned = cleanJsonResponse(fixedText);

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e: any) {
    const errPos = parseInt((e.message.match(/position (\d+)/) || [])[1] ?? '0', 10);
    const ctx = cleaned.slice(Math.max(0, errPos - 80), errPos + 80);
    console.error('[transcribeAudioToScenes] JSON 파싱 실패:', e.message);
    console.error('[오류 위치 전후 160자]', JSON.stringify(ctx));
    throw new Error(`오디오 전사 JSON 파싱 실패: ${e.message}`);
  }

  if (!Array.isArray(parsed)) throw new Error('오디오 전사 결과 파싱 실패');

  let scenes: AudioFirstScene[] = parsed.map((item: any) => {
    const nar = String(item.narration || '');
    const start = Number(item.startSec ?? 0);
    const end = Number(item.endSec ?? 0);
    const dur = Math.max(0.1, end - start);
    const subtitleChunks = makeSubtitleChunksLocal(nar, dur);
    return { narration: nar, description: String(item.description || ''), startSec: start, endSec: end, subtitleChunks };
  });

  // ── 씬 수 강제 고정 (AI가 요청 수를 초과/미달 시 병합/분할) ──
  if (targetSceneCount > 0 && scenes.length !== targetSceneCount) {
    console.warn(`[transcribeAudioToScenes] 씬 수 불일치 (AI: ${scenes.length}개, 요청: ${targetSceneCount}개) → 강제 조정`);
    if (scenes.length > targetSceneCount) {
      // 병합: 타임스탬프 연속성 유지 (첫 씬 startSec, 마지막 씬 endSec)
      const merged: AudioFirstScene[] = [];
      const ratio = scenes.length / targetSceneCount;
      for (let i = 0; i < targetSceneCount; i++) {
        const start = Math.round(i * ratio);
        const end = Math.round((i + 1) * ratio);
        const group = scenes.slice(start, end);
        const narration = group.map(s => s.narration).filter(Boolean).join(' ');
        const startSec = group[0]?.startSec ?? 0;
        const endSec = group[group.length - 1]?.endSec ?? 0;
        const dur = Math.max(0.1, endSec - startSec);
        merged.push({
          narration,
          description: group[0]?.description || '',
          startSec,
          endSec,
          subtitleChunks: makeSubtitleChunksLocal(narration, dur),
        });
      }
      scenes = merged;
    } else {
      // 분할: 가장 긴 씬을 반복 분할 (타임스탬프 절반 씩)
      while (scenes.length < targetSceneCount) {
        let maxDur = 0, maxIdx = 0;
        for (let i = 0; i < scenes.length; i++) {
          const d = scenes[i].endSec - scenes[i].startSec;
          if (d > maxDur) { maxDur = d; maxIdx = i; }
        }
        if (maxDur < 1) break;
        const s = scenes[maxIdx];
        const midSec = (s.startSec + s.endSec) / 2;
        const narLen = s.narration.length;
        const splitChar = Math.floor(narLen / 2);
        const n1 = s.narration.slice(0, splitChar).trim() || s.narration;
        const n2 = s.narration.slice(splitChar).trim() || s.narration;
        scenes.splice(maxIdx, 1,
          { ...s, narration: n1, endSec: midSec, subtitleChunks: makeSubtitleChunksLocal(n1, midSec - s.startSec) },
          { ...s, narration: n2, startSec: midSec, subtitleChunks: makeSubtitleChunksLocal(n2, s.endSec - midSec) }
        );
      }
    }
    console.log(`[transcribeAudioToScenes] 씬 수 조정 완료: ${scenes.length}개`);
  }

  return scenes;
};

// ── YouTube 메타데이터 AI 생성 ─────────────────────────────────────────────────
export interface YouTubeMetaResult {
  title: string;
  description: string;
  tags: string[];
  suggestedCategory: string; // YouTube categoryId
}

export const generateYouTubeMeta = async (
  topic: string,
  narrations: string[],
  isShortform: boolean
): Promise<YouTubeMetaResult> => {
  const ai = getAI();
  const scriptSummary = narrations.slice(0, 8).join('\n');
  const formatGuide = isShortform
    ? `- 제목: 15자 이내, 임팩트 있게, 이모지 1개 포함, 궁금증 유발형
- 설명: 2-3문장 핵심 요약 + 해시태그 10개 이상 (#Shorts 필수 포함)
- 태그: 15개 이내, 숏폼/Shorts 관련 태그 포함`
    : `- 제목: 25자 이내, 키워드 포함, 검색 최적화, 이모지 없거나 최대 1개
- 설명: 3-5문장 상세 요약 + 목차 없이 자연스럽게 + 해시태그 5-10개
- 태그: 15개 이내, 핵심 키워드 위주`;

  const prompt = `다음 YouTube 영상의 메타데이터를 한국어로 생성해줘.

영상 주제: ${topic}
영상 유형: ${isShortform ? '숏폼 (60초 이내 세로 영상)' : '롱폼 (가로 영상)'}
대본 요약:
${scriptSummary}

작성 규칙:
${formatGuide}
- suggestedCategory: YouTube 카테고리 ID (숫자 문자열) — 가장 적합한 것 1개
  22=People&Blogs, 24=Entertainment, 25=News&Politics, 26=Howto&Style, 27=Education, 28=Science&Technology, 17=Sports, 10=Music, 23=Comedy

반드시 아래 JSON 형식으로만 출력:
{"title":"...","description":"...","tags":["태그1","태그2"],"suggestedCategory":"22"}`;

  const response = await retryGeminiRequest('generateYouTubeMeta', () =>
    ai.models.generateContent({
      model: GEMINI_MODELS.TEXT,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json', temperature: 0.9 },
    })
  );

  const raw = cleanJsonResponse(response.text || '{}');
  try {
    const parsed = JSON.parse(raw);
    return {
      title: String(parsed.title || topic).slice(0, 100),
      description: String(parsed.description || ''),
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 15) : [],
      suggestedCategory: String(parsed.suggestedCategory || '22'),
    };
  } catch {
    return { title: topic.slice(0, 100), description: topic, tags: [], suggestedCategory: '22' };
  }
};
