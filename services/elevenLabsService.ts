
import { CONFIG, ElevenLabsModelId } from "../config";
import { SubtitleData, SubtitleWord, MeaningChunk } from "../types";
import { splitSubtitleByMeaning } from "./geminiService";
import { getVoiceSetting, setVoiceSetting } from "../utils/voiceStorage";

/**
 * ElevenLabs API Service
 * 타임스탬프 포함 버전 - 자막 데이터 동시 생성
 */

const OUTPUT_FORMAT = "mp3_44100_128";

/**
 * 저장된 ElevenLabs 모델 ID 가져오기
 */
export const getElevenLabsModelId = (): ElevenLabsModelId => {
  const saved = getVoiceSetting(CONFIG.STORAGE_KEYS.ELEVENLABS_MODEL);
  return (saved as ElevenLabsModelId) || CONFIG.DEFAULT_ELEVENLABS_MODEL;
};

/**
 * ElevenLabs 모델 ID 저장
 */
export const setElevenLabsModelId = (modelId: ElevenLabsModelId): void => {
  setVoiceSetting(CONFIG.STORAGE_KEYS.ELEVENLABS_MODEL, modelId);
};

export interface ElevenLabsResult {
  audioData: string | null;
  subtitleData: SubtitleData | null;
  estimatedDuration: number | null;  // 추정 오디오 길이 (초)
}

/**
 * 문자 단위 타임스탬프를 단어 단위로 변환
 */
function convertToWords(
  characters: string[],
  startTimes: number[],
  endTimes: number[]
): SubtitleWord[] {
  const words: SubtitleWord[] = [];
  let currentWord = '';
  let wordStart = 0;
  let wordEnd = 0;

  for (let i = 0; i < characters.length; i++) {
    const char = characters[i];

    if (char === ' ' || char === '\n' || char === '\t') {
      // 공백을 만나면 현재 단어 저장
      if (currentWord.length > 0) {
        words.push({
          word: currentWord,
          start: wordStart,
          end: wordEnd
        });
        currentWord = '';
      }
    } else {
      // 새 단어 시작
      if (currentWord.length === 0) {
        wordStart = startTimes[i];
      }
      currentWord += char;
      wordEnd = endTimes[i];
    }
  }

  // 마지막 단어 저장
  if (currentWord.length > 0) {
    words.push({
      word: currentWord,
      start: wordStart,
      end: wordEnd
    });
  }

  return words;
}

/**
 * AI 의미 단위 분리 + 단어 타이밍 매핑
 * - Gemini AI로 의미 단위 분리
 * - 분리된 청크와 ElevenLabs 단어 타이밍을 매핑
 * - 각 청크의 시작/끝 시간 계산
 */
function charBasedSplit(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + maxChars, text.length);
    // Try to break at a space or punctuation
    if (end < text.length) {
      const breakAt = text.lastIndexOf(' ', end);
      if (breakAt > i) end = breakAt + 1;
    }
    chunks.push(text.slice(i, end).trim());
    i = end;
  }
  return chunks.filter(c => c.length > 0);
}

async function createMeaningChunks(
  fullText: string,
  words: SubtitleWord[]
): Promise<MeaningChunk[]> {
  if (words.length === 0) return [];

  // AI 기반 의미 단위 분리 (실패 시 글자수 기반 폴백)
  let textChunks: string[];
  try {
    textChunks = await splitSubtitleByMeaning(fullText, 20);
  } catch (e) {
    console.warn('[MeaningChunks] AI 분리 실패, 글자수 기반 폴백 사용:', e);
    textChunks = charBasedSplit(fullText, 18);
  }

  if (textChunks.length === 0) {
    textChunks = charBasedSplit(fullText, 18);
  }
  if (textChunks.length === 0) return [];

  const meaningChunks: MeaningChunk[] = [];
  let wordIndex = 0;

  for (const chunkText of textChunks) {
    // 청크에 포함된 단어 수 계산 (공백 제거 후 비교)
    const chunkWords = chunkText.split(/\s+/).filter(w => w.length > 0);
    const chunkWordCount = chunkWords.length;

    if (chunkWordCount === 0) continue;

    // 시작 인덱스 저장
    const startWordIndex = wordIndex;

    // 청크에 해당하는 단어들 찾기
    let matchedWords = 0;
    while (wordIndex < words.length && matchedWords < chunkWordCount) {
      matchedWords++;
      wordIndex++;
    }

    // 매칭된 단어가 있으면 청크 생성
    if (startWordIndex < words.length) {
      const endWordIndex = Math.min(wordIndex - 1, words.length - 1);

      meaningChunks.push({
        text: chunkText,
        startTime: words[startWordIndex].start,
        endTime: words[endWordIndex].end
      });
    }
  }

  // 청크 간 간격 제거: endTime을 다음 청크의 startTime까지 연장
  for (let i = 0; i < meaningChunks.length - 1; i++) {
    meaningChunks[i].endTime = meaningChunks[i + 1].startTime;
  }

  return meaningChunks;
}

export const generateAudioWithElevenLabs = async (
  text: string,
  providedApiKey?: string,
  providedVoiceId?: string,
  providedModelId?: ElevenLabsModelId
): Promise<ElevenLabsResult> => {

  const savedApiKey = process.env.ELEVENLABS_API_KEY || localStorage.getItem(CONFIG.STORAGE_KEYS.ELEVENLABS_API_KEY);
  // sessionStorage(UI 선택)가 env 변수보다 우선 - 사용자가 UI에서 선택한 목소리를 존중
  const savedVoiceId = getVoiceSetting(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID) || process.env.ELEVENLABS_VOICE_ID;

  const finalKey = providedApiKey || savedApiKey;
  const finalVoiceId = providedVoiceId || savedVoiceId || CONFIG.DEFAULT_VOICE_ID;
  const finalModelId = providedModelId || getElevenLabsModelId();

  if (!finalKey || finalKey.length < 10) {
    console.warn("ElevenLabs API Key가 설정되지 않았습니다.");
    return { audioData: null, subtitleData: null, estimatedDuration: null };
  }

  try {
    // 타임스탬프 포함 엔드포인트 사용
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${finalVoiceId}/with-timestamps`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': finalKey,
      },
      body: JSON.stringify({
        text: text,
        model_id: finalModelId,
        output_format: OUTPUT_FORMAT,
        speed: (() => { const voiceSpeed = parseFloat(getVoiceSetting(CONFIG.STORAGE_KEYS.VOICE_SPEED) || '1.0'); return voiceSpeed; })(),
        voice_settings: {
          stability: parseInt(getVoiceSetting(CONFIG.STORAGE_KEYS.VOICE_STABILITY) || '50') / 100,
          similarity_boost: 0.75,
          style: parseInt(getVoiceSetting(CONFIG.STORAGE_KEYS.VOICE_STYLE) || '0') / 100,
          use_speaker_boost: true
        }
      }),
    });

    if (!response.ok) {
      const errorDetail = await response.text();
      console.error("ElevenLabs API Error:", errorDetail);
      return { audioData: null, subtitleData: null, estimatedDuration: null };
    }

    const jsonResponse = await response.json();

    // 오디오 데이터 (이미 base64로 옴)
    const audioBase64 = jsonResponse.audio_base64;

    // 타임스탬프 데이터 파싱
    let subtitleData: SubtitleData | null = null;
    let estimatedDuration: number | null = null;

    if (jsonResponse.alignment) {
      const { characters, character_start_times_seconds, character_end_times_seconds } = jsonResponse.alignment;

      const words = convertToWords(
        characters,
        character_start_times_seconds,
        character_end_times_seconds
      );

      subtitleData = {
        words,
        fullText: text
      };

      // 마지막 문자의 끝 시간 + 버퍼로 오디오 길이 추정
      // (오디오 끝에 약간의 무음이 있을 수 있으므로 0.3초 버퍼 추가)
      if (character_end_times_seconds && character_end_times_seconds.length > 0) {
        const lastCharEnd = character_end_times_seconds[character_end_times_seconds.length - 1];
        estimatedDuration = lastCharEnd + 0.3;
      }

      console.log(`[ElevenLabs] 모델: ${finalModelId}, 자막 데이터 생성 완료: ${words.length}개 단어, 추정 길이: ${estimatedDuration?.toFixed(2)}초`);

      // AI 의미 단위 분리 및 타이밍 매핑
      try {
        const meaningChunks = await createMeaningChunks(text, words);
        if (meaningChunks.length > 0) {
          subtitleData.meaningChunks = meaningChunks;
          console.log(`[ElevenLabs] AI 의미 단위 분리 완료: ${meaningChunks.length}개 청크`);
        }
      } catch (e) {
        console.warn('[ElevenLabs] AI 자막 분리 실패, 단어 기반 방식 사용:', e);
      }
    }

    return {
      audioData: audioBase64,
      subtitleData,
      estimatedDuration
    };

  } catch (error) {
    console.error("ElevenLabs Generation Failed:", error);
    return { audioData: null, subtitleData: null, estimatedDuration: null };
  }
};

/**
 * ElevenLabs Voice 정보 타입
 */
export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  labels?: {
    accent?: string;
    age?: string;
    gender?: string;
    description?: string;
    use_case?: string;
  };
  preview_url?: string;
}

/**
 * ElevenLabs에서 사용 가능한 음성 목록 가져오기
 */
export const fetchElevenLabsVoices = async (apiKey?: string): Promise<ElevenLabsVoice[]> => {
  // 환경변수 우선, 그 다음 localStorage
  const envKey = process.env.ELEVENLABS_API_KEY;
  const finalKey = apiKey || envKey || localStorage.getItem(CONFIG.STORAGE_KEYS.ELEVENLABS_API_KEY);

  if (!finalKey || finalKey.length < 10) {
    console.warn("ElevenLabs API Key가 설정되지 않았습니다.");
    return [];
  }

  try {
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      method: 'GET',
      headers: {
        'xi-api-key': finalKey,
      },
    });

    if (!response.ok) {
      const errorDetail = await response.text();
      console.error("ElevenLabs Voices API Error:", errorDetail);
      return [];
    }

    const data = await response.json();
    const voices: ElevenLabsVoice[] = data.voices || [];

    console.log(`[ElevenLabs] ${voices.length}개 음성 로드됨`);
    return voices;

  } catch (error) {
    console.error("ElevenLabs Voices Fetch Failed:", error);
    return [];
  }
};
