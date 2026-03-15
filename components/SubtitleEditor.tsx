/**
 * SubtitleEditor — Vrew 스타일 자막 에디터
 * - 왼쪽: Canvas 미리보기 (자막 실시간 싱크)
 * - 오른쪽: 씬 목록
 * - 하단: 자막 스타일 컨트롤
 */

import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { GeneratedAsset, SubtitleConfig, SUBTITLE_FONTS } from '../types';

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
  const lineSpacing = fontSize * 1.15;
  const vPad = 6, hPad = 14, safeMargin = 10;
  const align = config.textAlign ?? 'center';

  ctx.font = `${config.fontWeight ?? 700} ${fontSize}px ${config.fontFamily}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = align as CanvasTextAlign;

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
  const boxHeight = displayLines.length * lineSpacing + vPad * 2;
  let boxX = Math.max(safeMargin, Math.min((W - boxWidth) / 2, W - safeMargin - boxWidth));
  const usableHeight = H - boxHeight - safeMargin * 2;
  let boxY = Math.max(safeMargin, Math.min(safeMargin + ((config.yPercent ?? 85) / 100) * usableHeight, H - safeMargin - boxHeight));
  const textX = boxX + boxWidth / 2;

  const bg = config.backgroundColor ?? 'rgba(0,0,0,0)';
  if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
    ctx.fillStyle = bg;
    ctx.beginPath();
    (ctx as any).roundRect(boxX, boxY, boxWidth, boxHeight, 6);
    ctx.fill();
  }

  displayLines.forEach((line, i) => {
    const textY = boxY + vPad + lineSpacing * (i + 0.5);
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
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);   // ctx.currentTime 기준 시작점 (offset 포함)
  const durationRef = useRef<number>(0);
  const pausedAtRef = useRef<number>(0);    // 일시정지 위치 (초)
  const isManualPauseRef = useRef<boolean>(false);
  const progressTimerRef = useRef<number>(0);

  // 줌/패닝 — 기본 98.5% (양쪽 클리핑 방지)
  const [zoom, setZoom] = useState(0.985);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

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

  // ── 자막 텍스트 계산 ──
  // 1순위: ElevenLabs words 기반 그룹 (실제 타임스탬프, 드리프트 없음)
  // 2순위: 나레이션 시간 균등 분배 (Gemini TTS 폴백)
  const getSubtitleText = useCallback((t: number): string => {
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

  const displaySubtitleText = isPlaying ? getSubtitleText(currentSubTime) : narration;

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

  // ── AudioBuffer 디코더 (MP3 + PCM16 fallback) ──
  async function decodeAudioBuffer(base64: string, ctx: AudioContext): Promise<AudioBuffer> {
    const b64 = base64.startsWith('data:') ? base64.split(',')[1] : base64;
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    try {
      return await ctx.decodeAudioData(bytes.buffer.slice(0));
    } catch {
      // Gemini TTS PCM16 24kHz
      const pcm = new Int16Array(bytes.buffer);
      const buf = ctx.createBuffer(1, pcm.length, 24000);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768.0;
      return buf;
    }
  }

  // ── stopAudio: 완전 중지 + 위치 초기화 ──
  const stopAudio = useCallback(() => {
    pausedAtRef.current = 0;
    isManualPauseRef.current = false;
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
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
        audioCtxRef.current = new AC();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') await ctx.resume();
      setIsPlaying(true);

      const buffer = await decodeAudioBuffer(scene.audioData, ctx);
      durationRef.current = buffer.duration;
      const offset = Math.min(pausedAtRef.current, Math.max(0, buffer.duration - 0.05));

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => {
        const wasManual = isManualPauseRef.current;
        isManualPauseRef.current = false;
        if (!wasManual) {
          // 자연 종료 → 처음으로 리셋
          pausedAtRef.current = 0;
          setAudioProgress(0);
          setCurrentSubTime(0);
        }
        setIsPlaying(false);
        window.clearInterval(progressTimerRef.current);
        sourceRef.current = null;
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
    <div className="flex h-full overflow-hidden">
      {/* ─── 왼쪽 ─── */}
      <div className="flex flex-col w-[68%] border-r border-white/[0.07] overflow-y-auto">

        {/* 줌 컨트롤 바 */}
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-900 border-b border-white/[0.07] shrink-0">
          <button onClick={() => { setZoom(0.985); setPan({ x: 0, y: 0 }); }}
            className="text-[10px] text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 transition-colors font-mono">
            RESET
          </button>
          <button onClick={() => setZoom(z => Math.min(3, +(z + 0.01).toFixed(3)))}
            className="w-7 h-7 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-base font-bold transition-colors">+</button>
          <span className="text-xs text-slate-300 font-mono w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.max(0.3, +(z - 0.01).toFixed(3)))}
            className="w-7 h-7 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-base font-bold transition-colors">−</button>
          <span className="text-[10px] text-slate-500 ml-1">휠로 줌 · 드래그로 이동 · Space 재생</span>
          {onExportVideo && (
            <div className="ml-auto flex gap-1.5">
              <button onClick={() => onExportVideo(false)} disabled={isExporting}
                className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold transition-colors disabled:opacity-40">
                자막 없이 내보내기
              </button>
              <button onClick={() => onExportVideo(true)} disabled={isExporting}
                className="px-3 py-1.5 rounded-lg bg-blue-600/20 border border-blue-500/50 hover:bg-blue-600/30 text-blue-200 text-xs font-bold transition-all disabled:opacity-40">
                {isExporting ? '렌더링 중...' : '자막 포함 내보내기'}
              </button>
            </div>
          )}
        </div>

        {/* 캔버스 */}
        <div ref={canvasContainerRef}
          className="relative bg-black overflow-hidden cursor-grab active:cursor-grabbing select-none"
          style={{ aspectRatio: '16/9' }}
          onWheel={handleWheel} onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
        >
          <div style={{ transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`, transformOrigin: 'center center', width: '100%', height: '100%' }}>
            <canvas ref={canvasRef} width={1280} height={720} className="w-full h-full" />
          </div>

          {/* 중심 가이드라인 (드래그 중) */}
          {isDragging && (() => {
            const snapPx = 2, cx = Math.abs(pan.x) <= snapPx, cy = Math.abs(pan.y) <= snapPx;
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
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-black transition-all shrink-0 ${
              hasAudio
                ? isPlaying
                  ? 'bg-blue-500 text-white shadow-[0_0_10px_rgba(59,130,246,0.5)]'
                  : 'bg-blue-600/25 border border-blue-500/60 hover:bg-blue-600/45 text-blue-200'
                : 'bg-slate-800 text-slate-600 cursor-not-allowed'
            }`}
          >
            {isPlaying ? '■' : '▶'}
          </button>
          <div className="flex-1 relative h-2 bg-slate-700 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-400 to-indigo-400 rounded-full"
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
        <div className="px-4 py-3 space-y-4">

          {/* 폰트 선택 */}
          <div>
            <label className="text-[11px] text-slate-400 uppercase tracking-wider font-bold block mb-1.5">폰트</label>
            <div className="grid grid-cols-3 gap-1.5">
              {SUBTITLE_FONTS.map(f => (
                <button key={f.value}
                  onClick={() => set({ fontFamily: f.value, fontWeight: f.weight })}
                  className={`py-2.5 px-2 rounded-lg text-sm font-bold transition-colors text-center ${
                    subConfig.fontFamily === f.value ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                  }`}
                  style={{ fontFamily: f.value }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* 크기 + 굵기 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-slate-400 uppercase tracking-wider font-bold block mb-1">
                크기 <span className="text-slate-200 normal-case">{subConfig.fontSize}px</span>
              </label>
              <input type="range" min={20} max={120} step={2}
                value={subConfig.fontSize} onChange={e => set({ fontSize: +e.target.value })}
                className="w-full accent-blue-500" />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 uppercase tracking-wider font-bold block mb-1">
                굵기 <span className="text-slate-200 normal-case">{subConfig.fontWeight}</span>
              </label>
              <input type="range" min={100} max={900} step={100}
                value={subConfig.fontWeight} onChange={e => set({ fontWeight: +e.target.value })}
                className="w-full accent-blue-500" />
            </div>
          </div>

          {/* 색상 */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] text-slate-400 uppercase tracking-wider font-bold block mb-1">글자색</label>
              <div className="flex items-center gap-2">
                <input type="color" value={subConfig.textColor} onChange={e => set({ textColor: e.target.value })}
                  className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent" />
                <span className="text-xs text-slate-300 font-mono">{subConfig.textColor}</span>
              </div>
            </div>
            <div>
              <label className="text-[11px] text-slate-400 uppercase tracking-wider font-bold block mb-1">테두리색</label>
              <div className="flex items-center gap-2">
                <input type="color" value={subConfig.strokeColor} onChange={e => set({ strokeColor: e.target.value })}
                  className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent" />
                <span className="text-xs text-slate-300 font-mono">{subConfig.strokeColor}</span>
              </div>
            </div>
            <div>
              <label className="text-[11px] text-slate-400 uppercase tracking-wider font-bold block mb-1">
                테두리 <span className="text-slate-200">{subConfig.strokeWidth}</span>
              </label>
              <input type="range" min={0} max={20} step={1}
                value={subConfig.strokeWidth} onChange={e => set({ strokeWidth: +e.target.value })}
                className="w-full accent-blue-500" />
            </div>
          </div>

          {/* 배경 + 정렬 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-slate-400 uppercase tracking-wider font-bold block mb-1">배경</label>
              <div className="flex gap-1.5">
                {[
                  { label: '없음', val: 'rgba(0, 0, 0, 0)' },
                  { label: '반투명', val: 'rgba(0,0,0,0.6)' },
                  { label: '불투명', val: 'rgba(0,0,0,0.9)' },
                ].map(o => (
                  <button key={o.val} onClick={() => set({ backgroundColor: o.val })}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                      subConfig.backgroundColor === o.val ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[11px] text-slate-400 uppercase tracking-wider font-bold block mb-1">정렬</label>
              <div className="flex gap-1.5">
                {(['left', 'center', 'right'] as const).map(a => (
                  <button key={a} onClick={() => set({ textAlign: a })}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                      (subConfig.textAlign ?? 'center') === a ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}>
                    {a === 'left' ? '좌' : a === 'center' ? '중' : '우'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 세로 위치 */}
          <div>
            <label className="text-[11px] text-slate-400 uppercase tracking-wider font-bold block mb-1">
              세로 위치 <span className="text-slate-200 normal-case">{subConfig.yPercent ?? 85}%</span>
            </label>
            <input type="range" min={0} max={100} step={1}
              value={subConfig.yPercent ?? 85} onChange={e => set({ yPercent: +e.target.value })}
              className="w-full accent-blue-500" />
          </div>

          {/* 청크 글자 수 */}
          <div>
            <label className="text-[11px] text-slate-400 uppercase tracking-wider font-bold block mb-1">
              청크 글자 수 <span className="text-slate-200">{subConfig.maxCharsPerChunk ?? 15}자</span>
            </label>
            <input type="range" min={5} max={30} step={1}
              value={subConfig.maxCharsPerChunk ?? 15} onChange={e => set({ maxCharsPerChunk: +e.target.value })}
              className="w-full accent-blue-500" />
          </div>
        </div>
      </div>

      {/* ─── 오른쪽: 씬 목록 ─── */}
      <div className="flex-1 overflow-y-auto py-2">
        {scenes.map((s, i) => (
          <button key={i} onClick={() => setSelectedIdx(i)}
            className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${
              i === selectedIdx ? 'bg-blue-900/30 border-l-2 border-blue-500' : 'hover:bg-slate-800/60 border-l-2 border-transparent'
            }`}
          >
            <div className="w-20 h-12 rounded-lg overflow-hidden shrink-0 bg-slate-800 flex items-center justify-center">
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
  );
};

export default SubtitleEditor;
