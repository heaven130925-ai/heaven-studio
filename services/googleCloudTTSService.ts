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

/** 톤/분위기 → SSML prosody 파라미터 매핑 */
function buildProsodyAttrs(toneId: string, moodId: string): string {
  const toneMap: Record<string, { pitch?: string; rate?: string }> = {
    '낮은톤':  { pitch: '-3st', rate: '-5%' },
    '차분한':  { pitch: '-1st', rate: '-8%' },
    '밝은톤':  { pitch: '+2st', rate: '+5%' },
    '활기찬':  { pitch: '+3st', rate: '+10%' },
  };
  const moodMap: Record<string, { pitch?: string; rate?: string; volume?: string }> = {
    '친근하게':     { volume: '+2dB' },
    '따뜻하게':     { pitch: '-0.5st', volume: '+1dB' },
    '뉴스형식':     { rate: '-5%', pitch: 'medium' },
    '부드럽게':     { volume: '-2dB', rate: '-5%' },
    '부드럽고강하게': { volume: '+3dB', rate: '-3%' },
    '강하고따뜻하게': { pitch: '+1st', volume: '+3dB' },
    '심각하게':     { pitch: '-2st', rate: '-10%', volume: '-1dB' },
    '울면서':       { pitch: '-2st', rate: '-15%', volume: '-3dB' },
  };
  const tone = toneMap[toneId] || {};
  const mood = moodMap[moodId] || {};
  const merged = { ...mood, ...tone }; // tone 우선
  if (!Object.keys(merged).length) return '';
  return Object.entries(merged).map(([k, v]) => `${k}="${v}"`).join(' ');
}

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
  const toneId = localStorage.getItem('heaven_gcloud_tone_id') || '';
  const moodId = localStorage.getItem('heaven_gcloud_mood_id') || '';
  const prosodyAttrs = buildProsodyAttrs(toneId, moodId);

  const rateAttr = `rate="${Math.round(voiceSpeed * 100)}%"`;
  const ssml = prosodyAttrs
    ? `<speak><prosody ${rateAttr} ${prosodyAttrs}>${text}</prosody></speak>`
    : `<speak><prosody ${rateAttr}>${text}</prosody></speak>`;

  const body = {
    input: { ssml },
    voice: { languageCode: 'ko-KR', name: voiceName },
    audioConfig: {
      audioEncoding: 'MP3',
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
