
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { GenerationStep, ProjectSettings, ReferenceImages, DEFAULT_REFERENCE_IMAGES } from '../types';
import { CONFIG, ELEVENLABS_MODELS, ElevenLabsModelId, IMAGE_MODELS, ImageModelId, ELEVENLABS_DEFAULT_VOICES, VoiceGender, GEMINI_TTS_VOICES, GeminiTtsVoiceId, VISUAL_STYLES, VisualStyleId } from '../config';
import { getElevenLabsModelId, setElevenLabsModelId, fetchElevenLabsVoices, ElevenLabsVoice } from '../services/elevenLabsService';
import { generateGeminiTtsPreview, analyzeCharacterReference } from '../services/geminiService';


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
  step: GenerationStep;
  activeTab: 'auto' | 'manual';
  onTabChange: (tab: 'auto' | 'manual') => void;
  manualScript: string;
  onManualScriptChange: (v: string) => void;
  thumbnailBaseImage?: string | null;
  onThumbnailBaseImageChange?: (img: string | null) => void;
}

const InputSection: React.FC<InputSectionProps> = ({ onGenerate, step, activeTab, onTabChange, manualScript, onManualScriptChange, thumbnailBaseImage, onThumbnailBaseImageChange }) => {
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

  // 썸네일
  const [thumbnailText, setThumbnailText] = useState('');
  const [thumbnailImage, setThumbnailImage] = useState<string | null>(null);
  const [isThumbnailGenerating, setIsThumbnailGenerating] = useState(false);
  const [thumbnailFontSize, setThumbnailFontSize] = useState(80);
  const [thumbnailTextColor, setThumbnailTextColor] = useState('#ffffff');
  const [thumbnailTextY, setThumbnailTextY] = useState(85);
  const [thumbnailCustomImage, setThumbnailCustomImage] = useState<string | null>(null);
  const thumbnailCanvasRef = useRef<HTMLCanvasElement>(null);
  const thumbnailFileInputRef = useRef<HTMLInputElement>(null);

  // 프로젝트
  const [projects, setProjects] = useState<ProjectSettings[]>([]);
  const [newProjectName, setNewProjectName] = useState('');

  // 패널 네비게이션
  const [activePanel, setActivePanel] = useState<string | null>(null);

  const characterFileInputRef = useRef<HTMLInputElement>(null);
  const styleFileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const savedVoiceId = localStorage.getItem(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID) || '';
    setElVoiceId(savedVoiceId);
    setElModelId(getElevenLabsModelId());
    setImageModelId(localStorage.getItem(CONFIG.STORAGE_KEYS.IMAGE_MODEL) as ImageModelId || CONFIG.DEFAULT_IMAGE_MODEL);
    setImageTextMode(localStorage.getItem(CONFIG.STORAGE_KEYS.IMAGE_TEXT_MODE) || 'none');
    setGeminiTtsVoice(localStorage.getItem(CONFIG.STORAGE_KEYS.GEMINI_TTS_VOICE) as GeminiTtsVoiceId || CONFIG.DEFAULT_GEMINI_TTS_VOICE);
    const saved = localStorage.getItem(CONFIG.STORAGE_KEYS.PROJECTS);
    if (saved) { try { setProjects(JSON.parse(saved)); } catch {} }
    if (elApiKey) loadVoices(elApiKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

const saveElSettings = () => { if (elVoiceId) localStorage.setItem(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID, elVoiceId); setElevenLabsModelId(elModelId); };
  const selectVoiceSpeed = (v: string) => { setVoiceSpeed(v); localStorage.setItem(CONFIG.STORAGE_KEYS.VOICE_SPEED, v); };
  const changeVoiceStability = (v: number) => { setVoiceStability(v); localStorage.setItem(CONFIG.STORAGE_KEYS.VOICE_STABILITY, String(v)); };
  const changeVoiceStyle = (v: number) => { setVoiceStyle(v); localStorage.setItem(CONFIG.STORAGE_KEYS.VOICE_STYLE, String(v)); };
  const selectImageModel = useCallback((id: ImageModelId) => { setImageModelId(id); localStorage.setItem(CONFIG.STORAGE_KEYS.IMAGE_MODEL, id); }, []);
  const selectImageTextMode = useCallback((m: string) => { setImageTextMode(m); localStorage.setItem(CONFIG.STORAGE_KEYS.IMAGE_TEXT_MODE, m); }, []);
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

  const filteredDefaultVoices = useMemo(() => !genderFilter ? ELEVENLABS_DEFAULT_VOICES : ELEVENLABS_DEFAULT_VOICES.filter(v => v.gender === genderFilter), [genderFilter]);
  const filteredApiVoices = useMemo(() => !genderFilter ? voices : voices.filter(v => v.labels?.gender?.toLowerCase() === genderFilter), [voices, genderFilter]);

  const isProcessing = step !== GenerationStep.IDLE && step !== GenerationStep.COMPLETED && step !== GenerationStep.ERROR && step !== GenerationStep.SCRIPT_READY;
  const canSubmitAuto = topic.trim().length > 0;
  const canSubmitManual = manualScript.trim().length > 0;

  const buildRefImages = useCallback((): ReferenceImages => ({ character: characterRefImages, style: styleRefImages, characterStrength, styleStrength, characterDescription }), [characterRefImages, styleRefImages, characterStrength, styleStrength, characterDescription]);

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
        ctx.font = `900 ${fontSize}px Impact, "Arial Black", sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = Math.round(fontSize * 0.12);
        ctx.strokeStyle = 'rgba(0,0,0,0.9)';
        ctx.lineJoin = 'round';
        ctx.strokeText(thumbnailText, 640, yPx);
        ctx.fillStyle = thumbnailTextColor;
        ctx.fillText(thumbnailText, 640, yPx);
      }
    };
    img.src = base.startsWith('data:') ? base : `data:image/jpeg;base64,${base}`;
  }, [thumbnailBaseImage, thumbnailCustomImage, thumbnailText, thumbnailFontSize, thumbnailTextColor, thumbnailTextY]);

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
    <div className="w-full max-w-6xl mx-auto my-6 px-4">
      <div className="flex gap-0 items-stretch min-h-[600px]">

        {/* ════ 왼쪽 사이드바 (1/3) ════ */}
        <div className="flex-none w-1/3 bg-white/[0.03] border border-white/[0.08] rounded-l-2xl flex flex-col overflow-y-auto" style={{ maxHeight: '80vh' }}>
          {/* 비주얼 스타일 (항상 표시) */}
          <div className="p-3 border-b border-white/[0.07]">
            <p className="text-[10px] font-black text-white/55 uppercase tracking-widest mb-2 px-1">Visual Style</p>
            <div className="grid grid-cols-3 gap-1.5">
              {VISUAL_STYLES.map(style => (
                <button key={style.id} type="button" onClick={() => selectVisualStyle(style.id as VisualStyleId)}
                  className={`relative p-1.5 rounded-xl border transition-all ${visualStyleId === style.id ? 'border-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.25)]' : 'border-white/[0.08] hover:border-white/20'}`}>
                  <div className={`w-full aspect-video rounded-lg bg-gradient-to-br ${style.bg} flex items-center justify-center overflow-hidden`}>
                    <span className="text-[11px] font-black text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)] text-center px-2 leading-tight">{style.name}</span>
                  </div>
                  {visualStyleId === style.id && (
                    <div className="absolute top-0.5 right-0.5 w-4 h-4 bg-cyan-500 rounded-full flex items-center justify-center shadow-[0_0_6px_rgba(6,182,212,0.6)]">
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

          {/* 카테고리 버튼들 */}
          <div className="flex flex-col gap-1 p-2">
            {[
              { id: 'image', label: '이미지 설정', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="3" y="3" width="18" height="18" rx="2" strokeWidth={1.5}/><circle cx="8.5" cy="8.5" r="1.5" strokeWidth={1.5}/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 15l-5-5L5 21"/></svg> },
              { id: 'voice', label: '음성 설정', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M9 11V7a3 3 0 116 0v4a3 3 0 11-6 0z"/></svg> },
              { id: 'thumbnail', label: '썸네일 생성', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg> },
              { id: 'project', label: '프로젝트', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"/></svg> },
            ].map(({ id, label, icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActivePanel(activePanel === id ? null : id)}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all text-left ${
                  activePanel === id
                    ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/10 border border-cyan-500/40 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.15)]'
                    : 'text-white/65 hover:bg-white/[0.06] hover:text-white border border-transparent'
                }`}
              >
                <span className="flex-none">{icon}</span>
                <span className="text-sm font-bold">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ════ 오른쪽 메인 패널 ════ */}
        <div className="flex-1 bg-white/[0.02] border border-l-0 border-white/[0.08] rounded-r-2xl overflow-hidden flex flex-col">

          {activePanel === null ? (
            /* ── 기본 입력 패널 ── */
            <div className="flex flex-col h-full p-5 gap-4">

              {/* 탭 */}
              <div className="flex gap-1 bg-black/60 p-1 rounded-xl border border-white/[0.07]">
                <button type="button" onClick={() => onTabChange('auto')}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'auto' ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-[0_0_12px_rgba(6,182,212,0.3)]' : 'text-white/40 hover:text-white/70'}`}>
                  주제 자동생성
                </button>
                <button type="button" onClick={() => onTabChange('manual')}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'manual' ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-[0_0_12px_rgba(6,182,212,0.3)]' : 'text-white/40 hover:text-white/70'}`}>
                  수동 대본
                </button>
              </div>

              {/* 입력 영역 */}
              <form onSubmit={handleSubmit} className="flex flex-col gap-4 flex-1">
                {activeTab === 'auto' ? (
                  <div className="bg-black/50 border border-white/[0.1] rounded-2xl overflow-hidden">
                    <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} disabled={isProcessing}
                      placeholder="주제를 입력하세요 (예: 예수님 탄생, 우주의 신비, 한국의 역사...)"
                      className="block w-full bg-transparent text-white py-4 px-5 focus:ring-0 focus:outline-none placeholder-white/20 text-base disabled:opacity-50" />
                    <div className="px-5 pb-3 text-xs text-white/25">입력한 주제로 AI가 대본을 자동으로 생성합니다.</div>
                  </div>
                ) : (
                  <div className="flex-1 bg-black/50 border border-white/[0.1] rounded-2xl overflow-hidden flex flex-col">
                    <textarea value={manualScript} onChange={(e) => onManualScriptChange(e.target.value)} disabled={isProcessing}
                      placeholder={"여기에 대본을 붙여넣거나 직접 작성하세요.\n\n예)\n나레이션 1: 옛날 옛적...\n나레이션 2: ..."}
                      className="flex-1 min-h-72 bg-transparent text-white p-5 focus:ring-0 focus:outline-none placeholder-white/20 resize-none text-sm" />
                    <div className="px-5 pb-3 flex items-center justify-between border-t border-white/[0.07] pt-2">
                      <span className={`text-xs font-mono ${manualScript.length > 10000 ? 'text-amber-400' : manualScript.length > 3000 ? 'text-blue-400' : 'text-white/25'}`}>
                        {manualScript.length.toLocaleString()}자
                      </span>
                    </div>
                  </div>
                )}

                {/* 씬 수 + 영상 포맷 */}
                <div className="grid grid-cols-2 gap-3">
                  {/* 씬 수 */}
                  <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3">
                    <p className="text-sm font-bold text-white/60 mb-2">씬 수</p>
                    <div className="flex items-center gap-2">
                      <input type="number" min={0} max={500}
                        value={sceneCount === 0 ? '' : sceneCount}
                        onChange={(e) => { const v = parseInt(e.target.value, 10); setSceneCount(isNaN(v) || v < 0 ? 0 : v); }}
                        placeholder="자동"
                        className="w-20 bg-black/60 border border-white/10 rounded-lg px-2 py-2 text-sm text-white placeholder-white/25 focus:border-cyan-500 focus:outline-none text-center" />
                      <span className="text-sm text-white/40">{sceneCount > 0 ? `${sceneCount}씬 고정` : 'AI 자동 결정'}</span>
                    </div>
                  </div>

                  {/* 영상 포맷 */}
                  <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3">
                    <p className="text-sm font-bold text-white/60 mb-2">영상 포맷</p>
                    <div className="flex gap-1.5 mb-2">
                      <button type="button" onClick={() => selectAspectRatio('16:9')}
                        className={`flex-1 py-1.5 rounded-lg text-sm font-bold transition-all ${aspectRatio === '16:9' ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-[0_0_8px_rgba(6,182,212,0.25)]' : 'bg-white/[0.06] text-white/40 hover:text-white/70 hover:bg-white/[0.1]'}`}>
                        롱폼
                      </button>
                      <button type="button" onClick={() => selectAspectRatio('9:16')}
                        className={`flex-1 py-1.5 rounded-lg text-sm font-bold transition-all ${aspectRatio === '9:16' ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-[0_0_8px_rgba(6,182,212,0.25)]' : 'bg-white/[0.06] text-white/40 hover:text-white/70 hover:bg-white/[0.1]'}`}>
                        숏폼
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="number" min={1} max={60}
                        value={aspectRatio === '16:9' ? longformDuration : shortformDuration}
                        onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) { aspectRatio === '16:9' ? changeLongformDuration(v) : changeShortformDuration(v); }}}
                        className="w-16 bg-black/60 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white text-center focus:border-cyan-500 focus:outline-none" />
                      <span className="text-sm text-white/40">{aspectRatio === '16:9' ? '분' : '초'}</span>
                    </div>
                  </div>
                </div>

                {/* 참조 이미지 (캐릭터 + 화풍) */}
                <div className="grid grid-cols-2 gap-3">
                  {/* 캐릭터 */}
                  <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3">
                    <p className="text-sm font-bold text-slate-200 mb-2">캐릭터 참조</p>
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
                  <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3">
                    <p className="text-sm font-bold text-slate-200 mb-2">화풍 참조</p>
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
                  <div className="absolute -top-px left-8 right-8 h-px bg-gradient-to-r from-transparent via-cyan-400 to-transparent opacity-80" />
                  <button type="submit" disabled={isProcessing || (activeTab === 'auto' ? !canSubmitAuto : !canSubmitManual)}
                    className="w-full relative bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500 hover:from-cyan-300 hover:via-sky-300 hover:to-blue-400 disabled:opacity-40 text-white font-black py-5 rounded-2xl transition-all text-xl tracking-wide shadow-[0_0_30px_rgba(6,182,212,0.6),0_0_60px_rgba(6,182,212,0.25)] hover:shadow-[0_0_40px_rgba(6,182,212,0.8),0_0_80px_rgba(6,182,212,0.35)] disabled:shadow-none border border-cyan-300/30">
                    {isProcessing ? '생성 중...' : activeTab === 'auto' ? '대본 생성 시작' : '스토리보드 생성'}
                  </button>
                  {/* 하단 네온 바 */}
                  <div className="absolute -bottom-px left-8 right-8 h-px bg-gradient-to-r from-transparent via-blue-400 to-transparent opacity-60" />
                </div>

                <button type="button" onClick={handleImagesOnly} disabled={isProcessing || (activeTab === 'auto' ? !canSubmitAuto : !canSubmitManual)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-400 hover:from-emerald-300 hover:to-teal-300 disabled:opacity-40 text-white text-base font-bold transition-all shadow-[0_0_18px_rgba(16,185,129,0.5)] hover:shadow-[0_0_28px_rgba(16,185,129,0.7)] disabled:shadow-none border border-emerald-300/30">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="3" y="3" width="18" height="18" rx="2" strokeWidth={2}/><circle cx="8.5" cy="8.5" r="1.5" strokeWidth={2}/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 15l-5-5L5 21"/></svg>
                  이미지만 생성
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

              {/* 패널 내용 - 스크롤 가능 */}
              <div className="flex-1 overflow-y-auto p-5 space-y-5">

                {/* 🎨 비주얼 스타일 패널 */}
                {activePanel === 'visual' && (
                  <div>
                    <div className="grid grid-cols-3 gap-2">
                      {VISUAL_STYLES.map(style => (
                        <button key={style.id} type="button" onClick={() => selectVisualStyle(style.id as VisualStyleId)}
                          className={`relative p-2 rounded-xl border transition-all ${visualStyleId === style.id ? 'border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.25)]' : 'border-white/[0.08] hover:border-white/20'}`}>
                          <div className={`w-full aspect-video rounded-lg bg-gradient-to-br ${style.bg} flex items-center justify-center overflow-hidden`}>
                            <span className="text-[12px] font-black text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)] text-center px-2 leading-tight">{style.name}</span>
                          </div>
                          {visualStyleId === style.id && (
                            <div className="absolute top-1 right-1 w-4 h-4 bg-cyan-500 rounded-full flex items-center justify-center shadow-[0_0_6px_rgba(6,182,212,0.6)]">
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
                    <div>
                      <p className="text-sm font-bold text-slate-400 mb-2 uppercase tracking-wider">이미지 글씨</p>
                      <div className="grid grid-cols-4 gap-1.5">
                        {([{ id: 'none', label: '없음' }, { id: 'english', label: '영어' }, { id: 'numbers', label: '숫자' }, { id: 'auto', label: '자동' }] as const).map(({ id, label }) => (
                          <button key={id} type="button" onClick={() => selectImageTextMode(id)}
                            className={`py-2 rounded-xl text-sm font-bold transition-colors ${imageTextMode === id ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
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
                  <div className="space-y-5">
                    {/* 말하기 속도 */}
                    <div>
                      <p className="text-sm font-bold text-slate-400 mb-2 uppercase tracking-wider">말하기 속도</p>
                      <div className="flex gap-2">
                        {[['0.7', '느림'], ['1.0', '보통'], ['1.3', '빠름']].map(([val, label]) => (
                          <button key={val} type="button" onClick={() => selectVoiceSpeed(val)}
                            className={`flex-1 py-2 rounded-xl text-sm font-bold ${voiceSpeed === val ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* TTS 제공자 탭 */}
                    <div className="flex gap-2">
                      <button type="button" onClick={() => { setVoiceSubTab('elevenlabs'); localStorage.setItem(CONFIG.STORAGE_KEYS.TTS_PROVIDER, 'elevenlabs'); }}
                        className={`flex-1 py-2 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 ${voiceSubTab === 'elevenlabs' ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                        ElevenLabs
                        <span className={`w-1.5 h-1.5 rounded-full ${elApiKey ? 'bg-emerald-400' : 'bg-amber-400'}`}/>
                      </button>
                      <button type="button" onClick={() => { setVoiceSubTab('google'); localStorage.setItem(CONFIG.STORAGE_KEYS.TTS_PROVIDER, 'google'); }}
                        className={`flex-1 py-2 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 ${voiceSubTab === 'google' ? 'bg-teal-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                        Google TTS
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"/>
                      </button>
                    </div>

                    {voiceSubTab === 'elevenlabs' && (
                      <div className="space-y-3">
                        {!elApiKey && <p className="text-sm text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">API 키 없음 → Google TTS 사용</p>}
                        {elApiKey && (
                          <>
                            <div className="flex items-center gap-2">
                              {([null, 'male', 'female'] as const).map((g) => (
                                <button key={String(g)} type="button" onClick={() => setGenderFilter(g)}
                                  className={`px-3 py-1 rounded-lg text-sm font-bold ${genderFilter === g ? (g === 'male' ? 'bg-blue-600 text-white' : g === 'female' ? 'bg-pink-600 text-white' : 'bg-slate-600 text-white') : 'bg-slate-800 text-slate-400'}`}>
                                  {g === null ? '전체' : g === 'male' ? '남성' : '여성'}
                                </button>
                              ))}
                              <button type="button" onClick={() => loadVoices()} disabled={isLoadingVoices}
                                className="ml-auto text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 px-3 py-1 rounded-lg font-bold">
                                {isLoadingVoices ? '...' : '불러오기'}
                              </button>
                            </div>
                            {/* 성우 목록 — 인라인 스크롤 (absolute 드롭다운 제거) */}
                            <div className="bg-black/40 border border-white/[0.1] rounded-xl overflow-y-auto" style={{ maxHeight: '240px' }}>
                              <button type="button" onClick={() => { setElVoiceId(''); localStorage.removeItem(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID); }}
                                className={`w-full px-4 py-2.5 text-left text-sm font-bold text-slate-300 hover:bg-white/[0.05] border-b border-white/[0.07] ${!elVoiceId ? 'bg-purple-600/20 text-white' : ''}`}>
                                기본값 (Adam)
                              </button>
                              {filteredDefaultVoices.map(voice => (
                                <div key={voice.id} className={`flex items-center gap-2 px-3 py-2 border-b border-white/[0.05] hover:bg-white/[0.05] ${elVoiceId === voice.id ? 'bg-purple-600/20' : ''}`}>
                                  <button type="button" onClick={(e) => { e.stopPropagation(); playElevenLabsPreview(voice.id, voice.name); }}
                                    className={`w-7 h-7 flex-shrink-0 rounded-full flex items-center justify-center ${playingVoiceId === voice.id ? 'bg-purple-500 text-white animate-pulse' : 'bg-white/[0.08] text-slate-400 hover:bg-purple-600 hover:text-white'}`}>
                                    {playingVoiceId === voice.id ? <PauseIcon /> : <PlayIcon />}
                                  </button>
                                  <button type="button" onClick={() => { setElVoiceId(voice.id); localStorage.setItem(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID, voice.id); }} className="flex-1 text-left">
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
                            {/* 안정성/스타일 슬라이더 */}
                            <div className="space-y-2">
                              <div className="flex items-center gap-3">
                                <span className="text-sm text-slate-400 w-14">안정성</span>
                                <input type="range" min={0} max={100} value={voiceStability} onChange={(e) => changeVoiceStability(Number(e.target.value))} className="flex-1 accent-purple-500" />
                                <span className="text-sm text-purple-400 w-8 text-right">{voiceStability}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-sm text-slate-400 w-14">스타일</span>
                                <input type="range" min={0} max={100} value={voiceStyle} onChange={(e) => changeVoiceStyle(Number(e.target.value))} className="flex-1 accent-purple-500" />
                                <span className="text-sm text-purple-400 w-8 text-right">{voiceStyle}</span>
                              </div>
                            </div>
                            <button type="button" onClick={saveElSettings} className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 rounded-xl text-sm">설정 저장</button>
                          </>
                        )}
                      </div>
                    )}

                    {voiceSubTab === 'google' && (
                      <div className="space-y-3">
                        <div className="flex gap-2">
                          {([null, 'male', 'female'] as const).map(g => (
                            <button key={String(g)} type="button" onClick={() => setGeminiTtsGenderFilter(g)}
                              className={`px-3 py-1 rounded-lg text-sm font-bold ${geminiTtsGenderFilter === g ? (g === 'male' ? 'bg-blue-600 text-white' : g === 'female' ? 'bg-pink-600 text-white' : 'bg-teal-600 text-white') : 'bg-slate-800 text-slate-400'}`}>
                              {g === null ? '전체' : g === 'male' ? '남성' : '여성'}
                            </button>
                          ))}
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 max-h-64 overflow-y-auto">
                          {GEMINI_TTS_VOICES.filter(v => !geminiTtsGenderFilter || v.gender === geminiTtsGenderFilter).map(voice => (
                            <div key={voice.id} className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition-all ${geminiTtsVoice === voice.id ? 'border-teal-500 bg-teal-500/10' : 'border-slate-700 hover:border-slate-500'}`}
                              onClick={() => { setGeminiTtsVoice(voice.id as GeminiTtsVoiceId); localStorage.setItem(CONFIG.STORAGE_KEYS.GEMINI_TTS_VOICE, voice.id); }}>
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
                      </div>
                    )}
                  </div>
                )}

                {/* 🎬 썸네일 생성 패널 */}
                {activePanel === 'thumbnail' && (
                  <div className="space-y-4">
                    {/* 베이스 이미지 선택 */}
                    <div className="space-y-2">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">썸네일 이미지 선택</p>
                      <input ref={thumbnailFileInputRef} type="file" accept="image/*" className="hidden" onChange={handleThumbnailUpload} />
                      {/* 업로드 드래그앤드롭 영역 */}
                      <div
                        className="w-full border-2 border-dashed border-slate-600 hover:border-brand-500 rounded-xl p-6 text-center cursor-pointer transition-all bg-slate-800/40 hover:bg-slate-800/70"
                        onClick={() => thumbnailFileInputRef.current?.click()}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const file = e.dataTransfer.files?.[0];
                          if (!file || !file.type.startsWith('image/')) return;
                          const reader = new FileReader();
                          reader.onload = (ev) => setThumbnailCustomImage(ev.target?.result as string);
                          reader.readAsDataURL(file);
                        }}
                      >
                        <div className="flex justify-center mb-2"><svg className="w-8 h-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg></div>
                        <p className="text-sm font-bold text-slate-300">내 이미지 업로드</p>
                        <p className="text-xs text-slate-500 mt-1">클릭하거나 이미지를 여기에 드래그</p>
                      </div>
                      <p className="text-xs text-slate-600 text-center">또는 아래 씬 이미지에서 썸네일 버튼을 클릭</p>
                      {(thumbnailBaseImage || thumbnailCustomImage) && (
                        <button
                          type="button"
                          onClick={() => { setThumbnailCustomImage(null); onThumbnailBaseImageChange?.(null); }}
                          className="w-full py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 text-xs font-bold rounded-lg border border-red-600/30 transition-all"
                        >
                          선택된 이미지 초기화
                        </button>
                      )}
                    </div>

                    {/* 캔버스 미리보기 */}
                    <div className="relative rounded-xl overflow-hidden bg-slate-900 border border-slate-700 aspect-video">
                      <canvas
                        ref={thumbnailCanvasRef}
                        className="w-full h-full object-contain"
                        style={{ display: (thumbnailBaseImage || thumbnailCustomImage) ? 'block' : 'none' }}
                      />
                      {!(thumbnailBaseImage || thumbnailCustomImage) && (
                        <div className="absolute inset-0 flex items-center justify-center text-slate-600 text-sm">
                          이미지를 선택하세요
                        </div>
                      )}
                    </div>

                    {/* 텍스트 오버레이 컨트롤 */}
                    <div className="space-y-3">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">텍스트 오버레이</p>
                      <input
                        type="text"
                        value={thumbnailText}
                        onChange={(e) => setThumbnailText(e.target.value)}
                        placeholder="썸네일에 넣을 텍스트"
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-brand-500"
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-slate-500 mb-1 block">글자 크기: {thumbnailFontSize}px</label>
                          <input
                            type="range" min={40} max={200} step={4}
                            value={thumbnailFontSize}
                            onChange={(e) => setThumbnailFontSize(Number(e.target.value))}
                            className="w-full accent-brand-500"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-slate-500 mb-1 block">텍스트 색상</label>
                          <input
                            type="color"
                            value={thumbnailTextColor}
                            onChange={(e) => setThumbnailTextColor(e.target.value)}
                            className="w-full h-9 rounded-lg bg-slate-800 border border-slate-700 cursor-pointer"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500 mb-1 block">텍스트 위치: {thumbnailTextY}%</label>
                        <input
                          type="range" min={10} max={95} step={1}
                          value={thumbnailTextY}
                          onChange={(e) => setThumbnailTextY(Number(e.target.value))}
                          className="w-full accent-brand-500"
                        />
                      </div>
                    </div>

                    {/* 다운로드 */}
                    {(thumbnailBaseImage || thumbnailCustomImage) && (
                      <button
                        type="button"
                        onClick={handleDownloadThumbnail}
                        className="w-full py-3 bg-gradient-to-r from-orange-600 to-pink-600 hover:from-orange-500 hover:to-pink-500 text-white font-black rounded-xl transition-all text-sm"
                      >
                        썸네일 다운로드 (1280×720)
                      </button>
                    )}

                    {/* AI 생성 섹션 */}
                    <div className="border-t border-slate-700 pt-4">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">AI 썸네일 생성</p>
                      <button
                        type="button"
                        onClick={handleGenerateThumbnail}
                        disabled={isProcessing || isThumbnailGenerating}
                        className="w-full py-2.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white font-bold rounded-xl transition-all text-sm border border-slate-600"
                      >
                        {isThumbnailGenerating ? '생성 중...' : 'AI로 썸네일 이미지 생성'}
                      </button>
                      {thumbnailImage && (
                        <div className="mt-3 relative rounded-xl overflow-hidden border border-slate-700 cursor-pointer" onClick={() => {
                          setThumbnailCustomImage(`data:image/jpeg;base64,${thumbnailImage}`);
                        }}>
                          <img src={`data:image/jpeg;base64,${thumbnailImage}`} alt="AI 썸네일" className="w-full" />
                          <div className="absolute inset-0 bg-black/50 opacity-0 hover:opacity-100 transition-all flex items-center justify-center text-white text-sm font-bold">
                            클릭하면 에디터에서 편집
                          </div>
                        </div>
                      )}
                    </div>
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
