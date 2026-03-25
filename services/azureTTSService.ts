import { CONFIG } from '../config';
import { getVoiceSetting } from '../utils/voiceStorage';

export interface AzureVoice {
  id: string;
  label: string;
  gender: 'male' | 'female';
}

export const AZURE_KO_VOICES: AzureVoice[] = [
  { id: 'ko-KR-SunHiNeural',           label: 'SunHi (여성, 기본)',     gender: 'female' },
  { id: 'ko-KR-InJoonNeural',          label: 'InJoon (남성)',          gender: 'male'   },
  { id: 'ko-KR-JiMinNeural',           label: 'JiMin (여성, 활기찬)',    gender: 'female' },
  { id: 'ko-KR-SeoHyeonNeural',        label: 'SeoHyeon (여성, 차분)',  gender: 'female' },
  { id: 'ko-KR-YuJinNeural',           label: 'YuJin (여성)',           gender: 'female' },
  { id: 'ko-KR-BongJinNeural',         label: 'BongJin (남성)',         gender: 'male'   },
  { id: 'ko-KR-GookMinNeural',         label: 'GookMin (남성)',         gender: 'male'   },
  { id: 'ko-KR-SoonBokNeural',         label: 'SoonBok (여성, 노인)',   gender: 'female' },
  { id: 'ko-KR-HyunsuMultilingualNeural', label: 'Hyunsu (남성, 다국어)', gender: 'male' },
];

/**
 * Azure TTS REST API로 MP3 오디오 생성
 * 반환: base64 MP3 문자열
 */
export const generateAzureTTS = async (text: string): Promise<string | null> => {
  const apiKey = localStorage.getItem(CONFIG.STORAGE_KEYS.AZURE_TTS_API_KEY) || '';
  const region  = getVoiceSetting(CONFIG.STORAGE_KEYS.AZURE_TTS_REGION)  || '';
  if (!apiKey || !region) return null;

  const voice = getVoiceSetting(CONFIG.STORAGE_KEYS.AZURE_TTS_VOICE) || 'ko-KR-SunHiNeural';
  const speed = parseFloat(getVoiceSetting(CONFIG.STORAGE_KEYS.VOICE_SPEED) || '1.0');
  const speedPct = `${Math.round(speed * 100)}%`;

  const ssml = `<speak version='1.0' xml:lang='ko-KR'>
  <voice name='${voice}'>
    <prosody rate='${speedPct}'>${escapeXml(text)}</prosody>
  </voice>
</speak>`;

  const res = await fetch(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
      },
      body: ssml,
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Azure TTS 오류 ${res.status}: ${err}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 65536) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 65536));
  }
  return btoa(binary);
};

/**
 * Azure TTS 미리듣기
 */
export const previewAzureTTS = async (text: string, voiceName: string): Promise<string | null> => {
  const apiKey = localStorage.getItem(CONFIG.STORAGE_KEYS.AZURE_TTS_API_KEY) || '';
  const region  = getVoiceSetting(CONFIG.STORAGE_KEYS.AZURE_TTS_REGION)  || '';
  if (!apiKey || !region) return null;

  const ssml = `<speak version='1.0' xml:lang='ko-KR'>
  <voice name='${voiceName}'>${escapeXml(text)}</voice>
</speak>`;

  const res = await fetch(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
      },
      body: ssml,
    }
  );

  if (!res.ok) return null;
  const arrayBuffer = await res.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 65536) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 65536));
  }
  return btoa(binary);
};

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
