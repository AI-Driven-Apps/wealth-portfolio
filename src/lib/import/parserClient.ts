import "server-only";
import { config } from "@/lib/config";

/** Send a PDF to the internal Python parser. The file is never written to disk on either side. */
export async function callParser(path: "/cas" | "/contract-note", file: File, password: string): Promise<unknown> {
  if (!config.pdfImportsEnabled) throw new Error(config.isVercel ? "PDF imports need PARSER_URL (an https parser service) and PARSER_SECRET on this deployment. Use the spreadsheet, tradebook and deposit imports meanwhile." : "PDF imports are switched off on this deployment.");
  const fd = new FormData();
  fd.append("file", file, file.name);
  fd.append("password", password);
  let res: Response;
  try {
    res = await fetch(`${config.parserUrl}${path}`, {
      method: "POST", body: fd, cache: "no-store", signal: AbortSignal.timeout(120_000),
      headers: process.env.PARSER_SECRET ? { "x-parser-secret": process.env.PARSER_SECRET } : {},
    });
  } catch {
    throw new Error("The PDF parser service isn't reachable. On the Pi, check the cas-parser container is running.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { detail?: string }).detail ?? `Parser error (HTTP ${res.status})`);
  return body;
}
