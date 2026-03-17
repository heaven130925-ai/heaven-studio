/**
 * ThumbnailEditor — AI 썸네일 생성 위자드 (6단계)
 * 1. 주제 입력 → 2. 등장 인물 → 3. 시청 타겟
 * → 4. AI 분석 → 5. 전략/스타일 → 6. 결과 (캔버스 한글 텍스트 합성)
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GeneratedAsset } from '../types';

interface Props {
  scenes: GeneratedAsset[];
  topic?: string;
  selectedImage?: string | null;
  onImageGenerated?: (imageBase64: string) => void;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6;
type CharType = 'person' | 'animal' | 'object';
type BorderStyle = 'none' | 'solid' | 'neon' | 'sketch';
type TargetAudience = 'young' | 'adult' | 'senior' | 'global';
type FontStyle = 'gothic-bold' | 'gothic-rounded' | 'myeongjo';

interface Strategy {
  summary: string;
  mainText: string;
  subText: string;
  imagePrompt: string;
}

interface TextPos { x: number; y: number } // 0~100 (% of image)

const TARGET_OPTIONS: { id: TargetAudience; label: string; icon: string; desc: string; color: string }[] = [
  { id: 'young',  label: '10대 ~ 20대 초반',        icon: '👥', desc: '도파민 자극, 고채도, 역동적, 밈 활용',          color: 'border-cyan-500 bg-cyan-900/20' },
  { id: 'adult',  label: '20대 후반 ~ 40대',         icon: '💼', desc: '세련됨, 미니멀, 신뢰감, 정보성 강조',          color: 'border-blue-500 bg-blue-900/20' },
  { id: 'senior', label: '50대 ~ 60대 이상',         icon: '👓', desc: '시인성 극대화, 원색 대비, 감정적 표현',        color: 'border-orange-500 bg-orange-900/20' },
  { id: 'global', label: '전연령 (MrBeast 스타일)', icon: '⚡', desc: '글로벌 트렌드, 고대비, 과장된 표정, 3단어 법칙', color: 'border-red-500 bg-red-900/20' },
];

const BORDER_OPTIONS: { id: BorderStyle; label: string; icon: string }[] = [
  { id: 'none',   label: '없음',     icon: '🚫' },
  { id: 'solid',  label: '단색 강조', icon: '▬'  },
  { id: 'neon',   label: '네온 글로우', icon: '✦' },
  { id: 'sketch', label: '손그림/낙서', icon: '✏️' },
];

const FONT_OPTIONS: { id: FontStyle; label: string; desc: string; family: string }[] = [
  { id: 'gothic-bold',    label: '굵은 고딕체',  desc: '임팩트 강한 볼드 고딕',   family: '"Black Han Sans","Gothic A1",sans-serif' },
  { id: 'gothic-rounded', label: '둥근 고딕체',  desc: '부드럽고 친근한 둥근 고딕', family: '"Jua","Noto Sans KR",sans-serif' },
  { id: 'myeongjo',       label: '명조체',       desc: '우아하고 세련된 서체',     family: '"Nanum Myeongjo","Noto Serif KR",serif' },
];

const MAIN_COLORS = ['#FFFFFF', '#FFE600', '#FF4444', '#FF8800', '#44CCFF', '#AAFFAA', '#000000'];
const SUB_COLORS  = ['#FFE600', '#FFFFFF', '#FF4444', '#FF8800', '#44CCFF', '#FFAAFF', '#CCCCCC'];

const FONT_WEIGHT: Record<FontStyle, { main: string; sub: string }> = {
  'gothic-bold':    { main: '400', sub: '900' },
  'gothic-rounded': { main: '400', sub: '400' },
  'myeongjo':       { main: '800', sub: '700' },
};

/** 폰트 패밀리 반환 */
function getFontFamily(fs: FontStyle): string {
  return FONT_OPTIONS.find(f => f.id === fs)?.family || '"Noto Sans KR",sans-serif';
}

/** 캔버스 렌더 전 폰트 프리로드 */
async function preloadFonts(size: number) {
  try {
    await Promise.all([
      document.fonts.load(`400 ${size}px "Black Han Sans"`),
      document.fonts.load(`900 ${size}px "Gothic A1"`),
      document.fonts.load(`400 ${size}px "Jua"`),
      document.fonts.load(`800 ${size}px "Nanum Myeongjo"`),
      document.fonts.load(`900 ${size}px "Noto Serif KR"`),
    ]);
  } catch { /* 시스템 폰트로 폴백 */ }
}

/** 멀티라인 텍스트 그리기 (한국어 글자 단위 줄바꿈) */
function drawMultiLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  startY: number,
  maxWidth: number,
  lineHeight: number,
  drawFn: (line: string, y: number) => void
): number {
  let line = '';
  let y = startY;
  for (const char of text) {
    const test = line + char;
    if (ctx.measureText(test).width > maxWidth && line.length > 0) {
      drawFn(line, y);
      line = char;
      y += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) drawFn(line, y);
  return y + lineHeight;
}

interface OverlayOpts {
  mainText: string;
  subText: string;
  fontStyle: FontStyle;
  mainColor: string;
  subColor: string;
  mainPos: TextPos;
  subPos: TextPos;
  mainSizePct: number; // % of image width (e.g. 8.8)
  subSizePct: number;
}

/** 배경이미지 + 텍스트 합성 → JPEG data URL */
async function applyTextOverlay(
  bgSrc: string,
  opts: OverlayOpts,
  ratio: '16:9' | '9:16'
): Promise<string> {
  const W = ratio === '9:16' ? 1080 : 1280;
  const H = ratio === '9:16' ? 1920 : 720;
  const mainSize = Math.round(W * opts.mainSizePct / 100);
  const subSize  = Math.round(W * opts.subSizePct  / 100);

  await preloadFonts(mainSize);

  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d')!;

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, W, H);
      if (!opts.mainText && !opts.subText) { resolve(canvas.toDataURL('image/jpeg', 0.95)); return; }

      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.lineJoin = 'round'; ctx.lineCap = 'round';

      const family  = getFontFamily(opts.fontStyle);
      const weights = FONT_WEIGHT[opts.fontStyle];
      const maxW    = W * 0.9;

      const drawLine = (text: string, y: number, size: number, color: string, weight: string) => {
        ctx.font        = `${weight} ${size}px ${family}`;
        ctx.lineWidth   = size * 0.08;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(text, W / 2, y);
        ctx.fillStyle = color;
        ctx.fillText(text, W / 2, y);
      };

      // NOTE: cx from opts is ignored for text (center-aligned), but y is used
      const mainCX = W * opts.mainPos.x / 100;
      const mainY  = H * opts.mainPos.y / 100;
      const subY   = H * opts.subPos.y  / 100;

      // Override textAlign to left if user moved x away from center
      const mainOffCenter = Math.abs(opts.mainPos.x - 50) > 5;
      const subOffCenter  = Math.abs(opts.subPos.x  - 50) > 5;

      if (opts.mainText) {
        if (mainOffCenter) {
          ctx.textAlign = 'left';
          ctx.font = `${weights.main} ${mainSize}px ${family}`;
          drawMultiLine(ctx, opts.mainText, mainCX, mainY, maxW, mainSize * 1.38, (line, y) =>
            drawLine(line, y, mainSize, opts.mainColor, weights.main)
          );
          ctx.textAlign = 'center';
        } else {
          ctx.textAlign = 'center';
          drawMultiLine(ctx, opts.mainText, W / 2, mainY, maxW, mainSize * 1.38, (line, y) =>
            drawLine(line, y, mainSize, opts.mainColor, weights.main)
          );
        }
      }

      if (opts.subText) {
        if (subOffCenter) {
          ctx.textAlign = 'left';
          drawMultiLine(ctx, opts.subText, W * opts.subPos.x / 100, subY, maxW, subSize * 1.35, (line, y) =>
            drawLine(line, y, subSize, opts.subColor, weights.sub)
          );
          ctx.textAlign = 'center';
        } else {
          ctx.textAlign = 'center';
          drawMultiLine(ctx, opts.subText, W / 2, subY, maxW, subSize * 1.35, (line, y) =>
            drawLine(line, y, subSize, opts.subColor, weights.sub)
          );
        }
      }

      resolve(canvas.toDataURL('image/jpeg', 0.95));
    };
    img.onerror = () => resolve(bgSrc.startsWith('data:') ? bgSrc : `data:image/jpeg;base64,${bgSrc}`);
    img.src = bgSrc.startsWith('data:') ? bgSrc : `data:image/jpeg;base64,${bgSrc}`;
  });
}

// ── 컴포넌트 ─────────────────────────────────────────────────────────────────

const ThumbnailEditor: React.FC<Props> = ({ scenes: _scenes, topic: propTopic, selectedImage, onImageGenerated }) => {
  const [step, setStep] = useState<Step>(1);

  // 외부 이미지(별표/메인화면 연동)로 step 6 진입 여부
  const [fromExternal, setFromExternal] = useState(false);

  useEffect(() => {
    if (selectedImage) {
      const dataUrl = selectedImage.startsWith('data:') ? selectedImage : `data:image/jpeg;base64,${selectedImage}`;
      setGeneratedImage(dataUrl);
      setBgImage(dataUrl);
      setFromExternal(true);
      setStep(6);
    }
  }, [selectedImage]);

  // Step 1
  const [topic, setTopic] = useState(propTopic || '');
  const [scriptContent, setScriptContent] = useState('');
  const [uploadedBgImage, setUploadedBgImage] = useState<string | null>(null); // 사용자 업로드 배경
  const fileInputRef   = useRef<HTMLInputElement>(null);
  const imageInputRef  = useRef<HTMLInputElement>(null);

  // Step 2
  const [charEnabled, setCharEnabled] = useState(true);
  const [charType, setCharType] = useState<CharType>('person');
  const [personGender, setPersonGender] = useState('여성');
  const [personAge, setPersonAge] = useState('20대 (Young Adult)');
  const [personRace, setPersonRace] = useState('한국인 (Korean)');
  const [animalType, setAnimalType] = useState('');
  const [objectType, setObjectType] = useState('');

  // Step 3
  const [targetAudience, setTargetAudience] = useState<TargetAudience | ''>('');

  // Step 4~5
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [mainText, setMainText] = useState('');
  const [subText, setSubText]   = useState('');
  const [borderStyle, setBorderStyle] = useState<BorderStyle>('none');
  const [thumbnailRatio, setThumbnailRatio] = useState<'16:9' | '9:16'>('16:9');
  const [showChannelName, setShowChannelName] = useState(false);
  const [channelName, setChannelName] = useState('');

  // Step 6 — 텍스트 스타일
  const [fontStyle, setFontStyle]   = useState<FontStyle>('gothic-bold');
  const [mainColor, setMainColor]   = useState('#FFFFFF');
  const [subColor, setSubColor]     = useState('#FFE600');
  const [mainSizePct, setMainSizePct] = useState(8.8);
  const [subSizePct, setSubSizePct]   = useState(5.0);
  const [mainPos, setMainPos] = useState<TextPos>({ x: 50, y: 4 });
  const [subPos,  setSubPos]  = useState<TextPos>({ x: 50, y: 17 });

  // Step 6 — 이미지/상태
  const [isGenerating, setIsGenerating] = useState(false);
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [editRequest, setEditRequest] = useState('');
  const [isEditing, setIsEditing]     = useState(false);
  const [isTextUpdating, setIsTextUpdating] = useState(false);

  // 드래그 상태
  const previewRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'main' | 'sub' | null>(null);

  // ── 헬퍼 ──────────────────────────────────────────────────────────────────
  const getCharacterDetails = () => {
    if (!charEnabled) return '';
    if (charType === 'person') return `${personGender}, ${personAge}, ${personRace}`;
    if (charType === 'animal') return animalType;
    return objectType;
  };

  const getTargetLabel = (t: TargetAudience) => TARGET_OPTIONS.find(o => o.id === t)?.label || '전연령';

  const currentOpts = useCallback((): OverlayOpts => ({
    mainText, subText, fontStyle, mainColor, subColor, mainPos, subPos, mainSizePct, subSizePct,
  }), [mainText, subText, fontStyle, mainColor, subColor, mainPos, subPos, mainSizePct, subSizePct]);

  // ── 파일 업로드 ────────────────────────────────────────────────────────────
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setScriptContent(ev.target?.result as string);
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setUploadedBgImage(ev.target?.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // ── 텍스트 드래그 ──────────────────────────────────────────────────────────
  const handleMouseDown = (which: 'main' | 'sub') => (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(which);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    const x = Math.max(5, Math.min(95, ((e.clientX - rect.left) / rect.width)  * 100));
    const y = Math.max(0, Math.min(95, ((e.clientY - rect.top)  / rect.height) * 100));
    if (dragging === 'main') setMainPos({ x, y });
    else                     setSubPos({ x, y });
  };

  const handleMouseUp = async () => {
    if (!dragging) return;
    setDragging(null);
    // 드래그 끝나면 캔버스 자동 재합성
    if (bgImage) {
      const composited = await applyTextOverlay(bgImage, currentOpts(), thumbnailRatio);
      setGeneratedImage(composited);
      onImageGenerated?.(composited);
    }
  };

  // ── AI 생성 ────────────────────────────────────────────────────────────────
  const handleAnalyze = async () => {
    setStep(4);
    try {
      const { analyzeThumbnailStrategy } = await import('../services/geminiService');
      const result = await analyzeThumbnailStrategy({
        topic: topic + (scriptContent ? '\n\n대본:\n' + scriptContent.slice(0, 2000) : ''),
        characterEnabled: charEnabled,
        characterType: charType,
        characterDetails: getCharacterDetails(),
        targetAudience: targetAudience ? getTargetLabel(targetAudience as TargetAudience) : '전연령',
      });
      if (result) {
        setStrategy(result);
        setMainText(result.mainText);
        setSubText(result.subText);
        setStep(5);
      } else { setStep(3); }
    } catch (e) { console.error(e); setStep(3); }
  };

  const runGenerate = async (editReq?: string) => {
    try {
      let rawBg: string;

      if (uploadedBgImage && !editReq) {
        // 사용자가 업로드한 이미지 사용
        rawBg = uploadedBgImage;
      } else {
        const { generateThumbnailV2 } = await import('../services/geminiService');
        const b64 = await generateThumbnailV2({
          topic, mainText, subText,
          imagePrompt: strategy?.imagePrompt || '',
          borderStyle, thumbnailRatio,
          characterEnabled: charEnabled, characterType: charType,
          characterDetails: getCharacterDetails(),
          targetAudience: targetAudience ? getTargetLabel(targetAudience as TargetAudience) : '전연령',
          showChannelName, channelName,
          editRequest: editReq,
        });
        if (!b64) return;
        rawBg = b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}`;
      }

      setBgImage(rawBg);
      setFromExternal(false);
      const composited = await applyTextOverlay(rawBg, currentOpts(), thumbnailRatio);
      setGeneratedImage(composited);
      onImageGenerated?.(composited);
    } catch (e) { console.error(e); }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setStep(6);
    await runGenerate();
    setIsGenerating(false);
  };

  // 텍스트만 재합성 (AI 호출 없음)
  const handleTextUpdate = async () => {
    if (!bgImage) return;
    setIsTextUpdating(true);
    const composited = await applyTextOverlay(bgImage, currentOpts(), thumbnailRatio);
    setGeneratedImage(composited);
    onImageGenerated?.(composited);
    setIsTextUpdating(false);
  };

  // 배경 이미지만 AI 수정
  const handleEdit = async () => {
    if (!editRequest.trim()) return;
    setIsEditing(true);
    await runGenerate(editRequest);
    setEditRequest('');
    setIsEditing(false);
  };

  const handleDownload = () => {
    if (!generatedImage) return;
    const a = document.createElement('a');
    a.href = generatedImage;
    a.download = `thumbnail_${Date.now()}.jpg`;
    a.click();
  };

  const reset = () => {
    setStep(1); setTopic(propTopic || ''); setScriptContent('');
    setCharEnabled(true); setCharType('person'); setTargetAudience('');
    setStrategy(null); setBgImage(null); setGeneratedImage(null);
    setEditRequest(''); setBorderStyle('none'); setShowChannelName(false);
    setUploadedBgImage(null); setFromExternal(false);
    setMainPos({ x: 50, y: 4 }); setSubPos({ x: 50, y: 17 });
    setFontStyle('gothic-bold'); setMainColor('#FFFFFF'); setSubColor('#FFE600');
    setMainSizePct(8.8); setSubSizePct(5.0);
  };

  const BackButton = ({ toStep }: { toStep: Step }) => (
    <button onClick={() => setStep(toStep)}
      className="text-sm text-slate-400 hover:text-white transition-colors flex items-center gap-1">
      ← 이전
    </button>
  );

  // ── 공통 색상 선택기 ─────────────────────────────────────────────────────
  const ColorPicker = ({ colors, value, onChange, label }: {
    colors: string[]; value: string; onChange: (c: string) => void; label: string;
  }) => (
    <div>
      <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1">{label}</label>
      <div className="flex gap-1.5 flex-wrap">
        {colors.map(c => (
          <button key={c} onClick={() => onChange(c)}
            style={{ background: c, border: value === c ? '2px solid #fff' : '2px solid #475569' }}
            className="w-6 h-6 rounded-full transition-all hover:scale-110"
            title={c} />
        ))}
        <input type="color" value={value} onChange={e => onChange(e.target.value)}
          className="w-6 h-6 rounded-full cursor-pointer bg-transparent border-0 p-0" title="직접 선택" />
      </div>
    </div>
  );

  // ── 렌더 ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto w-full px-6 pb-6 pt-[13%]">
        <div className="space-y-5">

        {/* ── STEP 1 ── */}
        {step === 1 && (
          <div className="space-y-6">
            <div className="text-center pt-4">
              <h2 className="text-4xl font-black text-white leading-tight">
                클릭을 부르는<br /><span className="text-red-500">썸네일 생성</span>
              </h2>
            </div>
            <div className="bg-slate-900/80 rounded-2xl border border-slate-700 p-4 space-y-3">
              <textarea value={topic} onChange={e => setTopic(e.target.value)}
                placeholder="예: 미국과의 중동전쟁" rows={3}
                className="w-full bg-transparent text-white placeholder-slate-500 text-sm resize-none focus:outline-none" />

              <div className="border-t border-slate-800 pt-3 space-y-2">
                {/* 대본 업로드 */}
                <input ref={fileInputRef} type="file" accept=".txt,.md,.srt" className="hidden" onChange={handleFileUpload} />
                <button onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors">
                  📎 대본/문서 업로드
                  {scriptContent && <span className="text-emerald-400 text-xs font-bold">✓ 업로드됨</span>}
                </button>

                {/* 이미지 업로드 */}
                <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                <button onClick={() => imageInputRef.current?.click()}
                  className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors">
                  🖼 배경 이미지 업로드 (선택)
                  {uploadedBgImage && <span className="text-emerald-400 text-xs font-bold">✓ 이미지 선택됨</span>}
                </button>
                {uploadedBgImage && (
                  <div className="flex items-center gap-2">
                    <img src={uploadedBgImage} className="h-10 w-16 object-cover rounded-lg border border-slate-700" />
                    <button onClick={() => setUploadedBgImage(null)} className="text-xs text-red-400 hover:text-red-300">✕ 제거</button>
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-1 border-t border-slate-800">
                <button onClick={() => topic.trim() && setStep(2)} disabled={!topic.trim()}
                  className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm font-black transition-colors">
                  다음 단계 →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 2 ── */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between pt-2">
              <BackButton toStep={1} />
              <div className="text-center">
                <h2 className="text-xl font-black text-white">썸네일 등장 인물 설정</h2>
                <p className="text-sm text-slate-400">썸네일에 들어갈 메인 피사체를 설정해주세요.</p>
              </div>
              <div className="w-12" />
            </div>
            <div className="bg-slate-900/80 rounded-2xl border border-slate-700 p-4 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div>
                  <p className="text-sm font-bold text-white">캐릭터/피사체 포함</p>
                  <p className="text-xs text-slate-500">인물이나 특정 사물을 썸네일에 등장시킵니다.</p>
                </div>
                <button onClick={() => setCharEnabled(v => !v)}
                  className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ${charEnabled ? 'bg-red-500' : 'bg-slate-700'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${charEnabled ? 'left-6' : 'left-0.5'}`} />
                </button>
              </div>
              {charEnabled && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {(['person','animal','object'] as CharType[]).map((t, i) => {
                      const [label, icon] = [['사람','👤'],['동물','🐱'],['사물','📦']][i];
                      return (
                        <button key={t} onClick={() => setCharType(t)}
                          className={`py-3 rounded-xl border text-sm font-bold flex flex-col items-center gap-1 transition-colors ${charType === t ? 'bg-red-900/30 border-red-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'}`}>
                          <span className="text-xl">{icon}</span>{label}
                        </button>
                      );
                    })}
                  </div>
                  {charType === 'person' && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-slate-400 font-bold mb-1.5 block">성별</label>
                          <select value={personGender} onChange={e => setPersonGender(e.target.value)}
                            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none">
                            <option>여성</option><option>남성</option><option>중성적</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 font-bold mb-1.5 block">연령대</label>
                          <select value={personAge} onChange={e => setPersonAge(e.target.value)}
                            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none">
                            <option>10대 (Teen)</option><option>20대 (Young Adult)</option>
                            <option>30대 (Adult)</option><option>40대 (Middle Age)</option><option>50대 이상 (Senior)</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 font-bold mb-1.5 block">인종 / 국적</label>
                        <select value={personRace} onChange={e => setPersonRace(e.target.value)}
                          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none">
                          <option>한국인 (Korean)</option><option>동양인 (Asian)</option>
                          <option>서양인 (Caucasian)</option><option>흑인 (Black)</option><option>중동인 (Middle Eastern)</option>
                        </select>
                      </div>
                    </div>
                  )}
                  {charType === 'animal' && (
                    <input value={animalType} onChange={e => setAnimalType(e.target.value)}
                      placeholder="예: 강아지, 고양이, 독수리"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none" />
                  )}
                  {charType === 'object' && (
                    <input value={objectType} onChange={e => setObjectType(e.target.value)}
                      placeholder="예: 전투기, 폭탄, 탱크"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none" />
                  )}
                </>
              )}
              <button onClick={() => setStep(3)}
                className="w-full py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-sm font-black transition-colors">
                설정 완료 ✓
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3 ── */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between pt-2">
              <BackButton toStep={2} />
              <div className="text-center">
                <h2 className="text-xl font-black text-white">주요 시청 타겟은 누구인가요?</h2>
                <p className="text-sm text-slate-400">타겟에 따라 디자인과 텍스트 전략이 결정됩니다.</p>
              </div>
              <div className="w-12" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {TARGET_OPTIONS.map(t => (
                <button key={t.id} onClick={() => setTargetAudience(t.id)}
                  className={`p-4 rounded-xl border text-left transition-all ${targetAudience === t.id ? t.color : 'bg-slate-900/60 border-slate-700 hover:bg-slate-800/60'}`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xl">{t.icon}</span>
                    <span className="text-sm font-black text-white leading-tight">{t.label}</span>
                  </div>
                  <p className="text-xs text-slate-400">{t.desc}</p>
                </button>
              ))}
            </div>
            <button onClick={handleAnalyze} disabled={!targetAudience}
              className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-black transition-colors">
              분석 시작 →
            </button>
          </div>
        )}

        {/* ── STEP 4: 분석 중 ── */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="flex items-center pt-2"><BackButton toStep={3} /></div>
            <div className="flex flex-col items-center justify-center py-32 space-y-4">
              <div className="w-12 h-12 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-slate-400 text-sm">주제 및 대본 분석 중...</p>
            </div>
          </div>
        )}

        {/* ── STEP 5 ── */}
        {step === 5 && strategy && (
          <div className="space-y-4">
            <div className="flex items-center pt-2"><BackButton toStep={3} /></div>

            <div className="bg-slate-900/80 rounded-2xl border border-slate-700 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span>✨</span><h3 className="text-sm font-black text-white">썸네일 전략 제안</h3>
              </div>
              <div className="bg-slate-800/60 rounded-xl p-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">전략 분석 요약</p>
                <p className="text-xs text-slate-300 leading-relaxed">{strategy.summary}</p>
              </div>
              <div className="space-y-2">
                <div>
                  <label className="text-[11px] text-slate-400 font-bold uppercase tracking-wider block mb-1">메인 문구 (MAIN)</label>
                  <input value={mainText} onChange={e => setMainText(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm font-bold text-center focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-[11px] text-slate-400 font-bold uppercase tracking-wider block mb-1">서브 문구 (SUB)</label>
                  <input value={subText} onChange={e => setSubText(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm text-center focus:outline-none focus:border-blue-500" />
                </div>
              </div>
            </div>

            <div className="bg-slate-900/80 rounded-2xl border border-slate-700 p-4 space-y-3">
              <div className="flex items-center gap-2"><span>🎨</span><h3 className="text-sm font-black text-white">추가 스타일 설정</h3></div>
              <div>
                <label className="text-xs text-slate-400 font-bold mb-2 block">비율</label>
                <div className="flex gap-2">
                  {(['16:9', '9:16'] as const).map(r => (
                    <button key={r} onClick={() => setThumbnailRatio(r)}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-colors ${thumbnailRatio === r ? 'bg-red-600/20 border-red-500 text-red-300' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'}`}>
                      {r === '16:9' ? '📺 16:9 가로형' : '📱 9:16 숏츠'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 font-bold mb-2 block">테두리 스타일</label>
                <div className="flex gap-2">
                  {BORDER_OPTIONS.map(b => (
                    <button key={b.id} onClick={() => setBorderStyle(b.id)}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-colors ${borderStyle === b.id ? 'bg-red-600/20 border-red-500 text-red-300' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'}`}>
                      {b.icon} {b.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
                  <input type="checkbox" checked={showChannelName} onChange={e => setShowChannelName(e.target.checked)} className="accent-red-500 w-4 h-4" />
                  채널명 표시
                </label>
                {showChannelName && (
                  <input value={channelName} onChange={e => setChannelName(e.target.value)} placeholder="채널명 입력"
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500" />
                )}
              </div>
            </div>

            <div className="bg-slate-900/80 rounded-2xl border border-slate-700 p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-slate-400 font-bold uppercase tracking-wider">이미지 프롬프트</label>
                <button onClick={() => navigator.clipboard.writeText(strategy.imagePrompt)}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors">복사 📋</button>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">{strategy.imagePrompt}</p>
            </div>

            <p className="text-center text-xs text-slate-500">ⓘ 약 20초 소요</p>
            <button onClick={handleGenerate}
              className="w-full py-3.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black text-sm transition-colors flex items-center justify-center gap-2">
              🖼 썸네일 생성하기 →
            </button>
          </div>
        )}

        {/* ── STEP 6: 결과 ── */}
        {step === 6 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              {/* fromExternal = 별표/메인화면 연동 경로: 이전 버튼 숨김 */}
              {fromExternal ? <div className="w-16" /> : <BackButton toStep={strategy ? 5 : 1} />}
              <p className="text-sm font-bold text-white">썸네일 생성 완료</p>
              <div className="w-16" />
            </div>

            {/* ── 인터랙티브 프리뷰 (드래그 가능) ── */}
            <div
              ref={previewRef}
              className={`relative rounded-2xl overflow-hidden border border-slate-700 bg-slate-950 select-none ${thumbnailRatio === '9:16' ? 'aspect-[9/16] max-w-[280px] mx-auto' : 'aspect-video'}`}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              {isGenerating ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-slate-400">생성 중...</p>
                </div>
              ) : bgImage && !fromExternal ? (
                <>
                  {/* 배경 이미지 */}
                  <img src={bgImage} className="absolute inset-0 w-full h-full object-cover pointer-events-none" alt="" />
                  {/* 드래그 가능한 텍스트 오버레이 */}
                  {mainText && (
                    <div
                      className={`absolute cursor-grab active:cursor-grabbing z-10 ${dragging === 'main' ? 'opacity-90' : ''}`}
                      style={{
                        left: `${mainPos.x}%`, top: `${mainPos.y}%`,
                        transform: 'translate(-50%, 0)',
                        fontFamily: getFontFamily(fontStyle),
                        fontSize: `${mainSizePct * 0.85}cqw`,
                        fontWeight: fontStyle === 'myeongjo' ? 800 : 400,
                        color: mainColor,
                        textShadow: '-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 0 8px #000',
                        whiteSpace: 'nowrap', lineHeight: 1.2,
                        containerType: 'size',
                      }}
                      onMouseDown={handleMouseDown('main')}
                      title="드래그하여 위치 조정"
                    >
                      {mainText}
                      <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] text-yellow-300 bg-black/60 px-1 rounded opacity-60 whitespace-nowrap">↕ 드래그</span>
                    </div>
                  )}
                  {subText && (
                    <div
                      className={`absolute cursor-grab active:cursor-grabbing z-10 ${dragging === 'sub' ? 'opacity-90' : ''}`}
                      style={{
                        left: `${subPos.x}%`, top: `${subPos.y}%`,
                        transform: 'translate(-50%, 0)',
                        fontFamily: getFontFamily(fontStyle),
                        fontSize: `${subSizePct * 0.85}cqw`,
                        fontWeight: fontStyle === 'myeongjo' ? 700 : 400,
                        color: subColor,
                        textShadow: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
                        whiteSpace: 'nowrap', lineHeight: 1.2,
                      }}
                      onMouseDown={handleMouseDown('sub')}
                      title="드래그하여 위치 조정"
                    >
                      {subText}
                    </div>
                  )}
                </>
              ) : generatedImage ? (
                <img src={generatedImage} className="w-full h-full object-contain" alt="썸네일" />
              ) : (
                <p className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">생성 실패. 다시 시도해주세요.</p>
              )}
            </div>

            {!isGenerating && (bgImage || generatedImage) && (
              <>
                {/* 다운로드 */}
                <button onClick={handleDownload}
                  className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-sm transition-colors flex items-center justify-center gap-2">
                  ⬇️ 다운로드 (JPG)
                </button>

                {/* ① 텍스트 & 폰트 수정 */}
                <div className="bg-slate-900/80 rounded-2xl border border-slate-700 p-4 space-y-3">
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">✏️ 텍스트 · 폰트 수정</p>

                  {/* 폰트 선택 */}
                  <div>
                    <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">폰트 종류</label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {FONT_OPTIONS.map(f => (
                        <button key={f.id} onClick={() => setFontStyle(f.id)}
                          className={`py-2 px-1 rounded-xl border text-xs text-center transition-colors ${fontStyle === f.id ? 'bg-red-900/30 border-red-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'}`}
                          style={{ fontFamily: f.family }}>
                          <span className="block font-bold">{f.label}</span>
                          <span className="block text-[9px] text-slate-500 mt-0.5">{f.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 텍스트 */}
                  <input value={mainText} onChange={e => setMainText(e.target.value)} placeholder="메인 문구"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm font-bold text-center focus:outline-none focus:border-blue-500" />
                  <input value={subText} onChange={e => setSubText(e.target.value)} placeholder="서브 문구"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm text-center focus:outline-none focus:border-blue-500" />

                  {/* 색상 */}
                  <div className="grid grid-cols-2 gap-3">
                    <ColorPicker colors={MAIN_COLORS} value={mainColor} onChange={setMainColor} label="메인 색상" />
                    <ColorPicker colors={SUB_COLORS}  value={subColor}  onChange={setSubColor}  label="서브 색상" />
                  </div>

                  {/* 크기 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1">메인 크기 ({mainSizePct.toFixed(1)})</label>
                      <input type="range" min={5} max={14} step={0.5} value={mainSizePct}
                        onChange={e => setMainSizePct(Number(e.target.value))}
                        className="w-full accent-red-500" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1">서브 크기 ({subSizePct.toFixed(1)})</label>
                      <input type="range" min={3} max={9} step={0.5} value={subSizePct}
                        onChange={e => setSubSizePct(Number(e.target.value))}
                        className="w-full accent-red-500" />
                    </div>
                  </div>

                  <p className="text-[10px] text-slate-500">💡 프리뷰 위 텍스트를 드래그해서 위치를 조정하세요</p>

                  <button onClick={handleTextUpdate} disabled={isTextUpdating || !bgImage}
                    className="w-full py-2 rounded-xl bg-emerald-700/30 border border-emerald-500/50 text-emerald-300 text-sm font-bold hover:bg-emerald-700/50 disabled:opacity-40 transition-colors flex items-center justify-center gap-2">
                    {isTextUpdating
                      ? <><span className="w-3 h-3 border border-emerald-400 border-t-transparent animate-spin rounded-full" /> 적용 중...</>
                      : '✓ 텍스트 적용 (고화질 저장)'}
                  </button>
                </div>

                {/* ② 배경 이미지 수정 (AI) */}
                <div className="bg-slate-900/80 rounded-2xl border border-slate-700 p-4 space-y-3">
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">🪄 배경 이미지 수정 (AI 재생성)</p>
                  <div className="flex gap-2">
                    <input value={editRequest} onChange={e => setEditRequest(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleEdit()}
                      placeholder="예: 더 어두운 분위기로, 폭발 장면 추가"
                      className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500" />
                    <button onClick={handleEdit} disabled={isEditing || !editRequest.trim()}
                      className="px-4 py-2 rounded-xl bg-blue-600/20 border border-blue-500/40 text-blue-300 text-sm font-bold hover:bg-blue-600/35 disabled:opacity-40 transition-colors min-w-[52px]">
                      {isEditing ? <span className="w-3 h-3 border border-blue-400 border-t-transparent animate-spin rounded-full inline-block" /> : '수정'}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* 전체 다시 만들기 */}
            <button onClick={reset}
              className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm font-bold transition-colors flex items-center justify-center gap-2">
              🔄 전체 다시 만들기
            </button>
          </div>
        )}

        </div>
      </div>
    </div>
  );
};

export default ThumbnailEditor;
