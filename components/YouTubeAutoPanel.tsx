import React, { useState, useEffect } from 'react';
import {
  ChannelProfile, ChannelUploadSettings,
  getChannelProfiles, removeChannelProfile, updateChannelSettings,
  startYoutubeOAuth, getYoutubeClientId, isProfileValid,
  DEFAULT_CHANNEL_SETTINGS,
} from '../services/youtubeService';

const YT_CATEGORIES = [
  { id: '1',  label: '영화/애니메이션' },
  { id: '2',  label: '자동차' },
  { id: '10', label: '음악' },
  { id: '15', label: '반려동물' },
  { id: '17', label: '스포츠' },
  { id: '19', label: '여행' },
  { id: '20', label: '게임' },
  { id: '22', label: '인물/블로그' },
  { id: '23', label: '코미디' },
  { id: '24', label: '엔터테인먼트' },
  { id: '25', label: '뉴스/정치' },
  { id: '26', label: '노하우/스타일' },
  { id: '27', label: '교육' },
  { id: '28', label: '과학/기술' },
];

interface Props {
  onClose: () => void;
}

const YouTubeAutoPanel: React.FC<Props> = ({ onClose }) => {
  const [profiles, setProfiles] = useState<ChannelProfile[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const reload = () => setProfiles(getChannelProfiles());

  useEffect(() => { reload(); }, []);

  const handleAdd = async () => {
    const clientId = getYoutubeClientId();
    if (!clientId) {
      alert('먼저 API 키 설정에서 YouTube OAuth Client ID를 입력해주세요.');
      return;
    }
    // 현재 탭을 Google 인증 페이지로 리다이렉트
    // 인증 완료 후 앱 루트(/)로 돌아오면 App.tsx의 useEffect가 코드를 처리합니다
    await startYoutubeOAuth(clientId);
  };

  const handleRemove = (id: string) => {
    if (!confirm('이 채널 연결을 해제하시겠습니까?')) return;
    removeChannelProfile(id);
    reload();
    if (editingId === id) setEditingId(null);
  };

  const editing = profiles.find(p => p.id === editingId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>

        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
            </svg>
            <h2 className="text-base font-black text-white">YouTube 자동화 설정</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl transition-colors">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-5">

            {/* 채널 목록 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">연결된 채널</span>
                <button
                  onClick={handleAdd}
                  disabled={connecting}
                  className="px-3 py-1.5 text-xs font-bold bg-red-600/20 border border-red-500/40 text-red-400 hover:bg-red-600/30 rounded-lg transition-all disabled:opacity-40 flex items-center gap-1.5"
                >
                  {connecting ? (
                    <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>연결 중...</>
                  ) : (
                    <>+ 채널 추가</>
                  )}
                </button>
              </div>

              {profiles.length === 0 ? (
                <div className="py-6 text-center text-sm text-slate-600 border border-dashed border-slate-800 rounded-xl">
                  연결된 채널이 없습니다<br />
                  <span className="text-xs text-slate-700">+ 채널 추가로 YouTube 계정을 연결하세요</span>
                </div>
              ) : (
                <div className="space-y-2">
                  {profiles.map(p => (
                    <div
                      key={p.id}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${
                        editingId === p.id
                          ? 'border-red-500/50 bg-red-500/8'
                          : 'border-slate-700/60 bg-slate-800/40 hover:border-slate-600'
                      }`}
                      onClick={() => setEditingId(editingId === p.id ? null : p.id)}
                    >
                      {p.thumbnail
                        ? <img src={p.thumbnail} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                        : <div className="w-8 h-8 rounded-full bg-red-600/30 flex items-center justify-center flex-shrink-0 text-red-400 text-xs font-black">{p.name[0]}</div>
                      }
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-white truncate">{p.name}</div>
                        <div className="text-xs text-slate-500 truncate">{p.settings.scheduleTime} 예약 · {p.settings.defaultPrivacy === 'scheduled' ? '예약 업로드' : p.settings.defaultPrivacy === 'public' ? '즉시 공개' : '비공개'}</div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`w-2 h-2 rounded-full ${isProfileValid(p) ? 'bg-green-400' : 'bg-yellow-500'}`} title={isProfileValid(p) ? '연결됨' : '토큰 만료 (재연결 필요)'} />
                        <button
                          onClick={e => { e.stopPropagation(); handleRemove(p.id); }}
                          className="text-slate-600 hover:text-red-400 transition-colors text-sm px-1"
                        >✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 채널 설정 편집 */}
            {editing && (
              <ChannelSettingsEditor
                profile={editing}
                onChange={(settings) => {
                  updateChannelSettings(editing.id, settings);
                  reload();
                }}
              />
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-800">
          <button onClick={onClose} className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition-colors text-sm">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};

// ── 채널별 설정 편집기 ──────────────────────────────────────────────────────
interface SettingsEditorProps {
  profile: ChannelProfile;
  onChange: (s: Partial<ChannelUploadSettings>) => void;
}

const ChannelSettingsEditor: React.FC<SettingsEditorProps> = ({ profile, onChange }) => {
  const s = profile.settings;

  return (
    <div className="border border-slate-700/60 rounded-xl p-4 space-y-4 bg-slate-800/30">
      <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/></svg>
        {profile.name} 설정
      </div>

      {/* 해시태그 */}
      <div className="space-y-1.5">
        <label className="text-xs text-slate-400 font-semibold">제목 해시태그 <span className="text-slate-600 font-normal">(#포함, 스페이스 구분, 최대 3개)</span></label>
        <input
          defaultValue={s.hashtags}
          onBlur={e => onChange({ hashtags: e.target.value.trim() })}
          placeholder="#경제 #재테크 #돈"
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:border-red-500/50 focus:outline-none"
        />
        <p className="text-[11px] text-slate-600">제목 뒤에 자동으로 붙습니다: "경제 공부법 #경제 #재테크"</p>
      </div>

      {/* 설명 템플릿 */}
      <div className="space-y-1.5">
        <label className="text-xs text-slate-400 font-semibold">설명 템플릿 <span className="text-slate-600 font-normal">{'{title}'} = 주제 자동 치환</span></label>
        <textarea
          defaultValue={s.descriptionTemplate}
          onBlur={e => onChange({ descriptionTemplate: e.target.value })}
          rows={3}
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:border-red-500/50 focus:outline-none resize-none"
        />
      </div>

      {/* 카테고리 */}
      <div className="space-y-1.5">
        <label className="text-xs text-slate-400 font-semibold">카테고리</label>
        <select
          value={s.category}
          onChange={e => onChange({ category: e.target.value })}
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:border-red-500/50 focus:outline-none"
        >
          {YT_CATEGORIES.map(c => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </div>

      {/* 공개 설정 */}
      <div className="space-y-1.5">
        <label className="text-xs text-slate-400 font-semibold">기본 공개 설정</label>
        <div className="grid grid-cols-3 gap-2">
          {(['public', 'unlisted', 'scheduled'] as const).map(p => (
            <button
              key={p}
              onClick={() => onChange({ defaultPrivacy: p })}
              className={`py-2 text-xs font-bold rounded-lg border transition-all ${
                s.defaultPrivacy === p
                  ? 'border-red-500/60 bg-red-500/10 text-red-400'
                  : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600'
              }`}
            >
              {p === 'public' ? '즉시 공개' : p === 'unlisted' ? '미등록' : '예약 업로드'}
            </button>
          ))}
        </div>
      </div>

      {/* 예약 시간 */}
      {s.defaultPrivacy === 'scheduled' && (
        <div className="space-y-1.5">
          <label className="text-xs text-slate-400 font-semibold">예약 시간 <span className="text-slate-600 font-normal">(매일 이 시간에 공개)</span></label>
          <input
            type="time"
            value={s.scheduleTime}
            onChange={e => onChange({ scheduleTime: e.target.value })}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:border-red-500/50 focus:outline-none"
          />
          <p className="text-[11px] text-slate-600">비공개로 업로드 후 이 시간에 자동 공개됩니다.</p>
        </div>
      )}
    </div>
  );
};

export default YouTubeAutoPanel;
