/**
 * Backend Uploads Implementation
 *
 * File content loading utilities using Unstructured API with text fallback.
 */

import * as fs from 'fs';
import * as path from 'path';
import { UnstructuredClient } from 'unstructured-client';
import { Strategy } from 'unstructured-client/sdk/models/shared';
import { NodeHtmlMarkdown } from 'node-html-markdown';

import { log } from './log';
import {
  FILE_SIZE_LIMITS,
  isFileExtensionSupported,
  FALLBACK_TEXT_EXTENSIONS,
} from './uploads.config';

const logger = log.lib.from('uploads');

// ----- Unstructured Processing -----
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

export function isFileSupported(filePath: string): boolean {
  return isFileExtensionSupported(filePath, 'general');
}

export async function loadFileContent(filePath: string): Promise<{ content: string | null; error: string | null }> {
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

export async function loadFilesInParallel(filePaths: string[]): Promise<Array<{ filePath: string; content: string | null; error: string | null }>> {
  const promises = filePaths.map(async (filePath) => {
    const result = await loadFileContent(filePath);
    return { filePath, ...result };
  });
  return Promise.all(promises);
}
