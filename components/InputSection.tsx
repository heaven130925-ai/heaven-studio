
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import ThumbnailEditor from './ThumbnailEditor';
import { GenerationStep, ProjectSettings, ReferenceImages, DEFAULT_REFERENCE_IMAGES } from '../types';
import { CONFIG, ELEVENLABS_MODELS, ElevenLabsModelId, IMAGE_MODELS, ImageModelId, ELEVENLABS_DEFAULT_VOICES, VoiceGender, GEMINI_TTS_VOICES, GeminiTtsVoiceId, VISUAL_STYLES, VisualStyleId } from '../config';
import { getElevenLabsModelId, setElevenLabsModelId, fetchElevenLabsVoices, ElevenLabsVoice } from '../services/elevenLabsService';
import { generateGeminiTtsPreview, analyzeCharacterReference, findTrendingTopics, findYouTubeTopics } from '../services/geminiService';
import { getVoiceSetting, setVoiceSetting, removeVoiceSetting } from '../utils/voiceStorage';


function pcmBase64ToWavUrl(base64Pcm: string): string {
  const pcmBytes = Uint8Array.from(atob(base64Pcm), c => c.charCodeAt(0));
  const wav = new ArrayBuffer(44 + pcmBytes.length);
  const v = new DataView(wav);
  const wr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); v.setUint32(4, 36 + pcmBytes.length, true); wr(8, 'WAVE');
  wr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 24000, true); v.setUint32(28, 48000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  wr(36, 'data'); v.setUint32(40, pcmBytes.length, true);
  new Uint8Array(wav).set(pcmBytes, 44);
  return URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
}

interface InputSectionProps {
  onGenerate: (topic: string, referenceImages: ReferenceImages, sourceText: string | null, sceneCount: number, imageOnly?: boolean, audioOnly?: boolean, autoRun?: boolean) => void;
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
}

const InputSection: React.FC<InputSectionProps> = ({ onGenerate, onCharacterAnalyze, isAnalyzingCharacters, step, activeTab, onTabChange, manualScript, onManualScriptChange, thumbnailBaseImage, onThumbnailBaseImageChange, onAspectRatioChange, thumbnailScenes, thumbnailTopic, onOpenGallery }) => {
  const [topic, setTopic] = useState('');
  const [sceneCount, setSceneCount] = useState<number>(0);

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

  // 이미지 설정
  const [imageModelId, setImageModelId] = useState<ImageModelId>('gemini-2.5-flash-image');
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

  // API 키
  const [geminiApiKey, setGeminiApiKey] = useState(localStorage.getItem('heaven_gemini_key') || '');
  const [elApiKeyInput, setElApiKeyInput] = useState(
    localStorage.getItem(CONFIG.STORAGE_KEYS.ELEVENLABS_API_KEY) || process.env.ELEVENLABS_API_KEY || ''
  );
  const elApiKey = elApiKeyInput || process.env.ELEVENLABS_API_KEY || '';

  // ElevenLabs
  const [elVoiceId, setElVoiceId] = useState('');
  const [elModelId, setElModelId] = useState<ElevenLabsModelId>('eleven_multilingual_v2');
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [genderFilter, setGenderFilter] = useState<VoiceGender | null>(null);

  // 음성 공통
  const [voiceSpeed, setVoiceSpeed] = useState<string>(getVoiceSetting(CONFIG.STORAGE_KEYS.VOICE_SPEED) || '1.0');
  const [voiceStability, setVoiceStability] = useState<number>(parseInt(getVoiceSetting(CONFIG.STORAGE_KEYS.VOICE_STABILITY) || '50'));
  const [voiceTone, setVoiceTone] = useState<string>(getVoiceSetting('heaven_voice_tone') || '');
  const [voiceMoodPreset, setVoiceMoodPreset] = useState<string>(getVoiceSetting('heaven_voice_mood') || '');
  const [googleTtsTone, setGoogleTtsTone] = useState<string>(getVoiceSetting('heaven_google_tts_tone_id') || '');
  const [googleTtsMood, setGoogleTtsMood] = useState<string>(getVoiceSetting('heaven_google_tts_mood_id') || '');
  const [gcloudTone, setGcloudTone] = useState<string>(getVoiceSetting('heaven_gcloud_tone_id') || '');
  const [gcloudMood, setGcloudMood] = useState<string>(getVoiceSetting('heaven_gcloud_mood_id') || '');
  const [voiceStyle, setVoiceStyle] = useState<number>(parseInt(getVoiceSetting(CONFIG.STORAGE_KEYS.VOICE_STYLE) || '0'));
  const [voiceSubTab, setVoiceSubTab] = useState<'elevenlabs' | 'google' | 'gcloud' | 'azure'>(
    (getVoiceSetting(CONFIG.STORAGE_KEYS.TTS_PROVIDER) as 'elevenlabs' | 'google' | 'gcloud' | 'azure') || 'elevenlabs'
  );
  const [gcloudApiKey, setGcloudApiKey] = useState(localStorage.getItem(CONFIG.STORAGE_KEYS.GCLOUD_TTS_API_KEY) || '');
  const [gcloudVoice, setGcloudVoice] = useState(getVoiceSetting(CONFIG.STORAGE_KEYS.GCLOUD_TTS_VOICE) || 'ko-KR-Neural2-A');
  const [playingGcloudVoice, setPlayingGcloudVoice] = useState<string | null>(null);
  const [azureApiKey, setAzureApiKey] = useState(localStorage.getItem(CONFIG.STORAGE_KEYS.AZURE_TTS_API_KEY) || '');
  const [azureRegion, setAzureRegion] = useState(getVoiceSetting(CONFIG.STORAGE_KEYS.AZURE_TTS_REGION) || '');
  const [azureVoice, setAzureVoice] = useState(getVoiceSetting(CONFIG.STORAGE_KEYS.AZURE_TTS_VOICE) || 'ko-KR-SunHiNeural');
  const [playingAzureVoice, setPlayingAzureVoice] = useState<string | null>(null);

  // Google TTS
  const [geminiTtsVoice, setGeminiTtsVoice] = useState<GeminiTtsVoiceId>(CONFIG.DEFAULT_GEMINI_TTS_VOICE);
  const [geminiTtsGenderFilter, setGeminiTtsGenderFilter] = useState<'male' | 'female' | null>(null);
  const [playingGeminiVoiceId, setPlayingGeminiVoiceId] = useState<string | null>(null);

  // 썸네일
  const [thumbnailText, setThumbnailText] = useState('');
  const [thumbnailImage, setThumbnailImage] = useState<string | null>(null);
  const [isThumbnailGenerating, setIsThumbnailGenerating] = useState(false);
  const [thumbnailFontSize, setThumbnailFontSize] = useState(80);
  const [thumbnailTextColor, setThumbnailTextColor] = useState('#ffffff');
  const [thumbnailTextY, setThumbnailTextY] = useState(85);
  const [thumbnailFontFamily, setThumbnailFontFamily] = useState('Impact, "Arial Narrow", sans-serif');
  const [thumbnailTextAlign, setThumbnailTextAlign] = useState<'left' | 'center' | 'right'>('center');
  const [thumbnailCustomImage, setThumbnailCustomImage] = useState<string | null>(null);
  const thumbnailCanvasRef = useRef<HTMLCanvasElement>(null);
  const thumbnailFileInputRef = useRef<HTMLInputElement>(null);

  // 2단계 완전 자동화
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [suggestedTopics, setSuggestedTopics] = useState<Array<{rank: number; topic: string; reason: string}>>([]);
  const [selectedTopics, setSelectedTopics] = useState<Set<number>>(new Set());
  const [isLoadingTopics, setIsLoadingTopics] = useState(false);
  const [topicSource, setTopicSource] = useState<'google' | 'youtube'>('google');
  const [youtubeChannels, setYoutubeChannels] = useState(localStorage.getItem('heaven_yt_channels') || '');
  const [youtubeApiKey, setYoutubeApiKey] = useState(localStorage.getItem(CONFIG.STORAGE_KEYS.YOUTUBE_API_KEY) || '');
  const [youtubeTimeRange, setYoutubeTimeRange] = useState<'3months' | '6months' | '1year' | 'all'>('6months');
  const [autoRunMode, setAutoRunMode] = useState(false);
  const [writingGuide, setWritingGuide] = useState(localStorage.getItem('heaven_writing_guide') || '');
  const [showWritingGuide, setShowWritingGuide] = useState(false);
  const [isSequentialRunning, setIsSequentialRunning] = useState(false);
  const sequentialQueueRef = useRef<string[]>([]);
  const sequentialIndexRef = useRef(0);
  const prevStepRef = useRef(step);

  // 프로젝트
  const [projects, setProjects] = useState<ProjectSettings[]>([]);
  const [newProjectName, setNewProjectName] = useState('');

  // 패널 네비게이션
  const [activePanel, setActivePanel] = useState<string | null>(null);

  const characterFileInputRef = useRef<HTMLInputElement>(null);
  const styleFileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const savedVoiceId = getVoiceSetting(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID) || '';
    setElVoiceId(savedVoiceId);
    setElModelId(getElevenLabsModelId());
    setImageModelId(localStorage.getItem(CONFIG.STORAGE_KEYS.IMAGE_MODEL) as ImageModelId || CONFIG.DEFAULT_IMAGE_MODEL);
    setImageTextMode(localStorage.getItem(CONFIG.STORAGE_KEYS.IMAGE_TEXT_MODE) || 'none');
    setGeminiTtsVoice(getVoiceSetting(CONFIG.STORAGE_KEYS.GEMINI_TTS_VOICE) as GeminiTtsVoiceId || CONFIG.DEFAULT_GEMINI_TTS_VOICE);
    const saved = localStorage.getItem(CONFIG.STORAGE_KEYS.PROJECTS);
    if (saved) { try { setProjects(JSON.parse(saved)); } catch {} }
    if (elApiKey) loadVoices(elApiKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  useEffect(() => { return () => { audioRef.current?.pause(); audioRef.current = null; }; }, []);

  // 카테고리 변경 시 해당 카테고리의 글쓰기 지침 자동 로드
  const CATEGORY_DEFAULT_GUIDES: Record<string, string> = {
    '한국 야담/기담/미스터리': '공포스럽고 몰입감 있는 문체, 반말 사용, 마지막에 소름돋는 반전 포함, 각 씬은 짧고 임팩트 있게',
    '경제/재테크/투자': '친근한 말투, 숫자와 수치 반드시 포함, 실생활 예시로 설명, 핵심은 3가지로 간결하게 정리',
    '한국사/세계사': '흥미로운 이야기체 서술, 역사적 사실 기반, 현재와의 연관성 언급, 인물 중심으로',
    '과학/우주/자연': '경이로움을 자극하는 문체, 어려운 개념은 쉽게 비유해서 설명, 숫자로 규모감 표현',
    '뉴스/시사/사회': '중립적이고 객관적 시각, 핵심 팩트 중심, 간결하게, 왜 중요한지 한 줄 설명',
    '건강/의학': '신뢰감 있는 말투, 의학적 사실 기반, 실천 가능한 조언 포함, 전문용어는 쉽게 풀어서',
    '심리/정신건강': '공감하는 따뜻한 말투, 일상 속 사례로 설명, 독자가 자기 자신을 돌아볼 수 있게',
    '종교/영성/철학': '깊이 있고 사려깊은 문체, 다양한 관점 존중, 삶의 의미와 연결',
    '연예/문화': '가볍고 흥미로운 말투, 재미있는 에피소드 중심, 독자가 알면 놀랄 비하인드 스토리',
    '스포츠': '역동적이고 활기찬 문체, 경기 장면을 생생하게 묘사, 선수의 인간적인 면 부각',
  };

  useEffect(() => {
    if (!selectedCategory) return;
    const saved = localStorage.getItem(`${CONFIG.STORAGE_KEYS.CATEGORY_GUIDE_PREFIX}${selectedCategory}`);
    setWritingGuide(saved !== null ? saved : (CATEGORY_DEFAULT_GUIDES[selectedCategory] || ''));
    setShowWritingGuide(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory]);

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

  // 순차 생성: step이 COMPLETED로 바뀔 때 다음 주제 자동 실행
  useEffect(() => {
    const prev = prevStepRef.current;
    prevStepRef.current = step;
    if (!isSequentialRunning) return;
    if (prev !== GenerationStep.COMPLETED && step === GenerationStep.COMPLETED) {
      const idx = sequentialIndexRef.current;
      const queue = sequentialQueueRef.current;
      if (idx < queue.length) {
        sequentialIndexRef.current = idx + 1;
        setTimeout(() => {
          const nextTopic = queue[idx];
          setTopic(nextTopic);
          onGenerate(nextTopic, { characterImages: characterRefImages, styleImages: styleRefImages, characterStrength, styleStrength, characterDescription }, null, sceneCount, false, false, true);
        }, 2500);
      } else {
        setIsSequentialRunning(false);
        sequentialQueueRef.current = [];
        sequentialIndexRef.current = 0;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const loadVoices = useCallback(async (apiKey?: string) => {
    const key = apiKey || elApiKey;
    if (!key || key.length < 10) return;
    setIsLoadingVoices(true);
    try { setVoices(await fetchElevenLabsVoices(key)); } catch {}
    finally { setIsLoadingVoices(false); }
  }, []);

  const selectVoice = useCallback((voice: ElevenLabsVoice) => {
    setElVoiceId(voice.voice_id);
    setVoiceSetting(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID, voice.voice_id);
  }, []);

  const PREVIEW_TEXT = "안녕하세요. 테스트 목소리입니다.";

  const playElevenLabsPreview = async (voiceId: string, voiceName: string) => {
    if (!elApiKey || elApiKey.length < 10) { alert('ElevenLabs API Key가 없습니다.'); return; }
    if (playingVoiceId === voiceId) { audioRef.current?.pause(); audioRef.current = null; setPlayingVoiceId(null); return; }
    audioRef.current?.pause(); setPlayingVoiceId(voiceId);
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': elApiKey },
        body: JSON.stringify({ text: PREVIEW_TEXT, model_id: elModelId, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.play().catch(() => setPlayingVoiceId(null));
      audio.onended = () => { setPlayingVoiceId(null); audioRef.current = null; URL.revokeObjectURL(url); };
    } catch { alert(`"${voiceName}" 미리듣기 실패`); setPlayingVoiceId(null); }
  };

  const playGeminiTtsPreview = async (voiceId: string) => {
    if (playingGeminiVoiceId === voiceId) { audioRef.current?.pause(); audioRef.current = null; setPlayingGeminiVoiceId(null); return; }
    audioRef.current?.pause(); setPlayingGeminiVoiceId(voiceId);
    try {
      const base64 = await generateGeminiTtsPreview(PREVIEW_TEXT, voiceId);
      if (!base64) throw new Error('no audio');
      const url = pcmBase64ToWavUrl(base64);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.play().catch(() => setPlayingGeminiVoiceId(null));
      audio.onended = () => { setPlayingGeminiVoiceId(null); audioRef.current = null; URL.revokeObjectURL(url); };
    } catch (err: any) {
      setPlayingGeminiVoiceId(null);
      alert(`Google TTS 오류: ${err?.message || err}`);
    }
  };

const saveElSettings = () => { if (elVoiceId) setVoiceSetting(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID, elVoiceId); setElevenLabsModelId(elModelId); };
  const selectVoiceSpeed = (v: string) => { setVoiceSpeed(v); setVoiceSetting(CONFIG.STORAGE_KEYS.VOICE_SPEED, v); };
  const changeVoiceStability = (v: number) => { setVoiceStability(v); setVoiceSetting(CONFIG.STORAGE_KEYS.VOICE_STABILITY, String(v)); };
  const changeVoiceStyle = (v: number) => { setVoiceStyle(v); setVoiceSetting(CONFIG.STORAGE_KEYS.VOICE_STYLE, String(v)); };
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
    const p: ProjectSettings = { id: Date.now().toString(), name: newProjectName.trim(), createdAt: Date.now(), updatedAt: Date.now(), imageModel: imageModelId, elevenLabsVoiceId: elVoiceId, elevenLabsModel: elModelId };
    const u = [...projects, p]; setProjects(u); localStorage.setItem(CONFIG.STORAGE_KEYS.PROJECTS, JSON.stringify(u)); setNewProjectName('');
  };
  const loadProject = (p: ProjectSettings) => {
    setImageModelId(p.imageModel as ImageModelId); setElVoiceId(p.elevenLabsVoiceId); setElModelId(p.elevenLabsModel as ElevenLabsModelId);
    localStorage.setItem(CONFIG.STORAGE_KEYS.IMAGE_MODEL, p.imageModel); setVoiceSetting(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID, p.elevenLabsVoiceId);
    setElevenLabsModelId(p.elevenLabsModel as ElevenLabsModelId); alert(`"${p.name}" 불러오기 완료`);
  };
  const deleteProject = (id: string) => { if (!confirm('삭제?')) return; const u = projects.filter(p => p.id !== id); setProjects(u); localStorage.setItem(CONFIG.STORAGE_KEYS.PROJECTS, JSON.stringify(u)); };

  const filteredDefaultVoices = useMemo(() => !genderFilter ? ELEVENLABS_DEFAULT_VOICES : ELEVENLABS_DEFAULT_VOICES.filter(v => v.gender === genderFilter), [genderFilter]);
  const filteredApiVoices = useMemo(() => !genderFilter ? voices : voices.filter(v => v.labels?.gender?.toLowerCase() === genderFilter), [voices, genderFilter]);

  const isProcessing = step !== GenerationStep.IDLE && step !== GenerationStep.COMPLETED && step !== GenerationStep.ERROR && step !== GenerationStep.SCRIPT_READY;
  const canSubmitAuto = topic.trim().length > 0;
  const canSubmitManual = manualScript.trim().length > 0;

  const buildRefImages = useCallback((): ReferenceImages => ({ character: characterRefImages, style: styleRefImages, characterStrength, styleStrength, characterDescription }), [characterRefImages, styleRefImages, characterStrength, styleStrength, characterDescription]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault(); if (isProcessing) return;
    const refImages = buildRefImages();
    if (activeTab === 'auto') { if (canSubmitAuto) onGenerate(topic, refImages, null, sceneCount, false, false, autoRunMode); }
    else { if (canSubmitManual) onGenerate("Manual Script Input", refImages, manualScript, sceneCount); }
  }, [isProcessing, activeTab, topic, manualScript, sceneCount, onGenerate, buildRefImages, canSubmitAuto, canSubmitManual, autoRunMode]);

  const handleImagesOnly = useCallback(() => {
    if (isProcessing) return;
    const refImages = buildRefImages();
    if (activeTab === 'auto') { if (canSubmitAuto) onGenerate(topic, refImages, null, sceneCount, true, false); }
    else { if (canSubmitManual) onGenerate("Manual Script Input", refImages, manualScript, sceneCount, true, false); }
  }, [isProcessing, activeTab, topic, manualScript, sceneCount, onGenerate, buildRefImages, canSubmitAuto, canSubmitManual]);

  const handleAudioOnly = useCallback(() => {
    if (isProcessing) return;
    const refImages = buildRefImages();
    if (activeTab === 'auto') { if (canSubmitAuto) onGenerate(topic, refImages, null, sceneCount, false, true); }
    else { if (canSubmitManual) onGenerate("Manual Script Input", refImages, manualScript, sceneCount, false, true); }
  }, [isProcessing, activeTab, topic, manualScript, sceneCount, onGenerate, buildRefImages, canSubmitAuto, canSubmitManual]);

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

  useEffect(() => {
    const canvas = thumbnailCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const base = thumbnailCustomImage || thumbnailBaseImage;
    if (!base) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const img = new Image();
    img.onload = () => {
      canvas.width = 1280;
      canvas.height = 720;
      ctx.drawImage(img, 0, 0, 1280, 720);
      if (thumbnailText.trim()) {
        const yPx = Math.round((thumbnailTextY / 100) * 720);
        const fontSize = thumbnailFontSize;
        ctx.font = `900 ${fontSize}px ${thumbnailFontFamily}`;
        ctx.textAlign = thumbnailTextAlign;
        const xPos = thumbnailTextAlign === 'left' ? 40 : thumbnailTextAlign === 'right' ? 1240 : 640;
        ctx.lineWidth = Math.round(fontSize * 0.12);
        ctx.strokeStyle = 'rgba(0,0,0,0.9)';
        ctx.lineJoin = 'round';
        ctx.strokeText(thumbnailText, xPos, yPx);
        ctx.fillStyle = thumbnailTextColor;
        ctx.fillText(thumbnailText, xPos, yPx);
      }
    };
    img.src = base.startsWith('data:') ? base : `data:image/jpeg;base64,${base}`;
  }, [thumbnailBaseImage, thumbnailCustomImage, thumbnailText, thumbnailFontSize, thumbnailTextColor, thumbnailTextY, thumbnailFontFamily, thumbnailTextAlign]);

  const handleDownloadThumbnail = useCallback(() => {
    const canvas = thumbnailCanvasRef.current;
    if (!canvas) return;
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `thumbnail_${Date.now()}.jpg`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/jpeg', 0.95);
  }, []);

  const handleThumbnailUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setThumbnailCustomImage(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleGenerateThumbnail = useCallback(async () => {
    setIsThumbnailGenerating(true);
    try {
      const { generateThumbnail } = await import('../services/geminiService');
      const result = await generateThumbnail(topic || thumbnailText || '유튜브 썸네일', thumbnailText);
      if (result) setThumbnailImage(result);
    } catch (e) {
      console.error('썸네일 생성 실패:', e);
    } finally {
      setIsThumbnailGenerating(false);
    }
  }, [topic, thumbnailText]);

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
            const STYLE_EN: Record<string, string> = {
              cinematic: 'CINEMATIC', kdrama: 'K-DRAMA', noir: 'NOIR', webtoon: 'WEBTOON',
              'comic-webtoon': 'COMIC', '3d-animation': '3D ANIMATION', claymation: 'CLAYMATION',
              'fairy-tale': 'FAIRY TALE', 'wool-doll': 'WOOL FELT', diorama: 'DIORAMA',
              historical: 'HISTORICAL', webnovel: 'WEB NOVEL', ghibli: 'GHIBLI',
              stickman: 'STICKMAN', custom: 'CUSTOM',
            };
            return (
          <div className="p-3 border-b border-white/[0.07]">
            <p className="text-sm font-black text-white/80 uppercase tracking-widest mb-2 px-1 text-center">비주얼 스타일</p>
            <div className="grid grid-cols-3 gap-3">
              {VISUAL_STYLES.map(style => (
                <button key={style.id} type="button" onClick={() => selectVisualStyle(style.id as VisualStyleId)}
                  className={`relative p-2 rounded-xl border transition-all duration-200 hover:scale-[1.04] active:scale-[0.97] flex flex-col items-center justify-center text-center ${
                    visualStyleId === style.id
                      ? 'border-red-400/80 bg-red-900/30 shadow-[0_0_14px_rgba(239,68,68,0.45)]'
                      : 'border-white/[0.1] bg-slate-800/70 hover:border-white/30 hover:bg-slate-700/70'
                  }`}>
                  <p className="text-sm font-black text-white leading-tight">{style.name}</p>
                  <p className="text-[9px] text-slate-500 mt-0.5 font-bold tracking-wider">{STYLE_EN[style.id] || ''}</p>
                  {visualStyleId === style.id && (
                    <div className="absolute top-1 right-1 w-3.5 h-3.5 bg-red-500 rounded-full flex items-center justify-center shadow-[0_0_6px_rgba(239,68,68,0.7)]">
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
              { id: 'image', label: '이미지 설정', icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="3" y="3" width="18" height="18" rx="2" strokeWidth={1.5}/><circle cx="8.5" cy="8.5" r="1.5" strokeWidth={1.5}/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 15l-5-5L5 21"/></svg> },
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
                <button type="button" onClick={() => onTabChange('auto')}
                  className={`flex-1 py-3 rounded-lg text-base font-bold transition-all ${activeTab === 'auto' ? 'bg-blue-600/20 border border-blue-500/50 text-blue-200 shadow-[0_0_10px_rgba(59,130,246,0.35)]' : 'text-white/40 hover:text-white/70 border border-transparent'}`}>
                  주제 자동생성
                </button>
                <button type="button" onClick={() => onTabChange('manual')}
                  className={`flex-1 py-3 rounded-lg text-base font-bold transition-all ${activeTab === 'manual' ? 'bg-blue-600/20 border border-blue-500/50 text-blue-200 shadow-[0_0_10px_rgba(59,130,246,0.35)]' : 'text-white/40 hover:text-white/70 border border-transparent'}`}>
                  수동 대본
                </button>
              </div>

              {/* 입력 영역 */}
              <form onSubmit={handleSubmit} className="flex flex-col gap-5 flex-1">
                {activeTab === 'auto' ? (
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
                      ];
                      const allSelected = suggestedTopics.length > 0 && selectedTopics.size === suggestedTopics.length;
                      return (
                        <div className="flex flex-col gap-2">
                          {/* 카테고리 버튼 5×2 */}
                          <div className="grid grid-cols-5 gap-2">
                            {CATEGORIES.map(cat => (
                              <button key={cat.id} type="button"
                                onClick={() => {
                                  setSelectedCategory(cat.id);
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

                          {/* 주제 소스 선택 + 추천 버튼 */}
                          {selectedCategory && (
                            <div className="flex flex-col gap-1.5">
                              {/* 소스 토글 */}
                              <div className="flex gap-1.5 bg-black/40 p-1 rounded-xl border border-white/[0.07]">
                                <button type="button" onClick={() => setTopicSource('google')}
                                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${topicSource === 'google' ? 'bg-blue-600/30 border border-blue-500/50 text-blue-200' : 'text-white/40 hover:text-white/70 border border-transparent'}`}>
                                  Google 트렌드
                                </button>
                                <button type="button" onClick={() => setTopicSource('youtube')}
                                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${topicSource === 'youtube' ? 'bg-red-600/30 border border-red-500/50 text-red-200' : 'text-white/40 hover:text-white/70 border border-transparent'}`}>
                                  YouTube 채널
                                </button>
                              </div>

                              {/* YouTube 설정 */}
                              {topicSource === 'youtube' && (
                                <div className="flex flex-col gap-1.5">
                                  {/* 기간 선택 */}
                                  <div className="flex gap-1">
                                    {([['3months','3개월'],['6months','6개월'],['1year','1년'],['all','전체']] as const).map(([val, label]) => (
                                      <button key={val} type="button" onClick={() => setYoutubeTimeRange(val)}
                                        className={`flex-1 py-1 rounded-lg text-[10px] font-bold transition-all border ${
                                          youtubeTimeRange === val
                                            ? 'bg-red-600/30 border-red-500/50 text-red-200'
                                            : 'border-white/10 text-white/40 hover:text-white/70'
                                        }`}>{label}</button>
                                    ))}
                                  </div>
                                  {youtubeApiKey && localStorage.getItem(CONFIG.STORAGE_KEYS.YOUTUBE_API_KEY) === youtubeApiKey ? (
                                    <div className="flex gap-2 items-center">
                                      <span className="flex-1 bg-slate-800 border border-emerald-600/50 rounded-lg px-3 py-1.5 text-emerald-400 text-xs">
                                        ✓ 저장됨 ({youtubeApiKey.slice(0, 6)}••••)
                                      </span>
                                      <button type="button" onClick={() => { setYoutubeApiKey(''); localStorage.removeItem(CONFIG.STORAGE_KEYS.YOUTUBE_API_KEY); }}
                                        className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg border border-white/10 transition-colors">변경</button>
                                    </div>
                                  ) : (
                                    <input type="text" value={youtubeApiKey}
                                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setYoutubeApiKey(e.target.value); localStorage.setItem(CONFIG.STORAGE_KEYS.YOUTUBE_API_KEY, e.target.value); }}
                                      placeholder="YouTube Data API 키"
                                      autoComplete="off"
                                      className="w-full bg-black/50 border border-red-500/20 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/25 focus:outline-none focus:border-red-400/50" />
                                  )}
                                  <input type="text" value={youtubeChannels}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setYoutubeChannels(e.target.value); localStorage.setItem('heaven_yt_channels', e.target.value); }}
                                    placeholder="채널 URL 쉼표 구분 (예: https://youtube.com/@mysterykr) — 비우면 키워드 검색"
                                    className="w-full bg-black/50 border border-red-500/20 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/25 focus:outline-none focus:border-red-400/50" />
                                </div>
                              )}

                              {/* 주제 추천 버튼 */}
                              <button type="button"
                                onClick={async () => {
                                  setSuggestedTopics([]);
                                  setSelectedTopics(new Set());
                                  setIsLoadingTopics(true);
                                  try {
                                    let result;
                                    if (topicSource === 'youtube') {
                                      const channelIds = youtubeChannels.split(',').map((s: string) => s.trim()).filter(Boolean);
                                      result = await findYouTubeTopics(selectedCategory, channelIds, youtubeTimeRange);
                                    } else {
                                      result = await findTrendingTopics(selectedCategory, []);
                                    }
                                    if (Array.isArray(result)) setSuggestedTopics(result);
                                  } catch (e: any) { alert(`주제 추천 실패: ${e?.message || e}`); }
                                  finally { setIsLoadingTopics(false); }
                                }}
                                disabled={isProcessing || isLoadingTopics}
                                className="w-full py-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 font-bold text-sm transition-all disabled:opacity-50">
                                {isLoadingTopics ? '주제 추천 중...' : suggestedTopics.length > 0 ? '다시 추천받기' : '주제 추천받기'}
                              </button>
                            </div>
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
                                      setIsSequentialRunning(true);
                                      const first = queue[0];
                                      setTopic(first);
                                      onGenerate(first, { characterImages: characterRefImages, styleImages: styleRefImages, characterStrength, styleStrength, characterDescription }, null, sceneCount, false, false, true);
                                    }}
                                    className="px-3 py-1 rounded-lg bg-green-500/20 border border-green-500/40 text-green-300 text-[10px] font-bold hover:bg-green-500/30 transition-all">
                                    {selectedTopics.size}개 순차 생성
                                  </button>
                                )}
                                {isSequentialRunning && (
                                  <span className="text-[10px] text-green-400 animate-pulse font-bold">
                                    순차 생성 중... ({sequentialQueueRef.current.length - sequentialIndexRef.current + 1}개 남음)
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
                                    setSelectedTopics(prev => {
                                      const next = new Set(prev);
                                      if (next.has(t.rank)) next.delete(t.rank); else next.add(t.rank);
                                      return next;
                                    });
                                    setTopic(t.topic);
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

                    {/* 글쓰기 지침 + 자동실행 토글 */}
                    <div className="flex items-center gap-2">
                      <button type="button"
                        onClick={() => setShowWritingGuide((v: boolean) => !v)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/50 hover:text-white/80 text-xs font-bold transition-colors">
                        ✍️ 글쓰기 지침 {showWritingGuide ? '▲' : '▼'}
                      </button>
                      <label className="flex items-center gap-2 ml-auto cursor-pointer select-none">
                        <span className="text-xs text-white/50 font-bold">전체 자동 실행</span>
                        <div onClick={() => setAutoRunMode((v: boolean) => !v)}
                          className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${autoRunMode ? 'bg-green-500' : 'bg-white/20'}`}>
                          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${autoRunMode ? 'left-5' : 'left-0.5'}`} />
                        </div>
                      </label>
                    </div>
                    {showWritingGuide && (
                      <textarea
                        value={writingGuide}
                        onChange={(e) => {
                          setWritingGuide(e.target.value);
                          localStorage.setItem('heaven_writing_guide', e.target.value);
                          if (selectedCategory) localStorage.setItem(`${CONFIG.STORAGE_KEYS.CATEGORY_GUIDE_PREFIX}${selectedCategory}`, e.target.value);
                        }}
                        placeholder={"AI 글쓰기 지침 (예: 반말 사용, 호기심을 자극하는 문체, 각 씬은 2문장 이내)"}
                        className="w-full bg-black/50 border border-violet-500/30 rounded-xl px-4 py-3 text-sm text-white placeholder-white/25 resize-none focus:outline-none focus:border-violet-400"
                        rows={3}
                      />
                    )}
                    {autoRunMode && (
                      <div className="text-xs text-green-400/70 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
                        ✅ 전체 자동 실행: 대본 생성 후 이미지+오디오까지 자동으로 진행됩니다
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-black/50 border border-blue-500/25 rounded-2xl overflow-hidden flex flex-col flex-1 min-h-0">
                    <textarea value={manualScript} onChange={(e) => onManualScriptChange(e.target.value)} disabled={isProcessing}
                      placeholder={"여기에 대본을 붙여넣거나 직접 작성하세요.\n\n예)\n나레이션 1: 옛날 옛적...\n나레이션 2: ..."}
                      className="flex-1 bg-transparent text-white p-6 focus:ring-0 focus:outline-none placeholder-white/20 resize-none text-base" />
                    <div className="px-6 pb-3 flex items-center justify-between border-t border-white/[0.07] pt-2">
                      <span className={`text-sm font-mono ${manualScript.length > 10000 ? 'text-amber-400' : manualScript.length > 3000 ? 'text-blue-400' : 'text-white/25'}`}>
                        {manualScript.length.toLocaleString()}자
                      </span>
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
                      <input type="number" min={1} max={60}
                        value={aspectRatio === '16:9' ? longformDuration : shortformDuration}
                        onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) { aspectRatio === '16:9' ? changeLongformDuration(v) : changeShortformDuration(v); }}}
                        className="w-16 bg-black/60 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white text-center focus:border-red-500 focus:outline-none" />
                      <span className="text-sm text-white/40">{aspectRatio === '16:9' ? '분' : '초'}</span>
                    </div>
                  </div>
                </div>

                {/* 참조 이미지 (캐릭터 + 화풍) */}
                <div className="grid grid-cols-2 gap-4">
                  {/* 캐릭터 */}
                  <div className="bg-white/[0.02] border border-blue-500/20 rounded-xl p-4 shadow-[0_0_8px_rgba(59,130,246,0.06)]">
                    <p className="text-base font-bold text-slate-200 mb-1">캐릭터 참조 <span className="text-xs text-slate-500 font-normal">최대 5개 가능</span></p>
                    <div className="flex flex-wrap gap-2 items-center">
                      {characterRefImages.map((img, i) => (
                        <div key={i} className="relative group w-12 h-10 rounded overflow-hidden border border-violet-500/50">
                          <img src={img} alt="" className="w-full h-full object-cover" />
                          <button type="button" onClick={() => { setCharacterRefImages((prev: string[]) => { const next = prev.filter((_: string, idx: number) => idx !== i); if (next.length === 0) { setCharacterDescription(''); } return next; }); }}
                            className="absolute inset-0 bg-red-500/70 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center text-xs font-bold">✕</button>
                        </div>
                      ))}
                      {characterRefImages.length < 5 && (
                        <button type="button" onClick={() => characterFileInputRef.current?.click()}
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
                  <div className="bg-white/[0.02] border border-blue-500/20 rounded-xl p-4 shadow-[0_0_8px_rgba(59,130,246,0.06)]">
                    <p className="text-base font-bold text-slate-200 mb-1">화풍 참조 <span className="text-xs text-slate-500 font-normal">최대 5개 가능</span></p>
                    <div className="flex flex-wrap gap-2 items-center">
                      {styleRefImages.map((img, i) => (
                        <div key={i} className="relative group w-12 h-10 rounded overflow-hidden border border-fuchsia-500/50">
                          <img src={img} alt="" className="w-full h-full object-cover" />
                          <button type="button" onClick={() => setStyleRefImages(prev => prev.filter((_, idx) => idx !== i))}
                            className="absolute inset-0 bg-red-500/70 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center text-xs font-bold">✕</button>
                        </div>
                      ))}
                      {styleRefImages.length < 5 && (
                        <button type="button" onClick={() => styleFileInputRef.current?.click()}
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

                {/* 생성 버튼 */}
                <div className="relative">
                  {/* 네온 바 */}
                  <div className="absolute -top-px left-8 right-8 h-px bg-gradient-to-r from-transparent via-red-500 to-transparent opacity-80" />
                  <button type="submit" disabled={isProcessing || (activeTab === 'auto' ? !canSubmitAuto : !canSubmitManual)}
                    className="w-full relative bg-red-500/60 hover:bg-red-500/75 disabled:opacity-60 text-white font-black py-6 rounded-2xl transition-all text-2xl tracking-wide border border-red-300/60 hover:border-red-200/80 shadow-[0_0_35px_rgba(239,68,68,0.5)] hover:shadow-[0_0_55px_rgba(239,68,68,0.7)] disabled:shadow-none">
                    {isProcessing ? '생성 중...' : activeTab === 'auto' ? '대본 생성 시작' : '스토리보드 생성'}
                  </button>
                  {/* 하단 네온 바 */}
                  <div className="absolute -bottom-px left-8 right-8 h-px bg-gradient-to-r from-transparent via-rose-400 to-transparent opacity-60" />
                </div>

                {/* 캐릭터 분석 버튼 (수동 대본 탭에서만) */}
                {activeTab === 'manual' && onCharacterAnalyze && (
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

                <button type="button" onClick={handleImagesOnly} disabled={isProcessing || (activeTab === 'auto' ? !canSubmitAuto : !canSubmitManual)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-blue-500/15 hover:bg-blue-500/25 disabled:opacity-60 text-white text-base font-bold transition-all border border-blue-500/50 hover:border-blue-400/70 shadow-[0_0_18px_rgba(59,130,246,0.25)] hover:shadow-[0_0_28px_rgba(59,130,246,0.4)] disabled:shadow-none">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="3" y="3" width="18" height="18" rx="2" strokeWidth={2}/><circle cx="8.5" cy="8.5" r="1.5" strokeWidth={2}/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 15l-5-5L5 21"/></svg>
                  이미지만 생성
                </button>
                <button type="button" onClick={handleAudioOnly} disabled={isProcessing || (activeTab === 'auto' ? !canSubmitAuto : !canSubmitManual)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-purple-500/15 hover:bg-purple-500/25 disabled:opacity-60 text-white text-base font-bold transition-all border border-purple-500/50 hover:border-purple-400/70 shadow-[0_0_18px_rgba(168,85,247,0.25)] hover:shadow-[0_0_28px_rgba(168,85,247,0.4)] disabled:shadow-none">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/></svg>
                  오디오만 생성
                </button>
              </form>
            </div>

          ) : (
            /* ── 설정 패널 ── */
            <div className="flex flex-col h-full">
              {/* 패널 헤더 */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.07] bg-black/30">
                <h3 className="font-black text-white text-sm tracking-wide uppercase">
                  {activePanel === 'visual' && '비주얼 스타일'}
                  {activePanel === 'image' && '이미지 설정'}
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
                    <div className="grid grid-cols-3 gap-3">
                      {VISUAL_STYLES.map(style => (
                        <button key={style.id} type="button" onClick={() => selectVisualStyle(style.id as VisualStyleId)}
                          className={`relative p-2 rounded-xl border transition-all ${visualStyleId === style.id ? 'border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.25)]' : 'border-white/[0.08] hover:border-white/20'}`}>
                          <div className={`w-full aspect-video rounded-lg bg-gradient-to-br ${style.bg} flex items-center justify-center overflow-hidden`}>
                            <span className="text-[10px] font-black text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)] text-center w-full block px-1 leading-snug">{style.name}</span>
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
                    {/* 이미지 모델 */}
                    <div>
                      <p className="text-sm font-bold text-slate-400 mb-2 uppercase tracking-wider">이미지 모델</p>
                      <div className="space-y-1.5">
                        {IMAGE_MODELS.map(m => (
                          <button key={m.id} type="button" onClick={() => selectImageModel(m.id)}
                            className={`w-full p-3 rounded-xl border text-left transition-all ${imageModelId === m.id ? 'bg-blue-600/20 border-blue-500 text-white' : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600'}`}>
                            <div className="flex justify-between items-center">
                              <span className="font-bold text-sm">{m.name}</span>
                              <div className="text-right">
                                <div className="text-green-400 text-xs font-bold">${m.pricePerImage.toFixed(3)}/장</div>
                                <div className="text-slate-500 text-[10px]">≈ {Math.round(m.pricePerImage * 1450)}원</div>
                              </div>
                            </div>
                            <div className="text-xs opacity-60 mt-0.5">{m.description}</div>
                          </button>
                        ))}
                        {/* 영상 모델 정보 */}
                        <div className="mt-3 pt-3 border-t border-slate-700">
                          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">영상 변환 모델</p>
                          <div className="p-3 rounded-xl bg-slate-800/50 border border-slate-700">
                            <div className="flex justify-between items-center">
                              <span className="font-bold text-sm text-slate-300">PixVerse v5.5</span>
                              <div className="text-right">
                                <div className="text-green-400 text-xs font-bold">$0.150/영상</div>
                                <div className="text-slate-500 text-[10px]">≈ 218원 (5초)</div>
                              </div>
                            </div>
                            <div className="text-xs text-slate-600 mt-0.5">fal.ai · 이미지→영상 변환</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 이미지 글씨 */}
                    <div className="p-3 rounded-xl border border-blue-500/60 shadow-[0_0_14px_rgba(59,130,246,0.3)]">
                      <p className="text-sm font-bold text-slate-400 mb-2 uppercase tracking-wider">이미지 글씨</p>
                      <div className="grid grid-cols-4 gap-1.5">
                        {([{ id: 'none', label: '없음' }, { id: 'english', label: '영어' }, { id: 'numbers', label: '숫자' }, { id: 'auto', label: '자동' }] as const).map(({ id, label }) => (
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
                  <div className="flex-1 flex flex-col min-h-0 gap-2">
                    {/* TTS 제공자 탭 */}
                    <div className="flex gap-2 shrink-0">
                      <button type="button" onClick={() => { setVoiceSubTab('google'); setVoiceSetting(CONFIG.STORAGE_KEYS.TTS_PROVIDER, 'google'); }}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border ${voiceSubTab === 'google' ? 'bg-teal-600/20 text-teal-200 border-teal-500/60' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 border-white/10'}`}>
                        Gemini TTS
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"/>
                      </button>
                      <button type="button" onClick={() => { setVoiceSubTab('azure'); setVoiceSetting(CONFIG.STORAGE_KEYS.TTS_PROVIDER, 'azure'); }}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border ${voiceSubTab === 'azure' ? 'bg-sky-600/20 text-sky-200 border-sky-500/60' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 border-white/10'}`}>
                        Azure TTS
                        <span className={`w-1.5 h-1.5 rounded-full ${azureApiKey ? 'bg-emerald-400' : 'bg-amber-400'}`}/>
                      </button>
                      <button type="button" onClick={() => { setVoiceSubTab('gcloud'); setVoiceSetting(CONFIG.STORAGE_KEYS.TTS_PROVIDER, 'gcloud'); }}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border ${voiceSubTab === 'gcloud' ? 'bg-blue-600/20 text-blue-200 border-blue-500/60' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 border-white/10'}`}>
                        Cloud TTS
                        <span className={`w-1.5 h-1.5 rounded-full ${gcloudApiKey ? 'bg-emerald-400' : 'bg-amber-400'}`}/>
                      </button>
                      <button type="button" onClick={() => { setVoiceSubTab('elevenlabs'); setVoiceSetting(CONFIG.STORAGE_KEYS.TTS_PROVIDER, 'elevenlabs'); }}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border ${voiceSubTab === 'elevenlabs' ? 'bg-purple-600/20 text-purple-200 border-purple-500/60' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 border-white/10'}`}>
                        ElevenLabs
                        <span className={`w-1.5 h-1.5 rounded-full ${elApiKey ? 'bg-emerald-400' : 'bg-amber-400'}`}/>
                      </button>
                    </div>

                    {voiceSubTab === 'elevenlabs' && (
                      <div className="flex-1 flex flex-col min-h-0 gap-2">
                        {!elApiKey && <p className="shrink-0 text-sm text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">API 키 없음 → Google TTS 사용</p>}
                            <div className="flex items-center gap-2 shrink-0">
                              {([null, 'male', 'female'] as const).map((g) => (
                                <button key={String(g)} type="button" onClick={() => setGenderFilter(g)}
                                  className={`px-3 py-1 rounded-lg text-sm font-bold border ${genderFilter === g ? (g === 'male' ? 'bg-blue-600/20 text-blue-200 border-blue-500/60 shadow-[0_0_8px_rgba(59,130,246,0.3)]' : g === 'female' ? 'bg-pink-600/20 text-pink-200 border-pink-500/60 shadow-[0_0_8px_rgba(236,72,153,0.3)]' : 'bg-slate-600/20 text-slate-200 border-slate-400/60') : 'bg-slate-800 text-slate-400 border-blue-500/30'}`}>
                                  {g === null ? '전체' : g === 'male' ? '남성' : '여성'}
                                </button>
                              ))}
                              <button type="button" onClick={() => loadVoices()} disabled={isLoadingVoices}
                                className="ml-auto text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 px-3 py-1 rounded-lg font-bold">
                                {isLoadingVoices ? '...' : '불러오기'}
                              </button>
                            </div>
                            {/* 성우 목록 — 전체 표시 */}
                            <div className="flex-1 min-h-[100px] overflow-y-auto bg-black/40 border border-blue-500/50 rounded-xl shadow-[0_0_12px_rgba(59,130,246,0.2)]">
                              <button type="button" onClick={() => { setElVoiceId(''); removeVoiceSetting(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID); }}
                                className={`w-full px-4 py-2.5 text-left text-sm font-bold text-slate-300 hover:bg-white/[0.05] border-b border-white/[0.07] ${!elVoiceId ? 'bg-purple-600/20 text-white' : ''}`}>
                                기본값 (Adam)
                              </button>
                              {filteredDefaultVoices.map(voice => (
                                <div key={voice.id} className={`flex items-center gap-2 px-3 py-2 border-b border-white/[0.05] hover:bg-white/[0.05] ${elVoiceId === voice.id ? 'bg-purple-600/20' : ''}`}>
                                  <button type="button" onClick={(e) => { e.stopPropagation(); playElevenLabsPreview(voice.id, voice.name); }}
                                    className={`w-7 h-7 flex-shrink-0 rounded-full flex items-center justify-center ${playingVoiceId === voice.id ? 'bg-purple-500 text-white animate-pulse' : 'bg-white/[0.08] text-slate-400 hover:bg-purple-600 hover:text-white'}`}>
                                    {playingVoiceId === voice.id ? <PauseIcon /> : <PlayIcon />}
                                  </button>
                                  <button type="button" onClick={() => { setElVoiceId(voice.id); setVoiceSetting(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID, voice.id); }} className="flex-1 text-left">
                                    <div className="text-sm text-white font-bold">{voice.name}</div>
                                    <div className="text-xs text-slate-500">{voice.description}</div>
                                  </button>
                                </div>
                              ))}
                              {filteredApiVoices.map(voice => (
                                <div key={voice.voice_id} className={`flex items-center gap-2 px-3 py-2 border-b border-white/[0.05] hover:bg-white/[0.05] ${elVoiceId === voice.voice_id ? 'bg-purple-600/20' : ''}`}>
                                  <button type="button" onClick={(e) => { e.stopPropagation(); playElevenLabsPreview(voice.voice_id, voice.name); }}
                                    className={`w-7 h-7 flex-shrink-0 rounded-full flex items-center justify-center ${playingVoiceId === voice.voice_id ? 'bg-purple-500 text-white animate-pulse' : 'bg-white/[0.08] text-slate-400 hover:bg-purple-600 hover:text-white'}`}>
                                    {playingVoiceId === voice.voice_id ? <PauseIcon /> : <PlayIcon />}
                                  </button>
                                  <button type="button" onClick={() => selectVoice(voice)} className="flex-1 text-left">
                                    <div className="text-sm text-white font-bold">{voice.name}</div>
                                    <div className="text-xs text-slate-500">{voice.category}</div>
                                  </button>
                                </div>
                              ))}
                            </div>
                            {/* 말하기 속도 */}
                            <div className="shrink-0 p-3 rounded-xl border border-blue-500/40 shadow-[0_0_10px_rgba(59,130,246,0.15)]">
                              <p className="text-sm font-bold text-slate-400 mb-2 uppercase tracking-wider">말하기 속도</p>
                              <div className="flex gap-2">
                                {[['0.7', '느림'], ['1.0', '보통'], ['1.3', '빠름']].map(([val, label]) => (
                                  <button key={val} type="button" onClick={() => selectVoiceSpeed(val)}
                                    className={`flex-1 py-2 rounded-xl text-sm font-bold border ${voiceSpeed === val ? 'bg-purple-600/20 text-purple-200 border-purple-500/60 shadow-[0_0_10px_rgba(168,85,247,0.4)]' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 border-purple-500/30'}`}>
                                    {label}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {/* 톤 프리셋 - 안정성(stability) 제어 */}
                            <div className="shrink-0 p-3 rounded-xl border border-blue-500/40 shadow-[0_0_10px_rgba(59,130,246,0.15)]">
                              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">톤 <span className="text-slate-600 normal-case font-normal">(분위기와 동시 선택 가능)</span></p>
                              <div className="grid grid-cols-4 gap-1.5">
                                {([
                                  { id: '낮은목소리', label: '낮은 톤', stability: 92 },
                                  { id: '차분한', label: '차분한', stability: 80 },
                                  { id: '밝은목소리', label: '밝은 톤', stability: 50 },
                                  { id: '활기찬', label: '활기찬', stability: 20 },
                                ] as { id: string; label: string; stability: number }[]).map(m => (
                                  <button key={m.id} type="button" onClick={() => {
                                    const newTone = voiceTone === m.id ? '' : m.id;
                                    setVoiceTone(newTone);
                                    if (newTone) {
                                      setVoiceStability(m.stability);
                                      setVoiceSetting('heaven_voice_tone', m.id);
                                      setVoiceSetting(CONFIG.STORAGE_KEYS.VOICE_STABILITY, String(m.stability));
                                    } else {
                                      removeVoiceSetting('heaven_voice_tone');
                                    }
                                  }}
                                    className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-colors border ${voiceTone === m.id ? 'bg-purple-600/20 text-purple-200 border-purple-500/60 shadow-[0_0_10px_rgba(168,85,247,0.4)]' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border-white/10'}`}>
                                    {m.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* 분위기 프리셋 - 스타일(style) 제어 */}
                            <div className="shrink-0 p-3 rounded-xl border border-blue-500/40 shadow-[0_0_10px_rgba(59,130,246,0.15)]">
                              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">분위기 <span className="text-slate-600 normal-case font-normal">(톤과 동시 선택 가능)</span></p>
                              <div className="grid grid-cols-2 gap-1.5">
                                {([
                                  { id: '친근하게', style: 55 },
                                  { id: '따뜻하게', style: 35 },
                                  { id: '뉴스형식', style: 0, stabilityOverride: 95 },
                                  { id: '부드럽게', style: 20 },
                                  { id: '부드럽고강하게', label: '부드럽고 강하게', style: 60 },
                                  { id: '강하고따뜻하게', label: '강하고 따뜻하게', style: 75 },
                                  { id: '심각하게', style: 3, stabilityOverride: 88 },
                                  { id: '울면서', style: 90 },
                                ] as { id: string; label?: string; style: number; stabilityOverride?: number }[]).map(m => (
                                  <button key={m.id} type="button" onClick={() => {
                                    const newMood = voiceMoodPreset === m.id ? '' : m.id;
                                    setVoiceMoodPreset(newMood);
                                    if (newMood) {
                                      setVoiceStyle(m.style);
                                      setVoiceSetting('heaven_voice_mood', m.id);
                                      setVoiceSetting(CONFIG.STORAGE_KEYS.VOICE_STYLE, String(m.style));
                                      if (m.stabilityOverride !== undefined) {
                                        setVoiceStability(m.stabilityOverride);
                                        setVoiceTone('');
                                        setVoiceSetting(CONFIG.STORAGE_KEYS.VOICE_STABILITY, String(m.stabilityOverride));
                                        removeVoiceSetting('heaven_voice_tone');
                                      }
                                    } else {
                                      removeVoiceSetting('heaven_voice_mood');
                                    }
                                  }}
                                    className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-colors border ${voiceMoodPreset === m.id ? 'bg-purple-600/20 text-purple-200 border-purple-500/60 shadow-[0_0_10px_rgba(168,85,247,0.4)]' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border-white/10'}`}>
                                    {m.label || m.id}
                                  </button>
                                ))}
                              </div>
                              {(voiceTone || voiceMoodPreset) && (
                                <button type="button" onClick={() => {
                                  setVoiceTone(''); setVoiceMoodPreset('');
                                  removeVoiceSetting('heaven_voice_tone');
                                  removeVoiceSetting('heaven_voice_mood');
                                }}
                                  className="mt-1 text-xs text-slate-500 hover:text-slate-300">전체 초기화</button>
                              )}
                            </div>
                            <button type="button" onClick={saveElSettings} className="shrink-0 w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 rounded-xl text-sm">설정 저장</button>
                      </div>
                    )}

                    {voiceSubTab === 'azure' && (
                      <div className="flex-1 flex flex-col min-h-0 gap-3">
                        {/* API 키 */}
                        <div className="shrink-0 space-y-1.5">
                          <label className="text-xs text-slate-400 font-bold uppercase tracking-wider">Azure Speech API Key</label>
                          {azureApiKey && localStorage.getItem(CONFIG.STORAGE_KEYS.AZURE_TTS_API_KEY) === azureApiKey ? (
                            <div className="flex gap-2 items-center">
                              <span className="flex-1 bg-slate-800 border border-emerald-600/50 rounded-xl px-3 py-2 text-emerald-400 text-sm">✓ 저장됨 ({azureApiKey.slice(0,6)}••••)</span>
                              <button type="button" onClick={() => { setAzureApiKey(''); localStorage.removeItem(CONFIG.STORAGE_KEYS.AZURE_TTS_API_KEY); }}
                                className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-bold">변경</button>
                            </div>
                          ) : (
                            <div className="flex gap-2">
                              <input type="password" value={azureApiKey} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAzureApiKey(e.target.value)}
                                placeholder="Azure API 키"
                                className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500"/>
                              <button type="button" onClick={() => { localStorage.setItem(CONFIG.STORAGE_KEYS.AZURE_TTS_API_KEY, azureApiKey); }}
                                className="px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold">저장</button>
                            </div>
                          )}
                        </div>
                        {/* 지역 */}
                        <div className="shrink-0 space-y-1.5">
                          <label className="text-xs text-slate-400 font-bold uppercase tracking-wider">지역 (Region)</label>
                          {azureRegion && getVoiceSetting(CONFIG.STORAGE_KEYS.AZURE_TTS_REGION) === azureRegion ? (
                            <div className="flex gap-2 items-center">
                              <span className="flex-1 bg-slate-800 border border-emerald-600/50 rounded-xl px-3 py-2 text-emerald-400 text-sm">✓ {azureRegion}</span>
                              <button type="button" onClick={() => { setAzureRegion(''); removeVoiceSetting(CONFIG.STORAGE_KEYS.AZURE_TTS_REGION); }}
                                className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-bold">변경</button>
                            </div>
                          ) : (
                            <div className="flex gap-2">
                              <input type="text" value={azureRegion} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAzureRegion(e.target.value)}
                                placeholder="koreacentral / japaneast"
                                className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500"/>
                              <button type="button" onClick={() => { setVoiceSetting(CONFIG.STORAGE_KEYS.AZURE_TTS_REGION, azureRegion); }}
                                className="px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold">저장</button>
                            </div>
                          )}
                        </div>
                        {/* 성우 선택 - Gemini 스타일 리스트 */}
                        <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-sky-500/40 shadow-[0_0_10px_rgba(14,165,233,0.12)]">
                          {([
                            { id: 'ko-KR-SunHiNeural', label: 'SunHi', desc: '여성 · 기본 추천', gender: 'female' },
                            { id: 'ko-KR-InJoonNeural', label: 'InJoon', desc: '남성 · 기본 추천', gender: 'male' },
                            { id: 'ko-KR-JiMinNeural', label: 'JiMin', desc: '여성 · 활기찬', gender: 'female' },
                            { id: 'ko-KR-SeoHyeonNeural', label: 'SeoHyeon', desc: '여성 · 차분한', gender: 'female' },
                            { id: 'ko-KR-YuJinNeural', label: 'YuJin', desc: '여성', gender: 'female' },
                            { id: 'ko-KR-BongJinNeural', label: 'BongJin', desc: '남성', gender: 'male' },
                            { id: 'ko-KR-GookMinNeural', label: 'GookMin', desc: '남성', gender: 'male' },
                            { id: 'ko-KR-SoonBokNeural', label: 'SoonBok', desc: '여성 · 노인', gender: 'female' },
                            { id: 'ko-KR-HyunsuMultilingualNeural', label: 'Hyunsu', desc: '남성 · 다국어', gender: 'male' },
                          ] as { id: string; label: string; desc: string; gender: string }[]).map(voice => (
                            <div key={voice.id} className={`flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.05] hover:bg-white/[0.05] transition-colors ${azureVoice === voice.id ? 'bg-sky-600/20' : ''}`}>
                              <button type="button" onClick={async (e) => {
                                e.stopPropagation();
                                if (!azureApiKey || !azureRegion) return;
                                setPlayingAzureVoice(voice.id);
                                try {
                                  const { previewAzureTTS } = await import('../services/azureTTSService');
                                  const b64 = await previewAzureTTS('안녕하세요. 테스트 목소리입니다.', voice.id);
                                  if (b64) new Audio(`data:audio/mp3;base64,${b64}`).play();
                                } catch {}
                                setPlayingAzureVoice(null);
                              }}
                                className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs ${playingAzureVoice === voice.id ? 'bg-sky-500 text-white animate-pulse' : 'bg-slate-700 text-slate-400 hover:bg-sky-600 hover:text-white'}`}>
                                {playingAzureVoice === voice.id ? '■' : '▶'}
                              </button>
                              <button type="button" onClick={() => { setAzureVoice(voice.id); setVoiceSetting(CONFIG.STORAGE_KEYS.AZURE_TTS_VOICE, voice.id); }} className="flex-1 text-left">
                                <div className="text-sm text-white font-bold">{voice.label}</div>
                                <div className="text-xs text-slate-500">{voice.desc}</div>
                              </button>
                              {voice.gender === 'male'
                                ? <span className="text-[10px] text-blue-400 font-bold">남</span>
                                : <span className="text-[10px] text-pink-400 font-bold">여</span>}
                            </div>
                          ))}
                        </div>
                        {/* 말하기 속도 */}
                        <div className="shrink-0 p-3 rounded-xl border border-sky-500/40 shadow-[0_0_10px_rgba(14,165,233,0.15)]">
                          <p className="text-sm font-bold text-slate-400 mb-2 uppercase tracking-wider">말하기 속도</p>
                          <div className="flex gap-2">
                            {[['0.7', '느림'], ['1.0', '보통'], ['1.3', '빠름']].map(([val, label]) => (
                              <button key={val} type="button" onClick={() => selectVoiceSpeed(val)}
                                className={`flex-1 py-2 rounded-xl text-sm font-bold border ${voiceSpeed === val ? 'bg-sky-600/20 text-sky-200 border-sky-500/60 shadow-[0_0_10px_rgba(14,165,233,0.4)]' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 border-sky-500/30'}`}>
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        {/* 톤 */}
                        <div className="shrink-0 p-3 rounded-xl border border-sky-500/40 shadow-[0_0_10px_rgba(14,165,233,0.15)]">
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">톤 <span className="text-slate-600 normal-case font-normal">(분위기와 동시 선택 가능)</span></p>
                          <div className="grid grid-cols-4 gap-1.5">
                            {([
                              { id: '낮은톤', label: '낮은 톤', instruction: '(낮고 차분한 목소리로) ' },
                              { id: '차분한', label: '차분한', instruction: '(차분하고 안정적으로) ' },
                              { id: '밝은톤', label: '밝은 톤', instruction: '(밝고 생동감 있게) ' },
                              { id: '활기찬', label: '활기찬', instruction: '(활기차고 열정적으로) ' },
                            ] as { id: string; label: string; instruction: string }[]).map(m => (
                              <button key={m.id} type="button" onClick={() => {
                                const newTone = googleTtsTone === m.id ? '' : m.id;
                                setGoogleTtsTone(newTone);
                                setVoiceSetting('heaven_google_tts_tone_id', newTone);
                                setVoiceSetting('heaven_google_tts_tone', newTone ? m.instruction : '');
                              }}
                                className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-colors border ${googleTtsTone === m.id ? 'bg-sky-600/20 text-sky-200 border-sky-500/60 shadow-[0_0_10px_rgba(14,165,233,0.4)]' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border-white/10'}`}>
                                {m.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        {/* 분위기 */}
                        <div className="shrink-0 p-3 rounded-xl border border-sky-500/40 shadow-[0_0_10px_rgba(14,165,233,0.15)]">
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">분위기 <span className="text-slate-600 normal-case font-normal">(톤과 동시 선택 가능)</span></p>
                          <div className="grid grid-cols-2 gap-1.5">
                            {([
                              { id: '친근하게', instruction: '(친근하고 따뜻하게) ' },
                              { id: '따뜻하게', instruction: '(따뜻하게 공감하며) ' },
                              { id: '뉴스형식', instruction: '(뉴스 앵커처럼 명확하게) ' },
                              { id: '부드럽게', instruction: '(부드럽고 온화하게) ' },
                              { id: '부드럽고강하게', label: '부드럽고 강하게', instruction: '(부드럽지만 확신 있게) ' },
                              { id: '강하고따뜻하게', label: '강하고 따뜻하게', instruction: '(강하고 열정적으로 따뜻하게) ' },
                              { id: '심각하게', instruction: '(심각하고 진지하게) ' },
                              { id: '울면서', instruction: '(슬프고 울먹이는 감정으로) ' },
                            ] as { id: string; label?: string; instruction: string }[]).map(m => (
                              <button key={m.id} type="button" onClick={() => {
                                const newMood = googleTtsMood === m.id ? '' : m.id;
                                setGoogleTtsMood(newMood);
                                setVoiceSetting('heaven_google_tts_mood_id', newMood);
                                setVoiceSetting('heaven_google_tts_mood', newMood ? m.instruction : '');
                              }}
                                className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-colors border ${googleTtsMood === m.id ? 'bg-sky-600/20 text-sky-200 border-sky-500/60 shadow-[0_0_10px_rgba(14,165,233,0.4)]' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border-white/10'}`}>
                                {m.label || m.id}
                              </button>
                            ))}
                          </div>
                          {(googleTtsTone || googleTtsMood) && (
                            <button type="button" onClick={() => {
                              setGoogleTtsTone(''); setGoogleTtsMood('');
                              setVoiceSetting('heaven_google_tts_tone_id', '');
                              setVoiceSetting('heaven_google_tts_tone', '');
                              setVoiceSetting('heaven_google_tts_mood_id', '');
                              setVoiceSetting('heaven_google_tts_mood', '');
                            }} className="mt-1 text-xs text-slate-500 hover:text-slate-300">전체 초기화</button>
                          )}
                        </div>
                        <p className="shrink-0 text-[10px] text-slate-500 bg-slate-800/50 rounded-xl p-2">
                          월 500,000자 무료 · 이후 $16/100만자
                        </p>
                      </div>
                    )}

                    {voiceSubTab === 'gcloud' && (
                      <div className="flex-1 flex flex-col min-h-0 gap-3">
                        {/* API 키 입력 */}
                        <div className="shrink-0 space-y-1.5">
                          <label className="text-xs text-slate-400 font-bold uppercase tracking-wider">Google Cloud TTS API Key</label>
                          {gcloudApiKey && localStorage.getItem(CONFIG.STORAGE_KEYS.GCLOUD_TTS_API_KEY) === gcloudApiKey ? (
                            <div className="flex gap-2 items-center">
                              <span className="flex-1 bg-slate-800 border border-emerald-600/50 rounded-xl px-3 py-2 text-emerald-400 text-sm">
                                ✓ 저장됨 ({gcloudApiKey.slice(0, 6)}••••)
                              </span>
                              <button type="button"
                                onClick={() => { setGcloudApiKey(''); localStorage.removeItem(CONFIG.STORAGE_KEYS.GCLOUD_TTS_API_KEY); }}
                                className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-bold">
                                변경
                              </button>
                            </div>
                          ) : (
                            <div className="flex gap-2">
                              <input
                                type="password"
                                value={gcloudApiKey}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGcloudApiKey(e.target.value)}
                                placeholder="AIza..."
                                className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                              />
                              <button type="button"
                                onClick={() => { localStorage.setItem(CONFIG.STORAGE_KEYS.GCLOUD_TTS_API_KEY, gcloudApiKey); setGcloudApiKey(gcloudApiKey); }}
                                className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold">
                                저장
                              </button>
                            </div>
                          )}
                        </div>

                        {/* 성우 선택 - Gemini 스타일 리스트 */}
                        <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-blue-500/40 shadow-[0_0_10px_rgba(59,130,246,0.12)]">
                          {([
                            { id: 'ko-KR-Neural2-A', label: 'Neural2-A', desc: 'Neural2 · 고품질', gender: 'female' },
                            { id: 'ko-KR-Neural2-B', label: 'Neural2-B', desc: 'Neural2 · 고품질', gender: 'male' },
                            { id: 'ko-KR-Neural2-C', label: 'Neural2-C', desc: 'Neural2 · 고품질', gender: 'female' },
                            { id: 'ko-KR-Neural2-D', label: 'Neural2-D', desc: 'Neural2 · 고품질', gender: 'male' },
                            { id: 'ko-KR-Wavenet-A', label: 'Wavenet-A', desc: 'Wavenet · 저렴', gender: 'female' },
                            { id: 'ko-KR-Wavenet-B', label: 'Wavenet-B', desc: 'Wavenet · 저렴', gender: 'male' },
                            { id: 'ko-KR-Wavenet-C', label: 'Wavenet-C', desc: 'Wavenet · 저렴', gender: 'male' },
                            { id: 'ko-KR-Wavenet-D', label: 'Wavenet-D', desc: 'Wavenet · 저렴', gender: 'female' },
                          ] as { id: string; label: string; desc: string; gender: string }[]).map(voice => (
                            <div key={voice.id} className={`flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.05] hover:bg-white/[0.05] transition-colors ${gcloudVoice === voice.id ? 'bg-blue-600/20' : ''}`}>
                              <button type="button" onClick={async (e) => {
                                e.stopPropagation();
                                if (!gcloudApiKey) return;
                                setPlayingGcloudVoice(voice.id);
                                try {
                                  const { previewGCloudTTS } = await import('../services/googleCloudTTSService');
                                  const b64 = await previewGCloudTTS('안녕하세요. 테스트 목소리입니다.', voice.id);
                                  if (b64) new Audio(`data:audio/mp3;base64,${b64}`).play();
                                } catch {}
                                setPlayingGcloudVoice(null);
                              }}
                                className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs ${playingGcloudVoice === voice.id ? 'bg-blue-500 text-white animate-pulse' : 'bg-slate-700 text-slate-400 hover:bg-blue-600 hover:text-white'}`}>
                                {playingGcloudVoice === voice.id ? '■' : '▶'}
                              </button>
                              <button type="button" onClick={() => { setGcloudVoice(voice.id); setVoiceSetting(CONFIG.STORAGE_KEYS.GCLOUD_TTS_VOICE, voice.id); }} className="flex-1 text-left">
                                <div className="text-sm text-white font-bold">{voice.label}</div>
                                <div className="text-xs text-slate-500">{voice.desc}</div>
                              </button>
                              {voice.gender === 'male'
                                ? <span className="text-[10px] text-blue-400 font-bold">남</span>
                                : <span className="text-[10px] text-pink-400 font-bold">여</span>}
                            </div>
                          ))}
                        </div>
                        {/* 말하기 속도 */}
                        <div className="shrink-0 p-3 rounded-xl border border-blue-500/40 shadow-[0_0_10px_rgba(59,130,246,0.15)]">
                          <p className="text-sm font-bold text-slate-400 mb-2 uppercase tracking-wider">말하기 속도</p>
                          <div className="flex gap-2">
                            {[['0.7', '느림'], ['1.0', '보통'], ['1.3', '빠름']].map(([val, label]) => (
                              <button key={val} type="button" onClick={() => selectVoiceSpeed(val)}
                                className={`flex-1 py-2 rounded-xl text-sm font-bold border ${voiceSpeed === val ? 'bg-blue-600/20 text-blue-200 border-blue-500/60 shadow-[0_0_10px_rgba(59,130,246,0.4)]' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 border-blue-500/30'}`}>
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        {/* 톤 */}
                        <div className="shrink-0 p-3 rounded-xl border border-blue-500/40 shadow-[0_0_10px_rgba(59,130,246,0.15)]">
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">톤 <span className="text-slate-600 normal-case font-normal">(분위기와 동시 선택 가능)</span></p>
                          <div className="grid grid-cols-4 gap-1.5">
                            {([
                              { id: '낮은톤', label: '낮은 톤', instruction: '(낮고 차분한 목소리로) ' },
                              { id: '차분한', label: '차분한', instruction: '(차분하고 안정적으로) ' },
                              { id: '밝은톤', label: '밝은 톤', instruction: '(밝고 생동감 있게) ' },
                              { id: '활기찬', label: '활기찬', instruction: '(활기차고 열정적으로) ' },
                            ] as { id: string; label: string; instruction: string }[]).map(m => (
                              <button key={m.id} type="button" onClick={() => {
                                const newTone = gcloudTone === m.id ? '' : m.id;
                                setGcloudTone(newTone);
                                setVoiceSetting('heaven_gcloud_tone_id', newTone);
                                setVoiceSetting('heaven_gcloud_tone', newTone ? m.instruction : '');
                              }}
                                className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-colors border ${gcloudTone === m.id ? 'bg-blue-600/20 text-blue-200 border-blue-500/60 shadow-[0_0_10px_rgba(59,130,246,0.4)]' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border-blue-500/30'}`}>
                                {m.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        {/* 분위기 */}
                        <div className="shrink-0 p-3 rounded-xl border border-blue-500/40 shadow-[0_0_10px_rgba(59,130,246,0.15)]">
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">분위기 <span className="text-slate-600 normal-case font-normal">(톤과 동시 선택 가능)</span></p>
                          <div className="grid grid-cols-2 gap-1.5">
                            {([
                              { id: '친근하게', instruction: '(친근하고 따뜻하게) ' },
                              { id: '따뜻하게', instruction: '(따뜻하게 공감하며) ' },
                              { id: '뉴스형식', instruction: '(뉴스 앵커처럼 명확하게) ' },
                              { id: '부드럽게', instruction: '(부드럽고 온화하게) ' },
                              { id: '부드럽고강하게', label: '부드럽고 강하게', instruction: '(부드럽지만 확신 있게) ' },
                              { id: '강하고따뜻하게', label: '강하고 따뜻하게', instruction: '(강하고 열정적으로 따뜻하게) ' },
                              { id: '심각하게', instruction: '(심각하고 진지하게) ' },
                              { id: '울면서', instruction: '(슬프고 울먹이는 감정으로) ' },
                            ] as { id: string; label?: string; instruction: string }[]).map(m => (
                              <button key={m.id} type="button" onClick={() => {
                                const newMood = gcloudMood === m.id ? '' : m.id;
                                setGcloudMood(newMood);
                                setVoiceSetting('heaven_gcloud_mood_id', newMood);
                                setVoiceSetting('heaven_gcloud_mood', newMood ? m.instruction : '');
                              }}
                                className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-colors border ${gcloudMood === m.id ? 'bg-blue-600/20 text-blue-200 border-blue-500/60 shadow-[0_0_10px_rgba(59,130,246,0.4)]' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border-blue-500/30'}`}>
                                {m.label || m.id}
                              </button>
                            ))}
                          </div>
                          {(gcloudTone || gcloudMood) && (
                            <button type="button" onClick={() => {
                              setGcloudTone(''); setGcloudMood('');
                              removeVoiceSetting('heaven_gcloud_tone_id');
                              removeVoiceSetting('heaven_gcloud_mood_id');
                              removeVoiceSetting('heaven_gcloud_tone');
                              removeVoiceSetting('heaven_gcloud_mood');
                            }}
                              className="mt-1 text-xs text-slate-500 hover:text-slate-300">전체 초기화</button>
                          )}
                        </div>
                      </div>
                    )}

                    {voiceSubTab === 'google' && (
                      <div className="flex-1 flex flex-col min-h-0 gap-2">
                        <div className="flex gap-2 shrink-0">
                          {([null, 'male', 'female'] as const).map(g => (
                            <button key={String(g)} type="button" onClick={() => setGeminiTtsGenderFilter(g)}
                              className={`px-3 py-1 rounded-lg text-sm font-bold border ${geminiTtsGenderFilter === g ? (g === 'male' ? 'bg-blue-600/20 text-blue-200 border-blue-500/60 shadow-[0_0_8px_rgba(59,130,246,0.3)]' : g === 'female' ? 'bg-pink-600/20 text-pink-200 border-pink-500/60 shadow-[0_0_8px_rgba(236,72,153,0.3)]' : 'bg-teal-600/20 text-teal-200 border-teal-500/60 shadow-[0_0_8px_rgba(20,184,166,0.3)]') : 'bg-slate-800 text-slate-400 border-blue-500/30'}`}>
                              {g === null ? '전체' : g === 'male' ? '남성' : '여성'}
                            </button>
                          ))}
                        </div>
                        {/* 성우 목록 */}
                        <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-blue-500/40 shadow-[0_0_10px_rgba(59,130,246,0.12)]">
                        <div className="grid grid-cols-2 gap-1.5 p-3">
                          {GEMINI_TTS_VOICES.filter(v => !geminiTtsGenderFilter || v.gender === geminiTtsGenderFilter).map(voice => (
                            <div key={voice.id} className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition-all ${geminiTtsVoice === voice.id ? 'border-teal-500 bg-teal-500/10 shadow-[0_0_8px_rgba(20,184,166,0.3)]' : 'border-slate-700/50 hover:border-teal-500/40'}`}
                              onClick={() => { setGeminiTtsVoice(voice.id as GeminiTtsVoiceId); setVoiceSetting(CONFIG.STORAGE_KEYS.GEMINI_TTS_VOICE, voice.id); }}>
                              <button type="button" onClick={(e) => { e.stopPropagation(); playGeminiTtsPreview(voice.id); }}
                                className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center ${playingGeminiVoiceId === voice.id ? 'bg-teal-500 text-white animate-pulse' : 'bg-slate-700 text-slate-400 hover:bg-teal-600 hover:text-white'}`}>
                                {playingGeminiVoiceId === voice.id ? <PauseIcon /> : <PlayIcon />}
                              </button>
                              <div>
                                <div className="text-xs font-bold text-white">{voice.name}</div>
                                <div className="text-[10px] text-slate-500">{voice.gender === 'male' ? '남성' : '여성'}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                        </div>{/* end voice list scroll wrapper */}
                        {/* 말하기 속도 */}
                        <div className="shrink-0 p-3 rounded-xl border border-teal-500/40 shadow-[0_0_10px_rgba(20,184,166,0.15)]">
                          <p className="text-sm font-bold text-slate-400 mb-2 uppercase tracking-wider">말하기 속도</p>
                          <div className="flex gap-2">
                            {[['0.7', '느림'], ['1.0', '보통'], ['1.3', '빠름']].map(([val, label]) => (
                              <button key={val} type="button" onClick={() => selectVoiceSpeed(val)}
                                className={`flex-1 py-2 rounded-xl text-sm font-bold border ${voiceSpeed === val ? 'bg-teal-600/20 text-teal-200 border-teal-500/60 shadow-[0_0_10px_rgba(20,184,166,0.4)]' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 border-teal-500/30'}`}>
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        {/* 구글 TTS 톤 - 텍스트 지시로 감정 제어 */}
                        <div className="shrink-0 p-3 rounded-xl border border-blue-500/60 shadow-[0_0_14px_rgba(59,130,246,0.3)]">
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">톤 <span className="text-slate-600 normal-case font-normal">(분위기와 동시 선택 가능)</span></p>
                          <div className="grid grid-cols-4 gap-1.5">
                            {([
                              { id: '낮은톤', label: '낮은 톤', instruction: '(낮고 차분한 목소리로) ' },
                              { id: '차분한', label: '차분한', instruction: '(차분하고 안정적으로) ' },
                              { id: '밝은톤', label: '밝은 톤', instruction: '(밝고 생동감 있게) ' },
                              { id: '활기찬', label: '활기찬', instruction: '(활기차고 열정적으로) ' },
                            ] as { id: string; label: string; instruction: string }[]).map(m => (
                              <button key={m.id} type="button" onClick={() => {
                                const newTone = googleTtsTone === m.id ? '' : m.id;
                                setGoogleTtsTone(newTone);
                                setVoiceSetting('heaven_google_tts_tone_id', newTone);
                                setVoiceSetting('heaven_google_tts_tone', newTone ? m.instruction : '');
                              }}
                                className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-colors border ${googleTtsTone === m.id ? 'bg-teal-600/20 text-teal-200 border-teal-500/60 shadow-[0_0_10px_rgba(20,184,166,0.4)]' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border-blue-500/30'}`}>
                                {m.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        {/* 구글 TTS 분위기 - 텍스트 지시 방식 */}
                        <div className="shrink-0 p-3 rounded-xl border border-blue-500/60 shadow-[0_0_14px_rgba(59,130,246,0.3)]">
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">분위기 <span className="text-slate-600 normal-case font-normal">(톤과 동시 선택 가능)</span></p>
                          <div className="grid grid-cols-2 gap-1.5">
                            {([
                              { id: '친근하게', instruction: '(친근하고 따뜻하게) ' },
                              { id: '따뜻하게', instruction: '(따뜻하게 공감하며) ' },
                              { id: '뉴스형식', instruction: '(뉴스 앵커처럼 명확하고 감정 없이) ' },
                              { id: '부드럽게', instruction: '(부드럽고 온화하게) ' },
                              { id: '부드럽고강하게', label: '부드럽고 강하게', instruction: '(부드럽지만 확신 있게) ' },
                              { id: '강하고따뜻하게', label: '강하고 따뜻하게', instruction: '(강하고 열정적으로 따뜻하게) ' },
                              { id: '심각하게', instruction: '(심각하고 진지하게) ' },
                              { id: '울면서', instruction: '(슬프고 울먹이는 감정으로) ' },
                            ] as { id: string; label?: string; instruction: string }[]).map(m => (
                              <button key={m.id} type="button" onClick={() => {
                                const newMood = googleTtsMood === m.id ? '' : m.id;
                                setGoogleTtsMood(newMood);
                                setVoiceSetting('heaven_google_tts_mood_id', newMood);
                                setVoiceSetting('heaven_google_tts_mood', newMood ? m.instruction : '');
                              }}
                                className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-colors border ${googleTtsMood === m.id ? 'bg-teal-600/20 text-teal-200 border-teal-500/60 shadow-[0_0_10px_rgba(20,184,166,0.4)]' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border-blue-500/30'}`}>
                                {m.label || m.id}
                              </button>
                            ))}
                          </div>
                          {(googleTtsTone || googleTtsMood) && (
                            <button type="button" onClick={() => {
                              setGoogleTtsTone(''); setGoogleTtsMood('');
                              setVoiceSetting('heaven_google_tts_tone_id', '');
                              setVoiceSetting('heaven_google_tts_tone', '');
                              setVoiceSetting('heaven_google_tts_mood_id', '');
                              setVoiceSetting('heaven_google_tts_mood', '');
                            }}
                              className="mt-1 text-xs text-slate-500 hover:text-slate-300">전체 초기화</button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
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
