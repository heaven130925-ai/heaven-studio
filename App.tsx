
import React, { useState, useCallback, useRef, useEffect } from 'react';
import Header from './components/Header';
import InputSection from './components/InputSection';
import PasswordGate from './components/PasswordGate';
import ResultTable from './components/ResultTable';
import { GeneratedAsset, GenerationStep, ScriptScene, CostBreakdown, ReferenceImages, DEFAULT_REFERENCE_IMAGES, DEFAULT_SUBTITLE_CONFIG, SubtitleConfig } from './types';
import { generateScript, generateScriptChunked, findTrendingTopics, generateAudioForScene, generateMotionPrompt, editImageWithGemini, enrichImagePrompts, extractCharactersFromScript, CharacterInfo } from './services/geminiService';
import CharacterSetup from './components/CharacterSetup';
import { generateImage, getSelectedImageModel } from './services/imageService';
import { generateAudioWithElevenLabs } from './services/elevenLabsService';
import { generateVideo, VideoGenerationResult } from './services/videoService';
import { downloadSrtFromRecorded } from './services/srtService';
import { generateVideoFromImage, getFalApiKey } from './services/falService';
import { saveProject, updateProjectAssets, getSavedProjects, deleteProject, migrateFromLocalStorage, saveDraft, loadDraft, clearDraft } from './services/projectService';
import { SavedProject } from './types';
import { CONFIG, PRICING, formatKRW } from './config';
import ProjectGallery from './components/ProjectGallery';
import SubtitleEditor from './components/SubtitleEditor';
import ThumbnailEditor from './components/ThumbnailEditor';
import { downloadMergedAudio } from './utils/csvHelper';
import { getVoiceSetting } from './utils/voiceStorage';
import * as FileSaver from 'file-saver';

const saveAs = (FileSaver as any).saveAs || (FileSaver as any).default || FileSaver;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type ViewMode = 'main' | 'gallery';

const GIST_RAW_URL = 'https://gist.githubusercontent.com/heaven130925-ai/7094a8ac89c8438b922d5ad79da79a6b/raw';

const App: React.FC = () => {
  const savedPass = localStorage.getItem('heaven_access') || '';
  const isAdmin = localStorage.getItem('heaven_admin') === '1';
  const [isAuthenticated, setIsAuthenticated] = useState(isAdmin);
  const [allowedPasswords, setAllowedPasswords] = useState<string[]>([]);

  // Gist에서 비밀번호 목록 로드
  useEffect(() => {
    if (isAdmin) return;
    fetch(`${GIST_RAW_URL}?t=${Date.now()}`)
      .then(r => r.text())
      .then(text => {
        const passwords = text.split('\n').map(p => p.trim()).filter(Boolean);
        setAllowedPasswords(passwords);
        if (passwords.includes(savedPass)) setIsAuthenticated(true);
      })
      .catch(() => {
        // Gist 로드 실패 시 기본 비번 사용
        const fallback = ('heaven31')
          .split(',').map((p: string) => p.trim()).filter(Boolean);
        setAllowedPasswords(fallback);
        if (fallback.includes(savedPass)) setIsAuthenticated(true);
      });
  }, []); // eslint-disable-line

  const [step, setStep] = useState<GenerationStep>(GenerationStep.IDLE);
  const [generatedData, setGeneratedData] = useState<GeneratedAsset[]>([]);
  const [progressMessage, setProgressMessage] = useState('');
  const [inputActiveTab, setInputActiveTab] = useState<'auto' | 'manual'>('auto');
  const [inputManualScript, setInputManualScript] = useState<string>(
    () => sessionStorage.getItem('lastManualScript') || ''
  );
  const [isVideoGenerating, setIsVideoGenerating] = useState(false);
  const currentProjectIdRef = useRef<string | null>(null); // 현재 열린 프로젝트 ID (자동저장용)
  // 참조 이미지 상태 (강도 포함)
  const [currentReferenceImages, setCurrentReferenceImages] = useState<ReferenceImages>(DEFAULT_REFERENCE_IMAGES);
  const [needsKey, setNeedsKey] = useState(false);
  const [animatingIndices, setAnimatingIndices] = useState<Set<number>>(new Set());
  const [thumbnailBaseImage, setThumbnailBaseImage] = useState<string | null>(null);
  const [storyThumbnailImage, setStoryThumbnailImage] = useState<string | null>(null);
  const [draftProject, setDraftProject] = useState<import('./types').SavedProject | null>(null);
  const [thumbnailEditorKey, setThumbnailEditorKey] = useState(0);
  const [showApiModal, setShowApiModal] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>(
    (localStorage.getItem(CONFIG.STORAGE_KEYS.ASPECT_RATIO) as '16:9' | '9:16') || '16:9'
  );

  // 스토리보드 뷰 (생성 시 별도 화면으로 전환)
  const [showStoryboard, setShowStoryboard] = useState(false);
  const [storyboardTab, setStoryboardTab] = useState<'result' | 'subtitle' | 'thumbnail'>('result');

  // 자막 설정 (SubtitleEditor와 영상 렌더링 공유)
  const [subConfig, setSubConfig] = useState<SubtitleConfig>(() => {
    try {
      const saved = localStorage.getItem(CONFIG.STORAGE_KEYS.SUBTITLE_CONFIG);
      if (saved) return { ...DEFAULT_SUBTITLE_CONFIG, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_SUBTITLE_CONFIG;
  });
  const handleSubConfigChange = useCallback((cfg: SubtitleConfig) => {
    setSubConfig(cfg);
    try { localStorage.setItem(CONFIG.STORAGE_KEYS.SUBTITLE_CONFIG, JSON.stringify(cfg)); } catch {}
  }, []);

  // 갤러리 뷰 관련
  const [viewMode, setViewMode] = useState<ViewMode>('main');
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  const [currentTopic, setCurrentTopic] = useState<string>('');

  // 비용 추적
  const [currentCost, setCurrentCost] = useState<CostBreakdown | null>(null);

  const costRef = useRef<CostBreakdown>({
    images: 0, tts: 0, videos: 0, total: 0,
    imageCount: 0, ttsCharacters: 0, videoCount: 0
  });

  const usedTopicsRef = useRef<string[]>([]);
  const assetsRef = useRef<GeneratedAsset[]>([]);
  const pendingScriptScenesRef = useRef<ScriptScene[]>([]); // SCRIPT_READY 후 씬 보관용
  const isAbortedRef = useRef(false);
  const isProcessingRef = useRef(false);

  // 캐릭터 프로필 localStorage 저장/로드
  const CHAR_PROFILES_KEY = 'heaven_character_profiles';
  const loadSavedCharacterProfiles = (): CharacterInfo[] => {
    try {
      const saved = localStorage.getItem(CHAR_PROFILES_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  };
  const saveCharacterProfiles = (profiles: CharacterInfo[]) => {
    try { localStorage.setItem(CHAR_PROFILES_KEY, JSON.stringify(profiles)); } catch {}
  };

  const characterProfilesRef = useRef<CharacterInfo[]>(loadSavedCharacterProfiles());
  const [charactersList, setCharactersList] = useState<CharacterInfo[]>(loadSavedCharacterProfiles());
  const [showCharacterSetup, setShowCharacterSetup] = useState(false);
  const [inputResetKey, setInputResetKey] = useState(0);
  const [isAnalyzingCharacters, setIsAnalyzingCharacters] = useState(false);
  const pendingInitialAssetsRef = useRef<GeneratedAsset[]>([]);
  const pendingRefImgsRef = useRef<ReferenceImages>(DEFAULT_REFERENCE_IMAGES);
  const pendingTargetTopicRef = useRef<string>('');
  // 캐릭터 분석 버튼에서 온 경우: CharacterSetup 완료 후 실행할 생성 함수 저장
  const pendingCharAnalysisCallRef = useRef<(() => void) | null>(null);

  const checkApiKeyStatus = useCallback(async () => {
    if ((window as any).aistudio) {
      const hasKey = await (window as any).aistudio.hasSelectedApiKey();
      setNeedsKey(!hasKey);
      return hasKey;
    }
    return true;
  }, []);

  useEffect(() => {
    checkApiKeyStatus();
    // localStorage → IndexedDB 마이그레이션 및 프로젝트 로드
    (async () => {
      await migrateFromLocalStorage(); // 기존 데이터 이전
      const projects = await getSavedProjects();
      setSavedProjects(projects);
      // 임시저장(draft) 감지 → 복구 배너 표시
      const draft = await loadDraft();
      if (draft && draft.assets.length > 0) setDraftProject(draft);
    })();
    return () => { isAbortedRef.current = true; };
  }, [checkApiKeyStatus]);

  // 프로젝트 목록 새로고침
  const refreshProjects = useCallback(async () => {
    const projects = await getSavedProjects();
    setSavedProjects(projects);
  }, []);

  const handleOpenKeySelector = async () => {
    if ((window as any).aistudio) {
      await (window as any).aistudio.openSelectKey();
      setNeedsKey(false);
    } else {
      setShowApiModal(true);
    }
  };

  const audioOnlyRef = useRef(false);

  const updateAssetAt = (index: number, updates: Partial<GeneratedAsset>) => {
    if (isAbortedRef.current) return;
    if (assetsRef.current[index]) {
      assetsRef.current[index] = { ...assetsRef.current[index], ...updates };
      if (!audioOnlyRef.current) setGeneratedData([...assetsRef.current]);
    }
  };

  // 현재 프로젝트 자동저장 (이미지 편집 후 호출)
  const autoSaveProject = async () => {
    // 항상 임시저장 (뻑 대비)
    if (assetsRef.current.length > 0) {
      saveDraft(currentTopic || '', assetsRef.current).catch(() => {});
    }
    if (!currentProjectIdRef.current) return;
    try {
      await updateProjectAssets(currentProjectIdRef.current, assetsRef.current);
    } catch (e) {
      console.error('[AutoSave] 자동저장 실패:', e);
    }
  };

  // 비용 추가 헬퍼
  const addCost = (type: 'image' | 'tts' | 'video', amount: number, count: number = 1) => {
    if (type === 'image') {
      costRef.current.images += amount;
      costRef.current.imageCount += count;
    } else if (type === 'tts') {
      costRef.current.tts += amount;
      costRef.current.ttsCharacters += count;
    } else if (type === 'video') {
      costRef.current.videos += amount;
      costRef.current.videoCount += count;
    }
    costRef.current.total = costRef.current.images + costRef.current.tts + costRef.current.videos;
    setCurrentCost({ ...costRef.current });
  };

  // 비용 초기화
  const resetCost = () => {
    costRef.current = {
      images: 0, tts: 0, videos: 0, total: 0,
      imageCount: 0, ttsCharacters: 0, videoCount: 0
    };
    setCurrentCost(null);
  };

  // 캐릭터 설정 완료 → 에셋 생성 시작
  const handleCharactersDone = useCallback(async (updatedChars: CharacterInfo[]) => {
    // 이미지가 있는 캐릭터만 저장
    if (updatedChars.length > 0) {
      characterProfilesRef.current = updatedChars.filter(c => c.imageData);
      saveCharacterProfiles(characterProfilesRef.current);
    }
    setShowCharacterSetup(false);

    // ── 캐릭터 분석 버튼에서 온 경우: 저장된 생성 콜백 실행 ──
    if (pendingCharAnalysisCallRef.current) {
      const call = pendingCharAnalysisCallRef.current;
      pendingCharAnalysisCallRef.current = null;
      call();
      return;
    }

    setShowStoryboard(true);

    const initialAssets = pendingInitialAssetsRef.current;
    const refImgs = pendingRefImgsRef.current;
    const targetTopic = pendingTargetTopicRef.current;

    if (!initialAssets.length) return;

    isProcessingRef.current = true;
    isAbortedRef.current = false;
    assetsRef.current = initialAssets;
    setGeneratedData(initialAssets);
    setStep(GenerationStep.ASSETS);
    setProgressMessage('시각 에셋 및 오디오 합성 중...');

    try {
      // 씬별 캐릭터 레퍼런스 이미지 선택
      const getSceneRefImgs = (narration: string): ReferenceImages => {
        const profiles = characterProfilesRef.current;
        if (!profiles.length) return refImgs;
        const matched = profiles
          .filter((c: CharacterInfo) => c.imageData && narration.includes(c.name))
          .map((c: CharacterInfo) => c.imageData as string)
          .slice(0, 2);
        if (!matched.length) return refImgs;
        return { ...refImgs, character: matched };
      };

      const ttsProvider = getVoiceSetting(CONFIG.STORAGE_KEYS.TTS_PROVIDER) || 'elevenlabs';
      const sceneDelay = ttsProvider === 'google' ? 2000 : 300;
      const MAX_SCENE_RETRIES = ttsProvider === 'google' ? 3 : 1;

      const runAudio = async () => {
        if (ttsProvider === 'google' || ttsProvider === 'gcloud' || ttsProvider === 'azure') {
          const providerLabel = ttsProvider === 'gcloud' ? 'Cloud TTS' : ttsProvider === 'azure' ? 'Azure TTS' : 'Gemini TTS';
          for (let i = 0; i < initialAssets.length; i++) {
            if (isAbortedRef.current) return;
            setProgressMessage(`씬 ${i + 1}/${initialAssets.length} 음성 생성 중... (${providerLabel})`);
            let success = false;
            for (let attempt = 0; attempt < MAX_SCENE_RETRIES && !success; attempt++) {
              if (isAbortedRef.current) return;
              try {
                if (attempt > 0) await wait(5000 * attempt);
                const audioData = await generateAudioForScene(initialAssets[i].narration);
                if (!isAbortedRef.current) { updateAssetAt(i, { audioData: audioData ?? null }); success = true; }
              } catch (e: any) { console.error(`[TTS] 씬 ${i + 1} 실패:`, e.message); }
            }
            if (i < initialAssets.length - 1 && !isAbortedRef.current) await wait(sceneDelay);
          }
          return;
        }
        const TTS_DELAY = 1500; const MAX_TTS_RETRIES = 2;
        for (let i = 0; i < initialAssets.length; i++) {
          if (isAbortedRef.current) break;
          setProgressMessage(`씬 ${i + 1}/${initialAssets.length} 음성 생성 중...`);
          for (let attempt = 0; attempt <= MAX_TTS_RETRIES; attempt++) {
            if (isAbortedRef.current) break;
            try {
              if (attempt > 0) await wait(3000);
              const elResult = await generateAudioWithElevenLabs(assetsRef.current[i].narration);
              if (isAbortedRef.current) break;
              if (elResult.audioData) { updateAssetAt(i, { audioData: elResult.audioData, subtitleData: elResult.subtitleData }); break; }
            } catch (e: any) { console.error(`[TTS] 씬 ${i + 1} 실패:`, e.message); }
          }
          if (i < initialAssets.length - 1 && !isAbortedRef.current) await wait(TTS_DELAY);
        }
      };

      const runImages = async () => {
        const imageModel = getSelectedImageModel();
        const imagePrice = PRICING.IMAGE[imageModel as keyof typeof PRICING.IMAGE] || 0.01;
        const MAX_RETRIES = 2;
        for (let i = 0; i < initialAssets.length; i++) {
          if (isAbortedRef.current) break;
          updateAssetAt(i, { status: 'generating' });
          const sceneRefImgs = getSceneRefImgs(initialAssets[i].narration);
          let success = false;
          for (let attempt = 0; attempt <= MAX_RETRIES && !success; attempt++) {
            if (isAbortedRef.current) break;
            try {
              if (attempt > 0) await wait(2000);
              setProgressMessage(`씬 ${i + 1}/${initialAssets.length} 이미지 생성 중...`);
              const img = await generateImage(assetsRef.current[i], sceneRefImgs);
              if (isAbortedRef.current) break;
              if (img) { updateAssetAt(i, { imageData: img, status: 'completed' }); addCost('image', imagePrice, 1); success = true; }
            } catch (e: any) { console.error(`씬 ${i + 1} 이미지 실패:`, e.message); }
          }
          if (!assetsRef.current[i]?.imageData) updateAssetAt(i, { status: 'error' });
          if (i < initialAssets.length - 1 && !isAbortedRef.current) await wait(1500);
        }
      };

      await Promise.all([runAudio(), runImages()]);
      if (isAbortedRef.current) return;

      setStep(GenerationStep.COMPLETED);
      const cost = costRef.current;
      const costMsg = `이미지 ${cost.imageCount}장 ${formatKRW(cost.images)} + TTS ${cost.ttsCharacters}자 ${formatKRW(cost.tts)} = 총 ${formatKRW(cost.total)}`;
      setProgressMessage(`생성 완료! ${costMsg}`);
      try {
        const savedProject = await saveProject(targetTopic, assetsRef.current, undefined, costRef.current);
        currentProjectIdRef.current = savedProject.id;
        clearDraft();
        setDraftProject(null);
        refreshProjects();
        setProgressMessage(`"${savedProject.name}" 저장됨 | ${costMsg}`);
      } catch (e) { console.error('프로젝트 저장 실패:', e); }
    } catch (error: any) {
      if (!isAbortedRef.current) { setStep(GenerationStep.ERROR); setProgressMessage(`오류: ${error.message}`); }
    } finally {
      isProcessingRef.current = false;
    }
  }, []); // eslint-disable-line

  // 캐릭터 분석 버튼 → CharacterSetup 표시 후 생성 대기
  const handleCharacterAnalyze = useCallback((
    topic: string, refImages: ReferenceImages, sourceText: string, sceneCount: number
  ) => {
    pendingCharAnalysisCallRef.current = () => handleGenerate(topic, refImages, sourceText, sceneCount);
    const savedProfs = loadSavedCharacterProfiles();
    setCharactersList(savedProfs);
    setIsAnalyzingCharacters(true);
    // 캐릭터 추출 완료 후 CharacterSetup 표시
    extractCharactersFromScript(sourceText)
      .then(newChars => {
        setCharactersList((prev: CharacterInfo[]) => {
          const existingNames = new Set(prev.map((c: CharacterInfo) => c.name));
          const added = newChars.filter((c: CharacterInfo) => !existingNames.has(c.name));
          return added.length > 0 ? [...prev, ...added] : prev;
        });
      })
      .catch(() => {})
      .finally(() => {
        setIsAnalyzingCharacters(false);
        setShowCharacterSetup(true);
      });
  }, []); // eslint-disable-line

  // 미완성 씬 이어서 생성 (이미지 없는 씬만)
  const handleResume = useCallback(async () => {
    if (isProcessingRef.current) return;
    const incomplete = assetsRef.current.filter(a => !a.imageData);
    if (incomplete.length === 0) return;
    isAbortedRef.current = false;
    isProcessingRef.current = true;
    setStep(GenerationStep.ASSETS);
    setProgressMessage('이어서 생성 중...');
    for (let i = 0; i < assetsRef.current.length; i++) {
      if (isAbortedRef.current) break;
      if (assetsRef.current[i].imageData) continue;
      updateAssetAt(i, { status: 'generating' });
      setProgressMessage(`씬 ${i + 1}/${assetsRef.current.length} 이미지 생성 중...`);
      try {
        const img = await generateImage(assetsRef.current[i], currentReferenceImages);
        if (img && !isAbortedRef.current) updateAssetAt(i, { imageData: img, status: 'completed' });
      } catch (e: any) {
        console.error(`씬 ${i + 1} 이어서 생성 실패:`, e.message);
        updateAssetAt(i, { status: 'error' });
      }
      if (i < assetsRef.current.length - 1 && !isAbortedRef.current) await wait(1500);
    }
    isProcessingRef.current = false;
    if (!isAbortedRef.current) setStep(GenerationStep.COMPLETED);
    setProgressMessage('이어서 생성 완료!');
  }, [currentReferenceImages]);

  const handleAbort = () => {
    isAbortedRef.current = true;
    isProcessingRef.current = false;
    setProgressMessage("🛑 작업 중단됨.");
    setStep(GenerationStep.COMPLETED);
  };

  const handleReset = () => {
    if (!window.confirm('생성된 결과물을 모두 초기화하시겠습니까?')) return;
    isAbortedRef.current = true;
    isProcessingRef.current = false;
    assetsRef.current = [];
    pendingScriptScenesRef.current = [];
    setGeneratedData([]);
    setInputManualScript('');
    setInputActiveTab('auto');
    setShowStoryboard(false);
    setShowCharacterSetup(false);
    characterProfilesRef.current = [];
    setCharactersList([]);
    setStep(GenerationStep.IDLE);
    setProgressMessage('');
    resetCost();
    setInputResetKey(k => k + 1);
  };


  const handleGenerate = useCallback(async (
    topic: string,
    refImgs: ReferenceImages,
    sourceText: string | null,
    sceneCount: number = 0,
    imageOnly: boolean = false,
    audioOnly: boolean = false,
    autoRun: boolean = false
  ) => {
    console.log(`[handleGenerate] topic="${topic}", sourceText=${sourceText === null ? 'null' : `"${sourceText?.slice(0,20)}..."`}, imageOnly=${imageOnly}`);
    if (isProcessingRef.current) { console.log('[handleGenerate] blocked: isProcessing'); return; }
    isProcessingRef.current = true;
    isAbortedRef.current = false;
    audioOnlyRef.current = audioOnly;
    if (audioOnly) setShowStoryboard(false);

    // 자동 주제 모드 또는 오디오만 생성은 스토리보드 열지 않음
    const isAutoTopicMode = !sourceText && topic !== 'Manual Script Input' && !imageOnly && !audioOnly;
    if (!isAutoTopicMode && !audioOnly) setShowStoryboard(true);
    setStep(GenerationStep.SCRIPTING);
    setProgressMessage('V9.2 Ultra 엔진 부팅 중...');

    try {
      const hasKey = await checkApiKeyStatus();
      if (!hasKey && (window as any).aistudio) {
        await (window as any).aistudio.openSelectKey();
      }

      // audioOnly + 기존 씬 있으면 스크립트 생성 없이 오디오만 재생성
      const preexistingNarrations = audioOnly ? assetsRef.current.filter(a => a.narration?.trim()) : [];

      setGeneratedData([]);
      assetsRef.current = [];
      setCurrentReferenceImages(refImgs);
      setCurrentTopic(topic);
      resetCost();

      const hasRefImages = (refImgs.character?.length || 0) + (refImgs.style?.length || 0) > 0;
      const hasCharacterRef = (refImgs.character?.length || 0) > 0;
      console.log(`[App] 참조 이미지 - 캐릭터: ${refImgs.character?.length || 0}개, 스타일: ${refImgs.style?.length || 0}개`);

      let initialAssets: GeneratedAsset[];
      let targetTopic = topic;

      if (audioOnly && preexistingNarrations.length > 0) {
        // ── 케이스 1: 기존 씬 오디오 재생성 (AI 대본 생성 없이) ──
        setProgressMessage(`기존 ${preexistingNarrations.length}개 씬 오디오 재생성 중...`);
        initialAssets = preexistingNarrations.map(a => ({
          ...a, audioData: null, subtitleData: null, audioDuration: null
        }));
        assetsRef.current = initialAssets;
      } else if (audioOnly && sourceText) {
        // ── 케이스 2: 수동 대본 → AI 없이 문단별 씬 분리 후 오디오 생성 ──
        setProgressMessage('대본 파싱 중...');
        const lines = sourceText.split(/\n{2,}|\n(?=\d+[.)]\s)/).map(l => l.trim()).filter(l => l.length > 5);
        initialAssets = (lines.length > 0 ? lines : [sourceText]).map((line, i) => ({
          sceneNumber: i + 1,
          narration: line.replace(/^\d+[.)]\s*/, '').trim(),
          visualPrompt: '',
          imageData: null, audioData: null, audioDuration: null,
          subtitleData: null, videoData: null, videoDuration: null,
          status: 'pending' as const
        }));
        assetsRef.current = initialAssets;
      } else {
        // ── 스크립트 생성 (기존 로직) ──
        if (topic === "Manual Script Input" && sourceText) {
          setProgressMessage('대본 분석 및 시각화 설계 중...');
        } else if (sourceText) {
          setProgressMessage('외부 콘텐츠 분석 중...');
          targetTopic = "Custom Analysis Topic";
        } else {
          targetTopic = topic;
        }
        setProgressMessage(`대본 생성 중...`);

        const inputLength = sourceText?.length || 0;
        const CHUNK_THRESHOLD = 3000;

        let scriptScenes: ScriptScene[];
        if (inputLength > CHUNK_THRESHOLD) {
          console.log(`[App] 긴 대본 감지: ${inputLength.toLocaleString()}자 → 청크 분할 처리`);
          setProgressMessage(`긴 대본(${inputLength.toLocaleString()}자) 청크 분할 처리 중...`);
          scriptScenes = await generateScriptChunked(
            targetTopic, hasRefImages, sourceText!, 2500, setProgressMessage, sceneCount || undefined
          );
        } else {
          scriptScenes = await generateScript(targetTopic, hasRefImages, sourceText, sceneCount || undefined);
        }
        if (isAbortedRef.current) return;

        // ── 이미지 프롬프트 재작성 (전체 대본 맥락 기반) ──
        // 씬이 3개 이상일 때만 실행 (맥락 파악이 의미 있는 분량)
        if (scriptScenes.length >= 3) {
          setProgressMessage(`대본 분석 중... 이미지 프롬프트 최적화 (${scriptScenes.length}개 씬)`);
          try {
            scriptScenes = await enrichImagePrompts(scriptScenes, hasCharacterRef);
            console.log(`[App] 이미지 프롬프트 재작성 완료 (${scriptScenes.length}개 씬)`);
          } catch (e: any) {
            console.warn('[App] 이미지 프롬프트 재작성 실패 (기존 프롬프트 유지):', e.message);
          }
        }
        if (isAbortedRef.current) return;

        const isAutoTopic = !sourceText && topic !== 'Manual Script Input';
        console.log(`[handleGenerate] isAutoTopic=${isAutoTopic}, imageOnly=${imageOnly}, autoRun=${autoRun}, scenes=${scriptScenes.length}`);
        // autoRun=true이면 대본 확인 단계 없이 바로 이미지+오디오 생성
        if (isAutoTopic && !imageOnly && !audioOnly && !autoRun) {
          const scriptText = scriptScenes.map(s => s.narration).join('\n');
          setInputManualScript(scriptText);
          setInputActiveTab('manual');
          pendingScriptScenesRef.current = scriptScenes;
          setGeneratedData([]);
          assetsRef.current = [];
          setStep(GenerationStep.SCRIPT_READY);
          setProgressMessage(`✅ 대본 완성 (${scriptScenes.length}개 씬) — 아래 대본 확인 후 "스토리보드 생성"을 눌러주세요.`);
          isProcessingRef.current = false;
          return;
        }
        // autoRun: 대본을 manual 탭에도 채워놓기 (나중에 참고용)
        if (autoRun) {
          const scriptText = scriptScenes.map(s => s.narration).join('\n');
          setInputManualScript(scriptText);
          setShowStoryboard(true);
        }

        initialAssets = scriptScenes.map(scene => ({
          ...scene, imageData: null, audioData: null, audioDuration: null, subtitleData: null, videoData: null, videoDuration: null, status: 'pending' as const
        }));
        assetsRef.current = initialAssets;
        if (!audioOnly) setGeneratedData(initialAssets);

      }

      setStep(GenerationStep.ASSETS);

      const runAudio = async () => {
          const ttsProvider = getVoiceSetting(CONFIG.STORAGE_KEYS.TTS_PROVIDER) || 'elevenlabs';

          if (ttsProvider === 'google' || ttsProvider === 'gcloud' || ttsProvider === 'azure') {
            // ── Google TTS / Google Cloud TTS / Azure TTS: 씬별 개별 생성 ──
            const providerLabel = ttsProvider === 'gcloud' ? 'Cloud TTS' : ttsProvider === 'azure' ? 'Azure TTS' : 'Gemini TTS';
            // Gemini TTS는 쿼터 소진 방지를 위해 씬 간 딜레이 증가
            const sceneDelay = ttsProvider === 'google' ? 2000 : 300;
            const MAX_SCENE_RETRIES = ttsProvider === 'google' ? 3 : 1;

            for (let i = 0; i < initialAssets.length; i++) {
              if (isAbortedRef.current) return;
              setProgressMessage(`씬 ${i + 1}/${initialAssets.length} 음성 생성 중... (${providerLabel})`);

              let success = false;
              for (let attempt = 0; attempt < MAX_SCENE_RETRIES && !success; attempt++) {
                if (isAbortedRef.current) return;
                try {
                  if (attempt > 0) {
                    console.log(`[TTS] 씬 ${i + 1} 재시도 ${attempt}/${MAX_SCENE_RETRIES - 1}...`);
                    await wait(5000 * attempt); // 재시도마다 5초씩 추가 대기
                  }
                  const audioData = await generateAudioForScene(initialAssets[i].narration);
                  if (!isAbortedRef.current) {
                    updateAssetAt(i, { audioData: audioData ?? null });
                    console.log(`[TTS] 씬 ${i + 1} ${providerLabel} 완료`);
                    success = true;
                  }
                } catch (e: any) {
                  console.error(`[TTS] 씬 ${i + 1} ${providerLabel} 실패 (시도 ${attempt + 1}):`, e.message);
                  if (attempt === MAX_SCENE_RETRIES - 1) {
                    setProgressMessage(`⚠️ 씬 ${i + 1} ${providerLabel} 실패: ${e?.message || e}`);
                  }
                }
              }

              if (i < initialAssets.length - 1 && !isAbortedRef.current) {
                await wait(sceneDelay);
              }
            }
            return;
          }

          // ── ElevenLabs: 씬별 생성 ──
          const TTS_DELAY = 1500;
          const MAX_TTS_RETRIES = 2;

          for (let i = 0; i < initialAssets.length; i++) {
              if (isAbortedRef.current) break;

              setProgressMessage(`씬 ${i + 1}/${initialAssets.length} 음성 생성 중...`);
              let success = false;

              for (let attempt = 0; attempt <= MAX_TTS_RETRIES && !success; attempt++) {
                  if (isAbortedRef.current) break;
                  try {
                      if (attempt > 0) {
                          console.log(`[TTS] 씬 ${i + 1} 재시도 중... (${attempt}/${MAX_TTS_RETRIES})`);
                          await wait(3000);
                      }
                      const elResult = await generateAudioWithElevenLabs(assetsRef.current[i].narration);
                      if (isAbortedRef.current) break;
                      if (elResult.audioData) {
                          updateAssetAt(i, {
                            audioData: elResult.audioData,
                            subtitleData: elResult.subtitleData,
                            audioDuration: elResult.estimatedDuration
                          });
                          const charCount = assetsRef.current[i].narration.length;
                          addCost('tts', charCount * PRICING.TTS.perCharacter, charCount);
                          success = true;
                          console.log(`[TTS] 씬 ${i + 1} ElevenLabs 완료`);
                      } else {
                          throw new Error('ElevenLabs 응답 없음');
                      }
                  } catch (e: any) {
                      console.error(`[TTS] 씬 ${i + 1} 실패 (시도 ${attempt + 1}):`, e.message);
                      if (e.message?.includes('429') || e.message?.includes('rate')) {
                          await wait(5000);
                      }
                  }
              }

              // ElevenLabs 실패 시 Gemini TTS 폴백
              if (!success && !isAbortedRef.current) {
                  try {
                      console.log(`[TTS] 씬 ${i + 1} Gemini TTS 폴백 시도...`);
                      const fallbackAudio = await generateAudioForScene(assetsRef.current[i].narration);
                      updateAssetAt(i, { audioData: fallbackAudio });
                      success = true;
                  } catch (fallbackError: any) {
                      const msg = fallbackError?.message || String(fallbackError);
                      const isQuota = msg.includes('일일 한도') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429');
                      console.error(`[TTS] 씬 ${i + 1} Gemini TTS 폴백 실패:`, msg);
                      setProgressMessage(`⚠️ TTS 실패: ${msg}`);
                      if (isQuota) break; // 쿼터 초과 시 나머지 씬도 같은 결과 → 즉시 중단
                  }
              }

              if (i < initialAssets.length - 1 && !isAbortedRef.current) {
                  await wait(TTS_DELAY);
              }
          }
      };

      const runImages = async () => {
          const MAX_RETRIES = 2; // 최대 재시도 횟수
          const imageModel = getSelectedImageModel();
          const imagePrice = PRICING.IMAGE[imageModel as keyof typeof PRICING.IMAGE] || 0.01;

          // ── Veo 영상 생성 모드 ──────────────────────────────────────────────
          if (imageModel.startsWith('veo-')) {
            const { generateVeoVideo } = await import('./services/veoService');
            for (let i = 0; i < initialAssets.length; i++) {
              if (isAbortedRef.current) break;
              updateAssetAt(i, { status: 'generating' });
              try {
                setProgressMessage(`씬 ${i + 1}/${initialAssets.length} Veo 영상 생성 중 (2~5분 소요)...`);
                const videoUrl = await generateVeoVideo(
                  initialAssets[i].visualPrompt,
                  imageModel,
                  aspectRatio,
                  8,
                  (msg) => setProgressMessage(`씬 ${i + 1}/${initialAssets.length} — ${msg}`)
                );
                if (videoUrl && !isAbortedRef.current) {
                  updateAssetAt(i, { videoData: videoUrl, videoDuration: 8, status: 'completed' });
                }
              } catch (e: any) {
                console.error(`씬 ${i + 1} Veo 실패:`, e.message);
                setProgressMessage(`⚠️ 씬 ${i + 1} Veo 실패: ${e.message}`);
                updateAssetAt(i, { status: 'error' });
              }
            }
            return;
          }

          for (let i = 0; i < initialAssets.length; i++) {
              if (isAbortedRef.current) break;
              if (assetsRef.current[i]?.imageData) continue;
              updateAssetAt(i, { status: 'generating' });

              let success = false;
              let lastError: any = null;

              // 재시도 로직 (최초 시도 + 재시도)
              for (let attempt = 0; attempt <= MAX_RETRIES && !success; attempt++) {
                  if (isAbortedRef.current) break;

                  try {
                      if (attempt > 0) {
                          setProgressMessage(`씬 ${i + 1} 이미지 재생성 시도 중... (${attempt}/${MAX_RETRIES})`);
                          await wait(2000); // 재시도 전 대기
                      }

                      // 씬별 캐릭터 레퍼런스 주입 (저장된 캐릭터 프로필 활용)
                      const profiles = characterProfilesRef.current;
                      const narration = assetsRef.current[i].narration;
                      const matchedChars = profiles
                        .filter((c: CharacterInfo) => c.imageData && narration.includes(c.name))
                        .map((c: CharacterInfo) => c.imageData as string)
                        .slice(0, 2);
                      const sceneRefImgs = matchedChars.length > 0
                        ? { ...refImgs, character: matchedChars }
                        : refImgs;
                      const img = await generateImage(assetsRef.current[i], sceneRefImgs);
                      if (isAbortedRef.current) break;

                      if (img) {
                          updateAssetAt(i, { imageData: img, status: 'completed' });
                          // 이미지 비용 추가
                          addCost('image', imagePrice, 1);
                          success = true;
                      } else {
                          throw new Error('이미지 데이터가 비어있습니다');
                      }
                  } catch (e: any) { 
                      lastError = e;
                      console.error(`씬 ${i + 1} 이미지 생성 실패 (시도 ${attempt + 1}/${MAX_RETRIES + 1}):`, e.message);
                      
                      // API 키 오류는 재시도하지 않음
                      if (e.message?.includes("API key not valid") || e.status === 400) {
                          setNeedsKey(true);
                          break;
                      }
                  }
              }
              
              // 모든 시도 실패 시 에러 상태로 설정
              if (!success && !isAbortedRef.current) {
                  updateAssetAt(i, { status: 'error' });
                  console.error(`씬 ${i + 1} 이미지 생성 최종 실패:`, lastError?.message);
              }
              
              await wait(50);
          }
      };

      // 앞 N개 씬을 애니메이션으로 변환하는 함수
      const runAnimations = async () => {
        const falApiKey = getFalApiKey();
        if (!falApiKey) {
          console.log('[Animation] FAL API 키 없음, 애니메이션 변환 건너뜀');
          return;
        }

        const animationCount = Math.min(CONFIG.ANIMATION.ENABLED_SCENES, initialAssets.length);
        setProgressMessage(`앞 ${animationCount}개 씬 애니메이션 변환 중...`);

        for (let i = 0; i < animationCount; i++) {
          if (isAbortedRef.current) break;

          // 이미지가 있어야 변환 가능
          if (!assetsRef.current[i]?.imageData) {
            console.log(`[Animation] 씬 ${i + 1} 이미지 없음, 건너뜀`);
            continue;
          }

          try {
            setProgressMessage(`씬 ${i + 1}/${animationCount} 애니메이션 생성 중...`);

            // 시각적 프롬프트에서 움직임 힌트 추출
            const motionPrompt = `Gentle subtle motion: ${assetsRef.current[i].visualPrompt.slice(0, 200)}`;

            const videoUrl = await generateVideoFromImage(
              assetsRef.current[i].imageData!,
              motionPrompt,
              falApiKey
            );

            if (videoUrl && !isAbortedRef.current) {
              updateAssetAt(i, {
                videoData: videoUrl,
                videoDuration: CONFIG.ANIMATION.VIDEO_DURATION
              });
              console.log(`[Animation] 씬 ${i + 1} 영상 변환 완료`);
            }
          } catch (e: any) {
            console.error(`[Animation] 씬 ${i + 1} 변환 실패:`, e.message);
          }

          // API rate limit 방지
          if (i < animationCount - 1) {
            await wait(1500);
          }
        }
      };

      const noAudio = (getVoiceSetting(CONFIG.STORAGE_KEYS.TTS_PROVIDER) || 'elevenlabs') === 'none';
      setProgressMessage(imageOnly ? '이미지 생성 중...' : audioOnly ? '오디오 생성 중...' : noAudio ? '이미지 생성 중...' : '시각 에셋 및 오디오 합성 중...');
      if (imageOnly || noAudio) await runImages();
      else if (audioOnly) await runAudio();
      else await Promise.all([runAudio(), runImages()]);

      if (isAbortedRef.current) return;

      // 오디오만 생성: ZIP 다운로드 후 종료 (스토리보드 미표시)
      if (audioOnly) {
        audioOnlyRef.current = false;
        setProgressMessage('오디오 통합 WAV 생성 중...');
        await downloadMergedAudio(assetsRef.current);
        setProgressMessage('오디오 다운로드 완료!');
        assetsRef.current = [];
        setGeneratedData([]);
        setStep(GenerationStep.IDLE);
        return;
      }

      setStep(GenerationStep.COMPLETED);

      // 비용 요약 메시지 (원화)
      const cost = costRef.current;
      const costMsg = `이미지 ${cost.imageCount}장 ${formatKRW(cost.images)} + TTS ${cost.ttsCharacters}자 ${formatKRW(cost.tts)} = 총 ${formatKRW(cost.total)}`;
      setProgressMessage(`생성 완료! ${costMsg}`);

      // 자동 저장 (비용 정보 포함)
      try {
        const savedProject = await saveProject(targetTopic, assetsRef.current, undefined, costRef.current);
        currentProjectIdRef.current = savedProject.id;
        clearDraft();
        setDraftProject(null);
        refreshProjects();
        setProgressMessage(`"${savedProject.name}" 저장됨 | ${costMsg}`);
      } catch (e) {
        console.error('프로젝트 자동 저장 실패:', e);
      }

    } catch (error: any) {
      if (!isAbortedRef.current) {
        setStep(GenerationStep.ERROR);
        setProgressMessage(`오류: ${error.message}`);
      }
    } finally {
      audioOnlyRef.current = false;
      isProcessingRef.current = false;
    }
  }, [checkApiKeyStatus, refreshProjects]);

  // 이미지 재생성 핸들러 (useCallback으로 메모이제이션)
  const handleRegenerateImage = useCallback(async (idx: number) => {
    if (isProcessingRef.current) return;
    isAbortedRef.current = false; // 개별 재생성은 abort 상태 리셋

    const MAX_RETRIES = 2;
    updateAssetAt(idx, { status: 'generating' });
    setProgressMessage(`씬 ${idx + 1} 이미지 재생성 중...`);

    let success = false;

    for (let attempt = 0; attempt <= MAX_RETRIES && !success; attempt++) {
      if (isAbortedRef.current) break;

      try {
        if (attempt > 0) {
          setProgressMessage(`씬 ${idx + 1} 이미지 재생성 재시도 중... (${attempt}/${MAX_RETRIES})`);
          await wait(2000);
        }

        const img = await generateImage(assetsRef.current[idx], currentReferenceImages);

        if (img && !isAbortedRef.current) {
          updateAssetAt(idx, { imageData: img, status: 'completed' });
          // 이미지 비용 추가
          const imageModel = getSelectedImageModel();
          const imagePrice = PRICING.IMAGE[imageModel as keyof typeof PRICING.IMAGE] || 0.01;
          addCost('image', imagePrice, 1);
          setProgressMessage(`씬 ${idx + 1} 이미지 재생성 완료! (+${formatKRW(imagePrice)})`);
          success = true;
          autoSaveProject();
        } else if (!img) {
          throw new Error('이미지 데이터가 비어있습니다');
        }
      } catch (e: any) {
        console.error(`씬 ${idx + 1} 재생성 실패 (시도 ${attempt + 1}/${MAX_RETRIES + 1}):`, e.message);

        if (e.message?.includes("API key not valid") || e.status === 400) {
          setNeedsKey(true);
          break;
        }
      }
    }

    if (!success && !isAbortedRef.current) {
      updateAssetAt(idx, { status: 'error' });
      setProgressMessage(`씬 ${idx + 1} 이미지 생성 실패. 다시 시도해주세요.`);
    }
  }, [currentReferenceImages]);

  // 씬 음성 개별 생성 핸들러 (SubtitleEditor에서 호출) — ElevenLabs 우선, 실패 시 Gemini TTS
  const handleGenerateSceneAudio = useCallback(async (idx: number): Promise<string | null> => {
    const scene = assetsRef.current[idx];
    if (!scene?.narration?.trim()) return null;

    // 1) ElevenLabs 시도
    try {
      const elResult = await generateAudioWithElevenLabs(scene.narration);
      if (elResult.audioData && assetsRef.current[idx]) {
        assetsRef.current[idx] = {
          ...assetsRef.current[idx],
          audioData: elResult.audioData,
          subtitleData: elResult.subtitleData,
          audioDuration: elResult.estimatedDuration,
        };
        setGeneratedData([...assetsRef.current]);
        return elResult.audioData;
      }
    } catch (e: any) {
      console.warn(`[TTS] ElevenLabs 실패, Gemini TTS로 폴백:`, e.message);
    }

    // 2) Gemini TTS 폴백 — 에러는 SubtitleEditor에서 표시하기 위해 throw
    const audioData = await generateAudioForScene(scene.narration);
    if (audioData && assetsRef.current[idx]) {
      assetsRef.current[idx] = { ...assetsRef.current[idx], audioData, audioDuration: null };
      setGeneratedData([...assetsRef.current]);
    }
    return audioData;
  }, []); // eslint-disable-line

  // 씬별 줌 오버라이드 핸들러
  const handleSceneZoomChange = useCallback((idx: number, zoom: import('./types').ZoomEffect | null) => {
    const updated = [...assetsRef.current];
    if (!updated[idx]) return;
    updated[idx] = { ...updated[idx], zoomEffect: zoom };
    assetsRef.current = updated;
    setGeneratedData([...updated]);
  }, []);

  // 씬 삭제 핸들러
  const handleDeleteScene = useCallback((idx: number) => {
    const updated = assetsRef.current.filter((_, i) => i !== idx)
      .map((s, i) => ({ ...s, sceneNumber: i + 1 }));
    assetsRef.current = updated;
    setGeneratedData([...updated]);
    autoSaveProject();
  }, []); // eslint-disable-line

  // 프롬프트 수정 후 재생성 핸들러
  const handleRegenerateWithPrompt = useCallback(async (idx: number, customPrompt: string) => {
    if (assetsRef.current[idx]) {
      assetsRef.current[idx] = { ...assetsRef.current[idx], visualPrompt: customPrompt };
      setGeneratedData([...assetsRef.current]);
    }
    await handleRegenerateImage(idx);
  }, [handleRegenerateImage]);

  // 애니메이션 생성 핸들러 (useCallback으로 메모이제이션)
  const handleGenerateAnimation = useCallback(async (idx: number, userMotionPrompt?: string) => {
    const falKey = getFalApiKey();
    if (!falKey) {
      alert('FAL API 키를 먼저 등록해주세요.\n설정 패널에서 "FAL.ai 애니메이션 엔진"을 열어 키를 입력하세요.');
      return;
    }
    if (animatingIndices.has(idx)) return; // 이 씬은 이미 변환 중
    if (!assetsRef.current[idx]?.imageData) {
      alert('이미지가 먼저 생성되어야 합니다.');
      return;
    }

    try {
      // Set에 현재 인덱스 추가
      setAnimatingIndices(prev => new Set(prev).add(idx));
      setProgressMessage(`씬 ${idx + 1} 움직임 분석 중...`);

      // 사용자 입력 프롬프트가 있으면 바로 사용, 없으면 AI 자동 생성
      const motionPrompt = userMotionPrompt || await generateMotionPrompt(
        assetsRef.current[idx].narration,
        assetsRef.current[idx].visualPrompt
      );

      setProgressMessage(`씬 ${idx + 1} 영상 변환 중...`);
      const videoUrl = await generateVideoFromImage(
        assetsRef.current[idx].imageData!,
        motionPrompt,
        falKey
      );

      if (videoUrl) {
        updateAssetAt(idx, {
          videoData: videoUrl,
          videoDuration: CONFIG.ANIMATION.VIDEO_DURATION
        });
        // 영상 비용 추가
        addCost('video', PRICING.VIDEO.perVideo, 1);
        setProgressMessage(`씬 ${idx + 1} 영상 변환 완료! (+${formatKRW(PRICING.VIDEO.perVideo)})`);
      } else {
        setProgressMessage(`씬 ${idx + 1} 영상 변환 실패`);
      }
    } catch (e: any) {
      console.error('영상 변환 실패:', e);
      setProgressMessage(`씬 ${idx + 1} 오류: ${e.message}`);
    } finally {
      // Set에서 현재 인덱스 제거
      setAnimatingIndices(prev => {
        const next = new Set(prev);
        next.delete(idx);
        return next;
      });
    }
  }, [animatingIndices]);


  const handleSelectThumbnail = useCallback((imageBase64: string) => {
    // SubtitleEditor / ResultTable에서 씬 이미지 선택 → 스토리보드 썸네일 탭에만 전달 (메인 썸네일과 연동 해제)
    setStoryThumbnailImage(null);
    requestAnimationFrame(() => {
      setStoryThumbnailImage(imageBase64);
      setShowStoryboard(true);
      setThumbnailEditorKey(k => k + 1);
      setStoryboardTab('thumbnail');
    });
  }, []);

  const triggerVideoExport = async (enableSubtitles: boolean = true) => {
    if (isVideoGenerating) return;
    try {
      setIsVideoGenerating(true);
      const suffix = enableSubtitles ? 'sub' : 'nosub';
      const timestamp = Date.now();

      // subConfig 상태 사용 (SubtitleEditor에서 수정된 값)
      const subtitleConfig: Partial<SubtitleConfig> = subConfig;

      const result = await generateVideo(
        assetsRef.current,
        (msg) => setProgressMessage(`[Render] ${msg}`),
        isAbortedRef,
        { enableSubtitles, subtitleConfig }
      );

      if (result) {
        // 영상 저장 (자막은 영상에 하드코딩됨)
        saveAs(result.videoBlob, `heaven_ai_${suffix}_${timestamp}.mp4`);
        setProgressMessage(`✨ MP4 렌더링 완료! (${enableSubtitles ? '자막 O' : '자막 X'})`);
      }
    } catch (error: any) {
      setProgressMessage(`렌더링 실패: ${error.message}`);
    } finally {
      setIsVideoGenerating(false);
    }
  };

  // 프로젝트 삭제 핸들러
  const handleDeleteProject = async (id: string) => {
    await deleteProject(id);
    await refreshProjects();
  };



  // 프로젝트 불러오기 핸들러
  const handleLoadProject = (project: SavedProject) => {
    currentProjectIdRef.current = project.id; // 불러온 프로젝트 ID 추적
    // 저장된 에셋을 현재 상태로 로드
    assetsRef.current = project.assets;
    setGeneratedData([...project.assets]);
    setCurrentTopic(project.topic);
    setStep(GenerationStep.COMPLETED);
    setProgressMessage(`"${project.name}" 프로젝트 불러옴`);
    setViewMode('main');
    setShowStoryboard(true); // 바로 스토리보드로 이동
    // 프로젝트의 aspect ratio 복원 (없으면 16:9 기본값)
    const savedRatio = ((project.settings as any)?.aspectRatio as '16:9' | '9:16') || '16:9';
    setAspectRatio(savedRatio);
    localStorage.setItem(CONFIG.STORAGE_KEYS.ASPECT_RATIO, savedRatio);
  };

  // Gemini API 키 미설정 시 셋업 화면
  const hasGeminiKey = !!(localStorage.getItem('heaven_gemini_key') || process.env.GEMINI_API_KEY);
  if (!hasGeminiKey) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl p-8 space-y-6">
          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-red-600 to-rose-600 flex items-center justify-center shadow-lg shadow-red-900/30">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
            </div>
            <h1 className="text-2xl font-black text-white">Heaven Studio</h1>
            <p className="text-slate-400 text-sm mt-2">시작하기 전에 Gemini API 키를 입력하세요</p>
          </div>
          <div className="space-y-3">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Gemini API 키 <span className="text-red-400">*필수</span></label>
            <input
              id="setup-gemini-key"
              type="password"
              placeholder="AIza..."
              defaultValue=""
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:border-brand-500 focus:outline-none"
            />
            <p className="text-[11px] text-slate-500">
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-brand-400 hover:underline">Google AI Studio</a>에서 무료 발급 가능합니다.
            </p>
          </div>
          <button
            className="w-full py-3 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-black rounded-xl transition-all shadow-lg shadow-red-900/30"
            onClick={() => {
              const input = (document.getElementById('setup-gemini-key') as HTMLInputElement).value.trim();
              if (!input) { alert('API 키를 입력해주세요.'); return; }
              localStorage.setItem('heaven_gemini_key', input);
              window.location.reload();
            }}
          >
            시작하기
          </button>
          <p className="text-center text-[10px] text-slate-600">키는 이 브라우저에만 저장되며 서버로 전송되지 않습니다</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <PasswordGate allowedPasswords={allowedPasswords} onSuccess={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white overflow-x-hidden">
      <Header />

      {/* 네비게이션 탭 */}
      <div className="border-b border-white/[0.07] bg-black/60 backdrop-blur-sm">
        <div className="px-6 flex items-center gap-2 py-2" style={{ maxWidth: '1600px', margin: '0 auto' }}>
          <button
            onClick={() => setViewMode('main')}
            className={`px-5 py-2.5 text-base font-black rounded-xl transition-all border ${
              viewMode === 'main'
                ? 'text-blue-200 bg-blue-600/20 border-blue-400/70 shadow-[0_0_18px_rgba(59,130,246,0.45)]'
                : 'text-white/60 bg-white/[0.04] border-white/[0.08] hover:text-white hover:border-blue-500/40 hover:bg-blue-600/10'
            }`}
          >
            스토리보드 생성
          </button>
          <button
            onClick={() => setViewMode('gallery')}
            className={`px-5 py-2.5 text-base font-black rounded-xl transition-all border flex items-center gap-2 ${
              viewMode === 'gallery'
                ? 'text-blue-200 bg-blue-600/20 border-blue-400/70 shadow-[0_0_18px_rgba(59,130,246,0.45)]'
                : 'text-white/60 bg-white/[0.04] border-white/[0.08] hover:text-white hover:border-blue-500/40 hover:bg-blue-600/10'
            }`}
          >
            저장된 프로젝트
            {savedProjects.length > 0 && (
              <span className="px-1.5 py-0.5 bg-blue-500/20 border border-blue-500/30 text-xs rounded-full text-blue-300 font-bold">
                {savedProjects.length}
              </span>
            )}
          </button>
          <button
            onClick={() => { setStoryboardTab('subtitle'); setShowStoryboard(true); }}
            className="px-5 py-2.5 text-base font-black rounded-xl transition-all border text-white/60 bg-white/[0.04] border-white/[0.08] hover:text-white hover:border-purple-500/40 hover:bg-purple-600/10 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h6m-6 4h10M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z"/></svg>
            자막 편집
          </button>
          <div className="ml-auto">
            <button onClick={handleOpenKeySelector} className="px-4 py-2 text-xs font-semibold text-white/50 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] rounded-lg transition-all border border-white/[0.08] flex items-center gap-2">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
              API 키
            </button>
          </div>
        </div>
      </div>

      {needsKey && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 py-2 px-4 flex items-center justify-center gap-4 animate-in fade-in slide-in-from-top-4">
          <span className="text-amber-400 text-xs font-bold">Gemini 3 Pro 엔진을 위해 API 키 설정이 필요합니다.</span>
          <button onClick={handleOpenKeySelector} className="px-3 py-1 bg-amber-500 text-slate-950 text-[10px] font-black rounded-lg hover:bg-amber-400 transition-colors uppercase">API 키 설정</button>
        </div>
      )}

      {/* 갤러리 뷰 */}
      {viewMode === 'gallery' && (
        <ProjectGallery
          projects={savedProjects}
          onBack={() => setViewMode('main')}
          onDelete={handleDeleteProject}
          onRefresh={refreshProjects}
          onLoad={handleLoadProject}
        />
      )}

      {/* 메인 뷰 */}
      {viewMode === 'main' && (
      <main className="py-2 overflow-x-hidden">
        {/* 대본 완성 배너 */}
        {step === GenerationStep.SCRIPT_READY && (
          <div className="max-w-7xl mx-auto px-4 mb-3">
            <div className="w-full flex items-center justify-between px-5 py-4 rounded-xl bg-green-500/10 border border-green-500/50 shadow-[0_0_20px_rgba(34,197,94,0.2)]">
              <div className="flex items-center gap-3">
                <span className="text-xl">✅</span>
                <span className="text-sm font-bold text-green-300">{progressMessage}</span>
              </div>
              <button onClick={handleReset} className="px-3 py-1 rounded-lg bg-red-600/20 text-red-400 text-xs font-black border border-red-500/30 hover:bg-red-600/30 transition-colors">리셋</button>
            </div>
          </div>
        )}

        {/* 백그라운드 생성 중 진행 배너 */}
        {!showStoryboard && (step === GenerationStep.ASSETS || step === GenerationStep.SCRIPTING || isVideoGenerating) && (
          <div className="max-w-7xl mx-auto px-4 mb-3">
            <div className="w-full flex items-center justify-between px-5 py-3 rounded-xl bg-yellow-500/10 border border-yellow-500/40">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-4 h-4 border-2 border-yellow-400 border-t-transparent animate-spin rounded-full shrink-0" />
                <span className="text-sm font-bold text-yellow-300 truncate">{progressMessage || '생성 중...'}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                <button onClick={() => setShowStoryboard(true)} className="px-3 py-1 rounded-lg bg-yellow-500/20 text-yellow-300 text-xs font-bold border border-yellow-500/40 hover:bg-yellow-500/30 transition-colors">보기</button>
                {!isVideoGenerating && <button onClick={handleAbort} className="px-3 py-1 rounded-lg bg-red-600/20 text-red-400 text-xs font-bold border border-red-500/30 hover:bg-red-600/30 transition-colors">중단</button>}
              </div>
            </div>
          </div>
        )}

        {/* 임시저장 복구 배너 */}
        {draftProject && generatedData.length === 0 && (
          <div className="max-w-7xl mx-auto px-4 mb-4">
            <div className="flex items-center justify-between px-5 py-3 rounded-xl bg-orange-600/20 border border-orange-500/40">
              <div className="flex items-center gap-3">
                <span className="text-orange-400 text-lg">⚠️</span>
                <span className="text-sm font-bold text-orange-300">
                  저장되지 않은 작업이 있습니다 — {draftProject.name} ({draftProject.assets.length}개 씬)
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    assetsRef.current = draftProject.assets;
                    setGeneratedData([...draftProject.assets]);
                    setCurrentTopic(draftProject.topic);
                    setStep(GenerationStep.COMPLETED);
                    setShowStoryboard(true);
                    setDraftProject(null);
                  }}
                  className="px-3 py-1 rounded-lg bg-orange-500/30 hover:bg-orange-500/50 text-orange-200 text-xs font-bold border border-orange-500/40 transition-colors"
                >복구하기</button>
                <button
                  onClick={() => { clearDraft(); setDraftProject(null); }}
                  className="px-3 py-1 rounded-lg bg-slate-700/50 text-slate-400 text-xs font-bold border border-slate-600/50 hover:bg-red-600/20 hover:text-red-400 transition-colors"
                >무시</button>
              </div>
            </div>
          </div>
        )}

        {/* 스토리보드로 돌아가기 배너 */}
        {generatedData.length > 0 && !showStoryboard && step === GenerationStep.COMPLETED && !isVideoGenerating && (
          <div className="max-w-7xl mx-auto px-4 mb-6">
            <button
              onClick={() => setShowStoryboard(true)}
              className="w-full flex items-center justify-between px-5 py-3 rounded-xl bg-brand-600/20 border border-brand-500/40 hover:bg-brand-600/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="w-2 h-2 rounded-full bg-brand-400 animate-pulse" />
                <span className="text-sm font-bold text-brand-300">이전에 생성된 스토리보드가 있습니다 ({generatedData.length}개 씬)</span>
              </div>
              <span className="text-sm font-black text-brand-400">스토리보드 보기 →</span>
            </button>
          </div>
        )}
        <InputSection
          onGenerate={handleGenerate}
          onCharacterAnalyze={handleCharacterAnalyze}
          isAnalyzingCharacters={isAnalyzingCharacters}
          step={step}
          activeTab={inputActiveTab}
          onTabChange={setInputActiveTab}
          manualScript={inputManualScript}
          onManualScriptChange={(v) => { setInputManualScript(v); sessionStorage.setItem('lastManualScript', v); }}
          thumbnailBaseImage={thumbnailBaseImage}
          onThumbnailBaseImageChange={setThumbnailBaseImage}
          onAspectRatioChange={setAspectRatio}
          thumbnailScenes={[]}
          thumbnailTopic={currentTopic}
          onOpenGallery={() => setViewMode('gallery')}
          resetKey={inputResetKey}
        />

        
      </main>
      )}

      {/* 캐릭터 설정 화면 */}
      {showCharacterSetup && (
        <CharacterSetup
          characters={charactersList}
          onDone={handleCharactersDone}
          onSkip={() => {
            setShowCharacterSetup(false);
            // 캐릭터 분석 버튼 경로: 기존 프로필 유지하며 생성 시작
            if (pendingCharAnalysisCallRef.current) {
              const call = pendingCharAnalysisCallRef.current;
              pendingCharAnalysisCallRef.current = null;
              call();
            }
          }}
          onCancel={() => {
            // 순수 취소: 생성 시작하지 않고 메인으로 돌아감
            setShowCharacterSetup(false);
            pendingCharAnalysisCallRef.current = null;
          }}
        />
      )}

      {/* 스토리보드 생성 화면 (새 창) */}
      {showStoryboard && (
        <div className="fixed inset-0 z-[60] bg-slate-950 flex flex-col overflow-hidden">
          {/* 헤더 */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700/50 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 shrink-0">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowStoryboard(false)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-600 hover:border-red-500/50 bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white text-sm font-semibold transition-all"
              >
                ← 메인으로
              </button>
              {/* 탭 */}
              <div className="flex bg-slate-900 rounded-xl p-0.5 border border-slate-700/50">
                <button onClick={() => setStoryboardTab('result')}
                  className={`px-5 py-1.5 rounded-lg text-sm font-semibold transition-all ${storyboardTab === 'result' ? 'bg-blue-600/20 border border-blue-500/50 text-blue-200 shadow-[0_0_10px_rgba(59,130,246,0.3)]' : 'text-slate-400 hover:text-slate-200 border border-transparent'}`}>
                  스토리보드
                </button>
                <button onClick={() => setStoryboardTab('subtitle')}
                  className={`px-5 py-1.5 rounded-lg text-sm font-semibold transition-all ${storyboardTab === 'subtitle' ? 'bg-blue-600/20 border border-blue-500/50 text-blue-200 shadow-[0_0_10px_rgba(59,130,246,0.3)]' : 'text-slate-400 hover:text-slate-200 border border-transparent'}`}>
                  자막 편집
                </button>
                <button onClick={() => { setStoryboardTab('thumbnail'); setThumbnailEditorKey(k => k + 1); }}
                  className={`px-5 py-1.5 rounded-lg text-sm font-semibold transition-all ${storyboardTab === 'thumbnail' ? 'bg-blue-600/20 border border-blue-500/50 text-blue-200 shadow-[0_0_10px_rgba(59,130,246,0.3)]' : 'text-slate-400 hover:text-slate-200 border border-transparent'}`}>
                  썸네일
                </button>
              </div>
            </div>
            {/* 상태 표시 */}
            <div className="flex items-center gap-3">
              {(step === GenerationStep.SCRIPTING || step === GenerationStep.ASSETS) && (
                <>
                  <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent animate-spin rounded-full"></div>
                  <span className="text-sm font-bold text-slate-300 hidden sm:block">{progressMessage}</span>
                  <button onClick={handleAbort} className="px-3 py-1 rounded-lg bg-red-600/20 text-red-500 text-[10px] font-black border border-red-500/30">Stop</button>
                </>
              )}
              {step === GenerationStep.COMPLETED && (
                <>
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span className="text-sm font-bold text-slate-300 hidden sm:block">{progressMessage}</span>
                  {assetsRef.current.some(a => !a.imageData) && (
                    <button onClick={handleResume} className="px-3 py-1 rounded-lg bg-blue-600/30 text-blue-300 text-[10px] font-black border border-blue-500/40 hover:bg-blue-600/50 transition-colors">▶ 이어서 생성</button>
                  )}
                  <button onClick={handleReset} className="px-3 py-1 rounded-lg bg-slate-700/50 text-slate-400 text-[10px] font-black border border-slate-600/50 hover:bg-red-600/20 hover:text-red-400 transition-colors">전체 리셋</button>
                </>
              )}
              {step === GenerationStep.ERROR && (
                <>
                  <div className="w-2 h-2 rounded-full bg-red-500"></div>
                  <span className="text-sm font-bold text-red-400 hidden sm:block">{progressMessage}</span>
                  <button onClick={handleReset} className="px-3 py-1 rounded-lg bg-slate-700/50 text-slate-400 text-[10px] font-black border border-slate-600/50 hover:bg-red-600/20 hover:text-red-400 transition-colors">리셋</button>
                </>
              )}
            </div>
          </div>

          {/* 컨텐츠 */}
          <div className="flex-1 overflow-hidden">
            {generatedData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-500">
                <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent animate-spin rounded-full"></div>
                <p className="text-sm">{progressMessage || '생성 준비 중...'}</p>
              </div>
            ) : storyboardTab === 'thumbnail' ? (
              <ThumbnailEditor
                key={thumbnailEditorKey}
                scenes={generatedData}
                topic={currentTopic}
                selectedImage={storyThumbnailImage}
                onImageGenerated={undefined}
              />
            ) : storyboardTab === 'subtitle' ? (
              <SubtitleEditor
                scenes={generatedData}
                subConfig={subConfig}
                onSubConfigChange={handleSubConfigChange}
                onExportVideo={triggerVideoExport}
                isExporting={isVideoGenerating}
                onSelectThumbnail={handleSelectThumbnail}
                onGenerateAudio={handleGenerateSceneAudio}
                onDeleteScene={handleDeleteScene}
                onSceneZoomChange={handleSceneZoomChange}
                onGenerateAnimation={handleGenerateAnimation}
                animatingIndices={animatingIndices}
                aspectRatio={aspectRatio}
                onImageEditCommand={async (idx, command) => {
                  const current = assetsRef.current[idx];
                  if (!current) return;
                  if (!current.imageData) {
                    // 이미지 없으면 프롬프트 기반 재생성
                    const base = current.visualPrompt || current.narration || '';
                    await handleRegenerateWithPrompt(idx, `[USER EDIT REQUEST — APPLY FIRST]: ${command}\n\n[SCENE BASE]: ${base}`);
                    return;
                  }
                  // 기존 이미지를 Gemini에 전달 → 지정 부분만 수정
                  updateAssetAt(idx, { status: 'generating' });
                  setProgressMessage(`씬 ${idx + 1} 이미지 편집 중...`);
                  try {
                    const edited = await editImageWithGemini(current.imageData, command);
                    updateAssetAt(idx, { imageData: edited!, status: 'completed' });
                    setProgressMessage(`씬 ${idx + 1} 이미지 편집 완료`);
                    autoSaveProject();
                  } catch (e: any) {
                    updateAssetAt(idx, { status: 'error' });
                    const msg = e?.message || String(e);
                    setProgressMessage(`씬 ${idx + 1} 이미지 편집 실패: ${msg}`);
                    console.error('[ImageEdit]', e);
                  }
                }}
              />
            ) : (
              <div className="h-full overflow-y-auto py-6">
                <ResultTable
                  data={generatedData}
                  onRegenerateImage={handleRegenerateImage}
                  onRegenerateWithPrompt={handleRegenerateWithPrompt}
                  onExportVideo={triggerVideoExport}
                  isExporting={isVideoGenerating}
                  animatingIndices={animatingIndices}
                  onGenerateAnimation={handleGenerateAnimation}
                  onSelectThumbnail={handleSelectThumbnail}
                  aspectRatio={aspectRatio}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* API 키 설정 모달 */}
      {showApiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setShowApiModal(false)}>
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 space-y-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black text-white">API 키 설정</h2>
              <button onClick={() => setShowApiModal(false)} className="text-slate-500 hover:text-white transition-colors text-xl">✕</button>
            </div>
            {[
              { label: 'Gemini API 키', key: 'heaven_gemini_key', placeholder: 'AIza...', link: 'https://aistudio.google.com/app/apikey', hint: 'Google AI Studio에서 무료 발급' },
              { label: 'Claude API 키 (대본생성)', key: 'heaven_anthropic_key', placeholder: 'sk-ant-...', link: 'https://console.anthropic.com', hint: '대본 생성에 Claude Sonnet 4.6 사용 (없으면 Gemini)' },
              { label: 'ElevenLabs API 키', key: 'heaven_el_key', placeholder: 'TTS용 키...', link: 'https://elevenlabs.io', hint: 'TTS 음성 생성용' },
              { label: 'FAL API 키', key: 'heaven_fal_key', placeholder: 'fal.ai 키...', link: 'https://fal.ai', hint: '이미지→영상 변환용' },
            ].map(({ label, key, placeholder, link, hint }) => (
              <div key={key} className="space-y-1.5">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">{label}</label>
                <input
                  type="password"
                  defaultValue={localStorage.getItem(key) || ''}
                  placeholder={placeholder}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v) localStorage.setItem(key, v);
                  }}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm placeholder-slate-600 focus:border-brand-500 focus:outline-none"
                />
                <p className="text-[11px] text-slate-600">{hint} — <a href={link} target="_blank" rel="noreferrer" className="text-brand-400 hover:underline">{link.replace('https://', '')}</a></p>
              </div>
            ))}
            <button
              onClick={() => { setShowApiModal(false); window.location.reload(); }}
              className="w-full py-3 bg-brand-600 hover:bg-brand-500 text-white font-black rounded-xl transition-colors"
            >
              저장 후 새로고침
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
