/**
 * SubtitleEditor — Vrew 스타일 자막 에디터
 * - 왼쪽: Canvas 미리보기 (videoService와 동일한 렌더링)
 * - 오른쪽: 씬 목록
 * - 하단: 자막 스타일 컨트롤
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { GeneratedAsset, SubtitleConfig, SUBTITLE_FONTS } from '../types';

interface Props {
  scenes: GeneratedAsset[];
  subConfig: SubtitleConfig;
  onSubConfigChange: (cfg: SubtitleConfig) => void;
  onNarrationChange?: (index: number, narration: string) => void;
  onExportVideo?: (enableSubtitles: boolean) => void;
  isExporting?: boolean;
}

// videoService의 자막 렌더링 로직과 동일 — 사전 로드된 Image 객체 사용
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
      drawH = W / imgAspect;
      drawY = (H - drawH) / 2;
    } else {
      drawW = H * imgAspect;
      drawX = (W - drawW) / 2;
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
  const vPad = 6;
  const hPad = 14;
  const safeMargin = 10;
  const align = config.textAlign ?? 'center';

  ctx.font = `${config.fontWeight ?? 700} ${fontSize}px ${config.fontFamily}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = align as CanvasTextAlign;

  const maxChars = config.maxCharsPerChunk ?? 15;
  const lines: string[] = [];
  let current = '';
  for (const ch of text.split('')) {
    current += ch;
    if (current.length >= maxChars && (ch === ' ' || ch === '.' || ch === ',' || ch === '。' || ch === '，')) {
      lines.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) lines.push(current.trim());

  const displayLines = lines.slice(0, config.maxLines ?? 2);
  const maxLineWidth = Math.max(...displayLines.map(l => ctx.measureText(l).width));
  let boxWidth = maxLineWidth + hPad * 2;
  const boxHeight = displayLines.length * lineSpacing + vPad * 2;
  const maxBoxWidth = W - safeMargin * 2;
  if (boxWidth > maxBoxWidth) boxWidth = maxBoxWidth;

  let boxX = (W - boxWidth) / 2;
  boxX = Math.max(safeMargin, Math.min(boxX, W - safeMargin - boxWidth));
  const usableHeight = H - boxHeight - safeMargin * 2;
  let boxY = safeMargin + ((config.yPercent ?? 85) / 100) * usableHeight;
  boxY = Math.max(safeMargin, Math.min(boxY, H - safeMargin - boxHeight));
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
      ctx.lineWidth = sw;
      ctx.lineJoin = 'round';
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

  // 오디오 — WebAudio API
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [currentSubTime, setCurrentSubTime] = useState(0); // 자막 싱크용 현재 시각(초)
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const durationRef = useRef<number>(0);
  const progressTimerRef = useRef<number>(0);

  // 이미지 캐시 (씬별로 한 번만 로드)
  const imgCacheRef = useRef<HTMLImageElement | null>(null);

  // 줌/패닝
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  const set = (partial: Partial<SubtitleConfig>) => onSubConfigChange({ ...subConfig, ...partial });
  const scene = scenes[selectedIdx];
  const narration = scene?.narration ?? '';
  const hasAudio = !!(scene?.audioData);

  // 현재 시각에 맞는 자막 청크 텍스트 반환
  const getCurrentSubtitleText = (t: number): string => {
    const chunks = scene?.subtitleData?.meaningChunks;
    if (!chunks || chunks.length === 0) return narration;
    const chunk = chunks.find(c => t >= c.startTime && t < c.endTime);
    if (chunk) return chunk.text;
    if (t < (chunks[0]?.startTime ?? 0)) return '';
    return chunks[chunks.length - 1].text;
  };

  // 재생 중이면 타임스탬프 기반 자막, 아니면 전체 나레이션
  const displaySubtitleText = isPlaying ? getCurrentSubtitleText(currentSubTime) : narration;

  // 씬 이미지 사전 로드
  useEffect(() => {
    imgCacheRef.current = null;
    if (!scene?.imageData) return;
    const img = new Image();
    img.onload = () => {
      imgCacheRef.current = img;
      // 이미지 로드 완료 후 캔버스 재렌더
      const canvas = canvasRef.current;
      if (canvas) {
        document.fonts.load(`${subConfig.fontWeight ?? 700} ${subConfig.fontSize}px ${subConfig.fontFamily}`)
          .finally(() => renderSubtitleOnCanvas(canvas, img, narration, subConfig));
      }
    };
    img.src = `data:image/jpeg;base64,${scene.imageData}`;
  }, [scene?.imageData]); // eslint-disable-line

  // base64 → AudioBuffer (MP3 or PCM16 fallback)
  async function decodeAudioBuffer(base64: string, ctx: AudioContext): Promise<AudioBuffer> {
    const b64 = base64.startsWith('data:') ? base64.split(',')[1] : base64;
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    try {
      return await ctx.decodeAudioData(bytes.buffer.slice(0));
    } catch {
      // PCM16 fallback (Gemini TTS raw PCM 24kHz)
      const pcm = new Int16Array(bytes.buffer);
      const buf = ctx.createBuffer(1, pcm.length, 24000);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768.0;
      return buf;
    }
  }

  const stopAudio = useCallback(() => {
    if (sourceRef.current) { try { sourceRef.current.stop(); } catch {} sourceRef.current = null; }
    window.clearInterval(progressTimerRef.current);
    setIsPlaying(false);
    setCurrentSubTime(0);
  }, []);

  // 씬 변경 시 정지
  useEffect(() => {
    stopAudio();
    setAudioProgress(0);
  }, [selectedIdx, stopAudio]);

  // 언마운트 정리
  useEffect(() => {
    return () => {
      stopAudio();
      if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null; }
    };
  }, [stopAudio]);

  const togglePlay = async () => {
    if (isPlaying) { stopAudio(); return; }
    if (!scene?.audioData) return;
    try {
      // AudioContext 생성 또는 재사용 (closed면 새로 생성)
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
        audioCtxRef.current = new AC();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') await ctx.resume();
      setIsPlaying(true);
      const buffer = await decodeAudioBuffer(scene.audioData, ctx);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => {
        setIsPlaying(false);
        setAudioProgress(0);
        setCurrentSubTime(0);
        window.clearInterval(progressTimerRef.current);
        sourceRef.current = null;
      };
      source.start(0);
      sourceRef.current = source;
      startTimeRef.current = ctx.currentTime;
      durationRef.current = buffer.duration;
      // 50ms 간격으로 진행도 + 자막 싱크 업데이트
      progressTimerRef.current = window.setInterval(() => {
        const actx = audioCtxRef.current;
        if (!actx || !sourceRef.current) return;
        // context가 suspended면 재개 시도
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
  };

  // 컨테이너 크기 추적
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
    setPan({
      x: dragRef.current.panX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.panY + (e.clientY - dragRef.current.startY),
    });
  };
  const handleMouseUp = () => { dragRef.current = null; setIsDragging(false); };

  // 캔버스 재렌더 — displaySubtitleText 또는 subConfig 변경 시
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (imgCacheRef.current) {
      // 이미지 이미 캐시됨 — 동기 렌더 (font 로드만 대기)
      document.fonts.load(`${subConfig.fontWeight ?? 700} ${subConfig.fontSize}px ${subConfig.fontFamily}`)
        .finally(() => renderSubtitleOnCanvas(canvas, imgCacheRef.current, displaySubtitleText, subConfig));
    } else {
      // 이미지 아직 없음 (로딩 중)
      renderSubtitleOnCanvas(canvas, null, displaySubtitleText, subConfig);
    }
  }, [displaySubtitleText, subConfig]);

  useEffect(() => { redraw(); }, [redraw]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* ─── 왼쪽: 캔버스 미리보기 + 컨트롤 ─── */}
      <div className="flex flex-col w-[68%] border-r border-white/[0.07] overflow-y-auto">

        {/* 줌/패닝 컨트롤 바 */}
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-900 border-b border-white/[0.07] shrink-0">
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
            className="text-[10px] text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 transition-colors font-mono">
            RESET
          </button>
          <button onClick={() => setZoom(z => Math.min(3, z + 0.1))}
            className="w-7 h-7 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-base font-bold transition-colors">+</button>
          <span className="text-xs text-slate-300 font-mono w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.max(0.3, z - 0.1))}
            className="w-7 h-7 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-base font-bold transition-colors">−</button>
          <span className="text-[10px] text-slate-500 ml-1">휠로 줌 · 드래그로 이동</span>
          {onExportVideo && (
            <div className="ml-auto flex gap-1.5">
              <button
                onClick={() => onExportVideo(false)}
                disabled={isExporting}
                className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold transition-colors disabled:opacity-40"
              >
                자막 없이 내보내기
              </button>
              <button
                onClick={() => onExportVideo(true)}
                disabled={isExporting}
                className="px-3 py-1.5 rounded-lg bg-blue-600/20 border border-blue-500/50 hover:bg-blue-600/30 text-blue-200 text-xs font-bold transition-all shadow-[0_0_10px_rgba(59,130,246,0.2)] disabled:opacity-40"
              >
                {isExporting ? '렌더링 중...' : '자막 포함 내보내기'}
              </button>
            </div>
          )}
        </div>

        {/* 캔버스 미리보기 */}
        <div
          ref={canvasContainerRef}
          className="relative bg-black overflow-hidden cursor-grab active:cursor-grabbing select-none"
          style={{ aspectRatio: '16/9' }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <div style={{ transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`, transformOrigin: 'center center', width: '100%', height: '100%' }}>
            <canvas ref={canvasRef} width={1280} height={720} className="w-full h-full" />
          </div>

          {/* 중심 가이드라인 */}
          {isDragging && (() => {
            const snapPx = 2;
            const centeredX = Math.abs(pan.x) <= snapPx;
            const centeredY = Math.abs(pan.y) <= snapPx;
            return (
              <>
                <div className="absolute top-0 bottom-0 pointer-events-none" style={{
                  left: 'calc(50% - 0.5px)', width: centeredX ? 2 : 1,
                  background: centeredX ? 'rgba(239,68,68,0.95)' : 'rgba(255,255,255,0.2)',
                  boxShadow: centeredX ? '0 0 6px rgba(239,68,68,0.8)' : 'none',
                }} />
                <div className="absolute left-0 right-0 pointer-events-none" style={{
                  top: 'calc(50% - 0.5px)', height: centeredY ? 2 : 1,
                  background: centeredY ? 'rgba(239,68,68,0.95)' : 'rgba(255,255,255,0.2)',
                  boxShadow: centeredY ? '0 0 6px rgba(239,68,68,0.8)' : 'none',
                }} />
              </>
            );
          })()}

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
            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black transition-all shrink-0 ${
              hasAudio
                ? isPlaying
                  ? 'bg-blue-500 hover:bg-blue-400 text-white shadow-[0_0_10px_rgba(59,130,246,0.5)]'
                  : 'bg-blue-600/30 border border-blue-500/60 hover:bg-blue-600/50 text-blue-200'
                : 'bg-slate-800 text-slate-600 cursor-not-allowed'
            }`}
          >
            {isPlaying ? '■' : '▶'}
          </button>
          {/* 진행 바 — 배경 밝게 */}
          <div className="flex-1 relative h-2 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-400 to-indigo-400 rounded-full"
              style={{ width: `${audioProgress}%`, transition: 'width 0.05s linear' }}
            />
          </div>
          <span className="text-[10px] text-slate-400 shrink-0 w-16 text-right font-mono">
            {hasAudio
              ? isPlaying
                ? `${currentSubTime.toFixed(1)}s`
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
            <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block mb-1.5">폰트</label>
            <div className="grid grid-cols-3 gap-1.5">
              {SUBTITLE_FONTS.map(f => (
                <button
                  key={f.value}
                  onClick={() => set({ fontFamily: f.value, fontWeight: f.weight })}
                  className={`py-2 px-2 rounded-lg text-xs font-bold transition-colors text-center truncate ${
                    subConfig.fontFamily === f.value
                      ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
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
              <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block mb-1">
                크기 <span className="text-slate-300 normal-case">{subConfig.fontSize}px</span>
              </label>
              <input type="range" min={20} max={120} step={2}
                value={subConfig.fontSize}
                onChange={e => set({ fontSize: +e.target.value })}
                className="w-full accent-blue-500"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block mb-1">
                굵기 <span className="text-slate-300 normal-case">{subConfig.fontWeight}</span>
              </label>
              <input type="range" min={100} max={900} step={100}
                value={subConfig.fontWeight}
                onChange={e => set({ fontWeight: +e.target.value })}
                className="w-full accent-blue-500"
              />
            </div>
          </div>

          {/* 색상 */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block mb-1">글자색</label>
              <div className="flex items-center gap-2">
                <input type="color" value={subConfig.textColor}
                  onChange={e => set({ textColor: e.target.value })}
                  className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
                />
                <span className="text-xs text-slate-400 font-mono">{subConfig.textColor}</span>
              </div>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block mb-1">테두리색</label>
              <div className="flex items-center gap-2">
                <input type="color" value={subConfig.strokeColor}
                  onChange={e => set({ strokeColor: e.target.value })}
                  className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
                />
                <span className="text-xs text-slate-400 font-mono">{subConfig.strokeColor}</span>
              </div>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block mb-1">
                테두리 굵기 <span className="text-slate-300">{subConfig.strokeWidth}</span>
              </label>
              <input type="range" min={0} max={20} step={1}
                value={subConfig.strokeWidth}
                onChange={e => set({ strokeWidth: +e.target.value })}
                className="w-full accent-blue-500"
              />
            </div>
          </div>

          {/* 배경 + 정렬 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block mb-1">배경</label>
              <div className="flex gap-1.5">
                {[
                  { label: '없음', val: 'rgba(0, 0, 0, 0)' },
                  { label: '반투명', val: 'rgba(0,0,0,0.6)' },
                  { label: '불투명', val: 'rgba(0,0,0,0.9)' },
                ].map(o => (
                  <button key={o.val} onClick={() => set({ backgroundColor: o.val })}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                      subConfig.backgroundColor === o.val ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block mb-1">정렬</label>
              <div className="flex gap-1.5">
                {(['left', 'center', 'right'] as const).map(a => (
                  <button key={a} onClick={() => set({ textAlign: a })}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                      (subConfig.textAlign ?? 'center') === a ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}>
                    {a === 'left' ? '좌' : a === 'center' ? '중' : '우'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 세로 위치 */}
          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block mb-1">
              세로 위치 <span className="text-slate-300 normal-case">{subConfig.yPercent ?? 85}% (0=상단 / 100=하단)</span>
            </label>
            <input type="range" min={0} max={100} step={1}
              value={subConfig.yPercent ?? 85}
              onChange={e => set({ yPercent: +e.target.value })}
              className="w-full accent-blue-500"
            />
          </div>

          {/* 한 번에 표시할 글자 수 */}
          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block mb-1">
              청크 글자 수 <span className="text-slate-300">{subConfig.maxCharsPerChunk ?? 15}자</span>
            </label>
            <input type="range" min={5} max={30} step={1}
              value={subConfig.maxCharsPerChunk ?? 15}
              onChange={e => set({ maxCharsPerChunk: +e.target.value })}
              className="w-full accent-blue-500"
            />
          </div>
        </div>
      </div>

      {/* ─── 오른쪽: 씬 목록 ─── */}
      <div className="flex-1 overflow-y-auto py-2">
        {scenes.map((s, i) => (
          <button
            key={i}
            onClick={() => setSelectedIdx(i)}
            className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${
              i === selectedIdx ? 'bg-blue-900/30 border-l-2 border-blue-500' : 'hover:bg-slate-800/60 border-l-2 border-transparent'
            }`}
          >
            <div className="w-20 h-12 rounded-lg overflow-hidden shrink-0 bg-slate-800 flex items-center justify-center">
              {s.imageData ? (
                <img src={`data:image/jpeg;base64,${s.imageData}`} className="w-full h-full object-cover" alt="" />
              ) : (
                <div className="w-4 h-4 border border-slate-600 border-t-transparent animate-spin rounded-full" />
              )}
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
