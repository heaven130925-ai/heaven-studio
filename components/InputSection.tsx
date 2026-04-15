
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import ThumbnailEditor from './ThumbnailEditor';
import VoiceSettingsPanel from './VoiceSettingsPanel';
import WritingProfilePanel from './WritingProfilePanel';
import { GenerationStep, ProjectSettings, ReferenceImages, DEFAULT_REFERENCE_IMAGES } from '../types';
import { CONFIG, IMAGE_MODELS, ImageModelId, VIDEO_MODELS, VideoModelId, DEFAULT_VIDEO_MODEL, VISUAL_STYLES, VisualStyleId } from '../config';
import { getElevenLabsModelId, setElevenLabsModelId } from '../services/elevenLabsService';
import { analyzeCharacterReference, findTrendingTopics, analyzeReferenceChannel } from '../services/geminiService';
import { setVoiceSetting } from '../utils/voiceStorage';

interface InputSectionProps {
  onGenerate: (topic: string, referenceImages: ReferenceImages, sourceText: string | null, sceneCount: number, autoRun?: boolean, autoRender?: boolean, referenceVideoContext?: string, category?: string, targetMinutes?: number, blueprint?: string) => void;
  isVideoGenerating?: boolean;
  onCharacterAnalyze?: (topic: string, referenceImages: ReferenceImages, sourceText: string, sceneCount: number) => void;
  isAnalyzingCharacters?: boolean;
  step: GenerationStep;
  activeTab: 'auto' | 'manual';
  onTabChange: (tab: 'auto' | 'manual') => void;
  manualScript: string;
  onManualScriptChange: (v: string) => void;
  thumbnailBaseImage?: string | null;
  onThumbnailBaseImageChange?: (img: string | null) => void;
  onAspectRatioChange?: (ratio: '16:9' | '9:16') => void;
  thumbnailScenes?: import('../types').GeneratedAsset[];
  thumbnailTopic?: string;
  onOpenGallery?: () => void;
  resetKey?: number;
  onAudioFirstGenerate?: (audioFile: File, refImgs: ReferenceImages, sceneCount: number, scriptText?: string) => void;
}

const InputSection: React.FC<InputSectionProps> = ({ onGenerate, onCharacterAnalyze, isAnalyzingCharacters, step, activeTab, onTabChange, manualScript, onManualScriptChange, thumbnailBaseImage, onThumbnailBaseImageChange, onAspectRatioChange, thumbnailScenes, thumbnailTopic, onOpenGallery, resetKey, isVideoGenerating, onAudioFirstGenerate }) => {
  const [topic, setTopic] = useState('');
  const [sceneCount, setSceneCount] = useState<number>(0);
  // 로컬 탭: auto | manual | audio-first (부모 activeTab에 audio-first 추가)
  const [localTab, setLocalTab] = useState<'auto' | 'manual' | 'audio-first'>(activeTab);
  const audioFileInputRef = useRef<HTMLInputElement>(null);
  const [pendingAudioFile, setPendingAudioFile] = useState<File | null>(null);
  const [audioScriptText, setAudioScriptText] = useState<string>('');

  // 부모 activeTab 변경 시 localTab 동기화 (audio-first 유지)
  useEffect(() => {
    if (localTab !== 'audio-first') setLocalTab(activeTab);
  }, [activeTab]); // eslint-disable-line

  const handleLocalTabChange = (tab: 'auto' | 'manual' | 'audio-first') => {
    setLocalTab(tab);
    if (tab !== 'audio-first') onTabChange(tab);
  };

  // 비주얼 스타일
  const [visualStyleId, setVisualStyleId] = useState<VisualStyleId>(
    (localStorage.getItem(CONFIG.STORAGE_KEYS.VISUAL_STYLE_ID) as VisualStyleId) || 'none'
  );
  const [customStylePrompt, setCustomStylePrompt] = useState<string>(
    localStorage.getItem(CONFIG.STORAGE_KEYS.CUSTOM_STYLE_PROMPT) || ''
  );

  // 참조 이미지
  const [characterRefImages, setCharacterRefImages] = useState<string[]>([]);
  const [styleRefImages, setStyleRefImages] = useState<string[]>([]);
  const [characterStrength, setCharacterStrength] = useState(DEFAULT_REFERENCE_IMAGES.characterStrength);
  const [styleStrength, setStyleStrength] = useState(DEFAULT_REFERENCE_IMAGES.styleStrength);
  const [characterDescription, setCharacterDescription] = useState<string>(''); // Gemini Vision 자동 추출

  // 리셋 시 캐릭터 레퍼런스 이미지 + 레퍼런스 영상 초기화
  useEffect(() => {
    if (resetKey === undefined || resetKey === 0) return;
    setCharacterRefImages([]);
    setStyleRefImages([]);
    setCharacterDescription('');
    setRefVideoAnalysis('');
  }, [resetKey]);

  // 이미지 설정
  const [imageModelId, setImageModelId] = useState<ImageModelId>('gemini-2.5-flash-image');
  const [videoModelId, setVideoModelId] = useState<VideoModelId>(
    () => (localStorage.getItem('heaven_video_model') as VideoModelId) || DEFAULT_VIDEO_MODEL
  );
  const [videoEnabled, setVideoEnabled] = useState(() => localStorage.getItem('heaven_video_enabled') !== 'false');
  const [imageTextMode, setImageTextMode] = useState<string>('none');

  // 포맷
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>(
    (localStorage.getItem(CONFIG.STORAGE_KEYS.ASPECT_RATIO) as '16:9' | '9:16') || '16:9'
  );
  const [longformDuration, setLongformDuration] = useState<number>(
    parseInt(localStorage.getItem(CONFIG.STORAGE_KEYS.LONGFORM_DURATION) || '5')
  );
  const [shortformDuration, setShortformDuration] = useState<number>(
    parseInt(localStorage.getItem(CONFIG.STORAGE_KEYS.SHORTFORM_DURATION) || '5')
  );

  // 음성 패널 새로고침 키 (프로젝트 불러오기 시 VoiceSettingsPanel 상태 재로드)
  const [voicePanelRefreshKey, setVoicePanelRefreshKey] = useState(0);

  // 2단계 완전 자동화
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [suggestedTopics, setSuggestedTopics] = useState<Array<{rank: number; topic: string; reason: string}>>([]);
  const [selectedTopics, setSelectedTopics] = useState<Set<number>>(new Set());
  const [isLoadingTopics, setIsLoadingTopics] = useState(false);
  const [autoRunMode, setAutoRunMode] = useState(false);
  // ── 대본 구조 설계 (블루프린트) ───────────────────────────────────────────
  const [scriptBlueprint, setScriptBlueprint] = useState(localStorage.getItem('heaven_script_blueprint') || '');
  const [showBlueprint, setShowBlueprint] = useState(false);
  const BLUEPRINT_PRESETS = [
    { label: '야담/공포', value: `초반 후킹 (1분): 현재 상황에서 시작 — 충격적이고 소름 돋는 장면으로 바로 시작. 인사말/설명 없이 사건 한복판에서 시작.\n발단 (3분): 주인공과 배경 소개. 평범한 일상 속 이상한 조짐.\n전개 (10분): 갈등 심화. 점점 늘어나는 공포와 긴장감. 등장인물 감정선 집중.\n절정 (5분): 진실이 드러나는 반전. 시청자가 예상 못한 충격.\n결말 (1분): 여운 있는 마무리. 소름 돋는 마지막 한 마디.` },
    { label: '역사/다큐', value: `인트로 훅 (1분): 현재와 연결되는 충격적 사실로 시작.\n역사 배경 (5분): 시대 상황과 주요 인물 소개.\n핵심 사건 (10분): 사건 전개를 드라마틱하게. 인물 감정 중심.\n반전/비화 (3분): 교과서에 없는 충격적 뒷이야기.\n현재와의 연결 (1분): 이 역사가 지금 우리에게 주는 교훈.` },
    { label: '경제/투자', value: `충격 훅 (1분): 대부분이 모르는 돈 관련 충격 사실로 시작.\n문제 제시 (3분): 왜 이것이 중요한지, 모르면 어떤 손해를 보는지.\n핵심 내용 (10분): 3~5가지 핵심 포인트. 각 포인트에 실제 사례와 수치 포함.\n실천 방법 (4분): 지금 당장 할 수 있는 구체적 행동.\n마무리 (2분): 핵심 요약 + 행동 촉구.` },
    { label: '심리/감성', value: `공감 훅 (1분): "혹시 이런 경험 있으신가요?" 강한 공감으로 시작.\n현상 설명 (4분): 왜 이런 감정/행동이 생기는지 심리학적 설명.\n사례 (8분): 실제 사례 2~3가지. 독자가 자신을 발견할 수 있게.\n해결책 (5분): 심리학 기반 실천 가능한 조언.\n마무리 (2분): 따뜻한 위로와 격려.` },
  ];

  const [isSequentialRunning, setIsSequentialRunning] = useState(false);
  const sequentialQueueRef = useRef<string[]>([]);
  const sequentialIndexRef = useRef(0);
  const prevStepRef = useRef(step);
  const pendingNextTopicRef = useRef(false);

  // 프로젝트
  const [projects, setProjects] = useState<ProjectSettings[]>([]);
  const [newProjectName, setNewProjectName] = useState('');

  // 패널 네비게이션
  const [activePanel, setActivePanel] = useState<string | null>(null);

  const characterFileInputRef = useRef<HTMLInputElement>(null);
  const styleFileInputRef = useRef<HTMLInputElement>(null);
  // 레퍼런스 채널
  const [refChannelUrl, setRefChannelUrl] = useState<string>('');
  const [refVideoAnalysis, setRefVideoAnalysis] = useState<string>('');
  const [isAnalyzingChannel, setIsAnalyzingChannel] = useState(false);

  useEffect(() => {
    setImageModelId(localStorage.getItem(CONFIG.STORAGE_KEYS.IMAGE_MODEL) as ImageModelId || CONFIG.DEFAULT_IMAGE_MODEL);
    setImageTextMode(localStorage.getItem(CONFIG.STORAGE_KEYS.IMAGE_TEXT_MODE) || 'none');
    const saved = localStorage.getItem(CONFIG.STORAGE_KEYS.PROJECTS);
    if (saved) { try { setProjects(JSON.parse(saved)); } catch {} }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 수동 대본 길이에 따라 영상 포맷 시간 자동 계산
  useEffect(() => {
    if (activeTab !== 'manual') return;
    const len = manualScript.trim().length;
    if (len < 50) return;
    // 한국어 나레이션 약 432자/분 = 7.2자/초
    if (aspectRatio === '16:9') {
      const mins = Math.max(1, Math.round(len / 432));
      setLongformDuration(mins);
      localStorage.setItem(CONFIG.STORAGE_KEYS.LONGFORM_DURATION, String(mins));
    } else {
      const secs = Math.max(15, Math.min(60, Math.round(len / 7.2)));
      setShortformDuration(secs);
      localStorage.setItem(CONFIG.STORAGE_KEYS.SHORTFORM_DURATION, String(secs));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualScript, aspectRatio, activeTab]);

  // 순차 생성 헬퍼: 다음 주제 실행
  const triggerNextTopic = useCallback(() => {
    const idx = sequentialIndexRef.current;
    const queue = sequentialQueueRef.current;
    if (idx < queue.length) {
      sequentialIndexRef.current = idx + 1;
      setTimeout(() => {
        const nextTopic = queue[idx];
        setTopic(nextTopic);
        const durSq = aspectRatio === '16:9' ? longformDuration : shortformDuration / 60;
        const tMinSq = durSq > 0 ? durSq : undefined;
        onGenerate(nextTopic, { character: characterRefImages, style: styleRefImages, characterStrength, styleStrength, characterDescription }, null, sceneCount || (tMinSq ? Math.max(1, Math.round(tMinSq * 7)) : 0), true, true, refVideoAnalysis || undefined, selectedCategory || undefined, tMinSq, scriptBlueprint || undefined);
      }, 2000);
    } else {
      setIsSequentialRunning(false);
      sequentialQueueRef.current = [];
      sequentialIndexRef.current = 0;
      pendingNextTopicRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneCount, characterRefImages, styleRefImages, characterStrength, styleStrength, characterDescription, refVideoAnalysis]);

  // 순차 생성: step이 COMPLETED로 바뀔 때
  useEffect(() => {
    const prev = prevStepRef.current;
    prevStepRef.current = step;
    if (!isSequentialRunning) return;
    if (prev !== GenerationStep.COMPLETED && step === GenerationStep.COMPLETED) {
      if (isVideoGenerating) {
        pendingNextTopicRef.current = true; // 영상 렌더링 끝나면 실행
      } else {
        triggerNextTopic();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // 순차 생성: 영상 렌더링 완료 후 대기 중인 다음 주제 실행
  useEffect(() => {
    if (!isSequentialRunning || !pendingNextTopicRef.current) return;
    if (!isVideoGenerating) {
      pendingNextTopicRef.current = false;
      triggerNextTopic();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVideoGenerating]);

  const selectImageModel = useCallback((id: ImageModelId) => { setImageModelId(id); localStorage.setItem(CONFIG.STORAGE_KEYS.IMAGE_MODEL, id); }, []);
  const selectImageTextMode = useCallback((m: string) => { setImageTextMode(m); localStorage.setItem(CONFIG.STORAGE_KEYS.IMAGE_TEXT_MODE, m); }, []);
  const selectAspectRatio = (r: '16:9' | '9:16') => { setAspectRatio(r); localStorage.setItem(CONFIG.STORAGE_KEYS.ASPECT_RATIO, r); onAspectRatioChange?.(r); };
  const changeLongformDuration = (v: number) => { setLongformDuration(v); localStorage.setItem(CONFIG.STORAGE_KEYS.LONGFORM_DURATION, String(v)); };
  const changeShortformDuration = (v: number) => { setShortformDuration(v); localStorage.setItem(CONFIG.STORAGE_KEYS.SHORTFORM_DURATION, String(v)); };
  const selectVisualStyle = useCallback((id: VisualStyleId) => {
    const next = visualStyleId === id ? 'none' : id;
    setVisualStyleId(next);
    localStorage.setItem(CONFIG.STORAGE_KEYS.VISUAL_STYLE_ID, next);
  }, [visualStyleId]);
  const saveProject = () => {
    if (!newProjectName.trim()) return;
    const p: ProjectSettings = { id: Date.now().toString(), name: newProjectName.trim(), createdAt: Date.now(), updatedAt: Date.now(), imageModel: imageModelId, elevenLabsVoiceId: getElevenLabsModelId(), elevenLabsModel: getElevenLabsModelId() };
    const u = [...projects, p]; setProjects(u); localStorage.setItem(CONFIG.STORAGE_KEYS.PROJECTS, JSON.stringify(u)); setNewProjectName('');
  };
  const loadProject = (p: ProjectSettings) => {
    setImageModelId(p.imageModel as ImageModelId);
    localStorage.setItem(CONFIG.STORAGE_KEYS.IMAGE_MODEL, p.imageModel);
    setVoiceSetting(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID, p.elevenLabsVoiceId);
    setElevenLabsModelId(p.elevenLabsModel as any);
    setVoicePanelRefreshKey(k => k + 1);
    alert(`"${p.name}" 불러오기 완료`);
  };
  const deleteProject = (id: string) => { if (!confirm('삭제?')) return; const u = projects.filter(p => p.id !== id); setProjects(u); localStorage.setItem(CONFIG.STORAGE_KEYS.PROJECTS, JSON.stringify(u)); };

  const isProcessing = step !== GenerationStep.IDLE && step !== GenerationStep.COMPLETED && step !== GenerationStep.ERROR && step !== GenerationStep.SCRIPT_READY;
  const canSubmitAuto = topic.trim().length > 0;
  const canSubmitManual = manualScript.trim().length > 0;

  const buildRefImages = useCallback((): ReferenceImages => ({ character: characterRefImages, style: styleRefImages, characterStrength, styleStrength, characterDescription }), [characterRefImages, styleRefImages, characterStrength, styleStrength, characterDescription]);

  // 채널 URL 엔터 또는 분석 트리거
  const runChannelAnalysis = useCallback(async (url: string) => {
    if (!url.trim() || isAnalyzingChannel) return;
    setRefVideoAnalysis('');
    setIsAnalyzingChannel(true);
    try {
      const analysis = await analyzeReferenceChannel(url.trim());
      setRefVideoAnalysis(analysis);
    } catch (e: any) {
      console.warn('[ChannelAnalysis]', e);
    } finally {
      setIsAnalyzingChannel(false);
    }
  }, [isAnalyzingChannel]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault(); if (isProcessing) return;
    const refImages = buildRefImages();
    const rvCtx = refVideoAnalysis || undefined;
    const dur = aspectRatio === '16:9' ? longformDuration : shortformDuration / 60;
    const tMin = dur > 0 ? dur : undefined;
    // sceneCount=0이면 분 수 기반 자동 계산 (7씬/분)
    const effCount = sceneCount || (tMin ? Math.max(1, Math.round(tMin * 7)) : 0);
    if (activeTab === 'auto') { if (canSubmitAuto) onGenerate(topic, refImages, null, effCount, autoRunMode, false, rvCtx, selectedCategory || undefined, tMin, scriptBlueprint || undefined); }
    else { if (canSubmitManual) onGenerate("Manual Script Input", refImages, manualScript, effCount, false, false, rvCtx); }
  }, [isProcessing, activeTab, topic, manualScript, sceneCount, longformDuration, shortformDuration, aspectRatio, onGenerate, buildRefImages, canSubmitAuto, canSubmitManual, autoRunMode, refVideoAnalysis, selectedCategory]);

  const handleFullAuto = useCallback(() => {
    console.log('[FullAuto] clicked, tab:', activeTab, 'topic:', topic, 'manual:', manualScript?.slice(0, 20));
    const refImages = buildRefImages();
    const rvCtx = refVideoAnalysis || undefined;
    if (activeTab === 'auto') {
      if (!topic.trim() && !rvCtx) {
        alert('주제를 입력하거나 레퍼런스 채널을 분석해주세요.');
        return;
      }
      const effectiveTopic = topic.trim() || '레퍼런스 채널 스타일로 자동 생성';
      const dur2 = aspectRatio === '16:9' ? longformDuration : shortformDuration / 60;
      const tMin2 = dur2 > 0 ? dur2 : undefined;
      const effCount2 = sceneCount || (tMin2 ? Math.max(1, Math.round(tMin2 * 7)) : 0);
      onGenerate(effectiveTopic, refImages, null, effCount2, true, true, rvCtx, selectedCategory || undefined, tMin2, scriptBlueprint || undefined);
    } else {
      if (!manualScript.trim()) {
        alert('대본을 먼저 입력해주세요.');
        return;
      }
      onGenerate("Manual Script Input", refImages, manualScript, sceneCount, false, true, rvCtx);
    }
  }, [activeTab, topic, manualScript, sceneCount, onGenerate, buildRefImages, refVideoAnalysis, selectedCategory]);


  const handleCharacterImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files) return;
    const slots = 5 - characterRefImages.length;
    const newImages: string[] = [];
    (Array.from(files) as File[]).slice(0, slots).forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        newImages.push(dataUrl);
        setCharacterRefImages((prev: string[]) => [...prev, dataUrl].slice(0, 5));
        // 첫 번째 이미지 업로드 시 Gemini Vision으로 캐릭터 특징 자동 추출
        if (newImages.length === 1) {
          analyzeCharacterReference(dataUrl).then(desc => {
            setCharacterDescription(desc);
          });
        }
      };
      reader.readAsDataURL(file);
    });
    if (characterFileInputRef.current) characterFileInputRef.current.value = '';
  }, [characterRefImages.length]);

  const handleStyleImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files) return;
    const slots = 5 - styleRefImages.length;
    (Array.from(files) as File[]).slice(0, slots).forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => setStyleRefImages(prev => [...prev, reader.result as string].slice(0, 5));
      reader.readAsDataURL(file);
    });
    if (styleFileInputRef.current) styleFileInputRef.current.value = '';
  }, [styleRefImages.length]);

  const PlayIcon = () => <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>;
  const PauseIcon = () => <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>;
  const CheckIcon = () => <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>;

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════

  return (
    <div className="w-full px-4 my-2" style={{ maxWidth: '1600px', margin: '0 auto' }}>
      <div className="flex gap-0 items-stretch" style={{ minHeight: 'calc(100vh - 130px)' }}>

        {/* ════ 왼쪽 사이드바 ════ */}
        <div className="flex-none w-1/3 bg-white/[0.03] border border-white/[0.08] rounded-l-2xl flex flex-col overflow-y-auto" style={{ maxHeight: 'calc(100vh - 130px)' }}>
          {/* 비주얼 스타일 (항상 표시) */}
          {(() => {
            return (
          <div className="p-3 border-b border-white/[0.07]">
            <p className="text-sm font-black text-white/80 uppercase tracking-widest mb-2 px-1 text-center">비주얼 스타일</p>
            <div className="grid grid-cols-3 gap-1.5">
              {VISUAL_STYLES.map(style => (
                <button key={style.id} type="button" onClick={() => selectVisualStyle(style.id as VisualStyleId)}
                  className={`relative rounded-lg border transition-all duration-200 hover:scale-[1.03] active:scale-[0.97] overflow-hidden aspect-video ${
                    visualStyleId === style.id
                      ? 'border-red-400 shadow-[0_0_10px_rgba(239,68,68,0.5)]'
                      : 'border-white/[0.1] hover:border-white/25'
                  }`}>
                  <div className={`absolute inset-0 bg-gradient-to-br ${(style as any).bg}`} />
                  {(style as any).img && (
                    <img src={(style as any).img} alt={style.name} className="absolute inset-0 w-full h-full object-cover"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent pt-3 pb-1 px-1">
                    <p className="text-[9px] font-bold text-white leading-tight text-center drop-shadow-[0_1px_2px_rgba(0,0,0,1)]">{style.name}</p>
                  </div>
                  {visualStyleId === style.id && (
                    <div className="absolute top-0.5 right-0.5 w-3 h-3 bg-red-500 rounded-full flex items-center justify-center shadow-[0_0_5px_rgba(239,68,68,0.8)]">
                      <CheckIcon />
                    </div>
                  )}
                </button>
              ))}
            </div>
            {visualStyleId === 'custom' && (
              <textarea
                value={customStylePrompt}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => { setCustomStylePrompt(e.target.value); localStorage.setItem(CONFIG.STORAGE_KEYS.CUSTOM_STYLE_PROMPT, e.target.value); }}
                placeholder="원하는 스타일을 영어로 입력... (예: anime style, soft pastel colors, clean line art)"
                className="mt-2 w-full bg-slate-900 border border-violet-600 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 resize-none focus:outline-none focus:border-violet-400"
                rows={3}
              />
            )}
            {visualStyleId !== 'none' && (
              <button type="button" onClick={() => selectVisualStyle('none')} className="mt-2 text-xs text-slate-500 hover:text-red-400 transition-colors">선택 해제</button>
            )}
          </div>
            );
          })()}

          {/* 카테고리 버튼들 */}
          <div className="flex flex-col gap-1 p-2">
            {[
              { id: 'image', label: '이미지/영상 설정', icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="3" y="3" width="18" height="18" rx="2" strokeWidth={1.5}/><circle cx="8.5" cy="8.5" r="1.5" strokeWidth={1.5}/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 15l-5-5L5 21"/></svg> },
              { id: 'voice', label: '음성 설정', icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M9 11V7a3 3 0 116 0v4a3 3 0 11-6 0z"/></svg> },
              { id: 'thumbnail', label: '썸네일 생성', icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg> },
              { id: 'project', label: '저장된 프로젝트', icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"/></svg> },
            ].map(({ id, label, icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => id === 'project' && onOpenGallery ? onOpenGallery() : setActivePanel(activePanel === id ? null : id)}
                className={`flex items-center gap-4 px-5 py-5 rounded-2xl transition-all text-left ${
                  activePanel === id
                    ? 'bg-gradient-to-r from-red-500/20 to-rose-500/10 border border-red-500/40 text-red-300 shadow-[0_0_12px_rgba(239,68,68,0.15)]'
                    : 'text-white/65 hover:bg-white/[0.06] hover:text-white border border-transparent'
                }`}
              >
                <span className="flex-none">{icon}</span>
                <span className="text-xl font-bold">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ════ 오른쪽 메인 패널 ════ */}
        <div className="flex-1 bg-white/[0.02] border border-l-0 border-white/[0.08] rounded-r-2xl overflow-y-auto flex flex-col" style={{ maxHeight: 'calc(100vh - 130px)' }}>

          {activePanel === null ? (
            /* ── 기본 입력 패널 ── */
            <div className="flex flex-col h-full p-6 gap-5">

              {/* 탭 */}
              <div className="flex gap-1 bg-black/60 p-1 rounded-xl border border-white/[0.07]">
                <button type="button" onClick={() => handleLocalTabChange('auto')}
                  className={`flex-1 py-3 rounded-lg text-base font-bold transition-all ${localTab === 'auto' ? 'bg-blue-600/20 border border-blue-500/50 text-blue-200 shadow-[0_0_10px_rgba(59,130,246,0.35)]' : 'text-white/40 hover:text-white/70 border border-transparent'}`}>
                  주제 자동생성
                </button>
                <button type="button" onClick={() => handleLocalTabChange('manual')}
                  className={`flex-1 py-3 rounded-lg text-base font-bold transition-all ${localTab === 'manual' ? 'bg-blue-600/20 border border-blue-500/50 text-blue-200 shadow-[0_0_10px_rgba(59,130,246,0.35)]' : 'text-white/40 hover:text-white/70 border border-transparent'}`}>
                  수동 대본
                </button>
                <button type="button" onClick={() => handleLocalTabChange('audio-first')}
                  className={`flex-1 py-3 rounded-lg text-base font-bold transition-all ${localTab === 'audio-first' ? 'bg-purple-600/20 border border-purple-500/50 text-purple-200 shadow-[0_0_10px_rgba(168,85,247,0.35)]' : 'text-white/40 hover:text-white/70 border border-transparent'}`}>
                  음성으로 시작
                </button>
              </div>

              {/* 입력 영역 */}
              <form onSubmit={handleSubmit} className="flex flex-col gap-5 flex-1">
                {/* 오디오-퍼스트 탭 콘텐츠 */}
                {localTab === 'audio-first' && (
                  <div className="flex flex-col gap-4">
                    {/* 파일 선택 영역 */}
                    {!pendingAudioFile ? (
                      <div
                        onClick={() => audioFileInputRef.current?.click()}
                        onDragOver={(e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.currentTarget.setAttribute('data-drag', 'true'); }}
                        onDragLeave={(e: React.DragEvent<HTMLDivElement>) => { e.currentTarget.removeAttribute('data-drag'); }}
                        onDrop={(e: React.DragEvent<HTMLDivElement>) => {
                          e.preventDefault();
                          e.currentTarget.removeAttribute('data-drag');
                          const file = e.dataTransfer.files?.[0];
                          if (file && file.type.startsWith('audio/')) setPendingAudioFile(file);
                        }}
                        className="flex flex-col items-center justify-center gap-4 p-10 rounded-2xl border-2 border-dashed border-purple-500/40 bg-purple-900/10 cursor-pointer hover:border-purple-400/70 hover:bg-purple-900/20 transition-all [&[data-drag]]:border-purple-400 [&[data-drag]]:bg-purple-900/30"
                      >
                        <svg className="w-12 h-12 text-purple-400/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/>
                        </svg>
                        <div className="text-center">
                          <p className="text-white/80 font-bold text-lg">음성 파일 업로드</p>
                          <p className="text-white/40 text-sm mt-1">클릭하거나 파일을 여기에 드래그하세요</p>
                          <p className="text-white/30 text-xs mt-1">MP3, WAV, M4A, AAC 지원</p>
                        </div>
                      </div>
                    ) : (
                      /* 파일 선택됨 → 세팅 후 시작 */
                      <div className="flex flex-col gap-3 p-5 rounded-2xl border border-purple-500/40 bg-purple-900/10">
                        {/* 선택된 파일 */}
                        <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.05]">
                          <svg className="w-5 h-5 text-purple-400 flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
                          </svg>
                          <span className="text-white/80 text-sm font-bold truncate flex-1">{pendingAudioFile.name}</span>
                          <button type="button" onClick={() => setPendingAudioFile(null)} className="text-white/30 hover:text-white/70 text-xs">✕</button>
                        </div>
                        {/* 대본 입력 (선택) — 롱폼 JSON 안정성 대폭 향상 */}
                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-purple-300/70 font-bold">대본 입력 <span className="text-white/30 font-normal">(선택 — 입력 시 롱폼 안정성 향상)</span></label>
                          <textarea
                            value={audioScriptText}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setAudioScriptText(e.target.value)}
                            placeholder="대본이 있으면 여기에 붙여넣으세요. AI가 타임스탬프만 정렬하므로 JSON 파싱 오류가 사라집니다."
                            rows={5}
                            className="w-full bg-black/40 border border-purple-500/30 rounded-xl px-3 py-2 text-sm text-white/80 placeholder-white/20 focus:outline-none focus:border-purple-400/60 resize-none"
                          />
                        </div>
                        <p className="text-white/30 text-xs text-center">세팅을 완료한 후 아래 버튼을 누르세요</p>
                        {/* 시작 버튼 */}
                        <button
                          type="button"
                          disabled={isProcessing}
                          onClick={() => {
                            if (onAudioFirstGenerate) {
                              // sceneCount=0이면 longformDuration 기반 자동 계산 (8씬/분)
                              const SCENES_PER_MIN = 8;
                              const dur = aspectRatio === '16:9' ? longformDuration : shortformDuration;
                              const effectiveCount = sceneCount || dur * SCENES_PER_MIN;
                              onAudioFirstGenerate(pendingAudioFile, buildRefImages(), effectiveCount, audioScriptText.trim() || undefined);
                              setPendingAudioFile(null);
                              setAudioScriptText('');
                            }
                          }}
                          className="w-full py-4 rounded-xl bg-purple-600/40 hover:bg-purple-600/60 disabled:opacity-50 text-white font-black text-lg transition-all border border-purple-400/50 shadow-[0_0_20px_rgba(168,85,247,0.35)]"
                        >
                          {isProcessing ? '분석 중...' : '분석 시작'}
                        </button>
                      </div>
                    )}
                    <input
                      ref={audioFileInputRef}
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        const file = e.target.files?.[0];
                        if (file) setPendingAudioFile(file);
                        e.target.value = '';
                      }}
                    />
                  </div>
                )}
                {localTab === 'auto' ? (
                  <div className="flex flex-col gap-3">
                    {/* 직접 입력 */}
                    <div className="bg-black/50 border border-blue-500/25 rounded-2xl overflow-hidden">
                      <input type="text" value={topic} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTopic(e.target.value)} disabled={isProcessing}
                        placeholder="주제를 입력하거나 아래에서 카테고리를 선택하세요..."
                        className="block w-full bg-transparent text-white py-4 px-6 focus:ring-0 focus:outline-none placeholder-white/20 text-base disabled:opacity-50" />
                    </div>

                    {/* 카테고리 선택 */}
                    {(() => {
                      const CATEGORIES = [
                        { id: '한국 야담/기담/미스터리', label: '야담/기담', sub: 'MYSTERY' },
                        { id: '경제/재테크/투자', label: '경제/재테크', sub: 'ECONOMY' },
                        { id: '한국사/세계사', label: '역사', sub: 'HISTORY' },
                        { id: '과학/우주/자연', label: '과학/우주', sub: 'SCIENCE' },
                        { id: '뉴스/시사/사회', label: '뉴스/시사', sub: 'NEWS' },
                        { id: '종교/영성/철학', label: '종교/철학', sub: 'RELIGION' },
                        { id: '건강/의학', label: '건강/의학', sub: 'HEALTH' },
                        { id: '심리/정신건강', label: '심리', sub: 'PSYCHOLOGY' },
                        { id: '연예/문화', label: '연예', sub: 'ENTERTAIN' },
                        { id: '스포츠', label: '스포츠', sub: 'SPORTS' },
                        { id: '유머/웃긴영상', label: '유머', sub: 'HUMOR' },
                        { id: '영화/드라마/애니', label: '영화/드라마', sub: 'MOVIE' },
                        { id: '쇼핑/제품리뷰', label: '쇼핑/리뷰', sub: 'SHOPPING' },
                      ];
                      const allSelected = suggestedTopics.length > 0 && selectedTopics.size === suggestedTopics.length;
                      return (
                        <div className="flex flex-col gap-2">
                          {/* 카테고리 버튼 5×2 */}
                          <div className="grid grid-cols-5 gap-2">
                            {CATEGORIES.map(cat => (
                              <button key={cat.id} type="button"
                                onClick={() => {
                                  setSelectedCategory(prev => prev === cat.id ? '' : cat.id);
                                  setSuggestedTopics([]);
                                  setSelectedTopics(new Set());
                                }}
                                disabled={isProcessing || isLoadingTopics}
                                className={`relative p-2 rounded-xl border transition-all duration-200 hover:scale-[1.04] active:scale-[0.97] flex flex-col items-center justify-center text-center ${
                                  selectedCategory === cat.id
                                    ? 'border-red-400/80 bg-red-900/30 shadow-[0_0_14px_rgba(239,68,68,0.45)]'
                                    : 'border-white/[0.1] bg-slate-800/70 hover:border-white/30 hover:bg-slate-700/70'
                                }`}>
                                <p className="text-xs font-black text-white leading-tight">{cat.label}</p>
                                <p className="text-[8px] text-slate-500 mt-0.5 font-bold tracking-wider">{cat.sub}</p>
                                {selectedCategory === cat.id && (
                                  <div className="absolute top-1 right-1 w-3 h-3 bg-red-500 rounded-full flex items-center justify-center shadow-[0_0_6px_rgba(239,68,68,0.7)]">
                                    <CheckIcon />
                                  </div>
                                )}
                              </button>
                            ))}
                          </div>

                          {/* 주제 추천 버튼 */}
                          {selectedCategory && (
                            <button type="button"
                              onClick={async () => {
                                setSuggestedTopics([]);
                                setSelectedTopics(new Set());
                                setIsLoadingTopics(true);
                                try {
                                  const usedTopics = suggestedTopics.map(t => t.topic);
                                  const result = await findTrendingTopics(selectedCategory, usedTopics);
                                  if (Array.isArray(result)) setSuggestedTopics(result);
                                } catch (e: any) { alert(`주제 추천 실패: ${e?.message || e}`); }
                                finally { setIsLoadingTopics(false); }
                              }}
                              disabled={isProcessing || isLoadingTopics}
                              className="w-full py-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 font-bold text-sm transition-all disabled:opacity-50">
                              {isLoadingTopics ? '주제 추천 중...' : suggestedTopics.length > 0 ? '다시 추천받기' : '주제 추천받기'}
                            </button>
                          )}

                          {/* 주제 목록 (체크박스 다중 선택) */}
                          {isLoadingTopics && (
                            <div className="text-center py-3 text-amber-300/80 text-sm animate-pulse">주제 추천 중...</div>
                          )}
                          {!isLoadingTopics && suggestedTopics.length > 0 && (
                            <div className="bg-black/40 border border-amber-500/20 rounded-xl p-2 flex flex-col gap-1">
                              {/* 전체선택 + 순차 생성 버튼 */}
                              <div className="flex items-center justify-between px-1 mb-1">
                                <button type="button"
                                  onClick={() => setSelectedTopics(allSelected ? new Set() : new Set(suggestedTopics.map(t => t.rank)))}
                                  className="text-[10px] text-amber-400/70 hover:text-amber-300 font-bold transition-colors">
                                  {allSelected ? '전체 해제' : '전체 선택'}
                                </button>
                                {selectedTopics.size > 0 && !isSequentialRunning && (
                                  <button type="button"
                                    onClick={() => {
                                      const queue = suggestedTopics
                                        .filter(t => selectedTopics.has(t.rank))
                                        .map(t => t.topic);
                                      if (queue.length === 0) return;
                                      sequentialQueueRef.current = queue.slice(1);
                                      sequentialIndexRef.current = 0;
                                      pendingNextTopicRef.current = false;
                                      setIsSequentialRunning(true);
                                      const first = queue[0];
                                      setTopic(first);
                                      onGenerate(first, { character: characterRefImages, style: styleRefImages, characterStrength, styleStrength, characterDescription }, null, sceneCount, true, true, refVideoAnalysis || undefined, selectedCategory || undefined);
                                    }}
                                    className="px-3 py-1 rounded-lg bg-green-500/20 border border-green-500/40 text-green-300 text-[10px] font-bold hover:bg-green-500/30 transition-all">
                                    🚀 {selectedTopics.size}개 전체 자동 생성
                                  </button>
                                )}
                                {isSequentialRunning && (
                                  <span className="text-[10px] text-green-400 animate-pulse font-bold">
                                    {isVideoGenerating ? '🎬 렌더링 중...' : `⚙️ ${sequentialQueueRef.current.length - sequentialIndexRef.current + 1}개 남음`}
                                  </span>
                                )}
                              </div>
                              {suggestedTopics.map((t: {rank: number; topic: string; reason: string}) => (
                                <div key={t.rank}
                                  className={`flex items-start gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all border ${
                                    selectedTopics.has(t.rank)
                                      ? 'bg-amber-500/15 border-amber-400/40 text-amber-100'
                                      : 'bg-white/[0.03] border-transparent hover:bg-white/[0.06] hover:border-white/10 text-white/80'
                                  }`}
                                  onClick={() => {
                                    const isNowSelected = !selectedTopics.has(t.rank);
                                    setSelectedTopics(prev => {
                                      const next = new Set(prev);
                                      if (next.has(t.rank)) next.delete(t.rank); else next.add(t.rank);
                                      return next;
                                    });
                                    setTopic(t.topic);
                                    // 전체 자동 실행 모드: 주제 선택 시 바로 생성 시작 (대본+이미지+오디오+렌더링 전부)
                                    if (autoRunMode && isNowSelected && !isProcessing) {
                                      const refImages = buildRefImages();
                                      const rvCtx = refVideoAnalysis || undefined;
                                      const dur = aspectRatio === '16:9' ? longformDuration : shortformDuration / 60;
                                      const tMin = dur > 0 ? dur : undefined;
                                      const effCount = sceneCount || (tMin ? Math.max(1, Math.round(tMin * 7)) : 0);
                                      onGenerate(t.topic, refImages, null, effCount, true, true, rvCtx, selectedCategory || undefined, tMin, scriptBlueprint || undefined);
                                    }
                                  }}>
                                  <div className={`mt-0.5 w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center transition-all ${
                                    selectedTopics.has(t.rank) ? 'bg-amber-500 border-amber-400' : 'border-white/30'
                                  }`}>
                                    {selectedTopics.has(t.rank) && <CheckIcon />}
                                  </div>
                                  <span className="text-sm flex-1">{t.topic}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* 글쓰기 프로필 + 자동실행 토글 */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <WritingProfilePanel activeCategory={selectedCategory} />
                      <label className="flex items-center gap-2 ml-auto cursor-pointer select-none">
                        <span className="text-xs text-white/50 font-bold">전체 자동 실행</span>
                        <div onClick={() => setAutoRunMode((v: boolean) => !v)}
                          className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${autoRunMode ? 'bg-green-500' : 'bg-white/20'}`}>
                          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${autoRunMode ? 'left-5' : 'left-0.5'}`} />
                        </div>
                      </label>
                    </div>

                    {autoRunMode && (
                      <div className="text-xs text-green-400/70 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
                        ✅ 전체 자동 실행 ON: 주제 클릭 즉시 대본+이미지+오디오 자동 생성 시작
                      </div>
                    )}

                    {/* 대본 구조 설계 (블루프린트) */}
                    <div>
                      <button type="button"
                        onClick={() => setShowBlueprint(v => !v)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${scriptBlueprint.trim() ? 'bg-amber-600/15 border-amber-500/40 text-amber-300' : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:text-white/80'}`}>
                        📋 대본 구조 설계 {scriptBlueprint.trim() ? '(설정됨)' : ''} {showBlueprint ? '▲' : '▼'}
                      </button>
                    </div>
                    {showBlueprint && (
                      <div className="bg-black/50 border border-amber-500/20 rounded-2xl p-3 space-y-2">
                        <p className="text-[11px] text-amber-400/60 leading-relaxed">
                          각 섹션의 이름, 분량, 내용 지침을 작성하세요. 15분 초과 시 섹션별 분리 생성됩니다.<br/>
                          형식: <span className="text-white/40">섹션명 (N분): 내용 설명</span>
                        </p>
                        {/* 프리셋 버튼 */}
                        <div className="flex flex-wrap gap-1.5">
                          {BLUEPRINT_PRESETS.map(p => (
                            <button key={p.label} type="button"
                              onClick={() => { setScriptBlueprint(p.value); localStorage.setItem('heaven_script_blueprint', p.value); }}
                              className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-amber-600/15 border border-amber-500/30 text-amber-300/80 hover:bg-amber-600/25 hover:text-amber-200 transition-colors">
                              {p.label}
                            </button>
                          ))}
                          {scriptBlueprint.trim() && (
                            <button type="button"
                              onClick={() => { setScriptBlueprint(''); localStorage.removeItem('heaven_script_blueprint'); }}
                              className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-white/[0.04] border border-white/10 text-white/30 hover:text-red-400 transition-colors">
                              초기화
                            </button>
                          )}
                        </div>
                        <textarea
                          value={scriptBlueprint}
                          onChange={e => { setScriptBlueprint(e.target.value); localStorage.setItem('heaven_script_blueprint', e.target.value); }}
                          rows={6}
                          placeholder={"예:\n초반 후킹 (1분): 충격적인 사건으로 시작, 인사말 없이 바로\n발단 (3분): 주인공과 배경 소개\n전개 (10분): 갈등 심화, 감정선 집중\n절정 (5분): 반전과 진실\n결말 (1분): 여운 있는 마무리"}
                          className="w-full bg-black/60 border border-amber-500/20 rounded-xl px-3 py-2.5 text-sm text-white/80 placeholder-white/20 resize-none focus:outline-none focus:border-amber-400/40"
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-black/50 border border-blue-500/25 rounded-2xl overflow-hidden flex flex-col flex-1 min-h-0">
                    <textarea value={manualScript} onChange={(e) => onManualScriptChange(e.target.value)} disabled={isProcessing}
                      placeholder={"여기에 대본을 붙여넣거나 직접 작성하세요.\n\n예)\n나레이션 1: 옛날 옛적...\n나레이션 2: ..."}
                      className="flex-1 bg-transparent text-white p-6 focus:ring-0 focus:outline-none placeholder-white/20 resize-none text-base" />
                    <div className="px-6 pb-3 flex items-center justify-between border-t border-white/[0.07] pt-2">
                      <div className="flex items-center gap-3">
                        <span className={`text-sm font-mono ${manualScript.length > 10000 ? 'text-amber-400' : manualScript.length > 3000 ? 'text-blue-400' : 'text-white/25'}`}>
                          {manualScript.length.toLocaleString()}자
                        </span>
                        {manualScript.trim().length > 0 && (
                          <button
                            onClick={() => onManualScriptChange('')}
                            disabled={isProcessing}
                            className="text-xs text-red-400/70 hover:text-red-400 font-bold transition-colors disabled:opacity-30"
                          >
                            대본 삭제
                          </button>
                        )}
                      </div>
                      {/* 롱폼(16:9)에서만 예상 시간 표시 */}
                      {aspectRatio === '16:9' && manualScript.trim().length > 0 && (() => {
                        const totalSec = Math.round(manualScript.trim().length / 7.2); // 한국어 나레이션 약 432자/분 → 7.2자/초
                        const m = Math.floor(totalSec / 60);
                        const s = totalSec % 60;
                        return (
                          <span className="text-sm text-emerald-400/80 font-mono">
                            ⏱ 약 {m > 0 ? `${m}분 ` : ''}{s}초
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {/* 씬 수 + 영상 포맷 */}
                <div className="grid grid-cols-2 gap-4">
                  {/* 씬 수 */}
                  <div className="bg-white/[0.02] border border-blue-500/20 rounded-xl p-4 shadow-[0_0_8px_rgba(59,130,246,0.06)]">
                    <p className="text-base font-bold text-white/60 mb-2">씬 수</p>
                    <div className="flex items-center gap-2">
                      <input type="number" min={0} max={500}
                        value={sceneCount === 0 ? '' : sceneCount}
                        onChange={(e) => { const v = parseInt(e.target.value, 10); setSceneCount(isNaN(v) || v < 0 ? 0 : v); }}
                        placeholder="자동"
                        className="w-24 bg-black/60 border border-white/10 rounded-lg px-2 py-2 text-base text-white placeholder-white/25 focus:border-red-500 focus:outline-none text-center" />
                      <span className="text-base text-white/40">{sceneCount > 0 ? `${sceneCount}씬 고정` : 'AI 자동 결정'}</span>
                    </div>
                  </div>

                  {/* 영상 포맷 */}
                  <div className="bg-white/[0.02] border border-blue-500/20 rounded-xl p-4 shadow-[0_0_8px_rgba(59,130,246,0.06)]">
                    <p className="text-base font-bold text-white/60 mb-2">영상 포맷</p>
                    <div className="flex gap-1.5 mb-2">
                      <button type="button" onClick={() => selectAspectRatio('16:9')}
                        className={`flex-1 py-2 rounded-lg text-base font-bold transition-all ${aspectRatio === '16:9' ? 'bg-blue-600/20 border border-blue-500/50 text-blue-200 shadow-[0_0_10px_rgba(59,130,246,0.35)]' : 'bg-white/[0.06] text-white/40 hover:text-white/70 hover:bg-white/[0.1] border border-transparent'}`}>
                        롱폼 16:9
                      </button>
                      <button type="button" onClick={() => selectAspectRatio('9:16')}
                        className={`flex-1 py-2 rounded-lg text-base font-bold transition-all ${aspectRatio === '9:16' ? 'bg-blue-600/20 border border-blue-500/50 text-blue-200 shadow-[0_0_10px_rgba(59,130,246,0.35)]' : 'bg-white/[0.06] text-white/40 hover:text-white/70 hover:bg-white/[0.1] border border-transparent'}`}>
                        숏폼 9:16
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="number" min={1} max={aspectRatio === '16:9' ? 180 : 300}
                        value={aspectRatio === '16:9' ? longformDuration : shortformDuration}
                        onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) { aspectRatio === '16:9' ? changeLongformDuration(v) : changeShortformDuration(v); }}}
                        className="w-16 bg-black/60 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white text-center focus:border-red-500 focus:outline-none" />
                      <span className="text-sm text-white/40">{aspectRatio === '16:9' ? '분' : '초'}</span>
                      {aspectRatio === '16:9' && longformDuration > 15 && (
                        <span className="text-xs text-amber-400/70 font-bold">블루프린트 권장</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 참조 이미지 (캐릭터 + 화풍) */}
                <div className="grid grid-cols-2 gap-4">
                  {/* 캐릭터 */}
                  <div className="bg-white/[0.02] border border-blue-500/20 rounded-xl p-4 shadow-[0_0_8px_rgba(59,130,246,0.06)]"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e: React.DragEvent) => { e.preventDefault(); const files = Array.from(e.dataTransfer.files).filter((f: File) => f.type.startsWith('image/')); if (files.length) handleCharacterImageChange({ target: { files } } as any); }}>
                    <p className="text-base font-bold text-slate-200 mb-1">캐릭터 참조 <span className="text-xs text-slate-500 font-normal">최대 5개 · 클릭/드래그</span></p>
                    <div className="flex flex-wrap gap-2 items-center">
                      {characterRefImages.map((img, i) => (
                        <div key={i} className="relative group w-12 h-10 rounded overflow-hidden border border-violet-500/50">
                          <img src={img} alt="" className="w-full h-full object-cover" />
                          <button type="button" onClick={() => { setCharacterRefImages((prev: string[]) => { const next = prev.filter((_: string, idx: number) => idx !== i); if (next.length === 0) { setCharacterDescription(''); } return next; }); }}
                            className="absolute inset-0 bg-red-500/70 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center text-xs font-bold">✕</button>
                        </div>
                      ))}
                      {characterRefImages.length < 5 && (
                        <button type="button"
                          onClick={() => characterFileInputRef.current?.click()}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e: React.DragEvent) => { e.preventDefault(); const files = Array.from(e.dataTransfer.files).filter((f: File) => f.type.startsWith('image/')); if (files.length) handleCharacterImageChange({ target: { files } } as any); }}
                          className="w-12 h-10 border-2 border-dashed border-slate-600 rounded flex items-center justify-center text-slate-500 hover:border-violet-500 hover:text-violet-400 text-xl">+</button>
                      )}
                      <input type="file" ref={characterFileInputRef} onChange={handleCharacterImageChange} accept="image/*" className="hidden" multiple />
                    </div>
                    {characterRefImages.length > 0 && (
                      <div className="mt-2 space-y-2">
                        <div className="flex justify-between text-xs mb-1"><span className="text-slate-400">강도</span><span className="text-violet-400">{characterStrength}%</span></div>
                        <input type="range" min={0} max={100} value={characterStrength} onChange={(e) => setCharacterStrength(+e.target.value)} className="w-full accent-violet-500" />
                      </div>
                    )}
                  </div>

                  {/* 화풍 */}
                  <div className="bg-white/[0.02] border border-blue-500/20 rounded-xl p-4 shadow-[0_0_8px_rgba(59,130,246,0.06)]"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e: React.DragEvent) => { e.preventDefault(); const files = Array.from(e.dataTransfer.files).filter((f: File) => f.type.startsWith('image/')); if (files.length) handleStyleImageChange({ target: { files } } as any); }}>
                    <p className="text-base font-bold text-slate-200 mb-1">화풍 참조 <span className="text-xs text-slate-500 font-normal">최대 5개 · 클릭/드래그</span></p>
                    <div className="flex flex-wrap gap-2 items-center">
                      {styleRefImages.map((img, i) => (
                        <div key={i} className="relative group w-12 h-10 rounded overflow-hidden border border-fuchsia-500/50">
                          <img src={img} alt="" className="w-full h-full object-cover" />
                          <button type="button" onClick={() => setStyleRefImages(prev => prev.filter((_, idx) => idx !== i))}
                            className="absolute inset-0 bg-red-500/70 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center text-xs font-bold">✕</button>
                        </div>
                      ))}
                      {styleRefImages.length < 5 && (
                        <button type="button"
                          onClick={() => styleFileInputRef.current?.click()}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e: React.DragEvent) => { e.preventDefault(); const files = Array.from(e.dataTransfer.files).filter((f: File) => f.type.startsWith('image/')); if (files.length) handleStyleImageChange({ target: { files } } as any); }}
                          className="w-12 h-10 border-2 border-dashed border-slate-600 rounded flex items-center justify-center text-slate-500 hover:border-fuchsia-500 hover:text-fuchsia-400 text-xl">+</button>
                      )}
                      <input type="file" ref={styleFileInputRef} onChange={handleStyleImageChange} accept="image/*" className="hidden" multiple />
                    </div>
                    {styleRefImages.length > 0 && (
                      <div className="mt-2">
                        <div className="flex justify-between text-xs mb-1"><span className="text-slate-400">강도</span><span className="text-fuchsia-400">{styleStrength}%</span></div>
                        <input type="range" min={0} max={100} value={styleStrength} onChange={(e) => setStyleStrength(+e.target.value)} className="w-full accent-fuchsia-500" />
                      </div>
                    )}
                  </div>
                </div>

                {/* 레퍼런스 채널 */}
                <div className="bg-white/[0.02] border border-orange-500/25 rounded-xl p-4 shadow-[0_0_8px_rgba(249,115,22,0.06)]">
                  <p className="text-base font-bold text-slate-200 mb-1">레퍼런스 채널 <span className="text-xs text-slate-500 font-normal">스타일 복제할 YouTube 채널</span></p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={refChannelUrl}
                      onChange={(e) => { setRefChannelUrl(e.target.value); setRefVideoAnalysis(''); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runChannelAnalysis(refChannelUrl); } }}
                      placeholder="https://youtube.com/@채널명 — 엔터로 분석"
                      disabled={isProcessing || isAnalyzingChannel}
                      className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-orange-500/50 disabled:opacity-50"
                    />
                    {isAnalyzingChannel && <span className="w-3.5 h-3.5 border-2 border-orange-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
                    {refVideoAnalysis && !isAnalyzingChannel && (
                      <button type="button" onClick={() => setRefVideoAnalysis('')}
                        className="text-xs text-slate-500 hover:text-red-400 transition-colors px-1 flex-shrink-0">✕</button>
                    )}
                  </div>
                  {refVideoAnalysis && !isAnalyzingChannel && (
                    <div className="mt-2 text-[11px] text-orange-200/70 bg-black/30 rounded-lg p-2 max-h-24 overflow-y-auto leading-relaxed whitespace-pre-wrap">
                      {refVideoAnalysis}
                    </div>
                  )}
                </div>

                {/* 생성 버튼 (audio-first 탭에서는 숨김) */}
                {localTab !== 'audio-first' && (<>
                <div className="relative">
                  {/* 네온 바 */}
                  <div className="absolute -top-px left-8 right-8 h-px bg-gradient-to-r from-transparent via-red-500 to-transparent opacity-80" />
                  <button type="submit" disabled={isProcessing || (localTab === 'auto' ? !canSubmitAuto : !canSubmitManual)}
                    className="w-full relative bg-red-500/60 hover:bg-red-500/75 disabled:opacity-60 text-white font-black py-6 rounded-2xl transition-all text-2xl tracking-wide border border-red-300/60 hover:border-red-200/80 shadow-[0_0_35px_rgba(239,68,68,0.5)] hover:shadow-[0_0_55px_rgba(239,68,68,0.7)] disabled:shadow-none">
                    {isProcessing ? '생성 중...' : localTab === 'auto' ? '대본 생성 시작' : '스토리보드 생성'}
                  </button>
                  {/* 하단 네온 바 */}
                  <div className="absolute -bottom-px left-8 right-8 h-px bg-gradient-to-r from-transparent via-rose-400 to-transparent opacity-60" />
                </div>

                {/* 전체 자동 생성 버튼 */}
                <button type="button" onClick={handleFullAuto}
                  className="w-full flex items-center justify-center gap-2 px-4 py-4 rounded-xl bg-green-500/20 hover:bg-green-500/35 text-white text-lg font-black transition-all border border-green-400/60 hover:border-green-300/80 shadow-[0_0_25px_rgba(34,197,94,0.35)] hover:shadow-[0_0_40px_rgba(34,197,94,0.55)]">
                  {isProcessing ? (
                    <><span className="w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />처리 중...</>
                  ) : (localTab === 'auto' && !canSubmitAuto) ? (
                    <>🚀 전체 자동 생성 + 렌더링 <span className="text-xs font-normal opacity-60">(주제 입력 필요)</span></>
                  ) : (
                    <>🚀 전체 자동 생성 + 렌더링</>
                  )}
                </button>

                {/* 캐릭터 분석 버튼 (수동 대본 탭에서만) */}
                {localTab === 'manual' && onCharacterAnalyze && (
                  <button type="button"
                    onClick={() => onCharacterAnalyze("Manual Script Input", buildRefImages(), manualScript, sceneCount)}
                    disabled={isProcessing || isAnalyzingCharacters || !canSubmitManual}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 disabled:opacity-60 text-white text-base font-bold transition-all border border-emerald-500/50 hover:border-emerald-400/70 shadow-[0_0_18px_rgba(16,185,129,0.25)] hover:shadow-[0_0_28px_rgba(16,185,129,0.4)] disabled:shadow-none">
                    {isAnalyzingCharacters ? (
                      <>
                        <span className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                        캐릭터 분석 중...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                        캐릭터 분석
                      </>
                    )}
                  </button>
                )}

                </>)}
              </form>
            </div>

          ) : (
            /* ── 설정 패널 ── */
            <div className="flex flex-col h-full">
              {/* 패널 헤더 */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.07] bg-black/30">
                <h3 className="font-black text-white text-sm tracking-wide uppercase">
                  {activePanel === 'visual' && '비주얼 스타일'}
                  {activePanel === 'image' && '이미지/영상 설정'}
                  {activePanel === 'voice' && '음성 설정'}
                  {activePanel === 'thumbnail' && '썸네일 생성'}
                  {activePanel === 'project' && '프로젝트'}
                </h3>
                <button type="button" onClick={() => setActivePanel(null)}
                  className="px-3 py-1.5 bg-white/[0.06] hover:bg-white/[0.1] text-white/50 hover:text-white rounded-lg text-xs font-bold transition-colors border border-white/[0.08]">
                  ← 돌아가기
                </button>
              </div>

              {/* 패널 내용 */}
              <div className={`flex-1 p-3 ${activePanel === 'voice' ? 'overflow-hidden flex flex-col' : 'overflow-y-auto space-y-3'}`}>

                {/* 🎨 비주얼 스타일 패널 */}
                {activePanel === 'visual' && (
                  <div>
                    <div className="grid grid-cols-3 gap-2">
                      {VISUAL_STYLES.map(style => (
                        <button key={style.id} type="button" onClick={() => selectVisualStyle(style.id as VisualStyleId)}
                          className={`relative rounded-xl border transition-all overflow-hidden hover:scale-[1.04] active:scale-[0.97] ${visualStyleId === style.id ? 'border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.35)]' : 'border-white/[0.08] hover:border-white/20'}`}>
                          <div className={`w-full aspect-square bg-gradient-to-br ${(style as any).bg} flex flex-col items-center justify-center gap-1 p-1`}>
                            <span className="text-3xl leading-none">{(style as any).emoji || ''}</span>
                            <span className="text-[11px] font-black text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)] text-center leading-snug px-0.5">{style.name}</span>
                          </div>
                          {visualStyleId === style.id && (
                            <div className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center shadow-[0_0_6px_rgba(239,68,68,0.6)]">
                              <CheckIcon />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                    {visualStyleId === 'custom' && (
                      <textarea
                        value={customStylePrompt}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => { setCustomStylePrompt(e.target.value); localStorage.setItem(CONFIG.STORAGE_KEYS.CUSTOM_STYLE_PROMPT, e.target.value); }}
                        placeholder="원하는 스타일을 영어로 입력... (예: anime style, soft pastel colors, clean line art)"
                        className="mt-3 w-full bg-slate-900 border border-violet-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 resize-none focus:outline-none focus:border-violet-400"
                        rows={3}
                      />
                    )}
                    {visualStyleId !== 'none' && (
                      <button type="button" onClick={() => selectVisualStyle('none')} className="mt-3 text-sm text-slate-500 hover:text-red-400 transition-colors">선택 해제</button>
                    )}
                  </div>
                )}

                {/* 🖼️ 이미지 설정 패널 */}
                {activePanel === 'image' && (
                  <div className="space-y-5">
                    {/* 이미지 모델 + 영상 모델 — 좌우 반반 */}
                    <div className="flex gap-3">
                      {/* 왼쪽: 이미지 모델 */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">이미지 모델</p>
                        <div className="space-y-1.5">
                          {IMAGE_MODELS.map(m => (
                            <button key={m.id} type="button" onClick={() => selectImageModel(m.id)}
                              className={`w-full p-2.5 rounded-xl border text-left transition-all ${imageModelId === m.id ? 'bg-blue-600/20 border-blue-500 text-white' : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600'}`}>
                              <div className="flex justify-between items-center gap-1">
                                <span className="font-bold text-xs leading-tight">{m.name}</span>
                                <div className="text-right shrink-0">
                                  <div className="text-green-400 text-[10px] font-bold">${m.pricePerImage.toFixed(3)}/장</div>
                                  <div className="text-slate-500 text-[9px]">≈ {Math.round(m.pricePerImage * 1450)}원</div>
                                </div>
                              </div>
                              <div className="text-[10px] opacity-50 mt-0.5 leading-tight">{m.description}</div>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 오른쪽: 영상 모델 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">영상 모델</p>
                          <button type="button"
                            onClick={() => { const v = !videoEnabled; setVideoEnabled(v); localStorage.setItem('heaven_video_enabled', String(v)); }}
                            className={`relative w-9 h-5 rounded-full transition-colors overflow-hidden ${videoEnabled ? 'bg-orange-500' : 'bg-slate-600'}`}>
                            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${videoEnabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                          </button>
                        </div>
                        <div className={`space-y-1.5 transition-opacity ${videoEnabled ? 'opacity-100' : 'opacity-30 pointer-events-none'}`}>
                          {VIDEO_MODELS.map(m => (
                            <button key={m.id} type="button"
                              onClick={() => { setVideoModelId(m.id); localStorage.setItem('heaven_video_model', m.id); }}
                              className={`w-full p-2.5 rounded-xl border text-left transition-all ${videoModelId === m.id ? 'bg-orange-600/20 border-orange-500 text-white' : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600'}`}>
                              <div className="flex justify-between items-center gap-1">
                                <span className="font-bold text-xs leading-tight">{m.name}</span>
                                <div className="text-right shrink-0">
                                  <div className="text-orange-400 text-[10px] font-bold">{m.priceLabel}</div>
                                  <div className="text-slate-500 text-[9px]">{m.priceKRW}</div>
                                </div>
                              </div>
                              <div className="text-[10px] opacity-50 mt-0.5 leading-tight">{m.description}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* 이미지 글씨 */}
                    <div className="p-3 rounded-xl border border-blue-500/60 shadow-[0_0_14px_rgba(59,130,246,0.3)]">
                      <p className="text-sm font-bold text-slate-400 mb-2 uppercase tracking-wider">이미지 글씨</p>
                      <div className="grid grid-cols-5 gap-1.5">
                        {([{ id: 'none', label: '없음' }, { id: 'korean', label: '한글' }, { id: 'english', label: '영어' }, { id: 'numbers', label: '숫자' }, { id: 'auto', label: '자동' }] as const).map(({ id, label }) => (
                          <button key={id} type="button" onClick={() => selectImageTextMode(id)}
                            className={`py-2 rounded-xl text-sm font-bold transition-colors border ${imageTextMode === id ? 'bg-blue-600/20 text-blue-200 border-blue-500/60 shadow-[0_0_10px_rgba(59,130,246,0.4)]' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 border-blue-500/30'}`}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 참조 이미지 */}
                    <div>
                      <p className="text-sm font-bold text-slate-400 mb-2 uppercase tracking-wider">참조 이미지 (각 최대 5장)</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700">
                          <p className="text-sm font-bold text-slate-200 mb-2">캐릭터</p>
                          <div className="flex flex-wrap gap-2 items-center">
                            {characterRefImages.map((img, i) => (
                              <div key={i} className="relative group w-14 h-10 rounded overflow-hidden border border-violet-500/50">
                                <img src={img} alt="" className="w-full h-full object-cover" />
                                <button type="button" onClick={() => setCharacterRefImages(prev => prev.filter((_, idx) => idx !== i))}
                                  className="absolute inset-0 bg-red-500/70 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center text-xs font-bold">✕</button>
                              </div>
                            ))}
                            {characterRefImages.length < 5 && (
                              <button type="button" onClick={() => characterFileInputRef.current?.click()}
                                className="w-14 h-10 border-2 border-dashed border-slate-600 rounded flex items-center justify-center text-slate-500 hover:border-violet-500 hover:text-violet-400 text-xl">+</button>
                            )}
                            <input type="file" ref={characterFileInputRef} onChange={handleCharacterImageChange} accept="image/*" className="hidden" multiple />
                          </div>
                          {characterRefImages.length > 0 && (
                            <div className="mt-2">
                              <div className="flex justify-between text-xs mb-1"><span className="text-slate-400">강도</span><span className="text-violet-400">{characterStrength}%</span></div>
                              <input type="range" min={0} max={100} value={characterStrength} onChange={(e) => setCharacterStrength(+e.target.value)} className="w-full h-1.5 bg-slate-700 rounded appearance-none cursor-pointer accent-violet-500" />
                            </div>
                          )}
                        </div>
                        <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700">
                          <p className="text-sm font-bold text-slate-200 mb-2">화풍</p>
                          <div className="flex flex-wrap gap-2 items-center">
                            {styleRefImages.map((img, i) => (
                              <div key={i} className="relative group w-14 h-10 rounded overflow-hidden border border-fuchsia-500/50">
                                <img src={img} alt="" className="w-full h-full object-cover" />
                                <button type="button" onClick={() => setStyleRefImages(prev => prev.filter((_, idx) => idx !== i))}
                                  className="absolute inset-0 bg-red-500/70 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center text-xs font-bold">✕</button>
                              </div>
                            ))}
                            {styleRefImages.length < 5 && (
                              <button type="button" onClick={() => styleFileInputRef.current?.click()}
                                className="w-14 h-10 border-2 border-dashed border-slate-600 rounded flex items-center justify-center text-slate-500 hover:border-fuchsia-500 hover:text-fuchsia-400 text-xl">+</button>
                            )}
                            <input type="file" ref={styleFileInputRef} onChange={handleStyleImageChange} accept="image/*" className="hidden" multiple />
                          </div>
                          {styleRefImages.length > 0 && (
                            <div className="mt-2">
                              <div className="flex justify-between text-xs mb-1"><span className="text-slate-400">강도</span><span className="text-fuchsia-400">{styleStrength}%</span></div>
                              <input type="range" min={0} max={100} value={styleStrength} onChange={(e) => setStyleStrength(+e.target.value)} className="w-full h-1.5 bg-slate-700 rounded appearance-none cursor-pointer accent-fuchsia-500" />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 🎙️ 음성 설정 패널 */}
                {activePanel === 'voice' && (
                  <VoiceSettingsPanel refreshKey={voicePanelRefreshKey} />
                )}

                {/* 🎬 썸네일 생성 패널 */}
                {activePanel === 'thumbnail' && (
                  <div className="h-full -mx-4 -mb-4">
                    <ThumbnailEditor
                      scenes={thumbnailScenes || []}
                      topic={thumbnailTopic || ''}
                      selectedImage={thumbnailBaseImage}
                      onImageGenerated={undefined}
                    />
                  </div>
                )}

                {/* 💾 프로젝트 패널 */}
                {activePanel === 'project' && (
                  <div className="space-y-4">
                    <div className="flex gap-2">
                      <input type="text" value={newProjectName} onChange={e => setNewProjectName(e.target.value)} placeholder="프로젝트 이름..."
                        className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:border-amber-500 focus:outline-none"
                        onKeyDown={e => e.key === 'Enter' && saveProject()} />
                      <button type="button" onClick={saveProject} disabled={!newProjectName.trim()} className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-sm font-bold rounded-xl">저장</button>
                    </div>
                    {projects.map(p => (
                      <div key={p.id} className="flex items-center gap-2 p-3 bg-slate-800/50 rounded-xl border border-slate-700">
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-sm text-white truncate">{p.name}</div>
                          <div className="text-xs text-slate-500">{new Date(p.updatedAt).toLocaleDateString('ko-KR')}</div>
                        </div>
                        <button type="button" onClick={() => loadProject(p)} className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold">불러오기</button>
                        <button type="button" onClick={() => deleteProject(p.id)} className="px-3 py-1 text-sm bg-red-600/50 hover:bg-red-500 text-white rounded-lg font-bold">삭제</button>
                      </div>
                    ))}
                    {projects.length === 0 && <p className="text-sm text-slate-600 text-center py-4">저장된 프로젝트 없음</p>}
                  </div>
                )}

              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default InputSection;
