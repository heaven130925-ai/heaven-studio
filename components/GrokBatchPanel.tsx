import React, { useState, useEffect, useRef, useCallback } from 'react';

// ── 타입 ──────────────────────────────────────────────────────────────────────
type GrokMode = 'text-to-video' | 'text-to-image' | 'image-to-video';
type JobStatus = 'pending' | 'processing' | 'done' | 'error';

interface GrokJob {
  id: string;
  prompt: string;
  mode: GrokMode;
  status: JobStatus;
  error?: string;
  createdAt: number;
}

interface GrokResult {
  jobId: string;
  type: 'video' | 'image';
  data: string | null; // base64 dataURL
  src?: string;
  prompt: string;
  completedAt: number;
}

// ── 확장앱 통신 유틸 (content-heaven.js postMessage 릴레이 방식) ──────────────
function sendToExtension(type: string, payload: Record<string, any> = {}): Promise<any> {
  return new Promise((resolve) => {
    const ACK_TYPES = [
      'HEAVEN_GROK_ADD_JOBS_ACK', 'HEAVEN_GROK_RESULTS',
      'HEAVEN_GROK_STATUS', 'HEAVEN_GROK_CLEAR_ACK',
    ];
    const handler = (e: MessageEvent) => {
      if (ACK_TYPES.includes(e.data?.type)) {
        window.removeEventListener('message', handler);
        resolve(e.data);
      }
    };
    window.addEventListener('message', handler);
    window.postMessage({ type, ...payload }, '*');
    setTimeout(() => { window.removeEventListener('message', handler); resolve(null); }, 5000);
  });
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
const GrokBatchPanel: React.FC = () => {
  const [extensionReady, setExtensionReady] = useState(false);
  const [mode, setMode] = useState<GrokMode>('text-to-video');
  const [promptsText, setPromptsText] = useState('');
  const [jobs, setJobs] = useState<GrokJob[]>([]);
  const [results, setResults] = useState<GrokResult[]>([]);
  const [status, setStatus] = useState('대기 중');
  const [isRunning, setIsRunning] = useState(false);
  const [refImages, setRefImages] = useState<string[]>([]);
  const refInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── 확장앱 감지 (DOM 폴링 + postMessage 병행) ─────────────────────────────
  useEffect(() => {
    const markReady = () => setExtensionReady(true);

    // 방법 1: DOM 마커 폴링 (popup이 content-heaven.js 주입 시 삽입)
    // 방법 2: window 변수 폴링
    const checkAll = () => {
      if (document.getElementById('__heaven_grok_ext__') || (window as any).__heavenGrokReady) {
        markReady();
        clearInterval(poll);
      }
    };
    const poll = setInterval(checkAll, 300);
    checkAll();

    // 방법 3: CustomEvent
    window.addEventListener('HEAVEN_GROK_READY', markReady);

    // 방법 4: postMessage
    const msgHandler = (e: MessageEvent) => {
      if (e.data?.type === 'HEAVEN_GROK_EXTENSION_READY') markReady();
    };
    window.addEventListener('message', msgHandler);

    window.postMessage({ type: 'HEAVEN_GROK_PING' }, '*');

    return () => {
      clearInterval(poll);
      window.removeEventListener('HEAVEN_GROK_READY', markReady);
      window.removeEventListener('message', msgHandler);
    };
  }, []);

  // ── 폴링: 상태 & 결과 ─────────────────────────────────────────────────────
  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      // 상태
      const statusResp = await sendToExtension('HEAVEN_GROK_GET_STATUS');
      if (statusResp?.status) setStatus(statusResp.status);

      // 결과
      const resultResp = await sendToExtension('HEAVEN_GROK_GET_RESULTS');
      if (resultResp?.results?.length > 0) {
        setResults(prev => [...prev, ...resultResp.results]);
      }

      // 큐 상태 (chrome.storage에서 직접 읽기)
      window.postMessage({ type: 'HEAVEN_GROK_GET_QUEUE' }, '*');
    }, 3000);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // 큐 업데이트 수신
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'HEAVEN_GROK_QUEUE_UPDATE') {
        setJobs(e.data.queue || []);
        const allDone = (e.data.queue || []).every((j: GrokJob) => j.status === 'done' || j.status === 'error');
        if (allDone && (e.data.queue || []).length > 0) {
          setIsRunning(false);
          stopPolling();
          setStatus('완료');
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [stopPolling]);

  // ── 참조 이미지 ────────────────────────────────────────────────────────────
  const handleRefUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Promise.all(Array.from(files).slice(0, 5).map(f => new Promise<string>((res, rej) => {
      const reader = new FileReader();
      reader.onload = ev => res(ev.target?.result as string);
      reader.onerror = rej;
      reader.readAsDataURL(f);
    }))).then(imgs => setRefImages(imgs));
  };

  // ── 실행 ──────────────────────────────────────────────────────────────────
  const handleRun = async () => {
    if (!extensionReady) { alert('Heaven Grok 확장앱이 설치되어 있지 않습니다.\n크롬 확장앱을 먼저 설치해주세요.'); return; }
    const lines = promptsText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) { alert('프롬프트를 입력해주세요. (한 줄에 1개)'); return; }

    const jobs = lines.map((prompt, i) => ({
      prompt,
      mode,
      referenceImages: mode === 'image-to-video' ? refImages : [],
    }));

    setIsRunning(true);
    setResults([]);
    setStatus('작업 전송 중...');
    startPolling();

    await sendToExtension('HEAVEN_GROK_ADD_JOBS', { jobs });
    setStatus(`${lines.length}개 작업 시작됨 — Grok에서 자동 생성 중...`);
  };

  const handleClear = async () => {
    await sendToExtension('HEAVEN_GROK_CLEAR');
    setJobs([]);
    setResults([]);
    setStatus('초기화됨');
    setIsRunning(false);
    stopPolling();
  };

  const handleOpenGrok = () => {
    sendToExtension('HEAVEN_GROK_OPEN_TAB');
  };

  // ── 다운로드 ──────────────────────────────────────────────────────────────
  const downloadResult = (r: GrokResult, idx: number) => {
    if (!r.data) return;
    const a = document.createElement('a');
    a.href = r.data;
    a.download = `grok_${r.type}_${String(idx + 1).padStart(3, '0')}.${r.type === 'video' ? 'mp4' : 'png'}`;
    a.click();
  };

  const downloadAll = () => {
    results.filter(r => r.data).forEach((r, i) => downloadResult(r, i));
  };

  const pendingCount = jobs.filter(j => j.status === 'pending').length;
  const doneCount = jobs.filter(j => j.status === 'done').length + results.length;
  const errorCount = jobs.filter(j => j.status === 'error').length;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

      {/* 확장앱 상태 배너 */}
      <div className={`flex items-center justify-between px-4 py-3 rounded-xl border ${
        extensionReady
          ? 'bg-green-500/10 border-green-500/30'
          : 'bg-yellow-500/10 border-yellow-500/30'
      }`}>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${extensionReady ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'}`} />
          <span className={`text-sm font-bold ${extensionReady ? 'text-green-300' : 'text-yellow-300'}`}>
            {extensionReady ? 'Heaven Grok 확장앱 연결됨' : '확장앱 미감지 — 크롬에서 설치해주세요'}
          </span>
        </div>
        <button
          onClick={handleOpenGrok}
          className="text-xs text-slate-400 hover:text-white border border-slate-600 hover:border-slate-400 px-3 py-1 rounded-lg transition-all"
        >
          Grok 탭 열기
        </button>
      </div>

      {/* 모드 선택 */}
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-4">
        <span className="text-sm font-bold text-white">생성 모드</span>
        <div className="grid grid-cols-3 gap-2">
          {([
            { id: 'text-to-video', label: '텍스트 → 영상', icon: '🎬' },
            { id: 'text-to-image', label: '텍스트 → 이미지', icon: '🖼️' },
            { id: 'image-to-video', label: '이미지 → 영상', icon: '✨' },
          ] as const).map(m => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`py-3 px-3 rounded-xl border text-sm font-bold transition-all flex flex-col items-center gap-1 ${
                mode === m.id
                  ? 'border-violet-500/60 bg-violet-500/15 text-violet-300'
                  : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600'
              }`}
            >
              <span className="text-xl">{m.icon}</span>
              <span className="text-xs">{m.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 이미지 업로드 (image-to-video 모드) */}
      {mode === 'image-to-video' && (
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-3">
          <span className="text-sm font-bold text-white">참조 이미지 업로드</span>
          <input ref={refInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleRefUpload} />
          <div
            onClick={() => refInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 h-24 border-2 border-dashed border-slate-700 hover:border-violet-500/50 rounded-xl cursor-pointer bg-slate-800/40 transition-colors"
          >
            {refImages.length > 0 ? (
              <div className="flex gap-2">
                {refImages.map((img, i) => (
                  <img key={i} src={img} alt="" className="h-16 w-12 object-cover rounded-lg border border-slate-600" />
                ))}
              </div>
            ) : (
              <><span className="text-2xl">📁</span><span className="text-xs text-slate-500">이미지 업로드 (최대 5장)</span></>
            )}
          </div>
          {refImages.length > 0 && (
            <button onClick={() => setRefImages([])} className="text-xs text-slate-500 hover:text-red-400 transition-colors">제거</button>
          )}
        </div>
      )}

      {/* 프롬프트 입력 */}
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-white">프롬프트 입력</span>
          <span className="text-xs text-slate-500">한 줄에 1개 — {promptsText.split('\n').filter(l => l.trim()).length}개</span>
        </div>
        <textarea
          value={promptsText}
          onChange={e => setPromptsText(e.target.value)}
          placeholder={
            mode === 'text-to-video'
              ? 'A futuristic city at night with neon lights\nA peaceful forest with morning fog\nAn ocean wave crashing on rocks'
              : mode === 'text-to-image'
              ? 'A cat sitting on a rooftop at sunset\nA dragon flying over mountains'
              : 'Animate the character walking forward\nMake the scene zoom out slowly'
          }
          rows={8}
          disabled={isRunning}
          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm focus:border-violet-500/50 focus:outline-none resize-y placeholder-slate-600 font-mono"
        />

        {/* 실행 버튼 */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleRun}
            disabled={isRunning || !promptsText.trim()}
            className="px-6 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black rounded-xl text-sm transition-colors flex items-center gap-2"
          >
            {isRunning ? (
              <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />실행 중...</>
            ) : (
              <>⚡ Grok으로 생성 시작</>
            )}
          </button>
          {(jobs.length > 0 || results.length > 0) && (
            <button
              onClick={handleClear}
              disabled={isRunning}
              className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white font-bold rounded-xl text-sm transition-colors"
            >초기화</button>
          )}
        </div>
      </div>

      {/* 진행 상황 */}
      {(isRunning || jobs.length > 0) && (
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-white">진행 상황</span>
            <span className="text-xs text-slate-400">{status}</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: '대기', value: pendingCount, color: 'text-yellow-400' },
              { label: '완료', value: doneCount, color: 'text-green-400' },
              { label: '오류', value: errorCount, color: 'text-red-400' },
            ].map(s => (
              <div key={s.label} className="bg-slate-800 rounded-xl p-3 text-center">
                <span className={`block text-2xl font-black ${s.color}`}>{s.value}</span>
                <span className="text-xs text-slate-500">{s.label}</span>
              </div>
            ))}
          </div>
          {/* 진행 바 */}
          {jobs.length > 0 && (
            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-violet-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.round((doneCount / jobs.length) * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* 결과 */}
      {results.length > 0 && (
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-white">완료된 결과 ({results.length}개)</span>
            <button
              onClick={downloadAll}
              className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
              </svg>
              전체 다운로드
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {results.map((r, i) => (
              <div key={i} className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
                {r.type === 'video' && r.data ? (
                  <video src={r.data} controls className="w-full aspect-video object-cover" />
                ) : r.type === 'image' && r.data ? (
                  <img src={r.data} alt={`result_${i}`} className="w-full aspect-square object-cover" />
                ) : (
                  <div className="w-full aspect-video flex items-center justify-center text-slate-600 text-xs">
                    {r.data ? '미리보기 불가' : '생성 실패'}
                  </div>
                )}
                <div className="p-2 space-y-1.5">
                  <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">{r.prompt}</p>
                  {r.data && (
                    <button
                      onClick={() => downloadResult(r, i)}
                      className="w-full py-1.5 bg-violet-600/20 hover:bg-violet-600/40 border border-violet-500/30 text-violet-300 text-xs font-bold rounded-lg transition-colors"
                    >
                      다운로드
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default GrokBatchPanel;
