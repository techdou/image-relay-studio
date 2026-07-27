'use client';

import ReactDOM from 'react-dom';

/**
 * Preconnect to external origins for faster resource loading.
 * Placed in RootLayout to establish connections early.
 *
 * Hosts are configurable via public env vars so deployments don't leak
 * infrastructure hints (e.g. cloud region) into the bundle when unused.
 */
export function ResourcePreconnect() {
  // Supabase API (resolved from NEXT_PUBLIC_SUPABASE_URL at build time)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabaseUrl) {
    try {
      const origin = new URL(supabaseUrl).origin;
      ReactDOM.preconnect(origin);
    } catch {
      // fall through — invalid URL just skips the hint
    }
  }

  // Object storage (S3-compatible). Optional: set NEXT_PUBLIC_STORAGE_HOST
  // to the storage endpoint origin, e.g. https://s3.cn-beijing.amazonaws.com.cn
  const storageHost = process.env.NEXT_PUBLIC_STORAGE_HOST;
  if (storageHost) {
    ReactDOM.preconnect(storageHost);
  }

  // Google Fonts (CN mirror for mainland China users)
  ReactDOM.preconnect('https://fonts.googleapis.cn');
  ReactDOM.preconnect('https://fonts.gstatic.cn');

  return null;
}
