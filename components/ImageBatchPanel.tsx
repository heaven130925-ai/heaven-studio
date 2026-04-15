import React, { useState, useRef } from 'react';
import JSZip from 'jszip';
import { generateImage } from '../services/imageService';
import { DEFAULT_REFERENCE_IMAGES, ReferenceImages } from '../types';

// ── localStorage 키 ───────────────────────────────────────────────────────────
const KEY_REWRITE_PROMPT  = 'heaven_imgbatch_rewrite_prompt';
const KEY_IMGPROMPT_GUIDE = 'heaven_imgbatch_imgprompt_guide';

const DEFAULT_REWRITE_PROMPT = `당신은 전문 콘텐츠 작가입니다.
아래 원문 대본을 표절에 걸리지 않도록 완전히 다른 표현과 문장 구조로 각색해주세요.
- 핵심 내용과 흐름은 유지
- 단어, 문장 구조, 비유 등을 새롭게 바꿀 것
- 씬 구분은 원문과 동일하게 유지 (씬 번호 표시)
- 한국어로 작성`;

const DEFAULT_IMGPROMPT_GUIDE = `각 씬의 내용을 시각적으로 표현할 영어 이미지 프롬프트를 생성해주세요.
- 한 씬당 프롬프트 1개
- 영어로 작성
- 구체적인 시각 요소, 분위기, 스타일 포함
- 각 프롬프트는 새 줄로 구분
- 번호 없이 프롬프트 텍스트만 출력`;

// ── 프롬프트 → ScriptScene 변환 후 메인 이미지 엔진 호출 ──────────────────────
async function generateBatchImage(prompt: string, refImages: ReferenceImages): Promise<string> {
  const scene = {
    id: `batch_${Date.now()}`,
    visualPrompt: prompt,
    narration: '',
    imageBase64: null,
    audioBase64: null,
    duration: 3,
  };
  const result = await generateImage(scene as any, refImages);
  if (!result) throw new Error('이미지를 생성하지 못했습니다.');
  return result;
}

// ── Claude/Gemini 텍스트 생성 ──────────────────────────────────────────────────
async function callGeminiText(systemPrompt: string, userText: string, apiKey: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 8192 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini 오류 (${res.status})`);
  const json = await res.json();
  return json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
const ImageBatchPanel: React.FC = () => {
  const [rewritePrompt, setRewritePrompt]   = useState(() => localStorage.getItem(KEY_REWRITE_PROMPT)  || DEFAULT_REWRITE_PROMPT);
  const [imgPromptGuide, setImgPromptGuide] = useState(() => localStorage.getItem(KEY_IMGPROMPT_GUIDE) || DEFAULT_IMGPROMPT_GUIDE);
  const [showSettings, setShowSettings]     = useState(false);

  const [refImages, setRefImages] = useState<ReferenceImages>({ ...DEFAULT_REFERENCE_IMAGES });
  const charInputRef  = useRef<HTMLInputElement>(null);
  const styleInputRef = useRef<HTMLInputElement>(null);

  const [originalScript, setOriginalScript] = useState('');
  const [rewrittenScript, setRewrittenScript] = useState('');
  const [imagePrompts, setImagePrompts]     = useState<string[]>([]);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]); // base64[]
  const [previewImage, setPreviewImage]       = useState<string | null>(null);
  const [previewIdx, setPreviewIdx]           = useState(0);

  const [status, setStatus]   = useState('');
  const [loading, setLoading] = useState<'rewrite' | 'prompts' | 'images' | 'preview' | null>(null);
  const [progress, setProgress] = useState(0);
  const abortRef = useRef(false);

  const getApiKey = () => localStorage.getItem('heaven_gemini_key') || '';
  const checkApiKey = () => { if (!getApiKey()) { alert('Gemini API 키를 먼저 설정해주세요.'); return false; } return true; };

  // ── 이미지 파일 → base64 ─────────────────────────────────────────────────
  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = e => res(e.target?.result as string);
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });

  const handleRefUpload = async (type: 'character' | 'style', files: FileList | null) => {
    if (!files || files.length === 0) return;
    const b64list = await Promise.all(Array.from(files).slice(0, 2).map(readFileAsBase64));
    setRefImages(prev => ({ ...prev, [type]: b64list }));
  };

  // ── 저장 ──────────────────────────────────────────────────────────────────
  const saveSettings = () => {
    localStorage.setItem(KEY_REWRITE_PROMPT, rewritePrompt);
    localStorage.setItem(KEY_IMGPROMPT_GUIDE, imgPromptGuide);
    setShowSettings(false);
    setStatus('설정 저장됨');
    setTimeout(() => setStatus(''), 2000);
  };

  // ── Step 1: 각색 ──────────────────────────────────────────────────────────
  const handleRewrite = async () => {
    if (!checkApiKey()) return;
    const apiKey = getApiKey();
    if (!originalScript.trim()) { alert('원문 대본을 입력해주세요.'); return; }
    setLoading('rewrite');
    setStatus('대본 각색 중...');
    try {
      const result = await callGeminiText(rewritePrompt, originalScript, apiKey);
      setRewrittenScript(result);
      setImagePrompts([]);
      setGeneratedImages([]);
      setStatus('각색 완료');
    } catch (e: any) {
      setStatus(`오류: ${e.message}`);
    } finally {
      setLoading(null);
    }
  };

  // ── Step 2: 이미지 프롬프트 생성 ──────────────────────────────────────────
  const handleGeneratePrompts = async () => {
    if (!checkApiKey()) return;
    const apiKey = getApiKey();
    const source = rewrittenScript || originalScript;
    if (!source.trim()) { alert('대본을 먼저 입력 또는 각색해주세요.'); return; }
    setLoading('prompts');
    setStatus('이미지 프롬프트 생성 중...');
    try {
      const result = await callGeminiText(imgPromptGuide, source, apiKey);
      const prompts = result.split('\n').map(l => l.trim()).filter(Boolean);
      setImagePrompts(prompts);
      setGeneratedImages([]);
      setStatus(`프롬프트 ${prompts.length}개 생성 완료`);
    } catch (e: any) {
      setStatus(`오류: ${e.message}`);
    } finally {
      setLoading(null);
    }
  };

  // ── 미리보기 (1장) ────────────────────────────────────────────────────────
  const handlePreview = async (idx: number) => {
    if (!checkApiKey()) return;
    const prompt = imagePrompts[idx];
    if (!prompt?.trim()) { alert('프롬프트가 비어있습니다.'); return; }
    setLoading('preview');
    setPreviewImage(null);
    setPreviewIdx(idx);
    setStatus(`미리보기 생성 중... (${idx + 1}번 프롬프트)`);
    try {
      const b64 = await generateBatchImage(prompt, refImages);
      setPreviewImage(b64);
      setStatus('');
    } catch (e: any) {
      setStatus(`미리보기 오류: ${e.message}`);
    } finally {
      setLoading(null);
    }
  };

  // ── Step 3: 배치 이미지 생성 ──────────────────────────────────────────────
  const handleGenerateImages = async () => {
    if (!checkApiKey()) return;
    if (imagePrompts.length === 0) { alert('이미지 프롬프트를 먼저 생성해주세요.'); return; }
    abortRef.current = false;
    setLoading('images');
    setGeneratedImages([]);
    const results: string[] = [];
    for (let i = 0; i < imagePrompts.length; i++) {
      if (abortRef.current) break;
      setStatus(`이미지 생성 중... ${i + 1} / ${imagePrompts.length}`);
      setProgress(Math.round((i / imagePrompts.length) * 100));
      try {
        const b64 = await generateBatchImage(imagePrompts[i], refImages);
        results.push(b64);
        setGeneratedImages([...results]);
      } catch (e: any) {
        results.push('');
        setGeneratedImages([...results]);
        setStatus(`[${i + 1}] 오류: ${e.message} — 계속 진행 중...`);
        await new Promise(r => setTimeout(r, 1000));
      }
      // API 쿼터 보호용 딜레이
      if (i < imagePrompts.length - 1) await new Promise(r => setTimeout(r, 500));
    }
    setProgress(100);
    setLoading(null);
    setStatus(abortRef.current ? '중단됨' : `완료 — ${results.filter(Boolean).length}개 생성됨`);
  };

  // ── ZIP 다운로드 ───────────────────────────────────────────────────────────
  const handleDownloadZip = async () => {
    const zip = new JSZip();
    generatedImages.forEach((b64, i) => {
      if (b64) zip.file(`image_${String(i + 1).padStart(3, '0')}.png`, b64, { base64: true });
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `images_${Date.now()}.zip`; a.click();
    URL.revokeObjectURL(url);
  };

  const isGenerating = loading !== null;
  const doneImages = generatedImages.filter(Boolean).length;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

      {/* ── Step 1: 원문 대본 입력 (최상단) ── */}
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-xs font-black text-white flex-shrink-0">1</span>
            <span className="text-sm font-bold text-white">원문 대본 입력</span>
          </div>
          <button
            onClick={() => setShowSettings(s => !s)}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold bg-slate-800 border border-slate-700 hover:border-slate-500 rounded-lg text-slate-400 transition-all"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            지침 설정
          </button>
        </div>
        <textarea
          value={originalScript}
          onChange={e => setOriginalScript(e.target.value)}
          placeholder="유튜브에서 복사한 원문 대본을 붙여넣으세요..."
          rows={8}
          disabled={isGenerating}
          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm focus:border-blue-500/50 focus:outline-none resize-y placeholder-slate-600"
        />
        <button
          onClick={handleRewrite}
          disabled={isGenerating || !originalScript.trim()}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black rounded-xl text-sm transition-colors flex items-center gap-2"
        >
          {loading === 'rewrite' ? (
            <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>각색 중...</>
          ) : '각색하기'}
        </button>
      </div>

      {/* 지침 설정 패널 */}
      {showSettings && (
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">각색 프롬프트 (시스템 지침)</label>
            <textarea
              value={rewritePrompt}
              onChange={e => setRewritePrompt(e.target.value)}
              rows={6}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm focus:border-blue-500/50 focus:outline-none resize-y font-mono"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">이미지 프롬프트 생성 지침</label>
            <textarea
              value={imgPromptGuide}
              onChange={e => setImgPromptGuide(e.target.value)}
              rows={5}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm focus:border-blue-500/50 focus:outline-none resize-y font-mono"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={saveSettings}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-xl text-sm transition-colors"
            >저장</button>
            <button
              onClick={() => { setRewritePrompt(DEFAULT_REWRITE_PROMPT); setImgPromptGuide(DEFAULT_IMGPROMPT_GUIDE); }}
              className="px-5 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl text-sm transition-colors"
            >기본값 복원</button>
          </div>
        </div>
      )}

      {/* ── 레퍼런스 이미지 ── */}
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-white">레퍼런스 이미지</span>
          <span className="text-xs text-slate-500">(선택사항 — 캐릭터/스타일 일관성)</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {/* 캐릭터 */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-400">캐릭터 참조 (최대 2장)</label>
            <input ref={charInputRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => handleRefUpload('character', e.target.files)} />
            <div
              onClick={() => charInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 h-24 border-2 border-dashed border-slate-700 hover:border-blue-500/50 rounded-xl cursor-pointer transition-colors bg-slate-800/40"
            >
              {refImages.character.length > 0 ? (
                <div className="flex gap-1.5">
                  {refImages.character.map((img, i) => (
                    <img key={i} src={img} alt="" className="h-16 w-12 object-cover rounded-lg border border-slate-600" />
                  ))}
                </div>
              ) : (
                <><svg className="w-6 h-6 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
                <span className="text-xs text-slate-600">클릭해서 업로드</span></>
              )}
            </div>
            {refImages.character.length > 0 && (
              <button onClick={() => setRefImages(p => ({ ...p, character: [] }))}
                className="text-xs text-slate-600 hover:text-red-400 transition-colors">제거</button>
            )}
          </div>
          {/* 스타일 */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-400">스타일 참조 (최대 2장)</label>
            <input ref={styleInputRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => handleRefUpload('style', e.target.files)} />
            <div
              onClick={() => styleInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 h-24 border-2 border-dashed border-slate-700 hover:border-purple-500/50 rounded-xl cursor-pointer transition-colors bg-slate-800/40"
            >
              {refImages.style.length > 0 ? (
                <div className="flex gap-1.5">
                  {refImages.style.map((img, i) => (
                    <img key={i} src={img} alt="" className="h-16 w-12 object-cover rounded-lg border border-slate-600" />
                  ))}
                </div>
              ) : (
                <><svg className="w-6 h-6 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                <span className="text-xs text-slate-600">클릭해서 업로드</span></>
              )}
            </div>
            {refImages.style.length > 0 && (
              <button onClick={() => setRefImages(p => ({ ...p, style: [] }))}
                className="text-xs text-slate-600 hover:text-red-400 transition-colors">제거</button>
            )}
          </div>
        </div>
      </div>

      {/* 각색 결과 */}
      {rewrittenScript && (
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-green-400 uppercase tracking-wider">각색 결과</span>
            <button
              onClick={() => navigator.clipboard.writeText(rewrittenScript)}
              className="text-xs text-slate-500 hover:text-white transition-colors"
            >복사</button>
          </div>
          <textarea
            value={rewrittenScript}
            onChange={e => setRewrittenScript(e.target.value)}
            rows={10}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm focus:border-blue-500/50 focus:outline-none resize-y"
          />
        </div>
      )}

      {/* ── Step 2: 이미지 프롬프트 생성 ── */}
      {(rewrittenScript || originalScript) && (
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-xs font-black text-white flex-shrink-0">2</span>
            <span className="text-sm font-bold text-white">이미지 프롬프트 생성</span>
          </div>
          <button
            onClick={handleGeneratePrompts}
            disabled={isGenerating}
            className="px-6 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black rounded-xl text-sm transition-colors flex items-center gap-2"
          >
            {loading === 'prompts' ? (
              <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>생성 중...</>
            ) : '이미지 프롬프트 생성'}
          </button>

          {imagePrompts.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-semibold">{imagePrompts.length}개 프롬프트 (한 줄 = 1장, 수정 가능)</span>
                <button
                  onClick={() => navigator.clipboard.writeText(imagePrompts.join('\n'))}
                  className="text-xs text-slate-500 hover:text-white transition-colors"
                >전체 복사</button>
              </div>
              <textarea
                value={imagePrompts.join('\n')}
                onChange={e => setImagePrompts(e.target.value.split('\n'))}
                rows={Math.min(imagePrompts.length + 2, 20)}
                className="w-full bg-slate-800 border border-purple-500/30 rounded-xl px-4 py-3 text-white text-xs focus:border-purple-500/60 focus:outline-none resize-y font-mono leading-relaxed"
              />
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: 배치 이미지 생성 ── */}
      {imagePrompts.length > 0 && (
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-xs font-black text-white flex-shrink-0">3</span>
            <span className="text-sm font-bold text-white">이미지 생성 (Imagen 3)</span>
            <span className="text-xs text-slate-500">총 {imagePrompts.filter(p => p.trim()).length}장</span>
          </div>

          {/* 미리보기 선택 */}
          <div className="flex items-center gap-3 p-3 bg-slate-800/60 rounded-xl border border-slate-700/60">
            <span className="text-xs text-slate-400 font-semibold flex-shrink-0">미리보기</span>
            <select
              value={previewIdx}
              onChange={e => { setPreviewIdx(Number(e.target.value)); setPreviewImage(null); }}
              disabled={isGenerating}
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none"
            >
              {imagePrompts.filter(p => p.trim()).map((p, i) => (
                <option key={i} value={i}>{i + 1}번 — {p.slice(0, 60)}{p.length > 60 ? '...' : ''}</option>
              ))}
            </select>
            <button
              onClick={() => handlePreview(previewIdx)}
              disabled={isGenerating}
              className="px-4 py-1.5 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black rounded-lg text-xs transition-colors flex items-center gap-1.5 flex-shrink-0"
            >
              {loading === 'preview'
                ? <><svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>생성 중...</>
                : '1장 미리보기'
              }
            </button>
          </div>

          {/* 미리보기 결과 */}
          {previewImage && (
            <div className="flex gap-4 items-start p-4 bg-slate-800/40 rounded-xl border border-yellow-500/20">
              <img
                src={`data:image/png;base64,${previewImage}`}
                alt="preview"
                className="w-32 flex-shrink-0 rounded-lg border border-slate-600 object-cover"
                style={{ aspectRatio: '9/16' }}
              />
              <div className="flex-1 space-y-2">
                <p className="text-xs text-yellow-400 font-bold">{previewIdx + 1}번 프롬프트 결과</p>
                <p className="text-xs text-slate-400 font-mono leading-relaxed">{imagePrompts[previewIdx]}</p>
                <a
                  href={`data:image/png;base64,${previewImage}`}
                  download={`preview_${previewIdx + 1}.png`}
                  className="inline-block text-xs text-slate-500 hover:text-white transition-colors"
                >저장</a>
              </div>
            </div>
          )}

          {/* 전체 생성 버튼 */}
          <div className="flex gap-2 flex-wrap">
            {loading === 'images' ? (
              <button
                onClick={() => { abortRef.current = true; }}
                className="px-6 py-2.5 bg-red-600 hover:bg-red-500 text-white font-black rounded-xl text-sm transition-colors"
              >중단</button>
            ) : (
              <button
                onClick={handleGenerateImages}
                disabled={isGenerating}
                className="px-6 py-2.5 bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black rounded-xl text-sm transition-colors"
              >전체 생성 시작 ({imagePrompts.filter(p => p.trim()).length}장)</button>
            )}
            {doneImages > 0 && (
              <button
                onClick={handleDownloadZip}
                className="px-6 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-black rounded-xl text-sm transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                ZIP 다운로드 ({doneImages}장)
              </button>
            )}
          </div>

          {/* 진행률 */}
          {loading === 'images' && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-400">
                <span>{status}</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {/* 이미지 그리드 */}
          {generatedImages.length > 0 && (
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {generatedImages.map((b64, i) => (
                <div key={i} className="aspect-[9/16] rounded-lg overflow-hidden bg-slate-800 border border-slate-700">
                  {b64
                    ? <img src={`data:image/png;base64,${b64}`} alt={`img_${i + 1}`} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-red-400 text-xs">오류</div>
                  }
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 상태 메시지 */}
      {status && loading === null && (
        <p className="text-center text-sm text-slate-500">{status}</p>
      )}
    </div>
  );
};

export default ImageBatchPanel;
