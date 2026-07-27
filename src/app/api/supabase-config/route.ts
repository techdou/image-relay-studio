import { NextResponse } from 'next/server';
import { getSupabaseCredentials } from '@/storage/database/supabase-client';

export async function GET() {
  try {
    const { url, anonKey } = getSupabaseCredentials();
    return NextResponse.json({ url, anonKey });
  } catch {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }
}
