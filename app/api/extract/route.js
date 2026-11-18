// POST /api/extract - turns an uploaded PDF or text file into plain text. Nothing is stored.
import { json, allow, requireUser } from "../../../lib/api-helpers.js";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req) {
  const denied = await requireUser(req); // checked here as well as in proxy.js
  if (denied) return denied;
  if (!allow(req, "extract", 80)) return json({ error: "Too many uploads. Try again later." }, 429);
  let file;
  try { file = (await req.formData()).get("file"); } catch { return json({ error: "Upload a file." }, 400); }
  if (!file || typeof file.arrayBuffer !== "function") return json({ error: "Upload a file." }, 400);
  if (file.size > MAX_BYTES) return json({ error: "The file is larger than 4 MB." }, 413);
  const name = String(file.name || "").toLowerCase();
  const buf = new Uint8Array(await file.arrayBuffer());
  const isPdf = name.endsWith(".pdf") || (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46);
  try {
    if (isPdf) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(buf);
      const { text, totalPages } = await extractText(pdf, { mergePages: true });
      const clean = String(text || "").trim();
      if (clean.length < 20) return json({ error: "This PDF has no readable text layer (it may be a scan). Paste the text instead." }, 422);
      return json({ text: clean, pages: totalPages });
    }
    if (name.endsWith(".txt") || name.endsWith(".md") || (file.type || "").startsWith("text/")) {
      return json({ text: new TextDecoder("utf-8").decode(buf).trim() });
    }
    return json({ error: "Upload a PDF or a .txt file, or paste the text." }, 415);
  } catch {
    return json({ error: "Could not read this file. Paste the text instead." }, 422);
  }
}
