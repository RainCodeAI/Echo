import { strToU8, zipSync, type Zippable } from "fflate";
import type { ConvexReactClient } from "convex/react";
import { api } from "../../convex/_generated/api";
import { audioPath, buildExportFiles, EXPORT_TABLES, photoPath, type ExportTables } from "./format";

export type ExportProgress = { stage: string; done?: number; total?: number };

/**
 * Builds the owner's export zip in the browser: pages through every table
 * (owner-only query), writes readable CSVs + raw JSON, and optionally
 * downloads each recording and photo into the zip.
 */
export async function buildExportZip(
  client: ConvexReactClient,
  opts: { companyName: string; includeMedia: boolean; onProgress?: (p: ExportProgress) => void; fetchImpl?: typeof fetch },
): Promise<{ blob: Blob; filename: string; mediaFailed: number }> {
  const progress = opts.onProgress ?? (() => {});
  const tables = Object.fromEntries(EXPORT_TABLES.map((t) => [t, []])) as unknown as ExportTables;

  for (const table of EXPORT_TABLES) {
    progress({ stage: `Reading ${table}` });
    let cursor: string | null = null;
    for (;;) {
      const page: { rows: unknown[]; isDone: boolean; continueCursor: string } = await client.query(api.privacy.exportPage, {
        table,
        cursor,
      });
      (tables[table] as unknown[]).push(...page.rows);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
  }

  const exportedAt = Date.now();
  const files = buildExportFiles(tables, { companyName: opts.companyName, exportedAt });
  const zip: Zippable = {};
  for (const [path, text] of Object.entries(files)) zip[path] = strToU8(text);

  let mediaFailed = 0;
  if (opts.includeMedia) {
    const items = [
      ...tables.voiceNotes.filter((n) => n.audioUrl).map((n) => ({ path: audioPath(n), url: String(n.audioUrl) })),
      ...tables.voiceNotePhotos.filter((p) => p.url).map((p) => ({ path: photoPath(p), url: String(p.url) })),
    ];
    const failed: string[] = [];
    const doFetch = opts.fetchImpl ?? fetch;
    let done = 0;
    const queue = [...items];
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        try {
          const res = await doFetch(item.url);
          if (!res.ok) throw new Error(String(res.status));
          // Recordings and photos are already compressed: store them as-is.
          zip[item.path] = [new Uint8Array(await res.arrayBuffer()), { level: 0 }];
        } catch {
          failed.push(`${item.path}\t${item.url}`);
        }
        progress({ stage: "Downloading recordings and photos", done: ++done, total: items.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
    mediaFailed = failed.length;
    if (failed.length) {
      zip["media-errors.txt"] = strToU8(
        `These files couldn't be downloaded; their links are in media-links.csv.\r\n\r\n${failed.join("\r\n")}\r\n`,
      );
    }
  }

  progress({ stage: "Zipping" });
  const bytes = zipSync(zip, { level: 6 });
  const slug = opts.companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
  return {
    blob: new Blob([bytes as BlobPart], { type: "application/zip" }),
    filename: `echo-export-${slug}-${new Date(exportedAt).toISOString().slice(0, 10)}.zip`,
    mediaFailed,
  };
}
