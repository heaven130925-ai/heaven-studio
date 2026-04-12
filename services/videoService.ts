
import { GeneratedAsset, SubtitleData, SubtitleConfig, DEFAULT_SUBTITLE_CONFIG, ZoomEffect, DEFAULT_ZOOM_EFFECT, ZoomOrigin } from '../types';

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
  video: HTMLVideoElement | null;
  isAnimated: boolean;
  audioBuffer: AudioBuffer | null;
  subtitleChunks: SubtitleChunk[];
  startTime: number;
  endTime: number;
  duration: number;
  zoom: ZoomEffect;  // 씬별 줌 효과
}

/**
 * 줌/패닝 효과를 적용하여 이미지를 캔버스에 그리기
 */
function drawImageWithZoom(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  W: number, H: number,
  progress: number,  // 0~1 (씬 진행률)
  zoom: ZoomEffect
): void {
  if (img.width === 0 || img.height === 0) return;

  // cover: 캔버스를 완전히 채움 (검정 여백 없음, 비율 유지하며 필요시 잘림)
  const ratio = Math.max(W / img.width, H / img.height);
  const baseW = img.width * ratio;
  const baseH = img.height * ratio;
  const factor = zoom.intensity / 100;

  let scale = 1;
  let tx = 0, ty = 0;

  if (zoom.type === 'zoom-in') {
    scale = 1 + factor * progress;
  } else if (zoom.type === 'zoom-out') {
    scale = (1 + factor) - factor * progress;
  } else if (zoom.type === 'pan-left') {
    scale = 1 + factor * 0.5;
    tx = (W * factor * 0.5) * (1 - progress) * -1;
  } else if (zoom.type === 'pan-right') {
    scale = 1 + factor * 0.5;
    tx = (W * factor * 0.5) * progress * -1 + W * factor * 0.5;
  }
  // 'none': scale=1, tx=0, ty=0

  const nw = baseW * scale;
  const nh = baseH * scale;

  // origin 기반 앵커 오프셋
  const originMap: Record<ZoomOrigin, [number, number]> = {
    'center':       [0.5, 0.5],
    'top-left':     [0,   0  ],
    'top-right':    [1,   0  ],
    'bottom-left':  [0,   1  ],
    'bottom-right': [1,   1  ],
  };
  const [ox, oy] = originMap[zoom.origin] ?? [0.5, 0.5];
  const x = (W - nw) * ox + tx;
  const y = (H - nh) * oy + ty;

  ctx.drawImage(img, x, y, nw, nh);
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

  // 단어 수 기반 분리 (maxCharsPerChunk 기준으로 동적 조정)
  console.log('[Video] 기본 단어 수 기반 자막 사용');
  const chunks: SubtitleChunk[] = [];
  const words = subtitleData.words;
  // maxCharsPerChunk 설정이 있으면 글자 수 기준으로 청크 크기 계산
  const maxCharsPerChunk = config.maxCharsPerChunk ?? 15;
  let wordsPerChunk = config.wordsPerLine * config.maxLines;
  // 단어 평균 글자 수로 wordsPerChunk 재계산
  if (words.length > 0) {
    const avgWordLen = words.reduce((s, w) => s + w.word.length, 0) / words.length;
    wordsPerChunk = Math.max(1, Math.round(maxCharsPerChunk / (avgWordLen + 1)));
  }

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

  // 한국어 폰트 fallback: Impact/Arial Black 등 영문 폰트 선택 시 중국어 폰트 대체 방지
  ctx.font = `${config.fontWeight ?? 700} ${config.fontSize}px '${config.fontFamily}', 'Noto Sans KR', '맑은 고딕', '나눔고딕', sans-serif`;
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
  aspectRatio?: '16:9' | '9:16';
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

// ─── FFmpeg 헬퍼 ────────────────────────────────────────────────────────────

/** Canvas → JPEG Uint8Array (동기, toDataURL 기반) */
function canvasToJpegBytes(canvas: HTMLCanvasElement, quality = 0.85): Uint8Array {
  const b64 = canvas.toDataURL('image/jpeg', quality).split(',')[1];
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// AAC 인코더 딜레이 보정용 앞 무음 패딩 (samples)
// AAC LC 인코더는 ~1024 samples의 lookahead delay가 있음
const AAC_ENCODER_DELAY_SAMPLES = 2048; // 넉넉하게 2048 (44100Hz 기준 ~46ms, 24000Hz 기준 ~85ms)
const AUDIO_END_PAD_SEC = 0.1;         // WAV 끝 최소 여유 (apad 필터가 FFmpeg에서 추가로 2초 보정)

/** AudioBuffer의 특정 구간을 WAV Uint8Array로 변환 (오디오-퍼스트 렌더링용)
 *  앞에 AAC_ENCODER_DELAY_SAMPLES 무음 + 뒤에 AUDIO_END_PAD_SEC 무음 추가 */
function audioBufferRangeToWav(buffer: AudioBuffer, startSec: number, endSec: number): Uint8Array {
  const sr = buffer.sampleRate;
  const src = buffer.getChannelData(0);
  const audioStartSample = Math.floor(startSec * sr);
  const audioEndSample = Math.ceil(endSec * sr);
  const clipLength = Math.max(0, Math.min(audioEndSample - audioStartSample, src.length - audioStartSample));
  const endPadSamples = Math.round(AUDIO_END_PAD_SEC * sr);
  const totalSamples = AAC_ENCODER_DELAY_SAMPLES + clipLength + endPadSamples;
  const merged = new Float32Array(totalSamples); // 기본값 0 (무음)
  for (let i = 0; i < clipLength; i++) {
    const srcIdx = audioStartSample + i;
    if (srcIdx < src.length) merged[AAC_ENCODER_DELAY_SAMPLES + i] = src[srcIdx];
  }
  const dataSize = totalSamples * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); ws(8, 'WAVE');
  ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ws(36, 'data'); v.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < totalSamples; i++) {
    const s = Math.max(-1, Math.min(1, merged[i]));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    off += 2;
  }
  return new Uint8Array(buf);
}

/** PreparedScene 배열의 오디오를 하나의 WAV Uint8Array로 병합
 *  앞에 AAC_ENCODER_DELAY_SAMPLES 무음 + 뒤에 AUDIO_END_PAD_SEC 무음 추가 */
function mergeSceneAudioToWav(scenes: PreparedScene[], sampleRate: number): Uint8Array {
  const totalDuration = scenes[scenes.length - 1].endTime;
  const endPadSamples = Math.round(AUDIO_END_PAD_SEC * sampleRate);
  const totalSamples = AAC_ENCODER_DELAY_SAMPLES + Math.ceil(totalDuration * sampleRate) + endPadSamples;
  const merged = new Float32Array(totalSamples); // 기본값 0 (무음)

  for (const sc of scenes) {
    if (!sc.audioBuffer) continue;
    // 앞 패딩만큼 offset 이동
    const start = AAC_ENCODER_DELAY_SAMPLES + Math.floor(sc.startTime * sampleRate);
    const src = sc.audioBuffer.numberOfChannels > 0 ? sc.audioBuffer.getChannelData(0) : new Float32Array(0);
    // 각 씬의 오디오가 다음 씬 영역을 침범하지 않도록 duration으로 상한 제한
    const maxDurationSamples = Math.ceil(sc.duration * sampleRate);
    const len = Math.min(src.length, maxDurationSamples, totalSamples - start);
    for (let i = 0; i < len; i++) merged[start + i] = src[i];
  }

  const dataSize = totalSamples * 2; // 16-bit mono
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); ws(8, 'WAVE');
  ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ws(36, 'data'); v.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < totalSamples; i++) {
    const s = Math.max(-1, Math.min(1, merged[i]));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    off += 2;
  }
  return new Uint8Array(buf);
}

// 씬 수가 많을 때 청크 단위로 분할 렌더링
const FFMPEG_CHUNK_SIZE = 20;

/**
 * FFmpeg.wasm 단일 청크 렌더링 (내부용)
 * - preparedScenes는 startTime=0 기준으로 re-base된 상태여야 함
 * - fullAudioBuffer: 오디오-퍼스트 모드에서 전체 오디오 버퍼 (per-scene 오디오 대체)
 * - fullAudioOffsetSec: 이 청크가 전체 오디오에서 시작하는 절대 시간
 */
async function renderFFmpegSingleChunk(
  preparedScenes: PreparedScene[],
  config: SubtitleConfig,
  enableSubtitles: boolean,
  onProgress: (msg: string) => void,
  abortRef?: { current: boolean },
  aspectRatio: '16:9' | '9:16' = '16:9',
  subtitleIndexOffset: number = 0
): Promise<VideoGenerationResult | null> {
  const FPS = 30;
  const W = aspectRatio === '9:16' ? 1080 : 1920;
  const H = aspectRatio === '9:16' ? 1920 : 1080;

  onProgress('FFmpeg 초기화 중...');
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ffmpeg = new FFmpeg();

  await ffmpeg.load({
    coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js',
    wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm',
  });

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 초기화 실패');

  const recordedSubtitles: RecordedSubtitleEntry[] = [];
  let subtitleIndex = subtitleIndexOffset;
  let lastSubText: string | null = null;
  let lastSubStart = 0;

  // WAV 앞 무음 패딩과 싱크 맞추기 위한 선행 빈 프레임 수
  const sampleRate = preparedScenes.find(s => s.audioBuffer)?.audioBuffer?.sampleRate ?? 24000;
  const leadingFrames = Math.round((AAC_ENCODER_DELAY_SAMPLES / sampleRate) * FPS);

  let frameIndex = 0;
  const totalFrames = leadingFrames + Math.ceil(preparedScenes[preparedScenes.length - 1].endTime * FPS);

  // ── 1-0. AAC 딜레이 보정용 선행 검정 프레임 렌더링 ─────────
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const blackFrame = canvasToJpegBytes(canvas);
  for (let b = 0; b < leadingFrames; b++) {
    await ffmpeg.writeFile(`f${String(frameIndex).padStart(6, '0')}.jpg`, blackFrame);
    frameIndex++;
  }

  // ── 1. 프레임 렌더링 ──────────────────────────────────────
  // 절대시간 기준 프레임 계산: ceil로 오디오보다 절대 짧아지지 않도록
  for (const scene of preparedScenes) {
    const startFrame = Math.round(scene.startTime * FPS);
    const endFrame = Math.ceil(scene.endTime * FPS);   // round → ceil: 씬 끝 잘림 방지
    const sceneFrames = endFrame - startFrame;
    for (let f = 0; f < sceneFrames; f++) {
      if (abortRef?.current) { await ffmpeg.terminate(); return null; }

      const sceneElapsed = f / FPS;
      const sceneProgress = Math.min(sceneElapsed / scene.duration, 1);

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);

      // 이미지 + 줌/패닝 효과
      drawImageWithZoom(ctx, scene.img, W, H, sceneProgress, scene.zoom);

      // 자막 렌더링
      if (enableSubtitles) {
        renderSubtitle(ctx, canvas, scene.subtitleChunks, sceneElapsed, config);
        // 자막 타이밍 기록
        const chunk = getCurrentChunk(scene.subtitleChunks, sceneElapsed);
        const chunkText = chunk?.text || null;
        const absTime = scene.startTime + sceneElapsed;
        if (chunkText !== lastSubText) {
          if (lastSubText !== null) {
            recordedSubtitles.push({ index: subtitleIndex++, startTime: lastSubStart, endTime: absTime, text: lastSubText });
          }
          if (chunkText !== null) lastSubStart = absTime;
          lastSubText = chunkText;
        }
      }

      // 프레임 저장
      const jpegBytes = canvasToJpegBytes(canvas);
      await ffmpeg.writeFile(`f${String(frameIndex).padStart(6, '0')}.jpg`, jpegBytes);
      frameIndex++;

      if (frameIndex % 30 === 0) {
        const pct = Math.round((frameIndex / totalFrames) * 60);
        onProgress(`프레임 렌더링 중: ${pct}%`);
        await new Promise(r => setTimeout(r, 0)); // UI 업데이트 기회 부여
      }
    }
  }

  // 마지막 자막 종료 처리
  if (lastSubText !== null) {
    recordedSubtitles.push({ index: subtitleIndex, startTime: lastSubStart, endTime: preparedScenes[preparedScenes.length - 1].endTime, text: lastSubText });
  }

  // ── 1-2. 오디오 끝 패딩만큼 후행 검정 프레임 추가 ────────────
  const trailingFrames = Math.round(AUDIO_END_PAD_SEC * FPS);
  for (let t = 0; t < trailingFrames; t++) {
    await ffmpeg.writeFile(`f${String(frameIndex).padStart(6, '0')}.jpg`, blackFrame);
    frameIndex++;
  }

  // ── 2. 오디오 WAV 합성 ────────────────────────────────────
  onProgress('오디오 합성 중: 70%');
  const wavBytes = mergeSceneAudioToWav(preparedScenes, sampleRate);
  const hasAudio = preparedScenes.some(s => s.audioBuffer);
  if (hasAudio) await ffmpeg.writeFile('audio.wav', wavBytes);

  // ── 3. FFmpeg 인코딩 ─────────────────────────────────────
  onProgress('FFmpeg 인코딩 중: 75%');
  const ffArgs = hasAudio
    ? ['-r', String(FPS), '-i', 'f%06d.jpg', '-i', 'audio.wav',
       '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
       '-c:a', 'aac', '-b:a', '192k',
       '-af', 'apad=pad_dur=2',  // 오디오 끝에 2초 무음 추가 → AAC 플러시 보장
       '-shortest',               // 비디오 끝나면 인코딩 중단 (오디오가 더 길어도 OK)
       '-movflags', '+faststart', 'output.mp4']
    : ['-r', String(FPS), '-i', 'f%06d.jpg',
       '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
       '-movflags', '+faststart', 'output.mp4'];

  await ffmpeg.exec(ffArgs);
  onProgress('영상 파일 생성 중: 95%');

  const raw = await ffmpeg.readFile('output.mp4');
  // SharedArrayBuffer 호환성 문제 해결: 새 ArrayBuffer로 복사
  const data = new Uint8Array(raw instanceof Uint8Array ? raw.buffer.slice(0) : (raw as any));
  await ffmpeg.terminate();

  return {
    videoBlob: new Blob([data], { type: 'video/mp4' }),
    recordedSubtitles,
  };
}

/**
 * FFmpeg.wasm 기반 고속 렌더링 (청크 자동 분할)
 * - 씬이 FFMPEG_CHUNK_SIZE 이하면 단일 렌더링
 * - 씬이 많으면 청크별로 나눠서 렌더링 후 concat으로 합침
 */
async function generateVideoFFmpeg(
  preparedScenes: PreparedScene[],
  config: SubtitleConfig,
  enableSubtitles: boolean,
  onProgress: (msg: string) => void,
  abortRef?: { current: boolean },
  aspectRatio: '16:9' | '9:16' = '16:9'
): Promise<VideoGenerationResult | null> {
  // 씬이 적으면 단일 청크로 처리
  if (preparedScenes.length <= FFMPEG_CHUNK_SIZE) {
    return renderFFmpegSingleChunk(preparedScenes, config, enableSubtitles, onProgress, abortRef, aspectRatio, 0);
  }

  // 청크 분할 처리
  const totalChunks = Math.ceil(preparedScenes.length / FFMPEG_CHUNK_SIZE);
  console.log(`[FFmpeg] 씬 ${preparedScenes.length}개 → ${totalChunks}개 청크로 분할 렌더링`);

  const chunkVideos: Uint8Array[] = [];
  const allSubtitles: RecordedSubtitleEntry[] = [];
  let subtitleIndexOffset = 0;

  for (let ci = 0; ci < totalChunks; ci++) {
    if (abortRef?.current) return null;

    const chunkScenes = preparedScenes.slice(ci * FFMPEG_CHUNK_SIZE, (ci + 1) * FFMPEG_CHUNK_SIZE);
    const chunkStartTime = chunkScenes[0].startTime;

    // 청크 내 타이밍을 0 기준으로 재조정
    const adjustedScenes = chunkScenes.map(s => ({
      ...s,
      startTime: s.startTime - chunkStartTime,
      endTime: s.endTime - chunkStartTime,
    }));

    onProgress(`청크 렌더링 중 (${ci + 1}/${totalChunks})...`);
    const result = await renderFFmpegSingleChunk(
      adjustedScenes, config, enableSubtitles,
      (msg) => onProgress(`[${ci + 1}/${totalChunks}] ${msg}`),
      abortRef, aspectRatio, subtitleIndexOffset
    );
    if (!result) return null;

    const chunkData = new Uint8Array(await result.videoBlob.arrayBuffer());
    chunkVideos.push(chunkData);

    // 자막 타이밍을 절대 시간으로 복원
    result.recordedSubtitles.forEach(sub => {
      allSubtitles.push({
        ...sub,
        startTime: sub.startTime + chunkStartTime,
        endTime: sub.endTime + chunkStartTime,
      });
    });
    subtitleIndexOffset += result.recordedSubtitles.length;
  }

  if (chunkVideos.length === 1) {
    return {
      videoBlob: new Blob([chunkVideos[0]], { type: 'video/mp4' }),
      recordedSubtitles: allSubtitles,
    };
  }

  // 모든 청크 MP4를 하나로 합치기
  onProgress('청크 영상 합치는 중...');
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ffmpeg = new FFmpeg();
  await ffmpeg.load({
    coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js',
    wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm',
  });

  let concatList = '';
  for (let i = 0; i < chunkVideos.length; i++) {
    await ffmpeg.writeFile(`chunk${i}.mp4`, chunkVideos[i]);
    concatList += `file 'chunk${i}.mp4'\n`;
  }

  await ffmpeg.writeFile('concat.txt', new TextEncoder().encode(concatList));
  await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', 'final.mp4']);

  const raw = await ffmpeg.readFile('final.mp4');
  const finalData = new Uint8Array(raw instanceof Uint8Array ? raw.buffer.slice(0) : (raw as any));
  await ffmpeg.terminate();

  return {
    videoBlob: new Blob([finalData], { type: 'video/mp4' }),
    recordedSubtitles: allSubtitles,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export const generateVideo = async (
  assets: GeneratedAsset[],
  onProgress: (msg: string) => void,
  abortRef?: { current: boolean },
  options?: VideoExportOptions
): Promise<VideoGenerationResult | null> => {
  // 옵션 기본값
  const enableSubtitles = options?.enableSubtitles ?? true;
  const rawConfig: SubtitleConfig = { ...DEFAULT_SUBTITLE_CONFIG, ...options?.subtitleConfig };
  // 프리뷰 캔버스(1280×720 or 720×1280) → 실제 렌더 캔버스(1920×1080 or 1080×1920): 1.5배 스케일
  const config: SubtitleConfig = { ...rawConfig, fontSize: Math.round(rawConfig.fontSize * 1.5) };

  // 이미지가 있는 모든 씬 포함 (오디오 없으면 기본 3초)
  const validAssets = assets.filter(a => a.imageData);
  if (validAssets.length === 0) throw new Error("에셋이 준비되지 않았습니다.");

  // 자막 데이터 유무 체크
  const hasSubtitles = enableSubtitles && validAssets.some(a => a.subtitleData !== null);
  console.log(`[Video] 총 ${assets.length}개 씬 중 ${validAssets.length}개 렌더링, 자막: ${enableSubtitles ? (hasSubtitles ? '활성화' : '데이터 없음') : '비활성화'}`);
  if (enableSubtitles) {
    console.log(`[Video] 자막 설정: ${config.wordsPerLine}단어/줄, 최대 ${config.maxLines}줄`);
  }

  onProgress("에셋 메모리 사전 로딩 중...");

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
      placeholderCanvas.width = 1920;
      placeholderCanvas.height = 1080;
      const pCtx = placeholderCanvas.getContext('2d');
      if (pCtx) {
        pCtx.fillStyle = '#1a1a2e';
        pCtx.fillRect(0, 0, 1920, 1080);
        pCtx.fillStyle = '#fff';
        pCtx.font = 'bold 48px sans-serif';
        pCtx.textAlign = 'center';
        pCtx.fillText(`씬 ${i + 1}`, 960, 540);
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
      } else if (asset.narration && duration > 0) {
        // Google/Gemini TTS: 타임스탬프 없음 → 씬 duration 기반 글자 수 비례 추정
        const maxChars = config.maxCharsPerChunk ?? 15;
        subtitleChunks = createTimingEstimatedChunks(asset.narration, duration, maxChars);
        console.log(`[Video] 씬 ${i + 1}: 추정 자막 ${subtitleChunks.length}개 청크 (최대 ${maxChars}자, 시간 ${duration.toFixed(1)}s)`);
      }
    }
    if (subtitleChunks.length > 0) {
      console.log(`[Video] 씬 ${i + 1}: ${subtitleChunks.length}개 자막 청크 생성`);
    }

    const startTime = timelinePointer;
    const endTime = startTime + duration;

    // 씬별 줌 효과 (없으면 전역 설정, 전역도 없으면 기본값)
    const zoom: ZoomEffect = asset.zoomEffect ?? config.globalZoom ?? DEFAULT_ZOOM_EFFECT;

    preparedScenes.push({
      img,
      video,
      isAnimated,
      audioBuffer,
      subtitleChunks,
      startTime,
      endTime,
      duration,
      zoom,
    });
    timelinePointer = endTime;
  }

  const totalDuration = timelinePointer;

  // ── FFmpeg 고속 렌더링 시도 ──────────────────────────────
  // 애니메이션 씬이 없으면 FFmpeg 사용 (애니메이션은 프레임 seek 미지원)
  const hasAnimated = preparedScenes.some(s => s.isAnimated);
  if (!hasAnimated) {
    try {
      onProgress('FFmpeg 고속 렌더링 시작...');
      const result = await generateVideoFFmpeg(preparedScenes, config, enableSubtitles, onProgress, abortRef, options?.aspectRatio ?? '16:9');
      await audioCtx.close();
      return result;
    } catch (e) {
      console.warn('[Video] FFmpeg 실패, 기존 방식으로 폴백:', e);
      onProgress('FFmpeg 실패 — 기존 방식으로 전환 중...');
    }
  }

  // 2. 캔버스 및 미디어 레코더 설정 (폴백)
  const canvas = document.createElement('canvas');
  const fbAspect = options?.aspectRatio ?? '16:9';
  canvas.width = fbAspect === '9:16' ? 1080 : 1920;
  canvas.height = fbAspect === '9:16' ? 1920 : 1080;
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
            const scale = 1.0 + 0.05 * sceneProgress;
            const nw = video.videoWidth * ratio * scale;
            const nh = video.videoHeight * ratio * scale;
            ctx.drawImage(video, (canvas.width - nw) / 2, (canvas.height - nh) / 2, nw, nh);
            rendered = true;
          }
        }

        // 정적 이미지 렌더링 — 씬별 줌/패닝 효과 적용
        if (!rendered) {
          drawImageWithZoom(ctx, currentScene.img, canvas.width, canvas.height, sceneProgress, currentScene.zoom);
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
