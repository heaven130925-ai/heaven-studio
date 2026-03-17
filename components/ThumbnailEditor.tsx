/**
 * ThumbnailEditor — AI 썸네일 생성 위자드 (6단계)
 * 1. 주제 입력 → 2. 등장 인물 → 3. 시청 타겟
 * → 4. AI 분석 → 5. 전략/스타일 → 6. 결과
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

const ThumbnailEditor: React.FC<Props> = ({ scenes: _scenes, topic: propTopic, selectedImage, onImageGenerated }) => {
  const [step, setStep] = useState<Step>(1);

  // 별표로 선택된 이미지가 오면 바로 결과 화면으로
  useEffect(() => {
    if (selectedImage) {
      // imageData는 raw base64일 수 있으므로 data URL로 변환
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
      const result = await generateThumbnailV2({
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
      if (result) {
        const dataUrl = `data:image/jpeg;base64,${result}`;
        setGeneratedImage(dataUrl);
        onImageGenerated?.(dataUrl);
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

  // ── 렌더 ─────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto w-full p-6 space-y-5">

        {/* ── STEP 1: 주제 입력 ── */}
        {step === 1 && (
          <div className="space-y-5">
            <div className="text-center space-y-2 pt-4">
              <h2 className="text-2xl font-black text-white leading-tight">
                클릭을 부르는<br />
                <span className="text-red-500">썸네일 기획 및 생성</span>
              </h2>
              <p className="text-sm text-slate-400">
                영상 주제를 입력하거나 <strong className="text-white">대본 파일</strong>을 업로드하세요.<br />
                내용을 깊이 있게 분석하여 최적의 썸네일을 제안합니다.
              </p>
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
            <div className="text-center space-y-1 pt-2">
              <h2 className="text-xl font-black text-white">썸네일 등장 인물 설정</h2>
              <p className="text-sm text-slate-400">썸네일에 들어갈 메인 피사체를 설정해주세요.</p>
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
            <div className="text-center space-y-1 pt-2">
              <h2 className="text-xl font-black text-white">주요 시청 타겟은 누구인가요?</h2>
              <p className="text-sm text-slate-400">타겟에 따라 성공하는 디자인과 텍스트 전략이 결정됩니다.</p>
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
          <div className="flex flex-col items-center justify-center py-40 space-y-4">
            <div className="w-12 h-12 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-slate-400 text-sm">주제 및 대본 분석 중...</p>
          </div>
        )}

        {/* ── STEP 5: 전략 제안 + 스타일 ── */}
        {step === 5 && strategy && (
          <div className="space-y-4">
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

            <p className="text-center text-xs text-slate-500">ⓘ 두 가지 버전의 이미지가 동시에 생성됩니다 (약 20초 소요)</p>
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
              <button onClick={() => setStep(5)} className="text-sm text-slate-400 hover:text-white transition-colors">← 처음으로</button>
              <p className="text-sm font-bold text-white">썸네일 생성 완료</p>
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
  );
};

export default ThumbnailEditor;
