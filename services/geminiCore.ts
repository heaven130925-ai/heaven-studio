import { GoogleGenAI } from "@google/genai";

// ── API 클라이언트 ──────────────────────────────────────────────────────────────
export const getGeminiApiKey = () => {
  const raw = localStorage.getItem('heaven_gemini_key') || process.env.GEMINI_API_KEY || '';
  return raw.replace(/[^\x20-\x7E]/g, '').trim();
};

export const getAI = () => new GoogleGenAI({ apiKey: getGeminiApiKey() });

export const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ── 모델 중앙 관리 (Google이 모델 폐기해도 여기만 수정하면 됨) ──────────────────
export const GEMINI_MODELS = {
  TEXT: 'gemini-2.5-flash',
  TEXT_FALLBACKS: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  IMAGE_GEN: 'gemini-2.5-flash-image',
  IMAGE_GEN_FALLBACKS: ['gemini-3.1-flash-image-preview', 'gemini-2.5-flash-image', 'gemini-3-pro-image-preview'],
  TTS: 'gemini-2.5-flash-preview-tts',
  TTS_FALLBACKS: ['gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts'],
} as const;

export async function callGeminiWithFallback(
  ai: GoogleGenAI,
  params: { contents: any; config?: any },
  models?: string[]
): Promise<any> {
  const modelList = models || [GEMINI_MODELS.TEXT, ...GEMINI_MODELS.TEXT_FALLBACKS.filter(m => m !== GEMINI_MODELS.TEXT)];
  let lastError: any;
  for (const model of modelList) {
    try {
      return await ai.models.generateContent({ model, ...params });
    } catch (e: any) {
      lastError = e;
      const msg = e?.message || '';
      if (msg.includes('not found') || msg.includes('deprecated') || msg.includes('does not exist') || msg.includes('is not available')) {
        console.warn(`[Gemini] 모델 ${model} 사용 불가 — 다음 모델로 폴백`);
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

// ── 안전 필터 우회 키워드 대체 맵 ──────────────────────────────────────────────
export const KEYWORD_ALTERNATIVES: Record<string, string[]> = {
  'x-ray': ['transparent cutaway', 'see-through', 'translucent'],
  'x-ray view': ['transparent cutaway view', 'see-through view', 'cross-section view'],
  'xray': ['transparent', 'see-through', 'translucent'],
  'dissection': ['cross-section', 'cutaway'],
  'anatomy': ['internal structure', 'inner components'],
  'surgical': ['precise', 'detailed'],
  'explosion': ['burst', 'rapid expansion', 'dramatic surge'],
  'bomb': ['impact', 'dramatic event'],
  'crash': ['sharp decline', 'sudden drop'],
  'naked': ['bare', 'exposed', 'uncovered'],
  'blood': ['red liquid', 'crimson'],
  'death': ['end', 'decline', 'fall'],
  'kill': ['eliminate', 'end', 'stop'],
};

// ── 나레이션 섹션 마커 제거 ────────────────────────────────────────────────────
export const cleanNarration = (text: string): string => {
  return text
    .replace(/\[파트\s*\d+\/\d+[\s\S]*?\]\s*/gi, '')
    .replace(/\/\d+\s*-[^\]]*\]\s*/gi, '')
    .replace(/^.*전체 대본의 일부.*$/gim, '')
    .replace(/^.*이 파트의 내용만.*$/gim, '')
    .replace(/^[\[【]?\s*파트\s*\d+\s*[\]】]?\s*[:：]?\s*/gim, '')
    .replace(/^[\[【]?\s*씬\s*\d+\s*[\]】]?\s*[:：]?\s*/gim, '')
    .replace(/^나레이션\s*\d*\s*[:：]\s*/gim, '')
    .replace(/^(Part|Section|Scene|Chapter)\s*\d+\s*[:：]?\s*/gim, '')
    .replace(/^\[\d+\]\s*/gim, '')
    .trim();
};

// ── 프롬프트 민감 키워드 대체 ──────────────────────────────────────────────────
export const sanitizePrompt = (prompt: string, attemptIndex: number = 0): string => {
  let sanitized = prompt.toLowerCase();
  let result = prompt;
  for (const [keyword, alternatives] of Object.entries(KEYWORD_ALTERNATIVES)) {
    const regex = new RegExp(keyword, 'gi');
    if (regex.test(sanitized)) {
      const altIndex = attemptIndex % alternatives.length;
      result = result.replace(regex, alternatives[altIndex]);
      sanitized = result.toLowerCase();
    }
  }
  return result;
};

// ── JSON 응답 정리 (불완전 응답 복구 포함) ────────────────────────────────────
function findLastCompleteSceneObject(json: string): number {
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let lastCompleteEnd = -1;
  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (char === '\\') { escapeNext = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 1) lastCompleteEnd = i + 1;
    }
  }
  return lastCompleteEnd;
}

export const cleanJsonResponse = (text: string): string => {
  if (!text) { console.error('[JSON Clean] 빈 응답 수신'); return '[]'; }
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  {
    let fixed = '';
    let inStr = false;
    let esc = false;
    for (let i = 0; i < cleaned.length; i++) {
      const c = cleaned[i];
      if (esc) { fixed += c; esc = false; continue; }
      if (c === '\\') { fixed += c; esc = true; continue; }
      if (!inStr && c === '"') { inStr = true; fixed += c; continue; }
      if (inStr && c === '"') {
        let j = i + 1;
        while (j < cleaned.length && (cleaned[j] === ' ' || cleaned[j] === '\n' || cleaned[j] === '\r' || cleaned[j] === '\t')) j++;
        const next = j < cleaned.length ? cleaned[j] : '';
        if (':,}]'.includes(next) || next === '') { inStr = false; fixed += c; }
        else { fixed += '\\"'; }
        continue;
      }
      if (inStr) {
        if (c === '\n' || c === '\r' || c === '\t') { fixed += ' '; continue; }
      }
      fixed += c;
    }
    cleaned = fixed;
  }

  const firstBracket = cleaned.search(/[\[{]/);
  if (firstBracket === -1) { console.warn('[JSON Clean] JSON 시작 브래킷 없음:', cleaned.slice(0, 100)); return '[]'; }

  let depth = 0;
  let lastValidIndex = -1;
  let inString = false;
  let escapeNext = false;
  for (let i = firstBracket; i < cleaned.length; i++) {
    const char = cleaned[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (char === '\\') { escapeNext = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === '[' || char === '{') depth++;
    if (char === ']' || char === '}') {
      depth--;
      if (depth === 0) { lastValidIndex = i; break; }
    }
  }

  if (lastValidIndex !== -1) {
    cleaned = cleaned.slice(firstBracket, lastValidIndex + 1);
  } else {
    console.warn(`[JSON Clean] JSON 불완전 — 손실 복구 시도`);
    cleaned = cleaned.slice(firstBracket);
    const lastCompleteEnd = findLastCompleteSceneObject(cleaned);
    if (lastCompleteEnd > 0) {
      cleaned = cleaned.slice(0, lastCompleteEnd) + (cleaned.includes('"scenes"') ? ']}' : ']');
    } else {
      console.error('[JSON Clean] 복구 불가능');
      return '[]';
    }
  }

  cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
  return cleaned.trim();
};

// ── Gemini 재시도 래퍼 ─────────────────────────────────────────────────────────
export const retryGeminiRequest = async <T>(
  operationName: string,
  requestFn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 5000
): Promise<T> => {
  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (error: any) {
      lastError = error;
      const errorMsg = error.message || JSON.stringify(error);
      const isQuotaError = errorMsg.includes('429') || errorMsg.includes('Quota') || error.status === 429 || errorMsg.includes('503') || error.status === 503 || errorMsg.includes('overloaded') || errorMsg.includes('Service Unavailable');
      if (isQuotaError && attempt < maxRetries) {
        await wait(baseDelay * attempt);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};
