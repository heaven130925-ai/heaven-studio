
/**
 * 프로젝트 저장/로드 서비스 (IndexedDB 버전)
 * - 대용량 저장 지원 (수백 MB~수 GB)
 * - 프로젝트 수십~수백 개 저장 가능
 */

import { CONFIG } from '../config';
import { SavedProject, GeneratedAsset, CostBreakdown } from '../types';
import { getSelectedImageModel } from './imageService';

const DB_NAME = 'HeavenAI';
const DB_VERSION = 1;
const STORE_NAME = 'projects';

/**
 * IndexedDB 열기
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });
}

/**
 * 이미지 축소 (썸네일 생성용)
 */
function createThumbnail(base64Image: string, maxWidth: number = 640): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ratio = Math.min(maxWidth / img.width, 1); // 원본보다 크게 하지 않음
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.92).split(',')[1]);
      } else {
        resolve(base64Image);
      }
    };
    img.onerror = () => resolve('');
    // Gemini/Imagen 이미지는 JPEG base64 → 올바른 MIME 타입 사용
    const mimeType = base64Image.startsWith('/9j/') ? 'image/jpeg' : 'image/jpeg';
    img.src = `data:${mimeType};base64,${base64Image}`;
  });
}

/**
 * 현재 설정값 가져오기
 */
function getCurrentSettings() {
  const elevenLabsModel = localStorage.getItem(CONFIG.STORAGE_KEYS.ELEVENLABS_MODEL) || CONFIG.DEFAULT_ELEVENLABS_MODEL;
  const aspectRatio = (localStorage.getItem(CONFIG.STORAGE_KEYS.ASPECT_RATIO) as '16:9' | '9:16') || '16:9';

  return {
    imageModel: getSelectedImageModel(),
    elevenLabsModel,
    aspectRatio,
  };
}

/**
 * 프로젝트 저장
 */
export async function saveProject(
  topic: string,
  assets: GeneratedAsset[],
  customName?: string,
  cost?: CostBreakdown
): Promise<SavedProject> {
  const id = `project_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();

  // 첫 번째 이미지로 썸네일 생성
  let thumbnail: string | null = null;
  const firstImageAsset = assets.find(a => a.imageData);
  if (firstImageAsset?.imageData) {
    thumbnail = await createThumbnail(firstImageAsset.imageData);
  }

  const project: SavedProject = {
    id,
    name: customName || `${topic.slice(0, 30)}${topic.length > 30 ? '...' : ''}`,
    createdAt: now,
    topic,
    settings: getCurrentSettings(),
    assets: assets.map(asset => ({ ...asset })),
    thumbnail,
    cost
  };

  // IndexedDB에 저장
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(project);

    request.onsuccess = () => {
      console.log(`[Project] 프로젝트 저장 완료: ${project.name} (${assets.length}씬)`);
      resolve(project);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * 기존 프로젝트 에셋 업데이트 (ID 유지)
 */
export async function updateProjectAssets(
  projectId: string,
  assets: GeneratedAsset[]
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    // 기존 프로젝트 읽기
    const getReq = store.get(projectId);
    getReq.onsuccess = async () => {
      const existing: SavedProject | undefined = getReq.result;
      if (!existing) { resolve(); return; }
      // 썸네일 업데이트 (첫 번째 이미지)
      const firstImageAsset = assets.find(a => a.imageData);
      const thumbnail = firstImageAsset?.imageData
        ? await createThumbnail(firstImageAsset.imageData)
        : existing.thumbnail;
      const updated: SavedProject = {
        ...existing,
        assets: assets.map(a => ({ ...a })),
        thumbnail,
      };
      const putReq = store.put(updated);
      putReq.onsuccess = () => {
        console.log(`[Project] 프로젝트 자동 저장 완료: ${existing.name}`);
        resolve();
      };
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * 저장된 프로젝트 목록 가져오기
 */
export async function getSavedProjects(): Promise<SavedProject[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        // 최신순 정렬
        const projects = (request.result as SavedProject[])
          .sort((a, b) => b.createdAt - a.createdAt);
        resolve(projects);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('[Project] 프로젝트 목록 로드 실패:', e);
    return [];
  }
}

const DRAFT_ID = '__draft__';

/**
 * 현재 작업 즉시 임시저장 (뻑 대비 복구용)
 * - 프로젝트 ID 없어도 항상 저장
 */
export async function saveDraft(topic: string, assets: GeneratedAsset[]): Promise<void> {
  try {
    const db = await openDB();
    const draft: SavedProject = {
      id: DRAFT_ID,
      name: `[임시] ${topic.slice(0, 30)}`,
      createdAt: Date.now(),
      topic,
      settings: getCurrentSettings(),
      assets: assets.map(a => ({ ...a })),
      thumbnail: null,
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const req = tx.objectStore(STORE_NAME).put(draft);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error('[Draft] 임시저장 실패:', e);
  }
}

/**
 * 임시저장 불러오기
 */
export async function loadDraft(): Promise<SavedProject | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readonly');
      const req = tx.objectStore(STORE_NAME).get(DRAFT_ID);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return null;
  }
}

/**
 * 임시저장 삭제
 */
export async function clearDraft(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const req = tx.objectStore(STORE_NAME).delete(DRAFT_ID);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) { /* 무시 */ }
}

/**
 * 특정 프로젝트 가져오기
 */
export async function getProjectById(id: string): Promise<SavedProject | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('[Project] 프로젝트 로드 실패:', e);
    return null;
  }
}

/**
 * 프로젝트 삭제
 */
export async function deleteProject(id: string): Promise<boolean> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => {
        console.log(`[Project] 프로젝트 삭제: ${id}`);
        resolve(true);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('[Project] 프로젝트 삭제 실패:', e);
    return false;
  }
}

/**
 * 프로젝트 이름 변경
 */
export async function renameProject(id: string, newName: string): Promise<boolean> {
  try {
    const project = await getProjectById(id);
    if (!project) return false;

    project.name = newName;

    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(project);

      request.onsuccess = () => {
        console.log(`[Project] 프로젝트 이름 변경: ${newName}`);
        resolve(true);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('[Project] 프로젝트 이름 변경 실패:', e);
    return false;
  }
}

/**
 * 저장 용량 계산 (IndexedDB는 정확한 측정 어려움, 추정치 반환)
 */
export async function getStorageUsage(): Promise<{ used: number; available: number; percentage: number }> {
  try {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      return {
        used: estimate.usage || 0,
        available: estimate.quota || 0,
        percentage: Math.round(((estimate.usage || 0) / (estimate.quota || 1)) * 100)
      };
    }
  } catch (e) {
    console.warn('[Project] 용량 측정 실패');
  }

  return { used: 0, available: 0, percentage: 0 };
}

/**
 * 오래된 프로젝트 정리
 */
export async function cleanupOldProjects(keepCount: number = 50): Promise<number> {
  const projects = await getSavedProjects();
  if (projects.length <= keepCount) return 0;

  const toDelete = projects.slice(keepCount);
  let removed = 0;

  for (const project of toDelete) {
    const success = await deleteProject(project.id);
    if (success) removed++;
  }

  console.log(`[Project] ${removed}개 오래된 프로젝트 정리됨`);
  return removed;
}

/**
 * localStorage에서 IndexedDB로 마이그레이션 (기존 데이터 이전)
 */
export async function migrateFromLocalStorage(): Promise<number> {
  try {
    const oldData = localStorage.getItem(CONFIG.STORAGE_KEYS.PROJECTS);
    if (!oldData) return 0;

    const oldProjects = JSON.parse(oldData) as SavedProject[];
    if (!oldProjects.length) return 0;

    console.log(`[Project] localStorage에서 ${oldProjects.length}개 프로젝트 마이그레이션 시작...`);

    const db = await openDB();
    let migrated = 0;

    for (const project of oldProjects) {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(project);

        request.onsuccess = () => {
          migrated++;
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    }

    // 마이그레이션 완료 후 localStorage 정리
    localStorage.removeItem(CONFIG.STORAGE_KEYS.PROJECTS);
    console.log(`[Project] 마이그레이션 완료: ${migrated}개`);

    return migrated;
  } catch (e) {
    console.error('[Project] 마이그레이션 실패:', e);
    return 0;
  }
}
