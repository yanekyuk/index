import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { Controller, Delete, Get, Post, UseGuards } from '../lib/router/router.decorators';
import { fileService } from '../services/file.service';
import { getUploadsPath } from '../lib/paths';
import { validateFileByMetadata, FILE_SIZE_LIMITS } from '../lib/uploads.config';
import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import busboy from 'busboy';
import path from 'path';
import * as fs from 'fs';
import type { FileRecord } from '../types';

type ParsedFile = { filename: string; mimeType: string; buffer: Buffer };

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
      limits: { fileSize: FILE_SIZE_LIMITS.GENERAL, files: 1 },
    });

    bb.on('file', (name, stream, info) => {
      if (name !== 'file') { stream.resume(); return; }
      const { filename, mimeType } = info;
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => finish(undefined, { filename: filename || 'unknown', mimeType: mimeType || 'application/octet-stream', buffer: Buffer.concat(chunks) }));
      stream.on('error', (err: unknown) => finish(err instanceof Error ? err : new Error(String(err))));
    });

    bb.on('error', (err: unknown) => finish(err instanceof Error ? err : new Error(String(err))));
    bb.on('close', () => { if (!resolved) finish(new Error('No file uploaded')); });

    if (!req.body) { finish(new Error('No request body')); return; }
    const nodeStream = Readable.fromWeb(req.body as import('stream/web').ReadableStream);
    nodeStream.pipe(bb);
  });
}

@Controller('/files')
export class FileController {
  /**
   * Upload a file.
   */
  @Post('')
  @UseGuards(AuthGuard)
  async upload(req: Request, user: AuthenticatedUser): Promise<Response> {
    let parsed: ParsedFile;
    try {
      parsed = await parseMultipartFile(req);
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : 'Invalid multipart body' }, { status: 400 });
    }

    const { filename, mimeType, buffer } = parsed;
    const validation = validateFileByMetadata(filename, mimeType, buffer.length, 'general');
    if (!validation.isValid) {
      return Response.json({ error: validation.message || 'File validation failed' }, { status: 400 });
    }

    const fileId = uuidv4();
    const ext = path.extname(filename);
    const targetDir = getUploadsPath('files', user.id);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    try {
      fs.writeFileSync(path.join(targetDir, fileId + ext), buffer);
    } catch {
      return Response.json({ error: 'Failed to save file' }, { status: 500 });
    }

    const inserted = await fileService.createFile({ id: fileId, name: filename, size: BigInt(buffer.length), type: mimeType, userId: user.id });

    return Response.json({
      message: 'File uploaded successfully',
      file: this.toRecord(inserted, user.id),
    });
  }

  /**
   * List files for the authenticated user.
   */
  @Get('')
  @UseGuards(AuthGuard)
  async list(req: Request, user: AuthenticatedUser): Promise<Response> {
    const url = new URL(req.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10)));

    const result = await fileService.listFiles(user.id, { page, limit });

    return Response.json({
      files: result.files.map(f => this.toRecord(f, user.id)),
      pagination: result.pagination,
    });
  }

  /**
   * Delete (soft) a file.
   */
  @Delete('/:id')
  @UseGuards(AuthGuard)
  async delete(_req: Request, user: AuthenticatedUser, params: { id: string }): Promise<Response> {
    const deleted = await fileService.softDelete(params.id, user.id);
    if (!deleted) {
      return Response.json({ error: 'File not found' }, { status: 404 });
    }
    return Response.json({ success: true });
  }

  private toRecord(f: { id: string; name: string; size: bigint; type: string; createdAt: Date }, userId: string): FileRecord {
    const ext = path.extname(f.name);
    return {
      id: f.id,
      name: f.name,
      size: f.size.toString(),
      type: f.type,
      createdAt: f.createdAt.toISOString(),
      url: `/uploads/files/${userId}/${f.id}${ext}`,
    };
  }
}
