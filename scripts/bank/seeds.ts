// Seed title files (data/bank/ielts/seeds/*.txt): the only input taken from
// outside sources, titles only (SPEC 9).

import { NCLEX_AREAS, type NclexArea } from "../../src/exams/bank";

export type SeedItem =
  | { kind: "part1"; id: string; title: string; opening: boolean }
  | { kind: "part2"; id: string; title: string; health: boolean; area: NclexArea | "none" };

export interface SeedFile {
  season: string;
  ends: string | null;
  /** Output file name without extension: "evergreen" or "season-2026-09". */
  output: string;
  items: SeedItem[];
}

const ARTICLES = /^(a|an|the)\s+/i;

/** Kebab-case id part, at most 40 characters, cut on a word boundary. */
export function slug(title: string): string {
  const words = title
    .replace(ARTICLES, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean);
  let out = "";
  for (const w of words) {
    const next = out ? `${out}-${w}` : w;
    if (next.length > 40) break;
    out = next;
  }
  return out;
}

export function parseSeeds(text: string, fileLabel = "seeds"): SeedFile {
  let season = "";
  let ends: string | null = null;
  let section = "";
  const items: SeedItem[] = [];
  const problems: string[] = [];

  text.split(/\r?\n/).forEach((raw, n) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const sec = /^\[([a-z0-9-]+)\]$/.exec(line);
    if (sec) {
      section = sec[1] ?? "";
      return;
    }
    const header = /^(season|ends)\s*:\s*(.+)$/.exec(line);
    if (header && !section) {
      if (header[1] === "season") season = header[2]!.trim();
      else ends = header[2]!.trim();
      return;
    }
    const [title = "", extra] = line.split("|").map((s) => s.trim());
    switch (section) {
      case "part1-opening":
        items.push({ kind: "part1", id: `p1-${extra ? slug(extra) : slug(title)}`, title, opening: true });
        break;
      case "part1":
        items.push({ kind: "part1", id: `p1-${slug(title)}`, title, opening: false });
        break;
      case "part2":
        items.push({ kind: "part2", id: `p2-${slug(title)}`, title, health: false, area: "none" });
        break;
      case "health": {
        const area = NCLEX_AREAS.find((a) => a.toLowerCase() === (extra ?? "").toLowerCase());
        if (!area) problems.push(`${fileLabel}:${n + 1}: unknown NCLEX area "${extra ?? ""}"`);
        items.push({ kind: "part2", id: `p2-${slug(title)}`, title, health: true, area: area ?? "none" });
        break;
      }
      default:
        problems.push(`${fileLabel}:${n + 1}: line outside a known section`);
    }
  });

  if (!season) problems.push(`${fileLabel}: missing "season:" header`);
  if (season !== "evergreen" && !ends) problems.push(`${fileLabel}: missing "ends:" header`);
  const ids = new Set<string>();
  for (const it of items) {
    if (ids.has(it.id)) problems.push(`${fileLabel}: duplicate id ${it.id}`);
    ids.add(it.id);
  }
  if (problems.length) throw new Error(problems.join("\n"));
  return { season, ends, output: season === "evergreen" ? "evergreen" : `season-${season}`, items };
}

/** "p2-noisy-place-you-have-been" -> "p3-noisy-place-you-have-been" */
export function part3IdFor(cardId: string): string {
  return cardId.replace(/^p2-/, "p3-");
}
