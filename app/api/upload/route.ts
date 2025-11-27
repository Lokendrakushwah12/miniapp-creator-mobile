import { NextRequest, NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';
import { logger } from '../../../lib/logger';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function POST(request: NextRequest) {
  try {
    // Check if Cloudinary is configured
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      logger.error('❌ Cloudinary not configured');
      return NextResponse.json(
        { error: 'Image upload service not configured' },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const type = formData.get('type') as string | null; // 'icon' or 'splash'

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Please upload PNG, JPEG, WebP, or GIF.' },
        { status: 400 }
      );
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 5MB.' },
        { status: 400 }
      );
    }

    // Convert file to base64 for Cloudinary upload
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString('base64');
    const dataUri = `data:${file.type};base64,${base64}`;

    // Upload to Cloudinary with transformations based on type
    const uploadOptions: Record<string, unknown> = {
      folder: 'minidev-apps',
      resource_type: 'image',
    };

    // Apply different transformations based on image type
    if (type === 'icon') {
      // App icons should be square, 512x512
      uploadOptions.transformation = [
        { width: 512, height: 512, crop: 'fill', gravity: 'center' },
        { quality: 'auto', fetch_format: 'auto' }
      ];
    } else if (type === 'splash') {
      // Splash images - maintain aspect ratio, max 1200px width
      uploadOptions.transformation = [
        { width: 1200, crop: 'limit' },
        { quality: 'auto', fetch_format: 'auto' }
      ];
    }

    logger.log(`📤 Uploading ${type || 'image'} to Cloudinary...`);

    const result = await cloudinary.uploader.upload(dataUri, uploadOptions);

    logger.log(`✅ Upload successful: ${result.secure_url}`);

    return NextResponse.json({
      success: true,
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
    });

  } catch (error) {
    logger.error('❌ Upload error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to upload image' },
      { status: 500 }
    );
  }
}



