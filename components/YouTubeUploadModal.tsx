import React, { useState, useEffect } from 'react';
import {
  getChannelProfiles, ChannelProfile, isProfileValid,
  buildPublishAt, uploadToYoutube, YOUTUBE_CATEGORIES,
} from '../services/youtubeService';
import { generateYouTubeMeta } from '../services/geminiService';

interface Props {
  videoBlob: Blob;
  defaultTitle: string;
  topic?: string;
  narrations?: string[];
  aspectRatio?: string; // '9:16' = 숏폼, '16:9' = 롱폼
  onClose: () => void;
  onDone: (url: string, scheduled?: string) => void;
}

const YouTubeUploadModal: React.FC<Props> = ({
  videoBlob, defaultTitle, topic, narrations, aspectRatio, onClose, onDone
}) => {
  const [profiles, setProfiles] = useState<ChannelProfile[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [category, setCategory] = useState('22');
  const [privacy, setPrivacy] = useState<'public' | 'unlisted' | 'scheduled'>('public');
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [scheduleDate, setScheduleDate] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [generatingMeta, setGeneratingMeta] = useState(false);

  const isShortform = aspectRatio === '9:16';

  useEffect(() => {
    const ps = getChannelProfiles().filter(isProfileValid);
    setProfiles(ps);
    if (ps.length > 0) {
      const first = ps[0];
      setSelectedId(first.id);
      setCategory(first.settings.category || '22');
      setPrivacy(first.settings.defaultPrivacy === 'scheduled' ? 'scheduled' : first.settings.defaultPrivacy as any);
      setScheduleTime(first.settings.scheduleTime);
    }
    const today = new Date();
    setScheduleDate(today.toISOString().split('T')[0]);

    // AI 메타데이터 자동 생성
    if (topic && narrations && narrations.length > 0) {
      handleGenerateMeta(false);
    } else {
      setTitle(defaultTitle.slice(0, 100));
      setDescription(`${defaultTitle}\n\n${isShortform ? '#Shorts' : ''}`);
      setTags(defaultTitle.split(/[\s,]+/).filter(t => t.length > 1).slice(0, 10).join(', '));
    }
  }, []);

  const handleSelectProfile = (id: string) => {
    setSelectedId(id);
    const p = profiles.find(p => p.id === id);
    if (p) {
      setCategory(p.settings.category || '22');
      setPrivacy(p.settings.defaultPrivacy === 'scheduled' ? 'scheduled' : p.settings.defaultPrivacy as any);
      setScheduleTime(p.settings.scheduleTime);
    }
  };

  const handleGenerateMeta = async (showLoading = true) => {
    if (!topic) return;
    if (showLoading) setGeneratingMeta(true);
    else setGeneratingMeta(true);
    try {
      const nars = narrations && narrations.length > 0 ? narrations : [defaultTitle];
      const meta = await generateYouTubeMeta(topic, nars, isShortform);
      setTitle(meta.title);
      setDescription(meta.description);
      setTags(meta.tags.join(', '));
      setCategory(meta.suggestedCategory);
    } catch (e: any) {
      console.warn('[YouTubeMeta] AI 생성 실패, 기본값 사용:', e.message);
      setTitle(defaultTitle.slice(0, 100));
      setDescription(`${defaultTitle}\n\n${isShortform ? '#Shorts' : ''}`);
      setTags(defaultTitle.split(/[\s,]+/).filter(t => t.length > 1).slice(0, 10).join(', '));
    } finally {
      setGeneratingMeta(false);
    }
  };

  const handleUpload = async () => {
    const profile = profiles.find(p => p.id === selectedId);
    setUploading(true);
    setProgress(0);

    try {
      const tagList = tags.split(/[,\s]+/).map(t => t.trim()).filter(Boolean);

      let publishAt: string | undefined;
      if (privacy === 'scheduled') {
        const dt = new Date(`${scheduleDate}T${scheduleTime}:00`);
        if (dt <= new Date()) {
          alert('예약 시간이 현재 시각보다 과거입니다. 날짜/시간을 확인해주세요.');
          setUploading(false);
          return;
        }
        publishAt = dt.toISOString();
      }

      const result = await uploadToYoutube({
        videoBlob,
        title,
        description,
        tags: tagList,
        categoryId: category,
        privacyStatus: privacy === 'scheduled' ? 'private' : privacy,
        publishAt,
        channelId: selectedId || undefined,
        onProgress: setProgress,
      });

      onDone(result.url, result.scheduledAt);
    } catch (e: any) {
      alert(`업로드 실패: ${e?.message || String(e)}`);
      setUploading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={uploading ? undefined : onClose}
    >
      <div
        className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
            </svg>
            <h2 className="text-base font-black text-white">YouTube 업로드</h2>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isShortform ? 'bg-pink-500/20 text-pink-300' : 'bg-blue-500/20 text-blue-300'}`}>
              {isShortform ? '숏폼 #Shorts' : '롱폼'}
            </span>
          </div>
          {!uploading && (
            <button onClick={onClose} className="text-slate-500 hover:text-white text-xl transition-colors">✕</button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">

          {/* 채널 선택 */}
          {profiles.length > 0 ? (
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">채널 선택</label>
              <div className="space-y-1.5">
                {profiles.map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleSelectProfile(p.id)}
                    disabled={uploading}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all text-left ${
                      selectedId === p.id
                        ? 'border-red-500/60 bg-red-500/10'
                        : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                    }`}
                  >
                    {p.thumbnail
                      ? <img src={p.thumbnail} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                      : <div className="w-8 h-8 rounded-full bg-red-600/30 flex items-center justify-center text-red-400 text-xs font-black flex-shrink-0">{p.name[0]}</div>
                    }
                    <span className="text-sm font-semibold text-white">{p.name}</span>
                    {selectedId === p.id && <span className="ml-auto text-red-400 text-xs font-bold">선택됨</span>}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-3 px-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl text-sm text-yellow-400">
              연결된 채널이 없습니다. YouTube 자동화 설정에서 채널을 추가해주세요.
            </div>
          )}

          {/* AI 생성 섹션 헤더 */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">AI 생성 메타데이터</span>
            <button
              type="button"
              onClick={() => handleGenerateMeta(true)}
              disabled={uploading || generatingMeta || !topic}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/15 border border-violet-500/30 text-violet-300 text-xs font-bold hover:bg-violet-500/25 transition-all disabled:opacity-40"
            >
              {generatingMeta ? (
                <><span className="w-3 h-3 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />생성 중...</>
              ) : (
                <>✨ 다시 생성</>
              )}
            </button>
          </div>

          {generatingMeta && (
            <div className="py-3 px-4 bg-violet-500/10 border border-violet-500/20 rounded-xl text-sm text-violet-300 text-center animate-pulse">
              AI가 제목·설명·태그를 생성하고 있습니다...
            </div>
          )}

          {/* 제목 */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              제목 <span className="text-slate-600 normal-case font-normal">({title.length}/100)</span>
            </label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value.slice(0, 100))}
              disabled={uploading || generatingMeta}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm focus:border-red-500/50 focus:outline-none"
            />
          </div>

          {/* 설명 */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">설명</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              disabled={uploading || generatingMeta}
              rows={4}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm focus:border-red-500/50 focus:outline-none resize-none"
            />
          </div>

          {/* 태그 */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              태그 <span className="text-slate-600 normal-case font-normal">(쉼표 구분)</span>
            </label>
            <input
              value={tags}
              onChange={e => setTags(e.target.value)}
              disabled={uploading || generatingMeta}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm focus:border-red-500/50 focus:outline-none"
            />
          </div>

          {/* 카테고리 (수동) */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">카테고리</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              disabled={uploading}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm focus:border-red-500/50 focus:outline-none"
            >
              {YOUTUBE_CATEGORIES.map(c => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-slate-600">AI가 추천한 카테고리로 자동 설정됩니다. 변경 가능합니다.</p>
          </div>

          {/* 공개 설정 */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">공개 설정</label>
            <div className="grid grid-cols-3 gap-2">
              {(['public', 'unlisted', 'scheduled'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setPrivacy(p)}
                  disabled={uploading}
                  className={`py-2 text-xs font-bold rounded-lg border transition-all ${
                    privacy === p
                      ? 'border-red-500/60 bg-red-500/10 text-red-400'
                      : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  {p === 'public' ? '즉시 공개' : p === 'unlisted' ? '미등록' : '예약'}
                </button>
              ))}
            </div>
          </div>

          {/* 예약 날짜/시간 */}
          {privacy === 'scheduled' && (
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">예약 날짜 / 시간</label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={scheduleDate}
                  onChange={e => setScheduleDate(e.target.value)}
                  disabled={uploading}
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm focus:border-red-500/50 focus:outline-none"
                />
                <input
                  type="time"
                  value={scheduleTime}
                  onChange={e => setScheduleTime(e.target.value)}
                  disabled={uploading}
                  className="w-32 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm focus:border-red-500/50 focus:outline-none"
                />
              </div>
              <p className="text-[11px] text-slate-600">비공개로 업로드 후 지정 시간에 자동 공개됩니다.</p>
            </div>
          )}

          {/* 업로드 진행률 */}
          {uploading && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-slate-400">
                <span>{privacy === 'scheduled' ? '예약 업로드 중...' : '업로드 중...'}</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-red-500 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* 버튼 */}
        <div className="px-6 py-4 border-t border-slate-800">
          <button
            onClick={handleUpload}
            disabled={uploading || generatingMeta || profiles.length === 0}
            className="w-full py-3 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {uploading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {progress}%
              </>
            ) : privacy === 'scheduled' ? (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                예약 업로드
              </>
            ) : (
              <>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                </svg>
                YouTube에 업로드
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default YouTubeUploadModal;
