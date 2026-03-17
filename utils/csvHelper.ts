import { GeneratedAsset } from "../types";
import JSZip from 'jszip';
import * as FileSaver from 'file-saver';

// Robust import for saveAs to handle different ESM/CommonJS interop behaviors
const saveAs = (FileSaver as any).saveAs || (FileSaver as any).default || FileSaver;

// UTF-8 BOM for Excel Korean support
const BOM = "\uFEFF";

/** data: URI 접두사 제거 */
function stripDataPrefix(base64: string): string {
  return base64.startsWith('data:') ? base64.split(',')[1] : base64;
}

/** Raw PCM16 여부 감지 (MP3/WAV/OGG 헤더 없으면 PCM으로 간주) */
function isPcm16Audio(base64: string): boolean {
  try {
    const raw = stripDataPrefix(base64);
    const bytes = atob(raw.slice(0, 16)); // 16자 = 12바이트 확보
    const b0 = bytes.charCodeAt(0), b1 = bytes.charCodeAt(1), b2 = bytes.charCodeAt(2);
    if (b0 === 0x49 && b1 === 0x44 && b2 === 0x33) return false; // ID3 (MP3)
    if (b0 === 0xFF && (b1 & 0xE0) === 0xE0) return false;       // sync frame (MP3)
    if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46) return false; // RIFF (WAV)
    if (b0 === 0x4F && b1 === 0x67 && b2 === 0x67) return false; // OggS
    return true;
  } catch { return false; }
}

/** Uint8Array → base64 (청크 처리로 스택 오버플로 방지) */
function uint8ToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(bin);
}

/** PCM16 base64 → WAV base64 (24kHz, mono, 16-bit) */
function pcm16ToWavBase64(base64Pcm: string): string {
  const raw = stripDataPrefix(base64Pcm);
  const pcmBytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
  const wav = new ArrayBuffer(44 + pcmBytes.length);
  const v = new DataView(wav);
  const wr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); v.setUint32(4, 36 + pcmBytes.length, true); wr(8, 'WAVE');
  wr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 24000, true); v.setUint32(28, 48000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  wr(36, 'data'); v.setUint32(40, pcmBytes.length, true);
  new Uint8Array(wav).set(pcmBytes, 44);
  return uint8ToBase64(new Uint8Array(wav));
}

export const downloadCSV = (data: GeneratedAsset[]) => {
  const headers = ['Scene', 'Narration', 'Visual Prompt'];
  
  const rows = data.map(item => [
    item.sceneNumber.toString(),
    `"${item.narration.replace(/"/g, '""')}"`, // 따옴표 이스케이프
    `"${item.visualPrompt.replace(/"/g, '""')}"`
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(r => r.join(','))
  ].join('\n');

  // BOM 추가하여 엑셀 한글 깨짐 방지
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', 'youtube_script_data.csv');
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const downloadImagesAsZip = async (data: GeneratedAsset[]) => {
  const zip = new JSZip();
  const folder = zip.folder("images");
  
  let imageCount = 0;

  data.forEach((item) => {
    if (item.imageData) {
      folder?.file(`scene_${item.sceneNumber.toString().padStart(3, '0')}.jpg`, item.imageData, { base64: true });
      imageCount++;
    }
  });

  if (imageCount === 0) {
    alert("다운로드할 이미지가 없습니다.");
    return;
  }

  try {
    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, "heaven_assets.zip");
  } catch (error) {
    console.error("Failed to generate zip", error);
    alert("ZIP 파일 생성 중 오류가 발생했습니다.");
  }
};

/**
 * CSV와 이미지를 하나의 ZIP으로 묶어서 다운로드
 * CSV에는 이미지 파일의 경로가 포함되어 엑셀에서 매칭 가능
 */
/**
 * 이미지 + 음성을 하나의 ZIP으로 내보내기
 */
export const downloadMediaZip = async (data: GeneratedAsset[]) => {
  const zip = new JSZip();
  const imgFolder = zip.folder("images");
  const audioFolder = zip.folder("audio");

  let imageCount = 0;
  let audioCount = 0;

  for (const item of data) {
    const num = item.sceneNumber.toString().padStart(3, '0');

    if (item.imageData && imgFolder) {
      imgFolder.file(`scene_${num}.jpg`, item.imageData, { base64: true });
      imageCount++;
    }

    if (item.audioData && audioFolder) {
      const rawAudio = stripDataPrefix(item.audioData);
      if (isPcm16Audio(item.audioData)) {
        audioFolder.file(`scene_${num}.wav`, pcm16ToWavBase64(rawAudio), { base64: true });
      } else {
        audioFolder.file(`scene_${num}.mp3`, rawAudio, { base64: true });
      }
      audioCount++;
    }
  }

  if (imageCount === 0 && audioCount === 0) {
    alert("내보낼 이미지 또는 음성이 없습니다.");
    return;
  }

  try {
    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, `heaven_media_${Date.now()}.zip`);
  } catch (error) {
    console.error("Failed to generate media zip", error);
    alert("ZIP 파일 생성 중 오류가 발생했습니다.");
  }
};

export const downloadAudioZip = async (data: GeneratedAsset[]) => {
  const zip = new JSZip();
  let audioCount = 0;
  for (const item of data) {
    if (item.audioData) {
      const num = item.sceneNumber.toString().padStart(3, '0');
      const rawAudio = stripDataPrefix(item.audioData);
      if (isPcm16Audio(item.audioData)) {
        zip.file(`scene_${num}.wav`, pcm16ToWavBase64(rawAudio), { base64: true });
      } else {
        zip.file(`scene_${num}.mp3`, rawAudio, { base64: true });
      }
      audioCount++;
    }
  }
  if (audioCount === 0) { alert("다운로드할 오디오가 없습니다."); return; }
  const blob = await zip.generateAsync({ type: "blob" });
  saveAs(blob, `heaven_audio_${Date.now()}.zip`);
};

/** AudioBuffer → WAV Blob (PCM16, 인터리브) */
function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;
  const dataSize = numSamples * numChannels * 2;
  const wav = new ArrayBuffer(44 + dataSize);
  const v = new DataView(wav);
  const wr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); wr(8, 'WAVE');
  wr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, numChannels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * numChannels * 2, true);
  v.setUint16(32, numChannels * 2, true);
  v.setUint16(34, 16, true);
  wr(36, 'data'); v.setUint32(40, dataSize, true);
  const pcm = new Int16Array(wav, 44);
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      pcm[i * numChannels + ch] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
  }
  return new Blob([wav], { type: 'audio/wav' });
}

/** 모든 씬 오디오를 하나로 합쳐서 WAV 1개로 다운로드 */
export const downloadMergedAudio = async (data: GeneratedAsset[]) => {
  const items = data.filter(item => item.audioData);
  if (items.length === 0) { alert("다운로드할 오디오가 없습니다."); return; }

  const ctx = new AudioContext();
  const buffers: AudioBuffer[] = [];

  for (const item of items) {
    const raw = stripDataPrefix(item.audioData!);
    const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
    try {
      buffers.push(await ctx.decodeAudioData(bytes.buffer.slice(0)));
    } catch {
      // PCM16 fallback (Gemini TTS)
      const pcm = new Int16Array(bytes.buffer);
      const buf = ctx.createBuffer(1, pcm.length, 24000);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768.0;
      buffers.push(buf);
    }
  }

  if (buffers.length === 0) { alert("오디오 디코딩 실패"); ctx.close(); return; }

  const sampleRate = buffers[0].sampleRate;
  const numChannels = Math.max(...buffers.map(b => b.numberOfChannels));
  const totalLen = buffers.reduce((s, b) => s + b.length, 0);
  const merged = ctx.createBuffer(numChannels, totalLen, sampleRate);

  let offset = 0;
  for (const buf of buffers) {
    for (let ch = 0; ch < numChannels; ch++) {
      const src = buf.getChannelData(Math.min(ch, buf.numberOfChannels - 1));
      merged.getChannelData(ch).set(src, offset);
    }
    offset += buf.length;
  }

  ctx.close();
  saveAs(audioBufferToWavBlob(merged), `heaven_audio_merged_${Date.now()}.wav`);
};

export const downloadProjectZip = async (data: GeneratedAsset[]) => {
  const zip = new JSZip();
  const imgFolder = zip.folder("images");
  
  // CSV 헤더에 'Image File' 추가
  const headers = ['Scene', 'Narration', 'Visual Prompt', 'Image File'];
  const rows = [];
  let imageCount = 0;

  for (const item of data) {
    let imageFileName = '';
    
    // 이미지가 존재하면 ZIP에 추가하고 파일명 기록
    if (item.imageData && imgFolder) {
      const filename = `scene_${item.sceneNumber.toString().padStart(3, '0')}.jpg`;
      imgFolder.file(filename, item.imageData, { base64: true });
      imageFileName = `images/${filename}`;
      imageCount++;
    }

    rows.push([
      item.sceneNumber.toString(),
      `"${item.narration.replace(/"/g, '""')}"`,
      `"${item.visualPrompt.replace(/"/g, '""')}"`,
      `"${imageFileName}"` // 엑셀 하이퍼링크로 인식되거나 경로 확인 가능
    ]);
  }

  const csvContent = [
    headers.join(','),
    ...rows.map(r => r.join(','))
  ].join('\n');

  // 루트에 CSV 추가
  zip.file("project_script.csv", BOM + csvContent);

  try {
    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, "heaven_full_project.zip");
  } catch (error) {
    console.error("Failed to zip project", error);
    alert("프로젝트 압축 중 오류가 발생했습니다.");
  }
};