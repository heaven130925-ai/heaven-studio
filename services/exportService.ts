/**
 * 엑셀 + 이미지 내보내기 서비스
 * - 엑셀 셀에 이미지 직접 삽입 (exceljs 사용)
 * - 나레이션과 이미지 매칭
 */

import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { GeneratedAsset, SavedProject } from '../types';

/**
 * 파일명에 사용할 수 없는 문자 제거
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').slice(0, 50);
}

/**
 * Base64를 Buffer로 변환 (브라우저 환경)
 */
function base64ToBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * 현재 생성된 에셋을 엑셀로 내보내기 (이미지 포함)
 */
export async function exportAssetsToZip(
  assets: GeneratedAsset[],
  projectName: string
): Promise<void> {
  // ExcelJS 워크북 생성
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Heaven AI';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('스토리보드', {
    views: [{ state: 'frozen', ySplit: 1 }] // 헤더 고정
  });

  // 열 정의
  worksheet.columns = [
    { header: '씬', key: 'scene', width: 6 },
    { header: '나레이션', key: 'narration', width: 50 },
    { header: '이미지', key: 'image', width: 30 },
    { header: '감정', key: 'sentiment', width: 10 },
    { header: '구도', key: 'composition', width: 12 }
  ];

  // 헤더 스타일
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' }
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 25;

  // 데이터 및 이미지 추가
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    const rowNum = i + 2; // 헤더가 1번이므로 2번부터

    // 행 추가
    const row = worksheet.addRow({
      scene: asset.sceneNumber || i + 1,
      narration: asset.narration || '',
      image: '', // 이미지는 별도로 삽입
      sentiment: (asset.analysis as any)?.sentiment || '',
      composition: asset.analysis?.composition_type || ''
    });

    // 이미지가 있으면 삽입
    if (asset.imageData) {
      // 행 높이 설정 (이미지 크기에 맞게)
      row.height = 120;

      // 이미지 추가
      const imageId = workbook.addImage({
        buffer: base64ToBuffer(asset.imageData),
        extension: 'png'
      });

      // 이미지를 C열(이미지 열)에 삽입
      worksheet.addImage(imageId, {
        tl: { col: 2, row: rowNum - 1 }, // top-left (0-indexed)
        ext: { width: 200, height: 112 }  // 16:9 비율
      });
    } else {
      row.height = 30;
    }

    // 셀 스타일
    row.alignment = { vertical: 'middle', wrapText: true };

    // 나레이션 열은 왼쪽 정렬
    row.getCell('narration').alignment = { vertical: 'middle', wrapText: true, horizontal: 'left' };

    // 감정에 따른 색상
    const sentimentCell = row.getCell('sentiment');
    if ((asset.analysis as any)?.sentiment === 'POSITIVE') {
      sentimentCell.font = { color: { argb: 'FF008000' } }; // 녹색
    } else if ((asset.analysis as any)?.sentiment === 'NEGATIVE') {
      sentimentCell.font = { color: { argb: 'FFFF0000' } }; // 빨강
    }

    // 테두리 추가
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        right: { style: 'thin', color: { argb: 'FFD0D0D0' } }
      };
    });
  }

  // 엑셀 파일 생성 및 다운로드
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });

  const safeName = sanitizeFilename(projectName);
  saveAs(blob, `${safeName}_스토리보드.xlsx`);
}

/**
 * 저장된 프로젝트를 엑셀로 내보내기
 */
export async function exportProjectToZip(project: SavedProject): Promise<void> {
  return exportAssetsToZip(project.assets, project.name);
}
