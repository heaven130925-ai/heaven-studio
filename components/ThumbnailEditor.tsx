/**
 * ThumbnailEditor — AI 썸네일 생성 위자드 (6단계)
 * 1. 주제 입력 → 2. 등장 인물 → 3. 시청 타겟
 * → 4. AI 분석 → 5. 전략/스타일 → 6. 결과 (캔버스 한글 텍스트 합성)
 */

import React, { useState, useRef, useEffect } from 'react';
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
type TextTheme = 'war' | 'cute' | 'news' | 'default';

interface Strategy {
  summary: string;
  mainText: string;
  subText: string;
  imagePrompt: string;
}

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

/** 주제 기반 텍스트 테마 감지 */
function detectTextTheme(topic: string, charType: CharType, charEnabled: boolean): TextTheme {
  const t = topic;
  // 전쟁/범죄/충격/사건 계열
  if (/전쟁|군사|폭탄|미사일|전투|탱크|무기|테러|공격|침공|핵|폭격|살인|범죄|사건|사고|재난|화재|충격|사망|위기|위험|비밀|폭로|스캔들|전략|전술|분쟁|학살|해킹|납치|실종|공습|폭발/.test(t)) return 'war';
  // 귀여운/동물/어린이 계열
  if ((charEnabled && charType === 'animal') || /귀여|강아지|고양이|아기|키즈|어린이|동화|캐릭터|펫|반려|유아|토끼|햄스터|판다|곰돌|뽀로로|애니|만화|포켓몬/.test(t)) return 'cute';
  // 뉴스/정보/분석 계열
  if (/뉴스|경제|정치|사회|시사|분석|통계|리포트|이슈|주식|부동산|금융|대선|선거|법원|재판|회의|외교|기자|앵커/.test(t)) return 'news';
  return 'default';
}

/** 멀티라인 텍스트 그리기 (최대 너비 초과 시 자동 줄바꿈) */
function drawMultiLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  _centerX: number,
  startY: number,
  maxWidth: number,
  lineHeight: number,
  drawFn: (line: string, y: number) => void
): number {
  const words = text.split('');
  let line = '';
  let y = startY;
  // 글자 단위로 줄바꿈 (한국어)
  for (const char of words) {
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

/** 캔버스로 배경이미지 + 한글 텍스트 합성 (테마별 스타일 적용) */
async function applyTextOverlay(
  bgBase64: string,
  mainText: string,
  subText: string,
  ratio: '16:9' | '9:16',
  theme: TextTheme
): Promise<string> {
  return new Promise((resolve) => {
    const W = ratio === '9:16' ? 1080 : 1280;
    const H = ratio === '9:16' ? 1920 : 720;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, W, H);

      if (!mainText && !subText) {
        resolve(canvas.toDataURL('image/jpeg', 0.95));
        return;
      }

      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      ctx.lineJoin     = 'round';

      const mainSize  = Math.round(W * 0.092);
      const subSize   = Math.round(W * 0.052);
      const topY      = Math.round(H * 0.04);
      const maxW      = W * 0.88;

      if (theme === 'war') {
        // ── 전쟁/충격: Impact + 빨간 박스 배경 ──────────────────
        const mainFont = `900 ${mainSize}px Impact,"Arial Black","Noto Sans KR",sans-serif`;
        const subFont  = `700 ${subSize}px Impact,"Arial Black","Noto Sans KR",sans-serif`;

        const drawWarLine = (text: string, y: number, size: number, isMain: boolean) => {
          const font = isMain ? mainFont : subFont;
          ctx.font = font;
          const tw = ctx.measureText(text).width;
          const pad = size * 0.22;
          const bh  = size * 1.38;
          // 배경 박스
          ctx.fillStyle = isMain ? '#CC0000' : 'rgba(0,0,0,0.78)';
          ctx.fillRect(W / 2 - tw / 2 - pad, y - size * 0.12, tw + pad * 2, bh);
          // 텍스트
          ctx.lineWidth   = size * 0.05;
          ctx.strokeStyle = '#000000';
          ctx.strokeText(text, W / 2, y);
          ctx.fillStyle = '#FFFFFF';
          ctx.fillText(text, W / 2, y);
        };

        ctx.font = mainFont;
        let nextY = topY;
        if (mainText) {
          nextY = drawMultiLine(ctx, mainText, W / 2, topY, maxW, mainSize * 1.4, (line, y) => drawWarLine(line, y, mainSize, true));
        }
        if (subText) {
          ctx.font = subFont;
          drawMultiLine(ctx, subText, W / 2, nextY + subSize * 0.3, maxW, subSize * 1.35, (line, y) => {
            drawWarLine(line, y, subSize, false);
            // 서브는 노란 텍스트
            ctx.font = subFont;
            ctx.fillStyle = '#FFE600';
            ctx.fillText(line, W / 2, y);
          });
        }

      } else if (theme === 'cute') {
        // ── 귀여운/동물: 핑크 글로우 + 흰 텍스트 ───────────────
        const mainFont = `900 ${mainSize}px "Arial Rounded MT Bold","Noto Sans KR","맑은 고딕",sans-serif`;
        const subFont  = `700 ${subSize}px "Arial Rounded MT Bold","Noto Sans KR","맑은 고딕",sans-serif`;

        const drawCuteLine = (text: string, y: number, size: number, isMain: boolean) => {
          const font = isMain ? mainFont : subFont;
          ctx.font = font;
          // 핑크 글로우 외곽
          ctx.shadowColor   = isMain ? '#FF69B4' : '#FF1493';
          ctx.shadowBlur    = size * 0.5;
          ctx.lineWidth     = size * 0.11;
          ctx.strokeStyle   = isMain ? '#FF69B4' : '#FF1493';
          ctx.strokeText(text, W / 2, y);
          ctx.shadowBlur = 0;
          // 흰 텍스트
          ctx.lineWidth   = size * 0.04;
          ctx.strokeStyle = '#FFFFFF';
          ctx.strokeText(text, W / 2, y);
          ctx.fillStyle = isMain ? '#FFFFFF' : '#FFE600';
          ctx.fillText(text, W / 2, y);
        };

        ctx.font = mainFont;
        let nextY = topY;
        if (mainText) {
          nextY = drawMultiLine(ctx, mainText, W / 2, topY, maxW, mainSize * 1.4, (line, y) => drawCuteLine(line, y, mainSize, true));
        }
        if (subText) {
          ctx.font = subFont;
          drawMultiLine(ctx, subText, W / 2, nextY + subSize * 0.3, maxW, subSize * 1.35, (line, y) => drawCuteLine(line, y, subSize, false));
        }
        ctx.shadowBlur = 0;

      } else if (theme === 'news') {
        // ── 뉴스/정보: 깔끔 + 파란 서브 ─────────────────────────
        const mainFont = `700 ${mainSize}px "Noto Sans KR","맑은 고딕","Arial",sans-serif`;
        const subFont  = `400 ${subSize}px "Noto Sans KR","맑은 고딕","Arial",sans-serif`;

        const drawNewsLine = (text: string, y: number, size: number, isMain: boolean) => {
          const font = isMain ? mainFont : subFont;
          ctx.font = font;
          ctx.lineWidth   = size * 0.07;
          ctx.strokeStyle = '#000022';
          ctx.strokeText(text, W / 2, y);
          ctx.fillStyle = isMain ? '#FFFFFF' : '#87CEEB';
          ctx.fillText(text, W / 2, y);
        };

        ctx.font = mainFont;
        let nextY = topY;
        if (mainText) {
          nextY = drawMultiLine(ctx, mainText, W / 2, topY, maxW, mainSize * 1.4, (line, y) => drawNewsLine(line, y, mainSize, true));
        }
        if (subText) {
          ctx.font = subFont;
          drawMultiLine(ctx, subText, W / 2, nextY + subSize * 0.3, maxW, subSize * 1.35, (line, y) => drawNewsLine(line, y, subSize, false));
        }

      } else {
        // ── 기본: 흰색 메인 + 노란 서브 + 검정 스트로크 ─────────
        const mainFont = `900 ${mainSize}px "Noto Sans KR","맑은 고딕","Arial Black",sans-serif`;
        const subFont  = `900 ${subSize}px "Noto Sans KR","맑은 고딕","Arial Black",sans-serif`;

        const drawDefaultLine = (text: string, y: number, size: number, isMain: boolean) => {
          const font = isMain ? mainFont : subFont;
          ctx.font = font;
          ctx.lineWidth   = size * 0.09;
          ctx.strokeStyle = '#000000';
          ctx.strokeText(text, W / 2, y);
          ctx.fillStyle = isMain ? '#FFFFFF' : '#FFE600';
          ctx.fillText(text, W / 2, y);
        };

        ctx.font = mainFont;
        let nextY = topY;
        if (mainText) {
          nextY = drawMultiLine(ctx, mainText, W / 2, topY, maxW, mainSize * 1.4, (line, y) => drawDefaultLine(line, y, mainSize, true));
        }
        if (subText) {
          ctx.font = subFont;
          drawMultiLine(ctx, subText, W / 2, nextY + subSize * 0.3, maxW, subSize * 1.35, (line, y) => drawDefaultLine(line, y, subSize, false));
        }
      }

      resolve(canvas.toDataURL('image/jpeg', 0.95));
    };
    img.onerror = () => {
      resolve(bgBase64.startsWith('data:') ? bgBase64 : `data:image/jpeg;base64,${bgBase64}`);
    };
    img.src = bgBase64.startsWith('data:') ? bgBase64 : `data:image/jpeg;base64,${bgBase64}`;
  });
}

const ThumbnailEditor: React.FC<Props> = ({ scenes: _scenes, topic: propTopic, selectedImage, onImageGenerated }) => {
  const [step, setStep] = useState<Step>(1);

  // 별표로 선택된 이미지가 오면 바로 결과 화면으로
  useEffect(() => {
    if (selectedImage) {
      const dataUrl = selectedImage.startsWith('data:')
        ? selectedImage
        : `data:image/jpeg;base64,${selectedImage}`;
      setGeneratedImage(dataUrl);
      setStep(6);
    }
  }, [selectedImage]);

  // Step 1
  const [topic, setTopic] = useState(propTopic || '');
  const [scriptContent, setScriptContent] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const [subText, setSubText] = useState('');
  const [borderStyle, setBorderStyle] = useState<BorderStyle>('none');
  const [thumbnailRatio, setThumbnailRatio] = useState<'16:9' | '9:16'>('16:9');
  const [showChannelName, setShowChannelName] = useState(false);
  const [channelName, setChannelName] = useState('');

  // Step 6
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [editRequest, setEditRequest] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  const getCharacterDetails = () => {
    if (!charEnabled) return '';
    if (charType === 'person') return `${personGender}, ${personAge}, ${personRace}`;
    if (charType === 'animal') return animalType;
    return objectType;
  };

  const getTargetLabel = (t: TargetAudience) =>
    TARGET_OPTIONS.find(o => o.id === t)?.label || '전연령';

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setScriptContent(ev.target?.result as string);
    reader.readAsText(file);
    e.target.value = '';
  };

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
      } else {
        setStep(3);
      }
    } catch (e) {
      console.error(e);
      setStep(3);
    }
  };

  const runGenerate = async (editReq?: string) => {
    try {
      const { generateThumbnailV2 } = await import('../services/geminiService');
      const bgBase64 = await generateThumbnailV2({
        topic,
        mainText,
        subText,
        imagePrompt: strategy?.imagePrompt || '',
        borderStyle,
        thumbnailRatio,
        characterEnabled: charEnabled,
        characterType: charType,
        characterDetails: getCharacterDetails(),
        targetAudience: targetAudience ? getTargetLabel(targetAudience as TargetAudience) : '전연령',
        showChannelName,
        channelName,
        editRequest: editReq,
      });
      if (bgBase64) {
        const theme = detectTextTheme(topic, charType, charEnabled);
        const composited = await applyTextOverlay(bgBase64, mainText, subText, thumbnailRatio, theme);
        setGeneratedImage(composited);
        onImageGenerated?.(composited);
      }
    } catch (e) { console.error(e); }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setStep(6);
    await runGenerate();
    setIsGenerating(false);
  };

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
    setStep(1);
    setTopic(propTopic || '');
    setScriptContent('');
    setCharEnabled(true);
    setCharType('person');
    setTargetAudience('');
    setStrategy(null);
    setGeneratedImage(null);
    setEditRequest('');
    setBorderStyle('none');
    setShowChannelName(false);
  };

  // 뒤로가기 버튼 (각 단계별 이전 단계)
  const BackButton = ({ toStep }: { toStep: Step }) => (
    <button
      onClick={() => setStep(toStep)}
      className="text-sm text-slate-400 hover:text-white transition-colors flex items-center gap-1"
    >
      ← 이전
    </button>
  );

  // ── 렌더 ─────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* 위에서 1/3 지점 기준 배치: justify-start + 상단 패딩 */}
      <div className="max-w-2xl mx-auto w-full px-6 pb-6 pt-[13%]">
        <div className="space-y-5">

        {/* ── STEP 1: 주제 입력 ── */}
        {step === 1 && (
          <div className="space-y-6">
            <div className="text-center pt-4">
              <h2 className="text-4xl font-black text-white leading-tight">
                클릭을 부르는<br />
                <span className="text-red-500">썸네일 생성</span>
              </h2>
            </div>
            <div className="bg-slate-900/80 rounded-2xl border border-slate-700 p-4">
              <textarea
                value={topic}
                onChange={e => setTopic(e.target.value)}
                placeholder="예: 미국과의 중동전쟁"
                rows={3}
                className="w-full bg-transparent text-white placeholder-slate-500 text-sm resize-none focus:outline-none"
              />
              <div className="flex items-center justify-between pt-3 border-t border-slate-800">
                <input ref={fileInputRef} type="file" accept=".txt,.md,.srt" className="hidden" onChange={handleFileUpload} />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
                >
                  📎 문서/대본 업로드
                  {scriptContent && <span className="text-emerald-400 text-xs font-bold">✓ 업로드됨</span>}
                </button>
                <button
                  onClick={() => topic.trim() && setStep(2)}
                  disabled={!topic.trim()}
                  className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm font-black transition-colors"
                >
                  다음 단계 →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 2: 등장 인물 ── */}
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
              {/* 피사체 토글 */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div>
                  <p className="text-sm font-bold text-white">캐릭터/피사체 포함</p>
                  <p className="text-xs text-slate-500">인물이나 특정 사물을 썸네일에 등장시킵니다.</p>
                </div>
                <button
                  onClick={() => setCharEnabled(v => !v)}
                  className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ${charEnabled ? 'bg-red-500' : 'bg-slate-700'}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${charEnabled ? 'left-6' : 'left-0.5'}`} />
                </button>
              </div>

              {charEnabled && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      ['person', '사람', '👤'],
                      ['animal', '동물', '🐱'],
                      ['object', '사물', '📦'],
                    ] as [CharType, string, string][]).map(([t, label, icon]) => (
                      <button key={t} onClick={() => setCharType(t)}
                        className={`py-3 rounded-xl border text-sm font-bold flex flex-col items-center gap-1 transition-colors ${charType === t ? 'bg-red-900/30 border-red-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'}`}>
                        <span className="text-xl">{icon}</span>{label}
                      </button>
                    ))}
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
                            <option>10대 (Teen)</option>
                            <option>20대 (Young Adult)</option>
                            <option>30대 (Adult)</option>
                            <option>40대 (Middle Age)</option>
                            <option>50대 이상 (Senior)</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 font-bold mb-1.5 block">인종 / 국적</label>
                        <select value={personRace} onChange={e => setPersonRace(e.target.value)}
                          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none">
                          <option>한국인 (Korean)</option>
                          <option>동양인 (Asian)</option>
                          <option>서양인 (Caucasian)</option>
                          <option>흑인 (Black)</option>
                          <option>중동인 (Middle Eastern)</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {charType === 'animal' && (
                    <div>
                      <label className="text-xs text-slate-400 font-bold mb-1.5 block">동물 종류</label>
                      <input value={animalType} onChange={e => setAnimalType(e.target.value)}
                        placeholder="예: 강아지, 고양이, 독수리"
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500" />
                    </div>
                  )}

                  {charType === 'object' && (
                    <div>
                      <label className="text-xs text-slate-400 font-bold mb-1.5 block">사물 종류</label>
                      <input value={objectType} onChange={e => setObjectType(e.target.value)}
                        placeholder="예: 전투기, 폭탄, 탱크"
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500" />
                    </div>
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

        {/* ── STEP 3: 시청 타겟 ── */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between pt-2">
              <BackButton toStep={2} />
              <div className="text-center">
                <h2 className="text-xl font-black text-white">주요 시청 타겟은 누구인가요?</h2>
                <p className="text-sm text-slate-400">타겟에 따라 성공하는 디자인과 텍스트 전략이 결정됩니다.</p>
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
            <button
              onClick={handleAnalyze}
              disabled={!targetAudience}
              className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-black transition-colors">
              분석 시작 →
            </button>
          </div>
        )}

        {/* ── STEP 4: 분석 중 ── */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="flex items-center pt-2">
              <BackButton toStep={3} />
            </div>
            <div className="flex flex-col items-center justify-center py-32 space-y-4">
              <div className="w-12 h-12 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-slate-400 text-sm">주제 및 대본 분석 중...</p>
            </div>
          </div>
        )}

        {/* ── STEP 5: 전략 제안 + 스타일 ── */}
        {step === 5 && strategy && (
          <div className="space-y-4">
            <div className="flex items-center pt-2">
              <BackButton toStep={3} />
            </div>
            {/* 전략 요약 */}
            <div className="bg-slate-900/80 rounded-2xl border border-slate-700 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span>✨</span>
                <h3 className="text-sm font-black text-white">썸네일 전략 제안</h3>
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

            {/* 스타일 설정 */}
            <div className="bg-slate-900/80 rounded-2xl border border-slate-700 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span>🎨</span>
                <h3 className="text-sm font-black text-white">추가 스타일 설정</h3>
              </div>
              {/* 비율 선택 */}
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
                  <input type="checkbox" checked={showChannelName} onChange={e => setShowChannelName(e.target.checked)}
                    className="accent-red-500 w-4 h-4" />
                  채널명 표시
                </label>
                {showChannelName && (
                  <input value={channelName} onChange={e => setChannelName(e.target.value)}
                    placeholder="채널명 입력"
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500" />
                )}
              </div>
            </div>

            {/* 이미지 프롬프트 */}
            <div className="bg-slate-900/80 rounded-2xl border border-slate-700 p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-slate-400 font-bold uppercase tracking-wider">이미지 프롬프트 (KOREAN)</label>
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
              {/* strategy 없으면(별표 경로) step1로, 있으면 step5로 */}
              <BackButton toStep={strategy ? 5 : 1} />
              <p className="text-sm font-bold text-white">썸네일 생성 완료</p>
              <div className="w-12" />
            </div>

            {/* 이미지 */}
            <div className={`rounded-2xl overflow-hidden border border-slate-700 bg-slate-950 flex items-center justify-center ${thumbnailRatio === '9:16' ? 'aspect-[9/16] max-w-[320px] mx-auto' : 'aspect-video'}`}>
              {isGenerating ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-slate-400">썸네일 생성 중...</p>
                </div>
              ) : generatedImage ? (
                <img src={generatedImage} className="w-full h-full object-contain" alt="썸네일" />
              ) : (
                <p className="text-slate-500 text-sm">생성 실패. 다시 시도해주세요.</p>
              )}
            </div>

            {generatedImage && !isGenerating && (
              <>
                {/* 다운로드 */}
                <button onClick={handleDownload}
                  className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-sm transition-colors flex items-center justify-center gap-2">
                  ⬇️ 다운로드 (JPG)
                </button>

                {/* 수정 요청 */}
                <div className="bg-slate-900/80 rounded-2xl border border-slate-700 p-4 space-y-3">
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">🪄 수정 요청 (AI Inpainting)</p>
                  <div className="flex gap-2">
                    <input
                      value={editRequest}
                      onChange={e => setEditRequest(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleEdit()}
                      placeholder="예: 텍스트를 노란색으로 바꿔줘, 표정을 더 놀라게 해줘"
                      className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                    />
                    <button onClick={handleEdit} disabled={isEditing || !editRequest.trim()}
                      className="px-4 py-2 rounded-xl bg-blue-600/20 border border-blue-500/40 text-blue-300 text-sm font-bold hover:bg-blue-600/35 disabled:opacity-40 transition-colors min-w-[52px]">
                      {isEditing ? <span className="flex items-center gap-1"><span className="w-3 h-3 border border-blue-400 border-t-transparent animate-spin rounded-full inline-block" /></span> : '수정'}
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
