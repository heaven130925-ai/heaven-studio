
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { GenerationStep, ProjectSettings, ReferenceImages, DEFAULT_REFERENCE_IMAGES } from '../types';
import { CONFIG, ELEVENLABS_MODELS, ElevenLabsModelId, IMAGE_MODELS, ImageModelId, GEMINI_STYLE_CATEGORIES, GeminiStyleId, ELEVENLABS_DEFAULT_VOICES, VoiceGender, GEMINI_TTS_VOICES, GeminiTtsVoiceId, VISUAL_STYLES, VisualStyleId } from '../config';
import { getElevenLabsModelId, setElevenLabsModelId, fetchElevenLabsVoices, ElevenLabsVoice } from '../services/elevenLabsService';
import { generateGeminiTtsPreview } from '../services/geminiService';

// Gemini 스타일 맵
const GEMINI_STYLE_MAP = new Map<string, { id: string; name: string; category: string; prompt: string }>();
GEMINI_STYLE_CATEGORIES.forEach(category => {
  category.styles.forEach(style => {
    GEMINI_STYLE_MAP.set(style.id, { ...style, category: category.name });
  });
});

// PCM base64 → WAV Blob URL (Gemini TTS 미리듣기용)
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
  onGenerate: (topic: string, referenceImages: ReferenceImages, sourceText: string | null, sceneCount: number, imageOnly?: boolean) => void;
  onExtractCharacters?: (script: string) => void;
  step: GenerationStep;
}

const InputSection: React.FC<InputSectionProps> = ({ onGenerate, onExtractCharacters, step }) => {
  const [activeTab, setActiveTab] = useState<'auto' | 'manual'>('auto');
  const [topic, setTopic] = useState('');
  const [manualScript, setManualScript] = useState('');

  // 참조 이미지 상태
  const [characterRefImages, setCharacterRefImages] = useState<string[]>([]);
  const [styleRefImages, setStyleRefImages] = useState<string[]>([]);
  const [characterStrength, setCharacterStrength] = useState(DEFAULT_REFERENCE_IMAGES.characterStrength);
  const [styleStrength, setStyleStrength] = useState(DEFAULT_REFERENCE_IMAGES.styleStrength);

  // 씬 개수
  const [sceneCount, setSceneCount] = useState<number>(0);

  // 비주얼 스타일
  const [visualStyleId, setVisualStyleId] = useState<VisualStyleId>(
    (localStorage.getItem(CONFIG.STORAGE_KEYS.VISUAL_STYLE_ID) as VisualStyleId) || 'none'
  );

  const selectVisualStyle = useCallback((id: VisualStyleId) => {
    const next = visualStyleId === id ? 'none' : id;
    setVisualStyleId(next);
    localStorage.setItem(CONFIG.STORAGE_KEYS.VISUAL_STYLE_ID, next);
  }, [visualStyleId]);

  // 영상 포맷 (화면 비율)
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>(
    (localStorage.getItem(CONFIG.STORAGE_KEYS.ASPECT_RATIO) as '16:9' | '9:16') || '16:9'
  );

  // 이미지 설정
  const [imageModelId, setImageModelId] = useState<ImageModelId>('gemini-2.5-flash-image');
  const [geminiStyleId, setGeminiStyleId] = useState<GeminiStyleId>('gemini-none');
  const [geminiCustomStylePrompt, setGeminiCustomStylePrompt] = useState('');
  const [imageTextMode, setImageTextMode] = useState<string>('none');

  // 프로젝트 관리
  const [projects, setProjects] = useState<ProjectSettings[]>([]);
  const [newProjectName, setNewProjectName] = useState('');

  // API 키 (localStorage 우선, env 폴백)
  const [geminiApiKey, setGeminiApiKey] = useState(
    localStorage.getItem('tubegen_gemini_key') || ''
  );
  const [elApiKeyInput, setElApiKeyInput] = useState(
    localStorage.getItem(CONFIG.STORAGE_KEYS.ELEVENLABS_API_KEY) || process.env.ELEVENLABS_API_KEY || ''
  );
  const elApiKey = elApiKeyInput || process.env.ELEVENLABS_API_KEY || '';

  // ElevenLabs 설정
  const [elVoiceId, setElVoiceId] = useState('');
  const [elModelId, setElModelId] = useState<ElevenLabsModelId>('eleven_multilingual_v2');
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [showVoiceDropdown, setShowVoiceDropdown] = useState(false);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [genderFilter, setGenderFilter] = useState<VoiceGender | null>(null);

  // 음성 공통 설정
  const [voiceSpeed, setVoiceSpeed] = useState<string>(localStorage.getItem(CONFIG.STORAGE_KEYS.VOICE_SPEED) || '1.0');
  const [voiceStability, setVoiceStability] = useState<number>(parseInt(localStorage.getItem(CONFIG.STORAGE_KEYS.VOICE_STABILITY) || '50'));
  const [voiceStyle, setVoiceStyle] = useState<number>(parseInt(localStorage.getItem(CONFIG.STORAGE_KEYS.VOICE_STYLE) || '0'));

  // Google TTS 설정
  const [geminiTtsVoice, setGeminiTtsVoice] = useState<GeminiTtsVoiceId>(CONFIG.DEFAULT_GEMINI_TTS_VOICE);
  const [geminiTtsGenderFilter, setGeminiTtsGenderFilter] = useState<'male' | 'female' | null>(null);
  const [playingGeminiVoiceId, setPlayingGeminiVoiceId] = useState<string | null>(null);

  // 설정 패널 탭
  const [settingsTab, setSettingsTab] = useState<'apikey' | 'image' | 'voice' | 'project'>('apikey');
  const [voiceSubTab, setVoiceSubTab] = useState<'elevenlabs' | 'google'>(
    (localStorage.getItem(CONFIG.STORAGE_KEYS.TTS_PROVIDER) as 'elevenlabs' | 'google') || 'elevenlabs'
  );

  // Refs
  const characterFileInputRef = useRef<HTMLInputElement>(null);
  const styleFileInputRef = useRef<HTMLInputElement>(null);
  const voiceDropdownRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 초기 로드
  useEffect(() => {
    const savedVoiceId = localStorage.getItem(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID) || '';
    const savedModelId = getElevenLabsModelId();
    const savedImageModel = localStorage.getItem(CONFIG.STORAGE_KEYS.IMAGE_MODEL) as ImageModelId || CONFIG.DEFAULT_IMAGE_MODEL;
    const savedGeminiStyle = localStorage.getItem(CONFIG.STORAGE_KEYS.GEMINI_STYLE) as GeminiStyleId || 'gemini-none';
    const savedGeminiCustomStyle = localStorage.getItem(CONFIG.STORAGE_KEYS.GEMINI_CUSTOM_STYLE) || '';
    const savedTextMode = localStorage.getItem(CONFIG.STORAGE_KEYS.IMAGE_TEXT_MODE) || 'none';
    const savedGeminiTtsVoice = localStorage.getItem(CONFIG.STORAGE_KEYS.GEMINI_TTS_VOICE) as GeminiTtsVoiceId || CONFIG.DEFAULT_GEMINI_TTS_VOICE;

    setElVoiceId(savedVoiceId);
    setElModelId(savedModelId);
    setImageModelId(savedImageModel);
    setGeminiStyleId(savedGeminiStyle);
    setGeminiCustomStylePrompt(savedGeminiCustomStyle);
    setImageTextMode(savedTextMode);
    setGeminiTtsVoice(savedGeminiTtsVoice);

    const savedProjects = localStorage.getItem(CONFIG.STORAGE_KEYS.PROJECTS);
    if (savedProjects) {
      try { setProjects(JSON.parse(savedProjects)); } catch (e) { console.error('프로젝트 로드 실패:', e); }
    }
    if (elApiKey) loadVoices(elApiKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 드롭다운 외부 클릭 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (voiceDropdownRef.current && !voiceDropdownRef.current.contains(e.target as Node))
        setShowVoiceDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 언마운트 시 오디오 정리
  useEffect(() => {
    return () => { audioRef.current?.pause(); audioRef.current = null; };
  }, []);

  // 음성 목록 불러오기
  const loadVoices = useCallback(async (apiKey?: string) => {
    const key = apiKey || elApiKey;
    if (!key || key.length < 10) return;
    setIsLoadingVoices(true);
    try {
      const voiceList = await fetchElevenLabsVoices(key);
      setVoices(voiceList);
    } catch (e) { console.error('음성 목록 로드 실패:', e); }
    finally { setIsLoadingVoices(false); }
  }, []);

  // ElevenLabs API 음성 선택
  const selectVoice = useCallback((voice: ElevenLabsVoice) => {
    setElVoiceId(voice.voice_id);
    localStorage.setItem(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID, voice.voice_id);
    setShowVoiceDropdown(false);
  }, []);

  // ElevenLabs 미리듣기
  const PREVIEW_TEXT = "안녕하세요. 테스트 목소리입니다.";

  const playElevenLabsPreview = async (voiceId: string, voiceName: string) => {
    if (!elApiKey || elApiKey.length < 10) { alert('ElevenLabs API Key가 없습니다.'); return; }
    if (playingVoiceId === voiceId) {
      audioRef.current?.pause(); audioRef.current = null; setPlayingVoiceId(null); return;
    }
    audioRef.current?.pause();
    setPlayingVoiceId(voiceId);
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': elApiKey },
        body: JSON.stringify({ text: PREVIEW_TEXT, model_id: elModelId, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.play().catch(() => setPlayingVoiceId(null));
      audio.onended = () => { setPlayingVoiceId(null); audioRef.current = null; URL.revokeObjectURL(url); };
    } catch (e) {
      console.error('ElevenLabs 미리듣기 실패:', e);
      alert(`"${voiceName}" 미리듣기 실패`);
      setPlayingVoiceId(null);
    }
  };

  const playDefaultVoicePreview = (e: React.MouseEvent, voice: typeof ELEVENLABS_DEFAULT_VOICES[number]) => {
    e.stopPropagation(); playElevenLabsPreview(voice.id, voice.name);
  };
  const playVoicePreview = (e: React.MouseEvent, voice: ElevenLabsVoice) => {
    e.stopPropagation(); playElevenLabsPreview(voice.voice_id, voice.name);
  };

  // Google TTS 미리듣기
  const playGeminiTtsPreview = async (voiceId: string) => {
    if (playingGeminiVoiceId === voiceId) {
      audioRef.current?.pause(); audioRef.current = null; setPlayingGeminiVoiceId(null); return;
    }
    audioRef.current?.pause();
    setPlayingGeminiVoiceId(voiceId);
    try {
      const base64 = await generateGeminiTtsPreview(PREVIEW_TEXT, voiceId);
      if (!base64) throw new Error('no audio');
      const url = pcmBase64ToWavUrl(base64);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.play().catch(() => setPlayingGeminiVoiceId(null));
      audio.onended = () => { setPlayingGeminiVoiceId(null); audioRef.current = null; URL.revokeObjectURL(url); };
    } catch (e) {
      console.error('Google TTS 미리듣기 실패:', e);
      setPlayingGeminiVoiceId(null);
    }
  };

  // 선택된 음성 정보
  const getSelectedVoiceInfo = useCallback(() => {
    if (!elVoiceId) return { name: '기본값 (Adam)', description: '가장 안정적인 남성 음성' };
    const dv = ELEVENLABS_DEFAULT_VOICES.find(v => v.id === elVoiceId);
    if (dv) return { name: dv.name, description: dv.description };
    const av = voices.find(v => v.voice_id === elVoiceId);
    if (av) return { name: av.name, description: av.labels?.description || av.category };
    return { name: elVoiceId.slice(0, 12) + '...', description: '직접 입력한 ID' };
  }, [elVoiceId, voices]);

  // ElevenLabs 설정 저장
  const saveElevenLabsSettings = () => {
    if (elVoiceId) localStorage.setItem(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID, elVoiceId);
    setElevenLabsModelId(elModelId);
  };

  // 음성 속도/안정성/표현력 저장
  const selectVoiceSpeed = (speed: string) => { setVoiceSpeed(speed); localStorage.setItem(CONFIG.STORAGE_KEYS.VOICE_SPEED, speed); };
  const changeVoiceStability = (val: number) => { setVoiceStability(val); localStorage.setItem(CONFIG.STORAGE_KEYS.VOICE_STABILITY, String(val)); };
  const changeVoiceStyle = (val: number) => { setVoiceStyle(val); localStorage.setItem(CONFIG.STORAGE_KEYS.VOICE_STYLE, String(val)); };

  // 이미지/스타일 선택
  const selectImageModel = useCallback((id: ImageModelId) => { setImageModelId(id); localStorage.setItem(CONFIG.STORAGE_KEYS.IMAGE_MODEL, id); }, []);
  const selectGeminiStyle = useCallback((id: GeminiStyleId) => { setGeminiStyleId(id); localStorage.setItem(CONFIG.STORAGE_KEYS.GEMINI_STYLE, id); }, []);
  const selectImageTextMode = useCallback((mode: string) => { setImageTextMode(mode); localStorage.setItem(CONFIG.STORAGE_KEYS.IMAGE_TEXT_MODE, mode); }, []);
  const saveGeminiCustomStyle = useCallback((prompt: string) => { setGeminiCustomStylePrompt(prompt); localStorage.setItem(CONFIG.STORAGE_KEYS.GEMINI_CUSTOM_STYLE, prompt); }, []);

  // 프로젝트 관리
  const saveProject = () => {
    if (!newProjectName.trim()) return;
    const p: ProjectSettings = { id: Date.now().toString(), name: newProjectName.trim(), createdAt: Date.now(), updatedAt: Date.now(), imageModel: imageModelId, elevenLabsVoiceId: elVoiceId, elevenLabsModel: elModelId };
    const updated = [...projects, p];
    setProjects(updated); localStorage.setItem(CONFIG.STORAGE_KEYS.PROJECTS, JSON.stringify(updated)); setNewProjectName('');
    alert(`"${p.name}" 저장 완료!`);
  };
  const loadProject = (p: ProjectSettings) => {
    setImageModelId(p.imageModel as ImageModelId); setElVoiceId(p.elevenLabsVoiceId); setElModelId(p.elevenLabsModel as ElevenLabsModelId);
    localStorage.setItem(CONFIG.STORAGE_KEYS.IMAGE_MODEL, p.imageModel);
    localStorage.setItem(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID, p.elevenLabsVoiceId);
    setElevenLabsModelId(p.elevenLabsModel as ElevenLabsModelId);
    alert(`"${p.name}" 불러오기 완료!`);
  };
  const deleteProject = (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return;
    const updated = projects.filter(p => p.id !== id);
    setProjects(updated); localStorage.setItem(CONFIG.STORAGE_KEYS.PROJECTS, JSON.stringify(updated));
  };
  const updateProject = (p: ProjectSettings) => {
    const updated = projects.map(pr => pr.id === p.id ? { ...p, updatedAt: Date.now(), imageModel: imageModelId, elevenLabsVoiceId: elVoiceId, elevenLabsModel: elModelId } : pr);
    setProjects(updated); localStorage.setItem(CONFIG.STORAGE_KEYS.PROJECTS, JSON.stringify(updated));
    alert(`"${p.name}" 업데이트 완료!`);
  };

  // 메모화
  const selectedGeminiStyle = useMemo(() => {
    if (geminiStyleId === 'gemini-none') return { id: 'gemini-none', name: '없음', category: '기본', prompt: '' };
    if (geminiStyleId === 'gemini-custom') return { id: 'gemini-custom', name: '커스텀', category: '직접 입력', prompt: geminiCustomStylePrompt };
    return GEMINI_STYLE_MAP.get(geminiStyleId) || null;
  }, [geminiStyleId, geminiCustomStylePrompt]);

  const filteredDefaultVoices = useMemo(() => !genderFilter ? ELEVENLABS_DEFAULT_VOICES : ELEVENLABS_DEFAULT_VOICES.filter(v => v.gender === genderFilter), [genderFilter]);
  const filteredApiVoices = useMemo(() => !genderFilter ? voices : voices.filter(v => v.labels?.gender?.toLowerCase() === genderFilter), [voices, genderFilter]);

  const isProcessing = step !== GenerationStep.IDLE && step !== GenerationStep.COMPLETED && step !== GenerationStep.ERROR;

  const buildRefImages = useCallback((): ReferenceImages => ({
    character: characterRefImages, style: styleRefImages, characterStrength, styleStrength
  }), [characterRefImages, styleRefImages, characterStrength, styleStrength]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (isProcessing) return;
    const refImages = buildRefImages();
    if (activeTab === 'auto') { if (topic.trim()) onGenerate(topic, refImages, null, sceneCount); }
    else { if (manualScript.trim()) onGenerate("Manual Script Input", refImages, manualScript, sceneCount); }
  }, [isProcessing, activeTab, topic, manualScript, sceneCount, onGenerate, buildRefImages]);

  const handleImagesOnly = useCallback(() => {
    if (isProcessing) return;
    const refImages = buildRefImages();
    if (activeTab === 'auto') { if (topic.trim()) onGenerate(topic, refImages, null, sceneCount, true); }
    else { if (manualScript.trim()) onGenerate("Manual Script Input", refImages, manualScript, sceneCount, true); }
  }, [isProcessing, activeTab, topic, manualScript, sceneCount, onGenerate, buildRefImages]);

  const handleCharacterImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const slots = 5 - characterRefImages.length;
      (Array.from(files) as File[]).slice(0, slots).forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => setCharacterRefImages(prev => [...prev, reader.result as string].slice(0, 5));
        reader.readAsDataURL(file);
      });
    }
    if (characterFileInputRef.current) characterFileInputRef.current.value = '';
  }, [characterRefImages.length]);

  const handleStyleImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const slots = 5 - styleRefImages.length;
      (Array.from(files) as File[]).slice(0, slots).forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => setStyleRefImages(prev => [...prev, reader.result as string].slice(0, 5));
        reader.readAsDataURL(file);
      });
    }
    if (styleFileInputRef.current) styleFileInputRef.current.value = '';
  }, [styleRefImages.length]);

  const removeCharacterImage = useCallback((i: number) => setCharacterRefImages(prev => prev.filter((_, idx) => idx !== i)), []);
  const removeStyleImage = useCallback((i: number) => setStyleRefImages(prev => prev.filter((_, idx) => idx !== i)), []);

  // ─── PlayIcon / PauseIcon 헬퍼 ─────────────────────
  const PlayIcon = () => <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>;
  const PauseIcon = () => <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>;
  const CheckIcon = () => <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>;

  return (
    <div className="w-full max-w-3xl mx-auto my-8 px-4 space-y-4">
      {/* Header */}
      <div className="text-center mb-6">
        <h1 className="text-3xl md:text-4xl font-black tracking-tight mb-1 text-white">
          Heaven <span className="text-brand-500">Studio</span>
        </h1>
        <p className="text-slate-500 text-xs font-medium uppercase tracking-widest">V1.0 Concept-Based Engine</p>
      </div>

      {/* 입력 모드 탭 */}
      <div className="flex justify-center">
        <div className="bg-slate-900 p-1 rounded-xl border border-slate-800 flex gap-1">
          <button type="button" onClick={() => setActiveTab('auto')}
            className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'auto' ? 'bg-brand-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
            주제 자동생성
          </button>
          <button type="button" onClick={() => setActiveTab('manual')}
            className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'manual' ? 'bg-brand-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
            수동 대본
          </button>
        </div>
      </div>

      {/* 입력 폼 */}
      <form onSubmit={handleSubmit}>
        {activeTab === 'auto' ? (
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-brand-600 to-blue-600 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-500" />
            <div className="relative flex items-center bg-slate-900 rounded-2xl border border-slate-700 overflow-hidden pr-2">
              <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} disabled={isProcessing}
                placeholder="주제 입력 (예: 성경 말씀, 자연, 역사, 과학...)"
                className="block w-full bg-transparent text-slate-100 py-4 px-5 focus:ring-0 focus:outline-none placeholder-slate-600 text-base disabled:opacity-50" />
              <button type="submit" disabled={isProcessing || !topic.trim()}
                className="bg-brand-600 hover:bg-brand-500 text-white font-black py-2.5 px-6 rounded-xl transition-all disabled:opacity-50 whitespace-nowrap">
                {isProcessing ? '생성 중' : '시작'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
              <textarea value={manualScript} onChange={(e) => setManualScript(e.target.value)} disabled={isProcessing}
                placeholder="직접 작성한 대본을 입력하세요. AI가 시각적 연출안을 생성합니다."
                className="w-full h-48 bg-transparent text-slate-100 p-5 focus:ring-0 focus:outline-none placeholder-slate-600 resize-none text-sm" />
              <div className="px-5 pb-3 flex items-center justify-between border-t border-slate-800 pt-2">
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-mono ${manualScript.length > 10000 ? 'text-amber-400' : manualScript.length > 3000 ? 'text-blue-400' : 'text-slate-500'}`}>
                    {manualScript.length.toLocaleString()}자
                  </span>
                  {manualScript.length > 100 && (
                    <span className="text-[10px] text-slate-600">(예상 ~{Math.max(5, Math.ceil(manualScript.length / 100))}씬)</span>
                  )}
                </div>
                <span className="text-[10px] text-slate-600">
                  {manualScript.length > 10000 ? '⚡ 대용량' : manualScript.length > 3000 ? '📦 청크 분할' : '일반 처리'}
                </span>
              </div>
            </div>
            <button type="submit" disabled={isProcessing || !manualScript.trim()}
              className="w-full bg-slate-100 hover:bg-white text-slate-950 font-black py-4 rounded-2xl transition-all disabled:opacity-50 uppercase tracking-widest text-sm">
              스토리보드 생성
            </button>
          </div>
        )}
      </form>

      {/* ─── 비주얼 스타일 선택기 ─────────────────────── */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-300">🎨 비주얼 스타일</span>
            {visualStyleId !== 'none' && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-500/20 text-brand-400 border border-brand-500/30 font-bold">
                {VISUAL_STYLES.find(s => s.id === visualStyleId)?.name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {visualStyleId !== 'none' && (
              <button type="button" onClick={() => selectVisualStyle('none')}
                className="text-[10px] text-slate-500 hover:text-red-400 transition-colors">
                선택 해제
              </button>
            )}
            <button
              type="button"
              onClick={handleImagesOnly}
              disabled={isProcessing || (activeTab === 'auto' ? !topic.trim() : !manualScript.trim())}
              className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-black uppercase tracking-wider transition-all disabled:opacity-40 flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              이미지만 생성
            </button>
            {onExtractCharacters && activeTab === 'manual' && (
              <button
                type="button"
                onClick={() => manualScript.trim() && onExtractCharacters(manualScript)}
                disabled={isProcessing || !manualScript.trim()}
                className="px-4 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-black uppercase tracking-wider transition-all disabled:opacity-40 flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                캐릭터 추출
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {VISUAL_STYLES.map(style => (
            <button
              key={style.id}
              type="button"
              onClick={() => selectVisualStyle(style.id as VisualStyleId)}
              className={`relative flex flex-col items-center justify-center gap-1 p-2 rounded-xl border transition-all text-center ${
                visualStyleId === style.id
                  ? 'border-brand-400 ring-1 ring-brand-400/50 bg-brand-500/10'
                  : 'border-slate-700 hover:border-slate-500'
              }`}
            >
              <div className={`w-full aspect-video rounded-lg bg-gradient-to-br ${style.bg} flex items-center justify-center text-xl`}>
                {style.emoji}
              </div>
              <span className="text-[9px] font-bold text-slate-300 leading-tight">{style.name}</span>
              {visualStyleId === style.id && (
                <div className="absolute top-1 right-1 w-3 h-3 bg-brand-500 rounded-full flex items-center justify-center">
                  <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ─── 영상 포맷 선택 ─────────────────────── */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-slate-300">📐 영상 포맷</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setAspectRatio('16:9'); localStorage.setItem(CONFIG.STORAGE_KEYS.ASPECT_RATIO, '16:9'); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-xs font-bold transition-all ${aspectRatio === '16:9' ? 'bg-brand-600 border-brand-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}
            >
              <span className="inline-block w-6 h-4 border-2 rounded border-current" />
              롱폼 16:9
            </button>
            <button
              type="button"
              onClick={() => { setAspectRatio('9:16'); localStorage.setItem(CONFIG.STORAGE_KEYS.ASPECT_RATIO, '9:16'); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-xs font-bold transition-all ${aspectRatio === '9:16' ? 'bg-brand-600 border-brand-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}
            >
              <span className="inline-block w-3 h-5 border-2 rounded border-current" />
              숏츠 9:16
            </button>
          </div>
          <span className="text-[10px] text-slate-500 ml-auto">{aspectRatio === '9:16' ? '세로형 • YouTube Shorts / TikTok' : '가로형 • YouTube 롱폼'}</span>
        </div>
      </div>

      {/* ─── 참조이미지 (메인 화면) ─────────────────────── */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm font-bold text-slate-300">📎 참조이미지</span>
          <span className="text-[10px] text-slate-500">캐릭터/화풍 참조 (각 최대 5장)</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {/* 캐릭터 참조 */}
          <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700">
            <div className="flex items-center gap-1.5 mb-2">
              <span>🧑</span>
              <span className="text-xs font-bold text-white">캐릭터</span>
              {characterRefImages.length > 0 && (
                <span className="ml-auto text-[9px] text-amber-400">⚠️ 고정 프롬프트 제외</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              {characterRefImages.map((img, idx) => (
                <div key={idx} className="relative group">
                  <div className="w-14 h-10 rounded-lg overflow-hidden border border-violet-500/50">
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  </div>
                  <button onClick={() => removeCharacterImage(idx)}
                    className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
              {characterRefImages.length < 5 && (
                <button type="button" onClick={() => characterFileInputRef.current?.click()}
                  className="w-14 h-10 border-2 border-dashed border-slate-600 rounded-lg flex items-center justify-center text-slate-500 hover:border-violet-500 hover:text-violet-400 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                </button>
              )}
              <input type="file" ref={characterFileInputRef} onChange={handleCharacterImageChange} accept="image/*" className="hidden" multiple />
            </div>
            {characterRefImages.length > 0 && (
              <div className="mt-2">
                <div className="flex justify-between text-[10px] mb-0.5">
                  <span className="text-slate-400">강도</span>
                  <span className="text-violet-400">{characterStrength}%</span>
                </div>
                <input type="range" min={0} max={100} value={characterStrength} onChange={(e) => setCharacterStrength(Number(e.target.value))}
                  className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-violet-500" />
              </div>
            )}
          </div>

          {/* 스타일 참조 */}
          <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700">
            <div className="flex items-center gap-1.5 mb-2">
              <span>🎨</span>
              <span className="text-xs font-bold text-white">화풍/스타일</span>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              {styleRefImages.map((img, idx) => (
                <div key={idx} className="relative group">
                  <div className="w-14 h-10 rounded-lg overflow-hidden border border-fuchsia-500/50">
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  </div>
                  <button onClick={() => removeStyleImage(idx)}
                    className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
              {styleRefImages.length < 5 && (
                <button type="button" onClick={() => styleFileInputRef.current?.click()}
                  className="w-14 h-10 border-2 border-dashed border-slate-600 rounded-lg flex items-center justify-center text-slate-500 hover:border-fuchsia-500 hover:text-fuchsia-400 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                </button>
              )}
              <input type="file" ref={styleFileInputRef} onChange={handleStyleImageChange} accept="image/*" className="hidden" multiple />
            </div>
            {styleRefImages.length > 0 && (
              <div className="mt-2">
                <div className="flex justify-between text-[10px] mb-0.5">
                  <span className="text-slate-400">강도</span>
                  <span className="text-fuchsia-400">{styleStrength}%</span>
                </div>
                <input type="range" min={0} max={100} value={styleStrength} onChange={(e) => setStyleStrength(Number(e.target.value))}
                  className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-fuchsia-500" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── 설정 패널 (탭) ─────────────────────────────── */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
        {/* 탭 헤더 */}
        <div className="flex border-b border-slate-800">
          {([
            { id: 'apikey' as const, label: '🔑 API 키' },
            { id: 'image' as const, label: '🖼️ 이미지' },
            { id: 'voice' as const, label: '🎙️ 음성' },
            { id: 'project' as const, label: '📁 프로젝트' },
          ]).map(tab => (
            <button key={tab.id} type="button" onClick={() => setSettingsTab(tab.id)}
              className={`flex-1 py-2.5 text-xs font-bold whitespace-nowrap transition-colors border-b-2 ${
                settingsTab === tab.id
                  ? 'text-white border-brand-500 bg-slate-800/60'
                  : 'text-slate-500 border-transparent hover:text-slate-300 hover:bg-slate-800/20'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* 탭 콘텐츠 */}
        <div className="p-4 max-h-[460px] overflow-y-auto">

          {/* ── 🔑 API 키 탭 ── */}
          {settingsTab === 'apikey' && (
            <div className="space-y-4">
              <p className="text-[11px] text-slate-500 leading-relaxed">
                API 키를 입력하면 이 브라우저에만 저장됩니다. 다른 사람과 공유되지 않습니다.
              </p>

              {/* Gemini API 키 */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-wider">
                  Gemini API 키 <span className="text-red-400">*필수</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={geminiApiKey}
                    onChange={e => setGeminiApiKey(e.target.value)}
                    placeholder="AIza..."
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-brand-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      localStorage.setItem('tubegen_gemini_key', geminiApiKey.trim());
                      alert('Gemini API 키가 저장되었습니다.');
                    }}
                    className="px-3 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold rounded-xl transition-colors"
                  >
                    저장
                  </button>
                </div>
                <p className="text-[10px] text-slate-600 mt-1">
                  <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-brand-400 hover:underline">Google AI Studio</a>에서 무료 발급
                </p>
                {geminiApiKey && <p className="text-[10px] text-green-500 mt-1">✅ 키 입력됨</p>}
                {!geminiApiKey && <p className="text-[10px] text-red-400 mt-1">⚠️ 키 없으면 이미지/스크립트 생성 불가</p>}
              </div>

              {/* ElevenLabs API 키 */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-wider">
                  ElevenLabs API 키 <span className="text-slate-500">(선택 — 고품질 TTS)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={elApiKeyInput}
                    onChange={e => setElApiKeyInput(e.target.value)}
                    placeholder="sk_..."
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-purple-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      localStorage.setItem(CONFIG.STORAGE_KEYS.ELEVENLABS_API_KEY, elApiKeyInput.trim());
                      if (elApiKeyInput.trim()) loadVoices(elApiKeyInput.trim());
                      alert('ElevenLabs API 키가 저장되었습니다.');
                    }}
                    className="px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl transition-colors"
                  >
                    저장
                  </button>
                </div>
                <p className="text-[10px] text-slate-600 mt-1">
                  없으면 Google TTS 자동 사용
                </p>
                {elApiKeyInput && <p className="text-[10px] text-green-500 mt-1">✅ 키 입력됨</p>}
              </div>

              {/* FAL API 키 */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-wider">
                  FAL.ai API 키 <span className="text-slate-500">(선택 — 이미지→영상 변환)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    defaultValue={localStorage.getItem(CONFIG.STORAGE_KEYS.FAL_API_KEY) || ''}
                    onChange={e => localStorage.setItem(CONFIG.STORAGE_KEYS.FAL_API_KEY, e.target.value)}
                    placeholder="fal_..."
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-orange-500 focus:outline-none"
                  />
                </div>
                <p className="text-[10px] text-slate-600 mt-1">입력 즉시 자동 저장</p>
              </div>
            </div>
          )}

          {/* ── 🖼️ 이미지 탭 ── */}
          {settingsTab === 'image' && (
            <div className="space-y-4">
              {/* 씬 수 + 이미지 글씨 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-wider">이미지 수</label>
                  <input type="number" min={0} max={500}
                    value={sceneCount === 0 ? '' : sceneCount}
                    onChange={(e) => { const v = parseInt(e.target.value, 10); setSceneCount(isNaN(v) || v < 0 ? 0 : v); }}
                    placeholder="자동"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-brand-500 focus:outline-none text-center" />
                  <p className="text-[10px] text-slate-600 mt-1 text-center">{sceneCount > 0 ? `${sceneCount}씬 고정` : 'AI 자동 결정'}</p>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-wider">이미지 글씨</label>
                  <div className="grid grid-cols-2 gap-1">
                    {([{ id: 'none', label: '없음' }, { id: 'english', label: '영어' }, { id: 'numbers', label: '숫자' }, { id: 'auto', label: '자동' }] as const).map(({ id, label }) => (
                      <button key={id} type="button" onClick={() => selectImageTextMode(id)}
                        className={`py-1.5 rounded-lg text-[10px] font-bold transition-colors ${imageTextMode === id ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 이미지 모델 */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-wider">이미지 모델</label>
                <div className="space-y-1.5">
                  {IMAGE_MODELS.map((model) => (
                    <button key={model.id} type="button" onClick={() => selectImageModel(model.id)}
                      className={`w-full p-3 rounded-xl border text-left transition-all ${imageModelId === model.id ? 'bg-blue-600/20 border-blue-500 text-white' : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600'}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm">{model.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-green-400 font-bold text-xs">${model.pricePerImage.toFixed(4)}/장</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{model.provider}</span>
                        </div>
                      </div>
                      <div className="text-xs opacity-60 mt-0.5">{model.description} · {model.speed}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Gemini 화풍 */}
              {imageModelId === 'gemini-2.5-flash-image' && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">🎨 화풍</label>
                    {selectedGeminiStyle && selectedGeminiStyle.id !== 'gemini-none' && (
                      <span className="text-[10px] text-emerald-400">{selectedGeminiStyle.name}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => selectGeminiStyle('gemini-none')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${geminiStyleId === 'gemini-none' ? 'bg-slate-600 text-white ring-1 ring-slate-400' : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700 hover:text-white'}`}>
                      🚫 없음
                    </button>
                    {GEMINI_STYLE_CATEGORIES.flatMap(c => c.styles).map((style) => (
                      <button key={style.id} type="button" onClick={() => selectGeminiStyle(style.id as GeminiStyleId)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${geminiStyleId === style.id ? 'bg-emerald-500 text-white' : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700 hover:text-white'}`}>
                        {style.name}
                      </button>
                    ))}
                    <button type="button" onClick={() => selectGeminiStyle('gemini-custom')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${geminiStyleId === 'gemini-custom' ? 'bg-teal-500 text-white' : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700 hover:text-white'}`}>
                      ✏️ 커스텀
                    </button>
                  </div>
                  {geminiStyleId === 'gemini-custom' && (
                    <textarea value={geminiCustomStylePrompt} onChange={(e) => saveGeminiCustomStyle(e.target.value)}
                      placeholder="예: Watercolor painting style with soft edges, pastel colors..."
                      className="mt-2 w-full h-20 bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none resize-none" />
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── 🎙️ 음성 탭 ── */}
          {settingsTab === 'voice' && (
            <div className="space-y-3">
              {/* 공통: 말하기 속도 */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-wider">말하기 속도</label>
                <div className="flex gap-2">
                  {[['0.7', '느림'], ['1.0', '보통'], ['1.3', '빠름']].map(([val, label]) => (
                    <button key={val} type="button" onClick={() => selectVoiceSpeed(val)}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors ${voiceSpeed === val ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sub-탭 */}
              <div className="flex gap-2">
                <button type="button" onClick={() => { setVoiceSubTab('elevenlabs'); localStorage.setItem(CONFIG.STORAGE_KEYS.TTS_PROVIDER, 'elevenlabs'); }}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors ${voiceSubTab === 'elevenlabs' ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                  ElevenLabs {elApiKey ? '✅' : '⚠️'}
                </button>
                <button type="button" onClick={() => { setVoiceSubTab('google'); localStorage.setItem(CONFIG.STORAGE_KEYS.TTS_PROVIDER, 'google'); }}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors ${voiceSubTab === 'google' ? 'bg-teal-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                  Google TTS ({GEMINI_TTS_VOICES.length}개) ✅
                </button>
              </div>

              {/* ElevenLabs */}
              {voiceSubTab === 'elevenlabs' && (
                <div className="space-y-3">
                  <div className={`p-2.5 rounded-lg text-xs font-medium ${elApiKey ? 'bg-green-500/10 border border-green-500/30 text-green-400' : 'bg-amber-500/10 border border-amber-500/30 text-amber-400'}`}>
                    {elApiKey ? '✅ API 키 설정됨 (.env.local)' : '⚠️ API 키 미설정 → Google TTS 자동 사용'}
                  </div>

                  {elApiKey && (
                    <>
                      {/* 성별 필터 + 내 음성 불러오기 */}
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                          {([null, 'male', 'female'] as const).map((g) => (
                            <button key={String(g)} type="button" onClick={() => setGenderFilter(g)}
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors ${genderFilter === g ? (g === 'male' ? 'bg-blue-600 text-white' : g === 'female' ? 'bg-pink-600 text-white' : 'bg-slate-600 text-white') : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                              {g === null ? '전체' : g === 'male' ? '남성' : '여성'}
                            </button>
                          ))}
                        </div>
                        <button type="button" onClick={() => loadVoices()} disabled={isLoadingVoices}
                          className="ml-auto px-2.5 py-1 text-[10px] bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 rounded-lg font-bold">
                          {isLoadingVoices ? '로딩...' : '내 음성 불러오기'}
                        </button>
                      </div>

                      {/* 음성 드롭다운 */}
                      <div ref={voiceDropdownRef} className="relative">
                        <button type="button" onClick={() => setShowVoiceDropdown(!showVoiceDropdown)}
                          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-left flex items-center justify-between hover:border-purple-500/50 transition-colors">
                          <span className="text-sm text-white font-medium">{getSelectedVoiceInfo().name}</span>
                          <svg className={`w-4 h-4 text-slate-500 transition-transform ${showVoiceDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>

                        {showVoiceDropdown && (
                          <div className="absolute z-50 w-full mt-1 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-h-64 overflow-y-auto">
                            {/* 기본값 */}
                            <button type="button"
                              onClick={() => { setElVoiceId(''); localStorage.removeItem(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID); setShowVoiceDropdown(false); }}
                              className={`w-full px-3 py-2.5 text-left hover:bg-slate-800 border-b border-slate-800 ${!elVoiceId ? 'bg-purple-600/20' : ''}`}>
                              <div className="font-bold text-xs text-slate-300">🔄 기본값 (Adam)</div>
                            </button>
                            {/* 안정적인 음성 */}
                            <div className="px-3 py-1 bg-slate-800/60 text-[10px] font-bold text-green-400 border-b border-slate-800">✅ 안정적인 음성</div>
                            {filteredDefaultVoices.map((voice) => (
                              <div key={voice.id} className={`flex items-center gap-2 px-3 py-2 border-b border-slate-800/50 hover:bg-slate-800 ${elVoiceId === voice.id ? 'bg-purple-600/20' : ''}`}>
                                <button type="button" onClick={(e) => playDefaultVoicePreview(e, voice)}
                                  className={`w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center transition-colors ${playingVoiceId === voice.id ? 'bg-purple-500 text-white animate-pulse' : 'bg-slate-700 text-slate-400 hover:bg-purple-600 hover:text-white'}`}>
                                  {playingVoiceId === voice.id ? <PauseIcon /> : <PlayIcon />}
                                </button>
                                <button type="button" onClick={() => { setElVoiceId(voice.id); localStorage.setItem(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID, voice.id); setShowVoiceDropdown(false); }} className="flex-1 text-left">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-bold text-xs text-white">{voice.name}</span>
                                    <span className={`text-[9px] px-1.5 rounded-full font-bold ${voice.gender === 'female' ? 'bg-pink-500/20 text-pink-400' : 'bg-blue-500/20 text-blue-400'}`}>
                                      {voice.gender === 'female' ? '여' : '남'}
                                    </span>
                                  </div>
                                  <div className="text-[10px] text-slate-500 line-clamp-1">{voice.description}</div>
                                </button>
                                {elVoiceId === voice.id && <span className="text-purple-400"><CheckIcon /></span>}
                              </div>
                            ))}
                            {/* API 음성 목록 */}
                            {filteredApiVoices.length > 0 && (
                              <>
                                <div className="px-3 py-1 bg-slate-800/60 text-[10px] font-bold text-amber-400 border-b border-slate-800">📂 내 라이브러리</div>
                                {filteredApiVoices.map((voice) => (
                                  <div key={voice.voice_id} className={`flex items-center gap-2 px-3 py-2 border-b border-slate-800/50 hover:bg-slate-800 ${elVoiceId === voice.voice_id ? 'bg-purple-600/20' : ''}`}>
                                    <button type="button" onClick={(e) => playVoicePreview(e, voice)}
                                      className={`w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center transition-colors ${playingVoiceId === voice.voice_id ? 'bg-amber-500 text-white animate-pulse' : 'bg-slate-700 text-slate-400 hover:bg-amber-600 hover:text-white'}`}>
                                      {playingVoiceId === voice.voice_id ? <PauseIcon /> : <PlayIcon />}
                                    </button>
                                    <button type="button" onClick={() => selectVoice(voice)} className="flex-1 text-left">
                                      <div className="font-bold text-xs text-white">{voice.name}</div>
                                      <div className="text-[10px] text-slate-500">{voice.category}</div>
                                    </button>
                                    {elVoiceId === voice.voice_id && <span className="text-purple-400"><CheckIcon /></span>}
                                  </div>
                                ))}
                              </>
                            )}
                            {/* 직접 입력 */}
                            <div className="p-2.5 bg-slate-800/80 border-t border-slate-700">
                              <input type="text" value={elVoiceId} onChange={(e) => setElVoiceId(e.target.value)}
                                placeholder="Voice ID 직접 입력..."
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:border-purple-500 focus:outline-none" />
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {/* TTS 모델 */}
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-wider">TTS 모델 <span className="text-green-400 normal-case">(자막 지원)</span></label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {ELEVENLABS_MODELS.filter(m => m.supportsTimestamp).map((model) => (
                        <button key={model.id} type="button" onClick={() => setElModelId(model.id)}
                          className={`p-2 rounded-xl border text-left transition-all ${elModelId === model.id ? 'bg-purple-600/20 border-purple-500 text-white' : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600'}`}>
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-[10px]">{model.name}</span>
                            <span className="text-[8px] px-1 py-0.5 rounded bg-green-500/20 text-green-400">자막OK</span>
                          </div>
                          <div className="text-[9px] opacity-70 mt-0.5">{model.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ElevenLabs 음성 파라미터 */}
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between mb-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">안정성</label>
                        <span className="text-[10px] text-slate-500">{voiceStability}% {voiceStability < 30 ? '(감성적)' : voiceStability > 70 ? '(안정적)' : '(균형)'}</span>
                      </div>
                      <input type="range" min={0} max={100} value={voiceStability} onChange={e => changeVoiceStability(Number(e.target.value))}
                        className="w-full accent-purple-500" />
                    </div>
                    <div>
                      <div className="flex justify-between mb-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">표현력</label>
                        <span className="text-[10px] text-slate-500">{voiceStyle}% {voiceStyle < 30 ? '(차분)' : voiceStyle > 70 ? '(드라마틱)' : '(자연스러움)'}</span>
                      </div>
                      <input type="range" min={0} max={100} value={voiceStyle} onChange={e => changeVoiceStyle(Number(e.target.value))}
                        className="w-full accent-purple-500" />
                    </div>
                  </div>

                  <button type="button" onClick={saveElevenLabsSettings}
                    className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 rounded-xl text-xs transition-colors">
                    설정 저장
                  </button>
                </div>
              )}

              {/* Google TTS */}
              {voiceSubTab === 'google' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      {([null, 'male', 'female'] as const).map((g) => (
                        <button key={String(g)} type="button" onClick={() => setGeminiTtsGenderFilter(g)}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors ${geminiTtsGenderFilter === g ? (g === 'male' ? 'bg-blue-600 text-white' : g === 'female' ? 'bg-pink-600 text-white' : 'bg-slate-600 text-white') : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                          {g === null ? '전체' : g === 'male' ? '남성' : '여성'}
                        </button>
                      ))}
                    </div>
                    <span className="ml-auto text-[10px] text-slate-500">선택: <span className="text-teal-400 font-bold">{geminiTtsVoice}</span></span>
                  </div>

                  <p className="text-[10px] text-slate-500">▶ 미리듣기 · 이름 클릭으로 선택 (ElevenLabs 미설정 시 자동 사용)</p>

                  <div className="grid grid-cols-2 gap-1.5">
                    {GEMINI_TTS_VOICES.filter(v => geminiTtsGenderFilter === null || v.gender === geminiTtsGenderFilter).map((voice) => (
                      <div key={voice.id}
                        className={`flex items-center gap-2 p-2 rounded-xl border transition-all ${geminiTtsVoice === voice.id ? 'bg-teal-600/20 border-teal-500' : 'bg-slate-800/50 border-slate-700 hover:border-slate-500'}`}>
                        {/* 미리듣기 버튼 */}
                        <button type="button" onClick={() => playGeminiTtsPreview(voice.id)}
                          className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${playingGeminiVoiceId === voice.id ? 'bg-teal-500 text-white animate-pulse' : 'bg-slate-700 text-slate-400 hover:bg-teal-600 hover:text-white'}`}>
                          {playingGeminiVoiceId === voice.id ? <PauseIcon /> : <PlayIcon />}
                        </button>
                        {/* 음성 정보 + 선택 */}
                        <button type="button"
                          onClick={() => { setGeminiTtsVoice(voice.id); localStorage.setItem(CONFIG.STORAGE_KEYS.GEMINI_TTS_VOICE, voice.id); }}
                          className="flex-1 text-left min-w-0">
                          <div className="flex items-center gap-1">
                            <span className={`text-[9px] font-bold px-1 py-0.5 rounded flex-shrink-0 ${voice.gender === 'male' ? 'bg-blue-500/20 text-blue-400' : 'bg-pink-500/20 text-pink-400'}`}>
                              {voice.gender === 'male' ? '남' : '여'}
                            </span>
                            <span className="font-bold text-xs text-white truncate">{voice.name}</span>
                            {geminiTtsVoice === voice.id && <span className="text-teal-400 flex-shrink-0 ml-auto"><CheckIcon /></span>}
                          </div>
                          <div className="text-[9px] text-slate-500 line-clamp-1 mt-0.5">{voice.description}</div>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── 📁 프로젝트 탭 ── */}
          {settingsTab === 'project' && (
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-wider">새 프로젝트 저장</label>
                <div className="flex gap-2">
                  <input type="text" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="프로젝트 이름..."
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-amber-500 focus:outline-none"
                    onKeyDown={(e) => e.key === 'Enter' && saveProject()} />
                  <button type="button" onClick={saveProject} disabled={!newProjectName.trim()}
                    className="px-3 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-colors">저장</button>
                </div>
              </div>

              {projects.length > 0 ? (
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">저장된 프로젝트 ({projects.length}개)</label>
                  {projects.map((project) => (
                    <div key={project.id} className="flex items-center gap-2 p-2.5 bg-slate-800/50 rounded-xl border border-slate-700">
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-xs text-white truncate">{project.name}</div>
                        <div className="text-[10px] text-slate-500">{new Date(project.updatedAt).toLocaleDateString('ko-KR')}</div>
                      </div>
                      <button type="button" onClick={() => loadProject(project)} className="px-2 py-1 text-[10px] bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">불러오기</button>
                      <button type="button" onClick={() => updateProject(project)} className="px-2 py-1 text-[10px] bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition-colors">덮어쓰기</button>
                      <button type="button" onClick={() => deleteProject(project.id)} className="px-2 py-1 text-[10px] bg-red-600/50 hover:bg-red-500 text-white rounded-lg transition-colors">삭제</button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-slate-500 text-xs py-6">저장된 프로젝트가 없습니다.<br />현재 설정을 저장해보세요.</p>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default InputSection;
