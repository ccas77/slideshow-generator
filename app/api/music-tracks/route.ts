import { NextRequest, NextResponse } from "next/server";
import { getMusicTracks, getMusicTrack, setMusicTrack, deleteMusicTrack, MusicTrack, redis } from "@/lib/kv";

function checkAuth(req: NextRequest) {
  const url = new URL(req.url);
  const pw = url.searchParams.get("password") || req.headers.get("x-password");
  if (process.env.APP_PASSWORD && pw !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// Temp key for chunked uploads
function chunkKey(id: string) {
  return `music-upload:${id}`;
}

export async function GET(req: NextRequest) {
  const err = checkAuth(req);
  if (err) return err;

  // If ?id=xxx, return the full track (with audioData) for preview
  const url = new URL(req.url);
  const trackId = url.searchParams.get("id");
  if (trackId) {
    const track = await getMusicTrack(trackId);
    if (!track) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Return raw audio as binary for <audio> src
    const b64 = track.audioData.includes(",") ? track.audioData.split(",")[1] : track.audioData;
    const buf = Buffer.from(b64, "base64");
    const mime = track.audioData.startsWith("data:") ? track.audioData.split(";")[0].split(":")[1] : "audio/mpeg";
    return new Response(buf, { headers: { "Content-Type": mime, "Content-Length": String(buf.length) } });
  }

  const tracks = await getMusicTracks();
  return NextResponse.json({
    tracks: tracks.map((t) => ({ id: t.id, name: t.name })),
  });
}

export async function POST(req: NextRequest) {
  const err = checkAuth(req);
  if (err) return err;

  const body = await req.json();
  const { action, id, name, audioData, chunked, chunkIndex, totalChunks } = body;

  if (action === "delete" && id) {
    await deleteMusicTrack(id);
    return NextResponse.json({ ok: true });
  }

  // Chunked upload
  if (chunked) {
    if (chunkIndex === 0) {
      // First chunk: create track ID, store partial data
      const trackId = id || uid();
      await redis.set(chunkKey(trackId), { name, data: audioData, received: 1, total: totalChunks }, { ex: 600 });
      return NextResponse.json({ ok: true, id: trackId });
    } else {
      // Subsequent chunk: append data
      if (!id) return NextResponse.json({ error: "id required for chunk > 0" }, { status: 400 });
      const partial = await redis.get<{ name: string; data: string; received: number; total: number }>(chunkKey(id));
      if (!partial) return NextResponse.json({ error: "upload session expired" }, { status: 400 });

      const updated = {
        ...partial,
        data: partial.data + audioData,
        received: partial.received + 1,
      };

      if (updated.received >= updated.total) {
        // All chunks received — save the full track
        const track: MusicTrack = { id, name: updated.name, audioData: updated.data };
        await setMusicTrack(track);
        await redis.del(chunkKey(id));
        return NextResponse.json({ ok: true, id, complete: true });
      } else {
        await redis.set(chunkKey(id), updated, { ex: 600 });
        return NextResponse.json({ ok: true, id, received: updated.received });
      }
    }
  }

  // Non-chunked (small files)
  if (!name || !audioData) {
    return NextResponse.json({ error: "name and audioData required" }, { status: 400 });
  }

  const track: MusicTrack = { id: id || uid(), name, audioData };
  await setMusicTrack(track);
  return NextResponse.json({ ok: true, id: track.id });
}
