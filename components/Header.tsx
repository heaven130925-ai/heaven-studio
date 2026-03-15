
import React from 'react';

const Header: React.FC = () => {
  return (
    <header className="border-b border-white/[0.07] bg-black/80 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-lg flex items-center justify-center shadow-[0_0_16px_rgba(6,182,212,0.4)]">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <span className="text-xl font-black text-white tracking-tight">
            Heaven <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-400">AI</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-[10px] font-bold text-white/60 uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_4px_rgba(6,182,212,0.8)]"></span>
            Gemini 3 Pro
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
