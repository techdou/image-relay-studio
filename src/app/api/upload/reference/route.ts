import { NextRequest } from 'next/server';
import { authenticateRequest, successResponse, errorResponse } from '@/server/api-helpers';
import { AppError, ErrorCodes } from '@/server/errors';

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      throw new AppError(ErrorCodes.INVALID_FILE, '未上传文件');
    }

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      throw new AppError(ErrorCodes.INVALID_FILE, '仅支持 PNG、JPEG 和 WebP 格式');
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      throw new AppError(ErrorCodes.INVALID_FILE, '文件大小不能超过 10MB');
    }

    // Upload to storage
    const { createStorageClient } = await import('@/server/storage');
    const storage = createStorageClient();

    const ext = file.name.split('.').pop() || 'png';
    const objectKey = `users/${auth.userId}/references/${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${ext}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    await storage.upload(objectKey, buffer, file.type);

    // Create reference record
    const { getSupabaseServerClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseServerClient();

    const { data, error } = await supabase
      .from('generation_references')
      .insert({
        task_id: null, // Linked when task is created
        user_id: auth.userId,
        object_key: objectKey,
        original_filename: file.name,
        mime_type: file.type,
        file_size: file.size,
      })
      .select('id, object_key')
      .single();

    if (error) {
      throw new AppError(ErrorCodes.INTERNAL_ERROR, '保存参考图失败');
    }

    return successResponse({
      asset_id: data.id,
      object_key: data.object_key,
    }, auth.requestId, 201);
  } catch (err) {
    return errorResponse(err, '');
  }
}
