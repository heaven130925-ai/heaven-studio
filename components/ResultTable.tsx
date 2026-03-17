
import React, { useRef, useState, useEffect, memo, useCallback } from 'react';
import { GeneratedAsset, SubtitleConfig, DEFAULT_SUBTITLE_CONFIG } from '../types';
import { CONFIG } from '../config';
import { downloadProjectZip, downloadMediaZip } from '../utils/csvHelper';
import { downloadSrt } from '../services/srtService';
import { exportAssetsToZip } from '../services/exportService';

const FONT_OPTIONS = [
  { label: 'Noto Sans KR', value: '"Noto Sans KR", "Malgun Gothic", sans-serif' },
  { label: '맑은 고딕', value: '"Malgun Gothic", sans-serif' },
  { label: '나눔고딕', value: '"Nanum Gothic", sans-serif' },
  { label: '나눔명조', value: '"Nanum Myeongjo", serif' },
  { label: '나눔바른고딕', value: '"Nanum Barun Gothic", "Nanum Gothic", sans-serif' },
  { label: '나눔스퀘어', value: '"Nanum Square", "Nanum Gothic", sans-serif' },
  { label: '돋움', value: '"Dotum", sans-serif' },
  { label: '굴림', value: '"Gulim", sans-serif' },
  { label: '바탕', value: '"Batang", serif' },
  { label: '궁서', value: '"Gungsuh", serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Arial Black', value: '"Arial Black", Gadget, sans-serif' },
  { label: 'Impact', value: 'Impact, "Arial Narrow", sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
];

const FONT_WEIGHT_OPTIONS = [
  { label: '가늘게', value: 300 },
  { label: '보통', value: 400 },
  { label: '중간', value: 500 },
  { label: '굵게', value: 700 },
  { label: '아주 굵게', value: 900 },
];

const FONT_SIZE_OPTIONS = [24, 32, 40, 48, 56, 64];

const BG_OPTIONS = [
  { label: '없음', value: 'rgba(0,0,0,0)' },
  { label: '반투명', value: 'rgba(0,0,0,0.75)' },
  { label: '불투명', value: 'rgba(0,0,0,0.95)' },
  { label: '흰색', value: 'rgba(255,255,255,0.85)' },
];

function loadSubtitleConfig(): SubtitleConfig {
  try {
    const saved = localStorage.getItem(CONFIG.STORAGE_KEYS.SUBTITLE_CONFIG);
    if (saved) return { ...DEFAULT_SUBTITLE_CONFIG, ...JSON.parse(saved) };
  } catch {}
  return { ...DEFAULT_SUBTITLE_CONFIG };
}

function saveSubtitleConfig(cfg: SubtitleConfig) {
  localStorage.setItem(CONFIG.STORAGE_KEYS.SUBTITLE_CONFIG, JSON.stringify(cfg));
}

interface ResultTableProps {
  data: GeneratedAsset[];
  onRegenerateImage?: (index: number) => void;
  onRegenerateWithPrompt?: (index: number, customPrompt: string) => void;
  onUpgradeImage?: (index: number) => void;
  onExportVideo?: (enableSubtitles: boolean) => void;
  onGenerateAnimation?: (index: number) => void;  // 영상 변환 콜백
  isExporting?: boolean;
  animatingIndices?: Set<number>;  // 현재 영상 변환 중인 인덱스들
  onSelectThumbnail?: (imageBase64: string) => void;
  aspectRatio?: '16:9' | '9:16';
}

// 오디오 디코딩 함수 (컴포넌트 외부로 이동하여 재생성 방지)
async function decodeAudio(base64: string, ctx: AudioContext): Promise<AudioBuffer> {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

  try {
    return await ctx.decodeAudioData(bytes.buffer.slice(0));
  } catch (e) {
    const dataInt16 = new Int16Array(bytes.buffer);
    const frameCount = dataInt16.length;
    const buffer = ctx.createBuffer(1, frameCount, 24000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i] / 32768.0;
    }
    return buffer;
  }
}

// 이미지 Lazy Loading 컴포넌트 (Intersection Observer 사용)
const LazyImage: React.FC<{
  src: string;
  alt: string;
  className?: string;
}> = memo(({ src, alt, className }) => {
  const imgRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' } // 100px 전에 미리 로드
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={imgRef} className="w-full h-full">
      {isVisible ? (
        <img
          src={src}
          alt={alt}
          className={`${className} ${isLoaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
          onLoad={() => setIsLoaded(true)}
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full bg-slate-800 animate-pulse" />
      )}
    </div>
  );
});

LazyImage.displayName = 'LazyImage';

// 오디오 플레이어 메모이제이션 (props가 같으면 리렌더 방지)
const AudioPlayer: React.FC<{ base64: string }> = memo(({ base64 }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const stopAudio = () => {
    if (sourceRef.current) { try { sourceRef.current.stop(); } catch (e) {} sourceRef.current = null; }
    setIsPlaying(false);
  };

  const playAudio = async () => {
    if (isPlaying) { stopAudio(); return; }
    try {
      setIsPlaying(true);
      if (!audioContextRef.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        audioContextRef.current = new AudioContextClass();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') await ctx.resume();
      
      const audioBuffer = await decodeAudio(base64, ctx);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => setIsPlaying(false);
      source.start();
      sourceRef.current = source;
    } catch (error) { console.error(error); setIsPlaying(false); }
  };

  return (
    <button onClick={playAudio} className={`p-2.5 rounded-full border transition-all ${isPlaying ? 'bg-brand-600 border-brand-500 text-white animate-pulse' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>
      {isPlaying ? <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg> : <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>}
    </button>
  );
});

AudioPlayer.displayName = 'AudioPlayer';

// 다운로드 헬퍼 함수
function downloadImage(base64: string, sceneNumber: number) {
  const a = document.createElement('a');
  a.href = `data:image/jpeg;base64,${base64}`;
  a.download = `scene_${String(sceneNumber).padStart(2, '0')}.jpg`;
  a.click();
}

function downloadAudio(base64: string, sceneNumber: number) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `scene_${String(sceneNumber).padStart(2, '0')}.mp3`;
  a.click();
  URL.revokeObjectURL(url);
}

// 테이블 행 컴포넌트 (개별 행 메모이제이션으로 리렌더 최소화)
interface TableRowProps {
  row: GeneratedAsset;
  index: number;
  isAnimating: boolean;
  aspectRatio?: '16:9' | '9:16';
  subConfig: SubtitleConfig;
  onRegenerateImage?: (index: number) => void;
  onRegenerateWithPrompt?: (index: number, customPrompt: string) => void;
  onGenerateAnimation?: (index: number) => void;
  onOpenPreview?: (src: string) => void;
  onSelectThumbnail?: (imageBase64: string) => void;
}

const TableRow: React.FC<TableRowProps> = memo(({ row, index, isAnimating, aspectRatio = '16:9', subConfig, onRegenerateImage, onRegenerateWithPrompt, onGenerateAnimation, onOpenPreview, onSelectThumbnail }) => {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editPrompt, setEditPrompt] = useState(row.visualPrompt || '');

  const handleApplyPrompt = () => {
    if (editPrompt.trim()) {
      onRegenerateWithPrompt?.(index, editPrompt.trim());
      setIsEditOpen(false);
    }
  };

  return (
    <tr className="group hover:bg-white/[0.03] transition-colors">
      <td className="py-5 px-6 align-top font-mono text-white/25 text-[10px]">#{row.sceneNumber.toString().padStart(2, '0')}</td>
      {/* 이미지 + 음성/다운로드 (왼쪽 배치) */}
      <td className="py-5 px-4 align-top">
        <div className="flex flex-col items-center gap-2">
        <div className={`relative rounded-xl overflow-hidden bg-black border border-white/[0.08] shadow-inner group/img ${aspectRatio === '9:16' ? 'aspect-[9/16] w-44' : 'aspect-video w-72'}`}>
          {row.status === 'generating' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent animate-spin rounded-full"></div>
              <span className="text-[7px] text-brand-500 font-black uppercase tracking-widest">렌더링 중</span>
            </div>
          ) : isAnimating ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-cyan-950/30">
              <div className="w-5 h-5 border-2 border-cyan-500 border-t-transparent animate-spin rounded-full"></div>
              <span className="text-[7px] text-red-400 font-black uppercase tracking-widest">영상 변환 중</span>
            </div>
          ) : row.status === 'error' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-red-950/30 border-2 border-dashed border-red-800/50 m-2 rounded-lg">
              <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-[8px] text-red-400 font-black uppercase">생성 실패</span>
              <button
                onClick={() => onRegenerateImage?.(index)}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-[9px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-lg"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                다시 생성
              </button>
            </div>
          ) : row.videoData ? (
            <>
              <video src={row.videoData} className="w-full h-full object-cover" autoPlay loop muted playsInline />
              <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-cyan-500/80 text-[6px] font-black text-white uppercase">영상</div>
              <div className="absolute inset-0 bg-slate-950/80 opacity-0 group-hover/img:opacity-100 transition-all flex items-center justify-center gap-1.5">
                <button onClick={() => onRegenerateImage?.(index)} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white transition-all" title="이미지 재생성">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
                <button onClick={() => onGenerateAnimation?.(index)} className="p-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/40 border border-cyan-500/30 text-red-400 transition-all" title="영상 재생성">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </button>
              </div>
            </>
          ) : row.imageData ? (
            <>
              <LazyImage
                src={`data:image/jpeg;base64,${row.imageData}`}
                alt="Scene"
                className="w-full h-full object-cover transition-transform group-hover/img:scale-105"
              />
              {row.subtitleData && row.subtitleData.meaningChunks && row.subtitleData.meaningChunks.length > 0 && (
                <div
                  className="absolute left-0 right-0 px-2 text-center pointer-events-none"
                  style={{
                    top: subConfig.yPercent !== undefined ? `calc(${subConfig.yPercent}% - 16px)` : undefined,
                    bottom: subConfig.yPercent === undefined ? 8 : undefined,
                    fontFamily: subConfig.fontFamily,
                    fontSize: Math.round(subConfig.fontSize * 0.35) + 'px',
                    fontWeight: subConfig.fontWeight ?? 700,
                    color: subConfig.textColor,
                    WebkitTextStroke: (subConfig.strokeWidth ?? 4) > 0 ? `${Math.round((subConfig.strokeWidth ?? 4) * 0.35)}px ${subConfig.strokeColor ?? '#000'}` : undefined,
                    background: subConfig.backgroundColor !== 'rgba(0,0,0,0)' ? subConfig.backgroundColor : undefined,
                    borderRadius: '4px',
                    padding: '2px 6px',
                  }}
                >
                  {row.subtitleData.meaningChunks[0].text}
                </div>
              )}
              <div className="absolute inset-0 bg-slate-950/80 opacity-0 group-hover/img:opacity-100 transition-all flex items-center justify-center gap-1.5">
                <button onClick={() => onOpenPreview?.(`data:image/jpeg;base64,${row.imageData}`)} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white transition-all" title="크게 보기">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" /></svg>
                </button>
                <button onClick={() => onRegenerateImage?.(index)} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white transition-all" title="이미지 재생성">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
                <button onClick={() => onGenerateAnimation?.(index)} className="p-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/40 border border-cyan-500/30 text-red-400 transition-all" title="영상 변환">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </button>
                <button onClick={() => downloadImage(row.imageData!, row.sceneNumber)} className="p-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/40 border border-emerald-500/30 text-emerald-400 transition-all" title="이미지 다운로드">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                </button>
                <button onClick={() => onSelectThumbnail?.(row.imageData!)} className="p-2 rounded-lg bg-yellow-500/20 hover:bg-yellow-500/40 border border-yellow-500/30 text-yellow-400 transition-all" title="썸네일 베이스로 선택">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                </button>
              </div>
            </>
          ) : <div className="absolute inset-0 flex items-center justify-center border-2 border-dashed border-slate-800 m-2 rounded-lg"><span className="text-[7px] text-slate-700 font-black uppercase">대기 중</span></div>}
        </div>
        {/* 음성 + 다운로드 (이미지 아래) */}
        {row.audioData ? (
          <div className="flex items-center gap-2">
            <AudioPlayer base64={row.audioData} />
            <button onClick={() => downloadAudio(row.audioData!, row.sceneNumber)} className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-emerald-400 hover:border-emerald-500/30 transition-all" title="음성 다운로드">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 opacity-30"><div className="w-2.5 h-2.5 border-2 border-slate-700 border-t-slate-500 animate-spin rounded-full"></div><span className="text-[6px] text-slate-600 font-black uppercase">VO</span></div>
        )}
        </div>
      </td>
      <td className="py-5 px-6 align-top">
        <div className="space-y-3">
          <p className="text-white text-sm leading-relaxed font-medium">{row.narration}</p>
          {row.analysis?.composition_type && (
            <div className="flex flex-wrap gap-1">
              <span className={`text-[7px] font-black px-1.5 py-0.5 rounded border uppercase ${
                row.analysis.composition_type === 'MACRO' ? 'text-brand-400 bg-brand-400/5 border-brand-400/20' :
                row.analysis.composition_type === 'STANDARD' ? 'text-emerald-400 bg-emerald-400/5 border-emerald-400/20' :
                'text-amber-400 bg-amber-400/5 border-amber-400/20'
              }`}>{row.analysis.composition_type}</span>
              {row.analysis.sentiment && (
                <span className={`text-[7px] font-black px-1.5 py-0.5 rounded border uppercase ${
                  row.analysis.sentiment === 'POSITIVE' ? 'text-green-400 bg-green-400/5 border-green-400/20' :
                  row.analysis.sentiment === 'NEGATIVE' ? 'text-red-400 bg-red-400/5 border-red-400/20' :
                  'text-slate-400 bg-slate-400/5 border-slate-400/20'
                }`}>{row.analysis.sentiment}</span>
              )}
            </div>
          )}
        </div>
      </td>
      <td className="py-5 px-6 align-top">
        {isEditOpen ? (
          <div className="space-y-2">
            <textarea
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              className="w-full h-36 bg-slate-950 rounded-lg p-3 border border-brand-500/50 text-xs text-slate-300 font-mono leading-relaxed resize-y focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400/30"
              placeholder="이미지 프롬프트를 수정하세요..."
            />
            <div className="flex gap-1.5">
              <button
                onClick={handleApplyPrompt}
                className="flex-1 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-[9px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                적용 후 재생성
              </button>
              <button
                onClick={() => { setEditPrompt(row.visualPrompt || ''); setIsEditOpen(false); }}
                className="px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white/50 text-[9px] font-black uppercase tracking-wider transition-all border border-white/[0.08]"
              >
                취소
              </button>
            </div>
          </div>
        ) : (
          <div className="relative group/prompt">
            <div className="bg-white/[0.03] rounded-lg p-3 border border-white/[0.06] text-xs text-white/50 font-mono leading-relaxed whitespace-pre-wrap">
              {row.visualPrompt}
            </div>
            <button
              onClick={() => { setEditPrompt(row.visualPrompt || ''); setIsEditOpen(true); }}
              className="absolute top-1.5 right-1.5 opacity-0 group-hover/prompt:opacity-100 transition-opacity p-1.5 rounded-md bg-white/[0.08] hover:bg-cyan-500/30 border border-white/[0.1] hover:border-red-500/40 text-white/40 hover:text-white"
              title="프롬프트 편집"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
            </button>
          </div>
        )}
      </td>
    </tr>
  );
});

TableRow.displayName = 'TableRow';

const ResultTable: React.FC<ResultTableProps> = ({ data, onRegenerateImage, onRegenerateWithPrompt, onExportVideo, onGenerateAnimation, isExporting, animatingIndices, onSelectThumbnail, aspectRatio: aspectRatioProp }) => {
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const onOpenPreview = useCallback((src: string) => setPreviewSrc(src), []);
  const aspectRatio = aspectRatioProp ?? ((localStorage.getItem(CONFIG.STORAGE_KEYS.ASPECT_RATIO) as '16:9' | '9:16') || '16:9');
  const [subConfig, setSubConfig] = useState<SubtitleConfig>(() => loadSubtitleConfig());
  const [showSubSettings, setShowSubSettings] = useState(false);

  const updateSub = useCallback(<K extends keyof SubtitleConfig>(key: K, value: SubtitleConfig[K]) => {
    setSubConfig((prev: SubtitleConfig) => {
      const next = { ...prev, [key]: value };
      saveSubtitleConfig(next);
      return next;
    });
  }, []);

  if (data.length === 0) return null;

  return (
    <div className="w-full pb-32 animate-in fade-in slide-in-from-bottom-4 duration-500" style={{ maxWidth: '1600px', margin: '0 auto' }}>
      {/* 이미지 미리보기 모달 */}
      {previewSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setPreviewSrc(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <img src={previewSrc} alt="Preview" className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl object-contain" />
            <button
              onClick={() => setPreviewSrc(null)}
              className="absolute top-3 right-3 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white transition-all"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <a
              href={previewSrc}
              download={`preview_${Date.now()}.jpg`}
              className="absolute bottom-3 right-3 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-black flex items-center gap-1.5 transition-all"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              다운로드
            </a>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6 bg-black/60 backdrop-blur-md p-5 rounded-3xl border border-white/[0.08]">
        <div className="flex items-center gap-4">
          <div className="w-0.5 h-10 bg-gradient-to-b from-red-400/60 to-rose-400/30 rounded-full shadow-[0_0_6px_rgba(239,68,68,0.25)]"></div>
          <div>
            <h2 className="text-xl font-black text-white tracking-tight">Heaven 1.0 마스터 스토리보드</h2>
            <p className="text-white/25 text-[9px] font-bold uppercase tracking-widest">Ultra-Detail Identity Sync Active</p>
          </div>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {[
            { label: '전체 프로젝트 저장', onClick: () => downloadProjectZip(data) },
            { label: '이미지+음성 내보내기', onClick: () => downloadMediaZip(data) },
            { label: '엑셀+이미지 내보내기', onClick: () => exportAssetsToZip(data, `스토리보드_${new Date().toLocaleDateString('ko-KR')}`) },
            { label: 'SRT 자막', onClick: async () => await downloadSrt(data, `subtitles_${Date.now()}.srt`) },
          ].map(btn => (
            <button key={btn.label} onClick={btn.onClick}
              className="px-3.5 py-2 rounded-xl bg-emerald-600/20 border border-emerald-500/50 text-emerald-200 font-bold text-[10px] hover:bg-emerald-600/35 hover:border-emerald-400/70 transition-all shadow-[0_0_8px_rgba(52,211,153,0.2)] flex items-center gap-1.5">
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* 자막 설정 패널 */}
      {showSubSettings && (
        <div className="mb-4 bg-black/60 backdrop-blur-md border border-violet-500/25 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-violet-400 font-black text-xs uppercase tracking-widest">자막 설정</span>
            <span className="text-white/25 text-[10px]">MP4 (자막 O) 내보낼 때 적용됩니다</span>
          </div>

          {/* 글자 수 */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[11px] text-slate-400 w-16 shrink-0">글자 수</span>
            <div className="flex items-center gap-2 flex-1">
              <input type="range" min={5} max={30} step={1}
                value={subConfig.maxCharsPerChunk ?? 15}
                onChange={(e) => updateSub('maxCharsPerChunk', Number(e.target.value))}
                className="flex-1 accent-violet-500" />
              <input type="number" min={5} max={30}
                value={subConfig.maxCharsPerChunk ?? 15}
                onChange={(e) => updateSub('maxCharsPerChunk', Math.max(5, Math.min(30, Number(e.target.value))))}
                className="w-12 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-white text-center focus:outline-none focus:border-violet-500" />
              <span className="text-[10px] text-slate-500">자 (숏폼 10·롱폼 15)</span>
            </div>
          </div>

          {/* 위치 */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[11px] text-slate-400 w-16 shrink-0">위치</span>
            <div className="flex items-center gap-2 flex-1">
              <span className="text-[10px] text-slate-500">상단</span>
              <input
                type="range" min={0} max={100} step={1}
                value={subConfig.yPercent ?? 85}
                onChange={(e) => updateSub('yPercent', Number(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp') { e.preventDefault(); updateSub('yPercent', Math.max(0, (subConfig.yPercent ?? 85) - 1)); }
                  if (e.key === 'ArrowDown') { e.preventDefault(); updateSub('yPercent', Math.min(100, (subConfig.yPercent ?? 85) + 1)); }
                }}
                className="flex-1 accent-violet-500"
              />
              <span className="text-[10px] text-slate-500">하단</span>
              <span className="text-[11px] text-violet-400 w-8 text-right">{subConfig.yPercent ?? 85}%</span>
            </div>
          </div>

          {/* 폰트 크기 */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[11px] text-slate-400 w-16 shrink-0">크기</span>
            {FONT_SIZE_OPTIONS.map(size => (
              <button key={size} type="button" onClick={() => updateSub('fontSize', size)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${subConfig.fontSize === size ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
                {size}px
              </button>
            ))}
          </div>

          {/* 폰트 */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[11px] text-slate-400 w-16 shrink-0">폰트</span>
            {FONT_OPTIONS.map(opt => (
              <button key={opt.value} type="button" onClick={() => updateSub('fontFamily', opt.value)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${subConfig.fontFamily === opt.value ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
                style={{ fontFamily: opt.value }}>
                {opt.label}
              </button>
            ))}
          </div>

          {/* 굵기 */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[11px] text-slate-400 w-16 shrink-0">굵기</span>
            {FONT_WEIGHT_OPTIONS.map(opt => (
              <button key={opt.value} type="button" onClick={() => updateSub('fontWeight', opt.value)}
                className={`px-3 py-1.5 rounded-lg text-[11px] transition-all ${subConfig.fontWeight === opt.value ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
                style={{ fontWeight: opt.value }}>
                {opt.label}
              </button>
            ))}
          </div>

          {/* 테두리 */}
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-slate-400 w-16 shrink-0">테두리색</span>
              <input type="color" value={subConfig.strokeColor ?? '#000000'} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSub('strokeColor', e.target.value)}
                className="w-8 h-8 rounded-lg border border-slate-700 bg-slate-800 cursor-pointer" />
              <span className="text-[11px] text-slate-500">{subConfig.strokeColor ?? '#000000'}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-slate-400">테두리굵기</span>
              <input type="range" min={0} max={12} step={1} value={subConfig.strokeWidth ?? 4} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSub('strokeWidth', Number(e.target.value))}
                className="w-28 accent-violet-500" />
              <span className="text-[11px] text-slate-500">{subConfig.strokeWidth ?? 4}px</span>
            </div>
          </div>

          {/* 배경 */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[11px] text-slate-400 w-16 shrink-0">배경</span>
            {BG_OPTIONS.map(opt => (
              <button key={opt.value} type="button" onClick={() => updateSub('backgroundColor', opt.value)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all border ${subConfig.backgroundColor === opt.value ? 'border-violet-500 ring-1 ring-violet-500' : 'border-slate-700'}`}
                style={{ background: opt.value === 'rgba(0,0,0,0)' ? 'repeating-conic-gradient(#444 0% 25%, #222 0% 50%) 0/10px 10px' : opt.value, color: opt.value.includes('255,255,255') ? '#000' : '#fff' }}>
                {opt.label}
              </button>
            ))}
          </div>

          {/* 글자색 + 여백 */}
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-slate-400">글자색</span>
              <input type="color" value={subConfig.textColor} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSub('textColor', e.target.value)}
                className="w-8 h-8 rounded-lg border border-slate-700 bg-slate-800 cursor-pointer" />
              <span className="text-[11px] text-slate-500">{subConfig.textColor}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-slate-400">여백</span>
              <input type="range" min={20} max={200} value={subConfig.bottomMargin} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSub('bottomMargin', Number(e.target.value))}
                className="w-28 accent-violet-500" />
              <span className="text-[11px] text-slate-500">{subConfig.bottomMargin}px</span>
            </div>
          </div>

          {/* 미리보기 */}
          <div className="relative h-20 rounded-xl bg-white border border-slate-300 overflow-hidden">
            <div className="absolute inset-0 flex items-center justify-center opacity-30 text-slate-400 text-[10px]">미리보기</div>
            <div
              className="absolute left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-center whitespace-nowrap"
              style={{
                background: subConfig.backgroundColor,
                color: subConfig.textColor,
                fontFamily: subConfig.fontFamily,
                fontSize: Math.round(subConfig.fontSize * 0.45) + 'px',
                fontWeight: subConfig.fontWeight ?? 700,
                WebkitTextStroke: (subConfig.strokeWidth ?? 4) > 0 ? `${Math.round((subConfig.strokeWidth ?? 4) * 0.45)}px ${subConfig.strokeColor ?? '#000'}` : undefined,
                ...(subConfig.yPercent !== undefined
                  ? { top: `calc(${subConfig.yPercent}% - 20px)` }
                  : subConfig.position === 'top' ? { top: 8 } : subConfig.position === 'middle' ? { top: '50%', transform: 'translate(-50%, -50%)' } : { bottom: 8 }),
              }}>
              자막이 이렇게 표시됩니다
            </div>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-3xl border border-white/[0.07] bg-black/30 backdrop-blur-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1200px] table-fixed">
            <thead className="bg-black/60 border-b border-white/[0.07]">
              <tr>
                <th className="py-4 px-6 text-[9px] font-black text-white/30 uppercase tracking-widest w-16">번호</th>
                <th className="py-4 px-6 text-[9px] font-black text-white/30 uppercase tracking-widest w-56 text-center">결과물 / 음성</th>
                <th className="py-4 px-6 text-[9px] font-black text-white/30 uppercase tracking-widest w-[28%]">나레이션</th>
                <th className="py-4 px-6 text-[9px] font-black text-white/30 uppercase tracking-widest w-[35%]">영문 프롬프트</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {data.map((row, index) => (
                <TableRow
                  key={row.sceneNumber}
                  row={row}
                  index={index}
                  isAnimating={animatingIndices?.has(index) || false}
                  aspectRatio={aspectRatio}
                  subConfig={subConfig}
                  onRegenerateImage={onRegenerateImage}
                  onRegenerateWithPrompt={onRegenerateWithPrompt}
                  onGenerateAnimation={onGenerateAnimation}
                  onOpenPreview={onOpenPreview}
                  onSelectThumbnail={onSelectThumbnail}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ResultTable;
