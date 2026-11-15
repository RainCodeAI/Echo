/**
 * Materials → order list (pure, tested).
 *
 * Crews mention materials across many notes ("12 bundles of shingles",
 * "another 3 bundles", "a box of 1-1/4 roofing nails"). For a job, this merges
 * those lines into one list to send to the supply house:
 *   - same item + same unit merge, and numeric quantities add up;
 *   - quantities that aren't numbers ("a few") are kept, never guessed;
 *   - every line remembers which notes it came from;
 *   - lines already marked as ordered drop off the "to order" list, but a
 *     later note asking for more of the same item shows up again.
 */

export type MaterialInput = {
  name: string;
  quantity?: string;
  unit?: string;
  notes?: string;
};

export type SourceNote = {
  noteId: string;
  recordedAt: number;
  noteTitle: string;
  crewName: string | null;
  materials: MaterialInput[];
};

export type OrderSource = {
  noteId: string;
  recordedAt: number;
  noteTitle: string;
  crewName: string | null;
  /** The quantity as the note said it ("12", "a few", ""). */
  quantityText: string;
};

export type OrderLine = {
  /** Stable identity: normalized item name + unit. */
  key: string;
  /** Display name (as the crew first said it). */
  name: string;
  /** Normalized unit ("bundle", "ft"), or null. */
  unit: string | null;
  /** Sum of the numeric quantities, or null when none were numbers. */
  total: number | null;
  /** True when any quantity was approximate ("about 10", "10-12"). */
  approximate: boolean;
  /** Quantities that weren't numbers ("a few", "enough for the porch"). */
  other: string[];
  /** Distinct notes from the crew ("charcoal", "match existing"). */
  notes: string[];
  sources: OrderSource[];
  /** "12 bundles", "~3 boxes + a few", "qty not given". */
  quantityLabel: string;
};

const MAX_TEXT = 200;
const clip = (s: string) => s.trim().replace(/\s+/g, " ").slice(0, MAX_TEXT);

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

const UNIT_SYNONYMS: Record<string, string> = {
  ea: "each", each: "each", pc: "each", pcs: "each", piece: "each", pieces: "each", unit: "each", units: "each",
  bdl: "bundle", bdls: "bundle", bundle: "bundle", bundles: "bundle",
  ft: "ft", feet: "ft", foot: "ft", lf: "ft", "'": "ft", "linear ft": "ft", "linear feet": "ft",
  in: "in", inch: "in", inches: "in", '"': "in",
  sq: "square", sqs: "square", square: "square", squares: "square",
  sqft: "sq ft", "sq ft": "sq ft", "square feet": "sq ft", "square foot": "sq ft",
  gal: "gal", gals: "gal", gallon: "gal", gallons: "gal",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  box: "box", boxes: "box", bx: "box",
  bag: "bag", bags: "bag",
  roll: "roll", rolls: "roll",
  sheet: "sheet", sheets: "sheet",
  tube: "tube", tubes: "tube",
  can: "can", cans: "can",
  pail: "pail", pails: "pail", bucket: "bucket", buckets: "bucket",
  yd: "yd", yds: "yd", yard: "yd", yards: "yd", "cu yd": "cu yd", "cubic yards": "cu yd", "cubic yard": "cu yd",
  ton: "ton", tons: "ton",
  pallet: "pallet", pallets: "pallet",
  stick: "stick", sticks: "stick", length: "length", lengths: "length",
  pack: "pack", packs: "pack", pkg: "pack", case: "case", cases: "case",
};

/** "Bundles" → "bundle", "linear feet" → "ft"; unknown units are singularized. */
export function normalizeUnit(unit: string | undefined): string | null {
  if (!unit) return null;
  const u = unit.trim().toLowerCase().replace(/\.$/, "").replace(/\s+/g, " ");
  if (!u) return null;
  if (UNIT_SYNONYMS[u]) return UNIT_SYNONYMS[u];
  return singular(u);
}

function singular(word: string): string {
  if (/(ss|us|is)$/.test(word) || word.length <= 3) return word;
  if (/ies$/.test(word)) return word.slice(0, -3) + "y";
  if (/(ches|shes|xes|sses)$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

/**
 * Identity of an item for merging: lowercase, punctuation-light, last word
 * singular. "Architectural Shingles" == "architectural shingle".
 */
export function normalizeName(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9/.\-" ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length === 0) return "";
  words[words.length - 1] = singular(words[words.length - 1]);
  return words.join(" ");
}

export function lineKey(name: string, unit: string | null): string {
  return `${normalizeName(name)}|${unit ?? ""}`;
}

// ---------------------------------------------------------------------------
// Quantities
// ---------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, dozen: 12, half: 0.5, single: 1, pair: 2,
};

export type ParsedQuantity = {
  value: number | null;
  approximate: boolean;
  /** Text after the number, e.g. "bundles" in "12 bundles". */
  rest: string;
};

function parseNumberToken(t: string): number | null {
  // 2-1/2, 2 1/2 (joined by caller), 1/2, 1,200, 12.5
  let m = t.match(/^(\d+)[- ](\d+)\/(\d+)$/);
  if (m) return Number(m[3]) === 0 ? null : Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = t.match(/^(\d+)\/(\d+)$/);
  if (m) return Number(m[2]) === 0 ? null : Number(m[1]) / Number(m[2]);
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ""));
  if (/^\d+(\.\d+)?$/.test(t) || /^\.\d+$/.test(t)) return Number(t);
  return null;
}

/**
 * "12" → 12; "about 10" → ~10; "10-12" → ~12 (order the upper end);
 * "2 1/2" → 2.5; "a dozen" → 12; "a few" → null (kept as text).
 */
export function parseQuantity(text: string | undefined): ParsedQuantity {
  let s = (text ?? "").trim().toLowerCase();
  if (!s) return { value: null, approximate: false, rest: "" };
  let approximate = false;
  const approx = s.match(/^(about|approx\.?|approximately|around|roughly|maybe|~|\+\/-|at least)\s*/);
  if (approx) {
    approximate = true;
    s = s.slice(approx[0].length);
  }
  if (/\+$/.test(s.split(" ")[0] ?? "")) approximate = true; // "10+ bundles"

  // Mixed fraction with a space: "2 1/2 ..."
  let m = s.match(/^(\d+) (\d+\/\d+)\b\s*(.*)$/);
  if (m) {
    const v = parseNumberToken(`${m[1]} ${m[2]}`);
    if (v !== null) return { value: v, approximate, rest: m[3] };
  }
  // Range: "10-12", "10 to 12", "10 or 12" (but not "2-1/2")
  m = s.match(/^(\d+(?:\.\d+)?)\s*(?:-|–|to|or)\s*(\d+(?:\.\d+)?)(?!\/)\b\+?\s*(.*)$/);
  if (m && Number(m[2]) >= Number(m[1])) {
    return { value: Number(m[2]), approximate: true, rest: m[3] };
  }
  m = s.match(/^([\d.,/-]+)\+?\s*(.*)$/);
  if (m) {
    const v = parseNumberToken(m[1]);
    if (v !== null) return { value: v, approximate, rest: m[2] };
  }
  // Words: "a dozen", "two", "half a", "a couple" (not numeric)
  const words = s.split(" ");
  if (words[0] === "a" && words[1] === "dozen") return { value: 12, approximate, rest: words.slice(2).join(" ") };
  if (words[0] === "half" && (words[1] === "a" || words[1] === "an")) {
    return { value: 0.5, approximate, rest: words.slice(2).join(" ") };
  }
  if (words[0] in NUMBER_WORDS && !["couple", "few", "lot", "bunch"].includes(words[1] ?? "")) {
    // "a" alone only counts as 1 when followed by a unit-ish word ("a box").
    if ((words[0] === "a" || words[0] === "an") && words.length < 2) return { value: null, approximate, rest: s };
    return { value: NUMBER_WORDS[words[0]], approximate, rest: words.slice(1).join(" ") };
  }
  return { value: null, approximate, rest: s };
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 100) / 100);
}

const NO_PLURAL = new Set(["ft", "in", "sq ft", "gal", "lb", "each", "yd", "cu yd"]);
function pluralUnit(unit: string, n: number): string {
  if (n === 1 || NO_PLURAL.has(unit)) return unit;
  if (/(s|x|ch|sh)$/.test(unit)) return unit + "es";
  if (/[^aeiou]y$/.test(unit)) return unit.slice(0, -1) + "ies";
  return unit + "s";
}

export function quantityLabel(line: Pick<OrderLine, "total" | "unit" | "approximate" | "other">): string {
  const parts: string[] = [];
  if (line.total !== null) {
    const n = `${line.approximate ? "~" : ""}${formatNumber(line.total)}`;
    parts.push(line.unit ? `${n} ${pluralUnit(line.unit, line.total)}` : n);
  }
  if (line.other.length) parts.push(line.other.join(", "));
  if (!parts.length) return line.unit ? `qty not given (${line.unit})` : "qty not given";
  return parts.join(" + ");
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** Identity of one material line within one note (what an order "covers"). */
export function sourceKey(noteId: string, key: string): string {
  return `${noteId}#${key}`;
}

/**
 * Merge materials from a job's notes into order lines.
 * `covered` holds sourceKeys already ordered; those lines are split out.
 */
export function buildOrderList(
  notes: SourceNote[],
  covered: ReadonlySet<string> = new Set(),
): { toOrder: OrderLine[]; ordered: OrderLine[] } {
  const toOrder = new Map<string, OrderLine>();
  const ordered = new Map<string, OrderLine>();
  const sorted = [...notes].sort((a, b) => a.recordedAt - b.recordedAt);

  for (const note of sorted) {
    for (const m of note.materials) {
      const rawName = clip(m.name ?? "");
      if (!rawName) continue;
      const q = parseQuantity(m.quantity);
      // "12 bundles" with no unit field: take the unit from the quantity text.
      const unit = normalizeUnit(m.unit) ?? (q.value !== null && q.rest ? normalizeUnit(q.rest) : null);
      const key = lineKey(rawName, unit);
      if (!normalizeName(rawName)) continue;
      const target = covered.has(sourceKey(note.noteId, key)) ? ordered : toOrder;
      let line = target.get(key);
      if (!line) {
        line = {
          key,
          name: rawName.charAt(0).toUpperCase() + rawName.slice(1),
          unit,
          total: null,
          approximate: false,
          other: [],
          notes: [],
          sources: [],
          quantityLabel: "",
        };
        target.set(key, line);
      }
      if (q.value !== null) {
        line.total = (line.total ?? 0) + q.value;
        line.approximate ||= q.approximate;
      } else if (m.quantity?.trim()) {
        const t = clip(m.quantity);
        if (!line.other.includes(t)) line.other.push(t);
      }
      const n = m.notes ? clip(m.notes) : "";
      if (n && !line.notes.some((x) => x.toLowerCase() === n.toLowerCase())) line.notes.push(n);
      line.sources.push({
        noteId: note.noteId,
        recordedAt: note.recordedAt,
        noteTitle: note.noteTitle,
        crewName: note.crewName,
        quantityText: clip(m.quantity ?? ""),
      });
    }
  }

  const finish = (m: Map<string, OrderLine>) =>
    [...m.values()]
      .map((l) => ({ ...l, quantityLabel: quantityLabel(l) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  return { toOrder: finish(toOrder), ordered: finish(ordered) };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type OrderHeader = {
  jobTitle: string;
  address?: string | null;
  companyName?: string | null;
  /** Already-formatted date, e.g. "Nov 15, 2026". */
  date: string;
};

/** Plain text for a text message / email to the supply house. */
export function formatOrderText(header: OrderHeader, lines: OrderLine[]): string {
  const out = [`Materials order: ${header.jobTitle}`];
  if (header.address) out.push(`Site: ${header.address}`);
  out.push(`${header.companyName ? `From ${header.companyName} · ` : ""}${header.date}`);
  out.push("");
  for (const l of lines) {
    const extra = l.notes.length ? ` (${l.notes.join("; ")})` : "";
    out.push(`- ${l.name}: ${l.quantityLabel}${extra}`);
  }
  return out.join("\n");
}

/** Cells starting with these could run as formulas in Excel/Sheets. */
function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function formatOrderCsv(lines: OrderLine[]): string {
  const rows: (string | number)[][] = [["Item", "Quantity", "Unit", "Other quantities", "Notes", "From notes"]];
  for (const l of lines) {
    rows.push([
      l.name,
      l.total === null ? "" : `${l.approximate ? "~" : ""}${formatNumber(l.total)}`,
      l.unit ?? "",
      l.other.join("; "),
      l.notes.join("; "),
      l.sources.length,
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
