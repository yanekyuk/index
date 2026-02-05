import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { uploadAvatarToS3 } from '../lib/s3';
import { FILE_SIZE_LIMITS, validateFileTypeByMetadata } from '../lib/uploads.config';

const router = Router();

// ============================================================================
// FILE UPLOAD ROUTES
// ============================================================================
// This router handles direct file upload operations:
// - Avatar uploads for user profiles (to S3)
// ============================================================================

// Use memory storage for avatar uploads (will be uploaded to S3)
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: FILE_SIZE_LIMITS.AVATAR,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Only validate file type here; size is validated by multer limits
    const validation = validateFileTypeByMetadata(
      file.originalname,
      file.mimetype,
      'avatar'
    );
    if (validation.isValid) {
      cb(null, true);
    } else {
      cb(new Error(validation.message || 'Invalid file type'));
    }
  }
});

// Upload avatar endpoint
router.post('/avatar',
  authenticatePrivy,
  avatarUpload.single('avatar'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const extension = path.extname(req.file.originalname).slice(1).toLowerCase() || 'png';
      const avatarUrl = await uploadAvatarToS3(
        req.file.buffer,
        req.user!.id,
        extension,
        req.file.mimetype
      );

      return res.json({ 
        message: 'Avatar uploaded successfully',
        avatarUrl
      });
    } catch (error) {
      console.error('Avatar upload error:', error);
      return res.status(500).json({ error: 'Failed to upload avatar' });
    }
  }
);

export default router;
