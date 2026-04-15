// ── YouTube Data API v3 서비스 ───────────────────────────────────────────────
// OAuth 2.0 PKCE — 현재 탭 리다이렉트 방식 (팝업 COOP 문제 회피)
//
// localStorage 키:
//   heaven_youtube_client_id      — Google Cloud OAuth 2.0 클라이언트 ID
//   heaven_youtube_profiles       — ChannelProfile[] JSON
//   heaven_yt_pkce_verifier       — PKCE verifier (인증 중 임시 저장)

const YOUTUBE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const YOUTUBE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YOUTUBE_UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
].join(' ');

// ── 타입 정의 ─────────────────────────────────────────────────────────────────
export interface ChannelUploadSettings {
  hashtags: string;
  descriptionTemplate: string;
  category: string;
  scheduleTime: string;
  defaultPrivacy: 'public' | 'unlisted' | 'scheduled';
}

export interface ChannelProfile {
  id: string;
  name: string;
  thumbnail: string;
  accessToken: string;
  tokenExpiry: number;
  settings: ChannelUploadSettings;
}

export const DEFAULT_CHANNEL_SETTINGS: ChannelUploadSettings = {
  hashtags: '#Shorts #AI영상',
  descriptionTemplate: '{title}\n\n#Shorts',
  category: '22',
  scheduleTime: '09:00',
  defaultPrivacy: 'public',
};

// ── 프로필 저장소 ─────────────────────────────────────────────────────────────
const PROFILES_KEY = 'heaven_youtube_profiles';

export const getChannelProfiles = (): ChannelProfile[] => {
  try { return JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]'); }
  catch { return []; }
};

export const saveChannelProfiles = (profiles: ChannelProfile[]) => {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
};

export const upsertChannelProfile = (profile: ChannelProfile) => {
  const profiles = getChannelProfiles();
  const idx = profiles.findIndex(p => p.id === profile.id);
  if (idx >= 0) profiles[idx] = profile;
  else profiles.push(profile);
  saveChannelProfiles(profiles);
};

export const removeChannelProfile = (channelId: string) => {
  saveChannelProfiles(getChannelProfiles().filter(p => p.id !== channelId));
};

export const updateChannelSettings = (channelId: string, settings: Partial<ChannelUploadSettings>) => {
  const profiles = getChannelProfiles();
  const p = profiles.find(p => p.id === channelId);
  if (p) { p.settings = { ...p.settings, ...settings }; saveChannelProfiles(profiles); }
};

export const isProfileValid = (p: ChannelProfile): boolean =>
  !!p.accessToken && Date.now() < p.tokenExpiry - 60_000;

// ── 공통 설정 ─────────────────────────────────────────────────────────────────
export const getYoutubeClientId = (): string =>
  localStorage.getItem('heaven_youtube_client_id') || '';

export const getYoutubeClientSecret = (): string =>
  localStorage.getItem('heaven_youtube_client_secret') || '';

export const isYoutubeConnected = (): boolean =>
  getChannelProfiles().some(isProfileValid);

export const disconnectYoutube = () => saveChannelProfiles([]);

// ── PKCE 유틸 ─────────────────────────────────────────────────────────────────
function generateCodeVerifier(): string {
  const arr = new Uint8Array(64);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── 리다이렉트 방식 OAuth 시작 ────────────────────────────────────────────────
// 현재 탭을 Google 인증 페이지로 이동시킵니다.
// 인증 완료 후 Google이 redirectUri로 돌려보냅니다.
export const startYoutubeOAuth = async (clientId: string) => {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  // verifier를 localStorage에 저장 (리다이렉트 후 꺼내 쓰기 위해)
  localStorage.setItem('heaven_yt_pkce_verifier', verifier);
  localStorage.setItem('heaven_yt_oauth_return', window.location.href);

  const redirectUri = `${window.location.origin}/`;
  const params = new URLSearchParams({
    client_id:             clientId,
    redirect_uri:          redirectUri,
    response_type:         'code',
    scope:                 SCOPES,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
    access_type:           'online',
    prompt:                'select_account consent',
  });

  window.location.href = `${YOUTUBE_AUTH_URL}?${params}`;
};

// ── 리다이렉트 후 코드 처리 ───────────────────────────────────────────────────
// URL에 ?code= 파라미터가 있으면 토큰 교환 → 채널 프로필 저장
export const handleYoutubeOAuthCallback = async (): Promise<ChannelProfile | null> => {
  const params = new URLSearchParams(window.location.search);
  const code  = params.get('code');
  const error = params.get('error');

  if (!code) return null;

  // URL에서 code 제거 (뒤로가기 등으로 재처리 방지)
  const cleanUrl = window.location.origin + window.location.pathname;
  window.history.replaceState({}, document.title, cleanUrl);

  if (error) { alert(`YouTube 인증 실패: ${error}`); return null; }

  const verifier     = localStorage.getItem('heaven_yt_pkce_verifier') || '';
  const clientId     = localStorage.getItem('heaven_youtube_client_id') || '';
  const clientSecret = localStorage.getItem('heaven_youtube_client_secret') || '';
  const redirectUri  = `${window.location.origin}/`;
  localStorage.removeItem('heaven_yt_pkce_verifier');

  if (!verifier || !clientId) {
    alert('인증 정보가 손실됐습니다. 다시 시도해주세요.');
    return null;
  }

  if (!clientSecret) {
    alert('YouTube OAuth Client Secret이 없습니다. API 키 설정에서 Client Secret을 입력해주세요.');
    return null;
  }

  try {
    // 1. 코드 → 액세스 토큰
    const tokenParams: Record<string, string> = {
      client_id: clientId, redirect_uri: redirectUri,
      code, code_verifier: verifier, grant_type: 'authorization_code',
      client_secret: clientSecret,
    };
    const res = await fetch(YOUTUBE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(tokenParams),
    });
    const tokenJson = await res.json();
    if (!tokenJson.access_token) {
      alert(`토큰 교환 실패: ${tokenJson.error_description || tokenJson.error || JSON.stringify(tokenJson)}`);
      return null;
    }

    const accessToken = tokenJson.access_token;
    const tokenExpiry = Date.now() + (tokenJson.expires_in || 3600) * 1000;

    // 2. 채널 정보
    const chRes = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const chJson = await chRes.json();
    if (!chRes.ok) {
      alert(`채널 조회 실패: ${chJson.error?.message || `HTTP ${chRes.status}`}`);
      return null;
    }

    const items: any[] = chJson.items || [];
    const ch = items[0];
    const profile: ChannelProfile = ch ? {
      id:        ch.id,
      name:      ch.snippet?.title || ch.id,
      thumbnail: ch.snippet?.thumbnails?.default?.url || '',
      accessToken, tokenExpiry,
      settings:  { ...DEFAULT_CHANNEL_SETTINGS },
    } : {
      id: `account_${Date.now()}`, name: '내 채널',
      thumbnail: '', accessToken, tokenExpiry,
      settings: { ...DEFAULT_CHANNEL_SETTINGS },
    };

    upsertChannelProfile(profile);
    return profile;
  } catch (err: any) {
    alert(`채널 연결 오류: ${err?.message || String(err)}`);
    return null;
  }
};

// 구버전 호환
export const connectYoutube = async (_clientId: string): Promise<boolean> => false;
export const connectYoutubeChannel = async (_clientId: string): Promise<ChannelProfile | null> => null;

// ── 채널 목록 ─────────────────────────────────────────────────────────────────
export interface YouTubeChannel { id: string; title: string; thumbnail: string; }

export const fetchMyChannels = async (): Promise<YouTubeChannel[]> =>
  getChannelProfiles().map(p => ({ id: p.id, title: p.name, thumbnail: p.thumbnail }));

// ── 메타데이터 자동 생성 ──────────────────────────────────────────────────────
export interface UploadMeta { title: string; description: string; tags: string[]; }

export const buildUploadMeta = (topic: string, settings: ChannelUploadSettings): UploadMeta => {
  const hashtagsInline = settings.hashtags.split(/\s+/).filter(h => h.startsWith('#')).slice(0, 3).join(' ');
  const title = `${topic} ${hashtagsInline}`.trim().slice(0, 100);
  const description = settings.descriptionTemplate.replace('{title}', topic);
  const topicWords = topic.split(/[\s,]+/).filter(w => w.length > 1);
  const hashtagWords = settings.hashtags.split(/\s+/).map(h => h.replace(/^#/, '')).filter(Boolean);
  const tags = [...new Set([...topicWords, ...hashtagWords, 'Shorts', 'AI영상'])].slice(0, 15);
  return { title, description, tags };
};

// ── 예약 시간 ─────────────────────────────────────────────────────────────────
export const buildPublishAt = (scheduleTime: string, offsetDays = 0): string => {
  const [hh, mm] = scheduleTime.split(':').map(Number);
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hh, mm, 0, 0);
  if (d <= new Date()) d.setDate(d.getDate() + 1);
  return d.toISOString();
};

// ── YouTube 카테고리 목록 ─────────────────────────────────────────────────────
export const YOUTUBE_CATEGORIES: { id: string; label: string }[] = [
  { id: '22', label: '사람 및 블로그' },
  { id: '24', label: '엔터테인먼트' },
  { id: '25', label: '뉴스 & 정치' },
  { id: '26', label: '노하우 & 스타일' },
  { id: '27', label: '교육' },
  { id: '28', label: '과학 & 기술' },
  { id: '17', label: '스포츠' },
  { id: '10', label: '음악' },
  { id: '23', label: '코미디' },
  { id: '19', label: '여행 & 이벤트' },
  { id: '20', label: '게임' },
  { id: '1',  label: '영화 & 애니메이션' },
  { id: '15', label: '반려동물' },
];

// ── 업로드 ────────────────────────────────────────────────────────────────────
export interface YouTubeUploadParams {
  videoBlob: Blob; title: string; description: string; tags: string[];
  categoryId?: string; privacyStatus?: 'public' | 'private' | 'unlisted';
  publishAt?: string; madeForKids?: boolean;
  channelId?: string; accessToken?: string;
  onProgress?: (percent: number) => void;
}
export interface YouTubeUploadResult { videoId: string; url: string; scheduledAt?: string; }

export const uploadToYoutube = async (params: YouTubeUploadParams): Promise<YouTubeUploadResult> => {
  let token = params.accessToken || '';
  if (!token && params.channelId) {
    token = getChannelProfiles().find(p => p.id === params.channelId)?.accessToken || '';
  }
  if (!token) token = getChannelProfiles().find(isProfileValid)?.accessToken || '';
  if (!token) throw new Error('액세스 토큰이 없습니다. 채널을 먼저 연결해주세요.');

  const { videoBlob, title, description, tags, categoryId = '22', madeForKids = false, publishAt, onProgress } = params;
  const privacyStatus = publishAt ? 'private' : (params.privacyStatus || 'public');
  const statusObj: any = { privacyStatus, selfDeclaredMadeForKids: madeForKids };
  if (publishAt) statusObj.publishAt = publishAt;

  const initRes = await fetch(`${YOUTUBE_UPLOAD_URL}?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': videoBlob.type || 'video/mp4',
      'X-Upload-Content-Length': String(videoBlob.size),
    },
    body: JSON.stringify({ snippet: { title, description, tags, categoryId }, status: statusObj }),
  });

  if (!initRes.ok) throw new Error(`업로드 세션 생성 실패 (${initRes.status}): ${await initRes.text()}`);
  const uploadUri = initRes.headers.get('Location');
  if (!uploadUri) throw new Error('업로드 URI를 받지 못했습니다.');

  const CHUNK = 50 * 1024 * 1024;
  let offset = 0, videoId = '';

  while (offset < videoBlob.size) {
    const end = Math.min(offset + CHUNK, videoBlob.size);
    const chunkRes = await fetch(uploadUri, {
      method: 'PUT',
      headers: {
        'Content-Type': videoBlob.type || 'video/mp4',
        'Content-Length': String(end - offset),
        'Content-Range': `bytes ${offset}-${end - 1}/${videoBlob.size}`,
      },
      body: videoBlob.slice(offset, end),
    });
    if (chunkRes.status === 308) {
      const range = chunkRes.headers.get('Range');
      offset = range ? Number(range.match(/bytes=0-(\d+)/)?.[1] ?? end - 1) + 1 : end;
      onProgress?.(Math.round((offset / videoBlob.size) * 100));
    } else if (chunkRes.status === 200 || chunkRes.status === 201) {
      videoId = (await chunkRes.json()).id;
      onProgress?.(100);
      break;
    } else {
      throw new Error(`업로드 실패 (${chunkRes.status}): ${await chunkRes.text()}`);
    }
  }

  if (!videoId) throw new Error('업로드 완료 후 videoId를 받지 못했습니다.');
  return { videoId, url: `https://youtu.be/${videoId}`, scheduledAt: publishAt };
};
