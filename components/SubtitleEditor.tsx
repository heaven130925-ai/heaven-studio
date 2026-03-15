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

// videoService의 자막 렌더링 로직과 동일 (canvas 기반)
function renderSubtitleOnCanvas(
  canvas: HTMLCanvasElement,
  imageData: string | null,
  text: string,
  config: SubtitleConfig
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const W = canvas.width;
  const H = canvas.height;

  // 배경 초기화
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, W, H);

  const drawText = () => {
    if (!text.trim()) return;

    const fontSize = config.fontSize;
    const lineSpacing = fontSize * 1.15;  // 줄간격 타이트하게
    const vPad = 6;   // 위아래 패딩 축소
    const hPad = 14;  // 좌우 패딩
    const safeMargin = 10;
    const align = config.textAlign ?? 'center';

    ctx.font = `${config.fontWeight ?? 700} ${fontSize}px ${config.fontFamily}`;
    ctx.textBaseline = 'middle';  // 수직 중앙 기준
    ctx.textAlign = align as CanvasTextAlign;

    // 자막 청크 분할
    const maxChars = config.maxCharsPerChunk ?? 15;
    const words = text.split('');
    const lines: string[] = [];
    let current = '';
    for (const ch of words) {
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

    // 항상 가로 중앙 고정
    let boxX = (W - boxWidth) / 2;
    boxX = Math.max(safeMargin, Math.min(boxX, W - safeMargin - boxWidth));

    const usableHeight = H - boxHeight - safeMargin * 2;
    let boxY = safeMargin + ((config.yPercent ?? 85) / 100) * usableHeight;
    boxY = Math.max(safeMargin, Math.min(boxY, H - safeMargin - boxHeight));

    // 텍스트 X: 항상 박스 가운데
    const textX = boxX + boxWidth / 2;

    // 배경
    const bg = config.backgroundColor ?? 'rgba(0,0,0,0)';
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      ctx.fillStyle = bg;
      ctx.beginPath();
      (ctx as any).roundRect(boxX, boxY, boxWidth, boxHeight, 6);
      ctx.fill();
    }

    // 텍스트 (middle baseline → 박스 내 수직 중앙)
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
  };

  if (imageData) {
    const img = new Image();
    img.onload = () => {
      // 이미지를 canvas에 맞게 letterbox로 그리기
      const imgAspect = img.width / img.height;
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
      ctx.drawImage(img, drawX, drawY, drawW, drawH);
      drawText();
    };
    img.src = `data:image/jpeg;base64,${imageData}`;
  } else {
    drawText();
  }
}

const SubtitleEditor: React.FC<Props> = ({ scenes, subConfig, onSubConfigChange, onNarrationChange, onExportVideo, isExporting }) => {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  // 오디오: React JSX 없이 직접 생성 (타이밍 문제 방지)
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  // 줌/패닝
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const set = (partial: Partial<SubtitleConfig>) => onSubConfigChange({ ...subConfig, ...partial });

  const scene = scenes[selectedIdx];
  const narration = scene?.narration ?? '';

  // audioData가 data:URL이면 그대로, raw base64면 prefix 붙이기
  const getAudioSrc = (s: typeof scene) =>
    s?.audioData
      ? (s.audioData.startsWith('data:') ? s.audioData : `data:audio/mpeg;base64,${s.audioData}`)
      : '';
  const audioSrc = getAudioSrc(scene);

  // 오디오 엘리먼트 마운트 시 한 번만 생성
  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    const onTimeUpdate = () => {
      if (audio.duration) setAudioProgress((audio.currentTime / audio.duration) * 100);
    };
    const onEnded = () => { setIsPlaying(false); setAudioProgress(0); };
    const onPlay  = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audioRef.current = null;
    };
  }, []);

  // 씬 변경 시 오디오 리셋 + src 직접 설정 + 강제 로드
  useEffect(() => {
    setIsPlaying(false);
    setAudioProgress(0);
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    const newSrc = getAudioSrc(scenes[selectedIdx]);
    audio.src = newSrc || '';
    if (newSrc) audio.load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdx, scenes]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || !audioSrc) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch((e) => { console.warn('play failed', e); setIsPlaying(false); });
    }
  };

  // 컨테이너 크기 추적 (경계선 계산용)
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

  // 이미지 경계 감지 (끝에 닿으면 선 표시)
  const maxPanX = containerSize.w * (zoom - 1) / 2;
  const maxPanY = containerSize.h * (zoom - 1) / 2;
  const snapThreshold = 8;
  const atLeft   = zoom > 1 && pan.x >= maxPanX - snapThreshold;
  const atRight  = zoom > 1 && pan.x <= -(maxPanX - snapThreshold);
  const atTop    = zoom > 1 && pan.y >= maxPanY - snapThreshold;
  const atBottom = zoom > 1 && pan.y <= -(maxPanY - snapThreshold);

  // 마우스 휠 줌 (Ctrl 없이도 동작)
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.min(3, Math.max(0.3, z - e.deltaY * 0.001)));
  }, []);

  // 드래그 패닝
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

  // 캔버스 재렌더
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // 폰트 로드 대기 (실제 사용 크기로 로드)
    document.fonts.load(`${subConfig.fontWeight ?? 700} ${subConfig.fontSize}px ${subConfig.fontFamily}`).then(() => {
      renderSubtitleOnCanvas(canvas, scene?.imageData ?? null, narration, subConfig);
    }).catch(() => {
      renderSubtitleOnCanvas(canvas, scene?.imageData ?? null, narration, subConfig);
    });
  }, [scene, narration, subConfig]);

  useEffect(() => { redraw(); }, [redraw]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* ─── 왼쪽: 캔버스 미리보기 + 컨트롤 ─── */}
      <div className="flex flex-col w-[68%] border-r border-slate-700/50 overflow-y-auto">
        {/* 줌/패닝 컨트롤 바 */}
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-900/80 border-b border-slate-800 shrink-0">
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
            className="text-[10px] text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 transition-colors font-mono">
            RESET
          </button>
          <button onClick={() => setZoom(z => Math.min(3, z + 0.01))}
            className="w-7 h-7 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-base font-bold transition-colors">+</button>
          <span className="text-xs text-slate-400 font-mono w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.max(0.3, z - 0.01))}
            className="w-7 h-7 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-base font-bold transition-colors">−</button>
          <span className="text-[10px] text-slate-600 ml-1">휠로 줌 · 드래그로 이동</span>
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
                className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-bold transition-all shadow-[0_0_12px_rgba(6,182,212,0.3)] disabled:opacity-40"
              >
                {isExporting ? '렌더링 중...' : '자막 포함 내보내기'}
              </button>
            </div>
          )}
        </div>

        {/* 캔버스 미리보기 — 줌/패닝 */}
        <div
          ref={canvasContainerRef}
          className="relative bg-[#0a0a0f] overflow-hidden cursor-grab active:cursor-grabbing select-none"
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

          {/* 중심 가이드라인 (드래그 중) — 중앙 정렬 시 빨간색 */}
          {isDragging && (() => {
            const snapPx = 6;
            const centeredX = Math.abs(pan.x) <= snapPx;
            const centeredY = Math.abs(pan.y) <= snapPx;
            return (
              <>
                <div className="absolute top-0 bottom-0 pointer-events-none" style={{
                  left: 'calc(50% - 0.5px)',
                  width: centeredX ? 2 : 1,
                  background: centeredX ? 'rgba(239,68,68,0.95)' : 'rgba(6,182,212,0.45)',
                  boxShadow: centeredX ? '0 0 6px rgba(239,68,68,0.7)' : 'none',
                }} />
                <div className="absolute left-0 right-0 pointer-events-none" style={{
                  top: 'calc(50% - 0.5px)',
                  height: centeredY ? 2 : 1,
                  background: centeredY ? 'rgba(239,68,68,0.95)' : 'rgba(6,182,212,0.45)',
                  boxShadow: centeredY ? '0 0 6px rgba(239,68,68,0.7)' : 'none',
                }} />
              </>
            );
          })()}

          {/* 경계 스냅 선 (이미지 끝에 닿으면) */}
          {atLeft   && <div className="absolute top-0 bottom-0 left-0 w-0.5 bg-amber-400/80 pointer-events-none shadow-[0_0_6px_rgba(251,191,36,0.8)]" />}
          {atRight  && <div className="absolute top-0 bottom-0 right-0 w-0.5 bg-amber-400/80 pointer-events-none shadow-[0_0_6px_rgba(251,191,36,0.8)]" />}
          {atTop    && <div className="absolute left-0 right-0 top-0 h-0.5 bg-amber-400/80 pointer-events-none shadow-[0_0_6px_rgba(251,191,36,0.8)]" />}
          {atBottom && <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-amber-400/80 pointer-events-none shadow-[0_0_6px_rgba(251,191,36,0.8)]" />}

          {!scene?.imageData && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-600 text-xs pointer-events-none">
              이미지 생성 대기 중...
            </div>
          )}
        </div>

        {/* 오디오 플레이어 */}
        <div className="flex items-center gap-3 px-4 py-2 bg-slate-900 border-b border-slate-800 shrink-0">
          <button
            onClick={togglePlay}
            disabled={!audioSrc}
            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black transition-all shrink-0 ${
              audioSrc ? 'bg-gradient-to-br from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-[0_0_8px_rgba(6,182,212,0.4)]' : 'bg-slate-800 text-slate-600 cursor-not-allowed'
            }`}
          >
            {isPlaying ? '■' : '▶'}
          </button>
          <div className="flex-1 relative h-1.5 bg-slate-800 rounded-full overflow-hidden cursor-pointer"
            onClick={e => {
              const audio = audioRef.current;
              if (!audio || !audioSrc) return;
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              audio.currentTime = ((e.clientX - rect.left) / rect.width) * (audio.duration || 0);
            }}
          >
            <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all" style={{ width: `${audioProgress}%` }} />
          </div>
          <span className="text-[10px] text-slate-500 shrink-0 w-16 text-right font-mono">
            {audioSrc ? (scene?.audioDuration ? `${scene.audioDuration.toFixed(1)}s` : '●') : '—'}
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
              className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-brand-500"
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
                      ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
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
                크기 <span className="text-slate-400 normal-case">{subConfig.fontSize}px</span>
              </label>
              <input type="range" min={20} max={120} step={2}
                value={subConfig.fontSize}
                onChange={e => set({ fontSize: +e.target.value })}
                className="w-full accent-brand-500"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block mb-1">
                굵기 <span className="text-slate-400 normal-case">{subConfig.fontWeight}</span>
              </label>
              <input type="range" min={100} max={900} step={100}
                value={subConfig.fontWeight}
                onChange={e => set({ fontWeight: +e.target.value })}
                className="w-full accent-brand-500"
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
                테두리 굵기 <span className="text-slate-400">{subConfig.strokeWidth}</span>
              </label>
              <input type="range" min={0} max={20} step={1}
                value={subConfig.strokeWidth}
                onChange={e => set({ strokeWidth: +e.target.value })}
                className="w-full accent-brand-500"
              />
            </div>
          </div>

          {/* 배경 + 텍스트 정렬 */}
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
                      subConfig.backgroundColor === o.val ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
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
                      (subConfig.textAlign ?? 'center') === a ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}>
                    {a === 'left' ? '좌' : a === 'center' ? '중' : '우'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 세로 위치 슬라이더 (가로는 항상 중앙 고정) */}
          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block mb-1">
              세로 위치 <span className="text-slate-400 normal-case">{subConfig.yPercent ?? 85}% &nbsp;(0=상단 / 100=하단)</span>
            </label>
            <input type="range" min={0} max={100} step={1}
              value={subConfig.yPercent ?? 85}
              onChange={e => set({ yPercent: +e.target.value })}
              className="w-full accent-brand-500"
            />
          </div>

          {/* 자막 청크 크기 */}
          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block mb-1">
              한 번에 표시할 글자 수 <span className="text-slate-400">{subConfig.maxCharsPerChunk ?? 15}자</span>
            </label>
            <input type="range" min={5} max={30} step={1}
              value={subConfig.maxCharsPerChunk ?? 15}
              onChange={e => set({ maxCharsPerChunk: +e.target.value })}
              className="w-full accent-brand-500"
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
              i === selectedIdx ? 'bg-brand-900/40 border-l-2 border-brand-500' : 'hover:bg-slate-800/60 border-l-2 border-transparent'
            }`}
          >
            {/* 썸네일 */}
            <div className="w-20 h-12 rounded-lg overflow-hidden shrink-0 bg-slate-800 flex items-center justify-center">
              {s.imageData ? (
                <img src={`data:image/jpeg;base64,${s.imageData}`} className="w-full h-full object-cover" alt="" />
              ) : (
                <div className="w-4 h-4 border border-slate-600 border-t-transparent animate-spin rounded-full" />
              )}
            </div>
            {/* 텍스트 */}
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
