import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/storage/database/supabase-client';

export async function POST(request: NextRequest) {
  try {
    const sessionToken = request.headers.get('x-session');
    if (sessionToken) {
      const supabase = getSupabaseServerClient();
      await supabase.auth.admin.signOut(sessionToken);
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: true });
  }
}
