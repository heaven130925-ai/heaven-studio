import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GeneratedAsset, ZoomEffect } from '../types';
import { processChatCommand } from '../services/geminiService';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

interface StudioChatProps {
  scenes: GeneratedAsset[];
  onSetSceneZoom: (indices: number[], zoom: ZoomEffect) => void;
  onSetSubtitleChars: (maxChars: number) => void;
  onGenerateVideoRange: (indices: number[]) => void;
}

const StudioChat: React.FC<StudioChatProps> = ({
  scenes,
  onSetSceneZoom,
  onSetSubtitleChars,
  onGenerateVideoRange,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', text: `안녕하세요! 영상 편집을 도와드릴게요.\n\n예시 명령어:\n• "전체 씬에 줌인 추가해줘"\n• "1~5씬 줌아웃, 강도 40"\n• "자막 10자로 줄여줘"\n• "1~3씬 영상 만들어줘"` }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const cmd = input.trim();
    if (!cmd || isLoading) return;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: cmd }]);
    setIsLoading(true);

    try {
      const result = await processChatCommand(cmd, scenes.length);

      // 조작 실행
      for (const op of result.operations) {
        if (!op.sceneRange) continue;
        const [start, end] = op.sceneRange;
        const indices: number[] = [];
        for (let i = start; i <= Math.min(end, scenes.length - 1); i++) indices.push(i);

        if (op.type === 'SET_ZOOM' && op.zoom) {
          const zoom: ZoomEffect = {
            type: op.zoom.type as ZoomEffect['type'],
            origin: (op.zoom.origin || 'center') as ZoomEffect['origin'],
            intensity: op.zoom.intensity ?? 30,
          };
          onSetSceneZoom(indices, zoom);
        } else if (op.type === 'SET_SUBTITLE_CHARS' && op.maxChars) {
          onSetSubtitleChars(op.maxChars);
        } else if (op.type === 'GENERATE_VIDEO') {
          onGenerateVideoRange(indices);
        }
      }

      setMessages(prev => [...prev, { role: 'assistant', text: result.reply }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', text: '오류가 발생했습니다. 다시 시도해주세요.' }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, scenes.length, onSetSceneZoom, onSetSubtitleChars, onGenerateVideoRange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* 메시지 목록 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed ${
              msg.role === 'user'
                ? 'bg-blue-600/30 border border-blue-500/40 text-blue-100'
                : 'bg-slate-800/80 border border-white/[0.07] text-slate-200'
            }`}>
              {msg.role === 'assistant' && (
                <span className="text-xs text-purple-400 font-bold block mb-1">AI 편집</span>
              )}
              {msg.text}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-slate-800/80 border border-white/[0.07] rounded-2xl px-4 py-3 text-sm text-slate-400">
              <span className="text-xs text-purple-400 font-bold block mb-1">AI 편집</span>
              명령 처리 중...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 입력창 */}
      <div className="shrink-0 border-t border-white/[0.07] p-3 flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="편집 명령을 입력하세요... (Enter 전송, Shift+Enter 줄바꿈)"
          rows={2}
          disabled={isLoading}
          className="flex-1 bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-blue-500/50 resize-none disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
          className="shrink-0 w-10 h-10 rounded-xl bg-blue-600/40 hover:bg-blue-600/60 disabled:opacity-30 border border-blue-500/40 flex items-center justify-center transition-all"
        >
          <svg className="w-4 h-4 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
          </svg>
        </button>
      </div>
    </div>
  );
};

export default StudioChat;
