/**
 * ThumbnailEditor — 유튜브 썸네일 편집기
 * - 오른쪽: 씬 이미지 목록 + 업로드 + AI 생성
 * - 왼쪽: 1280×720 캔버스 편집 + 텍스트 오버레이 + 다운로드
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { GeneratedAsset } from '../types';

interface Props {
  scenes: GeneratedAsset[];
  topic?: string;
}

const FONTS = [
  { label: 'Impact', value: 'Impact, "Arial Black", sans-serif' },
  { label: 'Arial Black', value: '"Arial Black", sans-serif' },
  { label: 'Bold Sans', value: 'sans-serif' },
  { label: 'Serif', value: 'Georgia, serif' },
  { label: 'Mono', value: '"Courier New", monospace' },
];

const ThumbnailEditor: React.FC<Props> = ({ scenes, topic }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 이미지 선택
  const [selectedSceneIdx, setSelectedSceneIdx] = useState<number | null>(null);
  const [customImage, setCustomImage] = useState<string | null>(null);
  const [aiImages, setAiImages] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  // 텍스트 오버레이
  const [lines, setLines] = useState<string[]>([topic || '', '']);
  const [fontSize, setFontSize] = useState(88);
  const [textColor, setTextColor] = useState('#ffffff');
  const [strokeColor, setStrokeColor] = useState('#000000');
  const [textY, setTextY] = useState(78);
  const [fontIdx, setFontIdx] = useState(0);
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('center');
  const [lineSpacing, setLineSpacing] = useState(1.15);

  // 활성 베이스 이미지
  const baseImage = customImage
    ?? (selectedSceneIdx !== null && scenes[selectedSceneIdx]?.imageData
      ? `data:image/jpeg;base64,${scenes[selectedSceneIdx].imageData}`
      : null);

  // 캔버스 렌더링
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = 1280;
    canvas.height = 720;

    const draw = (img: HTMLImageElement | null) => {
      ctx.clearRect(0, 0, 1280, 720);
      if (img) {
        // cover fit
        const iw = img.width, ih = img.height;
        const scale = Math.max(1280 / iw, 720 / ih);
        const dw = iw * scale, dh = ih * scale;
        ctx.drawImage(img, (1280 - dw) / 2, (720 - dh) / 2, dw, dh);
      } else {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, 1280, 720);
        ctx.fillStyle = '#334155';
        ctx.font = '28px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('오른쪽에서 이미지를 선택하세요', 640, 360);
        return;
      }

      const activeLines = lines.filter(l => l.trim());
      if (activeLines.length === 0) return;

      const fam = FONTS[fontIdx].value;
      const ls = fontSize * lineSpacing;
      const totalH = ls * (activeLines.length - 1) + fontSize;
      const xPx = textAlign === 'left' ? 60 : textAlign === 'right' ? 1220 : 640;
      let startY = Math.round((textY / 100) * 720) - totalH / 2 + fontSize / 2;

      ctx.font = `900 ${fontSize}px ${fam}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = textAlign as CanvasTextAlign;

      activeLines.forEach((line, i) => {
        const y = startY + ls * i;
        const sw = Math.max(2, Math.round(fontSize * 0.1));
        ctx.lineWidth = sw;
        ctx.strokeStyle = strokeColor;
        ctx.lineJoin = 'round';
        ctx.strokeText(line, xPx, y);
        ctx.fillStyle = textColor;
        ctx.fillText(line, xPx, y);
      });
    };

    if (baseImage) {
      const img = new Image();
      img.onload = () => draw(img);
      img.src = baseImage;
    } else {
      draw(null);
    }
  }, [baseImage, lines, fontSize, textColor, strokeColor, textY, fontIdx, textAlign, lineSpacing]);

  const handleDownload = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !baseImage) return;
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `thumbnail_${Date.now()}.jpg`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/jpeg', 0.95);
  }, [baseImage]);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { setCustomImage(ev.target?.result as string); setSelectedSceneIdx(null); };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = ev => { setCustomImage(ev.target?.result as string); setSelectedSceneIdx(null); };
    reader.readAsDataURL(file);
  };

  const handleAiGenerate = async () => {
    setIsGenerating(true);
    try {
      const { generateThumbnail } = await import('../services/geminiService');
      const keyword = topic || lines.find(l => l.trim()) || '유튜브 썸네일';
      const result = await generateThumbnail(keyword, lines.filter(l => l.trim()).join(' '));
      if (result) {
        const src = `data:image/jpeg;base64,${result}`;
        setAiImages(prev => [src, ...prev]);
        setCustomImage(src);
        setSelectedSceneIdx(null);
      }
    } catch (e) { console.error(e); }
    finally { setIsGenerating(false); }
  };

  const setLine = (idx: number, val: string) => {
    setLines(prev => { const next = [...prev]; next[idx] = val; return next; });
  };

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── 왼쪽: 캔버스 + 컨트롤 ── */}
      <div className="flex-1 flex flex-col overflow-y-auto p-4 gap-4 min-w-0">

        {/* 캔버스 */}
        <div
          className="relative rounded-xl overflow-hidden bg-slate-950 border border-slate-700/60 aspect-video shrink-0 shadow-xl"
          onDragOver={e => e.preventDefault()}
          onDrop={handleDrop}
        >
          <canvas ref={canvasRef} className="w-full h-full object-contain" />
        </div>

        {/* 텍스트 오버레이 컨트롤 */}
        <div className="bg-slate-900/60 rounded-xl p-4 space-y-4 border border-emerald-500/20 shadow-[0_0_10px_rgba(52,211,153,0.08)]">
          <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider">텍스트 오버레이</p>

          {/* 2줄 입력 */}
          <div className="space-y-2">
            {[0, 1].map(i => (
              <input key={i}
                type="text"
                value={lines[i]}
                onChange={e => setLine(i, e.target.value)}
                placeholder={i === 0 ? '첫 번째 줄...' : '두 번째 줄 (선택)'}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-blue-500"
              />
            ))}
          </div>

          {/* 크기 + 색상 */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block font-bold">크기 {fontSize}px</label>
              <input type="range" min={30} max={200} step={4}
                value={fontSize} onChange={e => setFontSize(+e.target.value)}
                className="w-full accent-blue-500" />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block font-bold">글자색</label>
              <input type="color" value={textColor} onChange={e => setTextColor(e.target.value)}
                className="w-full h-8 rounded-lg bg-slate-800 border border-slate-700 cursor-pointer" />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block font-bold">테두리색</label>
              <input type="color" value={strokeColor} onChange={e => setStrokeColor(e.target.value)}
                className="w-full h-8 rounded-lg bg-slate-800 border border-slate-700 cursor-pointer" />
            </div>
          </div>

          {/* 위치 + 줄간격 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block font-bold">세로 위치 {textY}%</label>
              <input type="range" min={10} max={95} step={1}
                value={textY} onChange={e => setTextY(+e.target.value)}
                className="w-full accent-blue-500" />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block font-bold">줄 간격 ×{lineSpacing.toFixed(2)}</label>
              <input type="range" min={1.0} max={2.0} step={0.05}
                value={lineSpacing} onChange={e => setLineSpacing(+e.target.value)}
                className="w-full accent-blue-500" />
            </div>
          </div>

          {/* 폰트 + 정렬 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-slate-400 mb-1.5 block font-bold">폰트</label>
              <div className="flex flex-col gap-1">
                {FONTS.map((f, i) => (
                  <button key={f.value} onClick={() => setFontIdx(i)}
                    className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-colors text-left ${fontIdx === i ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                    style={{ fontFamily: f.value }}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[11px] text-slate-400 mb-1.5 block font-bold">정렬</label>
              <div className="flex gap-1">
                {(['left', 'center', 'right'] as const).map(a => (
                  <button key={a} onClick={() => setTextAlign(a)}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${textAlign === a ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
                    {a === 'left' ? '좌' : a === 'center' ? '중' : '우'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 다운로드 버튼 */}
        <button
          onClick={handleDownload}
          disabled={!baseImage}
          className="w-full py-3.5 rounded-xl font-black text-sm transition-all disabled:opacity-40
            bg-blue-600/20 border border-blue-500/50 text-blue-200 hover:bg-blue-600/35
            shadow-[0_0_20px_rgba(59,130,246,0.2)] hover:shadow-[0_0_30px_rgba(59,130,246,0.35)]"
        >
          썸네일 다운로드 (1280×720 JPG)
        </button>
      </div>

      {/* ── 오른쪽: 이미지 선택 ── */}
      <div className="w-64 border-l border-slate-800 flex flex-col overflow-hidden shrink-0">

        {/* 업로드 + AI 생성 */}
        <div className="p-3 space-y-2 border-b border-slate-800 shrink-0">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
          <button onClick={() => fileInputRef.current?.click()}
            className="w-full py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition-colors">
            내 이미지 업로드
          </button>
          <button onClick={handleAiGenerate} disabled={isGenerating}
            className="w-full py-2 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/35 border border-indigo-500/40 text-indigo-300 text-xs font-bold transition-colors disabled:opacity-40">
            {isGenerating
              ? <span className="flex items-center justify-center gap-2"><span className="w-3 h-3 border border-indigo-400 border-t-transparent animate-spin rounded-full" />생성 중...</span>
              : 'AI 새 이미지 생성'}
          </button>
        </div>

        {/* AI 생성 이미지 목록 */}
        {aiImages.length > 0 && (
          <div className="p-2 border-b border-slate-800 shrink-0">
            <p className="text-[10px] text-slate-500 font-bold uppercase mb-2 px-1">AI 생성</p>
            <div className="grid grid-cols-2 gap-1">
              {aiImages.map((img, i) => (
                <button key={i}
                  onClick={() => { setCustomImage(img); setSelectedSceneIdx(null); }}
                  className={`aspect-video rounded-lg overflow-hidden border-2 transition-all ${
                    customImage === img && selectedSceneIdx === null
                      ? 'border-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.5)]'
                      : 'border-transparent hover:border-slate-500'
                  }`}>
                  <img src={img} className="w-full h-full object-cover" alt="" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 씬 이미지 목록 */}
        <div className="flex-1 overflow-y-auto p-2">
          <p className="text-[10px] text-slate-500 font-bold uppercase mb-2 px-1">씬 이미지 ({scenes.length}개)</p>
          <div className="space-y-1">
            {scenes.map((s, i) => (
              <button key={i}
                onClick={() => { setSelectedSceneIdx(i); setCustomImage(null); }}
                className={`w-full flex items-center gap-2 p-1.5 rounded-lg border-2 transition-all text-left ${
                  selectedSceneIdx === i && !customImage
                    ? 'border-blue-400 bg-blue-900/20 shadow-[0_0_8px_rgba(59,130,246,0.25)]'
                    : 'border-transparent hover:bg-slate-800/60'
                }`}
              >
                <div className="w-14 h-9 rounded-md overflow-hidden bg-slate-800 shrink-0 border border-slate-700/50">
                  {s.imageData
                    ? <img src={`data:image/jpeg;base64,${s.imageData}`} className="w-full h-full object-cover" alt="" />
                    : <div className="w-full h-full flex items-center justify-center">
                        <div className="w-3 h-3 border border-slate-600 border-t-transparent animate-spin rounded-full" />
                      </div>
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-slate-500 font-bold">씬 {i + 1}</p>
                  <p className="text-[11px] text-slate-300 leading-tight line-clamp-2">{s.narration}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ThumbnailEditor;
