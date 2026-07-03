import "server-only";
import { put } from "@vercel/blob";

// Phase 3 helpers: upload a base64 data URL to Vercel Blob and return the
// public URL. Preserves the original MIME type so downstream consumers get
// correct content-type headers (audio/mpeg, image/jpeg, image/png etc.),
// not application/octet-stream.

export interface ParsedDataUrl {
  mimeType: string;
  buffer: Buffer;
}

export function parseDataUrl(dataUrl: string): ParsedDataUrl | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mimeType = match[1];
  try {
    const buffer = Buffer.from(match[2], "base64");
    return { mimeType, buffer };
  } catch {
    return null;
  }
}

// Guess a file extension from the MIME type so Blob URLs have sensible tails.
// Not authoritative - purely for readability of the Blob URL. Downloaders
// should still trust the Content-Type header.
function extForMime(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m === "image/png") return "png";
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/webp") return "webp";
  if (m === "image/gif") return "gif";
  if (m === "audio/mpeg" || m === "audio/mp3") return "mp3";
  if (m === "audio/mp4" || m === "audio/x-m4a") return "m4a";
  if (m === "audio/wav" || m === "audio/x-wav") return "wav";
  if (m === "audio/ogg") return "ogg";
  if (m === "video/mp4") return "mp4";
  return "bin";
}

// Upload a base64 data URL to Blob. Returns the public URL, or null if the
// data URL was malformed. Uses addRandomSuffix so re-uploads for the same
// pathname produce a fresh URL (prevents accidental overwrites of live URLs
// used by scheduled posts).
//
// pathnamePrefix: something like "top-book/abc123" or "music-track/xyz". The
//   generated URL will be `<prefix>-<random>.<ext>`. Keep the prefix stable
//   per record so orphan cleanup can find candidates.
export async function uploadDataUrlToBlob(
  pathnamePrefix: string,
  dataUrl: string,
): Promise<string | null> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  const ext = extForMime(parsed.mimeType);
  const pathname = `${pathnamePrefix}.${ext}`;
  // addRandomSuffix already prevents accidental overwrites by giving each
  // upload a unique pathname. The `allowOverwrite` flag was added in a later
  // @vercel/blob version and isn't in the one pinned here; not needed with
  // random suffixes anyway.
  const { url } = await put(pathname, parsed.buffer, {
    access: "public",
    contentType: parsed.mimeType,
    addRandomSuffix: true,
  });
  return url;
}

// True if the given string is already a Blob URL (or any http(s) URL) rather
// than a base64 data URL. Used by setters to short-circuit when the caller
// has already uploaded to Blob themselves.
export function isRemoteUrl(s: string | undefined | null): boolean {
  if (!s) return false;
  return s.startsWith("http://") || s.startsWith("https://");
}
