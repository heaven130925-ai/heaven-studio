
import React, { useState } from 'react';
import { SavedProject } from '../types';
import { formatKRW } from '../config';

interface ProjectGalleryProps {
  projects: SavedProject[];
  onBack: () => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
  onLoad: (project: SavedProject) => void;
}

const ProjectGallery: React.FC<ProjectGalleryProps> = ({
  projects,
  onBack,
  onDelete,
  onRefresh,
  onLoad
}) => {
  const [selectedProject, setSelectedProject] = useState<SavedProject | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleDelete = (id: string) => {
    onDelete(id);
    setConfirmDelete(null);
    if (selectedProject?.id === id) {
      setSelectedProject(null);
    }
    onRefresh();
  };

  // 프로젝트 상세 보기
  if (selectedProject) {
    const assets = selectedProject.assets || [];

    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => setSelectedProject(null)}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            목록으로
          </button>

          <h2 className="text-xl font-bold text-white">{selectedProject.name}</h2>

          <button
            onClick={() => onLoad(selectedProject)}
            className="flex items-center gap-2 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-lg transition-colors font-bold"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            불러오기
          </button>
        </div>

        {/* 설정 정보 */}
        <div className="bg-slate-900 rounded-xl p-4 mb-6 border border-slate-800">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="text-slate-400">{formatDate(selectedProject.createdAt)}</span>
            <span className="px-3 py-1 bg-slate-800 rounded-full text-slate-300">
              {selectedProject.settings.imageModel?.includes('flux') ? 'Flux' : 'Gemini'}
            </span>
            {selectedProject.settings.imageModel?.includes('flux') && (
              <span className="px-3 py-1 bg-slate-800 rounded-full text-slate-300">
                {selectedProject.settings.fluxStyle}
              </span>
            )}
            <span className="px-3 py-1 bg-slate-800 rounded-full text-slate-300">
              {selectedProject.settings.elevenLabsModel}
            </span>
            <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-full">
              {assets.filter(a => a.imageData).length}/{assets.length} 이미지
            </span>
            <span className="px-3 py-1 bg-blue-500/20 text-blue-400 rounded-full">
              {assets.filter(a => a.audioData).length}/{assets.length} 오디오
            </span>
          </div>

          {/* 비용 상세 (있는 경우만) */}
          {selectedProject.cost && (
            <div className="mt-3 pt-3 border-t border-slate-800">
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <span className="text-slate-500">비용:</span>
                <span className="text-slate-300">
                  이미지 {selectedProject.cost.imageCount}장 {formatKRW(selectedProject.cost.images)}
                </span>
                <span className="text-slate-300">
                  TTS {selectedProject.cost.ttsCharacters}자 {formatKRW(selectedProject.cost.tts)}
                </span>
                {selectedProject.cost.videoCount > 0 && (
                  <span className="text-slate-300">
                    영상 {selectedProject.cost.videoCount}개 {formatKRW(selectedProject.cost.videos)}
                  </span>
                )}
                <span className="px-2 py-0.5 bg-green-500/20 text-green-400 font-bold rounded">
                  총 {formatKRW(selectedProject.cost.total)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* 씬 목록 */}
        <div className="grid gap-6">
          {assets.map((asset, index) => (
            <div
              key={index}
              className="bg-slate-900 rounded-xl overflow-hidden border border-slate-800"
            >
              <div className="flex flex-col md:flex-row">
                {/* 이미지 */}
                <div className="md:w-1/3 flex-shrink-0">
                  {asset.imageData ? (
                    <img
                      src={`data:image/jpeg;base64,${asset.imageData}`}
                      alt={`Scene ${asset.sceneNumber}`}
                      className="w-full aspect-video object-cover"
                    />
                  ) : (
                    <div className="w-full aspect-video bg-slate-800 flex items-center justify-center">
                      <span className="text-slate-500">이미지 없음</span>
                    </div>
                  )}
                </div>

                {/* 내용 */}
                <div className="p-4 flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="px-2 py-1 bg-brand-500/20 text-brand-400 text-xs font-bold rounded">
                      씬 {asset.sceneNumber}
                    </span>
                    {asset.audioData && (
                      <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded">
                        오디오 있음
                      </span>
                    )}
                    {asset.subtitleData && (
                      <span className="px-2 py-1 bg-purple-500/20 text-purple-400 text-xs rounded">
                        자막 있음
                      </span>
                    )}
                  </div>

                  <div className="mb-3">
                    <h4 className="text-xs font-bold text-slate-400 mb-1">나레이션</h4>
                    <p className="text-slate-200 text-sm leading-relaxed">
                      {asset.narration}
                    </p>
                  </div>

                  <div>
                    <h4 className="text-xs font-bold text-slate-400 mb-1">비주얼 프롬프트</h4>
                    <p className="text-slate-400 text-xs leading-relaxed line-clamp-3">
                      {asset.visualPrompt}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 프로젝트 목록
  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-8">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          돌아가기
        </button>

        <h2 className="text-xl font-bold text-white">저장된 프로젝트</h2>

        <span className="text-sm text-slate-400">
          {projects.length}개 프로젝트
        </span>
      </div>

      {/* 프로젝트 목록 */}
      {projects.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">📁</div>
          <h3 className="text-lg font-bold text-slate-300 mb-2">저장된 프로젝트가 없습니다</h3>
          <p className="text-slate-500 text-sm">
            스토리보드를 생성하면 자동으로 저장됩니다
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map(project => (
            <div
              key={project.id}
              className="bg-slate-900 rounded-xl overflow-hidden border border-slate-800 hover:border-slate-700 transition-all group"
            >
              {/* 썸네일 */}
              <div
                className="h-40 bg-slate-800 cursor-pointer relative overflow-hidden"
                onClick={() => setSelectedProject(project)}
              >
                {project.thumbnail ? (
                  <img
                    src={`data:image/jpeg;base64,${project.thumbnail}`}
                    alt={project.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-slate-600 text-4xl">🖼️</span>
                  </div>
                )}

                {/* 오버레이 */}
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-4">
                  <span className="text-white text-sm font-medium">자세히 보기</span>
                </div>
              </div>

              {/* 정보 */}
              <div className="p-4">
                <h3
                  className="font-bold text-white mb-2 truncate cursor-pointer hover:text-brand-400 transition-colors"
                  onClick={() => setSelectedProject(project)}
                  title={project.name}
                >
                  {project.name}
                </h3>

                {/* 날짜 */}
                <div className="text-xs text-slate-500 mb-2">
                  {formatDate(project.createdAt)}
                </div>

                {/* 모델 정보 */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {/* 이미지 모델 */}
                  {project.settings.imageModel?.includes('flux') ? (
                    <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-[10px] font-bold rounded">
                      Flux
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-[10px] font-bold rounded">
                      Gemini
                    </span>
                  )}

                  {/* Flux 화풍 (Flux일 때만) */}
                  {project.settings.imageModel?.includes('flux') && project.settings.fluxStyle && (
                    <span className="px-2 py-0.5 bg-slate-700 text-slate-300 text-[10px] rounded">
                      {project.settings.fluxStyle === 'custom' ? '커스텀' : project.settings.fluxStyle}
                    </span>
                  )}

                  {/* 씬 수 */}
                  <span className="px-2 py-0.5 bg-slate-800 text-slate-400 text-[10px] rounded">
                    {(project.assets?.length || 0)}씬
                  </span>

                  {/* 비용 (있는 경우만) */}
                  {project.cost && (
                    <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-[10px] font-bold rounded">
                      {formatKRW(project.cost.total)}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onLoad(project);
                    }}
                    className="flex-1 px-3 py-2 bg-brand-500/20 hover:bg-brand-500/30 text-brand-400 text-xs font-bold rounded transition-colors"
                  >
                    불러오기
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(project.id);
                    }}
                    className={`p-2 rounded transition-colors ${
                      confirmDelete === project.id
                        ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                        : 'bg-slate-800 text-slate-400 hover:bg-red-500/20 hover:text-red-400'
                    }`}
                    title={confirmDelete === project.id ? '다시 클릭하여 삭제' : '삭제'}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProjectGallery;
