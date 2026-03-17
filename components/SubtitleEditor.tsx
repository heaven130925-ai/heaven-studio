/**
 * SubtitleEditor — Vrew 스타일 자막 에디터
 * - 왼쪽: Canvas 미리보기 (자막 실시간 싱크)
 * - 오른쪽: 씬 목록
 * - 하단: 자막 스타일 컨트롤
 */

import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { GeneratedAsset, SubtitleConfig, SUBTITLE_FONTS } from '../types';
import { downloadProjectZip, downloadMediaZip, downloadAudioZip } from '../utils/csvHelper';
import { downloadSrt } from '../services/srtService';
import { exportAssetsToZip } from '../services/exportService';

interface Props {
  scenes: GeneratedAsset[];
  subConfig: SubtitleConfig;
  onSubConfigChange: (cfg: SubtitleConfig) => void;
  onNarrationChange?: (index: number, narration: string) => void;
  onImageEditCommand?: (index: number, command: string) => void;
  onExportVideo?: (enableSubtitles: boolean) => void;
  isExporting?: boolean;
  onSelectThumbnail?: (imageBase64: string) => void;
}

// 사전 로드된 Image 객체 사용 (매 프레임 base64 재파싱 방지)
function renderSubtitleOnCanvas(
  canvas: HTMLCanvasElement,
  cachedImg: HTMLImageElement | null,
  text: string,
  config: SubtitleConfig
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  if (cachedImg) {
    const imgAspect = cachedImg.width / cachedImg.height;
    const canvasAspect = W / H;
    let drawW = W, drawH = H, drawX = 0, drawY = 0;
    if (imgAspect > canvasAspect) {
      drawH = W / imgAspect; drawY = (H - drawH) / 2;
    } else {
      drawW = H * imgAspect; drawX = (W - drawW) / 2;
    }
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(cachedImg, drawX, drawY, drawW, drawH);
  } else {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, W, H);
  }

  if (!text.trim()) return;

  const fontSize = config.fontSize;
  const hPad = 14, safeMargin = 10;
  const align = config.textAlign ?? 'center';

  ctx.font = `${config.fontWeight ?? 700} ${fontSize}px ${config.fontFamily}`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = align as CanvasTextAlign;

  // Measure actual Korean glyph metrics for precise vertical centering
  const glyphMetrics = ctx.measureText('가나다라마바사');
  const glyphAscent = glyphMetrics.actualBoundingBoxAscent || fontSize * 0.72;
  const glyphDescent = glyphMetrics.actualBoundingBoxDescent || fontSize * 0.18;
  const glyphHeight = glyphAscent + glyphDescent;
  const vPad = Math.ceil(glyphHeight * 0.28);
  const lineSpacing = fontSize * 1.35;

  const maxChars = config.maxCharsPerChunk ?? 15;
  const lines: string[] = [];
  let current = '';
  for (const ch of text.split('')) {
    current += ch;
    if (current.length >= maxChars && (ch === ' ' || ch === '.' || ch === ',' || ch === '。' || ch === '，' || ch === '!' || ch === '?')) {
      lines.push(current.trim()); current = '';
    }
  }
  if (current.trim()) lines.push(current.trim());

  const displayLines = lines.slice(0, config.maxLines ?? 2);
  const maxLineWidth = Math.max(...displayLines.map(l => ctx.measureText(l).width));
  let boxWidth = Math.min(maxLineWidth + hPad * 2, W - safeMargin * 2);
  // Box height: based on actual glyph height for precise centering
  const boxInnerH = displayLines.length === 1
    ? glyphHeight
    : (displayLines.length - 1) * lineSpacing + glyphHeight;
  const boxHeight = boxInnerH + vPad * 2;
  let boxX = Math.max(safeMargin, Math.min((W - boxWidth) / 2, W - safeMargin - boxWidth));
  const usableHeight = H - boxHeight - safeMargin * 2;
  let boxY = Math.max(safeMargin, Math.min(safeMargin + ((config.yPercent ?? 85) / 100) * usableHeight, H - safeMargin - boxHeight));

  // Horizontal text position based on alignment
  const textX = align === 'left' ? boxX + hPad
              : align === 'right' ? boxX + boxWidth - hPad
              : boxX + boxWidth / 2;

  const bg = config.backgroundColor ?? 'rgba(0,0,0,0)';
  if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
    ctx.fillStyle = bg;
    ctx.beginPath();
    (ctx as any).roundRect(boxX, boxY, boxWidth, boxHeight, 6);
    ctx.fill();
  }

  // First line glyph center Y = boxY + vPad + glyphHeight/2
  // Alphabetic baseline = glyph center + (ascent - descent)/2
  const baselineOffset = (glyphAscent - glyphDescent) / 2;
  const firstGlyphCenterY = boxY + vPad + glyphHeight / 2;

  displayLines.forEach((line, i) => {
    const glyphCenterY = firstGlyphCenterY + i * lineSpacing;
    const textY = glyphCenterY + baselineOffset;
    const sw = config.strokeWidth ?? 6;
    if (sw > 0) {
      ctx.strokeStyle = config.strokeColor ?? '#000000';
      ctx.lineWidth = sw; ctx.lineJoin = 'round';
      ctx.strokeText(line, textX, textY);
    }
    ctx.fillStyle = config.textColor ?? '#ffffff';
    ctx.fillText(line, textX, textY);
  });
}

const SubtitleEditor: React.FC<Props> = ({ scenes, subConfig, onSubConfigChange, onNarrationChange, onImageEditCommand, onExportVideo, isExporting, onSelectThumbnail }) => {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [editCmd, setEditCmd] = useState('');
  const [isRegenLoading, setIsRegenLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const imgCacheRef = useRef<HTMLImageElement | null>(null);
  const progressFillRef = useRef<HTMLDivElement>(null);

  // 오디오 — WebAudio API
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [currentSubTime, setCurrentSubTime] = useState(0);
  // Google TTS용 구두점 가중치 기반 자막 타이밍
  const [googleTtsGroups, setGoogleTtsGroups] = useState<{ text: string; startTime: number; endTime: number }[] | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playIdRef = useRef(0);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);   // ctx.currentTime 기준 시작점 (offset 포함)
  const durationRef = useRef<number>(0);
  const pausedAtRef = useRef<number>(0);    // 일시정지 위치 (초)
  const isManualPauseRef = useRef<boolean>(false);
  const progressTimerRef = useRef<number>(0);
  const endTimeoutRef = useRef<number>(0);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const progressDragRef = useRef(false);

  // 줌/패닝 — 기본 98.5% (양쪽 클리핑 방지)
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  const [useMeaningChunks, setUseMeaningChunks] = useState(true);
  const set = (partial: Partial<SubtitleConfig>) => onSubConfigChange({ ...subConfig, ...partial });
  const scene = scenes[selectedIdx];
  const narration = scene?.narration ?? '';
  const hasAudio = !!(scene?.audioData);
  const meaningChunks = scene?.subtitleData?.meaningChunks;
  const hasMeaningChunks = !!(meaningChunks && meaningChunks.length > 0);

  // ── 단어 타임스탬프 → 디스플레이 그룹 (ElevenLabs words 기반, 드리프트 없음) ──
  const wordGroups = useMemo(() => {
    const words = scene?.subtitleData?.words;
    if (!words || words.length === 0) return null;
    const maxChars = subConfig.maxCharsPerChunk ?? 15;
    const groups: { text: string; startTime: number; endTime: number }[] = [];
    let cur = '';
    let groupStart = words[0].start;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const candidate = cur ? cur + ' ' + w.word : w.word;
      if (candidate.length > maxChars && cur) {
        groups.push({ text: cur, startTime: groupStart, endTime: w.start });
        cur = w.word;
        groupStart = w.start;
      } else {
        cur = candidate;
      }
    }
    if (cur) {
      groups.push({ text: cur, startTime: groupStart, endTime: Infinity });
    } else if (groups.length > 0) {
      groups[groups.length - 1].endTime = Infinity;
    }
    return groups;
  }, [scene?.subtitleData?.words, subConfig.maxCharsPerChunk]);

  // ── 자막 텍스트 계산 ──
  // 1순위: ElevenLabs words 기반 그룹 (실제 타임스탬프, 드리프트 없음 — 가장 정확)
  // 2순위: AI 의미 단위 (wordGroups 없을 때만)
  // 3순위: 나레이션 시간 균등 분배 (Gemini TTS 폴백)
  const getSubtitleText = useCallback((t: number): string => {
    // 1순위: ElevenLabs words 기반 (가장 정확)
    if (wordGroups && wordGroups.length > 0) {
      if (t < wordGroups[0].startTime) return wordGroups[0].text;
      const g = wordGroups.find(grp => t >= grp.startTime && t < grp.endTime);
      return g ? g.text : wordGroups[wordGroups.length - 1].text;
    }
    // 2순위: Google TTS 구두점 가중치 타이밍
    if (googleTtsGroups && googleTtsGroups.length > 0) {
      if (t < googleTtsGroups[0].startTime) return googleTtsGroups[0].text;
      const g = googleTtsGroups.find(grp => t >= grp.startTime && t < grp.endTime);
      return g ? g.text : googleTtsGroups[googleTtsGroups.length - 1].text;
    }
    // 3순위: AI 의미 단위 (meaningChunks) — 0.15s 먼저 표시 (오디오 지연 보정)
    if (meaningChunks && meaningChunks.length > 0) {
      const EARLY = 0.15;
      const tAdj = t + EARLY;
      if (tAdj < meaningChunks[0].startTime) return meaningChunks[0].text;
      const g = meaningChunks.find((chunk: { startTime: number; endTime: number; text: string }) => tAdj >= chunk.startTime && tAdj < chunk.endTime);
      return g ? g.text : meaningChunks[meaningChunks.length - 1].text;
    }
    // Fallback: 나레이션을 maxChars 단위로 쪼개서 시간 균등 분배
    const dur = durationRef.current;
    if (!dur || !narration) return narration;
    const maxChars = subConfig.maxCharsPerChunk ?? 15;
    const textChunks: string[] = [];
    let cur = '';
    for (const ch of narration.split('')) {
      cur += ch;
      if (cur.length >= maxChars && (ch === ' ' || ch === '.' || ch === ',' || ch === '。' || ch === '，' || ch === '!' || ch === '?')) {
        textChunks.push(cur.trim()); cur = '';
      }
    }
    if (cur.trim()) textChunks.push(cur.trim());
    if (textChunks.length === 0) return narration;
    return textChunks[Math.min(Math.floor(t / (dur / textChunks.length)), textChunks.length - 1)] || narration;
  }, [wordGroups, googleTtsGroups, meaningChunks, narration, subConfig.maxCharsPerChunk]);

  // 재생 중이거나 currentSubTime > 0 (일시정지/자연종료 후 잠시)면 자막 텍스트 표시
  const displaySubtitleText = (isPlaying || currentSubTime > 0) ? getSubtitleText(currentSubTime) : narration;

  // ── 이미지 사전 로드 ──
  useEffect(() => {
    imgCacheRef.current = null;
    if (!scene?.imageData) return;
    const img = new Image();
    img.onload = () => {
      imgCacheRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;
      document.fonts.load(`${subConfig.fontWeight ?? 700} ${subConfig.fontSize}px ${subConfig.fontFamily}`)
        .finally(() => renderSubtitleOnCanvas(canvas, img, narration, subConfig));
    };
    img.src = `data:image/jpeg;base64,${scene.imageData}`;
  }, [scene?.imageData]); // eslint-disable-line

  // ── 씬 변경 시 Google TTS 그룹 초기화 ──
  useEffect(() => { setGoogleTtsGroups(null); }, [selectedIdx]);

  // ── audioData가 없어지면 재생 중인 오디오 즉시 정지 ──
  useEffect(() => {
    if (!scene?.audioData) {
      if (sourceRef.current) { try { sourceRef.current.stop(); } catch {} sourceRef.current = null; }
      cancelAnimationFrame(progressTimerRef.current);
      window.clearTimeout(endTimeoutRef.current);
      setIsPlaying(false);
      setCurrentSubTime(0);
      setAudioProgress(0);
      if (progressFillRef.current) progressFillRef.current.style.width = '0%';
      pausedAtRef.current = 0;
    }
  }, [scene?.audioData]); // eslint-disable-line

  // ── Google TTS용: 구두점 가중치 기반 비례 자막 타이밍 ──
  function createProportionalSubtitles(
    text: string,
    duration: number,
    maxChars: number
  ): { text: string; startTime: number; endTime: number }[] {
    if (!text || duration <= 0) return [];
    // 문장/절 단위로 청크 분리
    const chunks: string[] = [];
    let cur = '';
    for (let i = 0; i < text.length; i++) {
      cur += text[i];
      const isSentenceEnd = '.!?。！？'.includes(text[i]);
      const isClauseEnd = ',，、'.includes(text[i]);
      if ((isSentenceEnd && cur.length >= 4) || (isClauseEnd && cur.length >= maxChars * 0.6) || cur.length >= maxChars) {
        chunks.push(cur.trim());
        cur = '';
      }
    }
    if (cur.trim()) chunks.push(cur.trim());
    if (chunks.length === 0) return [];

    // 구두점 pause 가중치 (현실적인 한국어 TTS 포즈 기준)
    // 문장 끝 +2 ≈ +0.27s, 쉼표 +1 ≈ +0.13s (기존 6/3보다 낮춰서 자막 지연 방지)
    const weights = chunks.map(c => {
      let w = c.length;
      w += (c.match(/[.!?。！？]/g) || []).length * 2;
      w += (c.match(/[,，、]/g) || []).length * 1;
      return Math.max(w, 2);
    });
    const total = weights.reduce((a, b) => a + b, 0);

    // 0.15s 앞당겨 표시: TTS가 음절을 말하기 직전에 자막이 나오도록
    const EARLY = 0.15;
    const result: { text: string; startTime: number; endTime: number }[] = [];
    let t = 0;
    for (let i = 0; i < chunks.length; i++) {
      const d = (weights[i] / total) * duration;
      result.push({
        text: chunks[i],
        startTime: Math.max(0, t - EARLY),
        endTime: t + d - EARLY,
      });
      t += d;
    }
    return result;
  }

  // ── AudioBuffer 디코더 (MP3 + PCM16 fallback) — 끝 0.6s 패딩 추가 ──
  async function decodeAudioBuffer(base64: string, ctx: AudioContext): Promise<{ buffer: AudioBuffer; contentDuration: number }> {
    const b64 = base64.startsWith('data:') ? base64.split(',')[1] : base64;
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    let decoded: AudioBuffer;
    try {
      decoded = await ctx.decodeAudioData(bytes.buffer.slice(0));
    } catch {
      // Gemini TTS PCM16 24kHz
      const pcm = new Int16Array(bytes.buffer);
      const buf = ctx.createBuffer(1, pcm.length, 24000);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768.0;
      decoded = buf;
    }
    // MP3 인코더 지연으로 끝이 잘리는 현상 방지 — 무음 패딩 추가
    const PAD = 1.5;
    const sr = decoded.sampleRate;
    const padSamples = Math.ceil(sr * PAD);
    const padded = ctx.createBuffer(decoded.numberOfChannels, decoded.length + padSamples, sr);
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      padded.getChannelData(ch).set(decoded.getChannelData(ch), 0);
    }
    return { buffer: padded, contentDuration: decoded.duration };
  }

  // ── stopAudio: 완전 중지 + 위치 초기화 ──
  const stopAudio = useCallback(() => {
    playIdRef.current++;
    pausedAtRef.current = 0;
    isManualPauseRef.current = false;
    window.clearTimeout(endTimeoutRef.current);
    if (sourceRef.current) { try { sourceRef.current.stop(); } catch {} sourceRef.current = null; }
    cancelAnimationFrame(progressTimerRef.current);
    setIsPlaying(false);
    setAudioProgress(0);
    setCurrentSubTime(0);
  }, []);

  // 씬 변경 → 완전 중지
  useEffect(() => { stopAudio(); }, [selectedIdx, stopAudio]);

  // 언마운트 정리
  useEffect(() => {
    return () => {
      stopAudio();
      if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null; }
    };
  }, [stopAudio]);

  // ── togglePlay: 재생/일시정지 (정지 위치에서 이어서 재생) ──
  const togglePlay = useCallback(async () => {
    if (isPlaying) {
      // 일시정지 — 현재 위치 저장
      isManualPauseRef.current = true;
      if (audioCtxRef.current) {
        pausedAtRef.current = Math.min(
          audioCtxRef.current.currentTime - startTimeRef.current,
          durationRef.current
        );
      }
      if (sourceRef.current) { try { sourceRef.current.stop(); } catch {} sourceRef.current = null; }
      cancelAnimationFrame(progressTimerRef.current);
      setIsPlaying(false);
      return;
    }

    if (!scene?.audioData) return;
    const thisPlayId = ++playIdRef.current;
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
        audioCtxRef.current = new AC();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') await ctx.resume();
      setIsPlaying(true);

      const { buffer, contentDuration } = await decodeAudioBuffer(scene.audioData, ctx);
      if (thisPlayId !== playIdRef.current) { setIsPlaying(false); return; }
      isManualPauseRef.current = false;

      // ElevenLabs words 기준으로만 클리핑 (정확한 타임스탬프 보유)
      // Google TTS(meaningChunks만 있을 때)는 클리핑 금지 — 오디오 잘림 방지
      const words = scene?.subtitleData?.words;
      const lastWordEnd = words && words.length > 0 ? words[words.length - 1].end : null;
      const effectiveDuration = lastWordEnd
        ? Math.min(contentDuration, lastWordEnd + 0.5)
        : contentDuration;

      durationRef.current = effectiveDuration;

      // Google TTS (wordGroups/meaningChunks 없을 때) → 구두점 가중치 타이밍 생성
      if ((!wordGroups || wordGroups.length === 0) && (!scene?.subtitleData?.meaningChunks?.length)) {
        setGoogleTtsGroups(createProportionalSubtitles(narration, effectiveDuration, subConfig.maxCharsPerChunk ?? 15));
      }

      const offset = Math.min(pausedAtRef.current, Math.max(0, effectiveDuration - 0.05));

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => {
        const wasManual = isManualPauseRef.current;
        isManualPauseRef.current = false;
        cancelAnimationFrame(progressTimerRef.current);
        sourceRef.current = null;
        if (!wasManual) {
          // 자연 종료 → 마지막 자막 유지 후 1.2초 뒤 리셋
          setCurrentSubTime(durationRef.current);
          setAudioProgress(100);
          pausedAtRef.current = 0;
          endTimeoutRef.current = window.setTimeout(() => {
            setAudioProgress(0);
            setCurrentSubTime(0);
          }, 1200);
        }
        setIsPlaying(false);
      };
      // +0.5s 버퍼: PCM 마지막 음절 잘림 방지 (패딩 1.5s 범위 내)
      const playDuration = effectiveDuration - offset + 0.5;
      source.start(0, offset, playDuration > 0 ? playDuration : undefined);
      sourceRef.current = source;
      // 오디오 하드웨어 출력 지연 보정 (outputLatency: 실제 스피커 출력까지의 지연)
      const hwLatency = (ctx as any).outputLatency ?? (ctx as any).baseLatency ?? 0;
      startTimeRef.current = ctx.currentTime - offset + hwLatency;

      const rafLoop = () => {
        const actx = audioCtxRef.current;
        if (!actx || !sourceRef.current) return;
        if (actx.state === 'suspended') actx.resume();
        const elapsed = actx.currentTime - startTimeRef.current;
        const clamped = Math.min(Math.max(elapsed, 0), durationRef.current);
        // 직접 DOM 업데이트 → React 리렌더 없이 부드러운 진행바
        if (progressFillRef.current) {
          progressFillRef.current.style.width = `${(clamped / durationRef.current) * 100}%`;
        }
        setCurrentSubTime(clamped);
        progressTimerRef.current = requestAnimationFrame(rafLoop) as any;
      };
      progressTimerRef.current = requestAnimationFrame(rafLoop) as any;
    } catch (e) {
      console.error('Audio error:', e);
      setIsPlaying(false);
    }
  }, [isPlaying, scene]);

  // ── 프로그레스바 seek ──
  const seekToFraction = useCallback((fraction: number) => {
    if (!durationRef.current) return;
    const seekTime = Math.max(0, Math.min(1, fraction)) * durationRef.current;
    isManualPauseRef.current = true;
    if (sourceRef.current) { try { sourceRef.current.stop(); } catch {} sourceRef.current = null; }
    cancelAnimationFrame(progressTimerRef.current);
    window.clearTimeout(endTimeoutRef.current);
    setIsPlaying(false);
    pausedAtRef.current = seekTime;
    setCurrentSubTime(seekTime);
    setAudioProgress(fraction * 100);
  }, []);

  // ── 프로그레스바 드래그 ──
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!progressDragRef.current || !progressBarRef.current) return;
      const rect = progressBarRef.current.getBoundingClientRect();
      seekToFraction(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
    };
    const handleMouseUp = () => { progressDragRef.current = false; };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [seekToFraction]);

  // ── 스페이스바 단축키 ──
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'BUTTON') {
        e.preventDefault();
        togglePlay();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [togglePlay]);

  // ── 컨테이너 크기 추적 ──
  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // 이미지 경계 감지
  const maxPanX = containerSize.w * (zoom - 1) / 2;
  const maxPanY = containerSize.h * (zoom - 1) / 2;
  const snapThreshold = 8;
  const atLeft   = zoom > 1 && pan.x >= maxPanX - snapThreshold;
  const atRight  = zoom > 1 && pan.x <= -(maxPanX - snapThreshold);
  const atTop    = zoom > 1 && pan.y >= maxPanY - snapThreshold;
  const atBottom = zoom > 1 && pan.y <= -(maxPanY - snapThreshold);

  const handleMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    setIsDragging(true);
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    setPan({ x: dragRef.current.panX + (e.clientX - dragRef.current.startX), y: dragRef.current.panY + (e.clientY - dragRef.current.startY) });
  };
  const handleMouseUp = () => { dragRef.current = null; setIsDragging(false); };

  // ── 캔버스 재렌더 (자막 텍스트 변경 시 포함) ──
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    document.fonts.load(`${subConfig.fontWeight ?? 700} ${subConfig.fontSize}px ${subConfig.fontFamily}`)
      .finally(() => renderSubtitleOnCanvas(canvas, imgCacheRef.current, displaySubtitleText, subConfig));
  }, [displaySubtitleText, subConfig]);

  useEffect(() => { redraw(); }, [redraw]);

  return (
    <div className="flex h-full overflow-hidden justify-center bg-slate-950">
    <div className="flex h-full overflow-hidden min-w-0" style={{ width: '100%', maxWidth: '1600px', margin: '0 auto' }}>
      {/* ─── 왼쪽 ─── */}
      <div className="flex flex-col w-[66%] border-r border-white/[0.07] overflow-y-auto">

        {/* 헤더 영역 */}
        <div className="bg-slate-900 border-b border-white/[0.07] shrink-0">
          {/* 줌 컨트롤 행 */}
          <div className="flex items-center gap-2 px-3 pt-2 pb-1">
            <button onClick={() => { setZoom(1.0); setPan({ x: 0, y: 0 }); }}
              className="text-[10px] text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 transition-colors font-mono">
              RESET
            </button>
            <button onClick={() => setZoom(z => Math.max(0.3, +(z - 0.01).toFixed(3)))}
              className="w-8 h-8 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xl font-bold transition-colors">−</button>
            <span className="text-sm text-slate-200 font-mono w-14 text-center font-bold">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.min(3, +(z + 0.01).toFixed(3)))}
              className="w-8 h-8 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xl font-bold transition-colors">+</button>
            <span className="text-[10px] text-slate-500 ml-1">드래그로 이동 · Space 재생</span>
          </div>
          {/* 저장 버튼 행 */}
          <div className="flex gap-1.5 px-3 pb-1.5">
            {[
              { label: '전체 저장', onClick: () => downloadProjectZip(scenes) },
              { label: '이미지+음성', onClick: () => downloadMediaZip(scenes) },
              { label: '오디오 ZIP', onClick: () => downloadAudioZip(scenes) },
              { label: '엑셀+이미지', onClick: () => exportAssetsToZip(scenes, `스토리보드_${new Date().toLocaleDateString('ko-KR')}`) },
              { label: 'SRT', onClick: async () => await downloadSrt(scenes, `subtitles_${Date.now()}.srt`) },
            ].map(btn => (
              <button key={btn.label} onClick={btn.onClick}
                className="flex-1 py-2 rounded-lg bg-blue-600/20 border border-blue-500/60 text-blue-200 font-bold text-xs hover:bg-blue-600/35 hover:border-blue-400/80 transition-all shadow-[0_0_10px_rgba(59,130,246,0.3)]">
                {btn.label}
              </button>
            ))}
          </div>
          {/* 내보내기 버튼 행 */}
          {onExportVideo && (
            <div className="flex gap-1.5 px-3 pb-2">
              <button onClick={() => onExportVideo(false)} disabled={isExporting}
                className="flex-1 py-2.5 rounded-lg bg-red-600/25 border border-red-500/60 hover:bg-red-600/40 text-red-200 text-sm font-black transition-all disabled:opacity-40 shadow-[0_0_14px_rgba(239,68,68,0.35)]">
                자막 없이 내보내기
              </button>
              <button onClick={() => onExportVideo(true)} disabled={isExporting}
                className="flex-1 py-2.5 rounded-lg bg-red-600/25 border border-red-500/60 hover:bg-red-600/40 text-red-200 text-sm font-black transition-all disabled:opacity-40 shadow-[0_0_14px_rgba(239,68,68,0.35)]">
                {isExporting ? '렌더링 중...' : '자막 포함 내보내기'}
              </button>
            </div>
          )}
        </div>

        {/* 캔버스 */}
        <div ref={canvasContainerRef}
          className="relative bg-black overflow-hidden cursor-grab active:cursor-grabbing select-none"
          style={{ aspectRatio: '16/9', width: '72%', maxWidth: '72%', margin: '0 auto', flexShrink: 0 }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
        >
          <div style={{ transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`, transformOrigin: 'center center', width: '100%', height: '100%' }}>
            <canvas ref={canvasRef} width={1280} height={720} className="w-full h-full" />
          </div>

          {/* 중심 가이드라인 (드래그 중) */}
          {isDragging && (() => {
            const snapPx = 1, cx = Math.abs(pan.x) <= snapPx, cy = Math.abs(pan.y) <= snapPx;
            return (<>
              <div className="absolute top-0 bottom-0 pointer-events-none" style={{
                left: 'calc(50% - 0.5px)', width: cx ? 2 : 1,
                background: cx ? 'rgba(239,68,68,0.95)' : 'rgba(255,255,255,0.2)',
                boxShadow: cx ? '0 0 6px rgba(239,68,68,0.8)' : 'none',
              }} />
              <div className="absolute left-0 right-0 pointer-events-none" style={{
                top: 'calc(50% - 0.5px)', height: cy ? 2 : 1,
                background: cy ? 'rgba(239,68,68,0.95)' : 'rgba(255,255,255,0.2)',
                boxShadow: cy ? '0 0 6px rgba(239,68,68,0.8)' : 'none',
              }} />
            </>);
          })()}

          {/* 경계 스냅 선 */}
          {atLeft   && <div className="absolute top-0 bottom-0 left-0 w-0.5 bg-amber-400/80 pointer-events-none shadow-[0_0_6px_rgba(251,191,36,0.8)]" />}
          {atRight  && <div className="absolute top-0 bottom-0 right-0 w-0.5 bg-amber-400/80 pointer-events-none shadow-[0_0_6px_rgba(251,191,36,0.8)]" />}
          {atTop    && <div className="absolute left-0 right-0 top-0 h-0.5 bg-amber-400/80 pointer-events-none shadow-[0_0_6px_rgba(251,191,36,0.8)]" />}
          {atBottom && <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-amber-400/80 pointer-events-none shadow-[0_0_6px_rgba(251,191,36,0.8)]" />}

          {!scene?.imageData && !isRegenLoading && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-xs pointer-events-none">
              이미지 생성 대기 중...
            </div>
          )}
          {isRegenLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 pointer-events-none">
              <div className="w-10 h-10 border-4 border-orange-400/30 border-t-orange-400 rounded-full animate-spin mb-3" />
              <span className="text-orange-300 text-sm font-bold">이미지 편집 중...</span>
            </div>
          )}
        </div>

        {/* 오디오 플레이어 */}
        <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-900 border-b border-white/[0.07] shrink-0">
          <button
            onClick={togglePlay}
            disabled={!hasAudio}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-all shrink-0 ${
              hasAudio
                ? isPlaying
                  ? 'bg-blue-500 text-white shadow-[0_0_10px_rgba(59,130,246,0.5)]'
                  : 'bg-blue-600/25 border border-blue-500/60 hover:bg-blue-600/45 text-blue-200'
                : 'bg-slate-800 text-slate-600 cursor-not-allowed'
            }`}
          >
            {isPlaying
              ? <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="4" height="10" rx="1"/><rect x="7" y="1" width="4" height="10" rx="1"/></svg>
              : <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" style={{marginLeft:'1px'}}><polygon points="2,1 11,6 2,11"/></svg>
            }
          </button>
          <div
            ref={progressBarRef}
            className="flex-1 relative h-3 bg-slate-700 rounded-full overflow-hidden cursor-pointer"
            onMouseDown={(e: React.MouseEvent<HTMLDivElement>) => {
              if (!hasAudio || !durationRef.current) return;
              progressDragRef.current = true;
              const rect = e.currentTarget.getBoundingClientRect();
              seekToFraction(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
            }}
          >
            <div ref={progressFillRef} className="h-full bg-gradient-to-r from-blue-400 to-indigo-400 rounded-full pointer-events-none"
              style={{ width: `${audioProgress}%` }} />
          </div>
          <span className="text-[10px] text-slate-400 shrink-0 w-20 text-right font-mono">
            {hasAudio
              ? isPlaying || pausedAtRef.current > 0
                ? `${currentSubTime > 0 ? currentSubTime.toFixed(1) : pausedAtRef.current.toFixed(1)}s / ${durationRef.current > 0 ? durationRef.current.toFixed(1) : (scene?.audioDuration ?? 0).toFixed(1)}s`
                : scene?.audioDuration ? `${scene.audioDuration.toFixed(1)}s` : '●'
              : '—'}
          </span>
        </div>

        {/* 자막 텍스트 편집 */}
        {onNarrationChange && (
          <div className="px-4 pt-3 pb-1">
            <label className="text-sm text-slate-300 font-bold block mb-1">씬 {selectedIdx + 1} 자막 텍스트</label>
            <textarea
              value={narration}
              onChange={e => onNarrationChange(selectedIdx, e.target.value)}
              rows={5}
              className="w-full mt-1 bg-slate-800/80 border border-white/[0.08] rounded-lg px-3 py-2 text-base text-white resize-none focus:outline-none focus:border-blue-500"
            />
          </div>
        )}

        {/* 이미지 편집 명령 */}
        {onImageEditCommand && (
          <div className="px-4 pt-1 pb-2">
            <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">이미지 편집 명령</label>
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                value={editCmd}
                onChange={e => setEditCmd(e.target.value)}
                onKeyDown={async (e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === 'Enter' && editCmd.trim() && !isRegenLoading) {
                    const cmd = editCmd.trim();
                    setEditCmd('');
                    setIsRegenLoading(true);
                    try { await onImageEditCommand(selectedIdx, cmd); } finally { setIsRegenLoading(false); }
                  }
                }}
                disabled={isRegenLoading}
                placeholder="예: 텍스트 지워줘 / 왼쪽 사람 없애줘"
                className="flex-1 bg-slate-800/80 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-orange-500 disabled:opacity-50"
              />
              <button
                onClick={async () => {
                  if (!editCmd.trim() || isRegenLoading) return;
                  const cmd = editCmd.trim();
                  setEditCmd('');
                  setIsRegenLoading(true);
                  try { await onImageEditCommand(selectedIdx, cmd); } finally { setIsRegenLoading(false); }
                }}
                disabled={!editCmd.trim() || isRegenLoading}
                className="px-3 py-1.5 rounded-lg text-sm font-bold bg-orange-600/30 border border-orange-500/50 text-orange-300 hover:bg-orange-600/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
              >
                {isRegenLoading
                  ? <><div className="w-3.5 h-3.5 border-2 border-orange-300/40 border-t-orange-300 rounded-full animate-spin" />재생성 중</>
                  : '재생성'}
              </button>
            </div>
          </div>
        )}

        {/* 자막 스타일 컨트롤 */}
        <div className="px-2 py-2 space-y-1.5">

          {/* 폰트 선택 */}
          <div className="p-2 rounded-xl border border-blue-500/60 shadow-[0_0_14px_rgba(59,130,246,0.3)]">
            <label className="text-xs text-blue-300 uppercase tracking-wider font-black block mb-1">폰트</label>
            <div className="flex gap-1 overflow-x-auto pb-0.5">
              {SUBTITLE_FONTS.map(f => (
                <button key={f.value}
                  onClick={() => set({ fontFamily: f.value, fontWeight: f.weight })}
                  className={`shrink-0 py-1 px-2 rounded-lg text-xs font-bold transition-colors text-center border ${
                    subConfig.fontFamily === f.value ? 'bg-blue-600/20 text-blue-200 border-blue-500/60 shadow-[0_0_10px_rgba(59,130,246,0.4)]' : 'bg-slate-800 text-slate-200 border-blue-500/30 hover:bg-slate-700 hover:border-blue-400/50'
                  }`}
                  style={{ fontFamily: f.value }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* 크기 + 굵기 */}
          <div className="p-2 rounded-xl border border-blue-500/60 shadow-[0_0_14px_rgba(59,130,246,0.3)]">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-300 font-bold block mb-0.5">
                크기 <span className="text-slate-200">{subConfig.fontSize}px</span>
              </label>
              <input type="range" min={20} max={120} step={2}
                value={subConfig.fontSize} onChange={e => set({ fontSize: +e.target.value })}
                className="w-full accent-blue-500" />
            </div>
            <div>
              <label className="text-xs text-slate-300 font-bold block mb-0.5">
                굵기 <span className="text-slate-200">{subConfig.fontWeight}</span>
              </label>
              <input type="range" min={100} max={900} step={100}
                value={subConfig.fontWeight} onChange={e => set({ fontWeight: +e.target.value })}
                className="w-full accent-blue-500" />
            </div>
          </div>
          </div>

          {/* 색상 */}
          <div className="p-2 rounded-xl border border-blue-500/60 shadow-[0_0_14px_rgba(59,130,246,0.3)]">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-slate-300 font-bold block mb-0.5">글자색</label>
              <div className="flex items-center gap-1.5">
                <input type="color" value={subConfig.textColor} onChange={e => set({ textColor: e.target.value })}
                  className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent" />
                <span className="text-[10px] text-slate-300 font-mono">{subConfig.textColor}</span>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-300 font-bold block mb-0.5">테두리색</label>
              <div className="flex items-center gap-1.5">
                <input type="color" value={subConfig.strokeColor} onChange={e => set({ strokeColor: e.target.value })}
                  className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent" />
                <span className="text-[10px] text-slate-300 font-mono">{subConfig.strokeColor}</span>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-300 font-bold block mb-0.5">
                테두리 <span className="text-slate-200">{subConfig.strokeWidth}</span>
              </label>
              <input type="range" min={0} max={20} step={1}
                value={subConfig.strokeWidth} onChange={e => set({ strokeWidth: +e.target.value })}
                className="w-full accent-blue-500" />
            </div>
          </div>
          </div>

          {/* 배경 + 정렬 */}
          <div className="p-2 rounded-xl border border-blue-500/60 shadow-[0_0_14px_rgba(59,130,246,0.3)]">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-300 font-bold block mb-0.5">배경</label>
              <div className="flex gap-1">
                {[
                  { label: '없음', val: 'rgba(0, 0, 0, 0)' },
                  { label: '반투명', val: 'rgba(0,0,0,0.6)' },
                  { label: '불투명', val: 'rgba(0,0,0,0.9)' },
                ].map(o => (
                  <button key={o.val} onClick={() => set({ backgroundColor: o.val })}
                    className={`flex-1 py-1 rounded-lg text-[11px] font-bold transition-colors border ${
                      subConfig.backgroundColor === o.val ? 'bg-blue-600/20 text-blue-200 shadow-[0_0_10px_rgba(59,130,246,0.4)] border-blue-500/60' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border-blue-500/30'
                    }`}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-300 font-bold block mb-0.5">정렬</label>
              <div className="flex gap-1">
                {(['left', 'center', 'right'] as const).map(a => (
                  <button key={a} onClick={() => set({ textAlign: a })}
                    className={`flex-1 py-1 rounded-lg text-[11px] font-bold transition-colors border ${
                      (subConfig.textAlign ?? 'center') === a ? 'bg-blue-600/20 text-blue-200 shadow-[0_0_10px_rgba(59,130,246,0.4)] border-blue-500/60' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border-blue-500/30'
                    }`}>
                    {a === 'left' ? '좌' : a === 'center' ? '중' : '우'}
                  </button>
                ))}
              </div>
            </div>
          </div>
          </div>

          {/* 세로위치 + 청크글자수 (한 블록으로 합침) */}
          <div className="p-2 rounded-xl border border-blue-500/60 shadow-[0_0_14px_rgba(59,130,246,0.3)]">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-300 font-bold block mb-0.5">
                세로위치 <span className="text-slate-200">{subConfig.yPercent ?? 85}%</span>
              </label>
              <input type="range" min={0} max={100} step={1}
                value={subConfig.yPercent ?? 85} onChange={e => set({ yPercent: +e.target.value })}
                className="w-full accent-blue-500" />
            </div>
            <div>
              <label className="text-xs text-slate-300 font-bold block mb-0.5">
                청크글자 <span className="text-slate-200">{subConfig.maxCharsPerChunk ?? 15}자</span>
              </label>
              <input type="range" min={5} max={30} step={1}
                value={subConfig.maxCharsPerChunk ?? 15} onChange={e => set({ maxCharsPerChunk: +e.target.value })}
                className="w-full accent-blue-500" />
            </div>
          </div>
          </div>

          {/* AI 의미 단위 자막 */}
          <div className="p-2 rounded-xl border border-blue-500/60 shadow-[0_0_14px_rgba(59,130,246,0.3)]">
            <label className="text-xs text-slate-300 font-bold block mb-1">
              AI 의미 단위 자막
              {!hasMeaningChunks && <span className="ml-1 text-slate-600 normal-case font-normal">(TTS 생성 후 활성화)</span>}
            </label>
            <button
              onClick={() => setUseMeaningChunks(v => !v)}
              disabled={!hasMeaningChunks}
              className={`w-full py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                useMeaningChunks
                  ? 'bg-blue-600 text-white shadow-[0_0_10px_rgba(59,130,246,0.4)]'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {useMeaningChunks ? 'AI 의미 단위 ON' : '글자수 기준 (AI OFF)'}
            </button>
          </div>
        </div>
      </div>

      {/* ─── 오른쪽: 씬 목록 ─── */}
      <div className="flex-1 overflow-y-auto py-2 px-2">
        {scenes.map((s, i) => (
          <div key={i} className={`flex items-start gap-3 px-3 py-3 rounded-xl mb-0.5 transition-all ${
            i === selectedIdx
              ? 'border border-red-500/50 bg-red-900/15 shadow-[0_0_14px_rgba(239,68,68,0.3)]'
              : 'hover:bg-slate-800/60 border border-transparent'
          }`}>
            <button onClick={() => setSelectedIdx(i)} className="flex items-start gap-3 flex-1 text-left min-w-0">
              <div className="w-32 h-[72px] rounded-lg overflow-hidden shrink-0 bg-slate-800 flex items-center justify-center">
                {s.imageData
                  ? <img src={`data:image/jpeg;base64,${s.imageData}`} className="w-full h-full object-cover" alt="" />
                  : <div className="w-4 h-4 border border-slate-600 border-t-transparent animate-spin rounded-full" />
                }
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-slate-500 font-bold mb-0.5">씬 {i + 1}</p>
                <p className="text-sm text-slate-300 leading-snug line-clamp-2">{s.narration}</p>
              </div>
            </button>
            {s.imageData && onSelectThumbnail && (
              <button
                onClick={() => onSelectThumbnail(s.imageData!)}
                className="shrink-0 p-1.5 rounded-lg bg-yellow-500/20 hover:bg-yellow-500/40 border border-yellow-500/30 text-yellow-400 transition-all"
                title="썸네일로 선택"
              >⭐</button>
            )}
          </div>
        ))}
      </div>
    </div>
    </div>
  );
};

export default SubtitleEditor;
