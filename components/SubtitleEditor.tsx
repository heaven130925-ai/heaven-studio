/**
 * SubtitleEditor — Vrew 스타일 자막 에디터
 * - 왼쪽: Canvas 미리보기 (자막 실시간 싱크)
 * - 오른쪽: 씬 목록
 * - 하단: 자막 스타일 컨트롤
 */

import React, { useRef, useEffect, useLayoutEffect, useCallback, useState, useMemo } from 'react';
import { GeneratedAsset, SubtitleConfig, SUBTITLE_FONTS, ZoomEffect, ZoomType, ZoomOrigin, DEFAULT_ZOOM_EFFECT } from '../types';
import { downloadProjectZip, downloadMediaZip } from '../utils/csvHelper';
import { downloadSrt } from '../services/srtService';
import { exportAssetsToZip } from '../services/exportService';
import { transcribeAudioForScenes } from '../services/geminiService';
import StudioChat from './StudioChat';

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
  onVoiceUpload?: (audioDataPerScene: (string | null)[]) => void;
  aspectRatio?: '16:9' | '9:16';
  onChatSetSubtitleChars?: (maxChars: number) => void;  // AI 챗 → 자막 글자수 변경
  onChatGenerateVideo?: (indices: number[]) => void;     // AI 챗 → 영상 생성
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

  ctx.font = `${config.fontWeight ?? 700} ${fontSize}px '${config.fontFamily}', 'Noto Sans KR', '맑은 고딕', '나눔고딕', sans-serif`;
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
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (cachedImg) {
    const imgAspect = cachedImg.width / cachedImg.height;
    const canvasAspect = W / H;
    let drawW = W, drawH = H, drawX = 0, drawY = 0;
    if (imgAspect > canvasAspect) { drawH = W / imgAspect; drawY = (H - drawH) / 2; }
    else { drawW = H * imgAspect; drawX = (W - drawW) / 2; }
    ctx.drawImage(cachedImg, drawX, drawY, drawW, drawH);
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
  // 강도를 훨씬 크게: intensity 10 → 실제 30%, intensity 20 → 실제 60%
  const factor = (zoom.intensity / 100) * 3;
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

const SubtitleEditor: React.FC<Props> = ({ scenes, subConfig, onSubConfigChange, onImageEditCommand, onGenerateAnimation, animatingIndices, onExportVideo, isExporting, onSelectThumbnail, onGenerateAudio, onDeleteScene, onSceneZoomChange, onVoiceUpload, aspectRatio = '16:9', onChatSetSubtitleChars, onChatGenerateVideo }) => {
  const [showChat, setShowChat] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [videoLoadError, setVideoLoadError] = useState(false);
  const [editCmd, setEditCmd] = useState('');
  const [animationPrompt, setAnimationPrompt] = useState('');
  const [imgLoadVersion, setImgLoadVersion] = useState(0);
  const [isRegenLoading, setIsRegenLoading] = useState(false);
  // ── 일괄 편집 모드 ──
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<number>>(new Set());
  const [batchCmd, setBatchCmd] = useState('');
  const [isBatchLoading, setIsBatchLoading] = useState(false);
  const [batchProgress, setBatchProgress] = useState('');
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  // ── 내 목소리 업로드 ──
  const [isVoiceUploading, setIsVoiceUploading] = useState(false);
  const [voiceUploadStatus, setVoiceUploadStatus] = useState('');
  const voiceFileInputRef = useRef<HTMLInputElement>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [isBatchDragSelect, setIsBatchDragSelect] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const overlayVideoRef = useRef<HTMLVideoElement>(null);
  const imgCacheRef = useRef<HTMLImageElement | null>(null);
  const progressFillRef = useRef<HTMLDivElement>(null);

  // 오디오 — HTMLAudioElement
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [currentSubTime, setCurrentSubTime] = useState(0);
  const currentSubTimeRef = useRef(0); // rAF에서 직접 읽기용 (React state 비동기 우회)
  // 단일 오디오 엘리먼트 ref (preload와 playing 통합 — playingElRef 이중화 제거)
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  // play() 호출마다 증가 — 이전 세션의 stale tick 루프 자동 중단
  const playSessionRef = useRef(0);
  const raf = useRef<number>(0);
  const pausedAtRef = useRef<number>(0);    // 일시정지 위치 (초)
  const drawCanvasRef = useRef<(t: number) => void>(() => {}); // rAF에서 캔버스 직접 드로잉
  const progressBarRef = useRef<HTMLDivElement>(null);
  const progressDragRef = useRef(false);
  const autoPlayNextRef = useRef(false); // 씬 종료 후 다음 씬 자동 재생 플래그
  const sceneListRef = useRef<HTMLDivElement>(null); // 씬 목록 스크롤용
  const togglePlayRef = useRef<() => void>(() => {}); // 자동 재생용 최신 핸들러 ref
  const selectedIdxRef = useRef(0);         // rAF tick에서 stale closure 방지
  const scenesRef = useRef(scenes);  // rAF tick에서 최신 scenes 참조

  // 줌/패닝 — 기본 98.5% (양쪽 클리핑 방지)
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);


  // ── 씬 전환 시 per-scene 오디오 교체 ──
  useEffect(() => {
    const ad = scenes[selectedIdx]?.audioData;
    if (!ad) return; // 오디오-퍼스트는 위 effect에서 처리
    // Blob URL 사용: data URL보다 훨씬 빠르게 로드 (base64 파싱 없음)
    const bytes = Uint8Array.from(atob(ad), c => c.charCodeAt(0));
    const b0 = bytes[0], b1 = bytes[1], b2 = bytes[2], b3 = bytes[3];
    let mime = 'audio/mpeg'; // 기본값 (MP3 가정)
    if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46) mime = 'audio/wav'; // RIFF
    else if (b0 === 0x4F && b1 === 0x67 && b2 === 0x67 && b3 === 0x53) mime = 'audio/ogg'; // OggS
    else if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) mime = 'audio/mp4'; // ftyp (M4A/AAC)
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const el = new Audio();
    el.src = blobUrl;
    el.preload = 'auto';
    el.load();
    audioElRef.current = el;
    console.log(`[Audio] 씬 ${selectedIdx + 1} 로드: ${mime}, ${(bytes.length / 1024).toFixed(0)}KB`);
    return () => URL.revokeObjectURL(blobUrl);
  }, [selectedIdx, scenes[selectedIdx]?.audioData]); // eslint-disable-line

  const set = (partial: Partial<SubtitleConfig>) => onSubConfigChange({ ...subConfig, ...partial });
  const scene = scenes[selectedIdx];
  const narration = scene?.narration ?? '';
  const hasAudio = !!(scene?.audioData);

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

  // ── 자막 텍스트 계산 (2가지 경로) ──
  // 1순위: ElevenLabs words 타임스탬프 (정확한 싱크)
  // 2순위: 시간 균등 분배 폴백 (Gemini TTS / 타임스탬프 없을 때)
  const getSubtitleText = useCallback((t: number): string => {
    // 1순위: ElevenLabs words — 실제 타임스탬프 기반 (딜레이 없음)
    if (wordGroups && wordGroups.length > 0) {
      if (t < wordGroups[0].startTime) return narration;
      const g = wordGroups.find(grp => t >= grp.startTime && t < grp.endTime);
      return g ? g.text : wordGroups[wordGroups.length - 1].text;
    }
    // 2순위: 균등 분배 폴백 (Gemini TTS — WAV 앞 무음 ~0.3s 보정)
    const tAdj = Math.max(0, t - 0.3);
    const dur = audioElRef.current?.duration ?? 0;
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
    return textChunks[Math.min(Math.floor(tAdj / (dur / textChunks.length)), textChunks.length - 1)] || narration;
  }, [wordGroups, narration, subConfig.maxCharsPerChunk]);

  // 재생 중이거나 currentSubTime > 0 이면 자막 표시, 그 외엔 나레이션
  const displaySubtitleText = (isPlaying || currentSubTime > 0)
    ? getSubtitleText(currentSubTime)
    : narration;

  // ── 이미지 사전 로드 ──
  useEffect(() => {
    if (!scene?.imageData) {
      imgCacheRef.current = null;
      const canvas = canvasRef.current;
      if (canvas) { const c = canvas.getContext('2d'); if (c) { c.fillStyle = '#000'; c.fillRect(0, 0, canvas.width, canvas.height); } }
      return;
    }
    // 이전 이미지는 새 이미지 로드 완료 전까지 유지 (검정 flash 방지)
    const img = new Image();
    img.onload = () => {
      imgCacheRef.current = img; // 로드 완료 후에만 교체
      const canvas = canvasRef.current;
      if (canvas) renderSubtitleOnCanvas(canvas, img, narration, subConfig);
      setImgLoadVersion(v => v + 1);
    };
    // 브라우저 캐시에 있으면 onload가 비동기로도 발화 안 할 수 있음 → src 먼저 세팅
    img.src = `data:image/jpeg;base64,${scene.imageData}`;
    // 이미 캐시된 경우 complete=true → 수동으로 onload 트리거
    if (img.complete) {
      imgCacheRef.current = img;
      const canvas = canvasRef.current;
      if (canvas) renderSubtitleOnCanvas(canvas, img, narration, subConfig);
      setImgLoadVersion(v => v + 1);
    }
  }, [scene?.imageData, selectedIdx]); // eslint-disable-line

  // ── 씬 변경 시 비디오 에러 리셋 ──
  useEffect(() => { setVideoLoadError(false); }, [selectedIdx]);

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
      if (audioElRef.current) { audioElRef.current.pause(); }
      playSessionRef.current++;
      cancelAnimationFrame(raf.current);
      setIsPlaying(false);
      setCurrentSubTime(0);
      setAudioProgress(0);
      if (progressFillRef.current) progressFillRef.current.style.width = '0%';
      pausedAtRef.current = 0;
    }
  }, [scene?.audioData]); // eslint-disable-line

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
    // 최소 12바이트 디코딩으로 magic byte 확인
    let head = '';
    try { head = atob(b64.slice(0, 16)); } catch { head = ''; }
    const b0 = head.charCodeAt(0), b1 = head.charCodeAt(1);
    const isMp3Sync = b0 === 0xFF && (b1 & 0xE0) === 0xE0;
    const isId3 = head.slice(0, 3) === 'ID3';
    const isOgg = head.slice(0, 4) === 'OggS';
    const isRiff = head.slice(0, 4) === 'RIFF';
    const isM4a = head.slice(4, 8) === 'ftyp';  // MP4/M4A
    const isAac = b0 === 0xFF && (b1 & 0xF6) === 0xF0; // AAC ADTS
    if (isMp3Sync || isId3) return 'data:audio/mpeg;base64,' + b64;
    if (isOgg) return 'data:audio/ogg;base64,' + b64;
    if (isRiff) return 'data:audio/wav;base64,' + b64;
    if (isM4a) return 'data:audio/mp4;base64,' + b64;
    if (isAac) return 'data:audio/aac;base64,' + b64;
    // 알 수 없는 포맷 → Blob URL로 그대로 전달 (브라우저에 맡김)
    // PCM16 raw로 가정하지 않음 — 업로드 파일이 PCM raw일 가능성 거의 없음
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes]));
  }

  // ── stopAudio: 완전 중지 + 위치 초기화 ──
  const stopAudio = useCallback(() => {
    const el = audioElRef.current;
    if (el) { el.pause(); el.currentTime = 0; }
    playSessionRef.current++;   // 실행 중인 tick 루프 모두 무효화
    cancelAnimationFrame(raf.current);
    setIsPlaying(false);
    setAudioProgress(0);
    setCurrentSubTime(0);
    pausedAtRef.current = 0;
  }, []);

  // ── 내 목소리 업로드 핸들러 ──────────────────────────────────────────
  const handleVoiceUpload = useCallback(async (file: File) => {
    if (!onVoiceUpload) return;
    setIsVoiceUploading(true);
    setVoiceUploadStatus('파일 읽는 중...');
    try {
      const arrayBuffer = await file.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < uint8.length; i += 65536) binary += String.fromCharCode(...uint8.subarray(i, i + 65536));
      const audioBase64 = btoa(binary);
      const mimeType = file.type || 'audio/mpeg';

      // 1) Web Audio API로 PCM 디코딩 (경계 탐색용)
      const audioCtx = new AudioContext();
      const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      const pcm = decoded.getChannelData(0);
      const sr = decoded.sampleRate;
      const totalDuration = decoded.duration;

      // RMS 계산 헬퍼: 구간 내 평균 에너지
      const frameRms = (startS: number, endS: number) => {
        const s = Math.max(0, Math.floor(startS * sr));
        const e = Math.min(pcm.length, Math.floor(endS * sr));
        if (e <= s) return 0;
        let sum = 0;
        for (let k = s; k < e; k++) sum += pcm[k] * pcm[k];
        return Math.sqrt(sum / (e - s));
      };

      // 경계 부근에서 가장 조용한 10ms 슬롯을 찾아 반환
      const findQuietestPoint = (centerSec: number, searchRadius: number): number => {
        const SLOT = 0.01; // 10ms
        let minRms = Infinity;
        let best = centerSec;
        for (let t = centerSec - searchRadius; t <= centerSec + searchRadius; t += SLOT) {
          const rms = frameRms(t, t + SLOT);
          if (rms < minRms) { minRms = rms; best = t; }
        }
        return Math.max(0, Math.min(totalDuration, best));
      };

      // 2) Gemini로 씬별 타임스탬프 추출
      setVoiceUploadStatus('Gemini가 음성 분석 중...');
      const narrations = scenes.map(s => s.narration || '');
      const timestamps = await transcribeAudioForScenes(audioBase64, mimeType, narrations);

      // 3) 씬 경계: endSec[i] ~ startSec[i+1] 갭 전체에서 가장 조용한 지점 탐색
      const cutPoints: number[] = [];
      for (let i = 0; i < timestamps.length - 1; i++) {
        const rawEnd = timestamps[i].endSec > 0 ? timestamps[i].endSec : -1;
        const rawNext = timestamps[i + 1].startSec > 0 ? timestamps[i + 1].startSec : -1;
        if (rawEnd < 0 && rawNext < 0) { cutPoints.push(-1); continue; }
        // 갭 구간: endSec - 0.2초 ~ startSec + 0.2초 (Gemini 오차 흡수)
        const searchFrom = Math.max(0, (rawEnd > 0 ? rawEnd : rawNext) - 0.2);
        const searchTo = Math.min(totalDuration, (rawNext > 0 ? rawNext : rawEnd) + 0.2);
        cutPoints.push(findQuietestPoint((searchFrom + searchTo) / 2, (searchTo - searchFrom) / 2));
      }

      // 4) FFmpeg로 씬별 추출
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const { fetchFile } = await import('@ffmpeg/util');
      const ffmpeg = new FFmpeg();
      await ffmpeg.load();
      await ffmpeg.writeFile('input.mp3', await fetchFile(file));

      const result: (string | null)[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        const { startSec } = timestamps[i];
        if (startSec < 0) {
          setVoiceUploadStatus(`씬 ${i + 1} 매칭 실패 — 건너뜀`);
          result.push(null);
          continue;
        }
        setVoiceUploadStatus(`씬 ${i + 1}/${timestamps.length} 추출 중...`);

        // 시작: 이전 컷포인트 or Gemini startSec
        const clipStart = i === 0
          ? Math.max(0, startSec - 0.05)
          : (cutPoints[i - 1] > 0 ? cutPoints[i - 1] : Math.max(0, startSec - 0.05));

        // 끝: 현재 컷포인트 or 전체 끝
        const clipEnd = i < cutPoints.length && cutPoints[i] > 0
          ? cutPoints[i]
          : totalDuration;

        if (clipEnd <= clipStart) { result.push(null); continue; }

        // 20ms 페이드인/아웃 → 임의 지점 컷 시 클릭/팝 노이즈 완전 제거
        const fadeDur = 0.02;
        const clipDur = clipEnd - clipStart;
        const fadeOutSt = Math.max(0, clipDur - fadeDur);
        await ffmpeg.exec([
          '-ss', String(clipStart), '-to', String(clipEnd), '-i', 'input.mp3',
          '-af', `afade=t=in:st=0:d=${fadeDur},afade=t=out:st=${fadeOutSt}:d=${fadeDur}`,
          '-acodec', 'pcm_s16le', '-ar', '24000', '-ac', '1', `out${i}.wav`
        ]);
        const data = await ffmpeg.readFile(`out${i}.wav`);
        const buf = data instanceof Uint8Array ? data : new TextEncoder().encode(data as string);
        let b = '';
        for (let j = 0; j < buf.length; j += 65536) b += String.fromCharCode(...buf.subarray(j, j + 65536));
        result.push(btoa(b));
      }

      setVoiceUploadStatus(`완료! ${result.filter(Boolean).length}개 씬 적용됨`);
      onVoiceUpload(result);
      setTimeout(() => setVoiceUploadStatus(''), 3000);
    } catch (e: any) {
      setVoiceUploadStatus(`오류: ${e?.message || String(e)}`);
      setTimeout(() => setVoiceUploadStatus(''), 5000);
    } finally {
      setIsVoiceUploading(false);
    }
  }, [scenes, onVoiceUpload]);

  // ── 씬 카드 오디오 드래그앤드롭 핸들러 ──────────────────────────────
  const handleSceneAudioDrop = useCallback(async (sceneIdx: number, file: File) => {
    if (!onVoiceUpload) return;
    if (!file.type.startsWith('audio/')) return;
    setDragOverIdx(null);

    // 일괄편집 모드에서 선택된 씬이 2개 이상이고 드롭 위치가 선택 안에 있으면 → 다중 씬 처리
    const targetIndices: number[] = (batchMode && batchSelected.size > 1 && batchSelected.has(sceneIdx))
      ? Array.from(batchSelected as Set<number>).sort((a: number, b: number) => a - b)
      : [sceneIdx];

    try {
      const arrayBuffer = await file.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < uint8.length; i += 65536) {
        binary += String.fromCharCode(...uint8.subarray(i, i + 65536));
      }
      const audioBase64 = btoa(binary);
      const mimeType = file.type || 'audio/mpeg';

      if (targetIndices.length === 1) {
        // 단일 씬 — 그대로 적용
        const result: (string | null)[] = Array(scenes.length).fill(null);
        result[targetIndices[0]] = audioBase64;
        onVoiceUpload(result);
      } else {
        // 다중 씬 — Gemini 타임스탬프 + FFmpeg 분리
        setIsVoiceUploading(true);
        setVoiceUploadStatus('Gemini 음성 분석 중...');
        const narrations = targetIndices.map(idx => scenes[idx].narration || '');
        const timestamps = await transcribeAudioForScenes(audioBase64, mimeType, narrations);

        const { FFmpeg } = await import('@ffmpeg/ffmpeg');
        const { fetchFile } = await import('@ffmpeg/util');
        const ffmpeg = new FFmpeg();
        await ffmpeg.load();
        await ffmpeg.writeFile('input.mp3', await fetchFile(file));

        const result: (string | null)[] = Array(scenes.length).fill(null);
        for (let j = 0; j < targetIndices.length; j++) {
          const { startSec, endSec } = timestamps[j] as { startSec: number; endSec: number };
          if (startSec < 0 || endSec <= startSec) { result[targetIndices[j]] = null; continue; }
          setVoiceUploadStatus(`씬 ${targetIndices[j] + 1} 추출 중... (${j + 1}/${targetIndices.length})`);
          const safeStartJ = Math.max(0, startSec);
          const nextSceneStartJ = j + 1 < timestamps.length && (timestamps[j + 1] as any).startSec > 0
            ? (timestamps[j + 1] as any).startSec
            : null;
          const safeEndJ = nextSceneStartJ !== null
            ? Math.min(endSec + 0.1, nextSceneStartJ - 0.05)
            : endSec + 0.1;
          await ffmpeg.exec(['-i', 'input.mp3', '-ss', String(safeStartJ), '-to', String(safeEndJ),
            '-acodec', 'pcm_s16le', '-ar', '24000', '-ac', '1', `out${j}.wav`]);
          const data = await ffmpeg.readFile(`out${j}.wav`);
          const buf = data instanceof Uint8Array ? data : new TextEncoder().encode(data as string);
          let b = '';
          for (let k = 0; k < buf.length; k += 65536) b += String.fromCharCode(...buf.subarray(k, k + 65536));
          result[targetIndices[j]] = btoa(b);
        }
        setVoiceUploadStatus(`완료! ${result.filter(Boolean).length}개 씬 적용됨`);
        onVoiceUpload(result);
        setTimeout(() => setVoiceUploadStatus(''), 3000);
      }
    } catch (e: any) {
      setVoiceUploadStatus(`오류: ${e?.message || String(e)}`);
      setTimeout(() => setVoiceUploadStatus(''), 4000);
      console.error('[SceneAudioDrop]', e);
    } finally {
      setIsVoiceUploading(false);
    }
  }, [scenes, onVoiceUpload, batchMode, batchSelected]);

  // 배치 드래그 선택 종료 (전역 mouseup)
  useEffect(() => {
    const onMouseUp = () => setIsBatchDragSelect(false);
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, []);

  // selectedIdxRef 동기화
  useEffect(() => { selectedIdxRef.current = selectedIdx; }, [selectedIdx]);
  // scenesRef: 렌더마다 최신화 (hook 내 직접 할당 가능)
  scenesRef.current = scenes;

  // 씬 변경 → 완전 중지
  useEffect(() => { stopAudio(); }, [selectedIdx, stopAudio]);

  // 오디오 재생/정지에 영상 오버레이 연동 (currentTime 리셋 금지 — 싱크 유지)
  useEffect(() => {
    const vid = overlayVideoRef.current;
    if (!vid) return;
    if (isPlaying) {
      vid.play().catch(() => {});
    } else {
      vid.pause();
      // ✱ currentTime 리셋 하지 않음 — tick이 싱크 관리
    }
  }, [isPlaying]);

  // 언마운트 정리
  useEffect(() => {
    return () => { stopAudio(); };
  }, [stopAudio]);

  // ── togglePlay: 재생/일시정지 ──
  // canplay/seeked 대기 제거 → el.play() 즉시 호출 (브라우저가 버퍼링 관리)
  const togglePlay = useCallback(async () => {
    // ── 일시정지 ──
    if (isPlaying) {
      const el = audioElRef.current;
      if (el) { pausedAtRef.current = el.currentTime; el.pause(); }
      playSessionRef.current++;   // 이 세션의 tick 루프 중단
      cancelAnimationFrame(raf.current);
      setIsPlaying(false);
      return;
    }

    // 음성 없으면 TTS 생성
    let audioData = scenes[selectedIdx]?.audioData ?? null;
    if (!audioData) {
      if (!onGenerateAudio) return;
      setIsGeneratingAudio(true);
      setAudioError(null);
      try {
        audioData = await onGenerateAudio(selectedIdx);
        if (!audioData) { setAudioError('음성 생성 실패 — 브라우저 콘솔에서 오류를 확인하세요'); return; }
      } catch (e: any) {
        setAudioError(`TTS 오류: ${e?.message || e}`);
        return;
      } finally {
        setIsGeneratingAudio(false);
      }
      // TTS 생성 완료 → 즉시 Blob URL로 오디오 엘리먼트 생성
      const bytes = Uint8Array.from(atob(audioData), c => c.charCodeAt(0));
      const b0 = bytes[0], b1 = bytes[1], b2 = bytes[2], b3 = bytes[3];
      let mime = 'audio/mpeg';
      if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46) mime = 'audio/wav';
      else if (b0 === 0x4F && b1 === 0x67 && b2 === 0x67 && b3 === 0x53) mime = 'audio/ogg';
      else if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) mime = 'audio/mp4';
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      const newEl = new Audio(blobUrl);
      newEl.preload = 'auto';
      audioElRef.current = newEl;
    }

    const el = audioElRef.current;
    if (!el) { console.warn('[Audio] el is null — 재생 불가'); return; }

    const targetTime = pausedAtRef.current;

    // 영상 오버레이 동기화
    const vid = overlayVideoRef.current;
    if (vid && Math.abs(vid.currentTime - targetTime) > 0.1) {
      vid.currentTime = targetTime;
    }

    // 세션 ID 생성 → 이 세션의 tick만 유효
    const session = ++playSessionRef.current;

    // seek 후 즉시 play (canplay/seeked 이벤트 대기 없음 — 브라우저가 관리)
    if (Math.abs(el.currentTime - targetTime) > 0.05) {
      el.currentTime = targetTime;
    }

    setIsPlaying(true);

    // ── tick: rAF 직접 드로잉 (React 리렌더 없음) ──
    const tick = () => {
      if (playSessionRef.current !== session) return; // 세션 무효 시 종료
      if (el.paused && !el.ended) return; // 버퍼링 중 — 다음 프레임 대기 안 함 (ended 시 onended가 처리)
      const t = el.currentTime;
      const sceneDur = el.duration || 1;
      if (progressFillRef.current) progressFillRef.current.style.width = `${Math.min((t / sceneDur) * 100, 100)}%`;
      drawCanvasRef.current(t);
      currentSubTimeRef.current = t;
      setCurrentSubTime(prev => (Math.abs(prev - t) > 0.05 ? t : prev));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);

    // 종료 이벤트
    el.onended = () => {
      if (playSessionRef.current !== session) return;
      playSessionRef.current++;
      cancelAnimationFrame(raf.current);
      setIsPlaying(false);
      setCurrentSubTime(0);
      setAudioProgress(0);
      pausedAtRef.current = 0;
      // 다음 씬 자동 재생
      setSelectedIdx(prev => {
        if (prev < scenes.length - 1) { autoPlayNextRef.current = true; return prev + 1; }
        return prev;
      });
    };

    // 즉시 재생 시도 (canplay 대기 없음)
    el.play().catch((e: any) => {
      if (playSessionRef.current !== session) return;
      console.error('[Audio] play() 실패:', e);
      setIsPlaying(false);
      playSessionRef.current++;
      cancelAnimationFrame(raf.current);
    });
  }, [isPlaying, selectedIdx, scenes, onGenerateAudio]);

  // handlePlayPause가 재생성될 때마다 ref 동기화 (자동 재생 effect에서 사용)
  useEffect(() => { togglePlayRef.current = togglePlay; });

  // ── 프로그레스바 seek ──
  const seekToFraction = useCallback((fraction: number) => {
    const el = audioElRef.current;
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

  // ── 캔버스 드로잉 함수를 ref에 유지 (rAF에서 직접 호출) ──
  // 매 렌더마다 최신 값(subConfig, zoom, subtitle 등)을 ref에 반영
  const displaySubtitleTextRef = useRef(displaySubtitleText);
  const subConfigRef = useRef(subConfig);
  const activeZoomRef = useRef(activeZoom);
  const sceneDurationForZoom = scene?.audioDuration ?? 0;
  const audioDurationRef = useRef(sceneDurationForZoom);
  // getSubtitleText를 ref에 올려서 rAF에서 state 지연 없이 t 기준 직접 계산
  const getSubtitleTextRef = useRef(getSubtitleText);
  useEffect(() => {
    displaySubtitleTextRef.current = displaySubtitleText;
    subConfigRef.current = subConfig;
    activeZoomRef.current = activeZoom;
    audioDurationRef.current = sceneDurationForZoom;
    getSubtitleTextRef.current = getSubtitleText;
  });

  // drawCanvasRef 최신화 (rAF tick에서 호출)
  useEffect(() => {
    drawCanvasRef.current = (t: number) => {
      // ── VIDEO SYNC: 오디오 currentTime 기준으로 영상 드리프트 보정 ──
      const vid = overlayVideoRef.current;
      if (vid && !vid.paused && !vid.seeking && vid.readyState >= 2) {
        const drift = vid.currentTime - t;
        if (Math.abs(drift) > 0.15) {
          vid.currentTime = t;
        }
      }

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const img = imgCacheRef.current;
      const zoom = activeZoomRef.current;
      // ★ React state 지연 제거: t를 직접 넘겨 자막 계산 (50ms+ 딜레이 → 0)
      const subtitle = getSubtitleTextRef.current(t);
      const cfg = subConfigRef.current;
      if (zoom.type !== 'none' && img) {
        // 씬 단위 duration 우선 (오디오-퍼스트는 전체 오디오 길이 사용 시 줌 매우 느려짐)
        const sceneDur = audioDurationRef.current ?? 0;
        const rawDur = audioElRef.current?.duration;
        const dur = (sceneDur > 0) ? sceneDur : ((rawDur && !isNaN(rawDur) && rawDur > 0) ? rawDur : 0);
        const progress = dur > 0 ? Math.min(t / dur, 1) : 0;
        drawZoomPreview(ctx, img, canvas.width, canvas.height, progress, zoom);
        drawSubtitleText(ctx, subtitle, cfg, canvas.width, canvas.height);
      } else {
        renderSubtitleOnCanvas(canvas, img, subtitle, cfg);
      }
    };
  });

  // 정지 상태 / 이미지 교체 시 1회 드로잉
  const redraw = useCallback(() => {
    drawCanvasRef.current(currentSubTimeRef.current);
  }, []); // eslint-disable-line

  useEffect(() => { redraw(); }, [redraw, imgLoadVersion, displaySubtitleText, subConfig, activeZoom]); // eslint-disable-line

  // 이미지 로드 완료 직후 동기 렌더 (페인트 전 보장)
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const img = imgCacheRef.current;
    if (!canvas || !img) return;
    renderSubtitleOnCanvas(canvas, img, narration, subConfig);
  }, [imgLoadVersion]); // eslint-disable-line

  return (
    <div className="flex flex-col h-full overflow-hidden justify-center bg-slate-950">
    <div className="flex flex-1 overflow-hidden min-w-0" style={{ width: '100%', maxWidth: '1600px', margin: '0 auto' }}>
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
          className="relative overflow-hidden cursor-grab active:cursor-grabbing select-none"
          style={{
            ...(aspectRatio === '9:16'
              ? { aspectRatio: '9/16', width: '40%', maxWidth: '40%', margin: '0 auto', flexShrink: 0 }
              : { aspectRatio: '16/9', width: '72%', maxWidth: '72%', margin: '0 auto', flexShrink: 0 }),
            backgroundColor: '#000',
          }}
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
          {scene?.videoData && !videoLoadError && (
            <video
              ref={overlayVideoRef}
              key={scene.videoData}
              src={scene.videoData}
              muted
              playsInline
              onError={() => setVideoLoadError(true)}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 20, background: '#000' }}
            />
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
              if (!hasAudio || !audioElRef.current?.duration) return;
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
                ? `${currentSubTime > 0 ? currentSubTime.toFixed(1) : pausedAtRef.current.toFixed(1)}s / ${(audioElRef.current?.duration ?? scene?.audioDuration ?? 0).toFixed(1)}s`
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

        {/* 영상 변환 */}
        {onGenerateAnimation && (
          <div className="px-4 pt-0 pb-2">
            <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">🎬 영상 변환</label>
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
                  : '변환'}
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

        </div>
      </div>

      {/* ─── 오른쪽: 씬 목록 + AI 챗 ─── */}
      <div className="flex flex-col flex-1 overflow-hidden">

        {/* AI 챗 토글 버튼 */}
        <div className="shrink-0 flex items-center justify-end px-2 pt-1.5 pb-0.5 border-b border-white/[0.07]">
          <button
            onClick={() => setShowChat(v => !v)}
            title="AI 편집 챗봇"
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all border ${showChat ? 'bg-purple-600/30 border-purple-500/60 text-purple-200 shadow-[0_0_10px_rgba(168,85,247,0.4)]' : 'bg-slate-800 border-white/10 text-slate-400 hover:bg-slate-700 hover:text-white'}`}
          >
            <span className="text-base leading-none">🤖</span>
            {showChat ? 'AI 편집 닫기' : 'AI 편집'}
          </button>
        </div>

        {/* AI 챗 패널 (showChat 시 씬 목록 위에 표시) */}
        {showChat && (
          <div className="shrink-0 h-72 border-b border-white/[0.07] overflow-hidden">
            <StudioChat
              scenes={scenes}
              onSetSceneZoom={(indices, zoom) => {
                indices.forEach(i => onSceneZoomChange?.(i, zoom));
              }}
              onSetSubtitleChars={(maxChars) => {
                if (onChatSetSubtitleChars) onChatSetSubtitleChars(maxChars);
                else onSubConfigChange({ ...subConfig, maxCharsPerChunk: maxChars });
              }}
              onGenerateVideoRange={(indices) => {
                if (onChatGenerateVideo) onChatGenerateVideo(indices);
                else indices.forEach(i => onGenerateAnimation?.(i));
              }}
            />
          </div>
        )}

        {/* 일괄 편집 툴바 */}
        {onImageEditCommand && (
          <div className="px-2 pt-2 pb-1 flex flex-col gap-1 shrink-0">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => { setBatchMode(v => !v); setBatchSelected(new Set()); setBatchProgress(''); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${batchMode ? 'bg-indigo-600/30 border-indigo-500/60 text-indigo-200' : 'bg-slate-800 border-white/10 text-slate-400 hover:bg-slate-700'}`}
              >
                {batchMode ? '✓ 일괄편집 ON' : '일괄편집'}
              </button>
              {onVoiceUpload && (
                <>
                  <input
                    type="file"
                    ref={voiceFileInputRef}
                    accept="audio/*"
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) handleVoiceUpload(f);
                      e.target.value = '';
                    }}
                  />
                  <button
                    onClick={() => voiceFileInputRef.current?.click()}
                    disabled={isVoiceUploading}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-green-900/40 border border-green-500/40 text-green-300 hover:bg-green-800/40 disabled:opacity-50 transition-all"
                  >
                    {isVoiceUploading ? voiceUploadStatus : '🎙 내 목소리 업로드'}
                  </button>
                  {voiceUploadStatus && !isVoiceUploading && (
                    <span className="text-xs text-green-400">{voiceUploadStatus}</span>
                  )}
                </>
              )}
              {batchMode && (
                <>
                  <button onClick={() => setBatchSelected(new Set(scenes.map((_, i) => i)))} className="px-2 py-1.5 rounded-lg text-xs font-bold bg-slate-700 border border-white/10 text-slate-300 hover:bg-slate-600">전체선택</button>
                  <button onClick={() => setBatchSelected(new Set())} className="px-2 py-1.5 rounded-lg text-xs font-bold bg-slate-700 border border-white/10 text-slate-300 hover:bg-slate-600">전체해제</button>
                  <span className="text-xs text-indigo-300 font-bold ml-auto">{batchSelected.size}개 선택</span>
                </>
              )}
            </div>
            {batchMode && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={batchCmd}
                  onChange={e => setBatchCmd(e.target.value)}
                  onKeyDown={async (e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === 'Enter' && batchCmd.trim() && batchSelected.size > 0 && !isBatchLoading) {
                      const cmd = batchCmd.trim();
                      const indices = Array.from(batchSelected).sort((a: number, b: number) => a - b);
                      setIsBatchLoading(true);
                      for (let n = 0; n < indices.length; n++) {
                        setBatchProgress(`재생성 중... (${n + 1}/${indices.length})`);
                        try { await onImageEditCommand(indices[n], cmd); } catch {}
                      }
                      setBatchProgress(`완료 (${indices.length}개)`);
                      setIsBatchLoading(false);
                    }
                  }}
                  disabled={isBatchLoading}
                  placeholder="예: 남자 캐릭터로 바꿔줘 / 배경을 실내로"
                  className="flex-1 bg-slate-800/80 border border-indigo-500/30 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                />
                <button
                  onClick={async () => {
                    if (!batchCmd.trim() || batchSelected.size === 0 || isBatchLoading) return;
                    const cmd = batchCmd.trim();
                    const indices = Array.from(batchSelected).sort((a: number, b: number) => a - b);
                    setIsBatchLoading(true);
                    for (let n = 0; n < indices.length; n++) {
                      setBatchProgress(`재생성 중... (${n + 1}/${indices.length})`);
                      try { await onImageEditCommand(indices[n], cmd); } catch {}
                    }
                    setBatchProgress(`완료 (${indices.length}개)`);
                    setIsBatchLoading(false);
                  }}
                  disabled={!batchCmd.trim() || batchSelected.size === 0 || isBatchLoading}
                  className="px-3 py-1.5 rounded-lg text-sm font-bold bg-indigo-600/30 border border-indigo-500/50 text-indigo-300 hover:bg-indigo-600/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 shrink-0"
                >
                  {isBatchLoading
                    ? <><div className="w-3.5 h-3.5 border-2 border-indigo-300/40 border-t-indigo-300 rounded-full animate-spin" />{batchProgress}</>
                    : `일괄 재생성 (${batchSelected.size})`}
                </button>
              </div>
            )}
            {batchMode && batchProgress && !isBatchLoading && (
              <p className="text-xs text-indigo-300 font-bold px-1">{batchProgress}</p>
            )}
          </div>
        )}

        {onVoiceUpload && batchMode && batchSelected.size > 0 && (
          <div className="mx-2 mb-1 px-3 py-1.5 rounded-lg bg-cyan-900/30 border border-cyan-500/40 text-cyan-300 text-xs font-bold flex items-center gap-2">
            <span>🎙</span>
            <span>{batchSelected.size}개 씬 선택됨 — 선택된 씬 위에 오디오 파일을 드롭하세요</span>
          </div>
        )}
        <div ref={sceneListRef} className={`flex-1 overflow-y-auto py-2 px-2 ${isBatchDragSelect ? 'select-none' : ''}`}>
        {scenes.map((s, i) => (
          <div
            key={i}
            className={`flex items-start gap-3 px-3 py-3 rounded-xl mb-0.5 transition-all ${
              dragOverIdx === i && batchMode && batchSelected.has(i)
                ? 'border border-cyan-400/80 bg-cyan-900/20 shadow-[0_0_14px_rgba(34,211,238,0.35)]'
                : dragOverIdx === i
                  ? 'border border-green-400/80 bg-green-900/20 shadow-[0_0_14px_rgba(74,222,128,0.35)]'
                  : batchMode
                    ? batchSelected.has(i) ? 'border border-indigo-500/60 bg-indigo-900/20' : 'hover:bg-slate-800/60 border border-transparent'
                    : i === selectedIdx ? 'border border-red-500/50 bg-red-900/15 shadow-[0_0_14px_rgba(239,68,68,0.3)]' : 'hover:bg-slate-800/60 border border-transparent'
            }`}
            onMouseDown={batchMode ? () => {
              setIsBatchDragSelect(true);
              setBatchSelected(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });
            } : undefined}
            onMouseEnter={batchMode && isBatchDragSelect ? () => {
              setBatchSelected(prev => new Set([...prev, i]));
            } : undefined}
            onDragEnter={onVoiceUpload ? (e) => { e.preventDefault(); setDragOverIdx(i); } : undefined}
            onDragOver={onVoiceUpload ? (e) => { e.preventDefault(); } : undefined}
            onDragLeave={onVoiceUpload ? (e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverIdx(null);
            } : undefined}
            onDrop={onVoiceUpload ? (e) => {
              e.preventDefault();
              setDragOverIdx(null);
              const file = e.dataTransfer.files?.[0];
              if (file) handleSceneAudioDrop(i, file);
            } : undefined}
          >
            {batchMode && (
              <button
                onClick={() => setBatchSelected(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; })}
                className={`shrink-0 mt-1 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${batchSelected.has(i) ? 'bg-indigo-500 border-indigo-400 text-white' : 'border-slate-600 bg-slate-800'}`}
              >
                {batchSelected.has(i) && <span className="text-[10px] font-black">✓</span>}
              </button>
            )}
            <button onClick={() => batchMode ? setBatchSelected(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; }) : setSelectedIdx(i)} className="flex items-start gap-3 flex-1 text-left min-w-0">
              <div className="w-32 h-[72px] rounded-lg overflow-hidden shrink-0 bg-slate-800 flex items-center justify-center">
                {s.imageData
                  ? <img src={`data:image/jpeg;base64,${s.imageData}`} className="w-full h-full object-cover" alt="" />
                  : <div className="w-4 h-4 border border-slate-600 border-t-transparent animate-spin rounded-full" />
                }
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-slate-500 font-bold mb-0.5 flex items-center gap-1">
                  씬 {i + 1}
                  {s.videoData && <span className="text-purple-400" title="영상 변환 완료">🎬</span>}
                  {s.audioData && <span className="text-green-400" title="오디오 있음">🎙</span>}
                  {dragOverIdx === i && <span className="text-green-300 text-[10px]">오디오 놓기</span>}
                </p>
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
    </div>
  );
};

export default SubtitleEditor;
