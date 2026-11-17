/** WhatsApp "share text" link. Plain link: no scripts, no SDK. */
export function whatsappHref(message: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${message} ${url}`)}`;
}

export function canNativeShare(): boolean {
  return (
    typeof navigator !== "undefined" && typeof navigator.share === "function"
  );
}

/**
 * Native share sheet. Resolves "shared" on success, "cancelled" when the user
 * dismissed it (AbortError), "failed" on any other error or when unsupported.
 */
export async function nativeShare(data: {
  title: string;
  text: string;
  url: string;
}): Promise<"shared" | "cancelled" | "failed"> {
  if (!canNativeShare()) return "failed";
  try {
    await navigator.share(data);
    return "shared";
  } catch (e) {
    return (e as { name?: string } | null)?.name === "AbortError"
      ? "cancelled"
      : "failed";
  }
}
