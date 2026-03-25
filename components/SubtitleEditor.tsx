/**
 * SubtitleEditor — Vrew 스타일 자막 에디터
 * - 왼쪽: Canvas 미리보기 (자막 실시간 싱크)
 * - 오른쪽: 씬 목록
 * - 하단: 자막 스타일 컨트롤
 */

import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { GeneratedAsset, SubtitleConfig, SUBTITLE_FONTS, ZoomEffect, ZoomType, ZoomOrigin, DEFAULT_ZOOM_EFFECT } from '../types';
import { downloadProjectZip, downloadMediaZip } from '../utils/csvHelper';
import { downloadSrt } from '../services/srtService';
import { exportAssetsToZip } from '../services/exportService';

interface Props {
  scenes: GeneratedAsset[];
  subConfig: SubtitleConfig;
  onSubConfigChange: (cfg: SubtitleConfig) => void;
  onImageEditCommand?: (index: number, command: string) => void;
  onGenerateAnimation?: (index: number, motionPrompt?: string) => void;
  animatingIndices?: Set<number>;
  onExportVideo?: (enableSubtitles: boolean) => void;
  isExporting?: boolean;
  onSelectThumbnail?: (imageBase64: string) => void;
  onGenerateAudio?: (index: number) => Promise<string | null>;
  onDeleteScene?: (index: number) => void;
  onSceneZoomChange?: (index: number, zoom: ZoomEffect | null) => void;
  aspectRatio?: '16:9' | '9:16';
}

// 자막 텍스트만 그리기 (배경 이미지 없이 — 줌 애니메이션과 합성용)
function drawSubtitleText(
  ctx: CanvasRenderingContext2D,
  text: string,
  config: SubtitleConfig,
  W: number,
  H: number
) {
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

// 정적 이미지 + 자막 렌더링 (줌 없을 때)
function renderSubtitleOnCanvas(
  canvas: HTMLCanvasElement,
  cachedImg: HTMLImageElement | null,
  text: string,
  config: SubtitleConfig
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (cachedImg) {
    const imgAspect = cachedImg.width / cachedImg.height;
    const canvasAspect = W / H;
    let drawW = W, drawH = H, drawX = 0, drawY = 0;
    if (imgAspect > canvasAspect) { drawH = W / imgAspect; drawY = (H - drawH) / 2; }
    else { drawW = H * imgAspect; drawX = (W - drawW) / 2; }
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(cachedImg, drawX, drawY, drawW, drawH);
  } else {
    ctx.fillStyle = '#1e293b'; ctx.fillRect(0, 0, W, H);
  }
  drawSubtitleText(ctx, text, config, W, H);
}

const ZOOM_TYPE_LABELS: Record<ZoomType, string> = {
  'none': '없음', 'zoom-in': '줌인', 'zoom-out': '줌아웃', 'pan-left': '←패닝', 'pan-right': '패닝→',
};
const ORIGIN_LABELS: Record<ZoomOrigin, string> = {
  'center': '중앙', 'top-left': '↖', 'top-right': '↗', 'bottom-left': '↙', 'bottom-right': '↘',
};

// 줌/패닝 미리보기용 캔버스 드로잉
function drawZoomPreview(
  ctx: CanvasRenderingContext2D, img: HTMLImageElement,
  W: number, H: number, progress: number, zoom: ZoomEffect
) {
  const factor = zoom.intensity / 100;
  const originMap: Record<ZoomOrigin, [number, number]> = {
    'center': [0.5, 0.5], 'top-left': [0, 0], 'top-right': [1, 0],
    'bottom-left': [0, 1], 'bottom-right': [1, 1],
  };
  const [ox, oy] = originMap[zoom.origin];

  // 이미지 cover fit
  const imgAspect = img.width / img.height;
  const canvasAspect = W / H;
  let baseW = W, baseH = H;
  if (imgAspect > canvasAspect) { baseH = H; baseW = H * imgAspect; }
  else { baseW = W; baseH = W / imgAspect; }

  let scale = 1;
  let tx = 0, ty = 0;

  if (zoom.type === 'zoom-in') {
    scale = 1 + factor * progress;
  } else if (zoom.type === 'zoom-out') {
    scale = (1 + factor) - factor * progress;
  } else if (zoom.type === 'pan-left') {
    scale = 1 + factor;
    tx = -factor * progress * W;
  } else if (zoom.type === 'pan-right') {
    scale = 1 + factor;
    tx = factor * progress * W;
  }

  const drawW = baseW * scale;
  const drawH = baseH * scale;
  const anchorX = ox * W;
  const anchorY = oy * H;
  const drawX = anchorX - ox * drawW + tx;
  const drawY = anchorY - oy * drawH + ty;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, drawX, drawY, drawW, drawH);
}

const ZoomPanel: React.FC<{
  subConfig: SubtitleConfig;
  onSubConfigChange: (cfg: SubtitleConfig) => void;
  selectedIdx: number;
  sceneZoom: ZoomEffect | null | undefined;
  onSceneZoomChange?: (zoom: ZoomEffect | null) => void;
}> = ({ subConfig, onSubConfigChange, selectedIdx, sceneZoom, onSceneZoomChange }) => {
  const [mode, setMode] = useState<'global' | 'scene'>('global');

  const gz = subConfig.globalZoom ?? DEFAULT_ZOOM_EFFECT;
  const hasOverride = sceneZoom != null;
  const currentZoom = mode === 'global' ? gz : (sceneZoom ?? gz);

  const setZoom = (partial: Partial<ZoomEffect>) => {
    if (mode === 'global') {
      onSubConfigChange({ ...subConfig, globalZoom: { ...gz, ...partial } });
    } else {
      onSceneZoomChange?.({ ...currentZoom, ...partial });
    }
  };

  const switchToScene = () => {
    setMode('scene');
    if (!hasOverride) onSceneZoomChange?.({ ...gz });
  };

  const clearSceneOverride = () => {
    onSceneZoomChange?.(null);
    setMode('global');
  };

  return (
    <div className="px-3 pb-1.5">
      {/* 헤더: 라벨 + 모드 토글 */}
      <div className="flex items-center justify-between mb-1">
        <label className="text-[10px] text-purple-300 uppercase tracking-wider font-black">
          이미지 무빙 효과
        </label>
        <div className="flex gap-1">
          <button onClick={() => setMode('global')}
            className={`text-[10px] px-2 py-0.5 rounded font-bold transition-colors border ${
              mode === 'global'
                ? 'bg-purple-600/30 text-purple-200 border-purple-500/60'
                : 'bg-slate-800 text-slate-500 border-slate-700 hover:border-purple-500/40'
            }`}>
            전역
          </button>
          <button onClick={switchToScene}
            className={`text-[10px] px-2 py-0.5 rounded font-bold transition-colors border ${
              mode === 'scene'
                ? 'bg-amber-600/30 text-amber-200 border-amber-500/60'
                : 'bg-slate-800 text-slate-500 border-slate-700 hover:border-amber-500/40'
            }`}>
            씬 {selectedIdx + 1} 개별{hasOverride ? ' ●' : ''}
          </button>
          {mode === 'scene' && hasOverride && (
            <button onClick={clearSceneOverride}
              className="text-[10px] px-1.5 py-0.5 rounded font-bold border bg-slate-800 text-slate-500 border-slate-700 hover:text-red-400 hover:border-red-500/40 transition-colors">
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 타입 버튼 */}
      <div className="flex gap-1 mb-1">
        {(Object.keys(ZOOM_TYPE_LABELS) as ZoomType[]).map(t => (
          <button key={t} onClick={() => setZoom({ type: t })}
            className={`flex-1 py-1 rounded text-[10px] font-bold transition-colors border ${
              currentZoom.type === t
                ? mode === 'scene'
                  ? 'bg-amber-600/30 text-amber-200 border-amber-500/60'
                  : 'bg-purple-600/30 text-purple-200 border-purple-500/60'
                : 'bg-slate-800 text-slate-400 border-slate-600/40 hover:text-slate-200'
            }`}>
            {ZOOM_TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {/* 강도 + 원점 */}
      {currentZoom.type !== 'none' && (
        <div className="flex gap-2 items-center">
          <div className="flex-1">
            <label className="text-[9px] text-slate-400 font-bold">강도 {currentZoom.intensity}%</label>
            <input type="range" min={1} max={20} step={1}
              value={currentZoom.intensity}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setZoom({ intensity: +e.target.value })}
              className={`w-full h-1 ${mode === 'scene' ? 'accent-amber-500' : 'accent-purple-500'}`} />
          </div>
          {(currentZoom.type === 'zoom-in' || currentZoom.type === 'zoom-out') && (
            <div className="flex gap-0.5 shrink-0">
              {(Object.keys(ORIGIN_LABELS) as ZoomOrigin[]).map(o => (
                <button key={o} onClick={() => setZoom({ origin: o })} title={o}
                  className={`w-6 h-6 rounded text-[9px] font-bold transition-colors border ${
                    currentZoom.origin === o
                      ? mode === 'scene'
                        ? 'bg-amber-600/40 text-amber-200 border-amber-500/60'
                        : 'bg-purple-600/40 text-purple-200 border-purple-500/60'
                      : 'bg-slate-800 text-slate-500 border-slate-700'
                  }`}>
                  {ORIGIN_LABELS[o]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const SubtitleEditor: React.FC<Props> = ({ scenes, subConfig, onSubConfigChange, onImageEditCommand, onGenerateAnimation, animatingIndices, onExportVideo, isExporting, onSelectThumbnail, onGenerateAudio, onDeleteScene, onSceneZoomChange, aspectRatio = '16:9' }) => {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [editCmd, setEditCmd] = useState('');
  const [animationPrompt, setAnimationPrompt] = useState('');
  const [imgLoadVersion, setImgLoadVersion] = useState(0);
  const [isRegenLoading, setIsRegenLoading] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const imgCacheRef = useRef<HTMLImageElement | null>(null);
  const progressFillRef = useRef<HTMLDivElement>(null);

  // 오디오 — HTMLAudioElement
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [currentSubTime, setCurrentSubTime] = useState(0);
  // Google TTS용 구두점 가중치 기반 자막 타이밍
  const [googleTtsGroups, setGoogleTtsGroups] = useState<{ text: string; startTime: number; endTime: number }[] | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingElRef = useRef<HTMLAudioElement | null>(null); // 실제 재생 중인 element (preload와 별도)
  const raf = useRef<number>(0);
  const pausedAtRef = useRef<number>(0);    // 일시정지 위치 (초)
  const progressBarRef = useRef<HTMLDivElement>(null);
  const progressDragRef = useRef(false);
  const autoPlayNextRef = useRef(false); // 씬 종료 후 다음 씬 자동 재생 플래그
  const sceneListRef = useRef<HTMLDivElement>(null); // 씬 목록 스크롤용
  const togglePlayRef = useRef<() => void>(() => {}); // 자동 재생용 최신 핸들러 ref

  // 줌/패닝 — 기본 98.5% (양쪽 클리핑 방지)
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  const [useMeaningChunks, setUseMeaningChunks] = useState(true);

  // ── audioData가 바뀌면 즉시 HTMLAudioElement preload ──
  useEffect(() => {
    const ad = scenes[selectedIdx]?.audioData;
    if (!ad) { audioRef.current = null; return; }
    const el = new Audio();
    el.src = audioDataUrl(ad);
    el.preload = 'auto';
    el.load();
    audioRef.current = el;
  }, [selectedIdx, scenes[selectedIdx]?.audioData]); // eslint-disable-line

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
    // 1순위: ElevenLabs words 기반 (정확한 타임스탬프 — DELAY 없이 직접 사용)
    if (wordGroups && wordGroups.length > 0) {
      if (t < wordGroups[0].startTime) return narration; // 첫 단어 전: 전체 나레이션 표시
      const g = wordGroups.find(grp => t >= grp.startTime && t < grp.endTime);
      return g ? g.text : wordGroups[wordGroups.length - 1].text;
    }
    // 2순위: Google TTS 구두점 가중치 타이밍 (비례 추정 → 0.25s 딜레이로 보정)
    const DELAY = 0.6;
    const tAdj = Math.max(0, t - DELAY);
    if (googleTtsGroups && googleTtsGroups.length > 0) {
      if (tAdj < googleTtsGroups[0].startTime) return googleTtsGroups[0].text;
      const g = googleTtsGroups.find(grp => tAdj >= grp.startTime && tAdj < grp.endTime);
      return g ? g.text : googleTtsGroups[googleTtsGroups.length - 1].text;
    }
    // 3순위: AI 의미 단위 (meaningChunks)
    if (meaningChunks && meaningChunks.length > 0) {
      if (tAdj < meaningChunks[0].startTime) return meaningChunks[0].text;
      const g = meaningChunks.find((chunk: { startTime: number; endTime: number; text: string }) => tAdj >= chunk.startTime && tAdj < chunk.endTime);
      return g ? g.text : meaningChunks[meaningChunks.length - 1].text;
    }
    // Fallback: 나레이션을 maxChars 단위로 쪼개서 시간 균등 분배
    const dur = audioRef.current?.duration ?? 0;
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
      // 이미지 로드 즉시 캔버스에 직접 렌더 (redraw 비동기 타이밍 문제 우회)
      const canvas = canvasRef.current;
      if (canvas) renderSubtitleOnCanvas(canvas, img, narration, subConfig);
      setImgLoadVersion(v => v + 1); // re-render 트리거 (자막 설정 반영용)
    };
    img.src = `data:image/jpeg;base64,${scene.imageData}`;
  }, [scene?.imageData, selectedIdx]); // eslint-disable-line

  // ── 씬 변경 시 Google TTS 그룹 초기화 ──
  useEffect(() => { setGoogleTtsGroups(null); }, [selectedIdx]);

  // ── 씬 자동 재생: 이전 씬 종료 후 다음 씬으로 넘어왔을 때 ──
  useEffect(() => {
    if (!autoPlayNextRef.current) return;
    autoPlayNextRef.current = false;
    // 프리로드 effect가 먼저 실행된 뒤 재생 (50ms 대기)
    const t = setTimeout(() => togglePlayRef.current(), 50);
    return () => clearTimeout(t);
  }, [selectedIdx]); // eslint-disable-line

  // ── 씬 선택 시 목록 스크롤 ──
  useEffect(() => {
    if (!sceneListRef.current) return;
    const item = sceneListRef.current.children[selectedIdx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedIdx]);

  // ── audioData가 없어지면 재생 중인 오디오 즉시 정지 ──
  useEffect(() => {
    if (!scene?.audioData) {
      if (audioRef.current) { audioRef.current.pause(); }
      cancelAnimationFrame(raf.current);
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

    // 구두점 pause 가중치 (Gemini TTS 문장 pause ~0.6s 기준 캘리브레이션)
    const weights = chunks.map(c => {
      let w = c.length;
      w += (c.match(/[.!?。！？]/g) || []).length * 5;
      w += (c.match(/[,，、]/g) || []).length * 2;
      return Math.max(w, 2);
    });
    const total = weights.reduce((a, b) => a + b, 0);

    const result: { text: string; startTime: number; endTime: number }[] = [];
    let t = 0;
    for (let i = 0; i < chunks.length; i++) {
      const d = (weights[i] / total) * duration;
      result.push({
        text: chunks[i],
        startTime: t,
        endTime: t + d,
      });
      t += d;
    }
    return result;
  }

  // ── PCM16 raw → WAV Blob URL (data URL 대비 ~10배 빠름) ──
  function pcm16ToWavBlobUrl(b64: string): string {
    // Uint8Array.from + charCodeAt은 V8 네이티브 구현 → 루프보다 10x 빠름
    const pcmBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const wavByteLen = 44 + pcmBytes.length;
    const buf = new ArrayBuffer(wavByteLen);
    const view = new DataView(buf);
    const wav = new Uint8Array(buf);
    wav.set([82,73,70,70], 0);                       // "RIFF"
    view.setUint32(4, wavByteLen - 8, true);
    wav.set([87,65,86,69,102,109,116,32], 8);        // "WAVEfmt "
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);                     // PCM
    view.setUint16(22, 1, true);                     // mono
    view.setUint32(24, 24000, true);                 // 24kHz
    view.setUint32(28, 48000, true);                 // byteRate
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    wav.set([100,97,116,97], 36);                    // "data"
    view.setUint32(40, pcmBytes.length, true);
    wav.set(pcmBytes, 44);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  // ── magic byte로 컨테이너 감지 → Blob URL 또는 data URL 생성 ──
  function audioDataUrl(b64: string): string {
    const head = atob(b64.slice(0, 8));
    const isMp3 = head.charCodeAt(0) === 0xFF && (head.charCodeAt(1) & 0xE0) === 0xE0;
    const isId3 = head.slice(0,3) === 'ID3';
    const isOgg = head.slice(0,4) === 'OggS';
    const isRiff = head.slice(0,4) === 'RIFF';
    if (isMp3 || isId3) return 'data:audio/mpeg;base64,' + b64;
    if (isOgg) return 'data:audio/ogg;base64,' + b64;
    if (isRiff) return 'data:audio/wav;base64,' + b64;
    return pcm16ToWavBlobUrl(b64);  // PCM16 → Blob URL (fast)
  }

  // ── stopAudio: 완전 중지 + 위치 초기화 ──
  const stopAudio = useCallback(() => {
    const playing = playingElRef.current ?? audioRef.current;
    if (playing) {
      playing.pause();
      playing.currentTime = 0;
    }
    playingElRef.current = null;
    cancelAnimationFrame(raf.current);
    setIsPlaying(false);
    setAudioProgress(0);
    setCurrentSubTime(0);
    pausedAtRef.current = 0;
  }, []);

  // 씬 변경 → 완전 중지
  useEffect(() => { stopAudio(); }, [selectedIdx, stopAudio]);

  // 언마운트 정리
  useEffect(() => {
    return () => { stopAudio(); };
  }, [stopAudio]);

  // ── togglePlay: 재생/일시정지 (정지 위치에서 이어서 재생) ──
  const togglePlay = useCallback(async () => {
    // ── 일시정지: playingElRef(실제 재생 중인 element) 사용 ──
    if (isPlaying) {
      const playing = playingElRef.current;
      pausedAtRef.current = playing?.currentTime ?? pausedAtRef.current;
      playing?.pause();
      setIsPlaying(false);
      cancelAnimationFrame(raf.current);
      return;
    }

    // 음성 없으면 생성 후 다시 시도
    let audioData = scenes[selectedIdx]?.audioData ?? null;
    let el: HTMLAudioElement | null;
    if (!audioData) {
      if (!onGenerateAudio) return;
      setIsGeneratingAudio(true);
      setAudioError(null);
      try {
        audioData = await onGenerateAudio(selectedIdx);
        if (!audioData) setAudioError('음성 생성 실패 — 브라우저 콘솔에서 오류를 확인하세요');
      } catch (e: any) {
        setAudioError(`TTS 오류: ${e?.message || e}`);
      } finally {
        setIsGeneratingAudio(false);
      }
      if (!audioData) return;
      // preload effect가 이미 element를 만들었으면 재사용, 없으면 새로 생성
      if (!audioRef.current) {
        el = new Audio(audioDataUrl(audioData));
        el.preload = 'auto';
        audioRef.current = el;
      } else {
        el = audioRef.current;
      }
    } else {
      el = audioRef.current;
    }

    if (!el) return;

    // Google TTS (wordGroups/meaningChunks 없을 때) → 구두점 가중치 타이밍 생성
    if ((!wordGroups || wordGroups.length === 0) && (!scene?.subtitleData?.meaningChunks?.length)) {
      const dur = el.duration > 0 ? el.duration : (scene?.audioDuration ?? 0);
      if (dur > 0) setGoogleTtsGroups(createProportionalSubtitles(narration, dur, subConfig.maxCharsPerChunk ?? 15));
    }

    el.currentTime = pausedAtRef.current;
    // playingElRef에 실제 재생할 element 저장 (preload effect가 audioRef를 교체해도 문제 없음)
    playingElRef.current = el;
    // setIsPlaying을 먼저 true로 → 버튼이 즉시 반응 (로딩 없음)
    setIsPlaying(true);

    // 자막 타이밍 + 진행바 업데이트
    const tick = () => {
      if (!el || el.paused) return;
      const t = el.currentTime;
      const dur = el.duration || 1;
      setCurrentSubTime(t);
      setAudioProgress((t / dur) * 100);
      if (progressFillRef.current) progressFillRef.current.style.width = `${(t / dur) * 100}%`;
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);

    // 종료 이벤트
    el.onended = () => {
      setIsPlaying(false);
      setCurrentSubTime(0);
      setAudioProgress(0);
      pausedAtRef.current = 0;
      playingElRef.current = null;
      cancelAnimationFrame(raf.current);
      // 다음 씬 자동 재생
      setSelectedIdx(prev => {
        if (prev < scenes.length - 1) {
          autoPlayNextRef.current = true;
          return prev + 1;
        }
        return prev;
      });
    };

    el.play().catch((e: any) => {
      console.error('Audio error:', e);
      setIsPlaying(false);
      playingElRef.current = null;
      cancelAnimationFrame(raf.current);
    });
  }, [isPlaying, selectedIdx, scenes, onGenerateAudio, wordGroups, scene, narration, subConfig.maxCharsPerChunk]);

  // handlePlayPause가 재생성될 때마다 ref 동기화 (자동 재생 effect에서 사용)
  useEffect(() => { togglePlayRef.current = togglePlay; });

  // ── 프로그레스바 seek ──
  const seekToFraction = useCallback((fraction: number) => {
    const el = playingElRef.current ?? audioRef.current;
    if (!el || !el.duration) return;
    const t = fraction * el.duration;
    el.currentTime = t;
    pausedAtRef.current = t;
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

  // ── 스페이스바 단축키 (INPUT/TEXTAREA 제외 모든 상황에서 동작) ──
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault(); // 버튼 포커스 시 버튼 활성화 막고 재생/정지 처리
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

  const activeZoom = scene?.zoomEffect ?? subConfig.globalZoom ?? DEFAULT_ZOOM_EFFECT;

  // ── 캔버스 재렌더 ──
  // 줌 있을 때: currentSubTime / audioDuration으로 progress 계산 → 오디오와 완벽 동기
  // 줌 없을 때: 정적 렌더
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = imgCacheRef.current;

    if (activeZoom.type !== 'none' && img) {
      const dur = audioRef.current?.duration || scene?.audioDuration || 0;
      const progress = dur > 0 ? Math.min(currentSubTime / dur, 1) : 0;
      drawZoomPreview(ctx, img, canvas.width, canvas.height, progress, activeZoom);
      drawSubtitleText(ctx, displaySubtitleText, subConfig, canvas.width, canvas.height);
    } else {
      document.fonts.load(`${subConfig.fontWeight ?? 700} ${subConfig.fontSize}px ${subConfig.fontFamily}`)
        .finally(() => renderSubtitleOnCanvas(canvas, imgCacheRef.current, displaySubtitleText, subConfig));
    }
  }, [currentSubTime, displaySubtitleText, subConfig, activeZoom, scene?.audioDuration]); // eslint-disable-line

  useEffect(() => { redraw(); }, [redraw, imgLoadVersion]); // eslint-disable-line

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
              { label: '엑셀+이미지', onClick: () => exportAssetsToZip(scenes, `스토리보드_${new Date().toLocaleDateString('ko-KR')}`) },
              { label: 'SRT', onClick: async () => await downloadSrt(scenes, `subtitles_${Date.now()}.srt`) },
            ].map(btn => (
              <button key={btn.label} onClick={btn.onClick}
                className="flex-1 py-2 rounded-lg bg-blue-600/20 border border-blue-500/60 text-blue-200 font-bold text-xs hover:bg-blue-600/35 hover:border-blue-400/80 transition-all shadow-[0_0_10px_rgba(59,130,246,0.3)]">
                {btn.label}
              </button>
            ))}
          </div>
          {/* 이미지 무빙 효과 (전역 + 씬별 개별) */}
          <ZoomPanel
            subConfig={subConfig}
            onSubConfigChange={onSubConfigChange}
            selectedIdx={selectedIdx}
            sceneZoom={scene?.zoomEffect}
            onSceneZoomChange={onSceneZoomChange ? (zoom) => onSceneZoomChange(selectedIdx, zoom) : undefined}
          />
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
          style={aspectRatio === '9:16'
            ? { aspectRatio: '9/16', width: '40%', maxWidth: '40%', margin: '0 auto', flexShrink: 0 }
            : { aspectRatio: '16/9', width: '72%', maxWidth: '72%', margin: '0 auto', flexShrink: 0 }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
        >
          <div style={{ transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`, transformOrigin: 'center center', width: '100%', height: '100%' }}>
            <canvas ref={canvasRef} width={aspectRatio === '9:16' ? 720 : 1280} height={aspectRatio === '9:16' ? 1280 : 720} className="w-full h-full" />
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
            disabled={isGeneratingAudio}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-all shrink-0 ${
              isGeneratingAudio
                ? 'bg-slate-800 text-slate-400 cursor-wait'
                : isPlaying
                  ? 'bg-blue-500 text-white shadow-[0_0_10px_rgba(59,130,246,0.5)]'
                  : 'bg-blue-600/25 border border-blue-500/60 hover:bg-blue-600/45 text-blue-200'
            }`}
          >
            {isGeneratingAudio
              ? <div className="w-3.5 h-3.5 border-2 border-slate-400/40 border-t-slate-300 rounded-full animate-spin" />
              : isPlaying
                ? <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="4" height="10" rx="1"/><rect x="7" y="1" width="4" height="10" rx="1"/></svg>
                : <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" style={{marginLeft:'1px'}}><polygon points="2,1 11,6 2,11"/></svg>
            }
          </button>
          <div
            ref={progressBarRef}
            className="flex-1 relative h-3 bg-slate-700 rounded-full overflow-hidden cursor-pointer"
            onMouseDown={(e: React.MouseEvent<HTMLDivElement>) => {
              if (!hasAudio || !audioRef.current?.duration) return;
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
                ? `${currentSubTime > 0 ? currentSubTime.toFixed(1) : pausedAtRef.current.toFixed(1)}s / ${(audioRef.current?.duration ?? scene?.audioDuration ?? 0).toFixed(1)}s`
                : scene?.audioDuration ? `${scene.audioDuration.toFixed(1)}s` : '●'
              : '—'}
          </span>
        </div>

        {/* TTS 에러 메시지 */}
        {audioError && (
          <div className="mx-4 mb-1 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/40 text-red-300 text-[11px] flex items-start gap-2">
            <span className="shrink-0">⚠️</span>
            <span>{audioError}</span>
            <button onClick={() => setAudioError(null)} className="ml-auto shrink-0 text-red-400 hover:text-red-200">✕</button>
          </div>
        )}

        {/* 영상 변환 */}
        {onGenerateAnimation && (
          <div className="px-4 pt-1 pb-2">
            <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">영상 변환</label>
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                value={animationPrompt}
                onChange={e => setAnimationPrompt(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !animatingIndices?.has(selectedIdx)) {
                    onGenerateAnimation(selectedIdx, animationPrompt.trim() || undefined);
                  }
                }}
                disabled={animatingIndices?.has(selectedIdx)}
                placeholder="움직임 지시 (비워두면 AI 자동 생성)"
                className="flex-1 bg-slate-800/80 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 disabled:opacity-50"
              />
              <button
                onClick={() => onGenerateAnimation(selectedIdx, animationPrompt.trim() || undefined)}
                disabled={animatingIndices?.has(selectedIdx)}
                className="px-3 py-1.5 rounded-lg text-sm font-bold bg-purple-600/30 border border-purple-500/50 text-purple-300 hover:bg-purple-600/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 shrink-0"
              >
                {animatingIndices?.has(selectedIdx)
                  ? <><div className="w-3.5 h-3.5 border-2 border-purple-300/40 border-t-purple-300 rounded-full animate-spin" />변환 중...</>
                  : '🎬 변환'}
              </button>
            </div>
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
      <div ref={sceneListRef} className="flex-1 overflow-y-auto py-2 px-2">
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
            <div className="flex flex-col gap-1 shrink-0">
              {s.imageData && onSelectThumbnail && (
                <button
                  onClick={() => onSelectThumbnail(s.imageData!)}
                  className="p-1.5 rounded-lg bg-yellow-500/20 hover:bg-yellow-500/40 border border-yellow-500/30 text-yellow-400 transition-all"
                  title="썸네일로 선택"
                >⭐</button>
              )}
              {onSceneZoomChange && s.zoomEffect != null && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-amber-600/30 text-amber-300 border border-amber-500/40 text-center leading-tight" title="씬별 무빙 적용 중">
                  {ZOOM_TYPE_LABELS[s.zoomEffect.type]}
                </span>
              )}
              {onDeleteScene && (
                <button
                  onClick={() => {
                    if (window.confirm(`씬 ${i + 1}을 삭제할까요?`)) {
                      if (selectedIdx >= i && selectedIdx > 0) setSelectedIdx(selectedIdx - 1);
                      onDeleteScene(i);
                    }
                  }}
                  className="p-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/40 border border-red-500/30 text-red-400 transition-all text-xs font-bold"
                  title="씬 삭제"
                >✕</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
    </div>
  );
};

export default SubtitleEditor;
