
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { ScriptScene, ReferenceImages } from "../types";
import { SYSTEM_INSTRUCTIONS, getTrendSearchPrompt, getScriptGenerationPrompt, getFinalVisualPrompt } from "./prompts";
import { CONFIG, GEMINI_STYLE_CATEGORIES, GeminiStyleId, VISUAL_STYLES } from "../config";
import { faceSwapCharacter } from "./falService";

/**
 * Gemini API 클라이언트 초기화
 */
const getGeminiApiKey = () =>
  localStorage.getItem('heaven_gemini_key') || process.env.GEMINI_API_KEY || '';

const getAI = () => new GoogleGenAI({ apiKey: getGeminiApiKey() });

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 안전 필터 우회를 위한 키워드 대체 맵
 * - 필터에 걸리기 쉬운 표현 → 안전한 동의어로 변환
 */
const KEYWORD_ALTERNATIVES: Record<string, string[]> = {
  // X-ray 관련
  'x-ray': ['transparent cutaway', 'see-through', 'translucent'],
  'x-ray view': ['transparent cutaway view', 'see-through view', 'cross-section view'],
  'xray': ['transparent', 'see-through', 'translucent'],

  // 의료/해부 관련
  'dissection': ['cross-section', 'cutaway'],
  'anatomy': ['internal structure', 'inner components'],
  'surgical': ['precise', 'detailed'],

  // 무기/폭발 관련 (경제 뉴스에서 은유로 쓰일 수 있음)
  'explosion': ['burst', 'rapid expansion', 'dramatic surge'],
  'bomb': ['impact', 'dramatic event'],
  'crash': ['sharp decline', 'sudden drop'],

  // 기타 민감 표현
  'naked': ['bare', 'exposed', 'uncovered'],
  'blood': ['red liquid', 'crimson'],
  'death': ['end', 'decline', 'fall'],
  'kill': ['eliminate', 'end', 'stop'],
};

/**
 * 나레이션에서 섹션 마커(파트1:, 씬1:, 나레이션: 등)를 제거
 */
const cleanNarration = (text: string): string => {
  return text
    // 청크 지시문 전체 제거 (멀티라인 포함): [파트 3/6 - 전체 대본의 일부입니다. 이 파트의 내용만 시각화하세요.]
    .replace(/\[파트\s*\d+\/\d+[\s\S]*?\]\s*/gi, '')
    // AI가 [파트 부분만 제거하고 /N - ...] 남긴 경우: /3 - 전체 대본의 일부입니다...] 제거
    .replace(/\/\d+\s*-[^\]]*\]\s*/gi, '')
    // 전체 대본 관련 문구가 포함된 줄 전체 제거
    .replace(/^.*전체 대본의 일부.*$/gim, '')
    .replace(/^.*이 파트의 내용만.*$/gim, '')
    // 파트N: / 파트 N: / [파트N] / [파트 N]
    .replace(/^[\[【]?\s*파트\s*\d+\s*[\]】]?\s*[:：]?\s*/gim, '')
    // 씬N: / 씬 N: / [씬N]
    .replace(/^[\[【]?\s*씬\s*\d+\s*[\]】]?\s*[:：]?\s*/gim, '')
    // 나레이션N: / 나레이션:
    .replace(/^나레이션\s*\d*\s*[:：]\s*/gim, '')
    // Part N: / Section N: (영문)
    .replace(/^(Part|Section|Scene|Chapter)\s*\d+\s*[:：]?\s*/gim, '')
    // [숫자] 또는 숫자. 로 시작하는 섹션 번호
    .replace(/^\[\d+\]\s*/gim, '')
    .trim();
};

/**
 * 프롬프트에서 민감한 키워드를 안전한 대체어로 변환
 */
const sanitizePrompt = (prompt: string, attemptIndex: number = 0): string => {
  let sanitized = prompt.toLowerCase();
  let result = prompt;

  for (const [keyword, alternatives] of Object.entries(KEYWORD_ALTERNATIVES)) {
    const regex = new RegExp(keyword, 'gi');
    if (regex.test(sanitized)) {
      // attemptIndex에 따라 다른 대체어 선택 (재시도마다 다른 표현 시도)
      const altIndex = attemptIndex % alternatives.length;
      result = result.replace(regex, alternatives[altIndex]);
      sanitized = result.toLowerCase();
    }
  }

  return result;
};

/**
 * JSON 응답 텍스트 정리 - 불완전한 응답 복구 기능 포함
 */
const cleanJsonResponse = (text: string): string => {
  if (!text) {
    console.error('[JSON Clean] 빈 응답 수신');
    return '[]';
  }

  let cleaned = text.trim();
  const originalLength = cleaned.length;

  // 마크다운 코드 블록 제거
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }

  cleaned = cleaned.trim();

  // JSON 배열/객체 시작과 끝 찾기
  const firstBracket = cleaned.search(/[\[{]/);

  if (firstBracket === -1) {
    console.warn('[JSON Clean] JSON 시작 브래킷을 찾을 수 없음:', cleaned.slice(0, 100));
    return '[]';
  }

  // 배열인지 객체인지 판별
  const isArray = cleaned[firstBracket] === '[';

  // 중첩 레벨을 추적하며 올바른 닫는 브래킷 찾기 (문자열 내부 무시)
  let depth = 0;
  let lastValidIndex = -1;
  let inString = false;
  let escapeNext = false;

  for (let i = firstBracket; i < cleaned.length; i++) {
    const char = cleaned[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '[' || char === '{') depth++;
    if (char === ']' || char === '}') {
      depth--;
      if (depth === 0) {
        lastValidIndex = i;
        break;
      }
    }
  }

  if (lastValidIndex !== -1) {
    cleaned = cleaned.slice(firstBracket, lastValidIndex + 1);
  } else {
    // JSON이 불완전함 - 복구 시도
    console.warn(`[JSON Clean] JSON이 불완전함 (원본 ${originalLength}자). 복구 시도 중...`);
    cleaned = cleaned.slice(firstBracket);

    // 마지막 완전한 씬 객체까지 자르기
    const lastCompleteEnd = findLastCompleteSceneObject(cleaned);
    if (lastCompleteEnd > 0) {
      cleaned = cleaned.slice(0, lastCompleteEnd);
      // scenes 배열 내부라면 배열과 객체 닫기
      if (cleaned.includes('"scenes"')) {
        cleaned += ']}';
      } else {
        cleaned += ']';
      }
      console.warn(`[JSON Clean] 복구 완료. ${lastCompleteEnd}자 위치까지 복구됨`);
    } else {
      console.error('[JSON Clean] 복구 불가능');
      return '[]';
    }
  }

  return cleaned.trim();
};

/**
 * 마지막 완전한 씬 객체의 끝 위치 찾기
 * - "sceneNumber" 또는 완전한 "}," 패턴을 찾아 역방향 탐색
 */
function findLastCompleteSceneObject(json: string): number {
  // 역방향으로 완전한 객체 끝 "}," 또는 "}" 찾기
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let lastCompleteEnd = -1;

  for (let i = 0; i < json.length; i++) {
    const char = json[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      // depth가 1이면 scenes 배열 내의 씬 객체가 완료된 것
      if (depth === 1) {
        lastCompleteEnd = i + 1;
      }
    }
  }

  return lastCompleteEnd;
}

const retryGeminiRequest = async <T>(
  operationName: string,
  requestFn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 5000
): Promise<T> => {
  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (error: any) {
      lastError = error;
      const errorMsg = error.message || JSON.stringify(error);
      const isQuotaError = errorMsg.includes('429') || errorMsg.includes('Quota') || error.status === 429;
      if (isQuotaError && attempt < maxRetries) {
        await wait(baseDelay * attempt);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};

// YouTube Data API로 바이럴 영상 기반 주제 추출
// - timeRange: 기간 필터 (3months/6months/1year/all)
// - 바이럴 지수 = 조회수 ÷ 구독자수 (구독자 대비 폭발적 조회수 우선)
export const findYouTubeTopics = async (
  category: string,
  channelIds: string[],
  timeRange: '3months' | '6months' | '1year' | 'all' = '6months'
): Promise<Array<{rank: number; topic: string; reason: string}>> => {
  const apiKey = localStorage.getItem('heaven_youtube_key') || '';
  if (!apiKey) throw new Error('YouTube API 키가 없습니다. 설정에서 입력해주세요.');

  const BASE = 'https://www.googleapis.com/youtube/v3';

  // 기간 계산
  let publishedAfter = '';
  if (timeRange !== 'all') {
    const d = new Date();
    if (timeRange === '3months') d.setMonth(d.getMonth() - 3);
    else if (timeRange === '6months') d.setMonth(d.getMonth() - 6);
    else if (timeRange === '1year') d.setFullYear(d.getFullYear() - 1);
    publishedAfter = d.toISOString();
  }

  // 1단계: @핸들 또는 URL → 채널 ID 변환
  const resolveChannelId = async (input: string): Promise<string | null> => {
    const raw = input.trim();
    // 이미 채널 ID (UC로 시작하는 경우)
    if (raw.startsWith('UC') && raw.length > 20) return raw;
    // URL에서 핸들 추출: youtube.com/@handle 또는 @handle
    const handleMatch = raw.match(/(?:youtube\.com\/)?@([\w\-]+)/);
    if (handleMatch) {
      const qs = new URLSearchParams({ part: 'id', forHandle: `@${handleMatch[1]}`, key: apiKey });
      const res = await fetch(`${BASE}/channels?${qs}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.items?.[0]?.id || null;
    }
    // URL에서 /channel/UCxxx 추출
    const idMatch = raw.match(/\/channel\/(UC[\w\-]+)/);
    if (idMatch) return idMatch[1];
    return null;
  };

  // 2단계: 영상 검색
  const allVideoIds: string[] = [];
  const videoChannelMap: Record<string, string> = {};
  const videoTitles: Record<string, string> = {};

  const searchItems = async (params: Record<string, string>) => {
    const qs = new URLSearchParams({ ...params, key: apiKey, ...(publishedAfter ? { publishedAfter } : {}) });
    const res = await fetch(`${BASE}/search?${qs}`);
    if (!res.ok) throw new Error(`YouTube 검색 오류: ${res.status}`);
    return (await res.json()).items || [];
  };

  if (channelIds.length > 0) {
    // @핸들/URL → 실제 채널ID로 변환
    const resolvedIds = (await Promise.all(channelIds.slice(0, 4).map(resolveChannelId))).filter(Boolean) as string[];
    if (resolvedIds.length === 0) throw new Error('채널을 찾지 못했습니다. @핸들을 확인해주세요.');
    for (const channelId of resolvedIds) {
      const items = await searchItems({ part: 'snippet', channelId, type: 'video', maxResults: '30', order: 'date' });
      for (const item of items) {
        const vid = item.id?.videoId; if (!vid) continue;
        allVideoIds.push(vid);
        videoChannelMap[vid] = item.snippet?.channelId || '';
        videoTitles[vid] = item.snippet?.title || '';
      }
    }
  } else {
    const items = await searchItems({ part: 'snippet', q: category, type: 'video', maxResults: '50', order: 'viewCount', regionCode: 'KR', relevanceLanguage: 'ko' });
    for (const item of items) {
      const vid = item.id?.videoId; if (!vid) continue;
      allVideoIds.push(vid);
      videoChannelMap[vid] = item.snippet?.channelId || '';
      videoTitles[vid] = item.snippet?.title || '';
    }
  }

  if (allVideoIds.length === 0) throw new Error('해당 기간에 영상을 찾지 못했습니다.');

  // 2단계: 영상 조회수 배치 조회
  const videoStats: Record<string, number> = {};
  for (let i = 0; i < allVideoIds.length; i += 50) {
    const chunk = allVideoIds.slice(i, i + 50);
    const qs = new URLSearchParams({ part: 'statistics', id: chunk.join(','), key: apiKey });
    const res = await fetch(`${BASE}/videos?${qs}`);
    if (!res.ok) continue;
    for (const item of (await res.json()).items || []) {
      videoStats[item.id] = parseInt(item.statistics?.viewCount || '0');
    }
  }

  // 3단계: 채널 구독자수 배치 조회
  const uniqueChannelIds = [...new Set(Object.values(videoChannelMap))].filter(Boolean);
  const channelStats: Record<string, number> = {};
  for (let i = 0; i < uniqueChannelIds.length; i += 50) {
    const chunk = uniqueChannelIds.slice(i, i + 50);
    const qs = new URLSearchParams({ part: 'statistics', id: chunk.join(','), key: apiKey });
    const res = await fetch(`${BASE}/channels?${qs}`);
    if (!res.ok) continue;
    for (const item of (await res.json()).items || []) {
      channelStats[item.id] = parseInt(item.statistics?.subscriberCount || '1');
    }
  }

  // 4단계: 바이럴 지수 계산 (조회수 ÷ 구독자수) → 정렬
  const viralVideos = allVideoIds
    .map(vid => {
      const views = videoStats[vid] || 0;
      const subs = Math.max(channelStats[videoChannelMap[vid]] || 1, 1);
      return { title: videoTitles[vid], views, subs, viralRatio: Math.round(views / subs) };
    })
    .filter(v => v.views > 0)
    .sort((a, b) => b.viralRatio - a.viralRatio)
    .slice(0, 20);

  if (viralVideos.length === 0) throw new Error('통계 데이터를 가져오지 못했습니다.');

  // 5단계: Gemini로 바이럴 패턴 분석 → 새 주제 추천
  const ai = getAI();
  const videoList = viralVideos.map((v, i) =>
    `${i + 1}. "${v.title}" — 조회수 ${v.views.toLocaleString()} / 구독자 ${v.subs.toLocaleString()} → 바이럴 지수 ${v.viralRatio}배`
  ).join('\n');

  const prompt = `다음은 "${category}" 카테고리에서 바이럴 지수(조회수÷구독자) 기준 상위 유튜브 영상들입니다 (기간: ${timeRange === 'all' ? '전체' : timeRange === '1year' ? '최근 1년' : timeRange === '6months' ? '최근 6개월' : '최근 3개월'}):

${videoList}

바이럴 지수가 높을수록 구독자 수에 비해 폭발적인 조회수를 얻은 영상입니다.
이 영상들의 성공 패턴을 분석해서, 비슷한 방식으로 새 영상에서 다룰 수 있는 참신한 주제 10개를 추천해주세요.
제목을 그대로 복사하지 말고 영감을 받아 새 주제로 만드세요.

JSON 배열로만:
[{"rank":1,"topic":"주제 제목","reason":"바이럴 패턴 분석 포함한 이유"},...]`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: { responseMimeType: 'application/json' },
  });
  return JSON.parse(cleanJsonResponse(response.text));
};

export const findTrendingTopics = async (category: string, usedTopics: string[]) => {
  return retryGeminiRequest("Trend Search", async () => {
    const ai = getAI();
    const prompt = getTrendSearchPrompt(category, usedTopics.join(", "));
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTIONS.TREND_RESEARCHER,
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json"
      },
    });
    return JSON.parse(cleanJsonResponse(response.text));
  });
};

/**
 * 단일 청크에 대한 스크립트 생성 (내부 함수)
 * - maxOutputTokens 동적 계산
 * - 응답 잘림 감지
 */
/**
 * 텍스트를 문장 단위로 분리 (한국어 + 영어 혼합 대응)
 */
function splitIntoSentences(text: string): string[] {
  return text
    .split(/\n+/)                              // 줄바꿈 우선
    .flatMap(line =>
      line.split(/(?<=[.!?。])\s+/)           // 문장 끝 기호 + 공백
    )
    .map(s => s.trim())
    .filter(s => s.length > 3);               // 너무 짧은 단편 제거
}

/**
 * 문장 배열을 N개 블록으로 분배 — 글자 수 기준 균등 분배
 * (문장 개수 기준은 긴 문장/짧은 문장 혼재 시 나레이션 길이 불균등 문제 발생)
 */
function groupSentencesIntoBlocks(sentences: string[], blockCount: number): string[] {
  const totalChars = sentences.reduce((sum, s) => sum + s.length, 0);
  const targetCharsPerBlock = totalChars / blockCount;

  const blocks: string[] = [];
  let current: string[] = [];
  let currentChars = 0;

  for (const sentence of sentences) {
    current.push(sentence);
    currentChars += sentence.length;
    // 목표 글자 수 도달 && 아직 블록 여유 있으면 블록 확정
    if (currentChars >= targetCharsPerBlock && blocks.length < blockCount - 1) {
      blocks.push(current.join(' ').trim());
      current = [];
      currentChars = 0;
    }
  }
  // 나머지 문장을 마지막 블록으로
  if (current.length > 0) blocks.push(current.join(' ').trim());

  return blocks;
}

const generateScriptSingle = async (
  topic: string,
  hasReferenceImage: boolean,
  sourceContext?: string | null,
  chunkInfo?: { current: number; total: number },
  maxScenes?: number
): Promise<ScriptScene[]> => {
  return retryGeminiRequest("Script Generation", async () => {
    const baseInstruction = topic === "Manual Script Input" ? SYSTEM_INSTRUCTIONS.MANUAL_VISUAL_MATCHER :
                            hasReferenceImage ? SYSTEM_INSTRUCTIONS.REFERENCE_MATCH :
                            SYSTEM_INSTRUCTIONS.CHIEF_ART_DIRECTOR;

    const chunkLabel = chunkInfo ? `[청크 ${chunkInfo.current}/${chunkInfo.total}] ` : '';

    // ─── JS 사전 분할: maxScenes가 있고 대본이 있을 때 JS에서 균등 분배 ───
    let contentForPrompt = sourceContext || null;
    let preSegmented = false;
    let targetSceneCount = maxScenes;

    if (maxScenes && sourceContext) {
      const sentences = splitIntoSentences(sourceContext);
      console.log(`${chunkLabel}[Script] 문장 수: ${sentences.length}개, 목표 씬: ${maxScenes}개`);

      if (sentences.length > 0) {
        const actualBlocks = Math.min(maxScenes, sentences.length);
        const blocks = groupSentencesIntoBlocks(sentences, actualBlocks);
        // [SCENE_BLOCK_N] 마커로 포맷팅
        contentForPrompt = blocks
          .map((block, i) => `[SCENE_BLOCK_${i + 1}]\n${block}`)
          .join('\n\n');
        preSegmented = true;
        targetSceneCount = blocks.length;
        console.log(`${chunkLabel}[Script] JS 사전 분할 완료: ${blocks.length}개 블록`);
        blocks.forEach((b, i) => console.log(`  블록 ${i + 1}: ${b.slice(0, 60)}...`));
      }
    }

    // 입력 길이 및 토큰 계산
    const inputText = contentForPrompt || topic;
    const inputLength = inputText.length;
    const estimatedSceneCount = targetSceneCount || Math.max(1, Math.ceil(inputLength / 80));
    const calculatedTokens = Math.ceil(estimatedSceneCount * 900 * 1.5);
    const maxOutputTokens = Math.min(65536, Math.max(16384, calculatedTokens));

    console.log(`${chunkLabel}[Script] 입력: ${inputLength}자, 목표 씬: ${estimatedSceneCount}개, maxOutputTokens: ${maxOutputTokens}`);

    const writingGuide = localStorage.getItem('heaven_writing_guide') || '';
    const promptText = getScriptGenerationPrompt(topic, contentForPrompt, targetSceneCount, preSegmented, undefined, writingGuide);
    const anthropicKey = localStorage.getItem('heaven_anthropic_key');
    let responseText: string;

    // ── Claude 시도 (키 있을 때) ───────────────────────────────────────────
    let claudeUsed = false;
    if (anthropicKey) {
      try {
        console.log(`${chunkLabel}[Script] Claude claude-sonnet-4-6 시도`);
        const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: maxOutputTokens,
            system: baseInstruction + '\n\nOutput ONLY a valid JSON array. No markdown code fences, no explanation text.',
            messages: [{ role: 'user', content: promptText }],
          }),
        });
        if (!claudeResp.ok) {
          const errText = await claudeResp.text();
          console.warn(`${chunkLabel}[Script] Claude 실패 (${claudeResp.status}): ${errText.slice(0, 200)} → Gemini fallback`);
        } else {
          const claudeData = await claudeResp.json();
          responseText = claudeData.content?.[0]?.text || '[]';
          claudeUsed = true;
          console.log(`${chunkLabel}[Script] Claude claude-sonnet-4-6 성공`);
        }
      } catch (claudeErr: any) {
        console.warn(`${chunkLabel}[Script] Claude 네트워크 오류: ${claudeErr.message} → Gemini fallback`);
      }
    }

    // ── Gemini 2.5 Flash fallback ─────────────────────────────────────────
    if (!claudeUsed) {
      console.log(`${chunkLabel}[Script] Gemini 2.5 Flash 사용${anthropicKey ? ' (Claude fallback)' : ' (Claude 키 없음)'}`);
      const ai = getAI();
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: promptText,
        config: {
          thinkingConfig: { thinkingBudget: 24576 },
          responseMimeType: "application/json",
          systemInstruction: baseInstruction,
          maxOutputTokens: maxOutputTokens,
        },
      });
      const finishReason = response.candidates?.[0]?.finishReason;
      if (finishReason === 'MAX_TOKENS' || String(finishReason) === 'STOP_TRUNCATED') {
        console.warn(`${chunkLabel}[Script] ⚠️ 응답 토큰 제한 잘림. finishReason: ${finishReason}`);
      }
      responseText = response.text || '[]';
    }

    const result = JSON.parse(cleanJsonResponse(responseText));
    const scenes = Array.isArray(result) ? result : (result.scenes || []);

    console.log(`${chunkLabel}[Script] 생성된 씬 개수: ${scenes.length}`);

    // 씬이 너무 적으면 경고
    if (scenes.length < 3) {
      console.warn(`${chunkLabel}[Warning] 씬이 ${scenes.length}개만 생성됨. 대본이 제대로 분할되지 않았을 수 있음.`);
    }

    const sorted = [...scenes].sort((a: any, b: any) => (a.sceneNumber || 0) - (b.sceneNumber || 0));
    let mapped = sorted.map((scene: any, idx: number) => ({
      sceneNumber: idx + 1,
      narration: cleanNarration(scene.narration || ""),
      visualPrompt: scene.image_prompt_english || "",
      analysis: scene.analysis || {}
    }));

    // ── 씬 수 엄격 적용: 초과 시 자름 ──
    if (maxScenes && mapped.length > maxScenes) {
      console.log(`${chunkLabel}[Script] 씬 수 초과(${mapped.length}개) → ${maxScenes}개로 자름`);
      mapped = mapped.slice(0, maxScenes);
    }

    return mapped;
  });
};

/**
 * 전체 대본을 읽고 각 씬의 이미지 프롬프트를 재작성
 * - 스크립트 생성 직후, 이미지 생성 전에 호출
 * - AI가 전체 맥락(등장인물 나이/특성, 장소, 시간대 등)을 파악한 후 프롬프트 작성
 */
export const enrichImagePrompts = async (
  scenes: ScriptScene[],
  hasCharacterRef: boolean = false
): Promise<ScriptScene[]> => {
  if (scenes.length === 0) return scenes;

  return retryGeminiRequest("Image Prompt Enrichment", async () => {
    const ai = getAI();

    // 전체 대본을 번호 리스트로 정리
    const scriptSummary = scenes
      .map(s => `[${s.sceneNumber}] ${s.narration}`)
      .join('\n');

    const charRefRule = hasCharacterRef
      ? `- 사람이 등장하는 씬: 반드시 "THE CHARACTER"만 사용, 외모(나이/성별/머리색 등) 절대 묘사 금지`
      : `- 나레이션에서 언급된 인물의 나이/특성을 반드시 반영 (할아버지→elderly man, 아이→child, 젊은 여성→young woman 등)`;

    const prompt = `당신은 영상 스토리보드 전문가입니다.
아래 전체 대본을 완독한 후, 각 씬의 이미지 프롬프트를 작성하라.

## ⚠️ 핵심 규칙 (반드시 준수)
1. **전체 대본 맥락 파악 필수**: 먼저 모든 씬의 나레이션을 읽고 전체 흐름을 이해하라
2. **나레이션과 이미지 100% 일치**: 나레이션에 "산속"이면 반드시 mountain forest, "마당"이면 courtyard
3. **인물 묘사 정확히**: 나레이션에서 언급된 인물의 특성을 반드시 반영
${charRefRule}
4. **장소 일치**: 나레이션에 나온 장소를 그대로 묘사 (집→house interior, 시장→marketplace 등)
5. **같은 인물이 여러 씬에 등장**: 씬 간 일관성 유지 (한 씬에서 할아버지면 다음 씬도 동일 인물)

## 이미지 프롬프트 작성 요소 (각 씬마다 포함)
- WHO: 누가 (사람이면 나이/특성 포함, 인격체 없으면 NO_CHAR)
- WHAT: 무엇을 하고 있는가 (구체적 행동)
- WHERE: 정확한 장소 (나레이션 장소와 일치)
- MOOD: 분위기/조명

## 전체 대본
${scriptSummary}

## 출력 형식
각 씬 번호에 대한 image_prompt_english를 JSON 배열로 출력:
[{"sceneNumber": 1, "image_prompt_english": "...영문 프롬프트..."},...]

출력은 JSON 배열만, 설명 텍스트 없음.`;

    const anthropicKey = localStorage.getItem('heaven_anthropic_key');
    let responseText: string;

    if (anthropicKey) {
      try {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: Math.min(65536, scenes.length * 200),
            system: 'Output ONLY a valid JSON array. No markdown, no explanation.',
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          responseText = data.content?.[0]?.text || '[]';
          console.log('[Prompts] Claude로 이미지 프롬프트 재작성 완료');
        } else {
          throw new Error(`Claude ${resp.status}`);
        }
      } catch (e) {
        console.warn('[Prompts] Claude 실패 → Gemini 폴백', e);
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: { responseMimeType: 'application/json', maxOutputTokens: Math.min(65536, scenes.length * 200) },
        });
        responseText = response.text || '[]';
      }
    } else {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: { responseMimeType: 'application/json', maxOutputTokens: Math.min(65536, scenes.length * 200) },
      });
      responseText = response.text || '[]';
      console.log('[Prompts] Gemini로 이미지 프롬프트 재작성 완료');
    }

    const parsed = JSON.parse(cleanJsonResponse(responseText));
    const promptMap = new Map<number, string>();
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item.sceneNumber && item.image_prompt_english) {
          promptMap.set(item.sceneNumber, item.image_prompt_english);
        }
      }
    }

    // 원본 씬에 새 프롬프트 적용 (없으면 기존 유지)
    return scenes.map(s => ({
      ...s,
      visualPrompt: promptMap.get(s.sceneNumber) || s.visualPrompt,
    }));
  });
};

/**
 * 기존 generateScript 함수 (하위 호환성 유지)
 */
export const generateScript = async (
  topic: string,
  hasReferenceImage: boolean,
  sourceContext?: string | null,
  maxScenes?: number
): Promise<ScriptScene[]> => {
  return generateScriptSingle(topic, hasReferenceImage, sourceContext, undefined, maxScenes);
};

/**
 * 텍스트를 문단/문장 단위로 청크 분할
 * - 문단 구분자(\n\n) 우선
 * - 너무 긴 문단은 문장 단위로 재분할
 */
function splitTextIntoChunks(text: string, maxChunkSize: number): string[] {
  const chunks: string[] = [];

  // 먼저 문단으로 분할 (빈 줄 기준)
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    const trimmedPara = paragraph.trim();
    if (!trimmedPara) continue;

    // 현재 청크에 추가해도 괜찮은지 확인
    if ((currentChunk + '\n\n' + trimmedPara).length <= maxChunkSize) {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmedPara;
    } else {
      // 현재 청크가 있으면 저장
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }

      // 문단 자체가 청크 크기보다 크면 문장 단위로 분할
      if (trimmedPara.length > maxChunkSize) {
        // 문장 끝 패턴: 마침표, 느낌표, 물음표 + 공백 또는 줄바꿈
        const sentences = trimmedPara.split(/(?<=[.!?。])\s+/);
        currentChunk = '';

        for (const sentence of sentences) {
          if ((currentChunk + ' ' + sentence).length <= maxChunkSize) {
            currentChunk += (currentChunk ? ' ' : '') + sentence;
          } else {
            if (currentChunk) chunks.push(currentChunk.trim());
            currentChunk = sentence;
          }
        }
      } else {
        currentChunk = trimmedPara;
      }
    }
  }

  // 마지막 청크 저장
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * 긴 대본을 청크로 분할하여 처리 (10,000자 이상 대응)
 * - 대본 내용은 절대 수정하지 않음
 * - 각 청크별로 씬 생성 후 병합
 * - 씬 번호 자동 재조정
 *
 * @param topic 토픽
 * @param hasReferenceImage 참조 이미지 존재 여부
 * @param sourceContext 원본 대본 (긴 텍스트)
 * @param chunkSize 청크당 최대 글자 수 (기본 2500자)
 * @param onProgress 진행 상황 콜백
 */
export const generateScriptChunked = async (
  topic: string,
  hasReferenceImage: boolean,
  sourceContext: string,
  chunkSize: number = 2500,
  onProgress?: (message: string) => void,
  maxScenes?: number
): Promise<ScriptScene[]> => {
  const inputLength = sourceContext.length;

  // 청크 분할 기준 이하면 일반 처리
  if (inputLength <= chunkSize) {
    console.log(`[Chunked Script] 입력(${inputLength}자)이 청크 크기(${chunkSize}자) 이하. 일반 처리.`);
    return generateScriptSingle(topic, hasReferenceImage, sourceContext, undefined, maxScenes);
  }

  console.log(`[Chunked Script] ========================================`);
  console.log(`[Chunked Script] 긴 대본 감지: ${inputLength.toLocaleString()}자`);
  console.log(`[Chunked Script] 청크 분할 처리 시작 (청크당 최대 ${chunkSize}자)`);

  // 문단/문장 단위로 청크 분할
  const chunks = splitTextIntoChunks(sourceContext, chunkSize);
  console.log(`[Chunked Script] ${chunks.length}개 청크로 분할됨`);
  chunks.forEach((chunk, i) => {
    console.log(`  - 청크 ${i + 1}: ${chunk.length}자`);
  });

  const allScenes: ScriptScene[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const progressMsg = `스토리보드 생성 중... (${i + 1}/${chunks.length} 파트)`;
    console.log(`[Chunked Script] ${progressMsg}`);
    onProgress?.(progressMsg);

    // 청크 컨텍스트에 파트 정보 추가 (대본 내용은 그대로)
    const chunkContext = chunks.length > 1
      ? `[파트 ${i + 1}/${chunks.length} - 전체 대본의 일부입니다. 이 파트의 내용만 시각화하세요.]\n\n${chunks[i]}`
      : chunks[i];

    try {
      // maxScenes를 청크 크기 비율로 분배 (전체 대본 중 이 청크의 비율만큼 할당)
      const chunkMaxScenes = maxScenes
        ? Math.max(1, Math.round(maxScenes * chunks[i].length / inputLength))
        : undefined;

      if (maxScenes) {
        console.log(`[Chunked Script] 청크 ${i + 1} maxScenes: ${chunkMaxScenes} (전체 ${maxScenes} × ${chunks[i].length}/${inputLength}자)`);
      }

      const chunkScenes = await generateScriptSingle(
        topic,
        hasReferenceImage,
        chunkContext,
        { current: i + 1, total: chunks.length },
        chunkMaxScenes
      );

      // 씬 번호 재조정 (이전 씬들 뒤에 이어서)
      const offset = allScenes.length;
      const adjustedScenes = chunkScenes.map((scene, idx) => ({
        ...scene,
        sceneNumber: offset + idx + 1
      }));

      allScenes.push(...adjustedScenes);
      console.log(`[Chunked Script] 청크 ${i + 1} 완료: ${chunkScenes.length}개 씬 추가 (누적: ${allScenes.length}개)`);

    } catch (error: any) {
      console.error(`[Chunked Script] 청크 ${i + 1} 처리 실패:`, error.message);
      // 실패한 청크는 건너뛰고 계속 진행
      onProgress?.(`청크 ${i + 1} 처리 실패, 계속 진행 중...`);
    }

    // 청크 간 딜레이 (API rate limit 방지)
    if (i < chunks.length - 1) {
      await wait(1500);
    }
  }

  // 최종 씬 번호 순서대로 정렬 후 1부터 재번호
  const finalScenes = allScenes
    .sort((a, b) => (a.sceneNumber || 0) - (b.sceneNumber || 0))
    .map((scene, idx) => ({ ...scene, sceneNumber: idx + 1 }));

  console.log(`[Chunked Script] ========================================`);
  console.log(`[Chunked Script] 총 ${finalScenes.length}개 씬 생성 완료`);
  console.log(`[Chunked Script] ========================================`);

  return finalScenes;
};

/**
 * 선택된 Gemini 화풍 프롬프트 가져오기
 * - 순환 의존성 방지를 위해 직접 localStorage와 config 사용
 */
const getSelectedGeminiStylePrompt = (): string => {
  // 비주얼 스타일 빠른 선택기 우선 적용
  const visualStyleId = localStorage.getItem(CONFIG.STORAGE_KEYS.VISUAL_STYLE_ID);
  if (visualStyleId && visualStyleId !== 'none') {
    const found = (VISUAL_STYLES as readonly { id: string; prompt: string }[]).find(s => s.id === visualStyleId);
    if (found) return found.prompt;
  }

  const styleId = localStorage.getItem(CONFIG.STORAGE_KEYS.GEMINI_STYLE) as GeminiStyleId || 'gemini-none';

  // 화풍 없음 선택
  if (styleId === 'gemini-none') {
    return '';
  }

  // 커스텀 스타일인 경우
  if (styleId === 'gemini-custom') {
    const customPrompt = localStorage.getItem(CONFIG.STORAGE_KEYS.GEMINI_CUSTOM_STYLE) || '';
    return customPrompt.trim();
  }

  // 프리셋 스타일 찾기
  for (const category of GEMINI_STYLE_CATEGORIES) {
    const style = category.styles.find(s => s.id === styleId);
    if (style) {
      return style.prompt;
    }
  }

  return '';
};

/**
 * 강도(0-100)를 언어적 표현으로 변환
 * @param strength - 강도 값 (0~100)
 * @returns 강도에 따른 언어적 표현
 */
const getStrengthDescription = (strength: number): { level: string; instruction: string } => {
  if (strength <= 20) {
    return {
      level: 'very loosely',
      instruction: 'Use as a very loose inspiration only. Feel free to deviate significantly.'
    };
  } else if (strength <= 40) {
    return {
      level: 'loosely',
      instruction: 'Use as a loose reference. Capture the general feel but allow creative interpretation.'
    };
  } else if (strength <= 60) {
    return {
      level: 'moderately',
      instruction: 'Follow the reference moderately. Balance between reference and scene requirements.'
    };
  } else if (strength <= 80) {
    return {
      level: 'closely',
      instruction: 'Follow the reference closely. Maintain strong similarity while adapting to the scene.'
    };
  } else {
    return {
      level: 'exactly',
      instruction: 'Match the reference as exactly as possible. Replicate with high precision.'
    };
  }
};

/**
 * Imagen 3으로 이미지 생성
 * - 참조 이미지 미지원 → 텍스트 프롬프트만 사용
 * - 텍스트 규칙 준수율이 Gemini보다 훨씬 높음
 */
const generateImageWithImagen3 = async (
  prompt: string,
  modelId: string = 'imagen-3.0-fast-generate-001',
  negativePrompt?: string
): Promise<string | null> => {
  return retryGeminiRequest("Imagen3 Generation", async () => {
    const ai = getAI();
    const ar = localStorage.getItem('heaven_aspect_ratio') || '16:9';
    const config: Record<string, any> = {
      numberOfImages: 1,
      aspectRatio: ar,
      outputMimeType: 'image/jpeg',
    };
    if (negativePrompt) config.negativePrompt = negativePrompt;
    const response = await (ai.models as any).generateImages({
      model: modelId,
      prompt,
      config,
    });
    const imageBytes = response?.generatedImages?.[0]?.image?.imageBytes;
    if (!imageBytes) return null;
    return imageBytes; // base64
  }, 2, 3000);
};

/**
 * 참조 이미지(캐릭터)에서 Gemini Vision으로 특징 텍스트 자동 추출
 * - 업로드 시 1회 실행, 이후 매 씬 생성에 재사용
 * @param imageBase64 - base64 이미지 (data:URL 또는 raw base64)
 * @returns 영어로 된 상세 캐릭터 묘사 텍스트
 */
export const analyzeCharacterReference = async (imageBase64: string): Promise<string> => {
  try {
    const ai = getAI();
    const imageData = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: {
        parts: [
          {
            text: `Analyze this character/person reference image and provide an extremely detailed description in English for use in AI image generation prompts.

Output a single paragraph (no bullet points) covering ALL of these features:
1. FACE: exact skin tone, face shape, eye color and shape, eyebrow style, nose shape, lip shape/color, cheekbones
2. HAIR: exact color (e.g., "ash blonde", "jet black"), length, texture (straight/wavy/curly), style (how it's worn)
3. BODY: build, height impression, posture
4. CLOTHING: every piece of clothing with exact colors and style
5. DISTINCTIVE FEATURES: any unique marks, accessories, expressions

Be extremely specific about colors. This description will be used to maintain perfect consistency across multiple AI-generated images.
Output ONLY the description paragraph, no intro text.`
          },
          { inlineData: { data: imageData, mimeType: 'image/jpeg' } }
        ]
      }
    });

    const description = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    console.log(`[Character Analysis] 추출 완료 (${description.length}자):`, description.slice(0, 150) + '...');
    return description;
  } catch (e) {
    console.warn('[Character Analysis] 분석 실패:', e);
    return '';
  }
};

/**
 * 씬에 대한 이미지 생성 (Gemini 사용)
 * @param scene - 씬 데이터
 * @param referenceImages - 분리된 참조 이미지 (캐릭터/스타일 + 강도)
 */
export const generateImageForScene = async (
  scene: ScriptScene,
  referenceImages: ReferenceImages
): Promise<string | null> => {
  // 캐릭터 참조 이미지가 있으면 고정 프롬프트 제외
  const hasCharacterRef = referenceImages.character && referenceImages.character.length > 0;
  const hasStyleRef = referenceImages.style && referenceImages.style.length > 0;


  // 선택된 이미지 모델 확인
  const selectedModel = localStorage.getItem(CONFIG.STORAGE_KEYS.IMAGE_MODEL) || CONFIG.DEFAULT_IMAGE_MODEL;
  const isImagen3 = selectedModel.startsWith('imagen-3');
  const isImagen4 = selectedModel.startsWith('imagen-4');
  const isImagenModel = isImagen3 || isImagen4;
  // Nano Banana 모델 (gemini-3-pro-image-preview, gemini-3.1-flash-image-preview)은 Gemini 경로 사용
  const isNanoBanana = selectedModel.startsWith('gemini-3');
  // 실제 Gemini 이미지 모델 ID 결정 (Nano Banana 선택 시 해당 모델 직접 사용)
  const geminiImageModel = isNanoBanana ? selectedModel : 'gemini-2.5-flash-image';

  const ar = localStorage.getItem(CONFIG.STORAGE_KEYS.ASPECT_RATIO) || '16:9';

  // Imagen 3/4 선택 시
  // 캐릭터 참조가 있으면 Imagen은 이미지 입력 불가 → Gemini Flash Image로 처리 (시각적 참조 필수)
  // 캐릭터 참조가 없으면 Imagen 직접 사용
  if (isImagenModel && !hasCharacterRef) {
    const textMode = localStorage.getItem(CONFIG.STORAGE_KEYS.IMAGE_TEXT_MODE) || 'none';
    const prompt = getFinalVisualPrompt(scene, false, getSelectedGeminiStylePrompt(), textMode, ar);
    console.log(`[Image Gen] Imagen 사용 (참조 없음): ${selectedModel}, 비율: ${ar}`);
    try {
      const negPrompt = textMode === 'none'
        ? 'text, letters, words, alphabet, numbers, signs, watermark, captions, labels, writing, typography, subtitles, overlay text'
        : undefined;
      const result = await generateImageWithImagen3(prompt, selectedModel, negPrompt);
      if (result) return result;
    } catch (e: any) {
      const msg = e?.message || '';
      const isPermissionError = msg.includes('403') || msg.includes('permission') || msg.includes('billing') || msg.includes('quota') || msg.includes('not found') || msg.includes('PERMISSION_DENIED') || msg.includes('serviceDisabled');
      if (isPermissionError) {
        console.warn(`[Image Gen] Imagen 권한 없음 → Gemini 2.5 Flash로 폴백`);
      } else {
        throw e;
      }
    }
    // Gemini Flash로 폴백
  }

  if (isImagenModel && hasCharacterRef) {
    console.log(`[Image Gen] Imagen 선택이지만 캐릭터 참조 있음 → Gemini Flash Image로 전환 (시각적 참조 필수)`);
  }

  // 스타일 참조 이미지가 없을 때만 선택된 화풍 적용 (스타일 참조 우선)
  // 화풍 프롬프트를 캐릭터에도 적용하기 위해 getFinalVisualPrompt에 전달
  const geminiStylePrompt = hasStyleRef ? undefined : getSelectedGeminiStylePrompt();
  const textMode = localStorage.getItem(CONFIG.STORAGE_KEYS.IMAGE_TEXT_MODE) || 'none';
  const basePrompt = getFinalVisualPrompt(scene, hasCharacterRef, geminiStylePrompt, textMode, ar);

  if (geminiStylePrompt) {
    console.log(`[Image Gen] 화풍이 캐릭터에 적용됨: ${geminiStylePrompt.slice(0, 50)}...`);
  }

  // 강도 정보 가져오기
  const characterStrength = referenceImages.characterStrength ?? 70;
  const styleStrength = referenceImages.styleStrength ?? 70;

  console.log(`[Image Gen] 캐릭터 강도: ${characterStrength}%, 스타일 강도: ${styleStrength}%`);

  const MAX_SANITIZE_ATTEMPTS = 3; // 대체어 시도 횟수
  let lastError: any;

  for (let sanitizeAttempt = 0; sanitizeAttempt < MAX_SANITIZE_ATTEMPTS; sanitizeAttempt++) {
    // 시도마다 다른 대체어 적용
    const sanitizedPrompt = sanitizeAttempt === 0
      ? basePrompt
      : sanitizePrompt(basePrompt, sanitizeAttempt - 1);

    if (sanitizeAttempt > 0) {
      console.log(`[Image Gen] 키워드 대체 시도 ${sanitizeAttempt}: 프롬프트 수정됨`);
    }

    try {
      const result = await retryGeminiRequest("Pro Image Generation", async () => {
        const ai = new GoogleGenAI({ apiKey: getGeminiApiKey() });
        const parts: any[] = [];
        const charTextDesc = referenceImages.characterDescription?.trim();

        // ── 절대 금지 규칙 (항상 첫 번째 part로 배치) ──────────────────
        const textModeRule = textMode === 'none'
          ? `⛔ RULE: ZERO TEXT — No text, letters, words, numbers, signs, labels, captions, or written characters of ANY kind anywhere in the image. Pure visual scene only. Including ANY text = CRITICAL FAILURE.`
          : textMode === 'numbers'
          ? `⚠️ RULE: Only Arabic numerals (0-9) allowed. No words, no letters.`
          : textMode === 'english'
          ? `⚠️ RULE: Only Latin/English characters allowed. No Korean (한글), no Chinese, no Japanese.`
          : '';
        const absoluteRules = [
          `⛔ RULE #1 — ONE SINGLE IMAGE ONLY: Generate exactly ONE continuous, unified image filling the entire canvas.`,
          `FORBIDDEN FOREVER: panels, comic strips, split screens, grids, multiple cuts, storyboard layouts, borders/lines dividing the image, before/after comparisons, side-by-side images, triptychs, diptychs, collages. Any form of image division = INSTANT FAILURE.`,
          textModeRule,
        ].filter(Boolean).join('\n');
        parts.push({ text: absoluteRules });

        if (hasCharacterRef) {
          // ─── 캐릭터 일관성 모드 ───
          const sceneAction = scene.visualPrompt
            ? scene.visualPrompt.slice(0, 200)
            : scene.narration
            ? scene.narration.slice(0, 150)
            : sanitizedPrompt.slice(0, 250);

          const styleHint = (() => {
            if (hasStyleRef) return '';
            const sp = getSelectedGeminiStylePrompt();
            return sp ? `\nArt style: ${sp}` : '';
          })();

          const descBlock = charTextDesc
            ? `\nCharacter features to reproduce exactly:\n${charTextDesc}`
            : '';

          // 참조 이미지 나열
          referenceImages.character.forEach((img, idx) => {
            const imageData = img.includes(',') ? img.split(',')[1] : img;
            parts.push({
              text: idx === 0
                ? `This is the character reference photo. Study this person's face carefully.`
                : `Same character, additional angle:`
            });
            parts.push({ inlineData: { data: imageData, mimeType: 'image/jpeg' } });
          });

          parts.push({
            text: `You MUST draw the EXACT SAME PERSON shown in the reference photo(s) above. Character identity must be 100% consistent.

COPY THESE FEATURES EXACTLY — zero deviation allowed:
• Face shape: reproduce identically (jaw, cheekbones, forehead)
• Eyes: same shape, same color, same distance apart
• Nose: same shape and size
• Lips: same shape and fullness
• Skin tone: identical
• Hair: SAME COLOR, SAME LENGTH, SAME STYLE — absolutely no changes${descBlock}

This person must be INSTANTLY RECOGNIZABLE as the same individual from the reference. Do NOT invent a new face. Do NOT alter any physical features.

New scene to place them in (DO NOT render any of this as text/letters in the image):
${sceneAction}${styleHint}`
          });

        } else {
          // ─── 일반 모드 ───
          if (hasStyleRef) {
            const styleDesc = getStrengthDescription(styleStrength);
            parts.push({
              text: `[STYLE REFERENCE - Strength: ${styleStrength}%]
Match this art style ${styleDesc.level}.
${styleDesc.instruction}`
            });
            referenceImages.style.forEach(img => {
              const imageData = img.includes(',') ? img.split(',')[1] : img;
              parts.push({ inlineData: { data: imageData, mimeType: 'image/jpeg' } });
            });
          } else {
            const geminiStylePrompt = getSelectedGeminiStylePrompt();
            if (geminiStylePrompt) {
              parts.push({ text: `[ART STYLE INSTRUCTION]\nApply this art style: ${geminiStylePrompt}` });
            }
          }
          parts.push({ text: `[SCENE PROMPT]\n${sanitizedPrompt}` });
        }

        // ── 마지막에도 이중 강제 ─────────────────────────────────────────
        parts.push({
          text: [
            `⛔ FINAL OVERRIDE — SINGLE FRAME: ONE image, ONE scene. NO panels. NO splits. NO borders.`,
            textMode === 'none'   ? `⛔ FINAL OVERRIDE — ZERO TEXT: Absolutely no text, letters, numbers, or signs in the image.` : '',
            textMode === 'numbers' ? `⚠️ FINAL: Only digits (0-9). No letters, no words.` : '',
            textMode === 'english' ? `⚠️ FINAL: Only Latin/English. No Korean, no Chinese, no Japanese.` : '',
          ].filter(Boolean).join('\n')
        });

        const response = await ai.models.generateContent({
          model: geminiImageModel,
          contents: { parts },
          config: {
            responseModalities: [Modality.IMAGE],
            imageConfig: {
              aspectRatio: ar
            }
          }
        });

        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) return part.inlineData.data;
        }
        return null;
      }, 2, 3000); // 각 대체어당 2회 재시도

      if (result) {
        // 캐릭터 참조가 있고 FAL 키가 있으면 face swap으로 얼굴 일관성 보장
        if (hasCharacterRef) {
          const faceRefRaw = referenceImages.character[0];
          const faceRef = faceRefRaw.includes(',') ? faceRefRaw.split(',')[1] : faceRefRaw;
          const swapped = await faceSwapCharacter(result, faceRef);
          if (swapped) {
            console.log('[Image Gen] Face swap 적용 완료');
            return swapped;
          }
          console.log('[Image Gen] Face swap 실패 또는 FAL 키 없음 → 원본 반환');
        }
        return result;
      }
    } catch (error: any) {
      lastError = error;
      const errorMsg = error.message || JSON.stringify(error);

      // 안전 필터/콘텐츠 정책 관련 에러인지 확인
      const isSafetyError =
        errorMsg.includes('safety') ||
        errorMsg.includes('blocked') ||
        errorMsg.includes('policy') ||
        errorMsg.includes('content') ||
        errorMsg.includes('SAFETY') ||
        errorMsg.includes('harmful') ||
        error.status === 400;

      if (isSafetyError && sanitizeAttempt < MAX_SANITIZE_ATTEMPTS - 1) {
        console.log(`[Image Gen] 안전 필터 감지됨. 대체 키워드로 재시도...`);
        await wait(1000);
        continue; // 다음 대체어로 재시도
      }

      // 안전 필터 에러가 아니거나 모든 대체어 소진 시 에러 throw
      throw error;
    }
  }

  throw lastError || new Error('이미지 생성 실패: 모든 대체어 시도 실패');
};

/**
 * 기존 이미지 + 편집 명령으로 이미지 수정 (image-in → image-out)
 * - 원본 이미지를 Gemini에 직접 전달하여 지정된 부분만 수정
 */
export const editImageWithGemini = async (imageBase64: string, command: string): Promise<string | null> => {
  const ai = getAI();
  const ar = localStorage.getItem(CONFIG.STORAGE_KEYS.ASPECT_RATIO) || '16:9';
  try {
    // 선택된 이미지 모델 사용 (나노바나나2 포함), 없으면 gemini-2.0-flash-exp 폴백
    const selectedModel = localStorage.getItem(CONFIG.STORAGE_KEYS.IMAGE_MODEL) || '';
    const editModel = selectedModel.startsWith('gemini') ? selectedModel : 'gemini-2.0-flash-exp';
    const response = await ai.models.generateContent({
      model: editModel,
      contents: {
        parts: [
          { inlineData: { data: imageBase64, mimeType: 'image/jpeg' } },
          {
            text: [
              `Edit this image. Apply ONLY the following instruction. Keep EVERYTHING ELSE exactly the same — same composition, characters, background, colors, style, lighting.`,
              ``,
              `INSTRUCTION: ${command}`,
              ``,
              `Output: single continuous edited image. No panels, no split screens, no borders, no before/after.`,
            ].join('\n')
          }
        ]
      },
      config: {
        responseModalities: [Modality.TEXT, Modality.IMAGE],
      }
    });
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if ((part as any).inlineData?.data) return (part as any).inlineData.data;
    }
    console.warn('[Image Edit] 응답에 이미지 없음:', parts.map(p => Object.keys(p)));
    return null;
  } catch (e) {
    console.error('[Image Edit] Gemini 이미지 편집 실패:', e);
    return null;
  }
};

/**
 * 긴 텍스트를 400자 단위로 자연스럽게 분할
 * - 문장 끝(. ? ! 。)에서 우선 분할
 * - 없으면 쉼표, 공백 순으로 분할
 */
function splitTtsText(text: string, maxChars: number = 400): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxChars) {
    let breakIdx = -1;
    const min = Math.floor(maxChars * 0.88);

    // 1순위: 문장 끝 기호
    for (let i = maxChars; i >= min; i--) {
      const c = remaining[i];
      if (c === '.' || c === '?' || c === '!' || c === '。' || c === '\n') {
        breakIdx = i + 1;
        break;
      }
    }
    // 2순위: 쉼표 / 공백
    if (breakIdx === -1) {
      for (let i = maxChars; i >= min; i--) {
        const c = remaining[i];
        if (c === ',' || c === '，' || c === ' ') {
          breakIdx = i + 1;
          break;
        }
      }
    }
    // 3순위: 강제 분할
    if (breakIdx === -1) breakIdx = maxChars;

    const chunk = remaining.slice(0, breakIdx).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(breakIdx).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

/**
 * 여러 base64 PCM 오디오 청크를 하나로 이어붙이기
 * Gemini TTS 반환값은 raw Int16 PCM이므로 바이트 단순 연결로 충분
 */
function concatenatePcmBase64(chunks: string[]): string {
  const arrays = chunks.map(b64 => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  });

  const total = arrays.reduce((s, a) => s + a.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) { merged.set(arr, offset); offset += arr.length; }

  let binary = '';
  // 64KB씩 처리해서 call stack 초과 방지
  for (let i = 0; i < merged.length; i += 65536) {
    binary += String.fromCharCode(...merged.subarray(i, i + 65536));
  }
  return btoa(binary);
}

/**
 * TTS 단일 청크 생성 (내부용)
 */
async function generateTtsChunk(text: string): Promise<string> {
  const voiceName = localStorage.getItem(CONFIG.STORAGE_KEYS.GEMINI_TTS_VOICE) || CONFIG.DEFAULT_GEMINI_TTS_VOICE;
  const voiceSpeed = localStorage.getItem(CONFIG.STORAGE_KEYS.VOICE_SPEED) || '1.0';
  const speedInstruction = voiceSpeed === '0.7' ? '(천천히 또렷하게 말해주세요) ' : voiceSpeed === '1.3' ? '(빠르게 활기차게 말해주세요) ' : '';
  // Google TTS 톤/분위기 텍스트 지시 (사용자가 선택한 감정 스타일)
  const toneInstruction = localStorage.getItem('heaven_google_tts_tone') || '';
  const moodInstruction = localStorage.getItem('heaven_google_tts_mood') || '';
  const textWithSpeed = speedInstruction + toneInstruction + moodInstruction + text;
  return retryGeminiRequest("TTS Generation", async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: { parts: [{ text: textWithSpeed }] },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
      }
    });
    // 빈 응답 시 재시도 트리거 (retryGeminiRequest가 exception을 retry 조건으로 사용)
    const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!data) throw new Error('TTS returned empty audio — retrying');
    return data;
  });
}

/**
 * Google TTS 미리듣기 (특정 음성명으로 단일 생성)
 */
export const generateGeminiTtsPreview = async (text: string, voiceName: string): Promise<string | null> => {
  return retryGeminiRequest("TTS Preview", async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: { parts: [{ text }] },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
      }
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
  });
};

/**
 * PCM base64 오디오를 비율 배열에 따라 분할
 * - PCM Int16 (24kHz mono) → 2바이트 정렬 보장
 */
const splitPcmBase64ByRatios = (pcmBase64: string, ratios: number[]): string[] => {
  const binStr = atob(pcmBase64);
  const total = binStr.length;
  const bytes = new Uint8Array(total);
  for (let i = 0; i < total; i++) bytes[i] = binStr.charCodeAt(i);

  const result: string[] = [];
  let offset = 0;

  for (let i = 0; i < ratios.length; i++) {
    const isLast = i === ratios.length - 1;
    let byteCount = isLast ? (total - offset) : Math.floor(total * ratios[i]);
    if (byteCount % 2 !== 0) byteCount++;
    if (offset + byteCount > total) byteCount = total - offset;
    if (byteCount <= 0) { result.push(''); continue; }

    const chunk = bytes.slice(offset, offset + byteCount);
    offset += byteCount;

    let binary = '';
    for (let j = 0; j < chunk.length; j += 65536) {
      binary += String.fromCharCode(...chunk.subarray(j, j + 65536));
    }
    result.push(btoa(binary));
  }

  return result;
};

/**
 * 전체 씬 나레이션을 하나의 TTS 세션으로 생성 (목소리 일관성 보장)
 * - 모든 씬 나레이션을 연결 → 500자 청크로 분할 → 연속 생성 → 씬별 비율 분할
 */
export const generateAllScenesAudio = async (
  narrations: string[],
  onProgress?: (msg: string) => void
): Promise<(string | null)[]> => {
  if (narrations.length === 0) return [];

  const fullText = narrations.join(' ');
  const chunks = splitTtsText(fullText, 4000);

  console.log(`[TTS Batch] 전체 ${narrations.length}개 씬 → ${chunks.length}개 청크 일괄 생성`);
  onProgress?.(`전체 나레이션 음성 생성 중 (0/${chunks.length})`);

  const audioChunks: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (!chunks[i].trim()) continue;
    onProgress?.(`전체 나레이션 음성 생성 중 (${i + 1}/${chunks.length})`);
    audioChunks.push(await generateTtsChunk(chunks[i]));
    if (i < chunks.length - 1) await wait(300);
  }

  if (audioChunks.length === 0) return narrations.map(() => null);

  const fullAudio = concatenatePcmBase64(audioChunks);

  const totalChars = narrations.reduce((s, n) => s + n.length, 0);
  const ratios = narrations.map(n => n.length / totalChars);
  const splitAudios = splitPcmBase64ByRatios(fullAudio, ratios);

  return splitAudios.map(a => a || null);
};

/**
 * 씬 나레이션 TTS 생성
 * - 400자 초과 시 청크 분할 후 이어붙이기
 */
export const generateAudioForScene = async (text: string): Promise<string | null> => {
  const provider = localStorage.getItem(CONFIG.STORAGE_KEYS.TTS_PROVIDER) || 'google';

  // Azure TTS 경로 (Neural — MP3 반환, 월 50만자 무료)
  if (provider === 'azure') {
    const apiKey = localStorage.getItem(CONFIG.STORAGE_KEYS.AZURE_TTS_API_KEY) || '';
    if (!apiKey) {
      console.warn('[TTS] Azure API 키 없음 → Gemini TTS 폴백');
    } else {
      try {
        const { generateAzureTTS } = await import('./azureTTSService');
        const chunks = splitTtsText(text, 4500);
        if (chunks.length === 1) return await generateAzureTTS(chunks[0]);
        const parts: string[] = [];
        for (const chunk of chunks) {
          const b64 = await generateAzureTTS(chunk);
          if (b64) parts.push(b64);
        }
        if (parts.length === 0) return null;
        if (parts.length === 1) return parts[0];
        const buffers = parts.map(b => Uint8Array.from(atob(b), c => c.charCodeAt(0)));
        const total = buffers.reduce((sum, b) => sum + b.length, 0);
        const merged = new Uint8Array(total);
        let off = 0;
        for (const buf of buffers) { merged.set(buf, off); off += buf.length; }
        let binary = '';
        for (let i = 0; i < merged.length; i += 65536) {
          binary += String.fromCharCode(...merged.subarray(i, i + 65536));
        }
        return btoa(binary);
      } catch (e) {
        console.warn('[TTS] Azure 실패 → Gemini TTS 폴백:', e);
      }
    }
  }

  // Google Cloud TTS 경로 (Neural2/Wavenet — MP3 반환, 한도 없음)
  if (provider === 'gcloud') {
    const apiKey = localStorage.getItem(CONFIG.STORAGE_KEYS.GCLOUD_TTS_API_KEY) || '';
    if (!apiKey) {
      console.warn('[TTS] gcloud API 키 없음 → Gemini TTS 폴백');
      // 아래 Gemini TTS 경로로 fall-through
    } else {
      try {
        const { generateGCloudTTS } = await import('./googleCloudTTSService');
        const chunks = splitTtsText(text, 4500);
        if (chunks.length === 1) return await generateGCloudTTS(chunks[0]);
        // 청크별 MP3 생성 후 바이너리 이어붙이기 (MP3는 단순 concat 가능)
        const parts: string[] = [];
        for (const chunk of chunks) {
          const b64 = await generateGCloudTTS(chunk);
          if (b64) parts.push(b64);
        }
        if (parts.length === 0) return null;
        if (parts.length === 1) return parts[0];
        // base64 디코드 → 바이너리 합치기 → 다시 base64
        const buffers = parts.map(b => Uint8Array.from(atob(b), c => c.charCodeAt(0)));
        const total = buffers.reduce((sum, b) => sum + b.length, 0);
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const buf of buffers) { merged.set(buf, offset); offset += buf.length; }
        let binary = '';
        for (let i = 0; i < merged.length; i += 65536) {
          binary += String.fromCharCode(...merged.subarray(i, i + 65536));
        }
        return btoa(binary);
      } catch (e) {
        console.warn('[TTS] gcloud 실패 → Gemini TTS 폴백:', e);
        // 아래 Gemini TTS 경로로 fall-through
      }
    }
  }

  // Gemini TTS 경로 (기존)
  const chunks = splitTtsText(text, 400);

  if (chunks.length === 1) {
    return generateTtsChunk(chunks[0]);
  }

  console.log(`[TTS] 텍스트 ${text.length}자 → ${chunks.length}개 청크로 분할 생성`);

  const results: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    console.log(`[TTS] 청크 ${i + 1}/${chunks.length}: ${chunks[i].length}자`);
    results.push(await generateTtsChunk(chunks[i]));
  }

  if (results.length === 0) return null;
  if (results.length === 1) return results[0];

  return concatenatePcmBase64(results);
};

/**
 * AI 기반 자막 의미 단위 분리
 * - 나레이션을 의미가 통하는 단위로 분리
 * - 각 청크는 maxChars(기본 22자) 이하
 * - 반환: 분리된 텍스트 청크 배열
 */
export const splitSubtitleByMeaning = async (
  narration: string,
  maxChars: number = 20
): Promise<string[]> => {
  return retryGeminiRequest("Subtitle Split", async () => {
    const ai = getAI();

    const prompt = `자막 분리 작업입니다. 원문을 청크로 나누세요.

###### 🚨 절대 금지 사항 (위반 시 실패) ######
- 띄어쓰기 추가 금지: "자막나오는거" → "자막 나오는 거" ❌
- 띄어쓰기 삭제 금지: "역대 최고치" → "역대최고치" ❌
- 맞춤법 교정 금지: 틀린 맞춤법도 그대로 유지
- 어떤 글자도 변경/추가/삭제 금지
################################################

## 검증 방법
청크를 그대로 이어붙이면 원문과 글자 하나 틀리지 않고 완전히 같아야 함.
"${narration}".split('').join('') === chunks.join('').split('').join('')

## 자막 분리 규칙
1. 각 청크는 15~20자 (최대 ${maxChars}자)
2. 1초당 4-5글자, 최소 1.5초 = 최소 6~8글자
3. 의미 단위로 자연스럽게 끊기

## 끊는 위치
✅ 좋은 위치: 쉼표(,) 뒤, 마침표(.) 뒤, 조사 뒤 공백
❌ 나쁜 위치: 단어 중간, 숫자 내 쉼표(4,200), 조사 앞

## 원문 (이것을 정확히 분리)
${narration}

## 출력
JSON 배열만 출력. 예: ["청크1", "청크2"]`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const chunks = JSON.parse(cleanJsonResponse(response.text));

    // 유효성 검증: 원문 복원 확인 (띄어쓰기 포함)
    const reconstructed = chunks.join('');

    if (reconstructed !== narration) {
      console.warn(`[Subtitle Split] 원문과 청크 불일치!`);
      console.warn(`  원문: "${narration}"`);
      console.warn(`  복원: "${reconstructed}"`);
      // 폴백: 단순 길이 기반 분리
      return fallbackSplit(narration, maxChars);
    }

    console.log(`[Subtitle Split] AI 분리 성공: ${chunks.length}개 청크`);
    return chunks;
  }, 2, 1000);
};

/**
 * 대본과 이미지 프롬프트를 분석하여 애니메이션 움직임 프롬프트 생성
 * - 캐릭터 감정/동작 분석
 * - 상황에 맞는 움직임 제안
 */
export const generateMotionPrompt = async (
  narration: string,
  visualPrompt: string
): Promise<string> => {
  try {
    const ai = getAI();

    const prompt = `You are an animation director. Analyze the narration and visual description, then generate a motion prompt for image-to-video AI.

## Rules
1. Output in English only
2. Keep the original image style intact - NO style changes
3. Suggest subtle, natural character movements based on emotion/context
4. Camera: slow gentle zoom in
5. Keep movements minimal but expressive
6. Max 100 words

## Narration (Korean)
${narration}

## Visual Description
${visualPrompt.slice(0, 300)}

## Output Format
Return ONLY the motion prompt, no explanation. Example:
"Slow gentle zoom in. Character slightly nods with a warm smile, eyes blinking naturally. Subtle breathing motion. Background remains static. Maintain original art style consistency."`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
    });

    const motionPrompt = response.text?.trim() || '';
    console.log('[Motion Prompt] 생성됨:', motionPrompt.slice(0, 100) + '...');
    return motionPrompt;

  } catch (error) {
    console.warn('[Motion Prompt] 생성 실패, 기본 프롬프트 사용');
    // 폴백: 기본 프롬프트
    return `Slow gentle zoom in. Subtle natural movement. Maintain original art style. ${visualPrompt.slice(0, 100)}`;
  }
};

/**
 * AI 실패 시 폴백: 구두점 + 길이 기반 분리
 */
function fallbackSplit(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let current = '';

  // 구두점이나 공백 기준으로 분리
  const tokens = text.split(/(?<=[,.])|(?=\s)/);

  for (const token of tokens) {
    if ((current + token).length <= maxChars) {
      current += token;
    } else {
      if (current.trim()) chunks.push(current.trim());
      current = token.trimStart();
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

// ─── 캐릭터 추출 ───────────────────────────────────────────────────────────────

export interface CharacterInfo {
  name: string;           // 캐릭터 이름
  description: string;   // 외모/특징 설명 (한국어)
  imagePrompt: string;   // 이미지 생성용 영어 프롬프트
  imageData?: string | null; // 생성된 이미지 base64
}

/**
 * 대본/스토리보드에서 등장인물 추출
 * - Gemini로 분석 → 이름, 설명, 이미지 프롬프트 반환
 */
export const extractCharactersFromScript = async (script: string): Promise<CharacterInfo[]> => {
  const ai = getAI();

  const prompt = `아래 대본을 정밀 분석하여 등장인물(사람 캐릭터)을 모두 추출하세요.

대본:
${script}

## 분석 지침
각 인물에 대해 대본에서 언급된 모든 단서를 수집하세요:
- 나이/연령대 (예: 30대 중반, 노인, 십대 소녀 등)
- 성별
- 직업/신분 (예: 형사, 사업가, 학생)
- 외모 특징 (키, 체형, 머리 색/스타일, 피부색, 눈 색)
- 복장 스타일 (예: 정장, 캐주얼, 전통 복장)
- 성격/감정적 특징
- 대본에서 추론 가능한 모든 시각적 요소

## 출력 형식 (JSON 배열만, 설명 없이)
[
  {
    "name": "캐릭터 이름 (한국어, 대본에 나온 그대로)",
    "description": "나이, 성별, 외모, 성격, 직업 등 상세 묘사 (한국어 3~4문장, 시각적으로 재현 가능한 수준으로 구체적으로)",
    "imagePrompt": "Photorealistic portrait, [gender], approximately [age] years old, [specific hair: color, length, style], [eye color and shape], [skin tone], [body build: slim/average/muscular/heavy], [specific facial features: jaw, nose, cheekbones], wearing [detailed clothing: color, style, fabric], [expression and pose], professional studio portrait, neutral background, sharp focus, high quality photography"
  }
]

## 주의사항
- 실제로 대본에 등장하거나 이름이 언급된 사람 캐릭터만 포함
- 추상 개념, 장소, 조직, 동물은 제외
- 대본에서 단서가 없는 외모 요소는 이야기 맥락에서 합리적으로 추론
- imagePrompt는 반드시 영어로, 이미지 생성 AI가 정확히 재현할 수 있을 만큼 구체적으로
- 등장인물이 없으면 빈 배열 [] 반환`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { temperature: 0.3, responseMimeType: 'application/json' }
  });

  const raw = response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  console.log('[extractCharacters] raw 응답 길이:', raw.length, '앞부분:', raw.slice(0, 100));

  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      console.log('[extractCharacters] 추출된 캐릭터:', parsed.length, '명', parsed.map((c: any) => c.name));
      return parsed as CharacterInfo[];
    }
  } catch (e) {
    console.error('[extractCharacters] JSON 파싱 실패:', e, '/ raw:', raw.slice(0, 300));
  }

  return [];
};

/**
 * 캐릭터 포트레이트 이미지 생성
 */
export const generateCharacterImage = async (character: CharacterInfo): Promise<string | null> => {
  const stylePrompt = getSelectedGeminiStylePrompt();
  const fullPrompt = stylePrompt
    ? `${character.imagePrompt} Style: ${stylePrompt}`
    : character.imagePrompt;

  const ar = localStorage.getItem(CONFIG.STORAGE_KEYS.ASPECT_RATIO) || '16:9';

  // Imagen3 모델 선택 시 Imagen3 사용
  const selectedModel = localStorage.getItem(CONFIG.STORAGE_KEYS.IMAGE_MODEL) || CONFIG.DEFAULT_IMAGE_MODEL;
  if (selectedModel.startsWith('imagen-3')) {
    return generateImageWithImagen3(fullPrompt, selectedModel);
  }

  // Gemini 이미지 생성
  return retryGeminiRequest("Character Image", async () => {
    const genAI = new GoogleGenAI({ apiKey: getGeminiApiKey() });
    const parts: any[] = [{ text: fullPrompt }];

    const response = await genAI.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts },
      config: {
        responseModalities: [Modality.IMAGE],
        imageConfig: { aspectRatio: ar }
      }
    });

    const imagePart = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));
    return imagePart?.inlineData?.data || null;
  });
};

/**
 * 유튜브 썸네일 생성
 * @param topic 주제
 * @param overlayText 썸네일에 넣을 텍스트 (선택)
 */
export const generateThumbnail = async (topic: string, overlayText?: string): Promise<string | null> => {
  const ai = getAI();
  if (!ai) return null;

  const textInstruction = overlayText
    ? `썸네일 이미지 상단 또는 하단에 굵은 한국어 텍스트로 "${overlayText}"를 명확하게 표시하라.`
    : `주제를 잘 나타내는 임팩트 있는 한국어 텍스트를 썸네일에 포함하라.`;

  const prompt = `유튜브 썸네일 이미지를 생성하라. 16:9 비율 (1280x720).
주제: "${topic}"
${textInstruction}
요구사항:
- 강렬하고 눈길을 끄는 비주얼
- 밝고 대비가 강한 색상
- 텍스트는 크고 굵게, 읽기 쉽게
- 전문적인 유튜브 썸네일 스타일
- 클릭을 유도하는 감정적인 표현`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: prompt,
      config: {
        responseModalities: [Modality.IMAGE],
        imageConfig: { aspectRatio: '16:9' },
      },
    });

    const parts = response.candidates?.[0]?.content?.parts;
    if (parts) {
      for (const part of parts) {
        if ((part as any).inlineData?.data) {
          return (part as any).inlineData.data;
        }
      }
    }
    return null;
  } catch (e) {
    console.error('[Thumbnail] 생성 실패:', e);
    return null;
  }
};

// ── 썸네일 전략 분석 ──────────────────────────────────────────────────────────
export const analyzeThumbnailStrategy = async (params: {
  topic: string;
  characterEnabled: boolean;
  characterType: string;
  characterDetails: string;
  targetAudience: string;
}): Promise<{ summary: string; mainText: string; subText: string; imagePrompt: string } | null> => {
  const ai = getAI();
  if (!ai) return null;

  const charDesc = params.characterEnabled
    ? `등장 피사체: ${params.characterType} - ${params.characterDetails}`
    : '피사체 없음 (배경/사물 중심)';

  const prompt = `당신은 유튜브 썸네일 전략가입니다. 다음 정보를 바탕으로 클릭율을 극대화하는 썸네일 전략을 JSON으로 제안하세요.

영상 주제: "${params.topic}"
${charDesc}
시청 타겟: ${params.targetAudience}

다음 JSON 형식으로 반드시 응답하세요 (다른 텍스트 없이 JSON만):
{
  "summary": "전략 분석 요약 (2-3문장, 한국어)",
  "mainText": "메인 문구 (10자 이내, 임팩트 있게, 한국어)",
  "subText": "서브 문구 (15자 이내, 한국어)",
  "imagePrompt": "썸네일 이미지 생성 프롬프트 (한국어, 구체적으로 시각적 요소 묘사, 100자 이내)"
}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('[ThumbnailStrategy] 분석 실패:', e);
    return null;
  }
};

// ── 썸네일 V2 생성 ────────────────────────────────────────────────────────────
export const generateThumbnailV2 = async (params: {
  topic: string;
  mainText: string;
  subText: string;
  imagePrompt: string;
  borderStyle: string;
  thumbnailRatio?: '16:9' | '9:16';
  characterEnabled: boolean;
  characterType: string;
  characterDetails: string;
  targetAudience: string;
  showChannelName: boolean;
  channelName: string;
  editRequest?: string;
  model?: string;
  inputImage?: string; // base64 — 업로드된 배경 이미지 (Nano Banana에 직접 전달)
}): Promise<string | null> => {
  const ai = getAI();
  if (!ai) return null;

  const borderDesc: Record<string, string> = {
    none: '',
    solid: '테두리: 굵은 단색 테두리로 텍스트 강조.',
    neon: '테두리: 네온 글로우 효과로 텍스트 발광.',
    sketch: '테두리: 손그림/낙서 스타일 테두리.',
  };

  const charDesc = params.characterEnabled ? `등장 피사체: ${params.characterDetails} (${params.characterType})` : '';
  const channelDesc = params.showChannelName && params.channelName
    ? `채널명 "${params.channelName}"을 썸네일 하단 모서리에 작게 표시.`
    : '';
  const editDesc = params.editRequest
    ? `\n수정 요청 (아래 사항만 변경하고 나머지 구도·색상·스타일·분위기는 완전히 동일하게 유지할 것): ${params.editRequest}`
    : '';
  const ratio = params.thumbnailRatio || '16:9';
  const sizeDesc = ratio === '9:16' ? '9:16 비율 (1080×1920) 세로형 숏츠' : '16:9 비율 (1280×720) 가로형';

  // 선택된 모델이 Gemini 계열이면 그대로, 아니면 기본 이미지 모델 사용
  const thumbnailModel = (params.model && params.model.startsWith('gemini')) ? params.model : 'gemini-2.5-flash-image';
  const isNanoBanana = thumbnailModel.startsWith('gemini-3');

  // Nano Banana 2: 텍스트 포함 완성 썸네일 생성 (이미지 안에 텍스트 직접 렌더링)
  // 일반 Gemini: 배경만 생성 (텍스트는 Canvas 오버레이로 별도 추가)
  const prompt = isNanoBanana
    ? `Generate a complete YouTube thumbnail image. ${sizeDesc}.

Topic: "${params.topic}"
Target audience: ${params.targetAudience}
${charDesc}
${channelDesc}${editDesc}

Visual direction: ${params.imagePrompt}
${borderDesc[params.borderStyle] ? '\n' + borderDesc[params.borderStyle] : ''}

TEXT TO RENDER IN THE IMAGE (required, render clearly):
- Main title (very large, bold, top 30% of image): "${params.mainText}"
- Subtitle (medium size, below main title): "${params.subText}"

Requirements:
- Korean text must be rendered beautifully with high contrast and strong outline/shadow
- Main title: extremely large, bold, highly visible, impactful
- Strong visual impact, bright high-contrast colors, professional YouTube thumbnail style
- ONE single continuous image. No panels, no splits, no borders.`
    : `Generate a YouTube thumbnail BACKGROUND IMAGE ONLY. ${sizeDesc}.

Topic: "${params.topic}"
Target audience: ${params.targetAudience}
${charDesc}
${borderDesc[params.borderStyle] || ''}
${channelDesc}${editDesc}

Visual direction: ${params.imagePrompt}

⛔ ABSOLUTE RULES — VIOLATION = FAILURE:
1. ZERO TEXT: Do NOT render ANY text, letters, words, numbers, Korean characters, Latin characters, signs, captions, watermarks, or any written symbols ANYWHERE in the image. Text will be added as a separate overlay. Any text in the image = complete failure.
2. SINGLE FRAME: One continuous scene only. No panels, no split screens, no comic strips, no borders dividing the image.
3. BACKGROUND ONLY: Leave the upper 30% area relatively open (gradient or solid color) for text overlay placement.
4. Strong visual impact, bright high-contrast colors, professional YouTube thumbnail style.`;

  try {
    // 업로드 이미지가 있으면 이미지+텍스트 같이 전달 (Nano Banana 이미지 편집)
    const contents = (isNanoBanana && params.inputImage)
      ? { parts: [
          { inlineData: { data: params.inputImage, mimeType: 'image/jpeg' } },
          { text: `이 이미지를 기반으로 유튜브 썸네일을 만들어줘. 이미지 구도와 분위기는 최대한 유지하면서 아래 텍스트를 크고 선명하게 추가해줘.\n\n${prompt}` }
        ]}
      : prompt;
    const response = await ai.models.generateContent({
      model: thumbnailModel,
      contents,
      config: (isNanoBanana && params.inputImage)
        ? { responseModalities: [Modality.TEXT, Modality.IMAGE] }
        : { responseModalities: [Modality.IMAGE], imageConfig: { aspectRatio: ratio === '9:16' ? '9:16' : '16:9' } },
    });
    const parts = response.candidates?.[0]?.content?.parts;
    if (parts) {
      for (const part of parts) {
        if ((part as any).inlineData?.data) return (part as any).inlineData.data;
      }
    }
    return null;
  } catch (e) {
    console.error('[ThumbnailV2] 생성 실패:', e);
    return null;
  }
};
