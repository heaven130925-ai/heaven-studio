/**
 * SubtitleEditor — Vrew 스타일 자막 에디터
 * - 왼쪽: Canvas 미리보기 (자막 실시간 싱크)
 * - 오른쪽: 씬 목록
 * - 하단: 자막 스타일 컨트롤
 */

import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { GeneratedAsset, SubtitleConfig, SUBTITLE_FONTS } from '../types';
import { downloadProjectZip, downloadMediaZip } from '../utils/csvHelper';
import { downloadSrt } from '../services/srtService';
import { exportAssetsToZip } from '../services/exportService';

interface Props {
  scenes: GeneratedAsset[];
  subConfig: SubtitleConfig;
  onSubConfigChange: (cfg: SubtitleConfig) => void;
  onNarrationChange?: (index: number, narration: string) => void;
  onExportVideo?: (enableSubtitles: boolean) => void;
  isExporting?: boolean;
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

const SubtitleEditor: React.FC<Props> = ({ scenes, subConfig, onSubConfigChange, onNarrationChange, onExportVideo, isExporting }) => {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const imgCacheRef = useRef<HTMLImageElement | null>(null);

  // 오디오 — WebAudio API
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [currentSubTime, setCurrentSubTime] = useState(0);
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
  // 1순위: AI 의미 단위 (meaningChunks)
  // 2순위: ElevenLabs words 기반 그룹 (실제 타임스탬프, 드리프트 없음)
  // 3순위: 나레이션 시간 균등 분배 (Gemini TTS 폴백)
  const getSubtitleText = useCallback((t: number): string => {
    if (useMeaningChunks && meaningChunks && meaningChunks.length > 0) {
      if (t < meaningChunks[0].startTime) return meaningChunks[0].text;
      const g = meaningChunks.find((chunk: { startTime: number; endTime: number; text: string }) => t >= chunk.startTime && t < chunk.endTime);
      return g ? g.text : meaningChunks[meaningChunks.length - 1].text;
    }
    if (wordGroups && wordGroups.length > 0) {
      if (t < wordGroups[0].startTime) return wordGroups[0].text;
      const g = wordGroups.find(grp => t >= grp.startTime && t < grp.endTime);
      return g ? g.text : wordGroups[wordGroups.length - 1].text;
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
  }, [wordGroups, narration, subConfig.maxCharsPerChunk]);

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
    // MP3 인코더 지연으로 끝이 잘리는 현상 방지 — 0.6s 무음 패딩 추가
    const PAD = 0.6;
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
    window.clearInterval(progressTimerRef.current);
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
      window.clearInterval(progressTimerRef.current);
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
      durationRef.current = contentDuration;
      const offset = Math.min(pausedAtRef.current, Math.max(0, contentDuration - 0.05));

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => {
        const wasManual = isManualPauseRef.current;
        isManualPauseRef.current = false;
        window.clearInterval(progressTimerRef.current);
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
      source.start(0, offset);
      sourceRef.current = source;
      // startTimeRef 조정: elapsed = ctx.currentTime - startTimeRef = offset (시작 직후)
      startTimeRef.current = ctx.currentTime - offset;

      progressTimerRef.current = window.setInterval(() => {
        const actx = audioCtxRef.current;
        if (!actx || !sourceRef.current) return;
        if (actx.state === 'suspended') actx.resume();
        const elapsed = actx.currentTime - startTimeRef.current;
        const clamped = Math.min(elapsed, durationRef.current);
        setAudioProgress((clamped / durationRef.current) * 100);
        setCurrentSubTime(clamped);
      }, 50);
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
    window.clearInterval(progressTimerRef.current);
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

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.min(3, Math.max(0.3, z - e.deltaY * 0.001)));
  }, []);
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
      <div className="flex flex-col w-[60%] border-r border-white/[0.07] overflow-y-auto">

        {/* 줌 컨트롤 바 */}
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-900 border-b border-white/[0.07] shrink-0">
          <button onClick={() => { setZoom(1.0); setPan({ x: 0, y: 0 }); }}
            className="text-[10px] text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 transition-colors font-mono">
            RESET
          </button>
          <button onClick={() => setZoom(z => Math.max(0.3, +(z - 0.01).toFixed(3)))}
            className="w-9 h-9 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-2xl font-bold transition-colors">−</button>
          <span className="text-base text-slate-200 font-mono w-16 text-center font-bold">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(3, +(z + 0.01).toFixed(3)))}
            className="w-9 h-9 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-2xl font-bold transition-colors">+</button>
          <span className="text-[10px] text-slate-500 ml-1">휠로 줌 · 드래그로 이동 · Space 재생</span>
          <div className="ml-auto flex gap-1.5 flex-wrap justify-end">
            {[
              { label: '전체 저장', onClick: () => downloadProjectZip(scenes) },
              { label: '이미지+음성', onClick: () => downloadMediaZip(scenes) },
              { label: '엑셀+이미지', onClick: () => exportAssetsToZip(scenes, `스토리보드_${new Date().toLocaleDateString('ko-KR')}`) },
              { label: 'SRT', onClick: async () => await downloadSrt(scenes, `subtitles_${Date.now()}.srt`) },
            ].map(btn => (
              <button key={btn.label} onClick={btn.onClick}
                className="px-3 py-1.5 rounded-lg bg-blue-600/20 border border-blue-500/50 text-blue-200 font-bold text-[10px] hover:bg-blue-600/35 hover:border-blue-400/70 transition-all shadow-[0_0_8px_rgba(59,130,246,0.25)] flex items-center gap-1">
                {btn.label}
              </button>
            ))}
            {onExportVideo && (<>
              <button onClick={() => onExportVideo(false)} disabled={isExporting}
                className="px-4 py-1.5 rounded-lg bg-red-600/20 border border-red-500/50 hover:bg-red-600/35 text-red-200 text-[10px] font-bold transition-all disabled:opacity-40 shadow-[0_0_10px_rgba(239,68,68,0.25)]">
                자막 없이
              </button>
              <button onClick={() => onExportVideo(true)} disabled={isExporting}
                className="px-4 py-1.5 rounded-lg bg-red-600/20 border border-red-500/50 hover:bg-red-600/35 text-red-200 text-[10px] font-bold transition-all disabled:opacity-40 shadow-[0_0_10px_rgba(239,68,68,0.25)]">
                {isExporting ? '렌더링 중...' : '자막 포함'}
              </button>
            </>)}
          </div>
        </div>

        {/* 캔버스 */}
        <div ref={canvasContainerRef}
          className="relative bg-black overflow-hidden cursor-grab active:cursor-grabbing select-none"
          style={{ aspectRatio: '16/9', width: '100%', flexShrink: 0 }}
          onWheel={handleWheel} onMouseDown={handleMouseDown}
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

          {!scene?.imageData && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-xs pointer-events-none">
              이미지 생성 대기 중...
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
            <div className="h-full bg-gradient-to-r from-blue-400 to-indigo-400 rounded-full pointer-events-none"
              style={{ width: `${audioProgress}%`, transition: 'width 0.05s linear' }} />
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
            <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">씬 {selectedIdx + 1} 자막 텍스트</label>
            <textarea
              value={narration}
              onChange={e => onNarrationChange(selectedIdx, e.target.value)}
              rows={2}
              className="w-full mt-1 bg-slate-800/80 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-blue-500"
            />
          </div>
        )}

        {/* 자막 스타일 컨트롤 */}
        <div className="px-4 py-3 space-y-3">

          {/* 폰트 선택 */}
          <div className="p-3 rounded-xl border border-blue-500/60 shadow-[0_0_14px_rgba(59,130,246,0.3)]">
            <label className="text-sm text-blue-300 uppercase tracking-wider font-black block mb-2">폰트</label>
            <div className="grid grid-cols-3 gap-1.5">
              {SUBTITLE_FONTS.map(f => (
                <button key={f.value}
                  onClick={() => set({ fontFamily: f.value, fontWeight: f.weight })}
                  className={`py-2.5 px-2 rounded-lg text-sm font-bold transition-colors text-center border ${
                    subConfig.fontFamily === f.value ? 'bg-blue-600 text-white border-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.5)]' : 'bg-slate-800 text-slate-200 border-blue-500/30 hover:bg-slate-700 hover:border-blue-400/50'
                  }`}
                  style={{ fontFamily: f.value }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* 크기 + 굵기 */}
          <div className="p-3 rounded-xl border border-blue-500/60 shadow-[0_0_14px_rgba(59,130,246,0.3)]">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-300 uppercase tracking-wider font-bold block mb-1">
                크기 <span className="text-slate-200 normal-case">{subConfig.fontSize}px</span>
              </label>
              <input type="range" min={20} max={120} step={2}
                value={subConfig.fontSize} onChange={e => set({ fontSize: +e.target.value })}
                className="w-full accent-blue-500" />
            </div>
            <div>
              <label className="text-xs text-slate-300 uppercase tracking-wider font-bold block mb-1">
                굵기 <span className="text-slate-200 normal-case">{subConfig.fontWeight}</span>
              </label>
              <input type="range" min={100} max={900} step={100}
                value={subConfig.fontWeight} onChange={e => set({ fontWeight: +e.target.value })}
                className="w-full accent-blue-500" />
            </div>
          </div>
          </div>

          {/* 색상 */}
          <div className="p-3 rounded-xl border border-blue-500/60 shadow-[0_0_14px_rgba(59,130,246,0.3)]">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-slate-300 uppercase tracking-wider font-bold block mb-1">글자색</label>
              <div className="flex items-center gap-2">
                <input type="color" value={subConfig.textColor} onChange={e => set({ textColor: e.target.value })}
                  className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent" />
                <span className="text-xs text-slate-300 font-mono">{subConfig.textColor}</span>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-300 uppercase tracking-wider font-bold block mb-1">테두리색</label>
              <div className="flex items-center gap-2">
                <input type="color" value={subConfig.strokeColor} onChange={e => set({ strokeColor: e.target.value })}
                  className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent" />
                <span className="text-xs text-slate-300 font-mono">{subConfig.strokeColor}</span>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-300 uppercase tracking-wider font-bold block mb-1">
                테두리 <span className="text-slate-200">{subConfig.strokeWidth}</span>
              </label>
              <input type="range" min={0} max={20} step={1}
                value={subConfig.strokeWidth} onChange={e => set({ strokeWidth: +e.target.value })}
                className="w-full accent-blue-500" />
            </div>
          </div>
          </div>

          {/* 배경 + 정렬 */}
          <div className="p-3 rounded-xl border border-blue-500/60 shadow-[0_0_14px_rgba(59,130,246,0.3)]">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-300 uppercase tracking-wider font-bold block mb-1">배경</label>
              <div className="flex gap-1.5">
                {[
                  { label: '없음', val: 'rgba(0, 0, 0, 0)' },
                  { label: '반투명', val: 'rgba(0,0,0,0.6)' },
                  { label: '불투명', val: 'rgba(0,0,0,0.9)' },
                ].map(o => (
                  <button key={o.val} onClick={() => set({ backgroundColor: o.val })}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                      subConfig.backgroundColor === o.val ? 'bg-blue-600 text-white shadow-[0_0_8px_rgba(59,130,246,0.4)]' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-300 uppercase tracking-wider font-bold block mb-1">정렬</label>
              <div className="flex gap-1.5">
                {(['left', 'center', 'right'] as const).map(a => (
                  <button key={a} onClick={() => set({ textAlign: a })}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                      (subConfig.textAlign ?? 'center') === a ? 'bg-blue-600 text-white shadow-[0_0_8px_rgba(59,130,246,0.4)]' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}>
                    {a === 'left' ? '좌' : a === 'center' ? '중' : '우'}
                  </button>
                ))}
              </div>
            </div>
          </div>
          </div>

          {/* 세로 위치 */}
          <div className="p-3 rounded-xl border border-blue-500/60 shadow-[0_0_14px_rgba(59,130,246,0.3)]">
            <label className="text-xs text-slate-300 uppercase tracking-wider font-bold block mb-1">
              세로 위치 <span className="text-slate-200 normal-case">{subConfig.yPercent ?? 85}%</span>
            </label>
            <input type="range" min={0} max={100} step={1}
              value={subConfig.yPercent ?? 85} onChange={e => set({ yPercent: +e.target.value })}
              className="w-full accent-blue-500" />
          </div>

          {/* 청크 글자 수 */}
          <div className="p-3 rounded-xl border border-blue-500/60 shadow-[0_0_14px_rgba(59,130,246,0.3)]">
            <label className="text-xs text-slate-300 uppercase tracking-wider font-bold block mb-1">
              청크 글자 수 <span className="text-slate-200">{subConfig.maxCharsPerChunk ?? 15}자</span>
            </label>
            <input type="range" min={5} max={30} step={1}
              value={subConfig.maxCharsPerChunk ?? 15} onChange={e => set({ maxCharsPerChunk: +e.target.value })}
              className="w-full accent-blue-500" />
          </div>

          {/* AI 의미 단위 자막 */}
          <div className="p-3 rounded-xl border border-blue-500/60 shadow-[0_0_14px_rgba(59,130,246,0.3)]">
            <label className="text-xs text-slate-300 uppercase tracking-wider font-bold block mb-1.5">
              AI 의미 단위 자막
              {!hasMeaningChunks && <span className="ml-1 text-slate-600 normal-case font-normal">(TTS 생성 후 활성화)</span>}
            </label>
            <button
              onClick={() => setUseMeaningChunks(v => !v)}
              disabled={!hasMeaningChunks}
              className={`w-full py-2 rounded-lg text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                useMeaningChunks
                  ? 'bg-blue-600 text-white shadow-[0_0_10px_rgba(59,130,246,0.4)]'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {useMeaningChunks ? 'AI 의미 단위 ON' : '글자수 기준 (AI 의미 단위 OFF)'}
            </button>
          </div>
        </div>
      </div>

      {/* ─── 오른쪽: 씬 목록 ─── */}
      <div className="flex-1 overflow-y-auto py-2 px-2">
        {scenes.map((s, i) => (
          <button key={i} onClick={() => setSelectedIdx(i)}
            className={`w-full flex items-start gap-3 px-3 py-3 text-left transition-all rounded-xl mb-0.5 ${
              i === selectedIdx
                ? 'border border-red-500/50 bg-red-900/15 shadow-[0_0_14px_rgba(239,68,68,0.3)]'
                : 'hover:bg-slate-800/60 border border-transparent'
            }`}
          >
            <div className="w-28 h-16 rounded-lg overflow-hidden shrink-0 bg-slate-800 flex items-center justify-center">
              {s.imageData
                ? <img src={`data:image/jpeg;base64,${s.imageData}`} className="w-full h-full object-cover" alt="" />
                : <div className="w-4 h-4 border border-slate-600 border-t-transparent animate-spin rounded-full" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-slate-500 font-bold mb-0.5">씬 {i + 1}</p>
              <p className="text-xs text-slate-300 leading-snug line-clamp-2">{s.narration}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
    </div>
  );
};

export default SubtitleEditor;
