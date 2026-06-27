// rag.ts — HTTP calls to the Go backend RAG endpoints.
// Uses fetch() directly from the renderer (Electron allows localhost fetch).
//
//   POST /api/upload-resume  { "text": "..." }
//   POST /api/upload-jd      { "text": "..." }
//   GET  /api/context-status → { resumeLoaded: bool, jdLoaded: bool }

const BACKEND = "http://localhost:8080";

async function postText(
  path: string,
  text: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(BACKEND + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const json = await res.json();
    return { ok: res.ok, message: json.message ?? json.error ?? "" };
  } catch (err: any) {
    return { ok: false, message: err.message };
  }
}

export async function uploadResume(
  text: string
): Promise<{ ok: boolean; message: string }> {
  return postText("/api/upload-resume", text);
}

export async function uploadJD(
  text: string
): Promise<{ ok: boolean; message: string }> {
  return postText("/api/upload-jd", text);
}

export async function getContextStatus(): Promise<{
  resumeLoaded: boolean;
  jdLoaded: boolean;
}> {
  try {
    const res = await fetch(BACKEND + "/api/context-status");
    return res.json();
  } catch {
    return { resumeLoaded: false, jdLoaded: false };
  }
}
