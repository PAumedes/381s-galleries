/** Real layout visibility (display:none on the node or an ancestor). */
const isRendered = (el: HTMLElement, root: HTMLElement) => {
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (n === root) break;
  }
  return true;
};

const FOCUSABLE =
  "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

/**
 * Keep Tab inside the dialog: wrap at either end of the rendered controls
 * and pull focus back in when it escaped. Anything else is left to the
 * browser.
 */
export function trapTab(e: KeyboardEvent, root: HTMLElement | null) {
  const nodes = Array.from(
    root?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
  ).filter((n) => root && isRendered(n, root));
  if (nodes.length === 0) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const active = document.activeElement;
  if (!root?.contains(active)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}
