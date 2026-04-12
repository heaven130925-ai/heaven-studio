
import { GoogleGenAI } from "@google/genai";

const getGeminiApiKey = () => {
  const raw = localStorage.getItem('heaven_gemini_key') || '';
  return raw.replace(/[^\x20-\x7E]/g, '').trim();
};

const getAI = () => new GoogleGenAI({ apiKey: getGeminiApiKey() });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** blob → data:video/mp4;base64,... (페이지 새로고침 후에도 유효) */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export const VEO_MODELS = [
  { id: 'veo-3.1-generate-preview', label: 'Veo 3.1 Fast', credits: 20 },
  { id: 'veo-2.0-generate-001', label: 'Veo 2', credits: 5 },
] as const;

/**
 * Veo 텍스트→영상 생성
 * @returns objectURL (blob URL) 또는 null
 */
export async function generateVeoVideo(
  prompt: string,
  model: string = 'veo-3.1-generate-preview',
  aspectRatio: '16:9' | '9:16' = '9:16',
  durationSeconds: number = 8,
  onProgress?: (msg: string) => void
): Promise<string | null> {
  const ai = getAI();
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error('Gemini API 키가 없습니다');

  onProgress?.('Veo 영상 생성 시작 (2~5분 소요)...');

  let operation = await ai.models.generateVideos({
    model,
    prompt,
    config: { aspectRatio, durationSeconds } as any,
  });

  for (let i = 0; i < 60; i++) {
    if (operation.done) break;
    await wait(10000);
    onProgress?.(`Veo 생성 중... ${(i + 1) * 10}초 경과`);
    operation = await ai.operations.getVideosOperation({ operation });
  }

  if (!operation.done) throw new Error('Veo 생성 시간 초과 (10분)');

  const uri = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!uri) throw new Error('Veo 응답에 영상이 없습니다 (안전 필터 또는 접근 권한 문제)');

  // API 키로 영상 다운로드
  const resp = await fetch(`${uri}&key=${apiKey}`);
  if (!resp.ok) throw new Error(`영상 다운로드 실패: ${resp.status}`);

  const blob = await resp.blob();
  return blobToDataUrl(blob);
}

/**
 * Veo 이미지→영상 생성 (시작 프레임 이미지 + 모션 프롬프트)
 */
export async function generateVeoVideoFromImage(
  imageBase64: string,
  motionPrompt: string,
  model: string = 'veo-2.0-generate-001',
  aspectRatio: '16:9' | '9:16' = '9:16',
  durationSeconds: number = 5,
  onProgress?: (msg: string) => void
): Promise<string | null> {
  const ai = getAI();
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error('Gemini API 키가 없습니다');

  // Veo 3.1은 이미지→영상을 지원하지 않으므로 Veo 2로 대체
  const effectiveModel = model === 'veo-3.1-generate-preview' ? 'veo-2.0-generate-001' : model;
  if (model !== effectiveModel) {
    onProgress?.('Veo 3.1은 이미지→영상 미지원 → Veo 2로 자동 전환');
  }

  onProgress?.('Veo 이미지→영상 생성 시작 (2~5분 소요)...');

  let operation = await ai.models.generateVideos({
    model: effectiveModel,
    prompt: motionPrompt,
    image: { imageBytes: imageBase64, mimeType: 'image/jpeg' },
    config: { aspectRatio, durationSeconds } as any,
  } as any);

  for (let i = 0; i < 60; i++) {
    if (operation.done) break;
    await wait(10000);
    onProgress?.(`Veo 생성 중... ${(i + 1) * 10}초 경과`);
    operation = await ai.operations.getVideosOperation({ operation });
  }

  if (!operation.done) throw new Error('Veo 생성 시간 초과 (10분)');

  const uri = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!uri) throw new Error('Veo 응답에 영상이 없습니다 — 안전 필터에 걸렸을 가능성이 높습니다. 프롬프트에 고통/위험/인물 이름이 포함되면 Veo가 거부합니다.');

  const resp = await fetch(`${uri}&key=${apiKey}`);
  if (!resp.ok) throw new Error(`영상 다운로드 실패: ${resp.status}`);

  const blob = await resp.blob();
  return blobToDataUrl(blob);
}
