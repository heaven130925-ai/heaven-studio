import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { CONFIG, ELEVENLABS_MODELS, ElevenLabsModelId, ELEVENLABS_DEFAULT_VOICES, VoiceGender, GEMINI_TTS_VOICES, GeminiTtsVoiceId } from '../config';
import { getElevenLabsModelId, setElevenLabsModelId, fetchElevenLabsVoices, ElevenLabsVoice } from '../services/elevenLabsService';
import { generateGeminiTtsPreview } from '../services/geminiService';
import { previewGCloudTTS } from '../services/googleCloudTTSService';
import { getVoiceSetting, setVoiceSetting, removeVoiceSetting } from '../utils/voiceStorage';

// ── 유틸 ─────────────────────────────────────────────────────────────────────
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

const PlayIcon = () => <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>;
const PauseIcon = () => <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>;

interface VoiceSettingsPanelProps {
  // refreshKey가 바뀌면 localStorage에서 설정을 다시 읽음 (프로젝트 불러오기 후 사용)
  refreshKey?: number;
}

const VoiceSettingsPanel: React.FC<VoiceSettingsPanelProps> = ({ refreshKey }) => {
  const readState = () => ({
    voiceSubTab: (getVoiceSetting(CONFIG.STORAGE_KEYS.TTS_PROVIDER) || 'elevenlabs') as 'elevenlabs' | 'google' | 'gcloud' | 'azure' | 'none',
    voiceSpeed: getVoiceSetting(CONFIG.STORAGE_KEYS.VOICE_SPEED) || '1.0',
    voiceStability: parseInt(getVoiceSetting(CONFIG.STORAGE_KEYS.VOICE_STABILITY) || '50'),
    voiceTone: getVoiceSetting('heaven_voice_tone') || '',
    voiceMoodPreset: getVoiceSetting('heaven_voice_mood') || '',
    googleTtsTone: getVoiceSetting('heaven_google_tts_tone_id') || '',
    googleTtsMood: getVoiceSetting('heaven_google_tts_mood_id') || '',
    gcloudTone: getVoiceSetting('heaven_gcloud_tone_id') || '',
    gcloudMood: getVoiceSetting('heaven_gcloud_mood_id') || '',
    voiceStyle: parseInt(getVoiceSetting(CONFIG.STORAGE_KEYS.VOICE_STYLE) || '0'),
    gcloudApiKey: localStorage.getItem(CONFIG.STORAGE_KEYS.GCLOUD_TTS_API_KEY) || '',
    gcloudVoice: getVoiceSetting(CONFIG.STORAGE_KEYS.GCLOUD_TTS_VOICE) || 'ko-KR-Neural2-A',
    azureApiKey: localStorage.getItem(CONFIG.STORAGE_KEYS.AZURE_TTS_API_KEY) || '',
    azureRegion: getVoiceSetting(CONFIG.STORAGE_KEYS.AZURE_TTS_REGION) || '',
    azureVoice: getVoiceSetting(CONFIG.STORAGE_KEYS.AZURE_TTS_VOICE) || 'ko-KR-SunHiNeural',
    geminiTtsVoice: (getVoiceSetting(CONFIG.STORAGE_KEYS.GEMINI_TTS_VOICE) || CONFIG.DEFAULT_GEMINI_TTS_VOICE) as GeminiTtsVoiceId,
    elVoiceId: getVoiceSetting(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID) || '',
    elModelId: getElevenLabsModelId() as ElevenLabsModelId,
    elApiKey: localStorage.getItem(CONFIG.STORAGE_KEYS.ELEVENLABS_API_KEY) || process.env.ELEVENLABS_API_KEY || '',
  });

  const init = readState();
  const [voiceSubTab, setVoiceSubTab] = useState(init.voiceSubTab);
  const [voiceSpeed, setVoiceSpeed] = useState(init.voiceSpeed);
  const [voiceStability, setVoiceStability] = useState(init.voiceStability);
  const [voiceTone, setVoiceTone] = useState(init.voiceTone);
  const [voiceMoodPreset, setVoiceMoodPreset] = useState(init.voiceMoodPreset);
  const [googleTtsTone, setGoogleTtsTone] = useState(init.googleTtsTone);
  const [googleTtsMood, setGoogleTtsMood] = useState(init.googleTtsMood);
  const [gcloudTone, setGcloudTone] = useState(init.gcloudTone);
  const [gcloudMood, setGcloudMood] = useState(init.gcloudMood);
  const [voiceStyle, setVoiceStyle] = useState(init.voiceStyle);
  const [gcloudApiKey, setGcloudApiKey] = useState(init.gcloudApiKey);
  const [gcloudVoice, setGcloudVoice] = useState(init.gcloudVoice);
  const [playingGcloudVoice, setPlayingGcloudVoice] = useState<string | null>(null);
  const [azureApiKey, setAzureApiKey] = useState(init.azureApiKey);
  const [azureRegion, setAzureRegion] = useState(init.azureRegion);
  const [azureVoice, setAzureVoice] = useState(init.azureVoice);
  const [playingAzureVoice, setPlayingAzureVoice] = useState<string | null>(null);
  const [geminiTtsVoice, setGeminiTtsVoice] = useState<GeminiTtsVoiceId>(init.geminiTtsVoice);
  const [geminiTtsGenderFilter, setGeminiTtsGenderFilter] = useState<'male' | 'female' | null>(null);
  const [playingGeminiVoiceId, setPlayingGeminiVoiceId] = useState<string | null>(null);
  const [elVoiceId, setElVoiceId] = useState(init.elVoiceId);
  const [elModelId, setElModelId] = useState<ElevenLabsModelId>(init.elModelId);
  const [elApiKey] = useState(init.elApiKey);
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [genderFilter, setGenderFilter] = useState<VoiceGender | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const geminiPreviewCacheRef = useRef<Record<string, string>>({});

  // refreshKey가 바뀌면 localStorage에서 상태 재로드
  useEffect(() => {
    if (refreshKey === undefined || refreshKey === 0) return;
    const s = readState();
    setVoiceSubTab(s.voiceSubTab);
    setVoiceSpeed(s.voiceSpeed);
    setVoiceStability(s.voiceStability);
    setVoiceTone(s.voiceTone);
    setVoiceMoodPreset(s.voiceMoodPreset);
    setGoogleTtsTone(s.googleTtsTone);
    setGoogleTtsMood(s.googleTtsMood);
    setGcloudTone(s.gcloudTone);
    setGcloudMood(s.gcloudMood);
    setVoiceStyle(s.voiceStyle);
    setGcloudApiKey(s.gcloudApiKey);
    setGcloudVoice(s.gcloudVoice);
    setAzureApiKey(s.azureApiKey);
    setAzureRegion(s.azureRegion);
    setAzureVoice(s.azureVoice);
    setGeminiTtsVoice(s.geminiTtsVoice);
    setElVoiceId(s.elVoiceId);
    setElModelId(s.elModelId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    if (elApiKey) {
      setIsLoadingVoices(true);
      fetchElevenLabsVoices(elApiKey)
        .then(v => setVoices(v))
        .catch(() => {})
        .finally(() => setIsLoadingVoices(false));
    }
    return () => { audioRef.current?.pause(); audioRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 핸들러 ──────────────────────────────────────────────────────────────────
  const loadVoices = useCallback(async () => {
    if (!elApiKey || elApiKey.length < 10) return;
    setIsLoadingVoices(true);
    try { setVoices(await fetchElevenLabsVoices(elApiKey)); } catch {}
    finally { setIsLoadingVoices(false); }
  }, [elApiKey]);

  const selectVoice = useCallback((voice: ElevenLabsVoice) => {
    setElVoiceId(voice.voice_id);
    setVoiceSetting(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID, voice.voice_id);
  }, []);

  const PREVIEW_TEXT = '안녕하세요. 테스트 목소리입니다.';

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
      let base64 = geminiPreviewCacheRef.current[voiceId];
      if (!base64) {
        base64 = await generateGeminiTtsPreview(PREVIEW_TEXT, voiceId) ?? '';
        if (base64) geminiPreviewCacheRef.current[voiceId] = base64;
      }
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

  const saveElSettings = () => {
    if (elVoiceId) setVoiceSetting(CONFIG.STORAGE_KEYS.ELEVENLABS_VOICE_ID, elVoiceId);
    setElevenLabsModelId(elModelId);
  };
  const selectVoiceSpeed = (v: string) => { setVoiceSpeed(v); setVoiceSetting(CONFIG.STORAGE_KEYS.VOICE_SPEED, v); };

  const filteredDefaultVoices = useMemo(() => !genderFilter ? ELEVENLABS_DEFAULT_VOICES : ELEVENLABS_DEFAULT_VOICES.filter(v => v.gender === genderFilter), [genderFilter]);
  const filteredApiVoices = useMemo(() => !genderFilter ? voices : voices.filter(v => v.labels?.gender?.toLowerCase() === genderFilter), [voices, genderFilter]);

  // ── JSX ──────────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col min-h-0 gap-2">
      {/* TTS 제공자 탭 */}
      <div className="flex gap-2 shrink-0 flex-wrap">
        <button type="button" onClick={() => { setVoiceSubTab('none'); setVoiceSetting(CONFIG.STORAGE_KEYS.TTS_PROVIDER, 'none'); }}
          className={`flex-1 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border ${voiceSubTab === 'none' ? 'bg-slate-600/40 text-slate-200 border-slate-400/60' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 border-white/10'}`}>
          음성 없음
          <span className={`w-1.5 h-1.5 rounded-full ${voiceSubTab === 'none' ? 'bg-slate-400' : 'bg-slate-600'}`}/>
        </button>
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

      {voiceSubTab === 'none' && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-slate-500 text-sm text-center">음성 생성 없이 이미지만 생성합니다.</p>
        </div>
      )}

      {/* ── ElevenLabs ──────────────────────────────────────────────────────── */}
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
              {[['0.85', '느림'], ['1.1', '보통'], ['1.35', '빠름']].map(([val, label]) => (
                <button key={val} type="button" onClick={() => selectVoiceSpeed(val)}
                  className={`flex-1 py-2 rounded-xl text-sm font-bold border ${voiceSpeed === val ? 'bg-purple-600/20 text-purple-200 border-purple-500/60 shadow-[0_0_10px_rgba(168,85,247,0.4)]' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 border-purple-500/30'}`}>
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
          {/* 분위기 */}
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

      {/* ── Azure TTS ───────────────────────────────────────────────────────── */}
      {voiceSubTab === 'azure' && (
        <div className="flex-1 flex flex-col min-h-0 gap-3">
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
          <div className="shrink-0 p-3 rounded-xl border border-sky-500/40 shadow-[0_0_10px_rgba(14,165,233,0.15)]">
            <p className="text-sm font-bold text-slate-400 mb-2 uppercase tracking-wider">말하기 속도</p>
            <div className="flex gap-2">
              {[['0.85', '느림'], ['1.1', '보통'], ['1.35', '빠름']].map(([val, label]) => (
                <button key={val} type="button" onClick={() => selectVoiceSpeed(val)}
                  className={`flex-1 py-2 rounded-xl text-sm font-bold border ${voiceSpeed === val ? 'bg-sky-600/20 text-sky-200 border-sky-500/60 shadow-[0_0_10px_rgba(14,165,233,0.4)]' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 border-sky-500/30'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
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
          <p className="shrink-0 text-[10px] text-slate-500 bg-slate-800/50 rounded-xl p-2">월 500,000자 무료 · 이후 $16/100만자</p>
        </div>
      )}

      {/* ── Google Cloud TTS ─────────────────────────────────────────────────── */}
      {voiceSubTab === 'gcloud' && (
        <div className="flex-1 flex flex-col min-h-0 gap-3">
          <div className="shrink-0 space-y-1.5">
            <label className="text-xs text-slate-400 font-bold uppercase tracking-wider">Google Cloud TTS API Key</label>
            {gcloudApiKey && localStorage.getItem(CONFIG.STORAGE_KEYS.GCLOUD_TTS_API_KEY) === gcloudApiKey ? (
              <div className="flex gap-2 items-center">
                <span className="flex-1 bg-slate-800 border border-emerald-600/50 rounded-xl px-3 py-2 text-emerald-400 text-sm">✓ 저장됨 ({gcloudApiKey.slice(0, 6)}••••)</span>
                <button type="button" onClick={() => { setGcloudApiKey(''); localStorage.removeItem(CONFIG.STORAGE_KEYS.GCLOUD_TTS_API_KEY); }}
                  className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-bold">변경</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input type="password" autoComplete="off" value={gcloudApiKey} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGcloudApiKey(e.target.value)}
                  placeholder="AIza..."
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>
                <button type="button" onClick={() => { localStorage.setItem(CONFIG.STORAGE_KEYS.GCLOUD_TTS_API_KEY, gcloudApiKey); setGcloudApiKey(gcloudApiKey); }}
                  className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold">저장</button>
              </div>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-blue-500/40 shadow-[0_0_10px_rgba(59,130,246,0.12)]">
            {([
              { id: 'ko-KR-Neural2-A', label: 'Neural2-A', desc: 'Neural2 · 여성', gender: 'female' },
              { id: 'ko-KR-Neural2-B', label: 'Neural2-B', desc: 'Neural2 · 여성', gender: 'female' },
              { id: 'ko-KR-Neural2-C', label: 'Neural2-C', desc: 'Neural2 · 남성', gender: 'male' },
              { id: 'ko-KR-Wavenet-A', label: 'Wavenet-A', desc: 'Wavenet · 여성', gender: 'female' },
              { id: 'ko-KR-Wavenet-B', label: 'Wavenet-B', desc: 'Wavenet · 여성', gender: 'female' },
              { id: 'ko-KR-Wavenet-C', label: 'Wavenet-C', desc: 'Wavenet · 남성', gender: 'male' },
              { id: 'ko-KR-Wavenet-D', label: 'Wavenet-D', desc: 'Wavenet · 남성', gender: 'male' },
              { id: 'ko-KR-Standard-A', label: 'Standard-A', desc: 'Standard · 여성', gender: 'female' },
              { id: 'ko-KR-Standard-B', label: 'Standard-B', desc: 'Standard · 여성', gender: 'female' },
              { id: 'ko-KR-Standard-C', label: 'Standard-C', desc: 'Standard · 남성', gender: 'male' },
              { id: 'ko-KR-Standard-D', label: 'Standard-D', desc: 'Standard · 남성', gender: 'male' },
            ] as { id: string; label: string; desc: string; gender: string }[]).map(voice => (
              <div key={voice.id} className={`flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.05] hover:bg-white/[0.05] transition-colors ${gcloudVoice === voice.id ? 'bg-blue-600/20' : ''}`}>
                <button type="button" onClick={async (e) => {
                  e.stopPropagation();
                  if (!gcloudApiKey) return;
                  setPlayingGcloudVoice(voice.id);
                  try {
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
          <div className="shrink-0 p-3 rounded-xl border border-blue-500/40 shadow-[0_0_10px_rgba(59,130,246,0.15)]">
            <p className="text-sm font-bold text-slate-400 mb-2 uppercase tracking-wider">말하기 속도</p>
            <div className="flex gap-2">
              {[['0.85', '느림'], ['1.1', '보통'], ['1.35', '빠름']].map(([val, label]) => (
                <button key={val} type="button" onClick={() => selectVoiceSpeed(val)}
                  className={`flex-1 py-2 rounded-xl text-sm font-bold border ${voiceSpeed === val ? 'bg-blue-600/20 text-blue-200 border-blue-500/60 shadow-[0_0_10px_rgba(59,130,246,0.4)]' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 border-blue-500/30'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
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
              }} className="mt-1 text-xs text-slate-500 hover:text-slate-300">전체 초기화</button>
            )}
          </div>
        </div>
      )}

      {/* ── Gemini TTS ───────────────────────────────────────────────────────── */}
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
          </div>
          <div className="shrink-0 p-3 rounded-xl border border-teal-500/40 shadow-[0_0_10px_rgba(20,184,166,0.15)]">
            <p className="text-sm font-bold text-slate-400 mb-2 uppercase tracking-wider">말하기 속도</p>
            <div className="flex gap-2">
              {[['0.85', '느림'], ['1.1', '보통'], ['1.35', '빠름']].map(([val, label]) => (
                <button key={val} type="button" onClick={() => selectVoiceSpeed(val)}
                  className={`flex-1 py-2 rounded-xl text-sm font-bold border ${voiceSpeed === val ? 'bg-teal-600/20 text-teal-200 border-teal-500/60 shadow-[0_0_10px_rgba(20,184,166,0.4)]' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 border-teal-500/30'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
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
              }} className="mt-1 text-xs text-slate-500 hover:text-slate-300">전체 초기화</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default VoiceSettingsPanel;
