import React, { useState, useEffect } from 'react';
import { CONFIG } from '../config';

// ── 타입 ──────────────────────────────────────────────────────────────────────
export interface WritingProfile {
  id: string;
  name: string;
  emoji: string;
  description: string;
  prompt: string;
}

// ── 기본 프로필 데이터 ─────────────────────────────────────────────────────────
const DEFAULT_WRITING_PROFILES: WritingProfile[] = [
  { id: 'horror', name: '공포/미스터리', emoji: '👻', description: '소름 돋는 반전, 몰입감 있는 공포 문체',
    prompt: '반말 사용 필수. 공포스럽고 몰입감 있는 문체로 작성. 각 씬은 짧고 임팩트 있게. 마지막 씬은 반드시 소름 돋는 반전으로 마무리. 시청자가 혼자 보기 무서울 정도의 분위기를 만들어라. 지문 없이 나레이션만으로 장면을 생생하게 묘사. 긴장감을 위해 짧은 문장을 자주 활용 ("그 순간이었다.", "문이 열렸다." 등).' },
  { id: 'history', name: '역사 스토리텔러', emoji: '📜', description: '흥미로운 이야기체, 인물 중심 서술',
    prompt: '흥미로운 이야기체 서술. 역사적 사실 기반, 현재와의 연관성 언급. 인물 중심으로 감정 이입이 되도록 작성. "당신이 그 시대에 있었다면..." 식으로 시청자를 현장에 끌어들여라. 반말/존댓말 혼용 가능하나 생동감 있게. 교과서 느낌 절대 금지 — 친구에게 흥미로운 이야기 들려주듯 써라.' },
  { id: 'economy', name: '경제 분석가', emoji: '📈', description: '숫자/수치 중심, 실생활 예시로 쉽게',
    prompt: '친근하고 이해하기 쉬운 말투. 숫자와 수치를 반드시 포함 (예: "지난 10년간 38% 상승"). 어려운 경제 개념은 반드시 실생활 예시로 풀어서 설명. 핵심 포인트는 3가지로 간결하게 정리. 시청자가 "아, 이래서 그렇구나!" 하는 깨달음의 순간을 만들어라. 지나치게 전문적인 용어 사용 시 바로 괄호 안에 쉬운 설명 추가.' },
  { id: 'science', name: '과학 해설자', emoji: '🔭', description: '경이로움 자극, 쉬운 비유, 규모감',
    prompt: '경이로움과 설렘을 자극하는 문체. 어려운 개념은 반드시 일상적 비유로 설명 (예: "빛의 속도는 서울-부산을 1초에 500번 왕복하는 것과 같다"). 숫자로 규모감을 표현. "믿기 어렵겠지만", "과학자들도 놀란" 같은 표현으로 흥미 유발. 존댓말 사용, 친근하고 열정적인 톤.' },
  { id: 'psychology', name: '심리 상담사', emoji: '🧠', description: '공감, 따뜻한 말투, 자기 돌아보기',
    prompt: '공감하는 따뜻하고 부드러운 말투. 독자가 자기 자신을 돌아볼 수 있도록 일상 속 사례로 설명. "혹시 이런 경험 있으신가요?", "많은 분들이 이런 감정을 느낍니다" 식으로 공감대 형성. 심리학 용어는 반드시 쉽게 풀어서. 마지막은 따뜻한 위로나 실천 가능한 조언으로 마무리. 존댓말 사용.' },
  { id: 'comedy', name: '유머/썰 풀기', emoji: '😂', description: '반말, 구어체, 과장된 리액션',
    prompt: '반말 사용 필수. 썰 풀듯이 구어체로 자연스럽게 작성. 과장된 표현과 리액션 적극 활용 ("진짜 미쳤다", "이게 말이 돼?", "개웃김"). 상황을 생생하게 묘사해서 독자가 상상하며 웃을 수 있게. 예상치 못한 반전으로 마무리. 진지한 교훈이나 결말 절대 금지. 친구한테 재밌는 썰 풀어주는 느낌으로.' },
  { id: 'news', name: '뉴스 앵커', emoji: '📰', description: '객관적, 핵심 팩트 중심, 간결',
    prompt: '중립적이고 객관적인 시각. 핵심 팩트 중심으로 간결하게 전달. 각 씬은 "누가, 무엇을, 왜" 한 줄로 정리 가능해야 함. 감정적 표현 최소화, 사실 전달에 집중. 마지막에는 "이 이슈가 왜 중요한지" 한 줄 설명으로 마무리. 존댓말 사용, 신뢰감 있는 톤.' },
  { id: 'health', name: '건강/의학 전문가', emoji: '💊', description: '신뢰감, 의학적 사실, 실천 조언',
    prompt: '신뢰감 있고 권위 있는 말투. 의학적 사실과 연구 결과 기반. 어려운 의학 용어는 반드시 쉽게 풀어서 설명. 실천 가능한 구체적 조언 포함 (예: "하루 30분, 주 3회"). 공포심 자극은 적절히, 해결책도 함께 제시. 마지막은 "전문의 상담을 권장합니다" 같은 안전 문구로 마무리. 존댓말 사용.' },
];

// ── 카테고리별 기본 글쓰기 지침 ────────────────────────────────────────────────
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
  '유머/웃긴영상': '반말 사용 필수, 썰 풀듯이 구어체로 자연스럽게, 과장된 표현과 리액션 적극 활용("진짜 미쳤다", "이게 말이 돼?", "완전 개웃김"), 상황을 생생하게 묘사해서 독자가 상상하며 웃을 수 있게, 예상치 못한 반전으로 마무리, 절대 인간관계 교훈이나 진지한 결말 금지',
  '영화/드라마/애니': '영화/드라마 팬처럼 열정적이고 생생한 말투, 핵심 장면 묘사 중심, 스포 없이 궁금증 유발, 왜 봐야 하는지 감정적으로 어필',
  '쇼핑/제품리뷰': '솔직하고 직접적인 말투, 장단점 명확히, 실제 사용 경험처럼 생생하게, 가격 대비 가치 강조, 살지 말지 결론 명확하게',
};

// ── 컴포넌트 ──────────────────────────────────────────────────────────────────
interface WritingProfilePanelProps {
  activeCategory: string;
}

const WritingProfilePanel: React.FC<WritingProfilePanelProps> = ({ activeCategory }) => {
  const loadProfiles = (): WritingProfile[] => {
    try {
      const saved = localStorage.getItem('heaven_writing_profiles');
      if (saved) return JSON.parse(saved);
    } catch {}
    return DEFAULT_WRITING_PROFILES;
  };

  const [writingProfiles, setWritingProfiles] = useState<WritingProfile[]>(loadProfiles);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(
    localStorage.getItem('heaven_active_writing_profile')
  );
  const [showProfilePanel, setShowProfilePanel] = useState(false);
  const [editingProfile, setEditingProfile] = useState<WritingProfile | null>(null);
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);

  // 카테고리 변경 시 활성 프로필이 없으면 카테고리 기본 지침 로드
  useEffect(() => {
    if (!activeCategory || activeProfileId) return;
    const saved = localStorage.getItem(`${CONFIG.STORAGE_KEYS.CATEGORY_GUIDE_PREFIX}${activeCategory}`);
    const guide = saved !== null ? saved : (CATEGORY_DEFAULT_GUIDES[activeCategory] || '');
    localStorage.setItem('heaven_writing_guide', guide);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory]);

  const saveProfiles = (profiles: WritingProfile[]) => {
    setWritingProfiles(profiles);
    localStorage.setItem('heaven_writing_profiles', JSON.stringify(profiles));
  };

  const selectProfile = (profile: WritingProfile | null) => {
    const id = profile?.id ?? null;
    setActiveProfileId(id);
    if (id) localStorage.setItem('heaven_active_writing_profile', id);
    else localStorage.removeItem('heaven_active_writing_profile');
    localStorage.setItem('heaven_writing_guide', profile?.prompt ?? '');
  };

  const deleteProfile = (id: string) => {
    saveProfiles(writingProfiles.filter(p => p.id !== id));
    if (activeProfileId === id) selectProfile(null);
  };

  const saveEditingProfile = () => {
    if (!editingProfile || !editingProfile.name.trim() || !editingProfile.prompt.trim()) return;
    const existing = writingProfiles.find(p => p.id === editingProfile.id);
    const updated = existing
      ? writingProfiles.map(p => p.id === editingProfile.id ? editingProfile : p)
      : [...writingProfiles, editingProfile];
    saveProfiles(updated);
    if (isCreatingProfile || activeProfileId === editingProfile.id) selectProfile(editingProfile);
    setEditingProfile(null);
    setIsCreatingProfile(false);
  };

  const activeProfile = writingProfiles.find(p => p.id === activeProfileId) ?? null;

  return (
    <>
      {/* 트리거 버튼 */}
      <button type="button"
        onClick={() => { setShowProfilePanel(v => !v); setEditingProfile(null); setIsCreatingProfile(false); }}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${activeProfile ? 'bg-violet-600/20 border-violet-500/50 text-violet-300' : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:text-white/80'}`}>
        <span>{activeProfile ? `${activeProfile.emoji} ${activeProfile.name}` : '✍️ 글쓰기 프로필'}</span>
        <span className="text-white/30">{showProfilePanel ? '▲' : '▼'}</span>
      </button>
      {activeProfile && (
        <button type="button" onClick={() => selectProfile(null)}
          className="text-xs text-white/30 hover:text-white/60 transition-colors px-1">✕</button>
      )}

      {/* 드롭다운 패널 */}
      {showProfilePanel && (
        <div className="w-full bg-black/60 border border-violet-500/20 rounded-2xl p-3 space-y-2">
          {editingProfile ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input value={editingProfile.emoji}
                  onChange={e => setEditingProfile({ ...editingProfile, emoji: e.target.value })}
                  className="w-12 bg-black/50 border border-violet-500/30 rounded-lg px-2 py-1.5 text-sm text-white text-center focus:outline-none focus:border-violet-400"
                  placeholder="😊" maxLength={2} />
                <input value={editingProfile.name}
                  onChange={e => setEditingProfile({ ...editingProfile, name: e.target.value })}
                  className="flex-1 bg-black/50 border border-violet-500/30 rounded-lg px-3 py-1.5 text-sm text-white placeholder-white/25 focus:outline-none focus:border-violet-400"
                  placeholder="프로필 이름 (예: 역사 스토리텔러)" />
              </div>
              <input value={editingProfile.description}
                onChange={e => setEditingProfile({ ...editingProfile, description: e.target.value })}
                className="w-full bg-black/50 border border-violet-500/30 rounded-lg px-3 py-1.5 text-sm text-white placeholder-white/25 focus:outline-none focus:border-violet-400"
                placeholder="한 줄 설명 (예: 소름 돋는 반전, 몰입감 있는 공포 문체)" />
              <textarea value={editingProfile.prompt}
                onChange={e => setEditingProfile({ ...editingProfile, prompt: e.target.value })}
                className="w-full bg-black/50 border border-violet-500/30 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/25 resize-none focus:outline-none focus:border-violet-400"
                rows={5}
                placeholder={"AI에게 전달할 글쓰기 지침을 상세하게 작성하세요.\n예: 반말 사용 필수. 공포스럽고 몰입감 있는 문체. 각 씬은 짧고 임팩트 있게. 마지막은 소름 돋는 반전으로 마무리..."} />
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => { setEditingProfile(null); setIsCreatingProfile(false); }}
                  className="px-3 py-1.5 text-xs text-white/40 hover:text-white/70 border border-white/10 rounded-lg transition-colors">취소</button>
                <button type="button" onClick={saveEditingProfile}
                  disabled={!editingProfile.name.trim() || !editingProfile.prompt.trim()}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-violet-600/50 hover:bg-violet-600/70 border border-violet-500/40 rounded-lg transition-colors disabled:opacity-30">저장</button>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-1.5 max-h-52 overflow-y-auto pr-0.5">
                {writingProfiles.map(profile => (
                  <div key={profile.id}
                    onClick={() => { selectProfile(activeProfileId === profile.id ? null : profile); }}
                    className={`relative group cursor-pointer rounded-xl border px-3 py-2 transition-all ${activeProfileId === profile.id ? 'bg-violet-600/25 border-violet-400/60' : 'bg-white/[0.03] border-white/[0.07] hover:border-violet-500/30 hover:bg-violet-600/10'}`}>
                    <div className="flex items-start gap-1.5">
                      <span className="text-base leading-none mt-0.5">{profile.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs font-bold truncate ${activeProfileId === profile.id ? 'text-violet-200' : 'text-white/80'}`}>{profile.name}</div>
                        <div className="text-[10px] text-white/35 leading-tight mt-0.5 line-clamp-2">{profile.description}</div>
                      </div>
                    </div>
                    <div className="absolute top-1 right-1 hidden group-hover:flex gap-0.5">
                      <button type="button" onClick={e => { e.stopPropagation(); setEditingProfile(profile); setIsCreatingProfile(false); }}
                        className="w-5 h-5 flex items-center justify-center text-white/40 hover:text-blue-300 bg-black/60 rounded text-[10px] transition-colors">✎</button>
                      <button type="button" onClick={e => { e.stopPropagation(); deleteProfile(profile.id); }}
                        className="w-5 h-5 flex items-center justify-center text-white/40 hover:text-red-400 bg-black/60 rounded text-[10px] transition-colors">✕</button>
                    </div>
                    {activeProfileId === profile.id && (
                      <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-violet-400" />
                    )}
                  </div>
                ))}
              </div>
              <button type="button"
                onClick={() => { setEditingProfile({ id: `custom_${Date.now()}`, name: '', emoji: '✨', description: '', prompt: '' }); setIsCreatingProfile(true); }}
                className="w-full py-1.5 text-xs text-white/40 hover:text-violet-300 border border-dashed border-white/10 hover:border-violet-500/40 rounded-xl transition-all flex items-center justify-center gap-1.5">
                + 새 프로필 만들기
              </button>
              {activeProfile && (
                <div className="bg-violet-900/10 border border-violet-500/15 rounded-xl px-3 py-2">
                  <div className="text-[10px] text-violet-400/70 font-bold mb-1">적용 중인 지침</div>
                  <div className="text-[11px] text-white/40 leading-relaxed line-clamp-3">{activeProfile.prompt}</div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
};

export default WritingProfilePanel;
