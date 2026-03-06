import * as fs from 'fs';
import busboy from 'busboy';
import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { fileService } from '../services/file.service';
import { log } from '../lib/log';
import { getUploadsPath } from '../lib/paths';
import path from 'path';
import { Controller, Get, Post, UseGuards } from '../lib/router/router.decorators';
import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';

import { validateFileByMetadata, FILE_SIZE_LIMITS } from '../lib/uploads.config';

import type { FileRecord } from '../types';

const logger = log.controller.from("upload");

type ParsedFile = { filename: string; mimeType: string; buffer: Buffer };

/**
 * Parse multipart/form-data using busboy (recommended for server-side parsing).
 * Resolves with the first file under field name "file", or rejects if missing/invalid.
 */
function parseMultipartFile(req: Request, fieldName = 'file', sizeLimit = FILE_SIZE_LIMITS.GENERAL): Promise<ParsedFile> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      reject(new Error('Invalid multipart body'));
      return;
    }

    let resolved = false;
    const finish = (err?: Error, result?: ParsedFile) => {
      if (resolved) return;
      resolved = true;
      if (err) reject(err);
      else if (result) resolve(result);
      else reject(new Error('No file uploaded'));
    };

    const bb = busboy({
      headers: { 'content-type': contentType },
      limits: {
        fileSize: sizeLimit,
        files: 1,
      },
    });

    bb.on('file', (name, stream, info) => {
      if (name !== fieldName) {
        stream.resume();
        return;
      }
      const { filename, mimeType } = info;
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('limit', () => finish(new Error('File size limit exceeded')));
      stream.on('end', () => {
        if (stream.truncated) {
          finish(new Error('File size limit exceeded'));
          return;
        }
        const buffer = Buffer.concat(chunks);
        finish(undefined, {
          filename: filename || 'unknown',
          mimeType: mimeType || 'application/octet-stream',
          buffer,
        });
      });
      stream.on('error', (err: unknown) => finish(err instanceof Error ? err : new Error(String(err))));
    });

    bb.on('error', (err: unknown) => finish(err instanceof Error ? err : new Error(String(err))));
    bb.on('close', () => {
      if (!resolved) finish(new Error('No file uploaded'));
    });

    if (!req.body) {
      finish(new Error('No request body'));
      return;
    }
    const nodeStream = Readable.fromWeb(req.body as import('stream/web').ReadableStream);
    nodeStream.pipe(bb);
  });
}

@Controller('/uploads')
export class UploadController {
  private storage: {
    uploadAvatar(buffer: Buffer, userId: string, extension: string, contentType: string): Promise<string>;
    uploadIndexImage(buffer: Buffer, userId: string, extension: string, contentType: string): Promise<string>;
  };

  constructor(storage: {
    uploadAvatar(buffer: Buffer, userId: string, extension: string, contentType: string): Promise<string>;
    uploadIndexImage(buffer: Buffer, userId: string, extension: string, contentType: string): Promise<string>;
  }) {
    this.storage = storage;
  }

  /**
   * Upload a single file to the user's library.
   * Does not trigger intent generation. File is stored and returned so it appears in Library.
   */
  @Post('')
  @UseGuards(AuthGuard)
  async upload(req: Request, user: AuthenticatedUser): Promise<Response | object> {
    let parsed: ParsedFile;
    try {
      parsed = await parseMultipartFile(req);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid multipart body';
      return Response.json({ error: message }, { status: 400 });
    }

    const { filename, mimeType, buffer } = parsed;
    const size = buffer.length;

    const validation = validateFileByMetadata(filename, mimeType, size, 'general');
    if (!validation.isValid) {
      return Response.json(
        { error: validation.message || 'File validation failed' },
        { status: 400 }
      );
    }

    const fileId = uuidv4();
    const ext = path.extname(filename);
    const targetDir = getUploadsPath('files', user.id);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const filePath = path.join(targetDir, fileId + ext);

    try {
      fs.writeFileSync(filePath, buffer);
    } catch (err) {
      logger.error('Upload write error', {
        userId: user.id,
        fileId,
        error: err instanceof Error ? err.message : String(err),
      });
      return Response.json({ error: 'Failed to save file' }, { status: 500 });
    }

    const inserted = await fileService.createFile({
      id: fileId,
      name: filename,
      size: BigInt(size),
      type: mimeType,
      userId: user.id,
    });

    const fileRecord: FileRecord = {
      id: inserted.id,
      name: inserted.name,
      size: inserted.size.toString(),
      type: inserted.type,
      createdAt: inserted.createdAt.toISOString(),
      url: this.fileUrl(user.id, inserted.id, inserted.name),
    };

    logger.info('File uploaded', {
      userId: user.id,
      fileId: inserted.id,
      name: inserted.name,
      size,
    });

    return {
      message: 'File uploaded successfully',
      file: fileRecord,
    };
  }

  /**
   * List files in the user's library (same shape as GET /api/files).
   * No intent generation; just returns uploaded files.
   */
  @Get('')
  @UseGuards(AuthGuard)
  async list(req: Request, user: AuthenticatedUser): Promise<object> {
    const url = new URL(req.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10)));

    const result = await fileService.listFiles(user.id, { page, limit });
    
    const data: FileRecord[] = result.files.map((f) => ({
      id: f.id,
      name: f.name,
      size: f.size.toString(),
      type: f.type,
      createdAt: f.createdAt.toISOString(),
      url: this.fileUrl(user.id, f.id, f.name),
    }));

    return {
      files: data,
      pagination: result.pagination,
    };
  }

  @Post('/avatar')
  @UseGuards(AuthGuard)
  async uploadAvatar(req: Request, user: AuthenticatedUser): Promise<Response | object> {
    let parsed: ParsedFile;
    try {
      parsed = await parseMultipartFile(req, 'avatar', FILE_SIZE_LIMITS.AVATAR);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid multipart body';
      return Response.json({ error: message }, { status: 400 });
    }

    const { filename, mimeType, buffer } = parsed;

    const validation = validateFileByMetadata(filename, mimeType, buffer.length, 'avatar');
    if (!validation.isValid) {
      return Response.json({ error: validation.message || 'File validation failed' }, { status: 400 });
    }

    try {
      const ext = path.extname(filename).replace('.', '');
      const avatarUrl = await this.storage.uploadAvatar(buffer, user.id, ext, mimeType);

      logger.info('Avatar uploaded', { userId: user.id, avatarUrl });

      return { message: 'Avatar uploaded successfully', avatarUrl };
    } catch (err) {
      logger.error('Avatar upload failed', {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return Response.json({ error: 'Failed to upload avatar' }, { status: 500 });
    }
  }

  @Post('/index-image')
  @UseGuards(AuthGuard)
  async uploadIndexImage(req: Request, user: AuthenticatedUser): Promise<Response | object> {
    let parsed: ParsedFile;
    try {
      parsed = await parseMultipartFile(req, 'image', FILE_SIZE_LIMITS.AVATAR);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid multipart body';
      return Response.json({ error: message }, { status: 400 });
    }

    const { filename, mimeType, buffer } = parsed;

    const validation = validateFileByMetadata(filename, mimeType, buffer.length, 'avatar');
    if (!validation.isValid) {
      return Response.json({ error: validation.message || 'File validation failed' }, { status: 400 });
    }

    try {
      const ext = path.extname(filename).replace('.', '');
      const imageUrl = await this.storage.uploadIndexImage(buffer, user.id, ext, mimeType);

      logger.info('Index image uploaded', { userId: user.id, imageUrl });

      return { message: 'Index image uploaded successfully', imageUrl };
    } catch (err) {
      logger.error('Index image upload failed', {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return Response.json({ error: 'Failed to upload index image' }, { status: 500 });
    }
  }

  private fileUrl(userId: string, fileId: string, name: string): string {
    const ext = path.extname(name);
    return `/uploads/files/${userId}/${fileId}${ext}`;
  }
}
