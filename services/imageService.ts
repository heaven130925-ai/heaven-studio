
/**
 * 이미지 생성 서비스 (Gemini 전용)
 * - Gemini 2.5 Flash를 사용한 이미지 생성
 * - 참조 이미지 지원 (캐릭터/스타일 분리)
 */

import { CONFIG, ImageModelId, GEMINI_STYLE_CATEGORIES, GeminiStyleId, VISUAL_STYLES } from '../config';
import { generateImageForScene as generateWithGemini } from './geminiService';
import { ScriptScene, ReferenceImages } from '../types';

/**
 * 현재 선택된 이미지 모델 가져오기
 */
export function getSelectedImageModel(): ImageModelId {
  const saved = localStorage.getItem(CONFIG.STORAGE_KEYS.IMAGE_MODEL);
  return (saved as ImageModelId) || CONFIG.DEFAULT_IMAGE_MODEL;
}

/**
 * 현재 선택된 Gemini 스타일 가져오기
 */
export function getSelectedGeminiStyle(): GeminiStyleId {
  const saved = localStorage.getItem(CONFIG.STORAGE_KEYS.GEMINI_STYLE);
  return (saved as GeminiStyleId) || 'gemini-none';
}

/**
 * 커스텀 스타일 프롬프트 가져오기 (Gemini)
 */
function getGeminiCustomStylePrompt(): string {
  return localStorage.getItem(CONFIG.STORAGE_KEYS.GEMINI_CUSTOM_STYLE) || '';
}

/**
 * 이미지 내 텍스트 모드 가져오기
 * 'auto' | 'none' | 'english' | 'numbers'
 */
export function getImageTextMode(): string {
  return localStorage.getItem(CONFIG.STORAGE_KEYS.IMAGE_TEXT_MODE) || 'none';
}

/**
 * 선택된 Gemini 화풍의 프롬프트 가져오기
 * @returns 화풍 프롬프트 (없음이면 빈 문자열)
 */
export function getGeminiStylePrompt(): string {
  // 비주얼 스타일 빠른 선택기 우선 적용
  const visualStyleId = localStorage.getItem(CONFIG.STORAGE_KEYS.VISUAL_STYLE_ID);
  if (visualStyleId && visualStyleId !== 'none') {
    const found = (VISUAL_STYLES as readonly { id: string; prompt: string }[]).find(s => s.id === visualStyleId);
    if (found) return found.prompt;
  }

  const styleId = getSelectedGeminiStyle();

  // 화풍 없음 선택
  if (styleId === 'gemini-none') {
    return '';
  }

  // 커스텀 스타일인 경우
  if (styleId === 'gemini-custom') {
    return getGeminiCustomStylePrompt().trim();
  }

  // 프리셋 스타일 찾기
  for (const category of GEMINI_STYLE_CATEGORIES) {
    const style = category.styles.find(s => s.id === styleId);
    if (style) {
      return style.prompt;
    }
  }

  return '';
}

/**
 * 이미지 생성 함수 (Gemini 전용)
 * - Gemini 서비스 호출
 * - 참조 이미지 지원 (캐릭터/스타일)
 *
 * @param scene - 씬 데이터 (나레이션, 비주얼 프롬프트 등)
 * @param referenceImages - 분리된 참조 이미지 (캐릭터/스타일)
 * @returns base64 인코딩된 이미지 또는 null
 */
export async function generateImage(
  scene: ScriptScene,
  referenceImages: ReferenceImages
): Promise<string | null> {
  const modelId = getSelectedImageModel();
  const hasCharacterRef = referenceImages.character && referenceImages.character.length > 0;
  const hasStyleRef = referenceImages.style && referenceImages.style.length > 0;

  console.log(`[Image Service] 모델: ${modelId}`);
  console.log(`[Image Service] 캐릭터 참조: ${hasCharacterRef ? referenceImages.character.length + '개' : '없음'}`);
  console.log(`[Image Service] 스타일 참조: ${hasStyleRef ? referenceImages.style.length + '개' : '없음'}`);

  // Gemini 사용 (참조 이미지 지원)
  return await generateWithGemini(scene, referenceImages);
}
