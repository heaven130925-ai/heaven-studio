
import React, { useState, useCallback, useRef, useEffect } from 'react';
import Header from './components/Header';
import InputSection from './components/InputSection';
import PasswordGate from './components/PasswordGate';
import ResultTable from './components/ResultTable';
import { GeneratedAsset, GenerationStep, ScriptScene, CostBreakdown, ReferenceImages, DEFAULT_REFERENCE_IMAGES, DEFAULT_SUBTITLE_CONFIG, SubtitleConfig } from './types';
import { generateScript, generateScriptChunked, findTrendingTopics, generateAudioForScene, generateAllScenesAudio, generateMotionPrompt, extractCharactersFromScript, generateCharacterImage, CharacterInfo } from './services/geminiService';
import { generateImage, getSelectedImageModel } from './services/imageService';
import { generateAudioWithElevenLabs } from './services/elevenLabsService';
import { generateVideo, VideoGenerationResult } from './services/videoService';
import { downloadSrtFromRecorded } from './services/srtService';
import { generateVideoFromImage, getFalApiKey } from './services/falService';
import { saveProject, getSavedProjects, deleteProject, migrateFromLocalStorage } from './services/projectService';
import { SavedProject } from './types';
import { CONFIG, PRICING, formatKRW } from './config';
import ProjectGallery from './components/ProjectGallery';
import * as FileSaver from 'file-saver';

const saveAs = (FileSaver as any).saveAs || (FileSaver as any).default || FileSaver;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type ViewMode = 'main' | 'gallery';

const App: React.FC = () => {
  const allowedPasswords = (import.meta.env.VITE_ACCESS_PASSWORDS || '')
    .split(',').map((p: string) => p.trim()).filter(Boolean);
  const savedPass = localStorage.getItem('heaven_access') || '';
  const [isAuthenticated, setIsAuthenticated] = useState(
    allowedPasswords.length === 0 || allowedPasswords.includes(savedPass)
  );

  const [step, setStep] = useState<GenerationStep>(GenerationStep.IDLE);
  const [generatedData, setGeneratedData] = useState<GeneratedAsset[]>([]);
  const [progressMessage, setProgressMessage] = useState('');
  const [inputActiveTab, setInputActiveTab] = useState<'auto' | 'manual'>('auto');
  const [inputManualScript, setInputManualScript] = useState<string>('');
  const [isVideoGenerating, setIsVideoGenerating] = useState(false);
  // 참조 이미지 상태 (강도 포함)
  const [currentReferenceImages, setCurrentReferenceImages] = useState<ReferenceImages>(DEFAULT_REFERENCE_IMAGES);
  const [needsKey, setNeedsKey] = useState(false);
  const [animatingIndices, setAnimatingIndices] = useState<Set<number>>(new Set());

  // 갤러리 뷰 관련
  const [viewMode, setViewMode] = useState<ViewMode>('main');
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  const [currentTopic, setCurrentTopic] = useState<string>('');

  // 비용 추적
  const [currentCost, setCurrentCost] = useState<CostBreakdown | null>(null);

  // 캐릭터 추출 상태
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [isExtractingCharacters, setIsExtractingCharacters] = useState(false);
  const costRef = useRef<CostBreakdown>({
    images: 0, tts: 0, videos: 0, total: 0,
    imageCount: 0, ttsCharacters: 0, videoCount: 0
  });

  const usedTopicsRef = useRef<string[]>([]);
  const assetsRef = useRef<GeneratedAsset[]>([]);
  const pendingScriptScenesRef = useRef<ScriptScene[]>([]); // SCRIPT_READY 후 씬 보관용
  const isAbortedRef = useRef(false);
  const isProcessingRef = useRef(false);

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
    }
  };

  const updateAssetAt = (index: number, updates: Partial<GeneratedAsset>) => {
    if (isAbortedRef.current) return;
    if (assetsRef.current[index]) {
      assetsRef.current[index] = { ...assetsRef.current[index], ...updates };
      setGeneratedData([...assetsRef.current]);
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
    setStep(GenerationStep.IDLE);
    setProgressMessage('');
    resetCost();
  };


  const handleGenerate = useCallback(async (
    topic: string,
    refImgs: ReferenceImages,
    sourceText: string | null,
    sceneCount: number = 0,
    imageOnly: boolean = false
  ) => {
    console.log(`[handleGenerate] topic="${topic}", sourceText=${sourceText === null ? 'null' : `"${sourceText?.slice(0,20)}..."`}, imageOnly=${imageOnly}`);
    if (isProcessingRef.current) { console.log('[handleGenerate] blocked: isProcessing'); return; }
    isProcessingRef.current = true;
    isAbortedRef.current = false;

    // 이전 대본 초기화
    setInputManualScript('');
    setStep(GenerationStep.SCRIPTING);
    setProgressMessage('V9.2 Ultra 엔진 부팅 중...');

    try {
      const hasKey = await checkApiKeyStatus();
      if (!hasKey && (window as any).aistudio) {
        await (window as any).aistudio.openSelectKey();
      }

      setGeneratedData([]);
      assetsRef.current = [];
      setCurrentReferenceImages(refImgs);
      setCurrentTopic(topic); // 저장용 토픽 기록
      resetCost(); // 비용 초기화

      // 참조 이미지 존재 여부 계산
      const hasRefImages = (refImgs.character?.length || 0) + (refImgs.style?.length || 0) > 0;
      console.log(`[App] 참조 이미지 - 캐릭터: ${refImgs.character?.length || 0}개, 스타일: ${refImgs.style?.length || 0}개`);

      let targetTopic = topic;

      if (topic === "Manual Script Input" && sourceText) {
        setProgressMessage('대본 분석 및 시각화 설계 중...');
      } else if (sourceText) {
        setProgressMessage('외부 콘텐츠 분석 중...');
        targetTopic = "Custom Analysis Topic";
      } else {
        // 사용자가 입력한 주제를 그대로 사용 (범용 대본 생성)
        targetTopic = topic;
        setProgressMessage(`"${topic}" 대본 생성 중...`);
      }

      setProgressMessage(`대본 생성 중...`);

      // 긴 대본(3000자 초과) 감지 시 청크 분할 처리
      const inputLength = sourceText?.length || 0;
      const CHUNK_THRESHOLD = 3000; // 3000자 초과 시 청크 분할

      let scriptScenes: ScriptScene[];
      if (inputLength > CHUNK_THRESHOLD) {
        // 긴 대본: 청크 분할 처리 (10,000자 이상 대응)
        console.log(`[App] 긴 대본 감지: ${inputLength.toLocaleString()}자 → 청크 분할 처리`);
        setProgressMessage(`긴 대본(${inputLength.toLocaleString()}자) 청크 분할 처리 중...`);
        scriptScenes = await generateScriptChunked(
          targetTopic,
          hasRefImages,
          sourceText!,
          2500, // 청크당 2500자
          setProgressMessage, // 진행 상황 콜백
          sceneCount || undefined
        );
      } else {
        // 일반 대본: 기존 방식
        scriptScenes = await generateScript(targetTopic, hasRefImages, sourceText, sceneCount || undefined);
      }
      if (isAbortedRef.current) return;
      
      // 자동 주제 모드: 생성된 대본을 textarea로 전달하고 스토리보드 표시 안함
      const isAutoTopic = !sourceText && topic !== 'Manual Script Input';
      console.log(`[handleGenerate] isAutoTopic=${isAutoTopic}, imageOnly=${imageOnly}, scenes=${scriptScenes.length}, narrations:`, scriptScenes.map(s => s.narration?.slice(0,30)));
      if (isAutoTopic && !imageOnly) {
        const scriptText = scriptScenes.map(s => s.narration).join('\n');
        console.log(`[handleGenerate] SCRIPT_READY → scriptText(${scriptText.length}chars): "${scriptText.slice(0,100)}"`);
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

      const initialAssets = scriptScenes.map(scene => ({
        ...scene, imageData: null, audioData: null, audioDuration: null, subtitleData: null, videoData: null, videoDuration: null, status: 'pending' as const
      }));
      assetsRef.current = initialAssets;
      setGeneratedData(initialAssets);

      setStep(GenerationStep.ASSETS);

      const runAudio = async () => {
          const ttsProvider = localStorage.getItem(CONFIG.STORAGE_KEYS.TTS_PROVIDER) || 'elevenlabs';

          if (ttsProvider === 'google') {
            // ── Google TTS: 전체 씬을 한 세션에서 생성 (목소리 일관성) ──
            try {
              const narrations = initialAssets.map(a => a.narration);
              const audioList = await generateAllScenesAudio(narrations, setProgressMessage);
              if (isAbortedRef.current) return;
              audioList.forEach((audioData, i) => {
                if (audioData) {
                  updateAssetAt(i, { audioData });
                  console.log(`[TTS] 씬 ${i + 1} Google TTS 배치 완료`);
                } else {
                  updateAssetAt(i, { audioData: null });
                }
              });
            } catch (e: any) {
              console.error('[TTS] Google TTS 배치 실패:', e.message);
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

              // ElevenLabs 실패 시 Google TTS 폴백
              if (!success && !isAbortedRef.current) {
                  try {
                      console.log(`[TTS] 씬 ${i + 1} Google TTS 폴백 시도...`);
                      const fallbackAudio = await generateAudioForScene(assetsRef.current[i].narration);
                      updateAssetAt(i, { audioData: fallbackAudio });
                  } catch (fallbackError) {
                      console.error(`[TTS] 씬 ${i + 1} Google TTS 폴백도 실패:`, fallbackError);
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

          for (let i = 0; i < initialAssets.length; i++) {
              if (isAbortedRef.current) break;
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

                      // Scene 객체 전체를 넘겨서 prompts.ts가 분석 정보를 활용하도록 함
                      const img = await generateImage(assetsRef.current[i], refImgs);
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

      setProgressMessage(imageOnly ? '이미지 생성 중...' : '시각 에셋 및 오디오 합성 중...');
      // imageOnly 모드: 이미지만 생성, 아니면 병렬 생성
      await Promise.all(imageOnly ? [runImages()] : [runAudio(), runImages()]);

      // 애니메이션 변환은 이제 수동으로 (이미지 호버 시 버튼 클릭)
      // 자동 변환 비활성화 - 사용자가 원하는 이미지만 선택적으로 변환 가능
      
      if (isAbortedRef.current) return;
      setStep(GenerationStep.COMPLETED);

      // 비용 요약 메시지 (원화)
      const cost = costRef.current;
      const costMsg = `이미지 ${cost.imageCount}장 ${formatKRW(cost.images)} + TTS ${cost.ttsCharacters}자 ${formatKRW(cost.tts)} = 총 ${formatKRW(cost.total)}`;
      setProgressMessage(`생성 완료! ${costMsg}`);

      // 자동 저장 (비용 정보 포함)
      try {
        const savedProject = await saveProject(targetTopic, assetsRef.current, undefined, costRef.current);
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
      isProcessingRef.current = false;
    }
  }, [checkApiKeyStatus, refreshProjects]);

  // 이미지 재생성 핸들러 (useCallback으로 메모이제이션)
  const handleRegenerateImage = useCallback(async (idx: number) => {
    if (isProcessingRef.current) return;

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

  // 프롬프트 수정 후 재생성 핸들러
  const handleRegenerateWithPrompt = useCallback(async (idx: number, customPrompt: string) => {
    if (assetsRef.current[idx]) {
      assetsRef.current[idx] = { ...assetsRef.current[idx], visualPrompt: customPrompt };
      setGeneratedData([...assetsRef.current]);
    }
    await handleRegenerateImage(idx);
  }, [handleRegenerateImage]);

  // 애니메이션 생성 핸들러 (useCallback으로 메모이제이션)
  const handleGenerateAnimation = useCallback(async (idx: number) => {
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

      // AI가 대본과 이미지를 분석해서 움직임 프롬프트 생성
      const motionPrompt = await generateMotionPrompt(
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

  const triggerVideoExport = async (enableSubtitles: boolean = true) => {
    if (isVideoGenerating) return;
    try {
      setIsVideoGenerating(true);
      const suffix = enableSubtitles ? 'sub' : 'nosub';
      const timestamp = Date.now();

      // localStorage에서 자막 설정 읽기
      let subtitleConfig: Partial<SubtitleConfig> = {};
      try {
        const saved = localStorage.getItem(CONFIG.STORAGE_KEYS.SUBTITLE_CONFIG);
        if (saved) subtitleConfig = { ...DEFAULT_SUBTITLE_CONFIG, ...JSON.parse(saved) };
      } catch {}

      const result = await generateVideo(
        assetsRef.current,
        (msg) => setProgressMessage(`[Render] ${msg}`),
        isAbortedRef,
        { enableSubtitles, subtitleConfig }
      );

      if (result) {
        // 영상 저장 (자막은 영상에 하드코딩됨)
        saveAs(result.videoBlob, `tubegen_v92_${suffix}_${timestamp}.mp4`);
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

  // 캐릭터 추출 핸들러
  const handleExtractCharacters = useCallback(async (script: string) => {
    if (isExtractingCharacters) return;
    setIsExtractingCharacters(true);
    setCharacters([]);
    try {
      const extracted = await extractCharactersFromScript(script);
      if (extracted.length === 0) {
        alert('등장인물을 찾을 수 없습니다. 대본에 구체적인 인물이 포함되어 있는지 확인하세요.');
        return;
      }
      // 플레이스홀더로 먼저 표시
      setCharacters(extracted.map(c => ({ ...c, imageData: null })));
      // 각 캐릭터 이미지 생성
      for (let i = 0; i < extracted.length; i++) {
        try {
          const img = await generateCharacterImage(extracted[i]);
          setCharacters(prev => {
            const next = [...prev];
            next[i] = { ...next[i], imageData: img };
            return next;
          });
        } catch (e) {
          console.error(`캐릭터 ${extracted[i].name} 이미지 생성 실패:`, e);
        }
      }
    } catch (e: any) {
      alert(`캐릭터 추출 실패: ${e.message}`);
    } finally {
      setIsExtractingCharacters(false);
    }
  }, [isExtractingCharacters]);

  // 프로젝트 불러오기 핸들러
  const handleLoadProject = (project: SavedProject) => {
    // 저장된 에셋을 현재 상태로 로드
    assetsRef.current = project.assets;
    setGeneratedData([...project.assets]);
    setCurrentTopic(project.topic);
    setStep(GenerationStep.COMPLETED);
    setProgressMessage(`"${project.name}" 프로젝트 불러옴`);
    setViewMode('main'); // 메인 뷰로 전환
  };

  // Gemini API 키 미설정 시 셋업 화면
  const hasGeminiKey = !!(localStorage.getItem('tubegen_gemini_key') || process.env.GEMINI_API_KEY);
  if (!hasGeminiKey) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl p-8 space-y-6">
          <div className="text-center">
            <div className="text-4xl mb-3">🔑</div>
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
            className="w-full py-3 bg-brand-600 hover:bg-brand-500 text-white font-black rounded-xl transition-colors"
            onClick={() => {
              const input = (document.getElementById('setup-gemini-key') as HTMLInputElement).value.trim();
              if (!input) { alert('API 키를 입력해주세요.'); return; }
              localStorage.setItem('tubegen_gemini_key', input);
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
    return <PasswordGate onSuccess={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <Header />

      {/* 네비게이션 탭 */}
      <div className="border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 flex items-center gap-1">
          <button
            onClick={() => setViewMode('main')}
            className={`px-4 py-3 text-sm font-bold transition-colors relative ${
              viewMode === 'main'
                ? 'text-brand-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            스토리보드 생성
            {viewMode === 'main' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-500" />
            )}
          </button>
          <button
            onClick={() => setViewMode('gallery')}
            className={`px-4 py-3 text-sm font-bold transition-colors relative flex items-center gap-2 ${
              viewMode === 'gallery'
                ? 'text-brand-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            저장된 프로젝트
            {savedProjects.length > 0 && (
              <span className="px-1.5 py-0.5 bg-slate-700 text-xs rounded-full">
                {savedProjects.length}
              </span>
            )}
            {viewMode === 'gallery' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-500" />
            )}
          </button>
          <div className="ml-auto">
            <button onClick={handleOpenKeySelector} className="px-4 py-2 text-sm font-bold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors border border-slate-700 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
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
      <main className="py-8">
        <InputSection
          onGenerate={handleGenerate}
          onExtractCharacters={handleExtractCharacters}
          step={step}
          activeTab={inputActiveTab}
          onTabChange={setInputActiveTab}
          manualScript={inputManualScript}
          onManualScriptChange={setInputManualScript}
        />

        {/* 캐릭터 카드 */}
        {(isExtractingCharacters || characters.length > 0) && (
          <div className="max-w-7xl mx-auto px-4 mb-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-black text-slate-200 flex items-center gap-2">
                <svg className="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                등장인물
                {isExtractingCharacters && <span className="text-xs text-violet-400 font-normal animate-pulse">이미지 생성 중...</span>}
              </h2>
              <button onClick={() => setCharacters([])} className="text-[10px] text-slate-500 hover:text-red-400 transition-colors">초기화</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {characters.map((char, i) => (
                <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col">
                  <div className="aspect-square bg-slate-800 flex items-center justify-center relative">
                    {char.imageData ? (
                      <img src={`data:image/jpeg;base64,${char.imageData}`} alt={char.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent animate-spin rounded-full" />
                    )}
                  </div>
                  <div className="p-3 flex flex-col gap-1">
                    <p className="text-sm font-black text-white truncate">{char.name}</p>
                    <p className="text-[10px] text-slate-400 leading-relaxed line-clamp-3">{char.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {step !== GenerationStep.IDLE && (
          <div className="max-w-7xl mx-auto px-4 text-center mb-6">
             <div className="inline-flex flex-wrap items-center gap-3 px-6 py-3 rounded-2xl border bg-slate-900 border-slate-800 shadow-2xl">
                {(step === GenerationStep.SCRIPTING || step === GenerationStep.ASSETS) ? (
                  <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent animate-spin rounded-full"></div>
                ) : <div className={`w-2 h-2 rounded-full ${step === GenerationStep.ERROR ? 'bg-red-500' : step === GenerationStep.SCRIPT_READY ? 'bg-yellow-400' : 'bg-green-500'}`}></div>}
                <span className="text-sm font-bold text-slate-300">{progressMessage}</span>
                {(step === GenerationStep.SCRIPTING || step === GenerationStep.ASSETS) && (
                  <button onClick={handleAbort} className="px-3 py-1 rounded-lg bg-red-600/20 text-red-500 text-[10px] font-black uppercase tracking-widest border border-red-500/30">Stop</button>
                )}
                {/* 대본 완성: 아래 대본창에서 확인 후 스토리보드 생성 버튼 안내 */}
                {step === GenerationStep.SCRIPT_READY && (
                  <button onClick={handleReset} className="px-3 py-1 rounded-lg bg-slate-700/50 text-slate-400 text-[10px] font-black border border-slate-600/50 hover:bg-red-600/20 hover:text-red-400 transition-colors">리셋</button>
                )}
                {(step === GenerationStep.COMPLETED || step === GenerationStep.ERROR) && generatedData.length > 0 && (
                  <button onClick={handleReset} className="px-3 py-1 rounded-lg bg-slate-700/50 text-slate-400 text-[10px] font-black uppercase tracking-widest border border-slate-600/50 hover:bg-red-600/20 hover:text-red-400 hover:border-red-500/30 transition-colors">전체 리셋</button>
                )}
             </div>
          </div>
        )}

        {generatedData.length > 0 && (
          <ResultTable
              data={generatedData}
              onRegenerateImage={handleRegenerateImage}
              onRegenerateWithPrompt={handleRegenerateWithPrompt}
              onExportVideo={triggerVideoExport}
              isExporting={isVideoGenerating}
              animatingIndices={animatingIndices}
              onGenerateAnimation={handleGenerateAnimation}
          />
        )}
      </main>
      )}
    </div>
  );
};

export default App;
