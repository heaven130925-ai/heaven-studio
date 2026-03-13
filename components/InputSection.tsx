
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { GenerationStep, ProjectSettings, ReferenceImages, DEFAULT_REFERENCE_IMAGES } from '../types';
import { CONFIG, ELEVENLABS_MODELS, ElevenLabsModelId, IMAGE_MODELS, ImageModelId, GEMINI_STYLE_CATEGORIES, GeminiStyleId, ELEVENLABS_DEFAULT_VOICES, VoiceGender, GEMINI_TTS_VOICES, GeminiTtsVoiceId, VISUAL_STYLES, VisualStyleId } from '../config';
import { getElevenLabsModelId, setElevenLabsModelId, fetchElevenLabsVoices, ElevenLabsVoice } from '../services/elevenLabsService';
import { generateGeminiTtsPreview } from '../services/geminiService';

const GEMINI_STYLE_MAP = new Map<string, { id: string; name: string; category: string; prompt: string }>();
GEMINI_STYLE_CATEGORIES.forEach(cat => cat.styles.forEach(s => GEMINI_STYLE_MAP.set(s.id, { ...s, category: cat.name })));

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

// 아코디언 섹션 컴포넌트
const Section: React.FC<{ title: string; defaultOpen?: boolean; children: React.ReactNode; badge?: string }> = ({ title, defaultOpen = false, children, badge }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-800 rounded-xl overflow-hidden">
      <button type="button" onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-800/40 hover:bg-slate-800/60 transition-colors">
        <div className="flex items-center gap-2">
          <span className="text-xs font-black text-slate-300 uppercase tracking-wider">{title}</span>
          {badge && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-brand-500/20 text-brand-400 border border-brand-500/30 font-bold">{badge}</span>}
        </div>
        <svg className={`w-4 h-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="p-4 space-y-3 bg-slate-900/40">{children}</div>}
    </div>
  );
};

const InputSection: React.FC<InputSectionProps> = ({ onGenerate, onExtractCharacters, step }) => {
  const [activeTab, setActiveTab] = useState<'auto' | 'manual'>('auto');
  const [topic, setTopic] = useState('');
  const [manualScript, setManualScript] = useState('');
  const [sceneCount, setSceneCount] = useState<number>(0);

  // 비주얼 스타일
  const [visualStyleId, setVisualStyleId] = useState<VisualStyleId>(
    (localStorage.getItem(CONFIG.STORAGE_KEYS.VISUAL_STYLE_ID) as VisualStyleId) || 'none'
  );

  // 참조 이미지
  const [characterRefImages, setCharacterRefImages] = useState<string[]>([]);
  const [styleRefImages, setStyleRefImages] = useState<string[]>([]);
  const [characterStrength, setCharacterStrength] = useState(DEFAULT_REFERENCE_IMAGES.characterStrength);
  const [styleStrength, setStyleStrength] = useState(DEFAULT_REFERENCE_IMAGES.styleStrength);

  // 이미지 설정
  const [imageModelId, setImageModelId] = useState<ImageModelId>('gemini-2.5-flash-image');
  const [geminiStyleId, setGeminiStyleId] = useState<GeminiStyleId>('gemini-none');
  const [geminiCustomStylePrompt, setGeminiCustomStylePrompt] = useState('');
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
  const [geminiApiKey, setGeminiApiKey] = useState(localStorage.getItem('tubegen_gemini_key') || '');
  const [elApiKeyInput, setElApiKeyInput] = useState(
    localStorage.getItem(CONFIG.STORAGE_KEYS.ELEVENLABS_API_KEY) || process.env.ELEVENLABS_API_KEY || ''
  );
  const elApiKey = elApiKeyInput || process.env.ELEVENLABS_API_KEY || '';

  // ElevenLabs
  const [elVoiceId, setElVoiceId] = useState('');
  const [elModelId, setElModelId] = useState<ElevenLabsModelId>('eleven_multilingual_v2');
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [showVoiceDropdown, setShowVoiceDropdown] = useState(false);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [genderFilter, setGenderFilter] = useState<VoiceGender | null>(null);

  // 음성 공통
  const [voiceSpeed, setVoiceSpeed] = useState<string>(localStorage.getItem(CONFIG.STORAGE_KEYS.VOICE_SPEED) || '1.0');
  const [voiceStability, setVoiceStability] = useState<number>(parseInt(localStorage.getItem(CONFIG.STORAGE_KEYS.VOICE_STABILITY) || '50'));
  const [voiceStyle, setVoiceStyle] = useState<number>(parseInt(localStorage.getItem(CONFIG.STORAGE_KEYS.VOICE_STYLE) || '0'));
  const [voiceSubTab, setVoiceSubTab] = useState<'elevenlabs' | 'google'>(
    (localStorage.getItem(CONFIG.STORAGE_KEYS.TTS_PROVIDER) as 'elevenlabs' | 'google') || 'elevenlabs'
  );

  // Google TTS
  const [geminiTtsVoice, setGeminiTtsVoice] = useState<GeminiTtsVoiceId>(CONFIG.DEFAULT_GEMINI_TTS_VOICE);
  const [geminiTtsGenderFilter, setGeminiTtsGenderFilter] = useState<'male' | 'female' | null>(null);
  const [playingGeminiVoiceId, setPlayingGeminiVoiceId] = useState<string | null>(null);

  // 프로젝트
  const [projects, setProjects] = useState<ProjectSettings[]>([]);
  const [newProjectName, setNewProjectName] = useState('');

  const characterFileInputRef = useRef<HTMLInputElement>(null);
  const styleFileInputRef = useRef<HTMLInputElement>(null);
  const voiceDropdownRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const savedVoiceId = localStorage.getItem(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID) || '';
    setElVoiceId(savedVoiceId);
    setElModelId(getElevenLabsModelId());
    setImageModelId(localStorage.getItem(CONFIG.STORAGE_KEYS.IMAGE_MODEL) as ImageModelId || CONFIG.DEFAULT_IMAGE_MODEL);
    setGeminiStyleId(localStorage.getItem(CONFIG.STORAGE_KEYS.GEMINI_STYLE) as GeminiStyleId || 'gemini-none');
    setGeminiCustomStylePrompt(localStorage.getItem(CONFIG.STORAGE_KEYS.GEMINI_CUSTOM_STYLE) || '');
    setImageTextMode(localStorage.getItem(CONFIG.STORAGE_KEYS.IMAGE_TEXT_MODE) || 'none');
    setGeminiTtsVoice(localStorage.getItem(CONFIG.STORAGE_KEYS.GEMINI_TTS_VOICE) as GeminiTtsVoiceId || CONFIG.DEFAULT_GEMINI_TTS_VOICE);
    const saved = localStorage.getItem(CONFIG.STORAGE_KEYS.PROJECTS);
    if (saved) { try { setProjects(JSON.parse(saved)); } catch {} }
    if (elApiKey) loadVoices(elApiKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (voiceDropdownRef.current && !voiceDropdownRef.current.contains(e.target as Node)) setShowVoiceDropdown(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useEffect(() => { return () => { audioRef.current?.pause(); audioRef.current = null; }; }, []);

  const loadVoices = useCallback(async (apiKey?: string) => {
    const key = apiKey || elApiKey;
    if (!key || key.length < 10) return;
    setIsLoadingVoices(true);
    try { setVoices(await fetchElevenLabsVoices(key)); } catch {}
    finally { setIsLoadingVoices(false); }
  }, []);

  const selectVoice = useCallback((voice: ElevenLabsVoice) => {
    setElVoiceId(voice.voice_id);
    localStorage.setItem(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID, voice.voice_id);
    setShowVoiceDropdown(false);
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
    } catch { setPlayingGeminiVoiceId(null); }
  };

  const getSelectedVoiceInfo = useCallback(() => {
    if (!elVoiceId) return { name: '기본값 (Adam)', description: '' };
    const dv = ELEVENLABS_DEFAULT_VOICES.find(v => v.id === elVoiceId);
    if (dv) return { name: dv.name, description: dv.description };
    const av = voices.find(v => v.voice_id === elVoiceId);
    if (av) return { name: av.name, description: av.labels?.description || av.category };
    return { name: elVoiceId.slice(0, 12) + '...', description: '직접 입력' };
  }, [elVoiceId, voices]);

  const saveElSettings = () => { if (elVoiceId) localStorage.setItem(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID, elVoiceId); setElevenLabsModelId(elModelId); };
  const selectVoiceSpeed = (v: string) => { setVoiceSpeed(v); localStorage.setItem(CONFIG.STORAGE_KEYS.VOICE_SPEED, v); };
  const changeVoiceStability = (v: number) => { setVoiceStability(v); localStorage.setItem(CONFIG.STORAGE_KEYS.VOICE_STABILITY, String(v)); };
  const changeVoiceStyle = (v: number) => { setVoiceStyle(v); localStorage.setItem(CONFIG.STORAGE_KEYS.VOICE_STYLE, String(v)); };
  const selectImageModel = useCallback((id: ImageModelId) => { setImageModelId(id); localStorage.setItem(CONFIG.STORAGE_KEYS.IMAGE_MODEL, id); }, []);
  const selectGeminiStyle = useCallback((id: GeminiStyleId) => { setGeminiStyleId(id); localStorage.setItem(CONFIG.STORAGE_KEYS.GEMINI_STYLE, id); }, []);
  const selectImageTextMode = useCallback((m: string) => { setImageTextMode(m); localStorage.setItem(CONFIG.STORAGE_KEYS.IMAGE_TEXT_MODE, m); }, []);
  const saveGeminiCustomStyle = useCallback((p: string) => { setGeminiCustomStylePrompt(p); localStorage.setItem(CONFIG.STORAGE_KEYS.GEMINI_CUSTOM_STYLE, p); }, []);
  const selectAspectRatio = (r: '16:9' | '9:16') => { setAspectRatio(r); localStorage.setItem(CONFIG.STORAGE_KEYS.ASPECT_RATIO, r); };
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
    localStorage.setItem(CONFIG.STORAGE_KEYS.IMAGE_MODEL, p.imageModel); localStorage.setItem(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID, p.elevenLabsVoiceId);
    setElevenLabsModelId(p.elevenLabsModel as ElevenLabsModelId); alert(`"${p.name}" 불러오기 완료`);
  };
  const deleteProject = (id: string) => { if (!confirm('삭제?')) return; const u = projects.filter(p => p.id !== id); setProjects(u); localStorage.setItem(CONFIG.STORAGE_KEYS.PROJECTS, JSON.stringify(u)); };

  const selectedGeminiStyle = useMemo(() => {
    if (geminiStyleId === 'gemini-none') return { id: 'gemini-none', name: '없음', prompt: '' };
    if (geminiStyleId === 'gemini-custom') return { id: 'gemini-custom', name: '커스텀', prompt: geminiCustomStylePrompt };
    return GEMINI_STYLE_MAP.get(geminiStyleId) || null;
  }, [geminiStyleId, geminiCustomStylePrompt]);

  const filteredDefaultVoices = useMemo(() => !genderFilter ? ELEVENLABS_DEFAULT_VOICES : ELEVENLABS_DEFAULT_VOICES.filter(v => v.gender === genderFilter), [genderFilter]);
  const filteredApiVoices = useMemo(() => !genderFilter ? voices : voices.filter(v => v.labels?.gender?.toLowerCase() === genderFilter), [voices, genderFilter]);

  const isProcessing = step !== GenerationStep.IDLE && step !== GenerationStep.COMPLETED && step !== GenerationStep.ERROR && step !== GenerationStep.SCRIPT_READY;
  const canSubmitAuto = topic.trim().length > 0;
  const canSubmitManual = manualScript.trim().length > 0;

  const buildRefImages = useCallback((): ReferenceImages => ({ character: characterRefImages, style: styleRefImages, characterStrength, styleStrength }), [characterRefImages, styleRefImages, characterStrength, styleStrength]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault(); if (isProcessing) return;
    const refImages = buildRefImages();
    if (activeTab === 'auto') { if (canSubmitAuto) onGenerate(topic, refImages, null, sceneCount); }
    else { if (canSubmitManual) onGenerate("Manual Script Input", refImages, manualScript, sceneCount); }
  }, [isProcessing, activeTab, topic, manualScript, sceneCount, onGenerate, buildRefImages, canSubmitAuto, canSubmitManual]);

  const handleImagesOnly = useCallback(() => {
    if (isProcessing) return;
    const refImages = buildRefImages();
    if (activeTab === 'auto') { if (canSubmitAuto) onGenerate(topic, refImages, null, sceneCount, true); }
    else { if (canSubmitManual) onGenerate("Manual Script Input", refImages, manualScript, sceneCount, true); }
  }, [isProcessing, activeTab, topic, manualScript, sceneCount, onGenerate, buildRefImages, canSubmitAuto, canSubmitManual]);

  const handleCharacterImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files) return;
    const slots = 5 - characterRefImages.length;
    (Array.from(files) as File[]).slice(0, slots).forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => setCharacterRefImages(prev => [...prev, reader.result as string].slice(0, 5));
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
  return (
    <div className="w-full max-w-6xl mx-auto my-6 px-4">

      {/* 타이틀 */}
      <div className="text-center mb-6">
        <h1 className="text-3xl font-black tracking-tight text-white">
          Heaven <span className="text-brand-500">Studio</span>
        </h1>
        <p className="text-slate-500 text-xs tracking-widest mt-1 uppercase">AI Content Generator</p>
      </div>

      {/* ── 메인 2컬럼 레이아웃 ─────────────────────────── */}
      <div className="flex gap-4 items-start">

        {/* ════ 왼쪽: 설정 패널 (스크롤 가능) ════ */}
        <div className="flex-none w-80 space-y-2 overflow-y-auto" style={{ maxHeight: '80vh' }}>

          {/* 🎨 비주얼 스타일 */}
          <Section title="🎨 비주얼 스타일" defaultOpen={true} badge={visualStyleId !== 'none' ? VISUAL_STYLES.find(s => s.id === visualStyleId)?.name : undefined}>
            <div className="grid grid-cols-5 gap-1">
              {VISUAL_STYLES.map(style => (
                <button key={style.id} type="button" onClick={() => selectVisualStyle(style.id as VisualStyleId)}
                  className={`relative flex flex-col items-center gap-0.5 p-1.5 rounded-lg border transition-all ${visualStyleId === style.id ? 'border-brand-400 bg-brand-500/10' : 'border-slate-700 hover:border-slate-500'}`}>
                  <div className={`w-full aspect-video rounded bg-gradient-to-br ${style.bg} flex items-center justify-center text-base`}>{style.emoji}</div>
                  <span className="text-[8px] font-bold text-slate-300 leading-tight text-center line-clamp-1">{style.name}</span>
                  {visualStyleId === style.id && (
                    <div className="absolute top-0.5 right-0.5 w-2.5 h-2.5 bg-brand-500 rounded-full flex items-center justify-center">
                      <CheckIcon />
                    </div>
                  )}
                </button>
              ))}
            </div>
            {visualStyleId !== 'none' && (
              <button type="button" onClick={() => selectVisualStyle('none')} className="text-[10px] text-slate-500 hover:text-red-400 transition-colors">✕ 선택 해제</button>
            )}
          </Section>

          {/* 🖼️ 이미지 설정 */}
          <Section title="🖼️ 이미지 설정">
            {/* 이미지 모델 */}
            <div>
              <p className="text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">이미지 모델</p>
              <div className="space-y-1">
                {IMAGE_MODELS.map(m => (
                  <button key={m.id} type="button" onClick={() => selectImageModel(m.id)}
                    className={`w-full p-2.5 rounded-lg border text-left transition-all ${imageModelId === m.id ? 'bg-blue-600/20 border-blue-500 text-white' : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600'}`}>
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-xs">{m.name}</span>
                      <span className="text-green-400 text-[10px] font-bold">${m.pricePerImage.toFixed(4)}</span>
                    </div>
                    <div className="text-[9px] opacity-60 mt-0.5">{m.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 이미지 글씨 */}
            <div>
              <p className="text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">이미지 글씨</p>
              <div className="grid grid-cols-4 gap-1">
                {([{ id: 'none', label: '없음' }, { id: 'english', label: '영어' }, { id: 'numbers', label: '숫자' }, { id: 'auto', label: '자동' }] as const).map(({ id, label }) => (
                  <button key={id} type="button" onClick={() => selectImageTextMode(id)}
                    className={`py-1.5 rounded-lg text-[10px] font-bold transition-colors ${imageTextMode === id ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Gemini 화풍 */}
            {imageModelId === 'gemini-2.5-flash-image' && (
              <div>
                <p className="text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                  화풍 {selectedGeminiStyle?.id !== 'gemini-none' && <span className="text-emerald-400 normal-case">({selectedGeminiStyle?.name})</span>}
                </p>
                <div className="flex flex-wrap gap-1">
                  <button type="button" onClick={() => selectGeminiStyle('gemini-none')}
                    className={`px-2 py-1 rounded text-[10px] font-medium ${geminiStyleId === 'gemini-none' ? 'bg-slate-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>없음</button>
                  {GEMINI_STYLE_CATEGORIES.flatMap(c => c.styles).map(s => (
                    <button key={s.id} type="button" onClick={() => selectGeminiStyle(s.id as GeminiStyleId)}
                      className={`px-2 py-1 rounded text-[10px] font-medium ${geminiStyleId === s.id ? 'bg-emerald-500 text-white' : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700'}`}>{s.name}</button>
                  ))}
                  <button type="button" onClick={() => selectGeminiStyle('gemini-custom')}
                    className={`px-2 py-1 rounded text-[10px] font-medium ${geminiStyleId === 'gemini-custom' ? 'bg-teal-500 text-white' : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700'}`}>✏️ 커스텀</button>
                </div>
                {geminiStyleId === 'gemini-custom' && (
                  <textarea value={geminiCustomStylePrompt} onChange={(e) => saveGeminiCustomStyle(e.target.value)}
                    placeholder="Art style description in English..."
                    className="mt-1.5 w-full h-16 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-[10px] text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none resize-none" />
                )}
              </div>
            )}

            {/* 참조 이미지 */}
            <div>
              <p className="text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">참조 이미지 (각 최대 5장)</p>
              <div className="grid grid-cols-2 gap-2">
                {/* 캐릭터 */}
                <div className="p-2.5 bg-slate-800/50 rounded-lg border border-slate-700">
                  <p className="text-[10px] font-bold text-white mb-1.5">🧑 캐릭터</p>
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {characterRefImages.map((img, i) => (
                      <div key={i} className="relative group w-12 h-9 rounded overflow-hidden border border-violet-500/50">
                        <img src={img} alt="" className="w-full h-full object-cover" />
                        <button onClick={() => setCharacterRefImages(prev => prev.filter((_, idx) => idx !== i))}
                          className="absolute inset-0 bg-red-500/70 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] font-bold">✕</button>
                      </div>
                    ))}
                    {characterRefImages.length < 5 && (
                      <button type="button" onClick={() => characterFileInputRef.current?.click()}
                        className="w-12 h-9 border-2 border-dashed border-slate-600 rounded flex items-center justify-center text-slate-500 hover:border-violet-500 hover:text-violet-400">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                      </button>
                    )}
                    <input type="file" ref={characterFileInputRef} onChange={handleCharacterImageChange} accept="image/*" className="hidden" multiple />
                  </div>
                  {characterRefImages.length > 0 && (
                    <div className="mt-1.5">
                      <div className="flex justify-between text-[9px] mb-0.5"><span className="text-slate-400">강도</span><span className="text-violet-400">{characterStrength}%</span></div>
                      <input type="range" min={0} max={100} value={characterStrength} onChange={(e) => setCharacterStrength(+e.target.value)} className="w-full h-1 bg-slate-700 rounded appearance-none cursor-pointer accent-violet-500" />
                    </div>
                  )}
                </div>

                {/* 화풍 */}
                <div className="p-2.5 bg-slate-800/50 rounded-lg border border-slate-700">
                  <p className="text-[10px] font-bold text-white mb-1.5">🎨 화풍</p>
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {styleRefImages.map((img, i) => (
                      <div key={i} className="relative group w-12 h-9 rounded overflow-hidden border border-fuchsia-500/50">
                        <img src={img} alt="" className="w-full h-full object-cover" />
                        <button onClick={() => setStyleRefImages(prev => prev.filter((_, idx) => idx !== i))}
                          className="absolute inset-0 bg-red-500/70 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] font-bold">✕</button>
                      </div>
                    ))}
                    {styleRefImages.length < 5 && (
                      <button type="button" onClick={() => styleFileInputRef.current?.click()}
                        className="w-12 h-9 border-2 border-dashed border-slate-600 rounded flex items-center justify-center text-slate-500 hover:border-fuchsia-500 hover:text-fuchsia-400">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                      </button>
                    )}
                    <input type="file" ref={styleFileInputRef} onChange={handleStyleImageChange} accept="image/*" className="hidden" multiple />
                  </div>
                  {styleRefImages.length > 0 && (
                    <div className="mt-1.5">
                      <div className="flex justify-between text-[9px] mb-0.5"><span className="text-slate-400">강도</span><span className="text-fuchsia-400">{styleStrength}%</span></div>
                      <input type="range" min={0} max={100} value={styleStrength} onChange={(e) => setStyleStrength(+e.target.value)} className="w-full h-1 bg-slate-700 rounded appearance-none cursor-pointer accent-fuchsia-500" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Section>

          {/* 🎙️ 음성 설정 */}
          <Section title="🎙️ 음성 설정">
            <div>
              <p className="text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">말하기 속도</p>
              <div className="flex gap-1.5">
                {[['0.7', '느림'], ['1.0', '보통'], ['1.3', '빠름']].map(([val, label]) => (
                  <button key={val} type="button" onClick={() => selectVoiceSpeed(val)}
                    className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold ${voiceSpeed === val ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-1.5">
              <button type="button" onClick={() => { setVoiceSubTab('elevenlabs'); localStorage.setItem(CONFIG.STORAGE_KEYS.TTS_PROVIDER, 'elevenlabs'); }}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold ${voiceSubTab === 'elevenlabs' ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                ElevenLabs {elApiKey ? '✅' : '⚠️'}
              </button>
              <button type="button" onClick={() => { setVoiceSubTab('google'); localStorage.setItem(CONFIG.STORAGE_KEYS.TTS_PROVIDER, 'google'); }}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold ${voiceSubTab === 'google' ? 'bg-teal-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                Google TTS ✅
              </button>
            </div>

            {voiceSubTab === 'elevenlabs' && (
              <div className="space-y-2">
                {!elApiKey && <p className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2 py-1.5">⚠️ API 키 없음 → Google TTS 사용</p>}
                {elApiKey && (
                  <>
                    <div className="flex items-center gap-1.5">
                      {([null, 'male', 'female'] as const).map((g) => (
                        <button key={String(g)} type="button" onClick={() => setGenderFilter(g)}
                          className={`px-2 py-0.5 rounded text-[9px] font-bold ${genderFilter === g ? (g === 'male' ? 'bg-blue-600 text-white' : g === 'female' ? 'bg-pink-600 text-white' : 'bg-slate-600 text-white') : 'bg-slate-800 text-slate-400'}`}>
                          {g === null ? '전체' : g === 'male' ? '남' : '여'}
                        </button>
                      ))}
                      <button type="button" onClick={() => loadVoices()} disabled={isLoadingVoices}
                        className="ml-auto text-[9px] bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 px-2 py-0.5 rounded font-bold">
                        {isLoadingVoices ? '...' : '불러오기'}
                      </button>
                    </div>

                    <div ref={voiceDropdownRef} className="relative">
                      <button type="button" onClick={() => setShowVoiceDropdown(!showVoiceDropdown)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-left flex items-center justify-between hover:border-purple-500/50">
                        <span className="text-xs text-white font-medium">{getSelectedVoiceInfo().name}</span>
                        <svg className={`w-3.5 h-3.5 text-slate-500 transition-transform ${showVoiceDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </button>
                      {showVoiceDropdown && (
                        <div className="absolute z-50 w-full mt-1 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-h-56 overflow-y-auto">
                          <button type="button" onClick={() => { setElVoiceId(''); localStorage.removeItem(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID); setShowVoiceDropdown(false); }}
                            className={`w-full px-3 py-2 text-left text-[10px] font-bold text-slate-300 hover:bg-slate-800 border-b border-slate-800 ${!elVoiceId ? 'bg-purple-600/20' : ''}`}>🔄 기본값 (Adam)</button>
                          {filteredDefaultVoices.map(voice => (
                            <div key={voice.id} className={`flex items-center gap-1.5 px-2 py-1.5 border-b border-slate-800/50 hover:bg-slate-800 ${elVoiceId === voice.id ? 'bg-purple-600/20' : ''}`}>
                              <button type="button" onClick={(e) => { e.stopPropagation(); playElevenLabsPreview(voice.id, voice.name); }}
                                className={`w-6 h-6 flex-shrink-0 rounded-full flex items-center justify-center ${playingVoiceId === voice.id ? 'bg-purple-500 text-white animate-pulse' : 'bg-slate-700 text-slate-400 hover:bg-purple-600 hover:text-white'}`}>
                                {playingVoiceId === voice.id ? <PauseIcon /> : <PlayIcon />}
                              </button>
                              <button type="button" onClick={() => { setElVoiceId(voice.id); localStorage.setItem(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID, voice.id); setShowVoiceDropdown(false); }} className="flex-1 text-left">
                                <span className="font-bold text-[10px] text-white">{voice.name}</span>
                                <span className={`ml-1 text-[8px] px-1 rounded-full ${voice.gender === 'female' ? 'bg-pink-500/20 text-pink-400' : 'bg-blue-500/20 text-blue-400'}`}>{voice.gender === 'female' ? '여' : '남'}</span>
                              </button>
                              {elVoiceId === voice.id && <CheckIcon />}
                            </div>
                          ))}
                          {filteredApiVoices.length > 0 && filteredApiVoices.map(voice => (
                            <div key={voice.voice_id} className={`flex items-center gap-1.5 px-2 py-1.5 border-b border-slate-800/50 hover:bg-slate-800 ${elVoiceId === voice.voice_id ? 'bg-purple-600/20' : ''}`}>
                              <button type="button" onClick={(e) => { e.stopPropagation(); playElevenLabsPreview(voice.voice_id, voice.name); }}
                                className={`w-6 h-6 flex-shrink-0 rounded-full flex items-center justify-center ${playingVoiceId === voice.voice_id ? 'bg-amber-500 text-white animate-pulse' : 'bg-slate-700 text-slate-400 hover:bg-amber-600 hover:text-white'}`}>
                                {playingVoiceId === voice.voice_id ? <PauseIcon /> : <PlayIcon />}
                              </button>
                              <button type="button" onClick={() => selectVoice(voice)} className="flex-1 text-left">
                                <span className="font-bold text-[10px] text-white">{voice.name}</span>
                              </button>
                              {elVoiceId === voice.voice_id && <CheckIcon />}
                            </div>
                          ))}
                          <div className="p-2 border-t border-slate-700">
                            <input type="text" value={elVoiceId} onChange={(e) => setElVoiceId(e.target.value)} placeholder="Voice ID 직접 입력..."
                              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] text-white placeholder-slate-600 focus:border-purple-500 focus:outline-none" />
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-1">
                      {ELEVENLABS_MODELS.filter(m => m.supportsTimestamp).map(m => (
                        <button key={m.id} type="button" onClick={() => setElModelId(m.id)}
                          className={`p-2 rounded-lg border text-left text-[9px] ${elModelId === m.id ? 'bg-purple-600/20 border-purple-500 text-white' : 'bg-slate-800/50 border-slate-700 text-slate-400'}`}>
                          <div className="font-bold">{m.name}</div>
                        </button>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <div>
                        <div className="flex justify-between text-[9px] mb-0.5"><span className="text-slate-400">안정성</span><span className="text-slate-500">{voiceStability}%</span></div>
                        <input type="range" min={0} max={100} value={voiceStability} onChange={e => changeVoiceStability(+e.target.value)} className="w-full accent-purple-500" />
                      </div>
                      <div>
                        <div className="flex justify-between text-[9px] mb-0.5"><span className="text-slate-400">표현력</span><span className="text-slate-500">{voiceStyle}%</span></div>
                        <input type="range" min={0} max={100} value={voiceStyle} onChange={e => changeVoiceStyle(+e.target.value)} className="w-full accent-purple-500" />
                      </div>
                    </div>
                    <button type="button" onClick={saveElSettings} className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-1.5 rounded-lg text-[10px]">설정 저장</button>
                  </>
                )}
              </div>
            )}

            {voiceSubTab === 'google' && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  {([null, 'male', 'female'] as const).map((g) => (
                    <button key={String(g)} type="button" onClick={() => setGeminiTtsGenderFilter(g)}
                      className={`px-2 py-0.5 rounded text-[9px] font-bold ${geminiTtsGenderFilter === g ? (g === 'male' ? 'bg-blue-600 text-white' : g === 'female' ? 'bg-pink-600 text-white' : 'bg-slate-600 text-white') : 'bg-slate-800 text-slate-400'}`}>
                      {g === null ? '전체' : g === 'male' ? '남' : '여'}
                    </button>
                  ))}
                  <span className="ml-auto text-[9px] text-teal-400 font-bold">{geminiTtsVoice}</span>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {GEMINI_TTS_VOICES.filter(v => geminiTtsGenderFilter === null || v.gender === geminiTtsGenderFilter).map(voice => (
                    <div key={voice.id} className={`flex items-center gap-1.5 p-1.5 rounded-lg border ${geminiTtsVoice === voice.id ? 'bg-teal-600/20 border-teal-500' : 'bg-slate-800/50 border-slate-700'}`}>
                      <button type="button" onClick={() => playGeminiTtsPreview(voice.id)}
                        className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center ${playingGeminiVoiceId === voice.id ? 'bg-teal-500 text-white animate-pulse' : 'bg-slate-700 text-slate-400 hover:bg-teal-600 hover:text-white'}`}>
                        {playingGeminiVoiceId === voice.id ? <PauseIcon /> : <PlayIcon />}
                      </button>
                      <button type="button" onClick={() => { setGeminiTtsVoice(voice.id); localStorage.setItem(CONFIG.STORAGE_KEYS.GEMINI_TTS_VOICE, voice.id); }} className="flex-1 text-left min-w-0">
                        <div className="flex items-center gap-1">
                          <span className={`text-[8px] font-bold px-0.5 rounded ${voice.gender === 'male' ? 'text-blue-400' : 'text-pink-400'}`}>{voice.gender === 'male' ? '남' : '여'}</span>
                          <span className="text-[10px] font-bold text-white truncate">{voice.name}</span>
                        </div>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Section>

          {/* 📐 포맷 */}
          <Section title="📐 영상 포맷">
            <div>
              <p className="text-[10px] font-bold text-slate-500 mb-2 uppercase tracking-wider">화면 비율</p>
              <div className="flex gap-2">
                {([['16:9', '롱폼', '가로'], ['9:16', '숏츠', '세로']] as const).map(([ratio, label, sub]) => (
                  <button key={ratio} type="button" onClick={() => selectAspectRatio(ratio)}
                    className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 transition-all ${aspectRatio === ratio ? 'border-brand-500 bg-brand-600/10 text-white' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                    <div className={`border-2 rounded ${ratio === '16:9' ? 'w-10 h-6' : 'w-4 h-6'} ${aspectRatio === ratio ? 'border-brand-400' : 'border-slate-600'}`} />
                    <div className="text-xs font-black">{ratio}</div>
                    <div className="text-[9px] opacity-70">{label} · {sub}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[10px] font-bold text-slate-500 mb-2 uppercase tracking-wider">씬당 표시 시간 <span className="normal-case text-slate-600 font-normal">(음성 없는 경우)</span></p>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-800/50 rounded-lg border border-slate-700 p-3">
                  <div className="flex items-center gap-1 mb-1.5">
                    <div className="w-5 h-3 border border-slate-400 rounded-sm" />
                    <span className="text-[10px] font-bold text-white">롱폼</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input type="number" min={1} max={60} value={longformDuration}
                      onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) changeLongformDuration(v); }}
                      className="w-14 bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-base font-black text-white text-center focus:border-brand-500 focus:outline-none" />
                    <span className="text-xs text-slate-400 font-bold">분</span>
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-lg border border-slate-700 p-3">
                  <div className="flex items-center gap-1 mb-1.5">
                    <div className="w-3 h-5 border border-slate-400 rounded-sm" />
                    <span className="text-[10px] font-bold text-white">숏츠</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input type="number" min={1} max={60} value={shortformDuration}
                      onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) changeShortformDuration(v); }}
                      className="w-14 bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-base font-black text-white text-center focus:border-brand-500 focus:outline-none" />
                    <span className="text-xs text-slate-400 font-bold">초</span>
                  </div>
                </div>
              </div>
              <p className="text-[9px] text-slate-600 mt-1">* TTS 음성이 있으면 음성 길이를 따릅니다</p>
            </div>
          </Section>

          {/* 🔑 API 키 */}
          <Section title="🔑 API 키" badge={geminiApiKey ? '✅' : '⚠️ 미설정'}>
            <div className="space-y-3">
              {[
                { label: 'Gemini API 키', key: 'tubegen_gemini_key', placeholder: 'AIza...', color: 'brand', required: true, value: geminiApiKey, onChange: setGeminiApiKey, onSave: () => { localStorage.setItem('tubegen_gemini_key', geminiApiKey.trim()); alert('저장됨'); } },
                { label: 'ElevenLabs API 키', key: CONFIG.STORAGE_KEYS.ELEVENLABS_API_KEY, placeholder: 'sk_...', color: 'purple', required: false, value: elApiKeyInput, onChange: setElApiKeyInput, onSave: () => { localStorage.setItem(CONFIG.STORAGE_KEYS.ELEVENLABS_API_KEY, elApiKeyInput.trim()); if (elApiKeyInput.trim()) loadVoices(elApiKeyInput.trim()); alert('저장됨'); } },
              ].map(({ label, placeholder, required, value, onChange, onSave }) => (
                <div key={label}>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-wider">{label} {required && <span className="text-red-400 normal-case">*필수</span>}</label>
                  <div className="flex gap-1.5">
                    <input type="password" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
                      className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:border-brand-500 focus:outline-none" />
                    <button type="button" onClick={onSave} className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-[10px] font-bold rounded-lg">저장</button>
                  </div>
                  {value ? <p className="text-[9px] text-green-500 mt-0.5">✅ 설정됨</p> : required && <p className="text-[9px] text-red-400 mt-0.5">⚠️ 필수</p>}
                </div>
              ))}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-wider">FAL.ai API 키 <span className="normal-case font-normal text-slate-600">(선택)</span></label>
                <input type="password" defaultValue={localStorage.getItem(CONFIG.STORAGE_KEYS.FAL_API_KEY) || ''} onChange={e => localStorage.setItem(CONFIG.STORAGE_KEYS.FAL_API_KEY, e.target.value)} placeholder="fal_..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:border-orange-500 focus:outline-none" />
                <p className="text-[9px] text-slate-600 mt-0.5">입력 즉시 자동 저장</p>
              </div>
            </div>
          </Section>

          {/* 📁 프로젝트 */}
          <Section title="📁 프로젝트">
            <div className="flex gap-1.5">
              <input type="text" value={newProjectName} onChange={e => setNewProjectName(e.target.value)} placeholder="프로젝트 이름..."
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:border-amber-500 focus:outline-none"
                onKeyDown={e => e.key === 'Enter' && saveProject()} />
              <button type="button" onClick={saveProject} disabled={!newProjectName.trim()} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-[10px] font-bold rounded-lg">저장</button>
            </div>
            {projects.map(p => (
              <div key={p.id} className="flex items-center gap-1.5 p-2 bg-slate-800/50 rounded-lg border border-slate-700">
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-[10px] text-white truncate">{p.name}</div>
                  <div className="text-[9px] text-slate-500">{new Date(p.updatedAt).toLocaleDateString('ko-KR')}</div>
                </div>
                <button type="button" onClick={() => loadProject(p)} className="px-2 py-0.5 text-[9px] bg-blue-600 hover:bg-blue-500 text-white rounded">불러오기</button>
                <button type="button" onClick={() => deleteProject(p.id)} className="px-2 py-0.5 text-[9px] bg-red-600/50 hover:bg-red-500 text-white rounded">삭제</button>
              </div>
            ))}
            {projects.length === 0 && <p className="text-[10px] text-slate-600 text-center py-2">저장된 프로젝트 없음</p>}
          </Section>
        </div>

        {/* ════ 오른쪽: 대본 입력 패널 ════ */}
        <div className="flex-1 flex flex-col gap-4">

          {/* 탭 선택 */}
          <div className="flex gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
            <button type="button" onClick={() => setActiveTab('auto')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-black transition-all ${activeTab === 'auto' ? 'bg-brand-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
              주제 자동생성
            </button>
            <button type="button" onClick={() => setActiveTab('manual')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-black transition-all ${activeTab === 'manual' ? 'bg-brand-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
              수동 대본
            </button>
          </div>

          {/* 입력 폼 */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 flex-1">
            {activeTab === 'auto' ? (
              <div className="space-y-3">
                <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
                  <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} disabled={isProcessing}
                    placeholder="주제를 입력하세요 (예: 예수님 탄생, 우주의 신비, 한국의 역사...)"
                    className="block w-full bg-transparent text-slate-100 py-4 px-5 focus:ring-0 focus:outline-none placeholder-slate-600 text-base disabled:opacity-50" />
                  <div className="px-5 pb-3 text-[10px] text-slate-600">
                    입력한 주제로 AI가 대본을 자동으로 생성합니다.
                  </div>
                </div>

                {/* 씬 수 */}
                <div className="flex items-center gap-3 px-1">
                  <label className="text-xs font-bold text-slate-400 whitespace-nowrap">씬 수</label>
                  <input type="number" min={0} max={500}
                    value={sceneCount === 0 ? '' : sceneCount}
                    onChange={(e) => { const v = parseInt(e.target.value, 10); setSceneCount(isNaN(v) || v < 0 ? 0 : v); }}
                    placeholder="자동"
                    className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-brand-500 focus:outline-none text-center" />
                  <span className="text-[10px] text-slate-500">{sceneCount > 0 ? `${sceneCount}씬 고정` : 'AI 자동 결정'}</span>
                </div>

                {/* 메인 생성 버튼 */}
                <button type="submit" disabled={isProcessing || !canSubmitAuto}
                  className="w-full bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white font-black py-4 rounded-2xl transition-all text-lg tracking-wide shadow-lg shadow-brand-500/20">
                  {isProcessing ? '생성 중...' : '▶ 대본 생성 시작'}
                </button>

                {/* 보조 버튼들 */}
                <div className="flex gap-2">
                  <button type="button" onClick={handleImagesOnly} disabled={isProcessing || !canSubmitAuto}
                    className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-bold transition-all">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    이미지만 생성
                  </button>
                  {onExtractCharacters && (
                    <button type="button" onClick={() => topic.trim() && onExtractCharacters(topic)} disabled={isProcessing || !canSubmitAuto}
                      className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-bold transition-all">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                      캐릭터 추출
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3 flex-1 flex flex-col">
                <div className="flex-1 bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden flex flex-col">
                  <textarea value={manualScript} onChange={(e) => setManualScript(e.target.value)} disabled={isProcessing}
                    placeholder="여기에 대본을 붙여넣거나 직접 작성하세요.

예)
나레이션 1: 옛날 옛적, 베들레헴의 한 작은 마을에...
나레이션 2: 동방박사들이 별을 따라 찾아왔습니다..."
                    className="flex-1 min-h-64 bg-transparent text-slate-100 p-5 focus:ring-0 focus:outline-none placeholder-slate-600 resize-none text-sm" />
                  <div className="px-5 pb-3 flex items-center justify-between border-t border-slate-800 pt-2">
                    <span className={`text-xs font-mono ${manualScript.length > 10000 ? 'text-amber-400' : manualScript.length > 3000 ? 'text-blue-400' : 'text-slate-500'}`}>
                      {manualScript.length.toLocaleString()}자
                      {manualScript.length > 100 && <span className="ml-1 text-[10px] text-slate-600">(~{Math.max(5, Math.ceil(manualScript.length / 100))}씬)</span>}
                    </span>
                    <span className="text-[10px] text-slate-600">{manualScript.length > 10000 ? '⚡ 대용량' : manualScript.length > 3000 ? '📦 청크 분할' : '일반 처리'}</span>
                  </div>
                </div>

                {/* 씬 수 */}
                <div className="flex items-center gap-3 px-1">
                  <label className="text-xs font-bold text-slate-400 whitespace-nowrap">씬 수</label>
                  <input type="number" min={0} max={500}
                    value={sceneCount === 0 ? '' : sceneCount}
                    onChange={(e) => { const v = parseInt(e.target.value, 10); setSceneCount(isNaN(v) || v < 0 ? 0 : v); }}
                    placeholder="자동"
                    className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-brand-500 focus:outline-none text-center" />
                  <span className="text-[10px] text-slate-500">{sceneCount > 0 ? `${sceneCount}씬 고정` : 'AI 자동 결정'}</span>
                </div>

                {/* 메인 생성 버튼 */}
                <button type="submit" disabled={isProcessing || !canSubmitManual}
                  className="w-full bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white font-black py-4 rounded-2xl transition-all text-lg tracking-wide shadow-lg shadow-brand-500/20">
                  {isProcessing ? '생성 중...' : '▶ 스토리보드 생성'}
                </button>

                <div className="flex gap-2">
                  <button type="button" onClick={handleImagesOnly} disabled={isProcessing || !canSubmitManual}
                    className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-bold">
                    이미지만 생성
                  </button>
                  {onExtractCharacters && (
                    <button type="button" onClick={() => manualScript.trim() && onExtractCharacters(manualScript)} disabled={isProcessing || !canSubmitManual}
                      className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-bold">
                      캐릭터 추출
                    </button>
                  )}
                </div>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
};

export default InputSection;
