
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { ScriptScene, ReferenceImages } from "../types";
import { SYSTEM_INSTRUCTIONS, getTrendSearchPrompt, getScriptGenerationPrompt, getFinalVisualPrompt, getScriptReviewPrompt, getTitleSuggestionPrompt } from "./prompts";
import { CONFIG, GEMINI_STYLE_CATEGORIES, GeminiStyleId, VISUAL_STYLES } from "../config";
import { faceSwapCharacter } from "./falService";
import { getVoiceSetting } from "../utils/voiceStorage";
import { generateGCloudTTS } from "./googleCloudTTSService";

/**
 * Gemini API 클라이언트 초기화
 */
const getGeminiApiKey = () => {
  const raw = localStorage.getItem('heaven_gemini_key') || process.env.GEMINI_API_KEY || '';
  return raw.replace(/[^\x20-\x7E]/g, '').trim();
};

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

  // Step 1: 마크다운 코드 블록 제거
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  // Step 2: 문자열 내부 제어문자 + 이스케이프 안 된 따옴표 선제 수리
  // ⚠️ bracket 추출 전에 반드시 수행 — 이후 inString 추적이 정확해야 함
  {
    let fixed = '';
    let inStr = false;
    let esc = false;
    for (let i = 0; i < cleaned.length; i++) {
      const c = cleaned[i];
      if (esc) { fixed += c; esc = false; continue; }
      if (c === '\\') { fixed += c; esc = true; continue; }
      if (!inStr && c === '"') { inStr = true; fixed += c; continue; }
      if (inStr && c === '"') {
        // peek-ahead: 다음 의미 있는 문자가 : , } ] 이면 문자열 끝 → 아니면 내부 따옴표 이스케이프
        let j = i + 1;
        while (j < cleaned.length && (cleaned[j] === ' ' || cleaned[j] === '\n' || cleaned[j] === '\r' || cleaned[j] === '\t')) j++;
        const next = j < cleaned.length ? cleaned[j] : '';
        if (':,}]'.includes(next) || next === '') { inStr = false; fixed += c; }
        else { fixed += '\\"'; }
        continue;
      }
      if (inStr) {
        // 문자열 내부 줄바꿈·탭 → 공백으로 (\\n 임베딩보다 안전)
        if (c === '\n' || c === '\r' || c === '\t') { fixed += ' '; continue; }
      }
      fixed += c;
    }
    cleaned = fixed;
  }

  // Step 3: JSON 배열/객체 경계 추출 (이제 inString 추적이 정확함)
  const firstBracket = cleaned.search(/[\[{]/);
  if (firstBracket === -1) {
    console.warn('[JSON Clean] JSON 시작 브래킷 없음:', cleaned.slice(0, 100));
    return '[]';
  }

  let depth = 0;
  let lastValidIndex = -1;
  let inString = false;
  let escapeNext = false;
  for (let i = firstBracket; i < cleaned.length; i++) {
    const char = cleaned[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (char === '\\') { escapeNext = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === '[' || char === '{') depth++;
    if (char === ']' || char === '}') {
      depth--;
      if (depth === 0) { lastValidIndex = i; break; }
    }
  }

  if (lastValidIndex !== -1) {
    cleaned = cleaned.slice(firstBracket, lastValidIndex + 1);
  } else {
    console.warn(`[JSON Clean] JSON 불완전 — 손실 복구 시도`);
    cleaned = cleaned.slice(firstBracket);
    const lastCompleteEnd = findLastCompleteSceneObject(cleaned);
    if (lastCompleteEnd > 0) {
      cleaned = cleaned.slice(0, lastCompleteEnd) + (cleaned.includes('"scenes"') ? ']}' : ']');
    } else {
      console.error('[JSON Clean] 복구 불가능');
      return '[]';
    }
  }

  // Step 4: trailing comma 제거
  cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');

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

  // 1단계: 채널 URL → 채널 ID 변환 (모든 URL 형식 지원)
  const resolveChannelId = async (input: string): Promise<string | null> => {
    const raw = input.trim().replace(/\/$/, '');

    // 이미 채널 ID (UC로 시작)
    if (raw.startsWith('UC') && raw.length > 20) return raw;

    // /channel/UCxxx 형식
    const channelMatch = raw.match(/\/channel\/(UC[\w\-]+)/);
    if (channelMatch) return channelMatch[1];

    // watch?v= 또는 youtu.be/ — 영상 URL에서 채널 ID 추출
    const videoMatch = raw.match(/(?:v=|youtu\.be\/)([\w\-]{11})/);
    if (videoMatch) {
      const qs = new URLSearchParams({ part: 'snippet', id: videoMatch[1], key: apiKey });
      const res = await fetch(`${BASE}/videos?${qs}`);
      const data = await res.json();
      if (data.error) throw new Error(`YouTube API 오류: ${data.error.message}`);
      return data.items?.[0]?.snippet?.channelId || null;
    }

    // @handle 형식
    const handleMatch = raw.match(/(?:youtube\.com\/)?@([\w\-\.]+)/);
    if (handleMatch) {
      const handle = handleMatch[1];
      // 1) forHandle API
      const qs1 = new URLSearchParams({ part: 'id', forHandle: `@${handle}`, key: apiKey });
      const res1 = await fetch(`${BASE}/channels?${qs1}`);
      const data1 = await res1.json();
      if (data1.error) throw new Error(`YouTube API 오류(${data1.error.code}): ${data1.error.message}`);
      if (data1.items?.[0]?.id) return data1.items[0].id;

      // 2) 검색 폴백
      const qs2 = new URLSearchParams({ part: 'snippet', q: handle, type: 'channel', maxResults: '3', key: apiKey });
      const res2 = await fetch(`${BASE}/search?${qs2}`);
      const data2 = await res2.json();
      if (data2.error) throw new Error(`YouTube 검색 오류(${data2.error.code}): ${data2.error.message}`);
      const found = data2.items?.find((it: any) =>
        it.snippet?.customUrl?.replace('@','').toLowerCase() === handle.toLowerCase()
      );
      return found?.snippet?.channelId || data2.items?.[0]?.snippet?.channelId || null;
    }

    // /c/ 또는 /user/ 형식
    const legacyMatch = raw.match(/youtube\.com\/(?:c|user)\/([^\/\?&]+)/);
    if (legacyMatch) {
      const qs = new URLSearchParams({ part: 'id', forUsername: legacyMatch[1], key: apiKey });
      const res = await fetch(`${BASE}/channels?${qs}`);
      const data = await res.json();
      if (data.error) throw new Error(`YouTube API 오류: ${data.error.message}`);
      return data.items?.[0]?.id || null;
    }

    throw new Error(`인식할 수 없는 URL 형식입니다: ${raw}`);
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
    if (resolvedIds.length === 0) throw new Error('채널을 찾지 못했습니다. 유튜브 채널 URL을 그대로 붙여넣어 주세요. (예: https://www.youtube.com/@채널명)');
    for (const channelId of resolvedIds) {
      const items = await searchItems({ part: 'snippet', channelId, type: 'video', maxResults: '30', order: 'date', regionCode: 'KR', relevanceLanguage: 'ko' });
      for (const item of items) {
        const vid = item.id?.videoId; if (!vid) continue;
        allVideoIds.push(vid);
        videoChannelMap[vid] = item.snippet?.channelId || '';
        videoTitles[vid] = item.snippet?.title || '';
      }
    }
  } else {
    const CATEGORY_SEARCH_QUERIES: Record<string, string> = {
      '쇼핑/제품리뷰': '알리익스프레스 꿀템 언박싱 가성비 제품리뷰',
      '경제/재테크/투자': '재테크 부업 직장인 월급 투자 절세 부동산',
      '한국사/세계사': '조선시대 충격 역사 비하인드 숨겨진 사실',
      '과학/우주/자연': '우주 충격 과학 발견 동물 자연 미스터리',
      '뉴스/시사/사회': '한국 사회 이슈 논란 충격 사건 실화',
      '종교/영성/철학': '사후세계 기적 임사체험 영적 체험 인생',
      '건강/의학': '의사 추천 건강 음식 암 예방 다이어트 증상',
      '심리/정신건강': '나르시시스트 심리 MBTI 번아웃 불안 공황',
      '연예/문화': 'K팝 아이돌 드라마 연예인 충격 반전 비하인드',
      '스포츠': '손흥민 한국 스포츠 역대급 경기 감동 반전',
      '유머/웃긴영상': '웃긴영상 황당한 썰 직장인 공감 실수 모음',
      '영화/드라마/애니': '영화 숨겨진 반전 드라마 결말 해석 명장면',
      '한국 야담/기담/미스터리': '한국 미스터리 귀신 도시전설 소름 실화 미제사건',
    };
    const searchQ = CATEGORY_SEARCH_QUERIES[category] || category;
    const items = await searchItems({ part: 'snippet', q: searchQ, type: 'video', maxResults: '50', order: 'viewCount', regionCode: 'KR', relevanceLanguage: 'ko' });
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

  const isHumorCat = category.includes('유머') || category.includes('웃긴') || category.includes('코미디');
  const humorInstruction = isHumorCat ? `
⚠️ 이 카테고리는 유머/코미디입니다. 추천 주제는 반드시:
- 웃음을 유발하는 황당한 상황, 예상치 못한 반전, 실수/사고 모음, 공감되는 일상 코미디
- 요즘 대세 '썰' 포맷 적극 반영: "직장 황당 썰", "역대급 민폐 썰", "실화 인생 썰" 형태
- 진지한 인간관계, 자기계발, 정보 전달 주제 절대 금지
- 가볍고 재미있고 클릭을 유발하는 코미디성 제목` : '';
  const prompt = `다음은 "${category}" 카테고리에서 바이럴 지수(조회수÷구독자) 기준 상위 유튜브 영상들입니다 (기간: ${timeRange === 'all' ? '전체' : timeRange === '1year' ? '최근 1년' : timeRange === '6months' ? '최근 6개월' : '최근 3개월'}):

${videoList}

바이럴 지수가 높을수록 구독자 수에 비해 폭발적인 조회수를 얻은 영상입니다.
이 영상들의 성공 패턴을 분석해서, 비슷한 방식으로 새 영상에서 다룰 수 있는 참신한 주제 10개를 추천해주세요.
제목을 그대로 복사하지 말고 영감을 받아 새 주제로 만드세요.
${humorInstruction}

⚠️ 주의: 모든 topic과 reason은 반드시 한국어로 작성 (영어 사용 금지)

JSON 배열로만:
[{"rank":1,"topic":"주제 제목","reason":"바이럴 패턴 분석 포함한 이유"},...]`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: { responseMimeType: 'application/json' },
  });
  return JSON.parse(cleanJsonResponse(response.text || ''));
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
    return JSON.parse(cleanJsonResponse(response.text || ''));
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
    .split(/\n+/)                                          // 1순위: 줄바꿈
    .flatMap(line => line.split(/(?<=[.!?。~])\s+/))      // 2순위: 문장 끝 기호+공백
    .flatMap(line => {
      // 3순위: 줄바꿈 없이 긴 문장(80자 초과)이면 구두점 기준으로 추가 분리
      if (line.length <= 80) return [line];
      const parts: string[] = [];
      // 마침표/물음표/느낌표/쉼표+긴 문장 패턴으로 분리
      const sub = line.split(/(?<=[.!?。,，])\s*(?=[가-힣A-Z])/);
      let cur = '';
      for (const s of sub) {
        cur += (cur ? ' ' : '') + s;
        if (cur.length >= 40) { parts.push(cur); cur = ''; }
      }
      if (cur.trim()) parts.push(cur);
      return parts.length > 1 ? parts : [line];
    })
    .map(s => s.trim())
    .filter(s => s.length > 3);                            // 너무 짧은 단편 제거
}

/**
 * 씬 배열을 target 개수로 강제 조정 — 초과 시 균등 병합, 부족 시 긴 씬 분할
 */
function adjustSceneCount(scenes: ScriptScene[], target: number): ScriptScene[] {
  if (scenes.length === target) return scenes;
  if (scenes.length > target) {
    const merged: ScriptScene[] = [];
    const ratio = scenes.length / target;
    for (let i = 0; i < target; i++) {
      const start = Math.round(i * ratio);
      const end = Math.round((i + 1) * ratio);
      const group = scenes.slice(start, end);
      merged.push({
        sceneNumber: i + 1,
        narration: group.map(s => s.narration).filter(Boolean).join(' '),
        visualPrompt: group[0]?.visualPrompt || '',
        analysis: group[0]?.analysis || {} as any,
      });
    }
    return merged;
  } else {
    const result = scenes.map(s => ({ ...s }));
    while (result.length < target) {
      let maxLen = 0, maxIdx = 0;
      for (let i = 0; i < result.length; i++) {
        if (result[i].narration.length > maxLen) { maxLen = result[i].narration.length; maxIdx = i; }
      }
      if (maxLen < 10) break;
      const scene = result[maxIdx];
      const narr = scene.narration;
      const mid = Math.floor(narr.length / 2);
      const before = narr.slice(0, mid);
      const lastPunct = Math.max(before.lastIndexOf('. '), before.lastIndexOf('! '), before.lastIndexOf('? '), before.lastIndexOf('。'));
      const splitPoint = lastPunct > 0 ? lastPunct + 1 : mid;
      const first = narr.slice(0, splitPoint).trim();
      const second = narr.slice(splitPoint).trim();
      if (!first || !second) break;
      result.splice(maxIdx, 1, { ...scene, narration: first }, { ...scene, narration: second });
      result.forEach((s, i) => { s.sceneNumber = i + 1; });
    }
    return result.slice(0, target).map((s, i) => ({ ...s, sceneNumber: i + 1 }));
  }
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

/**
 * JS가 나레이션을 완전히 고정하고 AI는 이미지 프롬프트+분석만 생성
 * → AI가 씬 수를 절대 변경할 수 없음 (가장 확실한 고정 씬 보장)
 */
const generateVisualPromptsForBlocks = async (
  narrations: string[],
  hasReferenceImage: boolean
): Promise<ScriptScene[]> => {
  const ai = getAI();
  const anthropicKey = localStorage.getItem('heaven_anthropic_key');

  const charRefRule = hasReferenceImage
    ? `- 사람이 등장하면 반드시 "THE CHARACTER"로만 표현. 외모(나이/성별/머리색 등) 묘사 절대 금지`
    : `- 나레이션에 언급된 인물 특성을 반드시 반영 (할아버지→elderly man, 아이→child 등)`;

  const prompt = `아래 ${narrations.length}개 나레이션 각각에 대해 image_prompt_english와 analysis를 생성하라.

## ⚠️ 절대 원칙: 나레이션 = 이미지 (1:1 대응)
- 이것은 창작 작업이 아님. 나레이션이 묘사하는 장소·상황·감정을 그대로 이미지로 변환하는 작업임.
- 나레이션에 없는 장소, 표정, 분위기를 임의로 추가·대체하는 것은 오류임.
- 나레이션의 감정 톤이 이미지의 분위기를 결정함:
  - 부정적 감정(고통·슬픔·두려움·우울·분노·피로 등) → 어둡고 억압적인 분위기, 무거운 표정
  - 긍정적 감정(기쁨·희망·성취·행복 등) → 밝고 따뜻한 분위기
  - 중립적 서술(정보·설명·상황 묘사) → 담담하고 사실적인 분위기
- 나레이션의 장소가 명시되어 있으면 반드시 그 장소를 배경으로 사용할 것.
- 나레이션에 장소가 없으면 나레이션 상황에 가장 자연스러운 공간을 선택할 것.

## 출력 규칙
- 나레이션 수정/병합/건너뛰기 절대 금지
- 반드시 정확히 ${narrations.length}개 항목 출력 (누락 시 실패)
- image_prompt_english: 나레이션 상황을 직접 묘사, WHO+WHAT+WHERE+MOOD+EXPRESSION 포함, 최소 20단어 이상 영문
  - 반드시 캐릭터의 표정/감정을 명시할 것 (예: "with a worried/tense/exhausted expression", "looking sad and defeated", "joyful smile, energetic pose")
  - 나레이션이 부정적이면: "looking distressed", "tense/anxious expression", "worried face" 등 포함 필수
  - 나레이션이 긍정적이면: "happy smile", "confident posture", "joyful expression" 등 포함 필수
- sentiment: 나레이션의 실제 감정 톤 기반 — POSITIVE / NEGATIVE / NEUTRAL
- composition_type: MICRO / STANDARD / MACRO / NO_CHAR 중 하나
${charRefRule}

## 나레이션 목록
${narrations.map((n, i) => `[${i + 1}] ${n}`).join('\n')}

## 출력 형식 (JSON 배열만, 설명 없음)
[{"sceneNumber":1,"narration":"나레이션 그대로 복사","visual_keywords":"","analysis":{"sentiment":"NEUTRAL","composition_type":"STANDARD"},"image_prompt_english":"..."},...]`;

  let responseText = '[]';

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
          max_tokens: Math.min(65536, narrations.length * 600),
          system: 'You are a visual storyboard director. Output ONLY valid JSON array, no markdown.',
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (resp.ok) {
        const d = await resp.json();
        responseText = d.content?.[0]?.text || '[]';
        console.log(`[FixedScene] Claude 성공: ${narrations.length}개 나레이션`);
      } else {
        console.warn(`[FixedScene] Claude 실패 → Gemini fallback`);
      }
    } catch { console.warn(`[FixedScene] Claude 오류 → Gemini fallback`); }
  }

  if (responseText === '[]') {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        thinkingConfig: { thinkingBudget: 8192 },
        responseMimeType: 'application/json',
        maxOutputTokens: Math.min(65536, narrations.length * 600),
        responseSchema: {
          type: 'array' as any,
          items: {
            type: 'object' as any,
            properties: {
              sceneNumber:          { type: 'number' as any },
              narration:            { type: 'string' as any },
              visual_keywords:      { type: 'string' as any },
              image_prompt_english: { type: 'string' as any },
              analysis: {
                type: 'object' as any,
                properties: {
                  sentiment:        { type: 'string' as any },
                  composition_type: { type: 'string' as any },
                },
              },
            },
            required: ['sceneNumber', 'narration', 'image_prompt_english', 'analysis'],
          },
        },
      },
    });
    responseText = response.text || '[]';
  }

  const result = JSON.parse(cleanJsonResponse(responseText));
  const items: any[] = Array.isArray(result) ? result : (result.scenes || []);

  // AI 결과와 JS 나레이션을 1:1 매핑 — AI가 반환한 순서 기준으로 매핑
  // AI가 누락하거나 순서가 틀려도 JS 나레이션을 기준으로 정확히 N개 보장
  return narrations.map((narration, idx) => {
    const aiItem = items[idx] || {};
    return {
      sceneNumber: idx + 1,
      narration,                              // ← JS 고정값 사용 (AI 값 무시)
      visualPrompt: aiItem.image_prompt_english || '',
      analysis: aiItem.analysis || {},
    };
  });
};

const generateScriptSingle = async (
  topic: string,
  hasReferenceImage: boolean,
  sourceContext?: string | null,
  chunkInfo?: { current: number; total: number },
  maxScenes?: number,
  referenceVideoContext?: string,
  category?: string,
  targetMinutes?: number,
  blueprint?: string,
  chunkContext?: string
): Promise<ScriptScene[]> => {
  // ─── 대본(수동입력)이 있을 때: JS 고정 나레이션 + AI 이미지 프롬프트만 생성 ───
  // maxScenes 유무와 무관하게 AI가 나레이션을 절대 수정/삭제/병합 못하도록 분리
  if (sourceContext) {
    const chunkLabel = chunkInfo ? `[청크 ${chunkInfo.current}/${chunkInfo.total}] ` : '';
    const sentences = splitIntoSentences(sourceContext);
    console.log(`${chunkLabel}[FixedScene] 문장 수: ${sentences.length}개, 목표 씬: ${maxScenes ?? '자동'}개`);

    if (sentences.length > 0) {
      const targetBlocks = maxScenes || sentences.length;
      const blocks = groupSentencesIntoBlocks(sentences, targetBlocks);
      console.log(`${chunkLabel}[FixedScene] JS 분할 완료: ${blocks.length}개 나레이션 고정 (AI 수정 불가)`);
      let result = await retryGeminiRequest("FixedScene Visual", () =>
        generateVisualPromptsForBlocks(blocks, hasReferenceImage)
      );
      if (maxScenes && result.length !== maxScenes) {
        console.log(`${chunkLabel}[FixedScene] 씬 수 조정: ${result.length}개 → ${maxScenes}개`);
        result = adjustSceneCount(result, maxScenes);
      }
      return result;
    }
  }

  return retryGeminiRequest("Script Generation", async () => {
    const isAutoMode = !sourceContext && topic !== "Manual Script Input";
    const baseInstruction = topic === "Manual Script Input" ? SYSTEM_INSTRUCTIONS.MANUAL_VISUAL_MATCHER :
                            hasReferenceImage ? SYSTEM_INSTRUCTIONS.REFERENCE_MATCH :
                            isAutoMode ? SYSTEM_INSTRUCTIONS.VIRAL_SCRIPT_WRITER :
                            SYSTEM_INSTRUCTIONS.CHIEF_ART_DIRECTOR;

    const chunkLabel = chunkInfo ? `[청크 ${chunkInfo.current}/${chunkInfo.total}] ` : '';
    let contentForPrompt = sourceContext || null;
    let targetSceneCount = maxScenes;

    // 입력 길이 및 토큰 계산
    const inputText = contentForPrompt || topic;
    const inputLength = inputText.length;
    const estimatedSceneCount = targetSceneCount || Math.max(1, Math.ceil(inputLength / 80));
    const calculatedTokens = Math.ceil(estimatedSceneCount * 900 * 1.5);
    const maxOutputTokens = Math.min(65536, Math.max(16384, calculatedTokens));

    console.log(`${chunkLabel}[Script] 입력: ${inputLength}자, 목표 씬: ${estimatedSceneCount}개, maxOutputTokens: ${maxOutputTokens}`);

    const writingGuide = localStorage.getItem('heaven_writing_guide') || '';
    const promptText = getScriptGenerationPrompt(topic, contentForPrompt, targetSceneCount, false, undefined, writingGuide, referenceVideoContext, category, targetMinutes, blueprint, chunkContext);
    const anthropicKey = localStorage.getItem('heaven_anthropic_key');
    let responseText: string = '[]';

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
          responseSchema: {
            type: 'array' as any,
            items: {
              type: 'object' as any,
              properties: {
                sceneNumber:          { type: 'number' as any },
                narration:            { type: 'string' as any },
                image_prompt_english: { type: 'string' as any },
                analysis: {
                  type: 'object' as any,
                  properties: {
                    sentiment:        { type: 'string' as any },
                    composition_type: { type: 'string' as any },
                  },
                },
              },
              required: ['sceneNumber', 'narration', 'image_prompt_english', 'analysis'],
            },
          },
        },
      });
      const finishReason = response.candidates?.[0]?.finishReason;
      if (finishReason === 'MAX_TOKENS' || String(finishReason) === 'STOP_TRUNCATED') {
        console.warn(`${chunkLabel}[Script] ⚠️ 응답 토큰 제한 잘림. finishReason: ${finishReason}`);
      }
      responseText = response.text || '[]';
    }

    let result: any;
    try {
      result = JSON.parse(cleanJsonResponse(responseText));
    } catch (e: any) {
      console.error(`${chunkLabel}[Script] JSON 파싱 실패:`, e.message, '\n응답 앞부분:', responseText.slice(0, 200));
      throw new Error(`대본 생성 중 JSON 파싱 실패: ${e.message}`);
    }
    const scenes = Array.isArray(result) ? result : (result.scenes || []);

    console.log(`${chunkLabel}[Script] 생성된 씬 개수: ${scenes.length}`);

    // 씬이 너무 적으면 경고
    if (scenes.length < 3) {
      console.warn(`${chunkLabel}[Warning] 씬이 ${scenes.length}개만 생성됨. 대본이 제대로 분할되지 않았을 수 있음.`);
    }

    const sorted = [...scenes].sort((a: any, b: any) => (a.sceneNumber || 0) - (b.sceneNumber || 0));
    let mapped: ScriptScene[] = sorted.map((scene: any, idx: number) => ({
      sceneNumber: idx + 1,
      narration: cleanNarration(scene.narration || ""),
      visualPrompt: scene.image_prompt_english || "",
      analysis: (scene.analysis || {}) as any,
    }));

    // ── 씬 수 엄격 고정 ──
    // AI가 요청 씬 수의 80%~120% 범위를 벗어나면 재시도 (1회)
    if (maxScenes && mapped.length !== maxScenes) {
      const ratio = mapped.length / maxScenes;
      if (ratio < 0.8 || ratio > 1.2) {
        // 씬 수 차이가 크면 재시도
        console.warn(`${chunkLabel}[Script] 씬 수 불일치 (생성: ${mapped.length}개, 요청: ${maxScenes}개) → 재시도`);
        const retryPrompt = getScriptGenerationPrompt(topic, contentForPrompt, maxScenes, false, undefined, writingGuide, referenceVideoContext, category, targetMinutes, blueprint, chunkContext)
          + `\n\n⚠️ 이전 생성에서 씬 수가 틀렸습니다. 반드시 정확히 ${maxScenes}개 씬을 생성하세요. 씬 수가 ${maxScenes}개가 아니면 오류입니다.`;
        let retryText = '[]';
        if (anthropicKey) {
          try {
            const r = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' },
              body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxOutputTokens, system: baseInstruction + '\n\nOutput ONLY a valid JSON array. No markdown code fences.', messages: [{ role: 'user', content: retryPrompt }] }),
            });
            if (r.ok) { const d = await r.json(); retryText = d.content?.[0]?.text || '[]'; }
          } catch { /* fallback below */ }
        }
        if (retryText === '[]') {
          const r2 = await getAI().models.generateContent({
            model: 'gemini-2.5-flash', contents: retryPrompt,
            config: { thinkingConfig: { thinkingBudget: 0 }, responseMimeType: 'application/json', maxOutputTokens, responseSchema: { type: 'array' as any, items: { type: 'object' as any } } },
          });
          retryText = r2.text || '[]';
        }
        try {
          const retryResult = JSON.parse(cleanJsonResponse(retryText));
          const retryScenes = Array.isArray(retryResult) ? retryResult : (retryResult.scenes || []);
          if (retryScenes.length > 0) {
            const retrySorted = [...retryScenes].sort((a: any, b: any) => (a.sceneNumber || 0) - (b.sceneNumber || 0));
            mapped = retrySorted.map((scene: any, idx: number) => ({
              sceneNumber: idx + 1, narration: cleanNarration(scene.narration || ''), visualPrompt: scene.image_prompt_english || '', analysis: (scene.analysis || {}) as any,
            }));
            console.log(`${chunkLabel}[Script] 재시도 결과: ${mapped.length}개 씬`);
          }
        } catch { /* 재시도 실패 시 원본 유지 */ }
      }
      // 그래도 안 맞으면 강제 조정
      if (mapped.length !== maxScenes) {
        console.log(`${chunkLabel}[Script] 씬 수 강제 조정: ${mapped.length}개 → ${maxScenes}개`);
        mapped = adjustSceneCount(mapped, maxScenes);
      }
    }

    return mapped;
  });
};

/**
 * 주제 + 대본 요약을 분석해 전체 영상의 비주얼 톤/분위기를 추출
 * 예: 심리/어두운 내용 → "cinematic noir, deep navy and shadow palette, dramatic low-key lighting"
 * 예: 두바이 럭셔리 → "luxury lifestyle, warm golden tones, champagne palette, opulent atmosphere"
 */
export const analyzeVisualDNA = async (
  topic: string,
  scriptSummary: string
): Promise<string> => {
  const ai = getAI();
  const prompt = `You are a visual director. Analyze the topic and script below, then define a concise visual style directive for ALL scenes.

Topic: "${topic}"
Script excerpt:
${scriptSummary.slice(0, 800)}

Return ONE LINE of visual style keywords in English that will be prepended to every image generation prompt.
Focus on: color palette, lighting style, mood/atmosphere, artistic style.

Examples:
- Dark psychology content → "cinematic noir style, deep navy and charcoal tones, dramatic low-key shadows, mysterious and tense atmosphere"
- Dubai luxury content → "luxury lifestyle photography, warm golden and champagne tones, bright elegant lighting, opulent and glamorous atmosphere"
- Children's content → "colorful and playful illustration style, bright vivid colors, soft warm lighting, cheerful and whimsical atmosphere"
- Horror/mystery → "horror atmosphere, blood red and deep black palette, harsh contrast lighting, eerie and unsettling mood"
- History/traditional → "historical documentary style, sepia and earth tones, soft cinematic lighting, epic and grand atmosphere"

Output ONLY the style keywords, nothing else. Max 20 words.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    const result = response.text?.trim() || '';
    console.log(`[VisualDNA] 분석 완료: ${result}`);
    return result;
  } catch (e) {
    console.warn('[VisualDNA] 분석 실패, 기본값 사용:', e);
    return '';
  }
};

/**
 * 전체 대본을 읽고 각 씬의 이미지 프롬프트를 재작성
 * - 스크립트 생성 직후, 이미지 생성 전에 호출
 * - AI가 전체 맥락(등장인물 나이/특성, 장소, 시간대 등)을 파악한 후 프롬프트 작성
 */
const ENRICH_CHUNK_SIZE = 20;

async function enrichImagePromptsChunk(
  chunk: ScriptScene[],
  fullScriptSummary: string,
  hasCharacterRef: boolean,
  visualDNA: string
): Promise<Map<number, string>> {
  const ai = getAI();

  const chunkSummary = chunk.map(s => `[${s.sceneNumber}] ${s.narration}`).join('\n');

  const charRefRule = hasCharacterRef
    ? `- 사람이 등장하는 씬: 반드시 "THE CHARACTER"만 사용, 외모(나이/성별/머리색 등) 절대 묘사 금지`
    : `- 나레이션에서 언급된 인물의 나이/특성을 반드시 반영 (할아버지→elderly man, 아이→child, 젊은 여성→young woman 등)`;

  const visualDNASection = visualDNA
    ? `\n## 🎨 전체 영상 비주얼 톤 (모든 씬에 반드시 반영)\n${visualDNA}\n`
    : '';

  const prompt = `당신은 영상 스토리보드 전문가입니다.
전체 대본 맥락을 파악한 뒤, 지정된 씬들의 이미지 프롬프트를 작성하라.
${visualDNASection}
## 전체 대본 (맥락 파악용 — 전체 흐름 이해)
${fullScriptSummary}

## ⚠️ 핵심 규칙 (반드시 준수)
1. 나레이션과 이미지 100% 일치: "산속"→mountain forest, "마당"→courtyard
2. 인물 묘사 정확히: 나레이션 인물 특성 반영
${charRefRule}
3. 장소 일치: 나레이션에 나온 장소 그대로 묘사
4. 씬 간 일관성: 같은 인물이 여러 씬에 등장 시 동일 인물 유지

## 이미지 프롬프트 작성 요소
- WHO / WHAT / WHERE / MOOD

## 프롬프트 작성 대상 씬 (아래 씬들만 출력)
${chunkSummary}

## 출력 형식
[{"sceneNumber": N, "image_prompt_english": "..."}]
JSON 배열만, 설명 없음.`;

  const anthropicKey = localStorage.getItem('heaven_anthropic_key');
  let responseText: string = '[]';

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
          max_tokens: Math.min(16000, chunk.length * 200),
          system: 'Output ONLY a valid JSON array. No markdown, no explanation.',
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        responseText = data.content?.[0]?.text || '[]';
      } else {
        throw new Error(`Claude ${resp.status}`);
      }
    } catch {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: { responseMimeType: 'application/json', maxOutputTokens: Math.min(16000, chunk.length * 200) },
      });
      responseText = response.text || '[]';
    }
  } else {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json', maxOutputTokens: Math.min(16000, chunk.length * 200) },
    });
    responseText = response.text || '[]';
  }

  const parsed = JSON.parse(cleanJsonResponse(responseText));
  const map = new Map<number, string>();
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (item.sceneNumber && item.image_prompt_english) {
        map.set(item.sceneNumber, item.image_prompt_english);
      }
    }
  }
  return map;
}

export const enrichImagePrompts = async (
  scenes: ScriptScene[],
  hasCharacterRef: boolean = false,
  visualDNA: string = ''
): Promise<ScriptScene[]> => {
  if (scenes.length === 0) return scenes;

  // 전체 대본 요약 (맥락용 — 청크 공통 사용)
  const fullScriptSummary = scenes
    .map(s => `[${s.sceneNumber}] ${s.narration}`)
    .join('\n');

  // 씬이 적으면 단일 처리
  if (scenes.length <= ENRICH_CHUNK_SIZE) {
    return retryGeminiRequest("Image Prompt Enrichment", async () => {
      const map = await enrichImagePromptsChunk(scenes, fullScriptSummary, hasCharacterRef, visualDNA);
      return scenes.map(s => ({ ...s, visualPrompt: map.get(s.sceneNumber) || s.visualPrompt }));
    });
  }

  // 씬이 많으면 청크 분할 처리
  console.log(`[Prompts] ${scenes.length}개 씬 → ${Math.ceil(scenes.length / ENRICH_CHUNK_SIZE)}개 청크로 분할 재작성`);
  const promptMap = new Map<number, string>();

  for (let i = 0; i < scenes.length; i += ENRICH_CHUNK_SIZE) {
    const chunk = scenes.slice(i, i + ENRICH_CHUNK_SIZE);
    console.log(`[Prompts] 청크 ${Math.floor(i / ENRICH_CHUNK_SIZE) + 1}: 씬 ${chunk[0].sceneNumber}~${chunk[chunk.length - 1].sceneNumber}`);
    try {
      const chunkMap = await retryGeminiRequest("Image Prompt Enrichment Chunk", () =>
        enrichImagePromptsChunk(chunk, fullScriptSummary, hasCharacterRef, visualDNA)
      );
      chunkMap.forEach((v, k) => promptMap.set(k, v));
    } catch (e: any) {
      console.warn(`[Prompts] 청크 ${Math.floor(i / ENRICH_CHUNK_SIZE) + 1} 실패, 기존 프롬프트 유지:`, e.message);
    }
    if (i + ENRICH_CHUNK_SIZE < scenes.length) await wait(800);
  }

  return scenes.map(s => ({ ...s, visualPrompt: promptMap.get(s.sceneNumber) || s.visualPrompt }));
};

/**
 * 기존 generateScript 함수 (하위 호환성 유지)
 */
export const generateScript = async (
  topic: string,
  hasReferenceImage: boolean,
  sourceContext?: string | null,
  maxScenes?: number,
  referenceVideoContext?: string,
  category?: string,
  targetMinutes?: number,
  blueprint?: string
): Promise<ScriptScene[]> => {
  return generateScriptSingle(topic, hasReferenceImage, sourceContext, undefined, maxScenes, referenceVideoContext, category, targetMinutes, blueprint);
};

/**
 * 롱폼 자동 대본 청크 생성 (자동 주제 모드 전용, 15분 초과 시)
 * 블루프린트를 파싱해 섹션별로 나눠 순차 생성 → 연속성 유지
 */
export const generateScriptLongform = async (
  topic: string,
  hasReferenceImage: boolean,
  totalMinutes: number,
  blueprint: string,
  category?: string,
  referenceVideoContext?: string,
  onProgress?: (msg: string) => void
): Promise<ScriptScene[]> => {
  // 블루프린트에서 섹션 파싱: "섹션명 (N분):" or "섹션명 N분 -" 패턴
  const lines = blueprint.split('\n').filter(l => l.trim());

  interface Section { name: string; minutes: number; description: string; }
  const sections: Section[] = [];

  for (const line of lines) {
    const match = line.match(/^(.+?)\s*[\(\[（]?\s*(\d+(?:\.\d+)?)\s*분\s*[\)\]）]?\s*[:\-–](.*)/);
    if (match) {
      sections.push({ name: match[1].trim(), minutes: parseFloat(match[2]), description: match[3].trim() });
    }
  }

  // 섹션 파싱 실패 시 총 시간 기반 균등 분할 (5분 단위)
  if (sections.length === 0) {
    const chunkMin = 10;
    const chunks = Math.ceil(totalMinutes / chunkMin);
    for (let i = 0; i < chunks; i++) {
      const min = Math.min(chunkMin, totalMinutes - i * chunkMin);
      sections.push({ name: `파트 ${i + 1}`, minutes: min, description: '' });
    }
  }

  console.log(`[Longform] 총 ${totalMinutes}분, ${sections.length}개 섹션으로 분할`);
  const allScenes: ScriptScene[] = [];
  let sceneOffset = 0;

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const scenesForSection = Math.max(1, Math.round(sec.minutes * 7));
    const sectionBlueprint = `[${sec.name}] (${sec.minutes}분)\n${sec.description}`;
    const chunkContext = allScenes.length > 0
      ? allScenes.slice(-3).map(s => `씬 ${s.sceneNumber}: ${s.narration}`).join('\n')
      : undefined;

    onProgress?.(`대본 생성 중... 섹션 ${i + 1}/${sections.length}: ${sec.name} (${sec.minutes}분)`);
    console.log(`[Longform] 섹션 ${i + 1}/${sections.length}: ${sec.name}, ${scenesForSection}씬`);

    const sectionScenes = await generateScriptSingle(
      topic, hasReferenceImage, null, { current: i + 1, total: sections.length },
      scenesForSection, referenceVideoContext, category, sec.minutes,
      sectionBlueprint, chunkContext
    );

    // 씬 번호 재부여
    sectionScenes.forEach(s => { s.sceneNumber = sceneOffset + s.sceneNumber; });
    sceneOffset += sectionScenes.length;
    allScenes.push(...sectionScenes);
  }

  return allScenes;
};

/** 대본 검수 + 자동 수정 */
export const reviewScript = async (
  scenes: ScriptScene[],
  topic: string
): Promise<{ score: number; summary: string; issues: Array<{ type: string; scenes: number[]; problem: string; fix: string }>; fixedScenes: ScriptScene[] }> => {
  const narrations = scenes.map(s => `씬 ${s.sceneNumber}: ${s.narration}`).join('\n');
  const prompt = getScriptReviewPrompt(narrations, topic, scenes.length);
  const ai = getAI();

  let raw = '';
  try {
    const resp = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json', maxOutputTokens: 8192 },
    });
    raw = resp.text || '{}';
  } catch (e) {
    console.warn('[Review] Gemini 실패, 검수 건너뜀:', e);
    return { score: 0, summary: '검수 실패', issues: [], fixedScenes: scenes };
  }

  let result: any = {};
  try { result = JSON.parse(cleanJsonResponse(raw)); } catch { return { score: 0, summary: '검수 파싱 실패', issues: [], fixedScenes: scenes }; }

  // fixedNarrations 적용
  const fixed: ScriptScene[] = scenes.map(s => {
    const fixedNarration = result.fixedNarrations?.[String(s.sceneNumber)];
    return fixedNarration ? { ...s, narration: fixedNarration } : s;
  });

  return {
    score: result.score ?? 0,
    summary: result.summary ?? '',
    issues: result.issues ?? [],
    fixedScenes: fixed,
  };
};

/** 바이럴 제목 + 썸네일 제안 */
export const generateTitleSuggestions = async (
  scenes: ScriptScene[],
  topic: string
): Promise<{ titles: Array<{ title: string; reason: string }>; thumbnails: Array<{ keywords: string; image: string; emotion: string }> }> => {
  // 대본 요약 (앞 5씬 + 마지막 2씬 나레이션)
  const sample = [...scenes.slice(0, 5), ...scenes.slice(-2)];
  const summary = sample.map(s => s.narration).join(' / ');
  const prompt = getTitleSuggestionPrompt(summary, topic);
  const ai = getAI();

  let raw = '';
  try {
    const resp = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json', maxOutputTokens: 4096 },
    });
    raw = resp.text || '{}';
  } catch (e) {
    console.warn('[Title] 제목 생성 실패:', e);
    return { titles: [], thumbnails: [] };
  }

  try {
    const result = JSON.parse(cleanJsonResponse(raw));
    return { titles: result.titles ?? [], thumbnails: result.thumbnails ?? [] };
  } catch {
    return { titles: [], thumbnails: [] };
  }
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
  maxScenes?: number,
  category?: string
): Promise<ScriptScene[]> => {
  const inputLength = sourceContext.length;

  // ── maxScenes 지정 시 청크 분할 금지 ────────────────────────────────────
  // 청크 분할은 비례 분배 → 반올림 오차 + AI 미준수로 씬 수 손실 발생.
  // JS 사전분할(groupSentencesIntoBlocks)이 정확히 N개 블록을 보장하므로
  // 전체 대본을 단일 호출로 처리한다.
  if (maxScenes) {
    console.log(`[Chunked Script] maxScenes=${maxScenes} 지정 → 청크 분할 없이 JS 사전분할 단일 처리`);
    onProgress?.(`대본 분석 중... (${maxScenes}개 씬 목표)`);
    return generateScriptSingle(topic, hasReferenceImage, sourceContext, undefined, maxScenes, undefined, category);
  }

  // 청크 분할 기준 이하면 일반 처리
  if (inputLength <= chunkSize) {
    console.log(`[Chunked Script] 입력(${inputLength}자)이 청크 크기(${chunkSize}자) 이하. 일반 처리.`);
    return generateScriptSingle(topic, hasReferenceImage, sourceContext, undefined, maxScenes, undefined, category);
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

    // 청크 내용만 전달 (라벨 텍스트 제거 — AI가 나레이션에 복사 방지)
    const chunkContext = chunks[i];

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
        chunkMaxScenes,
        undefined,
        category
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
  let finalScenes = allScenes
    .sort((a, b) => (a.sceneNumber || 0) - (b.sceneNumber || 0))
    .map((scene, idx) => ({ ...scene, sceneNumber: idx + 1 }));

  // 최종 씬 수 강제 고정 (청크 합산 후 초과/미달 보정)
  if (maxScenes && finalScenes.length !== maxScenes) {
    console.log(`[Chunked Script] 최종 씬 수 보정: ${finalScenes.length}개 → ${maxScenes}개`);
    finalScenes = adjustSceneCount(finalScenes, maxScenes);
  }

  console.log(`[Chunked Script] ========================================`);
  console.log(`[Chunked Script] 총 ${finalScenes.length}개 씬 생성 완료`);
  console.log(`[Chunked Script] ========================================`);

  return finalScenes;
};

/**
 * 선택된 Gemini 화풍 프롬프트 가져오기
 * - 순환 의존성 방지를 위해 직접 localStorage와 config 사용
 */
// 비주얼 스타일 프리뷰 이미지를 base64로 가져오기 (AI 시각 참조용)
const stylePreviewCache: Record<string, string> = {};
const fetchStylePreviewBase64 = async (imgPath: string): Promise<string | null> => {
  if (stylePreviewCache[imgPath]) return stylePreviewCache[imgPath];
  try {
    const resp = await fetch(imgPath);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = (reader.result as string).split(',')[1];
        stylePreviewCache[imgPath] = b64;
        resolve(b64);
      };
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};

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
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            text: `You are analyzing a character reference image to extract a STRICT CONSISTENCY BLUEPRINT for AI image generation.

Output in this EXACT format (no intro, no extra text):

FACE_SHAPE: [e.g., "oval face, defined jawline, high cheekbones"]
SKIN_TONE: [e.g., "warm medium beige, peachy undertone"]
EYES: [color + shape, e.g., "almond-shaped dark brown eyes, thick natural lashes, double eyelids"]
EYEBROWS: [e.g., "straight thick black eyebrows, natural arch"]
NOSE: [e.g., "small button nose, slightly upturned tip"]
LIPS: [e.g., "full lips, natural pink, slightly curved upper lip"]
HAIR_COLOR: [exact color, e.g., "jet black with subtle blue sheen"]
HAIR_STYLE: [e.g., "shoulder-length straight bob, blunt cut bangs"]
BODY_TYPE: [e.g., "slim petite build, small shoulders"]
SIGNATURE_FEATURES: [2-3 most distinctive features that make this character unique, e.g., "very large expressive eyes, small face, cute dimples when smiling"]
CLOTHING: [if identifiable, e.g., "white sailor school uniform with blue trim, red bow tie"]
OVERALL_VIBE: [one sentence capturing the character's essence, e.g., "A cute young Korean female character with large innocent eyes and a gentle expression"]

Be extremely precise. These features will be enforced rigidly across all generated images.`
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

  // 비주얼 스타일 프리뷰 이미지 사전 로드 (AI 시각 참조용)
  const visualStyleId = localStorage.getItem(CONFIG.STORAGE_KEYS.VISUAL_STYLE_ID);
  const activeVisualStyle = (visualStyleId && visualStyleId !== 'none')
    ? (VISUAL_STYLES as readonly { id: string; prompt: string; name: string; img: string }[]).find(s => s.id === visualStyleId) ?? null
    : null;
  let stylePreviewBase64: string | null = null;
  if (activeVisualStyle?.img && !hasStyleRef) {
    stylePreviewBase64 = await fetchStylePreviewBase64(activeVisualStyle.img);
    if (stylePreviewBase64) console.log(`[Image Gen] 비주얼 스타일 프리뷰 이미지 로드 성공: ${activeVisualStyle.id}`);
  }

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
          : textMode === 'korean'
          ? `⚠️ RULE: Korean (한글) ONLY if text appears. Keep text MINIMAL — 1 short word max. Scene must be primarily visual, NOT text-heavy.`
          : '';
        const absoluteRules = [
          `⛔ RULE #1 — ONE SINGLE IMAGE ONLY: Generate exactly ONE continuous, unified image filling the entire canvas.`,
          `FORBIDDEN FOREVER: panels, comic strips, split screens, grids, multiple cuts, storyboard layouts, borders/lines dividing the image, before/after comparisons, side-by-side images, triptychs, diptychs, collages. Any form of image division = INSTANT FAILURE.`,
          textModeRule,
        ].filter(Boolean).join('\n');
        parts.push({ text: absoluteRules });

        if (hasCharacterRef) {
          // ─── 캐릭터 일관성 모드 ───
          // 씬 프롬프트에서 캐릭터 외모 묘사 제거 (참조 이미지 우선)
          const sceneSentiment = (scene.analysis as any)?.sentiment || 'NEUTRAL';
          const expressionInstruction = sceneSentiment === 'NEGATIVE'
            ? `⚠️ MANDATORY EXPRESSION: The character must look SAD, WORRIED, DISTRESSED, or TROUBLED — absolutely NO smiling, NO happy face. The narration is negative/painful. Forced smiling = CRITICAL FAILURE.`
            : sceneSentiment === 'POSITIVE'
            ? `⚠️ MANDATORY EXPRESSION: Character looks HAPPY, CONFIDENT, or RELIEVED — positive expression matching the upbeat narration.`
            : `⚠️ MANDATORY EXPRESSION: Character looks NEUTRAL, THOUGHTFUL, or FOCUSED — calm, serious face matching the informational tone.`;
          // 나레이션을 primary anchor로 사용 — visualPrompt가 틀려도 나레이션으로 보정
          const narAnchor = scene.narration
            ? `⚑ SCENE CONTENT (what this image MUST depict — mandatory): "${scene.narration.slice(0, 200)}"`
            : '';
          const rawVisual = (scene.visualPrompt || sanitizedPrompt).slice(0, 300);
          // 외모 묘사 키워드가 있으면 THE CHARACTER로 대체
          const cleanedVisual = rawVisual
            .replace(/\b(young|old|elderly|woman|man|girl|boy|female|male|person)\s+(with|having|wearing)\s+[^,.]+/gi, 'THE CHARACTER')
            .replace(/\b(blonde|brunette|redhead|black-haired|white-haired|bald)\b/gi, '')
            .replace(/\b(tall|short|slim|fat|chubby|muscular|petite)\b/gi, '')
            .trim();
          const sceneAction = [narAnchor, cleanedVisual ? `Visual guide: ${cleanedVisual}` : ''].filter(Boolean).join('\n');

          const selectedVisualStyle = (() => {
            const vid = localStorage.getItem(CONFIG.STORAGE_KEYS.VISUAL_STYLE_ID);
            if (!vid || vid === 'none') return null;
            return (VISUAL_STYLES as readonly { id: string; prompt: string; name: string }[]).find(s => s.id === vid) ?? null;
          })();

          const styleHint = (() => {
            if (hasStyleRef) return '';
            const sp = getSelectedGeminiStylePrompt();
            return sp ? `\nArt style: ${sp}` : '';
          })();

          // 참조 이미지 나열
          referenceImages.character.forEach((img, idx) => {
            const imageData = img.includes(',') ? img.split(',')[1] : img;
            parts.push({
              text: idx === 0
                ? `This is the character reference image. Study this character's appearance carefully.`
                : `Same character, additional angle:`
            });
            parts.push({ inlineData: { data: imageData, mimeType: 'image/jpeg' } });
          });

          if (selectedVisualStyle) {
            // ─── 비주얼 스타일 선택 시: 스타일 프리뷰 이미지 + 캐릭터 참조 ───
            if (stylePreviewBase64) {
              parts.push({ text: `[TARGET ART STYLE — This is what every image MUST look like]:` });
              parts.push({ inlineData: { data: stylePreviewBase64, mimeType: 'image/jpeg' } });
            }
            parts.push({
              text: `⚠️ DUAL LOCK: CHARACTER IDENTITY + ART STYLE — both must be maintained perfectly.

━━━ CHARACTER IDENTITY (NON-NEGOTIABLE) ━━━
Reproduce the EXACT character from the character reference image(s).
${charTextDesc ? charTextDesc : `Same face, same hair color/style, same proportions — zero deviation.`}
The character must be INSTANTLY RECOGNIZABLE across all scenes.

━━━ ART STYLE (NON-NEGOTIABLE) ━━━
Render EVERYTHING in the exact art style shown in the style reference image above.
Style: ${selectedVisualStyle.prompt}

━━━ HOW TO BALANCE BOTH ━━━
→ Keep the character's IDENTITY (face shape, hair, features)
→ But TRANSLATE their appearance INTO the target art style
→ The character should look like they were originally drawn in this art style

━━━ SCENE ━━━
${sceneAction}

${expressionInstruction}`
            });
          } else {
            parts.push({
              text: `⛔ CHARACTER CONSISTENCY — ABSOLUTE TOP PRIORITY (overrides everything else)

The reference image(s) show the character type/species for this scene.
ALL characters in this scene — including secondary characters — MUST be the SAME species/type as the reference.
If the reference shows a gorilla, ALL characters must be gorillas. NEVER substitute humans or other animals.
⛔ HYBRID FORBIDDEN: NEVER put an animal head on a human body. NEVER create animal-human hybrids.
The ENTIRE body — head, torso, limbs — must match the reference species exactly.
You MUST reproduce this EXACT character. No exceptions. No creative liberties.

━━━ IDENTITY LOCK — COPY EXACTLY ━━━
${charTextDesc ? charTextDesc : `• Face shape, eyes, nose, lips: IDENTICAL to reference
• Hair: EXACT same color, length, texture, style — zero change
• Skin tone: EXACT same as reference
• Body proportions: SAME as reference`}

━━━ MANDATORY CHECKS ━━━
✅ Face: same shape, same eyes, same nose, same lips
✅ Hair: IDENTICAL color and style — if reference has black hair, black hair ONLY
✅ Skin tone: exact match to reference
✅ If someone would look at this image and the reference and say "same person" = SUCCESS
✅ If they would say "different person" = FAILURE — regenerate

❌ ABSOLUTE FAILURES (reject and regenerate):
• Hair color changed (e.g., reference: black → output: brown/blonde = FAILURE)
• Face looks like a different person
• Added/removed facial features
• Different body type or proportions
• Generic face not matching reference

━━━ SCENE (secondary to character identity) ━━━
${sceneAction}

${expressionInstruction}
${styleHint}`
            });
          }

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
          } else if (stylePreviewBase64 && activeVisualStyle) {
            // ─── 비주얼 스타일 프리뷰 이미지로 직접 참조 ───
            parts.push({ text: `[STYLE REFERENCE IMAGE — TOP PRIORITY]\nThis image shows the EXACT art style you MUST use. Match this style precisely for every scene.` });
            parts.push({ inlineData: { data: stylePreviewBase64, mimeType: 'image/jpeg' } });
            parts.push({ text: `Apply the art style from the reference image above. Additional style description: ${activeVisualStyle.prompt}` });
          } else {
            const geminiStylePrompt = getSelectedGeminiStylePrompt();
            if (geminiStylePrompt) {
              parts.push({ text: `[ART STYLE INSTRUCTION]\nApply this art style: ${geminiStylePrompt}` });
            }
          }
          // 나레이션을 primary anchor로 포함 — visualPrompt가 틀려도 나레이션으로 보정
          const narText = scene.narration
            ? `\n⚑ MANDATORY SCENE CONTENT (this narration MUST be depicted): "${scene.narration.slice(0, 200)}"\nIf the scene prompt conflicts with this narration, the narration takes absolute priority.`
            : '';
          parts.push({ text: `[SCENE PROMPT]\n${sanitizedPrompt}${narText}` });
        }

        // ── 마지막에도 이중 강제 ─────────────────────────────────────────
        parts.push({
          text: [
            `⛔ FINAL OVERRIDE — SINGLE FRAME: ONE image, ONE scene. NO panels. NO splits. NO borders.`,
            hasCharacterRef ? `⛔ FINAL CHARACTER CHECK: The character MUST be the exact same person from the reference. Same hair color, same face, same features. If it looks like a different person = FAILURE.` : '',
            textMode === 'none'    ? `⛔ FINAL OVERRIDE — ZERO TEXT: Absolutely no text, letters, numbers, or signs in the image.` : '',
            textMode === 'numbers' ? `⚠️ FINAL: Only digits (0-9). No letters, no words.` : '',
            textMode === 'english' ? `⚠️ FINAL: Only Latin/English. No Korean, no Chinese, no Japanese.` : '',
            textMode === 'korean'  ? `⚠️ FINAL: Only Korean (한글). No English, no Latin, no Chinese, no Japanese.` : '',
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

        for (const part of (response.candidates?.[0]?.content?.parts || [])) {
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
  // 이미지 편집: image input + image output 지원 모델 순서대로 시도
  // gemini-2.0-flash-exp는 2026년 삭제됨 → 대체 모델 사용
  const editModels = [
    'gemini-3.1-flash-image-preview',
    'gemini-2.5-flash-image',
    'gemini-3-pro-image-preview',
  ];
  let lastError: any;

  // base64에 data: prefix가 있으면 제거
  const rawBase64 = imageBase64.startsWith('data:') ? imageBase64.split(',')[1] : imageBase64;

  for (const editModel of editModels) {
    try {
      const response = await ai.models.generateContent({
        model: editModel,
        contents: {
          parts: [
            { inlineData: { data: rawBase64, mimeType: 'image/jpeg' } },
            {
              text: [
                `You are an image editor. Edit this exact image by applying ONLY the instruction below.`,
                `Keep EVERYTHING ELSE identical — same composition, characters, poses, background, colors, art style, lighting.`,
                `Do NOT redraw or regenerate. Do NOT change anything not mentioned in the instruction.`,
                ``,
                `INSTRUCTION: ${command}`,
                ``,
                `Output: one single edited image. No panels, no split screens, no borders, no before/after comparison.`,
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
      console.warn(`[Image Edit] ${editModel} 응답에 이미지 없음:`, parts.map(p => Object.keys(p)));
    } catch (e) {
      console.warn(`[Image Edit] ${editModel} 실패, 다음 모델 시도:`, e);
      lastError = e;
    }
  }
  // 모든 모델 실패 시 에러 던지기 (호출부에서 사용자에게 표시)
  throw lastError || new Error('이미지 편집 실패: 모든 모델에서 이미지를 반환하지 않았습니다');
};

/**
 * 유튜브 썸네일: 씬 이미지 위에 AI가 직접 제목 텍스트를 합성
 * - editImageWithGemini와 달리 "기존 유지" 제약 없음 → 더 자유로운 텍스트 합성 가능
 */
export const generateThumbnailWithText = async (
  imageBase64: string,
  titleText: string,
  ratio: '16:9' | '9:16' = '16:9'
): Promise<string | null> => {
  const ai = getAI();
  const rawBase64 = imageBase64.startsWith('data:') ? imageBase64.split(',')[1] : imageBase64;
  const models = [
    'gemini-3.1-flash-image-preview',
    'gemini-2.5-flash-image',
    'gemini-3-pro-image-preview',
    'gemini-2.0-flash-exp-image-generation',
  ];
  const orientation = ratio === '9:16' ? 'vertical YouTube Shorts thumbnail' : 'horizontal YouTube thumbnail';
  const prompt = `You are a professional YouTube thumbnail designer.

Take this image and redesign it as a ${orientation} with the following Korean title text prominently displayed:

TITLE: "${titleText}"

Design requirements:
- Place the Korean title text at the TOP of the image with large, bold, white Korean characters
- Add a strong black stroke/outline around each Korean character (at least 8px)
- Add a dark semi-transparent gradient overlay at the top (top 40% of image) so text is clearly readable
- Keep the main subject/character of the original image visible and prominent
- Make the text VERY LARGE — it should be the most visually dominant element
- Use a heavy/black weight Korean font style
- The Korean text must be perfectly legible and correctly rendered
- Professional, eye-catching YouTube thumbnail quality

Output: single edited image with the Korean title text added. No panels, no borders.`;

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: {
          parts: [
            { inlineData: { data: rawBase64, mimeType: 'image/jpeg' } },
            { text: prompt }
          ]
        },
        config: { responseModalities: [Modality.TEXT, Modality.IMAGE] }
      });
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if ((part as any).inlineData?.data) return (part as any).inlineData.data;
      }
      console.warn(`[Thumbnail] ${model} 응답에 이미지 없음`);
    } catch (e) {
      console.warn(`[Thumbnail] ${model} 실패:`, e);
    }
  }
  return null;
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
 * PCM16 base64 끝에 무음 추가 (Gemini TTS 마지막 음절 클리핑 방지)
 * - 24kHz mono Int16 기준
 */
function appendPcmSilence(pcmBase64: string, durationSeconds: number = 0.6): string {
  const silenceBytes = new Uint8Array(Math.round(24000 * durationSeconds) * 2); // zero = silence
  const existing = Uint8Array.from(atob(pcmBase64), c => c.charCodeAt(0));
  const combined = new Uint8Array(existing.length + silenceBytes.length);
  combined.set(existing, 0);
  combined.set(silenceBytes, existing.length);
  let binary = '';
  for (let i = 0; i < combined.length; i += 65536) {
    binary += String.fromCharCode(...combined.subarray(i, i + 65536));
  }
  return btoa(binary);
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
 * TTS 설정을 한 곳에서 읽어 일관성 보장
 */
function getTtsConfig() {
  // 음성 설정은 sessionStorage에서 읽음 (창별 독립)
  const voiceName  = getVoiceSetting(CONFIG.STORAGE_KEYS.GEMINI_TTS_VOICE) || CONFIG.DEFAULT_GEMINI_TTS_VOICE;
  const voiceSpeed = getVoiceSetting(CONFIG.STORAGE_KEYS.VOICE_SPEED) || '1.0';
  const tone       = getVoiceSetting('heaven_google_tts_tone') || '';
  const mood       = getVoiceSetting('heaven_google_tts_mood') || '';

  // 속도 지시를 systemInstruction으로 전달 → 청크 전체에 일관 적용
  const speedInstruction =
    voiceSpeed === '0.7' ? 'Speak slowly and clearly. Maintain consistent pace throughout.' :
    voiceSpeed === '1.3' ? 'Speak quickly and energetically. Maintain consistent pace throughout.' :
                           'Speak at a natural, steady pace. Maintain consistent pace throughout.';

  const systemInstruction = [speedInstruction, tone, mood].filter(Boolean).join(' ');
  return { voiceName, systemInstruction };
}

/**
 * TTS 단일 청크 생성 (내부용) — 모델 폴백 포함
 */
async function generateTtsChunk(text: string): Promise<string> {
  const { voiceName, systemInstruction } = getTtsConfig();
  const models = [
    'gemini-2.5-flash-preview-tts',
    'gemini-2.5-pro-preview-tts',
  ];
  let lastError: any;
  for (const model of models) {
    try {
      // TTS는 429 재시도 금지 — 재시도할수록 일일 한도(100회)를 낭비함
      // maxRetries=1 = 단 1회 시도만
      return await retryGeminiRequest("TTS Generation", async () => {
        const ai = getAI();
        const response = await ai.models.generateContent({
          model,
          contents: { parts: [{ text }] },
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
            systemInstruction,
          }
        });
        const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!data) throw new Error('TTS returned empty audio');
        return data;
      }, 1); // maxRetries=1 → 429 시 즉시 포기 (한도 낭비 방지)
    } catch (e: any) {
      lastError = e;
      const msg = e?.message || JSON.stringify(e);
      const isQuota = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota');
      const isServerError = msg.includes('500') || msg.includes('INTERNAL') || msg.includes('503') || msg.includes('UNAVAILABLE');
      if (isQuota) {
        throw new Error(`Gemini TTS 일일 한도(100회) 초과 — 내일 다시 시도하거나 설정에서 다른 TTS(Azure/Google Cloud)로 전환하세요.`);
      }
      if (isServerError) {
        // 500/503: 구글 서버 일시 장애 — 3초 대기 후 같은 모델 1회 재시도
        console.warn(`[TTS] ${model} 서버 오류 — 3초 후 재시도`);
        await new Promise(r => setTimeout(r, 3000));
        try {
          const ai = getAI();
          const response = await ai.models.generateContent({
            model,
            contents: { parts: [{ text }] },
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
              systemInstruction,
            }
          });
          const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
          if (data) return data;
        } catch (e2: any) {
          lastError = new Error(`[${model}] ${e2?.message || e2}`);
          console.warn(`[TTS] ${model} 재시도도 실패:`, e2?.message);
        }
      }
      lastError = new Error(`[${model}] ${msg}`);
      console.warn(`[TTS] ${model} 실패:`, msg);
    }
  }
  throw lastError ?? new Error('모든 Gemini TTS 모델 실패 — API 키와 모델 접근 권한을 확인하세요');
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
  let usedGCloudFallback = false;
  for (let i = 0; i < chunks.length; i++) {
    if (!chunks[i].trim()) continue;
    onProgress?.(`전체 나레이션 음성 생성 중 (${i + 1}/${chunks.length})`);
    try {
      audioChunks.push(await generateTtsChunk(chunks[i]));
    } catch (e: any) {
      const msg = e?.message || '';
      const isQuota = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota') || msg.includes('한도');
      if (isQuota) {
        const gcloudKey = localStorage.getItem(CONFIG.STORAGE_KEYS.GCLOUD_TTS_API_KEY) || '';
        if (gcloudKey) {
          if (!usedGCloudFallback) {
            console.warn('[TTS Batch] Gemini TTS 할당량 초과 → Google Cloud TTS 자동 폴백');
            usedGCloudFallback = true;
          }
          // 남은 청크 전체를 gcloud로 처리
          for (let j = i; j < chunks.length; j++) {
            if (!chunks[j].trim()) continue;
            onProgress?.(`전체 나레이션 음성 생성 중 (${j + 1}/${chunks.length}) [Cloud TTS]`);
            const b64 = await generateGCloudTTS(chunks[j]).catch(() => null);
            if (b64) audioChunks.push(b64);
            if (j < chunks.length - 1) await wait(100);
          }
          break;
        }
      }
      throw e;
    }
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
  const provider = getVoiceSetting(CONFIG.STORAGE_KEYS.TTS_PROVIDER) || 'google';

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
      } catch (e: any) {
        // gcloud 에러를 사용자가 볼 수 있도록 에러 메시지를 명확히 표시
        const rawMsg = e?.message || String(e);
        // Google API 오류 JSON에서 readable message 추출
        let readable = rawMsg;
        try {
          const jsonMatch = rawMsg.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            readable = parsed?.error?.message || rawMsg;
          }
        } catch {}
        // API 키 제한(CORS/referrer) 여부 안내 메시지 추가
        const isKeyRestriction = readable.includes('referer') || readable.includes('referrer') || readable.includes('API_KEY_HTTP_REFERRER_BLOCKED') || readable.includes('PERMISSION_DENIED');
        const hint = isKeyRestriction
          ? '\n→ Google Cloud Console에서 API 키의 HTTP 레퍼러 제한을 제거하거나 배포 도메인을 추가하세요.'
          : '';
        const displayErr = `[Cloud TTS 오류] ${readable}${hint}`;
        console.warn('[TTS] gcloud 실패:', displayErr, '→ Gemini TTS 폴백 시도');
        // gcloud 에러를 보존해서 최종 에러 시 사용자에게 보여줌
        (globalThis as any).__lastGcloudTtsError__ = displayErr;
        // 아래 Gemini TTS 경로로 fall-through
      }
    }
  }

  // Gemini TTS 경로 — 실패 시 Google Cloud TTS로 자동 폴백
  const tryGeminiTts = async (): Promise<string | null> => {
    const chunks = splitTtsText(text, 1000);
    if (chunks.length === 1) return appendPcmSilence(await generateTtsChunk(chunks[0]));
    console.log(`[TTS] 텍스트 ${text.length}자 → ${chunks.length}개 청크로 분할 생성`);
    const results: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      console.log(`[TTS] 청크 ${i + 1}/${chunks.length}: ${chunks[i].length}자`);
      results.push(await generateTtsChunk(chunks[i]));
    }
    if (results.length === 0) return null;
    const combined = results.length === 1 ? results[0] : concatenatePcmBase64(results);
    return appendPcmSilence(combined);
  };

  const tryGCloudFallback = async (): Promise<string | null> => {
    const apiKey = localStorage.getItem(CONFIG.STORAGE_KEYS.GCLOUD_TTS_API_KEY) || '';
    if (!apiKey) return null;
    console.warn('[TTS] Gemini TTS 할당량 초과 → Google Cloud TTS 자동 폴백');
    const chunks = splitTtsText(text, 4500);
    if (chunks.length === 1) return generateGCloudTTS(chunks[0]);
    const parts: string[] = [];
    for (const chunk of chunks) {
      const b64 = await generateGCloudTTS(chunk);
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
    for (let i = 0; i < merged.length; i += 65536) binary += String.fromCharCode(...merged.subarray(i, i + 65536));
    return btoa(binary);
  };

  try {
    return await tryGeminiTts();
  } catch (e: any) {
    const msg = e?.message || '';
    const isQuota = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota') || msg.includes('한도');
    if (isQuota) {
      const fallback = await tryGCloudFallback().catch(() => null);
      if (fallback) return fallback;
    }
    // gcloud를 선택했는데 gcloud도 실패한 경우 → gcloud 에러를 앞에 붙여서 표시
    const savedGcloudErr = (globalThis as any).__lastGcloudTtsError__;
    if (savedGcloudErr && provider === 'gcloud') {
      (globalThis as any).__lastGcloudTtsError__ = null;
      throw new Error(`${savedGcloudErr}\n\nGemini 폴백도 실패: ${msg}`);
    }
    throw e;
  }
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
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const chunks = JSON.parse(cleanJsonResponse(response.text || ''));

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
7. CRITICAL — Safety filter avoidance:
   - Do NOT include any character names or proper nouns (people's names, place names)
   - Replace suffering/pain/distress expressions with neutral equivalents:
     "slumping" → "sitting quietly", "lowering head" → "bowing head gently", "in a pit" → "in a dark space", "struggling" → "resting", "crying" → "eyes glistening"
   - Describe only visual motion, not emotional suffering
   - Avoid: pit, dungeon, prison, chains, torture, violence, death, blood, fear

## Narration (Korean)
${narration}

## Visual Description
${visualPrompt.slice(0, 300)}

## Output Format
Return ONLY the motion prompt, no explanation. Example:
"Slow gentle zoom in. A figure sits quietly, head bowing gently, subtle breathing motion. Background remains static. Maintain original art style consistency."`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
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

  const prompt = `아래 대본을 분석하여 등장인물(사람 캐릭터)을 모두 추출하세요.

대본:
${script}

각 인물에 대해 대본에서 언급된 나이, 성별, 직업, 외모(머리색/스타일, 눈색, 피부색, 체형), 복장, 성격을 파악하세요. 단서가 없으면 이야기 맥락에서 합리적으로 추론하세요.

반드시 아래 JSON 배열 형식으로만 응답하세요. 마크다운 없이 JSON만:
[{"name":"캐릭터이름","description":"한국어 상세묘사 3문장","imagePrompt":"Photorealistic portrait. Gender: female. Age: 30s. Hair: long black straight hair. Eyes: dark brown. Skin: fair. Build: slender. Wearing: white blouse and dark slacks. Expression: calm and composed. Professional studio portrait, soft lighting, neutral background, high quality."}]

주의: imagePrompt는 영어로, 문장 형식(마침표로 구분)으로 작성. 대괄호나 특수기호 사용 금지.
실제 등장인물이 없으면 빈 배열만 반환: []`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { temperature: 0.3 }
  });

  const raw = response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  console.log('[extractCharacters] raw 길이:', raw.length, '앞부분:', raw.slice(0, 120));

  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      console.log('[extractCharacters] 추출 완료:', parsed.length, '명', parsed.map((c: any) => c.name));
      return parsed as CharacterInfo[];
    }
  } catch (e) {
    console.error('[extractCharacters] JSON 파싱 실패:', e, '\nraw:', raw.slice(0, 400));
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
 * 생성된 씬 이미지 중 썸네일에 가장 적합한 씬 인덱스를 AI가 선택
 */
export const pickBestThumbnailScene = async (
  topic: string,
  scenes: Array<{ narration: string; imageData: string | null }>,
  count: number = 1
): Promise<number[]> => {
  const ai = getAI();
  const imagesWithIdx = scenes
    .map((s, i) => ({ i, imageData: s.imageData, narration: s.narration }))
    .filter(s => s.imageData);
  if (imagesWithIdx.length === 0) return [0];
  const needed = Math.min(count, imagesWithIdx.length);
  if (imagesWithIdx.length <= needed || !ai) {
    return imagesWithIdx.slice(0, needed).map(s => s.i);
  }
  try {
    const parts: any[] = [
      { text: `YouTube 썸네일로 클릭률이 높을 이미지 상위 ${needed}개를 선택하세요. 주제: "${topic}"\n각 이미지 인덱스(0부터)를 쉼표로 구분해 ${needed}개 숫자만 응답하세요. 예: 2,5,8` }
    ];
    imagesWithIdx.forEach(({ i, imageData, narration }) => {
      parts.push({ text: `[씬 ${i}] ${narration}` });
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: imageData! } });
    });
    const res = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: [{ role: 'user', parts }] });
    const text = (res.text || '').trim();
    const parsed = text.split(/[,\s]+/).map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    const valid = parsed.filter(n => imagesWithIdx.some(s => s.i === n));
    if (valid.length >= needed) return valid.slice(0, needed);
    // 부족하면 나머지를 채움
    const fallback = imagesWithIdx.map(s => s.i).filter(i => !valid.includes(i));
    return [...valid, ...fallback].slice(0, needed);
  } catch {
    return imagesWithIdx.slice(0, needed).map(s => s.i);
  }
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

// ── 썸네일 전략 분석 (3가지 방향) ────────────────────────────────────────────
export interface ThumbnailVariantStrategy {
  type: '호기심유발' | '가치제안' | '스토리감정';
  title: string;       // YouTube 제목 (A/B 테스트용)
  mainText: string;    // 썸네일 메인 문구 (10자 이내)
  subText: string;     // 썸네일 서브 문구 (15자 이내)
  imagePrompt: string; // 이미지 생성 프롬프트 (영어)
  description: string; // SEO 설명문 첫 2줄
  tags: string;        // 태그 (쉼표 구분)
}

export const analyzeThumbnailStrategy = async (params: {
  topic: string;
  characterEnabled: boolean;
  characterType: string;
  characterDetails: string;
  targetAudience: string;
}): Promise<ThumbnailVariantStrategy[] | null> => {
  const ai = getAI();
  if (!ai) return null;

  const charDesc = params.characterEnabled
    ? `등장 피사체: ${params.characterType} - ${params.characterDetails}`
    : '피사체 없음 (배경/사물 중심)';

  const prompt = `당신은 유튜브 SEO 및 썸네일 전략 전문가입니다. 다음 영상 정보를 바탕으로 YouTube A/B 테스트용 3가지 전략을 생성하세요.

영상 주제: "${params.topic}"
${charDesc}
시청 타겟: ${params.targetAudience}

3가지 전략 방향:
1. 호기심유발형: 결과가 궁금해서 클릭하게 만드는 미스터리한 접근 (의문형, 반전, 충격)
2. 가치제안형: 시청자가 얻을 수 있는 이득을 명확하게 강조 (구체적 숫자, 방법, 혜택)
3. 스토리감정형: 강렬한 감정적 후기나 서사적 긴장감 활용 (경험, 감정, 공감)

각 전략마다 다음 필드를 생성하세요:
- type: 전략 유형 (호기심유발 / 가치제안 / 스토리감정)
- title: YouTube 제목 30자 이내 한국어
- mainText: 썸네일 메인 문구 8자 이내 한국어
- subText: 썸네일 서브 문구 12자 이내 한국어
- imagePrompt: 썸네일 배경 이미지 생성용 영어 프롬프트 (텍스트 없는 배경, 고대비, YouTube 스타일, 구체적 장면)
- description: SEO 설명문 100자 이내 한국어
- tags: 관련 태그 5개 쉼표 구분 한국어`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'array' as any,
          items: {
            type: 'object' as any,
            properties: {
              type:        { type: 'string' as any },
              title:       { type: 'string' as any },
              mainText:    { type: 'string' as any },
              subText:     { type: 'string' as any },
              imagePrompt: { type: 'string' as any },
              description: { type: 'string' as any },
              tags:        { type: 'string' as any },
            },
            required: ['type', 'title', 'mainText', 'subText', 'imagePrompt', 'description', 'tags'],
          },
        },
      },
    });
    const raw = response.text || '';
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
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
      config: isNanoBanana
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

/**
 * 레퍼런스 영상 프레임을 Gemini로 분석
 * @param frames base64 JPEG 프레임 배열 (6~8장 권장)
 * @returns 분석 텍스트 (스타일, 구조, 색감, 톤 등)
 */
export const analyzeReferenceVideo = async (frames: string[]): Promise<string> => {
  const ai = getAI();
  const imageParts = frames.map(b64 => ({
    inlineData: { mimeType: 'image/jpeg', data: b64 }
  }));

  const prompt = `이 영상의 프레임들을 분석하여 아래 항목을 한국어로 간결하게 설명하라:

1. **전체 스타일/분위기**: (예: 다큐멘터리풍, 코믹, 드라마틱, 감성적 등)
2. **씬 구성 패턴**: 씬당 평균 길이, 컷 전환 빈도, 도입/전개/결말 구조
3. **시각적 특징**: 색감 팔레트, 조명 스타일, 카메라 앵글
4. **나레이션/자막 스타일**: 말투(반말/존댓말), 속도감, 문장 길이
5. **콘텐츠 특징**: 주요 주제, 타깃 시청자, 핵심 후킹 요소

분석 결과만 출력하라. 불필요한 서두/맺음말 없이 항목별로 출력.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts: [...imageParts, { text: prompt }] }],
  });

  return response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '분석 결과 없음';
};

/**
 * YouTube 레퍼런스 채널을 분석하여 스타일 컨텍스트 반환
 * YouTube API 키가 있으면 실제 영상 데이터 사용, 없으면 Gemini 지식 기반 분석
 */
export const analyzeReferenceChannel = async (channelUrl: string): Promise<string> => {
  const ai = getAI();
  if (!ai) throw new Error('Gemini API 키가 없습니다. 설정에서 입력해주세요.');

  const ytApiKey = localStorage.getItem('heaven_youtube_key') || '';
  const BASE = 'https://www.googleapis.com/youtube/v3';

  if (ytApiKey) {
    try {
      // 채널 ID 해석
      const resolveChannelId = async (input: string): Promise<string | null> => {
        const raw = input.trim().replace(/\/$/, '');
        if (raw.startsWith('UC') && raw.length > 20) return raw;
        const channelMatch = raw.match(/\/channel\/(UC[\w\-]+)/);
        if (channelMatch) return channelMatch[1];
        const videoMatch = raw.match(/(?:v=|youtu\.be\/)([\w\-]{11})/);
        if (videoMatch) {
          const qs = new URLSearchParams({ part: 'snippet', id: videoMatch[1], key: ytApiKey });
          const res = await fetch(`${BASE}/videos?${qs}`);
          const data = await res.json();
          return data.items?.[0]?.snippet?.channelId || null;
        }
        const handleMatch = raw.match(/(?:youtube\.com\/)?@([\w\-\.]+)/);
        if (handleMatch) {
          const handle = handleMatch[1];
          const qs1 = new URLSearchParams({ part: 'id', forHandle: `@${handle}`, key: ytApiKey });
          const res1 = await fetch(`${BASE}/channels?${qs1}`);
          const data1 = await res1.json();
          if (data1.items?.[0]?.id) return data1.items[0].id;
          const qs2 = new URLSearchParams({ part: 'snippet', q: handle, type: 'channel', maxResults: '3', key: ytApiKey });
          const res2 = await fetch(`${BASE}/search?${qs2}`);
          const data2 = await res2.json();
          const found = data2.items?.find((it: any) =>
            it.snippet?.customUrl?.replace('@','').toLowerCase() === handle.toLowerCase()
          );
          return found?.snippet?.channelId || data2.items?.[0]?.snippet?.channelId || null;
        }
        const legacyMatch = raw.match(/youtube\.com\/(?:c|user)\/([^\/\?&]+)/);
        if (legacyMatch) {
          const qs = new URLSearchParams({ part: 'id', forUsername: legacyMatch[1], key: ytApiKey });
          const res = await fetch(`${BASE}/channels?${qs}`);
          const data = await res.json();
          return data.items?.[0]?.id || null;
        }
        return null;
      };

      const channelId = await resolveChannelId(channelUrl);
      if (channelId) {
        // 채널 기본 정보
        const chQs = new URLSearchParams({ part: 'snippet,statistics', id: channelId, key: ytApiKey });
        const chRes = await fetch(`${BASE}/channels?${chQs}`);
        const chData = await chRes.json();
        const ch = chData.items?.[0];

        // 최근 영상 20개
        const searchQs = new URLSearchParams({ part: 'snippet', channelId, order: 'date', type: 'video', maxResults: '20', key: ytApiKey });
        const searchRes = await fetch(`${BASE}/search?${searchQs}`);
        const searchData = await searchRes.json();
        const videos = searchData.items || [];

        const channelName = ch?.snippet?.title || channelUrl;
        const channelDesc = ch?.snippet?.description?.slice(0, 300) || '';
        const subCount = ch?.statistics?.subscriberCount ? `구독자 ${Number(ch.statistics.subscriberCount).toLocaleString()}명` : '';
        const titles = videos.slice(0, 20).map((v: any, i: number) => `${i+1}. ${v.snippet?.title}`).join('\n');

        const channelDataContext = `채널명: ${channelName}\n${subCount}\n채널 설명: ${channelDesc}\n\n최근 영상 제목:\n${titles}`;
        const prompt = `다음 YouTube 채널 데이터를 분석하여 아래 항목을 한국어로 간결하게 설명하라:

${channelDataContext}

1. **전체 스타일/분위기**: (예: 다큐멘터리풍, 코믹, 드라마틱, 감성적 등)
2. **씬 구성 패턴**: 주로 쓰는 영상 구조, 도입/전개/결말 패턴
3. **시각적 특징**: 썸네일 색감, 편집 느낌
4. **나레이션/자막 스타일**: 말투(반말/존댓말), 속도감, 문장 길이, 특유의 표현
5. **콘텐츠 특징**: 주요 주제, 타깃 시청자, 핵심 후킹 요소
6. **등장 캐릭터**: 채널에 등장하는 주요 캐릭터/인물 특징 (있다면)

분석 결과만 출력하라. 불필요한 서두/맺음말 없이 항목별로 출력.`;

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        });
        return response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '분석 결과 없음';
      }
    } catch (e) {
      console.warn('[ChannelAnalysis] YouTube API 분석 실패, Gemini 지식 기반으로 폴백:', e);
    }
  }

  // YouTube API 없거나 실패 시 → Gemini 학습 지식 기반 분석
  const fallbackResponse = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts: [{ text: `YouTube 채널 "${channelUrl}"에 대해 알고 있다면 아래 항목을 한국어로 분석하라. 채널을 모르면 URL이나 채널명으로 유추 가능한 스타일을 추정하라:

1. **전체 스타일/분위기**
2. **씬 구성 패턴**
3. **시각적 특징**
4. **나레이션/자막 스타일**
5. **콘텐츠 특징**
6. **등장 캐릭터**

분석 결과만 출력.` }] }],
  });
  return fallbackResponse.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '분석 결과 없음';
};

// ─────────────────────────────────────────────
// 순수 영상 스튜디오: 씬 플래닝 (이미지/영상 프롬프트)
// ─────────────────────────────────────────────
export interface PureVideoScene {
  sceneNumber: number;
  description: string;       // 씬 설명 (한국어)
  imagePrompt: string;       // 나노바나나2 이미지 생성용 영어 프롬프트
  motionPrompt: string;      // Veo 모션 프롬프트 (영어)
}

export async function generatePureVideoScenes(
  topic: string,
  sceneCount: number,
  aspectRatio: '16:9' | '9:16',
  styleDescription?: string,   // 화풍 참조 설명
  characterDescription?: string // 캐릭터 설명
): Promise<PureVideoScene[]> {
  const ai = getAI();
  const arNote = aspectRatio === '9:16' ? 'vertical 9:16 short-form' : 'horizontal 16:9';
  const charNote = characterDescription ? `Main character: ${characterDescription}.` : '';
  const styleNote = styleDescription ? `Visual style reference: ${styleDescription}.` : 'Style: 3D animation, cute, vibrant colors.';

  const prompt = `You are a creative director for a pure animation video (NO narration, NO text overlay, NO voiceover).
Topic: "${topic}"
${charNote}
${styleNote}
Format: ${arNote}
Number of scenes: ${sceneCount}

Generate ${sceneCount} scenes for a short, engaging animation. Each scene should flow naturally into the next.

Return a JSON array with exactly ${sceneCount} objects:
[
  {
    "sceneNumber": 1,
    "description": "씬 설명 (한국어로, 무슨 일이 일어나는지)",
    "imagePrompt": "Detailed English prompt for image generation. Include: character description, environment, lighting, style (3D render, cinematic, etc.), NO text, NO watermarks, photorealistic 3D animation style",
    "motionPrompt": "English motion prompt for Veo video generation. Describe camera movement, character action, atmosphere. Example: 'slow zoom in, character walks forward, warm sunset lighting, smooth animation'"
  }
]

Rules:
- imagePrompt: detailed, visual, English only, describe the STARTING FRAME
- motionPrompt: describe the MOTION from start to end, camera movement, English only, max 2 sentences
- No narration or dialogue in any prompt
- Make scenes visually dynamic and interesting`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { responseMimeType: 'application/json' },
  });

  const raw = response.text || '';
  const scenes: PureVideoScene[] = JSON.parse(cleanJsonResponse(raw));
  return scenes;
}

/**
 * 녹음 오디오 파일을 전사하여 씬별 타임스탬프 매핑 반환
 */
export const transcribeAudioForScenes = async (
  audioBase64: string,
  mimeType: string,
  narrations: string[]
): Promise<{ startSec: number; endSec: number }[]> => {
  const ai = getAI();

  const prompt = `오디오에서 각 씬 나레이션의 발화 구간을 찾아 정확한 시작/끝 시간을 반환하라.

씬 나레이션 목록 (순서대로):
${narrations.map((n, i) => `[${i}] ${n}`).join('\n')}

출력 형식 (JSON 배열만):
[{"sceneIndex":0,"startSec":0.00,"endSec":3.50},...]

규칙:
- startSec: 첫 음절이 시작되는 정확한 시점 (숨소리/노이즈 제외)
- endSec: 마지막 음절 발음이 완전히 끝나는 시점 (잔향 포함, 너무 일찍 자르지 말 것)
- 소수점 2자리 (예: 3.45)
- 씬 순서는 목록 순서와 동일
- 매칭 실패 씬은 startSec/endSec 모두 -1
- JSON 배열만 출력`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: {
      parts: [
        { text: prompt },
        { inlineData: { data: audioBase64, mimeType } }
      ]
    }
  });

  const rawText = response.text || '[]';
  const cleaned = cleanJsonResponse(rawText);
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error('전사 결과 파싱 실패');

  const result: { startSec: number; endSec: number }[] = narrations.map(() => ({ startSec: -1, endSec: -1 }));
  for (const item of parsed) {
    if (typeof item.sceneIndex === 'number' && item.sceneIndex >= 0 && item.sceneIndex < narrations.length) {
      result[item.sceneIndex] = { startSec: item.startSec ?? -1, endSec: item.endSec ?? -1 };
    }
  }
  return result;
};

// ──────────────────────────────────────────────────────────────────────────────
// 오디오-퍼스트: 전체 오디오 → 씬 분리 + 타임스탬프 + 자막 청크
// ──────────────────────────────────────────────────────────────────────────────

export interface AudioFirstScene {
  narration: string;     // 전사 텍스트
  description: string;  // 이미지 생성용 한국어 시각 묘사
  startSec: number;     // 전체 오디오에서 씬 시작 (소수점 2자리)
  endSec: number;       // 전체 오디오에서 씬 종료 (소수점 2자리)
  subtitleChunks: { text: string; startSec: number; endSec: number }[];
}

/**
 * 오디오-퍼스트: 전체 오디오 파일을 AI가 분석 → 씬 자동 분리 + 자막 청크 생성
 * 오디오를 분리하지 않고 전체를 하나의 트랙으로 사용 → 오디오 끊김 완전 방지
 */
// ── 챗봇 명령 처리 ─────────────────────────────────────────────────────────
export interface ChatOperation {
  type: 'SET_ZOOM' | 'SET_SUBTITLE_CHARS' | 'GENERATE_VIDEO' | 'NONE';
  sceneRange?: [number, number];
  zoom?: { type: string; origin: string; intensity: number };
  maxChars?: number;
}
export interface ChatCommandResult {
  operations: ChatOperation[];
  reply: string;
}

export const processChatCommand = async (
  command: string,
  sceneCount: number
): Promise<ChatCommandResult> => {
  const ai = getAI();
  const prompt = `당신은 영상 편집 AI 어시스턴트입니다. 사용자 명령을 분석하고 JSON만 반환하세요.

씬 정보: 총 ${sceneCount}개 씬 (씬 번호 1~${sceneCount}, 인덱스 0~${sceneCount - 1})

사용자 명령: "${command}"

지원 조작:
- SET_ZOOM: 씬 범위에 줌/패닝 효과 설정
- SET_SUBTITLE_CHARS: 자막 최대 글자 수 변경 (전체 적용)
- GENERATE_VIDEO: 씬 범위에 영상 생성 요청
- NONE: 조작 없음

응답 JSON 형식:
{
  "operations": [
    {
      "type": "SET_ZOOM",
      "sceneRange": [0, 4],
      "zoom": { "type": "zoom-in", "origin": "center", "intensity": 30 }
    }
  ],
  "reply": "사용자에게 보낼 응답"
}

규칙:
- sceneRange: [시작인덱스, 끝인덱스] 0-based 포함, 전체=[-1,-1]
- "1~5씬" → [0,4], "전체" → [-1,-1], "3씬" → [2,2]
- zoom.type: "zoom-in" | "zoom-out" | "pan-right" | "pan-left" | "none"
- zoom.origin: "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right"
- zoom.intensity: 1~100
- JSON 배열만 출력, 마크다운 없이`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt
    });
    const raw = response.text || '{}';
    const cleaned = cleanJsonResponse(raw);
    const parsed = JSON.parse(cleaned) as ChatCommandResult;
    // sceneRange [-1,-1] → 전체
    parsed.operations = (parsed.operations || []).map(op => {
      if (op.sceneRange && op.sceneRange[0] === -1) op.sceneRange = [0, sceneCount - 1];
      return op;
    });
    return parsed;
  } catch {
    return { operations: [], reply: '명령을 이해하지 못했어요. 다시 시도해주세요.' };
  }
};

// 대본 텍스트를 maxChars 단위로 자막 청크 분리 (Gemini 없이)

/**
 * 나레이션 텍스트와 씬 길이로 자막 청크를 로컬 생성 (글자 수 비례 분배)
 */
function makeSubtitleChunksLocal(
  text: string,
  durationSec: number,
  maxChars: number = 15
): { text: string; startSec: number; endSec: number }[] {
  if (!text.trim() || durationSec <= 0) return [];
  const breakChars = ['.', '!', '?', '。', '，', ',', ' ', '~'];
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 0) {
    if (remaining.length <= maxChars) { chunks.push(remaining); break; }
    let cutAt = maxChars;
    for (let i = Math.min(maxChars, remaining.length - 1); i >= Math.floor(maxChars * 0.5); i--) {
      if (breakChars.includes(remaining[i])) { cutAt = i + 1; break; }
    }
    const chunk = remaining.slice(0, cutAt).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(cutAt).trim();
  }
  if (chunks.length === 0) return [];
  const totalChars = chunks.reduce((s, c) => s + c.length, 0);
  const result: { text: string; startSec: number; endSec: number }[] = [];
  let t = 0;
  for (let i = 0; i < chunks.length; i++) {
    const dur = (chunks[i].length / totalChars) * durationSec;
    const end = i === chunks.length - 1 ? durationSec : t + dur;
    result.push({ text: chunks[i], startSec: t, endSec: end });
    t = end;
  }
  return result;
}

export const transcribeAudioToScenes = async (
  audioBase64: string,
  mimeType: string,
  onProgress?: (msg: string) => void,
  targetSceneCount: number = 0,
  scriptText?: string,
  characterDescription?: string
): Promise<AudioFirstScene[]> => {
  const ai = getAI();
  onProgress?.('Gemini 2.5 Flash로 오디오 분석 중...');

  const sceneCountInstruction = targetSceneCount > 0
    ? `⚠️ 씬 수 고정: 반드시 정확히 ${targetSceneCount}개 씬. 더 많거나 적으면 절대 안 됩니다.`
    : '내용을 의미 단위로 씬 분리 (자연스러운 문장/주제 전환 기준, 보통 20~45초 단위)';

  const charLock = characterDescription
    ? `- ⚠️ CHARACTER LOCK: ALL characters in EVERY scene MUST be "${characterDescription}". NEVER substitute humans, other animals, or other species. If scene has characters, they are ALWAYS "${characterDescription}".`
    : `- ⚠️ CHARACTER CONSISTENCY: 레퍼런스의 캐릭터 종·유형 100% 유지. 절대 인간·다른 동물로 대체 금지`;

  const commonRules = `
- narration: 큰따옴표와 역슬래시 절대 사용 금지. 줄바꿈 금지
- description: 영어. 큰따옴표와 역슬래시 절대 사용 금지
${charLock}
- startSec/endSec: 초 단위 소수점 수만 허용. MM.SS 또는 MM:SS 형식 절대 금지 (예: 1분30초=90.00)
- subtitleChunks: 각 청크 15자 이하, 자연스러운 의미 단위
- JSON 배열만 출력 (마크다운 코드 블록 없이)${targetSceneCount > 0 ? `\n- 씬 수: 반드시 ${targetSceneCount}개 (초과/미달 절대 금지)` : ''}`;

  const distributionRules = `
## 씬 균등 분배 규칙 (반드시 준수)
- 오디오 전체 길이를 씬 수로 균등하게 분배할 것
- 가장 짧은 씬과 가장 긴 씬의 길이 차이가 2배를 넘지 말 것
- 씬 경계는 자연스러운 문장 끝 또는 의미 전환점에서 설정
- 10분 이상 오디오: 각 씬 최소 20초 이상 확보`;

  const charHint = characterDescription ? ` Character type: ${characterDescription}.` : '';
  const descriptionRule = `description: CRITICAL - English visual prompt that DIRECTLY illustrates the narration content. Read narration → identify the topic AND the emotional tone → describe: subject+action+relevant props+setting+camera angle+character expression. Must match narration topic AND emotion exactly — if narration is sad/painful, character must look distressed/worried (NOT smiling). If narration is joyful, character looks happy. NEVER use generic happy expressions for negative narrations.${charHint} No color/lighting/art-style. No quotes or backslashes.`;

  // 대본 제공 시: subtitleChunks 불필요 (splitScriptToSubtitleChunks로 생성) → JSON 크기 최소화
  // ✱ subtitleChunks를 AI에 요청하지 않음 → JSON 크기 ~70% 감소 → 토큰 한도 초과 방지
  // subtitleChunks는 로컬에서 글자 수 비례 분배로 생성 (정확도보다 안정성 우선)
  const prompt = scriptText?.trim()
    ? `당신은 오디오-대본 타임스탬프 정렬 전문가입니다.
제공된 대본과 오디오를 분석하여 대본 각 부분에 정확한 타임스탬프를 매핑하세요.

## 제공된 대본
${scriptText.trim()}

## 작업
1. 오디오를 들으며 대본의 각 단락/문장이 시작되는 정확한 시간 파악
2. ${sceneCountInstruction}
3. narration은 대본에서 그대로 가져올 것 (전사·재작성 금지)
${distributionRules}

## 출력 형식 (JSON 배열만 — subtitleChunks 필드 없음)
[{"narration":"대본 텍스트","description":"visual description","startSec":0.00,"endSec":15.50}]

## 규칙
- ${descriptionRule}
- narration: 큰따옴표와 역슬래시 절대 사용 금지. 줄바꿈 금지
- description: 영어. 큰따옴표와 역슬래시 절대 사용 금지
${charLock}
- startSec/endSec: 초 단위 소수점 수만 허용 (예: 1분30초=90.00)
${targetSceneCount > 0 ? `- 씬 수: 반드시 ${targetSceneCount}개` : ''}`
    : `당신은 오디오 콘텐츠 분석 전문가입니다. 주어진 오디오를 분석하여 JSON으로 씬을 분리하세요.

## 작업
1. 오디오 전체를 정확히 전사(transcription)
2. ${sceneCountInstruction}
3. 각 씬에 대해 JSON 출력
${distributionRules}

## 출력 형식 (JSON 배열만 — subtitleChunks 필드 없음)
[{"narration":"전사 텍스트","description":"visual description","startSec":0.00,"endSec":15.50}]

## 규칙
- narration: 발화된 내용을 그대로 전사. ${commonRules.trimStart()}`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: {
      parts: [
        { text: prompt },
        { inlineData: { data: audioBase64, mimeType } }
      ]
    },
    config: {
      responseMimeType: 'application/json',
      maxOutputTokens: 65536,         // 최대 허용치 (오디오+씬 많아도 잘리지 않도록)
      thinkingConfig: { thinkingBudget: 0 }, // 오디오 전사는 thinking 불필요 → 출력 토큰 절약
    },
  });

  const rawText = response.text || '[]';
  // Gemini가 1분 이상 오디오에서 타임스탬프를 MM.SS.cc 또는 MM:SS.cc 형식으로 출력하는 버그 수정
  // 예: "startSec": 1.00.80 → 60.80 / "startSec": 1:00.30 → 60.30
  const fixedText = rawText.replace(
    /"(startSec|endSec)"\s*:\s*(\d+)[.:](\d{2})\.(\d+)/g,
    (_m: string, key: string, min: string, sec: string, frac: string) => {
      const total = parseInt(min, 10) * 60 + parseInt(sec, 10) + parseFloat('0.' + frac);
      return `"${key}": ${total.toFixed(2)}`;
    }
  );
  const cleaned = cleanJsonResponse(fixedText);

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e: any) {
    const errPos = parseInt((e.message.match(/position (\d+)/) || [])[1] ?? '0', 10);
    const ctx = cleaned.slice(Math.max(0, errPos - 80), errPos + 80);
    console.error('[transcribeAudioToScenes] JSON 파싱 실패:', e.message);
    console.error('[오류 위치 전후 160자]', JSON.stringify(ctx));
    throw new Error(`오디오 전사 JSON 파싱 실패: ${e.message}`);
  }

  if (!Array.isArray(parsed)) throw new Error('오디오 전사 결과 파싱 실패');

  let scenes: AudioFirstScene[] = parsed.map((item: any) => {
    const nar = String(item.narration || '');
    const start = Number(item.startSec ?? 0);
    const end = Number(item.endSec ?? 0);
    const dur = Math.max(0.1, end - start);
    const subtitleChunks = makeSubtitleChunksLocal(nar, dur);
    return { narration: nar, description: String(item.description || ''), startSec: start, endSec: end, subtitleChunks };
  });

  // ── 씬 수 강제 고정 (AI가 요청 수를 초과/미달 시 병합/분할) ──
  if (targetSceneCount > 0 && scenes.length !== targetSceneCount) {
    console.warn(`[transcribeAudioToScenes] 씬 수 불일치 (AI: ${scenes.length}개, 요청: ${targetSceneCount}개) → 강제 조정`);
    if (scenes.length > targetSceneCount) {
      // 병합: 타임스탬프 연속성 유지 (첫 씬 startSec, 마지막 씬 endSec)
      const merged: AudioFirstScene[] = [];
      const ratio = scenes.length / targetSceneCount;
      for (let i = 0; i < targetSceneCount; i++) {
        const start = Math.round(i * ratio);
        const end = Math.round((i + 1) * ratio);
        const group = scenes.slice(start, end);
        const narration = group.map(s => s.narration).filter(Boolean).join(' ');
        const startSec = group[0]?.startSec ?? 0;
        const endSec = group[group.length - 1]?.endSec ?? 0;
        const dur = Math.max(0.1, endSec - startSec);
        merged.push({
          narration,
          description: group[0]?.description || '',
          startSec,
          endSec,
          subtitleChunks: makeSubtitleChunksLocal(narration, dur),
        });
      }
      scenes = merged;
    } else {
      // 분할: 가장 긴 씬을 반복 분할 (타임스탬프 절반 씩)
      while (scenes.length < targetSceneCount) {
        let maxDur = 0, maxIdx = 0;
        for (let i = 0; i < scenes.length; i++) {
          const d = scenes[i].endSec - scenes[i].startSec;
          if (d > maxDur) { maxDur = d; maxIdx = i; }
        }
        if (maxDur < 1) break;
        const s = scenes[maxIdx];
        const midSec = (s.startSec + s.endSec) / 2;
        const narLen = s.narration.length;
        const splitChar = Math.floor(narLen / 2);
        const n1 = s.narration.slice(0, splitChar).trim() || s.narration;
        const n2 = s.narration.slice(splitChar).trim() || s.narration;
        scenes.splice(maxIdx, 1,
          { ...s, narration: n1, endSec: midSec, subtitleChunks: makeSubtitleChunksLocal(n1, midSec - s.startSec) },
          { ...s, narration: n2, startSec: midSec, subtitleChunks: makeSubtitleChunksLocal(n2, s.endSec - midSec) }
        );
      }
    }
    console.log(`[transcribeAudioToScenes] 씬 수 조정 완료: ${scenes.length}개`);
  }

  return scenes;
};
