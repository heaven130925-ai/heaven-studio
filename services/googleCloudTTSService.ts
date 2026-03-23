import { CONFIG } from '../config';
import { getVoiceSetting } from '../utils/voiceStorage';

export interface GCloudVoice {
  id: string;
  label: string;
  gender: 'male' | 'female';
  tier: 'Neural2' | 'Wavenet';
}

export const GCLOUD_KO_VOICES: GCloudVoice[] = [
  // Neural2 — 가장 자연스러운 AI 음성 (한국어 A/B/C만 존재)
  { id: 'ko-KR-Neural2-A', label: 'Neural2-A (여성)', gender: 'female', tier: 'Neural2' },
  { id: 'ko-KR-Neural2-B', label: 'Neural2-B (여성)', gender: 'female', tier: 'Neural2' },
  { id: 'ko-KR-Neural2-C', label: 'Neural2-C (남성)', gender: 'male',   tier: 'Neural2' },
  // Wavenet — 고품질 신경망 음성
  { id: 'ko-KR-Wavenet-A', label: 'Wavenet-A (여성)', gender: 'female', tier: 'Wavenet' },
  { id: 'ko-KR-Wavenet-B', label: 'Wavenet-B (여성)', gender: 'female', tier: 'Wavenet' },
  { id: 'ko-KR-Wavenet-C', label: 'Wavenet-C (남성)', gender: 'male',   tier: 'Wavenet' },
  { id: 'ko-KR-Wavenet-D', label: 'Wavenet-D (남성)', gender: 'male',   tier: 'Wavenet' },
  // Standard — 기본 TTS (가격 저렴, 4가지 추가 음색)
  { id: 'ko-KR-Standard-A', label: 'Standard-A (여성)', gender: 'female', tier: 'Wavenet' },
  { id: 'ko-KR-Standard-B', label: 'Standard-B (여성)', gender: 'female', tier: 'Wavenet' },
  { id: 'ko-KR-Standard-C', label: 'Standard-C (남성)', gender: 'male',   tier: 'Wavenet' },
  { id: 'ko-KR-Standard-D', label: 'Standard-D (여성)', gender: 'female', tier: 'Wavenet' },
];

/** 톤/분위기 → audioConfig 파라미터 (SSML보다 안정적) */
function buildAudioParams(toneId: string, moodId: string, baseRate: number): { speakingRate: number; pitch: number; volumeGainDb: number } {
  // pitch 반음(semitone) — audioConfig.pitch 범위: -20~+20
  const tonePitch: Record<string, number> = {
    '낮은톤': -3, '차분한': -2, '밝은톤': +2, '활기찬': +3,
  };
  const moodPitch: Record<string, number> = {
    '친근하게': +1, '따뜻하게': -1, '뉴스형식': 0,
    '부드럽게': -1, '부드럽고강하게': -1, '강하고따뜻하게': +1,
    '심각하게': -2, '울면서': -2,
  };
  // speakingRate 배율 누적 (audioConfig.speakingRate: 0.25~4.0)
  const toneRateDelta: Record<string, number> = {
    '낮은톤': -0.05, '차분한': -0.1, '밝은톤': +0.08, '활기찬': +0.15,
  };
  const moodRateDelta: Record<string, number> = {
    '친근하게': +0.05, '따뜻하게': -0.05, '뉴스형식': -0.08,
    '부드럽게': -0.12, '부드럽고강하게': -0.05, '강하고따뜻하게': +0.05,
    '심각하게': -0.15, '울면서': -0.18,
  };
  const moodVolume: Record<string, number> = {
    '친근하게': 1.5, '따뜻하게': 1, '뉴스형식': 0,
    '부드럽게': -2, '부드럽고강하게': 3, '강하고따뜻하게': 3,
    '심각하게': -1, '울면서': -3,
  };

  const pitch = Math.max(-6, Math.min(6, (tonePitch[toneId] || 0) + (moodPitch[moodId] || 0)));
  const speakingRate = Math.max(0.75, Math.min(1.8, baseRate + (toneRateDelta[toneId] || 0) + (moodRateDelta[moodId] || 0)));
  const volumeGainDb = moodVolume[moodId] || 0;

  return { speakingRate, pitch, volumeGainDb };
}

/**
 * Google Cloud TTS REST API로 MP3 오디오 생성
 * - API 키는 localStorage에서 읽음
 * - 반환: base64 MP3 문자열 (data: prefix 없음)
 */
export const generateGCloudTTS = async (text: string): Promise<string | null> => {
  const apiKey = localStorage.getItem(CONFIG.STORAGE_KEYS.GCLOUD_TTS_API_KEY) || '';
  if (!apiKey) return null;

  const voiceName = getVoiceSetting(CONFIG.STORAGE_KEYS.GCLOUD_TTS_VOICE) || 'ko-KR-Neural2-A';
  const voiceSpeed = parseFloat(getVoiceSetting(CONFIG.STORAGE_KEYS.VOICE_SPEED) || '1.0');
  const toneId = getVoiceSetting('heaven_gcloud_tone_id') || '';
  const moodId = getVoiceSetting('heaven_gcloud_mood_id') || '';
  const { speakingRate, pitch, volumeGainDb } = buildAudioParams(toneId, moodId, voiceSpeed);

  const body = {
    input: { text },
    voice: { languageCode: 'ko-KR', name: voiceName },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate,
      pitch,
      ...(volumeGainDb !== 0 && { volumeGainDb }),
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

  const voiceSpeed = parseFloat(getVoiceSetting(CONFIG.STORAGE_KEYS.VOICE_SPEED) || '1.0');
  const toneId = getVoiceSetting('heaven_gcloud_tone_id') || '';
  const moodId = getVoiceSetting('heaven_gcloud_mood_id') || '';
  const { speakingRate, pitch, volumeGainDb } = buildAudioParams(toneId, moodId, voiceSpeed);

  const body = {
    input: { text },
    voice: { languageCode: 'ko-KR', name: voiceName },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate,
      pitch,
      ...(volumeGainDb !== 0 && { volumeGainDb }),
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

  if (!res.ok) return null;
  const data = await res.json();
  return data.audioContent || null;
};
