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
    const lineHeight = fontSize * 1.4;
    const padding = 16;
    const safeMargin = 10;
    const xPercent = config.xPercent ?? 50;
    const align = config.textAlign ?? 'center';

    // 폰트 로드 대기 후 렌더
    ctx.font = `${config.fontWeight ?? 700} ${fontSize}px ${config.fontFamily}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = align as CanvasTextAlign;

    // 자막 청크 분할 (maxCharsPerChunk 기준)
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
    let boxWidth = maxLineWidth + padding * 2;
    const boxHeight = displayLines.length * lineHeight + padding * 2;

    const maxBoxWidth = W - safeMargin * 2;
    if (boxWidth > maxBoxWidth) boxWidth = maxBoxWidth;

    const usableWidth = W - boxWidth - safeMargin * 2;
    let boxX = safeMargin + (xPercent / 100) * usableWidth;
    boxX = Math.max(safeMargin, Math.min(boxX, W - safeMargin - boxWidth));

    const usableHeight = H - boxHeight - safeMargin * 2;
    let boxY = safeMargin + ((config.yPercent ?? 85) / 100) * usableHeight;
    boxY = Math.max(safeMargin, Math.min(boxY, H - safeMargin - boxHeight));

    const textX = align === 'left' ? boxX + padding
      : align === 'right' ? boxX + boxWidth - padding
      : boxX + boxWidth / 2;

    // 배경
    const bg = config.backgroundColor ?? 'rgba(0,0,0,0)';
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      ctx.fillStyle = bg;
      ctx.beginPath();
      (ctx as any).roundRect(boxX, boxY, boxWidth, boxHeight, 8);
      ctx.fill();
    }

    // 텍스트
    displayLines.forEach((line, i) => {
      const textY = boxY + padding + i * lineHeight;
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

const SubtitleEditor: React.FC<Props> = ({ scenes, subConfig, onSubConfigChange, onNarrationChange }) => {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const set = (partial: Partial<SubtitleConfig>) => onSubConfigChange({ ...subConfig, ...partial });

  const scene = scenes[selectedIdx];
  const narration = scene?.narration ?? '';

  // 캔버스 재렌더
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // 폰트 로드 대기
    document.fonts.load(`${subConfig.fontWeight ?? 700} 40px ${subConfig.fontFamily}`).then(() => {
      renderSubtitleOnCanvas(canvas, scene?.imageData ?? null, narration, subConfig);
    }).catch(() => {
      renderSubtitleOnCanvas(canvas, scene?.imageData ?? null, narration, subConfig);
    });
  }, [scene, narration, subConfig]);

  useEffect(() => { redraw(); }, [redraw]);

  // 위치 그리드 (3x3)
  const posGrid = [
    { x: 0,  y: 0,  label: '↖' },
    { x: 50, y: 0,  label: '↑' },
    { x: 100,y: 0,  label: '↗' },
    { x: 0,  y: 50, label: '←' },
    { x: 50, y: 50, label: '●' },
    { x: 100,y: 50, label: '→' },
    { x: 0,  y: 85, label: '↙' },
    { x: 50, y: 85, label: '↓' },
    { x: 100,y: 85, label: '↘' },
  ];

  return (
    <div className="flex h-full overflow-hidden">
      {/* ─── 왼쪽: 캔버스 미리보기 + 컨트롤 ─── */}
      <div className="flex flex-col w-[58%] border-r border-slate-800 overflow-y-auto">
        {/* 캔버스 미리보기 */}
        <div className="relative bg-black flex items-center justify-center" style={{ aspectRatio: '16/9' }}>
          <canvas
            ref={canvasRef}
            width={960}
            height={540}
            className="w-full h-full"
          />
          {!scene?.imageData && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-600 text-sm">
              이미지 생성 대기 중...
            </div>
          )}
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

          {/* 위치 그리드 (3x3) */}
          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block mb-2">위치</label>
            <div className="grid grid-cols-3 gap-1 w-28">
              {posGrid.map(p => {
                const active = Math.abs((subConfig.xPercent ?? 50) - p.x) < 5 &&
                               Math.abs((subConfig.yPercent ?? 85) - p.y) < 10;
                return (
                  <button
                    key={`${p.x}-${p.y}`}
                    onClick={() => set({ xPercent: p.x, yPercent: p.y })}
                    className={`aspect-square rounded text-sm font-bold transition-colors ${
                      active ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
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
