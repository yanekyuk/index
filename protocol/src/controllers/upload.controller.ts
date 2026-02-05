/**
 * Upload controller (v2).
 * Library file upload and list only — no automatic intent creation.
 * Files are stored in the same DB and paths as the legacy /api/files routes,
 * so they appear in the Library when listing via GET /api/files or GET /v2/uploads.
 *
 * Uses busboy for multipart/form-data parsing (recommended for server environments
 * instead of Request.formData()).
 */

import * as fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import busboy from 'busboy';
import { v4 as uuidv4 } from 'uuid';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { Controller, Get, Post, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import db from '../lib/drizzle/drizzle';
import { files } from '../schemas/database.schema';
import { getUploadsPath } from '../lib/paths';
import { log } from '../lib/log';

import { validateFileByMetadata, FILE_SIZE_LIMITS } from '../lib/uploads.config';
import type { FileRecord } from '../types';

const logger = log.controller.from("upload");

type ParsedFile = { filename: string; mimeType: string; buffer: Buffer };

/**
 * Parse multipart/form-data using busboy (recommended for server-side parsing).
 * Resolves with the first file under field name "file", or rejects if missing/invalid.
 */
function parseMultipartFile(req: Request): Promise<ParsedFile> {
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
        fileSize: FILE_SIZE_LIMITS.GENERAL,
        files: 1,
      },
    });

    bb.on('file', (name, stream, info) => {
      if (name !== 'file') {
        stream.resume();
        return;
      }
      const { filename, mimeType } = info;
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
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

    const [inserted] = await db
      .insert(files)
      .values({
        id: fileId,
        name: filename,
        size: BigInt(size),
        type: mimeType,
        userId: user.id,
      })
      .returning({
        id: files.id,
        name: files.name,
        size: files.size,
        type: files.type,
        createdAt: files.createdAt,
        userId: files.userId,
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
    const skip = (page - 1) * limit;

    const where = and(isNull(files.deletedAt), eq(files.userId, user.id));

    const [rows, totalResult] = await Promise.all([
      db
        .select({
          id: files.id,
          name: files.name,
          size: files.size,
          type: files.type,
          createdAt: files.createdAt,
        })
        .from(files)
        .where(where)
        .orderBy(desc(files.createdAt))
        .offset(skip)
        .limit(limit),
      db.select({ count: count() }).from(files).where(where),
    ]);

    const total = totalResult[0]?.count ?? 0;
    const data: FileRecord[] = rows.map((f) => ({
      id: f.id,
      name: f.name,
      size: f.size.toString(),
      type: f.type,
      createdAt: f.createdAt.toISOString(),
      url: this.fileUrl(user.id, f.id, f.name),
    }));

    return {
      files: data,
      pagination: {
        current: page,
        total: Math.ceil(Number(total) / limit),
        count: data.length,
        totalCount: Number(total),
      },
    };
  }

  private fileUrl(userId: string, fileId: string, name: string): string {
    const ext = path.extname(name);
    return `/uploads/files/${userId}/${fileId}${ext}`;
  }
}
