import { log } from '../lib/log';
import path from 'path';
import { getUploadsPath } from '../lib/paths';
import { loadFileContent } from '../lib/uploads';
import { fileDatabaseAdapter, type CreateFileInput } from '../adapters/database.adapter';

const logger = log.service.from("FileService");

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
