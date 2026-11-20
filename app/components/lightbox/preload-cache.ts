import type { GalleryPhoto, ImgUrlFn } from "../types";
import { photoImgProps } from "./srcset";

/** Decoded photos kept alive so the browser keeps them in its memory cache. */
export const PRELOAD_CAPACITY = 6;
const AHEAD = 2;

type Entry = { img: HTMLImageElement; key: string; ready: boolean };

/** Indexes to warm, most urgent first: next in travel, the one behind, then further ahead. */
export function preloadOrder(
  index: number,
  total: number,
  dir: 1 | -1,
): number[] {
  const order = [index + dir, index - dir];
  for (let k = 2; k <= AHEAD; k++) order.push(index + dir * k);
  return order.filter((i) => i >= 0 && i < total);
}

/**
 * Small LRU of preloaded `Image`s. A photo inside the wanted window is never
 * cancelled; only entries that fell out of it and exceed the capacity are, and
 * only when still in flight.
 */
/** Only versioned URLs are cacheable; unversioned (admin) ones are no-store. */
const isCacheable = (url: string) => /[?&]v=/.test(url);

const keyOf = (imgUrl: ImgUrlFn, photo: GalleryPhoto) =>
  photoImgProps(imgUrl, photo).src;

export class PreloadCache {
  private entries = new Map<string, Entry>();

  /** True when this photo (at this exact URL) finished loading. */
  isReady(imgUrl: ImgUrlFn, photo: GalleryPhoto): boolean {
    const e = this.entries.get(photo.id);
    return (
      !!e && e.ready && e.key === keyOf(imgUrl, photo) && isCacheable(e.key)
    );
  }

  warm(imgUrl: ImgUrlFn, wanted: readonly GalleryPhoto[]) {
    // A changed key replaces its entry, so only unknown ids take new room.
    const incoming = wanted.filter((p) => !this.entries.has(p.id)).length;
    this.evict(new Set(wanted.map((p) => p.id)), incoming);
    for (const p of wanted) {
      const props = photoImgProps(imgUrl, p);
      const old = this.entries.get(p.id);
      if (old && old.key === props.src) {
        // Touch: most recently used goes last.
        this.entries.delete(p.id);
        this.entries.set(p.id, old);
        continue;
      }
      if (old) this.release(old);
      this.entries.set(p.id, this.start(p.id, props));
    }
  }

  dispose() {
    for (const e of this.entries.values()) this.release(e);
    this.entries.clear();
  }

  /** Drop least recently used entries outside the window to make room. */
  private evict(keep: Set<string>, incoming: number) {
    for (const [id, e] of this.entries) {
      if (this.entries.size + incoming <= PRELOAD_CAPACITY) break;
      if (keep.has(id)) continue;
      this.release(e);
      this.entries.delete(id);
    }
  }

  private start(id: string, props: ReturnType<typeof photoImgProps>): Entry {
    const img = new Image();
    const entry: Entry = { img, key: props.src, ready: false };
    img.onload = () => {
      entry.ready = true;
    };
    img.onerror = () => {
      // A failed preload must not stay: the stage should retry it itself.
      if (this.entries.get(id) === entry) this.entries.delete(id);
    };
    img.sizes = props.sizes;
    img.srcset = props.srcSet;
    img.src = props.src;
    // Decode off the main thread now so the swap does not stall.
    img.decode?.().catch(() => {});
    return entry;
  }

  private release(e: Entry) {
    if (e.ready) return;
    e.img.onload = null;
    e.img.onerror = null;
    e.img.removeAttribute?.("srcset");
    e.img.src = "";
  }
}
