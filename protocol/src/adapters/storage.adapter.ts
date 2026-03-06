import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

interface S3StorageConfig {
  endpoint?: string;
  region?: string;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  bucket: string;
  baseUrl?: string;
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/vnd.microsoft.icon': 'ico',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
};

function mimeToExtension(contentType: string): string {
  return MIME_EXTENSIONS[contentType] ?? contentType.split('/')[1] ?? 'png';
}

/**
 * S3-compatible storage adapter.
 * Structurally aligns with the protocol Storage interface.
 */
export class S3StorageAdapter {
  private client: S3Client;
  private bucket: string;
  private baseUrl: string;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    const region = config.region || 'us-east-1';
    this.baseUrl = config.baseUrl ?? `https://${config.bucket}.s3.${region}.amazonaws.com`;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region || 'auto',
      credentials: config.credentials,
      forcePathStyle: false,
    });
  }

  /**
   * Generate the storage URL for a given key.
   */
  getUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }

  /**
   * Upload a buffer to S3.
   * @returns The URL to access the uploaded file
   */
  async uploadBuffer(buffer: Buffer, key: string, contentType: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });
    await this.client.send(command);
    return this.getUrl(key);
  }

  /**
   * Upload an avatar image to S3.
   * @returns The URL to access the avatar
   */
  async uploadAvatar(
    buffer: Buffer,
    userId: string,
    extension: string,
    contentType: string,
  ): Promise<string> {
    const key = `avatars/${userId}/${uuidv4()}.${extension}`;
    return this.uploadBuffer(buffer, key, contentType);
  }

  /**
   * Upload an index (network) image to S3.
   * @returns The URL to access the image
   */
  async uploadIndexImage(
    buffer: Buffer,
    userId: string,
    extension: string,
    contentType: string,
  ): Promise<string> {
    const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '');
    const safeExtension = extension.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!safeExtension) {
      throw new Error('Invalid file extension');
    }
    const key = `index-images/${safeUserId}/${uuidv4()}.${safeExtension}`;
    return this.uploadBuffer(buffer, key, contentType);
  }

  /**
   * Upload a base64-encoded image to S3.
   * @returns The URL to access the image
   */
  async uploadBase64Image(base64Image: string, folder: string = 'feedback'): Promise<string> {
    const matches = base64Image.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    let buffer: Buffer;
    let contentType = 'image/png';

    if (matches && matches.length === 3) {
      contentType = matches[1];
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      buffer = Buffer.from(base64Image, 'base64');
    }

    const extension = mimeToExtension(contentType);
    const key = `${folder}/${uuidv4()}.${extension}`;
    return this.uploadBuffer(buffer, key, contentType);
  }
}
