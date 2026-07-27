/**
 * 带超时的 fetch 封装
 * 防止请求挂起导致页面永远卡在"加载中..."
 */

export interface FetchWithTimeoutOptions extends RequestInit {
  /** 超时时间(ms)，默认 15000 */
  timeout?: number;
}

/**
 * 带超时的 fetch，超时后自动 abort 并抛出 TimeoutError
 */
export function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const { timeout = 15000, ...fetchOptions } = options;

  const controller = new AbortController();
  const { signal } = controller;

  // 如果调用方已传入 signal，需要同时监听两个
  const externalSignal = fetchOptions.signal;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => controller.abort());
    }
  }

  const timeoutId = setTimeout(() => {
    controller.abort(new Error('请求超时，请检查网络连接'));
  }, timeout);

  return fetch(url, { ...fetchOptions, signal })
    .finally(() => clearTimeout(timeoutId));
}

/**
 * 带超时 + 自动重试的 fetch
 */
export async function fetchWithRetry(
  url: string,
  options: FetchWithTimeoutOptions = {},
  maxRetries: number = 2,
): Promise<Response> {
  const { timeout = 15000, ...fetchOptions } = options;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, { ...fetchOptions, timeout });
      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Unknown error');
      // 超时才重试，其他错误直接抛出
      if (lastError.name !== 'AbortError' && attempt < maxRetries) {
        // 非 abort 错误（如网络断开），等待一会儿再试
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      if (attempt < maxRetries) continue;
    }
  }

  throw lastError || new Error('Request failed after retries');
}

/**
 * 判断是否为超时错误
 */
export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}
