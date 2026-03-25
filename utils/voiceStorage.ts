/**
 * voiceStorage.ts
 *
 * 음성 관련 설정은 sessionStorage에 저장 → 브라우저 창마다 독립적으로 동작
 * API 키 등 전역 설정은 localStorage에 그대로 유지
 *
 * 새 탭/창을 열 때 localStorage의 값을 sessionStorage로 한 번 복사(seeding)하여
 * 이전 설정을 기본값으로 사용할 수 있도록 함.
 */

const VOICE_KEYS = new Set([
  'heaven_tts_provider',
  'heaven_el_voice',
  'heaven_el_model',
  'heaven_gemini_tts_voice',
  'heaven_gcloud_tts_voice',
  'heaven_azure_tts_voice',
  'heaven_azure_tts_region',
  'heaven_voice_speed',
  'heaven_voice_stability',
  'heaven_voice_style',
  'heaven_voice_tone',
  'heaven_voice_mood',
  'heaven_google_tts_tone_id',
  'heaven_google_tts_tone',
  'heaven_google_tts_mood_id',
  'heaven_google_tts_mood',
  'heaven_gcloud_tone_id',
  'heaven_gcloud_tone',
  'heaven_gcloud_mood_id',
  'heaven_gcloud_mood',
]);

const SESSION_INIT_FLAG = '__heaven_voice_session_init__';

// 탭/창 최초 로드 시 localStorage 값을 sessionStorage로 복사 (한 번만)
if (!sessionStorage.getItem(SESSION_INIT_FLAG)) {
  VOICE_KEYS.forEach(key => {
    const val = localStorage.getItem(key);
    if (val !== null) {
      sessionStorage.setItem(key, val);
    }
  });
  sessionStorage.setItem(SESSION_INIT_FLAG, '1');
}

/** 음성 설정 읽기: 음성 키는 sessionStorage, 나머지는 localStorage */
export function getVoiceSetting(key: string): string | null {
  return VOICE_KEYS.has(key)
    ? sessionStorage.getItem(key)
    : localStorage.getItem(key);
}

/** 음성 설정 쓰기: 음성 키는 localStorage + sessionStorage 모두 저장 (영구 유지) */
export function setVoiceSetting(key: string, value: string): void {
  if (VOICE_KEYS.has(key)) {
    localStorage.setItem(key, value);
    sessionStorage.setItem(key, value);
  } else {
    localStorage.setItem(key, value);
  }
}

/** 음성 설정 삭제 */
export function removeVoiceSetting(key: string): void {
  if (VOICE_KEYS.has(key)) {
    sessionStorage.removeItem(key);
  } else {
    localStorage.removeItem(key);
  }
}
