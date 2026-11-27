import { useEffect } from "react";

/**
 * A printed page shows a closed question without its answer. Before printing,
 * every answer is opened; afterwards the ones that were closed close again.
 */
export function useHelpPrint() {
  useEffect(() => {
    let reopened: HTMLDetailsElement[] = [];
    const before = () => {
      reopened = [...document.querySelectorAll("details")].filter(
        (d) => !d.open,
      );
      for (const d of reopened) d.open = true;
    };
    const after = () => {
      for (const d of reopened) d.open = false;
      reopened = [];
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
}
