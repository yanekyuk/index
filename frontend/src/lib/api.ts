import { useCallback, useMemo } from 'react';

import { authClient } from './auth-client';

// API Configuration
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL!;

// Error types
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: unknown
  ) {
    super(message);
    this.name = 'APIError';
  }
}

// API Client class
class APIClient {
  private baseURL: string;

  constructor(baseURL: string = API_BASE_URL) {
    this.baseURL = baseURL;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include',
      });

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        let errorData;
        
        try {
          errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch {
          // If JSON parsing fails, keep the default message
        }
        
        throw new APIError(errorMessage, response.status, errorData);
      }

      // Handle empty responses
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      } else {
        return {} as T;
      }
    } catch (error) {
      if (error instanceof APIError) {
        throw error;
      }
      
      // Network or other errors
      throw new APIError(
        error instanceof Error ? error.message : 'Network error',
        0,
        error
      );
    }
  }

  // GET request
  async get<T>(endpoint: string, options?: { signal?: AbortSignal }): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'GET',
      signal: options?.signal,
    });
  }

  // POST request
  async post<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  // PUT request
  async put<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  // PATCH request
  async patch<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  // DELETE request
  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'DELETE',
    });
  }

  // File upload
  async uploadFile<T>(
    endpoint: string,
    file: File,
    additionalData?: Record<string, string>,
    fieldName: string = 'file'
  ): Promise<T> {
    const formData = new FormData();
    formData.append(fieldName, file);

    // Add any additional form data
    if (additionalData) {
      Object.entries(additionalData).forEach(([key, value]) => {
        formData.append(key, value);
      });
    }

    const response = await fetch(`${this.baseURL}${endpoint}`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch {
        // If JSON parsing fails, keep the default message
      }
      throw new APIError(errorMessage, response.status);
    }

    return response.json();
  }
}

// Default API client instance
export const apiClient = new APIClient();

// Hook for authenticated API calls (Better Auth cookie-based sessions)
export function useAuthenticatedAPI() {
  const session = authClient.useSession();

  const makeAuthenticatedRequest = useCallback(async <T>(requestFn: () => Promise<T>): Promise<T> => {
    try {
      if (!session.data?.session) {
        throw new APIError('Authentication system not ready', 401);
      }
      return await requestFn();
    } catch (error) {
      if (error instanceof APIError) {
        throw error;
      }
      throw new APIError(
        error instanceof Error ? error.message : 'Authentication error',
        401
      );
    }
  }, [session.data?.session]);

  return useMemo(
    () => ({
      get: <T>(endpoint: string, options?: { signal?: AbortSignal }) =>
        makeAuthenticatedRequest<T>(() => apiClient.get<T>(endpoint, options)),

      post: <T>(endpoint: string, data?: unknown) =>
        makeAuthenticatedRequest<T>(() => apiClient.post<T>(endpoint, data)),

      put: <T>(endpoint: string, data?: unknown) =>
        makeAuthenticatedRequest<T>(() => apiClient.put<T>(endpoint, data)),

      patch: <T>(endpoint: string, data?: unknown) =>
        makeAuthenticatedRequest<T>(() => apiClient.patch<T>(endpoint, data)),

      delete: <T>(endpoint: string) =>
        makeAuthenticatedRequest<T>(() => apiClient.delete<T>(endpoint)),

      uploadFile: <T>(
        endpoint: string,
        file: File,
        additionalData?: Record<string, string>,
        fieldName?: string
      ) =>
        makeAuthenticatedRequest<T>(() =>
          apiClient.uploadFile<T>(endpoint, file, additionalData, fieldName)
        ),
    }),
    [makeAuthenticatedRequest]
  );
}

// Utility function for non-authenticated requests
export const api = {
  get: <T>(endpoint: string) => apiClient.get<T>(endpoint),
  post: <T>(endpoint: string, data?: unknown) => apiClient.post<T>(endpoint, data),
  put: <T>(endpoint: string, data?: unknown) => apiClient.put<T>(endpoint, data),
  patch: <T>(endpoint: string, data?: unknown) => apiClient.patch<T>(endpoint, data),
  delete: <T>(endpoint: string) => apiClient.delete<T>(endpoint),
}; 