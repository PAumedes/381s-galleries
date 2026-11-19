import { useCallback, useEffect, useRef } from "react";

type NavInput = {
  index: number;
  total: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
};

/**
 * Previous/next/close that stay stable across renders yet always call the
 * latest props, so listeners are not re-bound on every navigation.
 */
export function useLightboxNav({
  index,
  total,
  onClose,
  onIndexChange,
}: NavInput) {
  const hasPrev = index > 0;
  const hasNext = index < total - 1;

  // Keep the latest handlers reachable from stable listeners.
  const latest = useRef({ index, hasPrev, hasNext, onClose, onIndexChange });
  useEffect(() => {
    latest.current = { index, hasPrev, hasNext, onClose, onIndexChange };
  });

  const prev = useCallback(() => {
    const l = latest.current;
    if (l.hasPrev) l.onIndexChange(l.index - 1);
  }, []);
  const next = useCallback(() => {
    const l = latest.current;
    if (l.hasNext) l.onIndexChange(l.index + 1);
  }, []);
  const close = useCallback(() => latest.current.onClose(), []);
  return { hasPrev, hasNext, prev, next, close };
}
