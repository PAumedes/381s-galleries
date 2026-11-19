import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

const IDLE_MS = 2500;

/**
 * Auto-hide controls on pointer devices: visible again on mouse move or
 * keyboard focus; touch never hides them.
 */
export function useIdleChrome(dialogRef: RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(true);
  const lastKeyAt = useRef(0);
  const kbFocus = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => () => clearTimeout(idleTimer.current), []);
  const arm = () => {
    setVisible(true);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(function hide() {
      if (
        kbFocus.current &&
        dialogRef.current?.contains(document.activeElement)
      ) {
        idleTimer.current = setTimeout(hide, IDLE_MS);
        return;
      }
      // Focus must not linger on an invisible control; park it on the dialog.
      if (dialogRef.current?.contains(document.activeElement)) {
        dialogRef.current.focus();
      }
      setVisible(false);
    }, IDLE_MS);
  };
  const wake = (e: ReactPointerEvent) => {
    if (e.pointerType !== "mouse") return;
    kbFocus.current = false;
    arm();
  };
  const onKeyWake = () => {
    lastKeyAt.current = Date.now();
    kbFocus.current = true;
    arm();
  };
  // Focus only counts as keyboard focus right after a key press, so the
  // programmatic focus on mount or a tap doesn't pin the controls visible.
  const onFocusWake = () => {
    // Hidden controls are pointer-events:none, so focus landing while hidden
    // can only come from the keyboard.
    if (!visible || Date.now() - lastKeyAt.current < 1000) {
      kbFocus.current = true;
      arm();
    }
  };
  return { visible, wake, onKeyWake, onFocusWake };
}
