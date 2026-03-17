
/**
 * fal.ai API 서비스
 * - PixVerse v5.5 이미지→영상 변환 (~$0.15/영상)
 */

import { CONFIG } from '../config';

interface PixVerseVideoResponse {
  video: {
    url: string;
  };
  seed?: number;
}

/**
 * FAL API 키 가져오기 (환경변수 우선)
 */
export function getFalApiKey(): string | null {
  return process.env.FAL_API_KEY || localStorage.getItem(CONFIG.STORAGE_KEYS.FAL_API_KEY);
}

/**
 * FAL API 키 저장 (localStorage에 백업)
 */
export function setFalApiKey(key: string): void {
  localStorage.setItem(CONFIG.STORAGE_KEYS.FAL_API_KEY, key);
}

/**
 * base64 이미지를 URL로 변환 (fal.ai는 URL 필요)
 */
function base64ToDataUrl(base64: string, mimeType: string = 'image/png'): string {
  return `data:${mimeType};base64,${base64}`;
}

/**
 * 이미지를 영상으로 변환 (PixVerse v5.5)
 *
 * @param imageBase64 - base64 인코딩된 이미지
 * @param motionPrompt - 움직임을 설명하는 프롬프트
 * @param apiKey - FAL API 키 (선택, 없으면 로컬스토리지에서 가져옴)
 * @returns 생성된 영상 URL 또는 null
 */
export async function generateVideoFromImage(
  imageBase64: string,
  motionPrompt: string,
  apiKey?: string
): Promise<string | null> {
  const key = apiKey || getFalApiKey();

  if (!key) {
    console.warn('[FAL] API 키가 설정되지 않았습니다.');
    return null;
  }

  try {
    // base64를 Blob으로 변환 후 fal.ai에 업로드
    const imageUrl = await uploadImageToFal(imageBase64, key);

    if (!imageUrl) {
      console.error('[FAL] 이미지 업로드 실패');
      return null;
    }

    console.log(`[FAL] PixVerse v5.5 영상 생성 시작: "${motionPrompt.slice(0, 50)}..."`);

    console.log('[FAL] API 요청 시작...');
    console.log('[FAL] 이미지 URL:', imageUrl?.slice(0, 100) + '...');

    const requestBody = {
      prompt: motionPrompt,
      image_url: imageUrl,
      duration: 5,              // 5초 영상
      aspect_ratio: '16:9',
      resolution: '720p',       // 720p 품질
      negative_prompt: 'blurry, low quality, low resolution, pixelated, noisy, grainy, distorted, static'
    };

    console.log('[FAL] 요청 바디:', JSON.stringify(requestBody).slice(0, 200) + '...');

    const response = await fetch('https://fal.run/fal-ai/pixverse/v5.5/image-to-video', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    console.log('[FAL] 응답 상태:', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[FAL] API 오류 (${response.status}):`, errorText);
      throw new Error(`FAL API 오류: ${response.status} - ${errorText.slice(0, 200)}`);
    }

    const result: PixVerseVideoResponse = await response.json();
    console.log(`[FAL] 영상 생성 완료: ${result.video.url}`);

    return result.video.url;

  } catch (error: any) {
    console.error('[FAL] 영상 생성 실패:', error.message);
    return null;
  }
}

/**
 * base64 이미지를 fal.ai 스토리지에 업로드
 */
async function uploadImageToFal(imageBase64: string, apiKey: string): Promise<string | null> {
  try {
    // base64를 Blob으로 변환
    const binaryString = atob(imageBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'image/png' });

    // fal.ai 파일 업로드 엔드포인트
    const formData = new FormData();
    formData.append('file', blob, 'image.png');

    const uploadResponse = await fetch('https://fal.run/fal-ai/storage/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${apiKey}`
      },
      body: formData
    });

    if (!uploadResponse.ok) {
      // 업로드 실패 시 data URL 폴백 시도
      console.warn('[FAL] 파일 업로드 실패, data URL 사용 시도');
      return base64ToDataUrl(imageBase64);
    }

    const uploadResult = await uploadResponse.json();
    return uploadResult.url;

  } catch (error) {
    console.warn('[FAL] 이미지 업로드 실패, data URL 사용');
    return base64ToDataUrl(imageBase64);
  }
}

/**
 * 영상 URL에서 base64 데이터로 변환 (로컬 저장용)
 */
export async function fetchVideoAsBase64(videoUrl: string): Promise<string | null> {
  try {
    const response = await fetch(videoUrl);
    if (!response.ok) return null;

    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Face Swap: 생성된 씬 이미지에 캐릭터 얼굴 교체
 * - fal-ai/face-swap 사용
 * - base_image: 씬 이미지 (얼굴이 교체될 대상)
 * - swap_image: 캐릭터 참조 이미지 (원본 얼굴)
 * @returns base64 결과 이미지 또는 null (실패 시 원본 반환용)
 */
export async function faceSwapCharacter(
  sceneImageBase64: string,    // 씬 이미지 (target)
  faceRefBase64: string,       // 캐릭터 얼굴 (source)
  apiKey?: string
): Promise<string | null> {
  const key = apiKey || getFalApiKey();
  if (!key) {
    console.warn('[FaceSwap] FAL API 키 없음, 스킵');
    return null;
  }

  try {
    console.log('[FaceSwap] 얼굴 교체 시작...');

    // 두 이미지를 fal 스토리지에 업로드
    const [sceneUrl, faceUrl] = await Promise.all([
      uploadImageToFal(sceneImageBase64, key),
      uploadImageToFal(faceRefBase64, key),
    ]);

    if (!sceneUrl || !faceUrl) {
      console.warn('[FaceSwap] 이미지 업로드 실패');
      return null;
    }

    const response = await fetch('https://fal.run/fal-ai/face-swap', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        base_image_url: sceneUrl,   // 씬 이미지 (얼굴 교체 대상)
        swap_image_url: faceUrl,    // 참조 얼굴 이미지
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.warn(`[FaceSwap] API 오류 (${response.status}):`, err.slice(0, 200));
      return null;
    }

    const result = await response.json();
    const imageUrl = result?.image?.url || result?.images?.[0]?.url;
    if (!imageUrl) {
      console.warn('[FaceSwap] 결과 URL 없음');
      return null;
    }

    // URL → base64 변환
    const imgResp = await fetch(imageUrl);
    if (!imgResp.ok) return null;
    const blob = await imgResp.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const b64 = (reader.result as string).split(',')[1];
        console.log('[FaceSwap] 얼굴 교체 완료');
        resolve(b64);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });

  } catch (e: any) {
    console.warn('[FaceSwap] 실패 (원본 유지):', e.message);
    return null;
  }
}

/**
 * 텍스트 프롬프트로 영상 생성 (Kling v1.6 Standard)
 *
 * @param prompt - 영상 내용 설명 텍스트
 * @param apiKey - FAL API 키 (선택, 없으면 로컬스토리지에서 가져옴)
 * @returns 생성된 영상 URL 또는 null
 */
export async function generateTextToVideo(
  prompt: string,
  apiKey?: string
): Promise<string | null> {
  const key = apiKey || getFalApiKey();

  if (!key) {
    console.warn('[Kling] API 키가 설정되지 않았습니다.');
    return null;
  }

  try {
    console.log(`[Kling] 텍스트→영상 생성 시작: "${prompt.slice(0, 60)}..."`);

    const response = await fetch('https://fal.run/fal-ai/kling-video/v1.6/standard/text-to-video', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt,
        duration: '5',
        aspect_ratio: '16:9',
      })
    });

    console.log('[Kling] 응답 상태:', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Kling] API 오류 (${response.status}):`, errorText);
      throw new Error(`Kling API 오류: ${response.status} - ${errorText.slice(0, 200)}`);
    }

    const result = await response.json();
    const videoUrl = result?.video?.url;
    if (!videoUrl) {
      console.error('[Kling] 응답에 video.url 없음:', JSON.stringify(result).slice(0, 200));
      return null;
    }

    console.log(`[Kling] 영상 생성 완료: ${videoUrl}`);
    return videoUrl;

  } catch (error: any) {
    console.error('[Kling] 영상 생성 실패:', error.message);
    return null;
  }
}

/**
 * 여러 이미지를 순차적으로 영상 변환 (rate limit 고려)
 */
export async function batchGenerateVideos(
  assets: Array<{ imageData: string; visualPrompt: string }>,
  apiKey?: string,
  onProgress?: (index: number, total: number) => void
): Promise<(string | null)[]> {
  const results: (string | null)[] = [];
  const key = apiKey || getFalApiKey();

  for (let i = 0; i < assets.length; i++) {
    onProgress?.(i + 1, assets.length);

    const videoUrl = await generateVideoFromImage(
      assets[i].imageData,
      assets[i].visualPrompt,
      key
    );
    results.push(videoUrl);

    // API rate limit 방지 (1초 대기)
    if (i < assets.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return results;
}
