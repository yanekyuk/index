import * as fs from 'fs';
import path from 'path';
import { UnstructuredClient } from 'unstructured-client';
import { Strategy } from 'unstructured-client/sdk/models/shared';
import { NodeHtmlMarkdown } from 'node-html-markdown';

import { log } from '../lib/log';
import { getUploadsPath } from '../lib/paths';
import { FILE_SIZE_LIMITS, FALLBACK_TEXT_EXTENSIONS } from '../lib/uploads.config';
import { fileDatabaseAdapter, type CreateFileInput } from '../adapters/database.adapter';

const logger = log.service.from("FileService");

// ----- File Content Loading -----

let unstructuredClient: UnstructuredClient | null = null;

function getUnstructuredClient(): UnstructuredClient | null {
  if (!process.env.UNSTRUCTURED_API_URL) return null;
  if (!unstructuredClient) {
    unstructuredClient = new UnstructuredClient({
      serverURL: process.env.UNSTRUCTURED_API_URL
    });
  }
  return unstructuredClient;
}

async function loadFileContent(filePath: string): Promise<{ content: string | null; error: string | null }> {
  if (!filePath || !fs.existsSync(filePath)) {
    return { content: null, error: `File not found: ${filePath}` };
  }

  try {
    const client = getUnstructuredClient();
    if (client) {
      const stats = fs.statSync(filePath);
      if (stats.size > FILE_SIZE_LIMITS.GENERAL) {
        return {
          content: null,
          error: `File exceeds size limit (${(stats.size / (1024 * 1024)).toFixed(2)}MB > ${(FILE_SIZE_LIMITS.GENERAL / (1024 * 1024)).toFixed(2)}MB)`
        };
      }
      const data = fs.readFileSync(filePath);
      const response = await client.general.partition({
        partitionParameters: {
          files: {
            content: data,
            fileName: path.basename(filePath),
          },
          strategy: Strategy.Fast,
          splitPdfPage: true,
          splitPdfConcurrencyLevel: 15,
          splitPdfAllowFailed: true,
          languages: ['eng'],
        },
      });

      if (Array.isArray(response) && response.length > 0) {
        const content = response
          .map((element: { text?: string }) => element.text ?? '')
          .filter((text: string) => text.trim())
          .join('\n\n');
        return { content, error: null };
      } else if (typeof response === 'string' && response.trim()) {
        return { content: response, error: null };
      }
    }
  } catch (error) {
    logger.warn('UnstructuredClient failed, trying fallback', { fileName: path.basename(filePath), error: error instanceof Error ? error.message : 'Unknown error' });
  }

  try {
    const ext = path.extname(filePath).toLowerCase();
    if ((FALLBACK_TEXT_EXTENSIONS as readonly string[]).includes(ext) || ext === '') {
      const rawContent = fs.readFileSync(filePath, 'utf8');
      if (ext === '.html') {
        const markdownContent = NodeHtmlMarkdown.translate(rawContent);
        if (markdownContent.trim()) return { content: markdownContent, error: null };
      }
      if (rawContent.trim()) return { content: rawContent, error: null };
    }
    return {
      content: null,
      error: `Cannot process ${ext} files without Unstructured API. Please set UNSTRUCTURED_API_URL for document support.`
    };
  } catch (error) {
    return {
      content: null,
      error: `Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ----- FileService -----

/**
 * FileService
 *
 * Manages file operations including storage, retrieval, and content loading.
 * Uses FileDatabaseAdapter for all database operations.
 *
 * RESPONSIBILITIES:
 * - File metadata CRUD operations
 * - File content loading for attached files
 * - File listing with pagination
 * - Soft delete management
 */
export class FileService {
  constructor(private db = fileDatabaseAdapter) {}
  /**
   * Get files by IDs for a specific user
   *
   * @param userId - The user ID
   * @param fileIds - Array of file IDs to retrieve
   * @returns Array of file records
   */
  async getFilesByIds(userId: string, fileIds: string[]) {
    if (!fileIds?.length) return [];

    logger.verbose('[FileService] Getting files by IDs', { userId, count: fileIds.length });

    return this.db.getFilesByIds(userId, fileIds);
  }

  /**
   * Load content from multiple files and format for chat context.
   * Reads file content from disk and concatenates with metadata.
   *
   * @param userId - The user ID (for path resolution)
   * @param fileIds - Array of file IDs to load
   * @returns Formatted string with file contents
   */
  async loadAttachedFileContent(userId: string, fileIds: string[]): Promise<string> {
    if (!fileIds?.length) return '';

    const rows = await this.getFilesByIds(userId, fileIds);
    if (rows.length === 0) return '';

    const targetDir = getUploadsPath('files', userId);
    const parts: string[] = [];

    for (const row of rows) {
      const ext = path.extname(row.name);
      const filePath = path.join(targetDir, row.id + ext);
      const result = await loadFileContent(filePath);

      if (result.content?.trim()) {
        parts.push(`=== ${row.name} ===\n${result.content.substring(0, 10000)}`);
      }
    }

    return parts.length ? parts.join('\n\n') : '';
  }

  /**
   * Get a single file by ID
   *
   * @param fileId - The file ID
   * @param userId - The user ID (for ownership verification)
   * @returns File record or null if not found
   */
  async getById(fileId: string, userId: string) {
    logger.verbose('[FileService] Getting file by ID', { fileId, userId });

    return this.db.getById(fileId, userId);
  }

  /**
   * List files for a user with pagination
   *
   * @param userId - The user ID
   * @param options - Pagination options
   * @returns Files and pagination metadata
   */
  async listFiles(userId: string, options: { page?: number; limit?: number } = {}) {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 100));
    const skip = (page - 1) * limit;

    logger.verbose('[FileService] Listing files', { userId, page, limit });

    const result = await this.db.listFiles(userId, { skip, limit });

    return {
      files: result.files,
      pagination: {
        current: page,
        total: Math.ceil(result.total / limit),
        count: result.files.length,
        totalCount: result.total,
      },
    };
  }

  /**
   * Create a new file record
   *
   * @param data - File metadata
   * @returns The created file record
   */
  async createFile(data: CreateFileInput) {
    logger.verbose('[FileService] Creating file', { id: data.id, userId: data.userId });

    return this.db.createFile(data);
  }

  /**
   * Soft delete a file
   *
   * @param fileId - The file ID
   * @param userId - The user ID (for ownership verification)
   * @returns True if deleted, false if not found or unauthorized
   */
  async softDelete(fileId: string, userId: string): Promise<boolean> {
    logger.verbose('[FileService] Soft deleting file', { fileId, userId });

    return this.db.softDelete(fileId, userId);
  }
}

export const fileService = new FileService();
