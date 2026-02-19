import { useMemo } from 'react';
import { FileRecord } from '../../types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

async function v2Fetch(path: string, options: RequestInit = {}): Promise<Response> {
  const url = `${API_BASE_URL}${path}`;
  return fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.headers as Record<string, string>),
    },
  });
}

export type UploadListResponse = {
  files: FileRecord[];
  pagination: { current: number; total: number; count: number; totalCount: number };
};

export const createUploadServiceV2 = () => ({
  uploadFile: async (file: File): Promise<FileRecord> => {
    const formData = new FormData();
    formData.append('file', file);

    const res = await v2Fetch('/uploads', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      let message = res.statusText;
      try {
        const data = await res.json();
        message = (data as { error?: string }).error ?? message;
      } catch {
        // ignore
      }
      throw new Error(message);
    }

    const data = (await res.json()) as { file: FileRecord };
    return data.file;
  },

  getFiles: async (page: number = 1, limit: number = 100): Promise<UploadListResponse> => {
    const res = await v2Fetch(`/uploads?page=${page}&limit=${limit}`, { method: 'GET' });

    if (!res.ok) {
      let message = res.statusText;
      try {
        const data = await res.json();
        message = (data as { error?: string }).error ?? message;
      } catch {
        // ignore
      }
      throw new Error(message);
    }

    const data = (await res.json()) as UploadListResponse;
    return {
      files: data.files ?? [],
      pagination: data.pagination ?? { current: page, total: 0, count: 0, totalCount: 0 },
    };
  },
});

export function useUploadServiceV2() {
  return useMemo(() => createUploadServiceV2(), []);
}
