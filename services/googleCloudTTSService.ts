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

/** 톤/분위기 → SSML prosody — tone과 mood를 pitch/rate 수치로 합산 */
function buildProsody(toneId: string, moodId: string, baseRatePct: number): string {
  // pitch 반음(semitone) 누적
  const tonePitch: Record<string, number> = {
    '낮은톤': -3, '차분한': -2, '밝은톤': +2, '활기찬': +3,
  };
  const moodPitch: Record<string, number> = {
    '친근하게': +1, '따뜻하게': -1, '뉴스형식': 0,
    '부드럽게': -1, '부드럽고강하게': -1, '강하고따뜻하게': +1,
    '심각하게': -3, '울면서': -3,
  };
  // rate 퍼센트 누적
  const toneRate: Record<string, number> = {
    '낮은톤': -5, '차분한': -10, '밝은톤': +8, '활기찬': +15,
  };
  const moodRate: Record<string, number> = {
    '친근하게': +5, '따뜻하게': -5, '뉴스형식': -10,
    '부드럽게': -15, '부드럽고강하게': -5, '강하고따뜻하게': +5,
    '심각하게': -20, '울면서': -25,
  };
  // volume dB
  const moodVolume: Record<string, number> = {
    '친근하게': 2, '따뜻하게': 1, '뉴스형식': 0,
    '부드럽게': -3, '부드럽고강하게': 4, '강하고따뜻하게': 4,
    '심각하게': -1, '울면서': -4,
  };

  const rawPitch = (tonePitch[toneId] || 0) + (moodPitch[moodId] || 0);
  const pitchSt = Math.max(-4, Math.min(4, rawPitch)); // -4st ~ +4st 제한
  const ratePct = baseRatePct + (toneRate[toneId] || 0) + (moodRate[moodId] || 0);
  const volDb  = moodVolume[moodId] || 0;

  const pitchStr  = pitchSt !== 0 ? `pitch="${pitchSt > 0 ? '+' : ''}${pitchSt}st"` : '';
  const rateStr   = `rate="${Math.max(70, Math.min(180, ratePct))}%"`;
  const volumeStr = volDb !== 0 ? `volume="${volDb > 0 ? '+' : ''}${volDb}dB"` : '';

  return [rateStr, pitchStr, volumeStr].filter(Boolean).join(' ');
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
  const baseRatePct = Math.round(voiceSpeed * 100);
  const prosodyAttrs = buildProsody(toneId, moodId, baseRatePct);

  const ssml = `<speak><prosody ${prosodyAttrs}>${text}</prosody></speak>`;

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

  const voiceSpeed = parseFloat(getVoiceSetting(CONFIG.STORAGE_KEYS.VOICE_SPEED) || '1.0');
  const toneId = getVoiceSetting('heaven_gcloud_tone_id') || '';
  const moodId = getVoiceSetting('heaven_gcloud_mood_id') || '';
  const baseRatePct = Math.round(voiceSpeed * 100);
  const prosodyAttrs = buildProsody(toneId, moodId, baseRatePct);

  const body = {
    input: { ssml: `<speak><prosody ${prosodyAttrs}>${text}</prosody></speak>` },
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
