import { GeneratedAsset } from "../types";
import JSZip from 'jszip';
import * as FileSaver from 'file-saver';

// Robust import for saveAs to handle different ESM/CommonJS interop behaviors
const saveAs = (FileSaver as any).saveAs || (FileSaver as any).default || FileSaver;

// UTF-8 BOM for Excel Korean support
const BOM = "\uFEFF";

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
      audioFolder.file(`scene_${num}.mp3`, item.audioData, { base64: true });
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