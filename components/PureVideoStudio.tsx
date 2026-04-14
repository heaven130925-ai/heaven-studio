import React, { useState, useCallback, useRef } from 'react';
import { generatePureVideoScenes, PureVideoScene } from '../services/geminiService';
import { generateImageForScene } from '../services/geminiService';
import { generateVeoVideoFromImage } from '../services/veoService';
import { VEO_MODELS } from '../services/veoService';
import { DEFAULT_REFERENCE_IMAGES, ReferenceImages } from '../types';

interface PureVideoStudioProps {
  aspectRatio: '16:9' | '9:16';
}

type StudioStep = 'input' | 'scenes_ready' | 'generating' | 'completed';

interface SceneState extends PureVideoScene {
  imageData: string | null;
  videoUrl: string | null;
  status: 'pending' | 'generating_image' | 'generating_video' | 'done' | 'error';
  errorMsg?: string;
}

const PureVideoStudio: React.FC<PureVideoStudioProps> = ({ aspectRatio }) => {
  const [step, setStep] = useState<StudioStep>('input');
  const [topic, setTopic] = useState('');
  const [sceneCount, setSceneCount] = useState(5);
  const [secondsPerScene, setSecondsPerScene] = useState(5);
  const [veoModel, setVeoModel] = useState('veo-2.0-generate-001');
  const [scenes, setScenes] = useState<SceneState[]>([]);
  const [progress, setProgress] = useState('');
  const [isPlanning, setIsPlanning] = useState(false);

  // 캐릭터/화풍 참조 이미지
  const [characterImages, setCharacterImages] = useState<string[]>([]);
  const [styleImages, setStyleImages] = useState<string[]>([]);
  const [characterDesc, setCharacterDesc] = useState('');
  const charInputRef = useRef<HTMLInputElement>(null);
  const styleInputRef = useRef<HTMLInputElement>(null);

  const isAbortedRef = useRef(false);

  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = rej;
      r.readAsDataURL(file);
    });

  const handleCharacterFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const imgs: string[] = [];
    for (const f of Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, 3)) {
      imgs.push(await readFileAsBase64(f));
    }
    setCharacterImages(prev => [...prev, ...imgs].slice(0, 3));
  }, []);

  const handleStyleFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const imgs: string[] = [];
    for (const f of Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, 3)) {
      imgs.push(await readFileAsBase64(f));
    }
    setStyleImages(prev => [...prev, ...imgs].slice(0, 3));
  }, []);

  // 씬 플래닝
  const handlePlanScenes = useCallback(async () => {
    if (!topic.trim()) { alert('주제를 입력해주세요.'); return; }
    setIsPlanning(true);
    setProgress('AI가 씬을 구성하는 중...');
    try {
      const styleDesc = styleImages.length > 0 ? '화풍 참조 이미지 기반' : undefined;
      const charDesc = characterDesc.trim() || (characterImages.length > 0 ? '사용자 캐릭터 참조 이미지 기반' : undefined);
      const planned = await generatePureVideoScenes(topic, sceneCount, aspectRatio, styleDesc, charDesc);
      setScenes(planned.map(s => ({ ...s, imageData: null, videoUrl: null, status: 'pending' })));
      setStep('scenes_ready');
    } catch (e: any) {
      alert(`씬 구성 실패: ${e.message}`);
    } finally {
      setIsPlanning(false);
      setProgress('');
    }
  }, [topic, sceneCount, aspectRatio, styleImages, characterImages, characterDesc]);

  const updateScene = useCallback((idx: number, patch: Partial<SceneState>) => {
    setScenes(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  }, []);

  // 영상 생성 실행
  const handleGenerate = useCallback(async () => {
    isAbortedRef.current = false;
    setStep('generating');

    const refImages: ReferenceImages = {
      ...DEFAULT_REFERENCE_IMAGES,
      character: characterImages,
      style: styleImages,
      characterDescription: characterDesc,
    };

    for (let i = 0; i < scenes.length; i++) {
      if (isAbortedRef.current) break;
      const scene = scenes[i];

      // 1. 이미지 생성
      updateScene(i, { status: 'generating_image' });
      setProgress(`씬 ${i + 1}/${scenes.length} — 이미지 생성 중...`);
      let imageBase64: string | null = null;
      try {
        imageBase64 = await generateImageForScene(
          {
            sceneNumber: scene.sceneNumber,
            narration: '',
            visualPrompt: scene.imagePrompt,
            imagePrompt: scene.imagePrompt,
          } as any,
          refImages
        );
        if (!imageBase64) throw new Error('이미지 생성 결과 없음');
        updateScene(i, { imageData: imageBase64 });
      } catch (e: any) {
        updateScene(i, { status: 'error', errorMsg: `이미지 실패: ${e.message}` });
        continue;
      }

      if (isAbortedRef.current) break;

      // 2. Veo 영상 생성
      updateScene(i, { status: 'generating_video' });
      setProgress(`씬 ${i + 1}/${scenes.length} — Veo 영상 생성 중 (2~5분)...`);
      try {
        // base64 data URL에서 raw base64 추출
        const raw = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
        const videoUrl = await generateVeoVideoFromImage(
          raw,
          scene.motionPrompt,
          veoModel,
          aspectRatio,
          secondsPerScene,
          (msg) => setProgress(`씬 ${i + 1}/${scenes.length} — ${msg}`)
        );
        if (!videoUrl) throw new Error('영상 생성 결과 없음');
        updateScene(i, { videoUrl, status: 'done' });
      } catch (e: any) {
        updateScene(i, { status: 'error', errorMsg: `영상 실패: ${e.message}` });
      }
    }

    setStep('completed');
    setProgress('');
  }, [scenes, characterImages, styleImages, characterDesc, veoModel, aspectRatio, secondsPerScene, updateScene]);

  const handleAbort = () => { isAbortedRef.current = true; setProgress('중단 중...'); };

  const statusBadge = (s: SceneState) => {
    if (s.status === 'done') return <span className="text-xs font-bold text-green-400">✅ 완료</span>;
    if (s.status === 'generating_image') return <span className="text-xs font-bold text-yellow-400 animate-pulse">🖼 이미지 생성 중...</span>;
    if (s.status === 'generating_video') return <span className="text-xs font-bold text-blue-400 animate-pulse">🎬 영상 생성 중...</span>;
    if (s.status === 'error') return <span className="text-xs font-bold text-red-400">❌ 실패</span>;
    return <span className="text-xs text-white/30">대기</span>;
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 flex flex-col gap-8">
      {/* 헤더 */}
      <div>
        <h2 className="text-2xl font-black text-white mb-1">🎬 순수 영상 스튜디오</h2>
        <p className="text-sm text-white/40">나레이션 없는 순수 애니메이션 영상 생성 — 이미지 → Veo 영상</p>
      </div>

      {/* 입력 단계 */}
      {(step === 'input' || step === 'scenes_ready') && (
        <div className="flex flex-col gap-6">
          {/* 주제 */}
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 flex flex-col gap-3">
            <label className="text-sm font-bold text-white/70">주제 / 내용</label>
            <input
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="예: 귀여운 곰이 꿀을 찾아 숲을 탐험하는 이야기"
              className="bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-blue-500/50 text-sm"
            />
          </div>

          {/* 참조 이미지 */}
          <div className="grid grid-cols-2 gap-4">
            {/* 캐릭터 참조 */}
            <div
              className="bg-slate-900 border border-slate-700 rounded-2xl p-5 flex flex-col gap-3 cursor-pointer hover:border-slate-500 transition-colors"
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleCharacterFiles(e.dataTransfer.files); }}
              onClick={() => charInputRef.current?.click()}
            >
              <input ref={charInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => handleCharacterFiles(e.target.files)} />
              <label className="text-sm font-bold text-white/70 cursor-pointer">캐릭터 참조 (최대 3장)</label>
              {characterImages.length > 0 ? (
                <div className="flex gap-2 flex-wrap">
                  {characterImages.map((img, i) => (
                    <div key={i} className="relative">
                      <img src={img} className="w-16 h-16 object-cover rounded-lg border border-slate-600" />
                      <button onClick={e => { e.stopPropagation(); setCharacterImages(prev => prev.filter((_, j) => j !== i)); }}
                        className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-xs flex items-center justify-center">×</button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="border-2 border-dashed border-white/10 rounded-xl py-6 text-center text-white/20 text-xs">
                  클릭 또는 드래그로 업로드
                </div>
              )}
              {characterImages.length > 0 && (
                <input
                  value={characterDesc}
                  onChange={e => setCharacterDesc(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  placeholder="캐릭터 설명 (선택) 예: cute brown bear, round eyes"
                  className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-white/20 focus:outline-none focus:border-blue-500/50"
                />
              )}
            </div>

            {/* 화풍 참조 */}
            <div
              className="bg-slate-900 border border-slate-700 rounded-2xl p-5 flex flex-col gap-3 cursor-pointer hover:border-slate-500 transition-colors"
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleStyleFiles(e.dataTransfer.files); }}
              onClick={() => styleInputRef.current?.click()}
            >
              <input ref={styleInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => handleStyleFiles(e.target.files)} />
              <label className="text-sm font-bold text-white/70 cursor-pointer">화풍 참조 (최대 3장)</label>
              {styleImages.length > 0 ? (
                <div className="flex gap-2 flex-wrap">
                  {styleImages.map((img, i) => (
                    <div key={i} className="relative">
                      <img src={img} className="w-16 h-16 object-cover rounded-lg border border-slate-600" />
                      <button onClick={e => { e.stopPropagation(); setStyleImages(prev => prev.filter((_, j) => j !== i)); }}
                        className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-xs flex items-center justify-center">×</button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="border-2 border-dashed border-white/10 rounded-xl py-6 text-center text-white/20 text-xs">
                  레퍼런스 채널 캡처 스크린샷<br />클릭 또는 드래그로 업로드
                </div>
              )}
            </div>
          </div>

          {/* 설정 */}
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 grid grid-cols-3 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-white/50">씬 수</label>
              <select value={sceneCount} onChange={e => setSceneCount(Number(e.target.value))}
                className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none">
                {[3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}개 씬</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-white/50">씬당 초수</label>
              <select value={secondsPerScene} onChange={e => setSecondsPerScene(Number(e.target.value))}
                className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none">
                {[3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}초</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-white/50">Veo 모델</label>
              <select value={veoModel} onChange={e => setVeoModel(e.target.value)}
                className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none">
                {VEO_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
          </div>

          {/* 씬 구성 버튼 */}
          <button
            onClick={handlePlanScenes}
            disabled={isPlanning || !topic.trim()}
            className="w-full py-4 rounded-2xl bg-blue-600/30 hover:bg-blue-600/50 disabled:opacity-40 border border-blue-400/60 text-white font-black text-lg transition-all"
          >
            {isPlanning ? `${progress}` : step === 'scenes_ready' ? '🔄 씬 재구성' : '✨ 씬 구성 생성'}
          </button>
        </div>
      )}

      {/* 씬 미리보기 + 편집 */}
      {step === 'scenes_ready' && scenes.length > 0 && (
        <div className="flex flex-col gap-4">
          <h3 className="text-base font-black text-white/80">생성된 씬 구성 — 프롬프트 수정 가능</h3>
          {scenes.map((s, i) => (
            <div key={i} className="bg-slate-900 border border-slate-700 rounded-2xl p-5 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full bg-blue-600/30 border border-blue-400/50 text-blue-300 text-xs font-black flex items-center justify-center">{s.sceneNumber}</span>
                <span className="text-sm text-white/60">{s.description}</span>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold text-white/40">이미지 프롬프트</label>
                <textarea value={s.imagePrompt} onChange={e => updateScene(i, { imagePrompt: e.target.value })}
                  className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-white/20 focus:outline-none resize-none" rows={2} />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold text-white/40">모션 프롬프트 (Veo)</label>
                <textarea value={s.motionPrompt} onChange={e => updateScene(i, { motionPrompt: e.target.value })}
                  className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-white/20 focus:outline-none resize-none" rows={2} />
              </div>
            </div>
          ))}
          <button onClick={handleGenerate}
            className="w-full py-5 rounded-2xl bg-green-600/30 hover:bg-green-600/50 border border-green-400/60 text-white font-black text-xl transition-all shadow-[0_0_30px_rgba(34,197,94,0.3)]">
            🚀 영상 생성 시작 ({sceneCount}씬 × {secondsPerScene}초)
          </button>
        </div>
      )}

      {/* 생성 진행 / 결과 */}
      {(step === 'generating' || step === 'completed') && (
        <div className="flex flex-col gap-6">
          {/* 진행 상태 */}
          {step === 'generating' && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm font-bold text-yellow-300">{progress || '생성 중...'}</span>
              </div>
              <button onClick={handleAbort} className="px-3 py-1 rounded-lg bg-red-600/20 text-red-400 text-xs font-bold border border-red-500/30 hover:bg-red-600/30">중단</button>
            </div>
          )}

          {step === 'completed' && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-2xl px-5 py-4 text-center">
              <span className="text-sm font-bold text-green-300">✅ 생성 완료! 아래에서 씬별 영상을 확인하세요.</span>
            </div>
          )}

          {/* 씬별 결과 */}
          <div className="grid grid-cols-1 gap-6">
            {scenes.map((s, i) => (
              <div key={i} className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-700/50 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-7 h-7 rounded-full bg-blue-600/30 border border-blue-400/50 text-blue-300 text-xs font-black flex items-center justify-center">{s.sceneNumber}</span>
                    <span className="text-sm text-white/60">{s.description}</span>
                  </div>
                  {statusBadge(s)}
                </div>
                <div className="p-4 grid grid-cols-2 gap-4">
                  {/* 이미지 */}
                  <div className="flex flex-col gap-2">
                    <span className="text-xs text-white/30 font-bold">시작 프레임</span>
                    {s.imageData ? (
                      <img src={s.imageData} className="w-full rounded-xl border border-slate-600 object-cover" style={{ aspectRatio: aspectRatio === '16:9' ? '16/9' : '9/16' }} />
                    ) : (
                      <div className="w-full rounded-xl border border-slate-700 bg-black/30 flex items-center justify-center text-white/20 text-xs" style={{ aspectRatio: aspectRatio === '16:9' ? '16/9' : '9/16' }}>
                        {s.status === 'generating_image' ? '생성 중...' : '대기'}
                      </div>
                    )}
                  </div>
                  {/* 영상 */}
                  <div className="flex flex-col gap-2">
                    <span className="text-xs text-white/30 font-bold">Veo 영상</span>
                    {s.videoUrl ? (
                      <video src={s.videoUrl} controls className="w-full rounded-xl border border-slate-600" style={{ aspectRatio: aspectRatio === '16:9' ? '16/9' : '9/16' }} />
                    ) : (
                      <div className="w-full rounded-xl border border-slate-700 bg-black/30 flex items-center justify-center text-white/20 text-xs" style={{ aspectRatio: aspectRatio === '16:9' ? '16/9' : '9/16' }}>
                        {s.status === 'generating_video' ? 'Veo 생성 중...' : s.status === 'error' ? s.errorMsg : '대기'}
                      </div>
                    )}
                    {s.videoUrl && (
                      <a href={s.videoUrl} download={`scene_${s.sceneNumber}.mp4`}
                        className="w-full py-2 rounded-lg bg-blue-600/20 border border-blue-500/40 text-blue-300 text-xs font-bold text-center hover:bg-blue-600/30 transition-colors">
                        ⬇ 다운로드
                      </a>
                    )}
                  </div>
                </div>
                {s.status === 'error' && (
                  <div className="px-4 pb-4 text-xs text-red-400">{s.errorMsg}</div>
                )}
              </div>
            ))}
          </div>

          {step === 'completed' && (
            <button onClick={() => { setStep('input'); setScenes([]); setTopic(''); }}
              className="w-full py-3 rounded-2xl bg-slate-800 border border-slate-600 text-white/60 font-bold text-sm hover:bg-slate-700 transition-colors">
              처음으로
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default PureVideoStudio;
