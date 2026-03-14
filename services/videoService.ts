
import { GeneratedAsset, SubtitleData, SubtitleConfig, DEFAULT_SUBTITLE_CONFIG } from '../types';

/**
 * 고정밀 오디오 디코딩: ElevenLabs(MP3)와 Gemini(PCM) 통합 처리
 */
async function decodeAudio(base64: string, ctx: AudioContext): Promise<AudioBuffer> {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

  try {
    // MP3/WAV (ElevenLabs)
    return await ctx.decodeAudioData(bytes.buffer.slice(0));
  } catch (e) {
    // Raw PCM (Gemini)
    const dataInt16 = new Int16Array(bytes.buffer);
    const frameCount = dataInt16.length;
    const buffer = ctx.createBuffer(1, frameCount, 24000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i] / 32768.0;
    }
    return buffer;
  }
}

// 자막 청크 (단어 그룹)
interface SubtitleChunk {
  text: string;       // 표시할 텍스트
  startTime: number;  // 시작 시간
  endTime: number;    // 끝 시간
}

interface PreparedScene {
  img: HTMLImageElement;
  video: HTMLVideoElement | null;  // 애니메이션 영상 (있으면 이미지 대신 사용)
  isAnimated: boolean;             // 애니메이션 씬 여부
  audioBuffer: AudioBuffer | null;
  subtitleChunks: SubtitleChunk[];  // 미리 계산된 자막 청크들
  startTime: number;
  endTime: number;
  duration: number;
}

/**
 * 타임스탬프 없을 때 글자 수 비례로 자막 분배 (Google TTS 폴백)
 */
function createTimingEstimatedChunks(text: string, duration: number, maxChars: number = 15): SubtitleChunk[] {
  if (!text.trim() || duration <= 0) return [];

  // 구두점/공백 기준으로 짧게 자르기
  const rawChunks: string[] = [];
  let remaining = text.trim();
  const breakChars = [',', '.', '?', '!', '。', '，', ' ', '~'];

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      rawChunks.push(remaining);
      break;
    }
    let cutAt = maxChars;
    for (let i = Math.min(maxChars, remaining.length - 1); i >= Math.floor(maxChars * 0.5); i--) {
      if (breakChars.includes(remaining[i])) { cutAt = i + 1; break; }
    }
    const chunk = remaining.slice(0, cutAt).trim();
    if (chunk) rawChunks.push(chunk);
    remaining = remaining.slice(cutAt).trim();
  }

  if (rawChunks.length === 0) return [];

  // 글자 수 비례로 시간 배분
  const totalChars = rawChunks.reduce((s, c) => s + c.length, 0);
  const result: SubtitleChunk[] = [];
  let t = 0;
  for (let i = 0; i < rawChunks.length; i++) {
    const dur = (rawChunks[i].length / totalChars) * duration;
    const end = i === rawChunks.length - 1 ? duration : t + dur;
    result.push({ text: rawChunks[i], startTime: t, endTime: end });
    t = end;
  }
  return result;
}

/**
 * 자막 데이터를 청크로 변환
 * - AI 의미 단위 청크가 있으면 우선 사용 (22자 이하, 의미 단위)
 * - 없으면 기존 단어 수 기반으로 폴백
 */
function createSubtitleChunks(
  subtitleData: SubtitleData | null,
  config: SubtitleConfig
): SubtitleChunk[] {
  if (!subtitleData || subtitleData.words.length === 0) {
    return [];
  }

  // AI 의미 단위 청크가 있으면 우선 사용
  if (subtitleData.meaningChunks && subtitleData.meaningChunks.length > 0) {
    console.log(`[Video] AI 의미 단위 자막 사용: ${subtitleData.meaningChunks.length}개 청크`);
    return subtitleData.meaningChunks.map(chunk => ({
      text: chunk.text,
      startTime: chunk.startTime,
      endTime: chunk.endTime
    }));
  }

  // 폴백: 기존 단어 수 기반 분리
  console.log('[Video] 기본 단어 수 기반 자막 사용');
  const chunks: SubtitleChunk[] = [];
  const words = subtitleData.words;
  const wordsPerChunk = config.wordsPerLine * config.maxLines;

  for (let i = 0; i < words.length; i += wordsPerChunk) {
    const chunkWords = words.slice(i, Math.min(i + wordsPerChunk, words.length));

    if (chunkWords.length === 0) continue;

    const lines: string[] = [];
    for (let j = 0; j < chunkWords.length; j += config.wordsPerLine) {
      const lineWords = chunkWords.slice(j, j + config.wordsPerLine);
      lines.push(lineWords.map(w => w.word).join(' '));
    }

    chunks.push({
      text: lines.join('\n'),
      startTime: chunkWords[0].start,
      endTime: chunkWords[chunkWords.length - 1].end
    });
  }

  // 청크 간 간격 제거
  for (let i = 0; i < chunks.length - 1; i++) {
    chunks[i].endTime = chunks[i + 1].startTime;
  }

  return chunks;
}

/**
 * 현재 시간에 해당하는 자막 청크 찾기
 * - 씬 내에서 자막 바가 깜빡이지 않도록 마지막 청크를 씬 끝까지 유지
 */
function getCurrentChunk(
  chunks: SubtitleChunk[],
  sceneElapsed: number
): SubtitleChunk | null {
  if (chunks.length === 0) return null;

  // 현재 시간에 해당하는 청크 찾기
  for (const chunk of chunks) {
    if (sceneElapsed >= chunk.startTime && sceneElapsed <= chunk.endTime) {
      return chunk;
    }
  }

  // 청크 사이에 있을 때 (이전 청크 유지)
  for (let i = chunks.length - 1; i >= 0; i--) {
    if (sceneElapsed > chunks[i].endTime) {
      // 다음 청크가 있고 아직 시작 전이면 이전 청크 유지
      if (i + 1 < chunks.length && sceneElapsed < chunks[i + 1].startTime) {
        return chunks[i];
      }
      // 마지막 청크 이후: 씬 끝까지 마지막 자막 유지 (깜빡임 방지)
      if (i === chunks.length - 1) {
        return chunks[i];
      }
      break;
    }
  }

  // 시작 전이면 첫 번째 청크 (시작 0.1초 전부터 표시해서 깜빡임 방지)
  if (sceneElapsed < chunks[0].startTime && sceneElapsed >= 0) {
    if (chunks[0].startTime - sceneElapsed < 0.1) {
      return chunks[0]; // 시작 직전이면 미리 표시
    }
    return null;
  }

  return null;
}

/**
 * 자막 렌더링 함수
 */
function renderSubtitle(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  chunks: SubtitleChunk[],
  sceneElapsed: number,
  config: SubtitleConfig
) {
  const currentChunk = getCurrentChunk(chunks, sceneElapsed);
  if (!currentChunk) return;

  const lines = currentChunk.text.split('\n');
  if (lines.length === 0) return;

  // 자막 스타일 설정
  const lineHeight = config.fontSize * 1.4;
  const padding = 20;
  const safeMargin = 10; // 화면 경계 안전 여백

  ctx.font = `${config.fontWeight ?? 700} ${config.fontSize}px ${config.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // 전체 자막 영역 크기 계산
  const maxLineWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
  let boxWidth = maxLineWidth + padding * 2;
  const boxHeight = lines.length * lineHeight + padding * 2;

  // 화면 경계 체크 - 박스가 화면을 넘지 않도록
  const maxBoxWidth = canvas.width - safeMargin * 2;
  if (boxWidth > maxBoxWidth) {
    boxWidth = maxBoxWidth;
  }

  const boxX = Math.max(safeMargin, (canvas.width - boxWidth) / 2);
  let boxY: number;
  if (config.yPercent !== undefined) {
    const usableHeight = canvas.height - boxHeight - safeMargin * 2;
    boxY = safeMargin + (config.yPercent / 100) * usableHeight;
  } else {
    const position = config.position ?? 'bottom';
    if (position === 'top') {
      boxY = config.bottomMargin;
    } else if (position === 'middle') {
      boxY = (canvas.height - boxHeight) / 2;
    } else {
      boxY = canvas.height - config.bottomMargin - boxHeight;
    }
  }

  // 경계 체크
  if (boxY < safeMargin) boxY = safeMargin;
  if (boxY + boxHeight > canvas.height - safeMargin) boxY = canvas.height - safeMargin - boxHeight;

  // 반투명 배경 박스
  ctx.fillStyle = config.backgroundColor;
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 8);
  ctx.fill();

  // 텍스트 렌더링
  lines.forEach((line, lineIndex) => {
    const textY = boxY + padding + lineIndex * lineHeight;

    // 테두리 (strokeWidth > 0일 때만)
    const sw = config.strokeWidth ?? 4;
    if (sw > 0) {
      ctx.strokeStyle = config.strokeColor ?? 'rgba(0,0,0,0.8)';
      ctx.lineWidth = sw;
      ctx.lineJoin = 'round';
      ctx.strokeText(line, canvas.width / 2, textY);
    }

    // 텍스트
    ctx.fillStyle = config.textColor;
    ctx.fillText(line, canvas.width / 2, textY);
  });
}

export interface VideoExportOptions {
  enableSubtitles?: boolean;  // 자막 활성화 여부 (기본: true)
  subtitleConfig?: Partial<SubtitleConfig>;
}

// 실제 렌더링된 자막 타이밍 기록용 인터페이스
export interface RecordedSubtitleEntry {
  index: number;
  startTime: number;
  endTime: number;
  text: string;
}

// 비디오 생성 결과 (영상 + SRT 데이터)
export interface VideoGenerationResult {
  videoBlob: Blob;
  recordedSubtitles: RecordedSubtitleEntry[];
}

export const generateVideo = async (
  assets: GeneratedAsset[],
  onProgress: (msg: string) => void,
  abortRef?: { current: boolean },
  options?: VideoExportOptions
): Promise<VideoGenerationResult | null> => {
  // 옵션 기본값
  const enableSubtitles = options?.enableSubtitles ?? true;
  const config: SubtitleConfig = { ...DEFAULT_SUBTITLE_CONFIG, ...options?.subtitleConfig };

  // 이미지가 있는 모든 씬 포함 (오디오 없으면 기본 3초)
  const validAssets = assets.filter(a => a.imageData);
  if (validAssets.length === 0) throw new Error("에셋이 준비되지 않았습니다.");

  // 자막 데이터 유무 체크
  const hasSubtitles = enableSubtitles && validAssets.some(a => a.subtitleData !== null);
  console.log(`[Video] 총 ${assets.length}개 씬 중 ${validAssets.length}개 렌더링, 자막: ${enableSubtitles ? (hasSubtitles ? '활성화' : '데이터 없음') : '비활성화'}`);
  if (enableSubtitles) {
    console.log(`[Video] 자막 설정: ${config.wordsPerLine}단어/줄, 최대 ${config.maxLines}줄`);
  }

  onProgress("에셋 메모리 사전 로딩 중 (1/3)...");

  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new AudioContextClass();
  const destination = audioCtx.createMediaStreamDestination();

  // 1. 모든 장면의 경계(startTime, endTime)를 미리 계산하여 타임라인 구축
  const preparedScenes: PreparedScene[] = [];
  let timelinePointer = 0;

  const DEFAULT_DURATION = 3; // 오디오 없을 때 기본 3초

  for (let i = 0; i < validAssets.length; i++) {
    const asset = validAssets[i];
    onProgress(`데이터 디코딩 및 프레임 매칭 중 (${i + 1}/${validAssets.length})...`);

    // 이미지 로드 (폴백용으로 항상 필요) - 에러 핸들링 추가
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = `data:image/jpeg;base64,${asset.imageData}`;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => {
        if (img.width === 0 || img.height === 0) {
          console.error(`[Video] 씬 ${i + 1}: 이미지 크기가 0 - 로드 실패`);
          reject(new Error('Image has zero dimensions'));
        } else {
          console.log(`[Video] 씬 ${i + 1}: 이미지 로드 완료 (${img.width}x${img.height})`);
          resolve();
        }
      };
      img.onerror = () => {
        console.error(`[Video] 씬 ${i + 1}: 이미지 로드 에러`);
        reject(new Error('Image load failed'));
      };
      // 타임아웃 (5초)
      setTimeout(() => reject(new Error('Image load timeout')), 5000);
    }).catch(e => {
      console.warn(`[Video] 씬 ${i + 1}: ${e.message}, 플레이스홀더 사용`);
      // 플레이스홀더 이미지 생성
      const placeholderCanvas = document.createElement('canvas');
      placeholderCanvas.width = 1280;
      placeholderCanvas.height = 720;
      const pCtx = placeholderCanvas.getContext('2d');
      if (pCtx) {
        pCtx.fillStyle = '#1a1a2e';
        pCtx.fillRect(0, 0, 1280, 720);
        pCtx.fillStyle = '#fff';
        pCtx.font = 'bold 48px sans-serif';
        pCtx.textAlign = 'center';
        pCtx.fillText(`씬 ${i + 1}`, 640, 360);
      }
      img.src = placeholderCanvas.toDataURL();
    });

    // 애니메이션 영상 로드 (있는 경우)
    let video: HTMLVideoElement | null = null;
    let isAnimated = false;

    if (asset.videoData) {
      try {
        video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.src = asset.videoData;
        video.muted = true;  // 영상 자체 오디오는 사용 안 함
        video.playsInline = true;
        video.loop = true;   // 영상 길이가 오디오보다 짧으면 반복

        await new Promise<void>((resolve, reject) => {
          video!.onloadeddata = () => resolve();
          video!.onerror = () => reject(new Error('Video load failed'));
          setTimeout(() => reject(new Error('Video load timeout')), 10000);
        });

        isAnimated = true;
        console.log(`[Video] 씬 ${i + 1}: 애니메이션 영상 로드 완료`);
      } catch (e) {
        console.warn(`[Video] 씬 ${i + 1}: 애니메이션 로드 실패, 정적 이미지 사용`);
        video = null;
        isAnimated = false;
      }
    }

    let audioBuffer: AudioBuffer | null = null;
    let duration = DEFAULT_DURATION;

    // 오디오가 있으면 디코딩, 없으면 기본 시간 사용
    if (asset.audioData) {
      try {
        audioBuffer = await decodeAudio(asset.audioData, audioCtx);
        duration = audioBuffer.duration;
      } catch (e) {
        console.warn(`[Video] 씬 ${i + 1} 오디오 디코딩 실패, 기본 ${DEFAULT_DURATION}초 사용`);
      }
    } else {
      console.log(`[Video] 씬 ${i + 1} 오디오 없음, 기본 ${DEFAULT_DURATION}초 사용`);
    }

    // 자막 청크 미리 계산
    let subtitleChunks: SubtitleChunk[] = [];
    if (enableSubtitles) {
      if (asset.subtitleData && asset.subtitleData.words.length > 0) {
        // ElevenLabs: 타임스탬프 기반 청크
        subtitleChunks = createSubtitleChunks(asset.subtitleData, config);
      } else if (asset.narration && audioBuffer && audioBuffer.duration > 0) {
        // Google TTS: 타임스탬프 없음 → 글자 수 비례 추정
        subtitleChunks = createTimingEstimatedChunks(asset.narration, audioBuffer.duration);
        console.log(`[Video] 씬 ${i + 1}: Google TTS 추정 자막 ${subtitleChunks.length}개 청크`);
      }
    }
    if (subtitleChunks.length > 0) {
      console.log(`[Video] 씬 ${i + 1}: ${subtitleChunks.length}개 자막 청크 생성`);
    }

    const startTime = timelinePointer;
    const endTime = startTime + duration;

    preparedScenes.push({
      img,
      video,
      isAnimated,
      audioBuffer,
      subtitleChunks,
      startTime,
      endTime,
      duration
    });
    timelinePointer = endTime;
  }

  const totalDuration = timelinePointer;

  // 2. 캔버스 및 미디어 레코더 설정
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error("캔버스 초기화 실패");

  const canvasStream = canvas.captureStream(30);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...destination.stream.getAudioTracks()
  ]);

  const mimeType = MediaRecorder.isTypeSupported('video/mp4; codecs="avc1.42E01E, mp4a.40.2"')
    ? 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"'
    : 'video/webm; codecs=vp9,opus';

  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: 12000000 // 12Mbps 초고화질
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);

  // 자막 타이밍 기록용 배열
  const recordedSubtitles: RecordedSubtitleEntry[] = [];
  let lastRecordedChunkText: string | null = null;
  let currentChunkStartTime: number = 0;
  let subtitleIndex = 0;

  return new Promise(async (resolve, reject) => {
    let isFinished = false;

    recorder.onstop = async () => {
      await audioCtx.close(); // 오디오 컨텍스트 정리

      // 마지막 자막 청크 종료 처리
      if (lastRecordedChunkText !== null) {
        recordedSubtitles.push({
          index: subtitleIndex,
          startTime: currentChunkStartTime,
          endTime: totalDuration,
          text: lastRecordedChunkText
        });
      }

      resolve({
        videoBlob: new Blob(chunks, { type: mimeType }),
        recordedSubtitles
      });
    };
    recorder.onerror = (e) => reject(e);

    if (audioCtx.state === 'suspended') await audioCtx.resume();

    onProgress("실시간 동기화 렌더링 시작 (2/3)...");

    // 3. 오디오 스케줄링
    const initialDelay = 0.5; // 레코더 안정화를 위한 여유 시간 확보
    const masterStartTime = audioCtx.currentTime + initialDelay;

    preparedScenes.forEach(scene => {
      // 오디오가 있는 씬만 스케줄링
      if (scene.audioBuffer) {
        const source = audioCtx.createBufferSource();
        source.buffer = scene.audioBuffer;
        source.connect(destination);
        // 렌더링 중 스피커 출력 음소거 (MP4에는 정상 포함)
        source.start(masterStartTime + scene.startTime);
        source.stop(masterStartTime + scene.endTime);
      }
    });

    // 애니메이션 영상 재생 스케줄링
    preparedScenes.forEach((scene, idx) => {
      if (scene.isAnimated && scene.video) {
        const videoStartDelay = (masterStartTime - audioCtx.currentTime + scene.startTime) * 1000;
        setTimeout(() => {
          if (!isFinished && scene.video) {
            scene.video.currentTime = 0;
            scene.video.play().catch(e => console.warn(`[Video] 씬 ${idx + 1} 영상 재생 실패:`, e));
          }
        }, Math.max(0, videoStartDelay));
      }
    });

    recorder.start();

    // 4. 고정밀 프레임 루프 (Master Clock Tracking)
    const renderLoop = () => {
      if (isFinished) return;

      if (abortRef?.current) {
        isFinished = true;
        recorder.stop();
        return;
      }

      const currentAudioTime = audioCtx.currentTime;
      const elapsed = currentAudioTime - masterStartTime;

      // 모든 장면 완료 체크
      if (elapsed >= totalDuration) {
        isFinished = true;
        onProgress("렌더링 완료! 파일 생성 중...");
        setTimeout(() => recorder.stop(), 500); // 마지막 프레임 유지를 위해 0.5초 대기
        return;
      }

      // 현재 오디오 타임스탬프에 '절대 동기화'된 장면 찾기 (경계값 포함)
      let currentScene = preparedScenes.find(s =>
        elapsed >= s.startTime && elapsed <= s.endTime
      );

      // 씬을 못 찾으면 가장 가까운 씬 선택
      if (!currentScene) {
        if (elapsed < 0 || elapsed < preparedScenes[0].startTime) {
          currentScene = preparedScenes[0];
        } else {
          // elapsed 이후로 시작하는 가장 가까운 씬 또는 마지막 씬
          currentScene = preparedScenes.find(s => elapsed < s.startTime) || preparedScenes[preparedScenes.length - 1];
        }
      }

      if (ctx && currentScene) {
        // 배경 클리어
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 씬 진행률 계산
        const sceneProgress = Math.min(1, Math.max(0, (elapsed - currentScene.startTime) / currentScene.duration));

        let rendered = false;

        // 애니메이션 씬: 비디오 프레임 렌더링
        if (currentScene.isAnimated && currentScene.video && currentScene.video.readyState >= 2) {
          const video = currentScene.video;
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            const ratio = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);

            // 부드러운 줌인 효과 (정적 이미지보다 약하게)
            const scale = 1.0 + 0.05 * sceneProgress;

            const nw = video.videoWidth * ratio * scale;
            const nh = video.videoHeight * ratio * scale;
            ctx.drawImage(video, (canvas.width - nw) / 2, (canvas.height - nh) / 2, nw, nh);
            rendered = true;
          }
        }

        // 정적 이미지 렌더링 (비디오 실패 시 또는 기본)
        if (!rendered) {
          const img = currentScene.img;
          if (img.width > 0 && img.height > 0) {
            const ratio = Math.min(canvas.width / img.width, canvas.height / img.height);

            // 줌인 효과: 씬 진행률에 따라 1.0 → 1.1 (10% 확대)
            const scale = 1.0 + 0.1 * sceneProgress;

            const nw = img.width * ratio * scale;
            const nh = img.height * ratio * scale;
            ctx.drawImage(img, (canvas.width - nw) / 2, (canvas.height - nh) / 2, nw, nh);
          }
        }

        // 자막 렌더링 (청크 기반)
        const sceneElapsed = elapsed - currentScene.startTime;
        renderSubtitle(ctx, canvas, currentScene.subtitleChunks, sceneElapsed, config);

        // 자막 타이밍 기록 (실제 표시되는 것과 동일하게)
        const currentChunk = getCurrentChunk(currentScene.subtitleChunks, sceneElapsed);
        const currentChunkText = currentChunk?.text || null;

        if (currentChunkText !== lastRecordedChunkText) {
          // 이전 청크 종료 기록
          if (lastRecordedChunkText !== null) {
            recordedSubtitles.push({
              index: subtitleIndex,
              startTime: currentChunkStartTime,
              endTime: elapsed,
              text: lastRecordedChunkText
            });
            subtitleIndex++;
          }
          // 새 청크 시작
          if (currentChunkText !== null) {
            currentChunkStartTime = elapsed;
          }
          lastRecordedChunkText = currentChunkText;
        }

        // 실시간 진행률 업데이트
        const percent = Math.min(100, Math.round((elapsed / totalDuration) * 100));
        if (percent % 5 === 0) { // 너무 빈번한 업데이트 방지
            onProgress(`동기화 렌더링 가동 중: ${percent}%`);
        }
      }

      requestAnimationFrame(renderLoop);
    };

    renderLoop();
  });
};
