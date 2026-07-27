'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface UsePageDataOptions<T> {
  /** 数据获取函数 */
  fetcher: () => Promise<T>;
  /** 依赖项变化时重新获取 */
  deps: unknown[];
  /** 初始数据 */
  initialData?: T | null;
}

interface UsePageDataResult<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * 统一的页面数据加载 Hook
 * - 自动管理 loading/error/data 状态
 * - 提供 refetch 用于重试
 * - 依赖项变化自动重新获取
 */
export function usePageData<T>({
  fetcher,
  deps,
  initialData = null,
}: UsePageDataOptions<T>): UsePageDataResult<T> {
  const [data, setData] = useState<T | null>(initialData);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      if (mountedRef.current) {
        setData(result);
      }
    } catch (err) {
      if (mountedRef.current) {
        const message = err instanceof Error ? err.message : '加载失败';
        setError(message);
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher, fetchKey, ...deps]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchData]);

  const refetch = useCallback(() => {
    setFetchKey((k) => k + 1);
  }, []);

  return { data, isLoading, error, refetch };
}
