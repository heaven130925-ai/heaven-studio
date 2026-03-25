
import React, { useState, useEffect } from 'react';
import { CharacterInfo } from '../services/geminiService';
import { generateCharacterImage } from '../services/geminiService';

interface CharacterSetupProps {
  characters: CharacterInfo[];
  onDone: (characters: CharacterInfo[]) => void;
  onSkip: () => void;
  onCancel?: () => void;
}

const CharacterSetup: React.FC<CharacterSetupProps> = ({ characters, onDone, onSkip, onCancel }) => {
  const [chars, setChars] = useState<CharacterInfo[]>(characters);

  // 부모에서 캐릭터 추출 완료 시 새 캐릭터만 추가 (기존 편집 내용 유지)
  useEffect(() => {
    if (characters.length === 0) return;
    setChars(prev => {
      const existingNames = new Set(prev.map(c => c.name));
      const added = characters.filter(c => !existingNames.has(c.name));
      return added.length > 0 ? [...prev, ...added] : prev;
    });
  }, [characters]);
  const [generatingIdx, setGeneratingIdx] = useState<number | null>(null);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [newChar, setNewChar] = useState({ name: '', description: '', imagePrompt: '' });
  const [showAddForm, setShowAddForm] = useState(false);

  const updateChar = (idx: number, field: keyof CharacterInfo, value: string) => {
    setChars(prev => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  };

  const generateOne = async (idx: number) => {
    setGeneratingIdx(idx);
    try {
      const imageData = await generateCharacterImage(chars[idx]);
      setChars(prev => prev.map((c, i) => i === idx ? { ...c, imageData } : c));
    } catch (e: any) {
      alert(`이미지 생성 실패: ${e.message}`);
    }
    setGeneratingIdx(null);
  };

  const generateAll = async () => {
    setIsGeneratingAll(true);
    for (let i = 0; i < chars.length; i++) {
      setGeneratingIdx(i);
      try {
        const imageData = await generateCharacterImage(chars[i]);
        setChars(prev => prev.map((c, j) => j === i ? { ...c, imageData } : c));
      } catch (e: any) {
        console.error(`캐릭터 ${chars[i].name} 이미지 생성 실패:`, e.message);
      }
    }
    setGeneratingIdx(null);
    setIsGeneratingAll(false);
  };

  const addCharacter = () => {
    if (!newChar.name.trim()) return;
    setChars(prev => [...prev, { ...newChar, imageData: null }]);
    setNewChar({ name: '', description: '', imagePrompt: '' });
    setShowAddForm(false);
  };

  const removeChar = (idx: number) => {
    setChars(prev => prev.filter((_, i) => i !== idx));
  };

  const generatedCount = chars.filter(c => c.imageData).length;

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950 flex flex-col overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <h1 className="text-lg font-black text-white tracking-tight">캐릭터 레퍼런스 설정</h1>
            <p className="text-xs text-slate-400">등장인물 이미지를 생성하면 스토리보드에서 일관된 캐릭터가 유지됩니다</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel ?? onSkip}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-sm font-bold transition-all border border-slate-600/50"
          >
            ← 메인으로
          </button>
          <button
            onClick={generateAll}
            disabled={isGeneratingAll || generatingIdx !== null || chars.length === 0}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-black transition-all border border-indigo-500/60 shadow-[0_0_12px_rgba(99,102,241,0.3)]"
          >
            {isGeneratingAll ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                일괄생성 중...
              </span>
            ) : `이미지 일괄생성${chars.length > 0 ? ` (${chars.length}명)` : ''}`}
          </button>
          <button
            onClick={() => onDone(chars)}
            className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-black transition-all border border-emerald-500/60 shadow-[0_0_12px_rgba(16,185,129,0.3)]"
          >
            {generatedCount > 0
              ? `스토리보드 생성 시작 (${generatedCount}명 적용)`
              : '스토리보드 생성 시작'}
          </button>
        </div>
      </div>

      {/* 본문 */}
      <div className="flex-1 overflow-y-auto p-6">
        {chars.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4 text-slate-500">
            <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center text-3xl">👤</div>
            <p className="text-sm">대본에서 등장인물을 찾지 못했습니다.</p>
            <p className="text-xs text-slate-600">직접 캐릭터를 추가하거나 건너뛰세요.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5 max-w-7xl mx-auto">
            {chars.map((char, idx) => (
              <div key={idx} className="bg-slate-900 border border-slate-700/60 rounded-2xl overflow-hidden flex flex-col">
                {/* 이미지 영역 */}
                <div className="relative bg-slate-800 aspect-video flex items-center justify-center">
                  {char.imageData ? (
                    <img
                      src={`data:image/jpeg;base64,${char.imageData}`}
                      alt={char.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-slate-600">
                      <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center text-2xl">👤</div>
                      <span className="text-xs">이미지 없음</span>
                    </div>
                  )}
                  {/* 생성 오버레이 */}
                  {generatingIdx === idx && (
                    <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2">
                      <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs text-indigo-300 font-bold">생성 중...</span>
                    </div>
                  )}
                  {/* 삭제 버튼 */}
                  <button
                    onClick={() => removeChar(idx)}
                    className="absolute top-2 right-2 w-6 h-6 rounded-full bg-red-600/80 hover:bg-red-500 text-white text-xs flex items-center justify-center font-bold transition-colors"
                  >
                    ✕
                  </button>
                  {/* 이미지 있으면 재생성 버튼 */}
                  {char.imageData && (
                    <button
                      onClick={() => generateOne(idx)}
                      disabled={generatingIdx !== null || isGeneratingAll}
                      className="absolute bottom-2 right-2 px-2 py-1 rounded-lg bg-slate-900/80 hover:bg-indigo-600/80 text-slate-300 hover:text-white text-[10px] font-bold transition-colors border border-slate-600/50"
                    >
                      재생성
                    </button>
                  )}
                </div>

                {/* 정보 영역 */}
                <div className="p-4 flex flex-col gap-3 flex-1">
                  {/* 이름 */}
                  <div>
                    <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">캐릭터 이름</label>
                    <input
                      value={char.name}
                      onChange={e => updateChar(idx, 'name', e.target.value)}
                      className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  {/* 설명 */}
                  <div>
                    <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">외모/특징 설명</label>
                    <textarea
                      value={char.description}
                      onChange={e => updateChar(idx, 'description', e.target.value)}
                      rows={2}
                      className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 resize-none"
                    />
                  </div>
                  {/* 이미지 프롬프트 */}
                  <div className="flex-1">
                    <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">이미지 프롬프트 (영어)</label>
                    <textarea
                      value={char.imagePrompt}
                      onChange={e => updateChar(idx, 'imagePrompt', e.target.value)}
                      rows={3}
                      className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-400 focus:outline-none focus:border-indigo-500 resize-none font-mono"
                    />
                  </div>
                  {/* 생성/재생성 버튼 */}
                  {generatingIdx === idx ? (
                    <div className="w-full py-2 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center gap-2 text-indigo-300 text-sm font-bold">
                      <span className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                      생성 중...
                    </div>
                  ) : char.imageData ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => generateOne(idx)}
                        disabled={generatingIdx !== null || isGeneratingAll}
                        className="flex-1 py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/40 disabled:opacity-40 text-indigo-300 text-sm font-bold border border-indigo-500/40 transition-all"
                      >
                        이미지 재생성
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => generateOne(idx)}
                      disabled={generatingIdx !== null || isGeneratingAll}
                      className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-bold border border-indigo-500/60 transition-all shadow-[0_0_10px_rgba(99,102,241,0.3)]"
                    >
                      이미지 생성
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 캐릭터 추가 */}
        <div className="max-w-7xl mx-auto mt-5">
          {!showAddForm ? (
            <button
              onClick={() => setShowAddForm(true)}
              className="w-full py-3 rounded-xl border border-dashed border-slate-600 text-slate-500 hover:text-slate-300 hover:border-slate-500 text-sm font-bold transition-colors"
            >
              + 캐릭터 직접 추가
            </button>
          ) : (
            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-3">
              <p className="text-sm font-bold text-slate-300">새 캐릭터 추가</p>
              <input
                value={newChar.name}
                onChange={e => setNewChar(p => ({ ...p, name: e.target.value }))}
                placeholder="캐릭터 이름 (예: 할아버지)"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
              <textarea
                value={newChar.description}
                onChange={e => setNewChar(p => ({ ...p, description: e.target.value }))}
                placeholder="외모/특징 설명 (예: 70대 백발 노인, 주름진 얼굴, 한복 착용)"
                rows={2}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500 resize-none"
              />
              <textarea
                value={newChar.imagePrompt}
                onChange={e => setNewChar(p => ({ ...p, imagePrompt: e.target.value }))}
                placeholder="Portrait of elderly Korean man in his 70s, white hair, deeply wrinkled face, wearing traditional hanbok. Clean white background, professional portrait."
                rows={3}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-400 focus:outline-none focus:border-indigo-500 resize-none font-mono"
              />
              <div className="flex gap-2">
                <button onClick={addCharacter} className="flex-1 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold transition-colors">추가</button>
                <button onClick={() => setShowAddForm(false)} className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-bold transition-colors">취소</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 하단 안내 */}
      <div className="shrink-0 px-6 py-3 border-t border-slate-800 bg-slate-950">
        <p className="text-xs text-slate-600 text-center">
          이미지가 생성된 캐릭터만 레퍼런스로 사용됩니다. 이미지가 없는 캐릭터는 무시됩니다. 씬별로 나레이션에 해당 캐릭터 이름이 포함된 경우에만 해당 캐릭터 레퍼런스가 적용됩니다.
        </p>
      </div>
    </div>
  );
};

export default CharacterSetup;
