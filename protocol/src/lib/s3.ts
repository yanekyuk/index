import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

const BUCKET_NAME = process.env.S3_BUCKET;

const s3Client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'auto',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  },
  forcePathStyle: false,
});

/**
 * Generates the storage URL for serving files through the frontend
 * Format: /storage/{key}
 */
function getStorageUrl(key: string): string {
  return `/storage/${key}`;
}

/**
 * Uploads a buffer to S3
 * @param buffer The file buffer
 * @param key The S3 object key (path)
 * @param contentType The MIME type
 * @returns The proxy URL to access the file
 */
export async function uploadBufferToS3(
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<string> {
  if (!BUCKET_NAME) {
    throw new Error('S3_BUCKET is not configured');
  }

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3Client.send(command);
  return getStorageUrl(key);
}

/**
 * Uploads an avatar image to S3
 * @param buffer The image buffer
 * @param userId The user's ID
 * @param extension The file extension (e.g., "png", "jpg")
 * @param contentType The MIME type
 * @returns The proxy URL to access the avatar
 */
export async function uploadAvatarToS3(
  buffer: Buffer,
  userId: string,
  extension: string,
  contentType: string
): Promise<string> {
  const key = `avatars/${userId}/${uuidv4()}.${extension}`;
  return uploadBufferToS3(buffer, key, contentType);
}

/**
 * Uploads a base64 encoded image to S3
 * @param base64Image The base64 string of the image (can include data URI prefix)
 * @param folder The folder path in the bucket (default: 'feedback')
 * @returns The proxy URL to access the image
 */
export async function uploadBase64ImageToS3(
  base64Image: string,
  folder: string = 'feedback'
): Promise<string> {
  if (!BUCKET_NAME) {
    throw new Error('S3_BUCKET is not configured');
  }

  // Remove data URI prefix if present (e.g., "data:image/png;base64,")
  const matches = base64Image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  let buffer: Buffer;
  let contentType = 'image/png'; // Default

  if (matches && matches.length === 3) {
    contentType = matches[1];
    buffer = Buffer.from(matches[2], 'base64');
  } else {
    // Assume raw base64 if no prefix
    buffer = Buffer.from(base64Image, 'base64');
  }

  const extension = contentType.split('/')[1] || 'png';
  const key = `${folder}/${uuidv4()}.${extension}`;

  return uploadBufferToS3(buffer, key, contentType);
}
