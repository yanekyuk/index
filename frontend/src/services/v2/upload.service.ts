import { useMemo } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { FileRecord } from '../../types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

async function v2Fetch(
  path: string,
  options: RequestInit & { accessToken: string }
): Promise<Response> {
  const { accessToken, ...init } = options;
  const url = `${API_BASE_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string>),
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return res;
}

export type UploadListResponse = {
  files: FileRecord[];
  pagination: { current: number; total: number; count: number; totalCount: number };
};

export const createUploadServiceV2 = (getAccessToken: () => Promise<string | null>) => ({
  uploadFile: async (file: File): Promise<FileRecord> => {
    const token = await getAccessToken();
    if (!token) throw new Error('Not authenticated');

    const formData = new FormData();
    formData.append('file', file);

    const res = await v2Fetch('/uploads', {
      method: 'POST',
      body: formData,
      accessToken: token,
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
    const token = await getAccessToken();
    if (!token) throw new Error('Not authenticated');

    const res = await v2Fetch(
      `/uploads?page=${page}&limit=${limit}`,
      { method: 'GET', accessToken: token }
    );

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
  const { getAccessToken } = usePrivy();
  return useMemo(() => createUploadServiceV2(getAccessToken), [getAccessToken]);
}
