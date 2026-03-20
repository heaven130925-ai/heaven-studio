
import { GoogleGenAI } from "@google/genai";

const getGeminiApiKey = () =>
  localStorage.getItem('heaven_gemini_key') || '';

const getAI = () => new GoogleGenAI({ apiKey: getGeminiApiKey() });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const VEO_MODELS = [
  { id: 'veo-3.0-generate-preview', label: 'Veo 3', credits: 20 },
  { id: 'veo-2.0-generate-001', label: 'Veo 2', credits: 5 },
] as const;

/**
 * Veo 텍스트→영상 생성
 * @returns objectURL (blob URL) 또는 null
 */
export async function generateVeoVideo(
  prompt: string,
  model: string = 'veo-3.0-generate-preview',
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
  return URL.createObjectURL(blob);
}
