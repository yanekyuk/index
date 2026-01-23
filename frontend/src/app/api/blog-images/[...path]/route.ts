import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const MIME_TYPES: Record<string, string> = {
  // Images
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: pathSegments } = await params;
  
  if (!pathSegments || pathSegments.length === 0) {
    return NextResponse.json({ error: 'Path required' }, { status: 400 });
  }

  // Build the file path
  const blogDir = path.join(process.cwd(), 'content', 'blog');
  const requestedPath = path.join(blogDir, ...pathSegments);
  
  // Security: ensure the resolved path stays within content/blog
  const resolvedPath = path.resolve(requestedPath);
  if (!resolvedPath.startsWith(path.resolve(blogDir))) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 403 });
  }

  // Check if file exists
  if (!fs.existsSync(resolvedPath)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Get file extension and mime type
  const ext = path.extname(resolvedPath).toLowerCase();
  const mimeType = MIME_TYPES[ext];
  
  if (!mimeType) {
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
  }

  // Read and return the file
  const fileBuffer = fs.readFileSync(resolvedPath);
  
  return new NextResponse(fileBuffer, {
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
