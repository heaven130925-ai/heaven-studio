import { CONFIG } from '../config';

export interface GCloudVoice {
  id: string;
  label: string;
  gender: 'male' | 'female';
  tier: 'Neural2' | 'Wavenet';
}

export const GCLOUD_KO_VOICES: GCloudVoice[] = [
  { id: 'ko-KR-Neural2-A', label: 'Neural2-A (여성)', gender: 'female', tier: 'Neural2' },
  { id: 'ko-KR-Neural2-B', label: 'Neural2-B (남성)', gender: 'male',   tier: 'Neural2' },
  { id: 'ko-KR-Neural2-C', label: 'Neural2-C (여성)', gender: 'female', tier: 'Neural2' },
  { id: 'ko-KR-Neural2-D', label: 'Neural2-D (남성)', gender: 'male',   tier: 'Neural2' },
  { id: 'ko-KR-Wavenet-A', label: 'Wavenet-A (여성)', gender: 'female', tier: 'Wavenet' },
  { id: 'ko-KR-Wavenet-B', label: 'Wavenet-B (남성)', gender: 'male',   tier: 'Wavenet' },
  { id: 'ko-KR-Wavenet-C', label: 'Wavenet-C (남성)', gender: 'male',   tier: 'Wavenet' },
  { id: 'ko-KR-Wavenet-D', label: 'Wavenet-D (여성)', gender: 'female', tier: 'Wavenet' },
];

/**
 * Google Cloud TTS REST API로 MP3 오디오 생성
 * - API 키는 localStorage에서 읽음
 * - 반환: base64 MP3 문자열 (data: prefix 없음)
 */
export const generateGCloudTTS = async (text: string): Promise<string | null> => {
  const apiKey = localStorage.getItem(CONFIG.STORAGE_KEYS.GCLOUD_TTS_API_KEY) || '';
  if (!apiKey) return null;

  const voiceName = localStorage.getItem(CONFIG.STORAGE_KEYS.GCLOUD_TTS_VOICE) || 'ko-KR-Neural2-A';
  const voiceSpeed = parseFloat(localStorage.getItem(CONFIG.STORAGE_KEYS.VOICE_SPEED) || '1.0');

  const body = {
    input: { text },
    voice: { languageCode: 'ko-KR', name: voiceName },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: voiceSpeed,
    },
  };

  const res = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Cloud TTS 오류: ${err}`);
  }

  const data = await res.json();
  return data.audioContent || null; // base64 MP3
};

/**
 * Google Cloud TTS 미리듣기
 */
export const previewGCloudTTS = async (text: string, voiceName: string): Promise<string | null> => {
  const apiKey = localStorage.getItem(CONFIG.STORAGE_KEYS.GCLOUD_TTS_API_KEY) || '';
  if (!apiKey) return null;

  const body = {
    input: { text },
    voice: { languageCode: 'ko-KR', name: voiceName },
    audioConfig: { audioEncoding: 'MP3' },
  };

  const res = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) return null;
  const data = await res.json();
  return data.audioContent || null;
};
