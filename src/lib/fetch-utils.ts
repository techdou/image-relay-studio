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
 * 判断是否为超时错误
 */
export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}
