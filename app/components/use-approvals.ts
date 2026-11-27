import { useCallback, useMemo, useState } from "react";

import type { GalleryPhoto } from "./types";
import { EmailRequiredError } from "./use-visitor";

const JSON_HEADERS = { "Content-Type": "application/json" };

type SendResult = "ok" | "email" | "stale" | "fail";
type ApprovalError = "approvals.error" | "approvals.stale";

/** The version a photo is shown at: its `ver`, or 1 while it has no history. */
export const shownVersion = (photo: Pick<GalleryPhoto, "ver">) =>
  photo.ver ?? 1;

const keyOf = (id: string, ver: number) => `${id}:${ver}`;

/** What the lightbox, the grid and the page need from the approvals of one album. */
export type ApprovalsApi = {
  /** The album lets visitors approve (versioning on). */
  enabled: boolean;
  /** The version this visitor approved, when it is the one the photo shows now; else null. */
  approvedAt: (photo: GalleryPhoto) => number | null;
  toggle: (photo: GalleryPhoto) => Promise<void>;
};

/** POSTs one approval change; the answer is a closed set the caller can act on. */
async function postApproval(
  base: string,
  photoId: string,
  version: number,
  on: boolean,
): Promise<SendResult> {
  try {
    const res = await fetch(`${base}/approvals`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ photoId, version, on }),
    });
    if (res.ok) return "ok";
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    if (res.status === 403 && body?.error === "email_required") return "email";
    return res.status === 409 && body?.error === "stale" ? "stale" : "fail";
  } catch {
    return "fail";
  }
}

/**
 * The visitor's approvals (T6.53f). An approval belongs to one VERSION: a
 * photo counts as approved only at the version it shows now, so a new version
 * re-opens the review. The server's list (`loaded`, from the favorites GET)
 * is the base; the visitor's own toggles sit on top (so a toggle made while
 * the list loads wins), applied at once and really reverted when the server
 * refuses, unless the visitor toggled again meanwhile. `offline` (admin
 * preview) keeps everything in memory.
 */
export function useApprovals({
  slug,
  enabled,
  offline,
  ensure,
  loaded,
  onError,
}: {
  slug: string;
  enabled: boolean;
  offline: boolean;
  ensure: (action: () => void | Promise<void>) => Promise<void>;
  loaded: readonly { id: string; ver: number }[] | null;
  onError: (key: ApprovalError) => void;
}): ApprovalsApi {
  const base = `/api/g/${encodeURIComponent(slug)}`;
  const server = useMemo(
    () => new Set((loaded ?? []).map((a) => keyOf(a.id, a.ver))),
    [loaded],
  );
  const [mine, setMine] = useState<ReadonlyMap<string, boolean>>(new Map());
  const isOn = useCallback(
    (key: string) => mine.get(key) ?? server.has(key),
    [mine, server],
  );

  const approvedAt = useCallback(
    (photo: GalleryPhoto) => {
      const ver = shownVersion(photo);
      return enabled && isOn(keyOf(photo.id, ver)) ? ver : null;
    },
    [enabled, isOn],
  );

  const toggle = useCallback(
    async (photo: GalleryPhoto) => {
      if (!enabled) return;
      const ver = shownVersion(photo);
      const key = keyOf(photo.id, ver);
      const on = !isOn(key);
      const set = (value: boolean, only?: boolean) =>
        setMine((cur) =>
          only !== undefined && cur.get(key) !== only
            ? cur
            : new Map(cur).set(key, value),
        );
      if (offline) return set(on);
      await ensure(async () => {
        set(on);
        const sent = await postApproval(base, photo.id, ver, on);
        if (sent === "ok") return;
        set(!on, on); // revert, unless it was toggled again meanwhile
        if (sent === "email") throw new EmailRequiredError();
        onError(sent === "stale" ? "approvals.stale" : "approvals.error");
      });
    },
    [enabled, isOn, offline, ensure, base, onError],
  );

  return { enabled, approvedAt, toggle };
}
