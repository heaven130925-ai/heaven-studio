import { ScriptScene } from '../types';
import { SYSTEM_INSTRUCTIONS, getTrendSearchPrompt, getScriptGenerationPrompt, getFinalVisualPrompt, getScriptReviewPrompt, getTitleSuggestionPrompt } from './prompts';
import { CONFIG, GEMINI_STYLE_CATEGORIES, GeminiStyleId, VISUAL_STYLES } from '../config';
import { getAI, wait, cleanJsonResponse, cleanNarration, retryGeminiRequest, GEMINI_MODELS } from './geminiCore';

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
    model: GEMINI_MODELS.TEXT,
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
      model: GEMINI_MODELS.TEXT,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTIONS.TREND_RESEARCHER,
        responseMimeType: "application/json",
        temperature: 1.5,
        topP: 0.95,
        topK: 64,
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
      model: GEMINI_MODELS.TEXT,
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
        model: GEMINI_MODELS.TEXT,
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
            model: GEMINI_MODELS.TEXT, contents: retryPrompt,
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
      model: GEMINI_MODELS.TEXT,
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
        model: GEMINI_MODELS.TEXT,
        contents: prompt,
        config: { responseMimeType: 'application/json', maxOutputTokens: Math.min(16000, chunk.length * 200) },
      });
      responseText = response.text || '[]';
    }
  } else {
    const response = await ai.models.generateContent({
      model: GEMINI_MODELS.TEXT,
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
      model: GEMINI_MODELS.TEXT,
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
      model: GEMINI_MODELS.TEXT,
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