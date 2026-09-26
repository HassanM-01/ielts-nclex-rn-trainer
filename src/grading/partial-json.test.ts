import { describe, expect, it } from "vitest";
import { parsePartialJson } from "./partial-json";

const FULL = JSON.stringify({
  fluency_coherence: { evidence: ["I work in a \"busy\" hospital"], band: 6, advice_es: "Usa conectores." },
  lexical_resource: { evidence: ["patients"], band: 7, advice_es: "Más variedad." },
  grammatical_range: { evidence: [], band: 5, advice_es: "Tiempos pasados." },
});

describe("parsePartialJson", () => {
  it("parses complete JSON exactly", () => {
    const r = parsePartialJson(FULL);
    expect(r.complete).toBe(true);
    expect(r.value).toEqual(JSON.parse(FULL));
    expect(r.closedKeys).toEqual(["fluency_coherence", "lexical_resource", "grammatical_range"]);
  });

  it("never throws and never reports a member closed before it is, at any cut", () => {
    for (let n = 0; n < FULL.length; n++) {
      const r = parsePartialJson(FULL.slice(0, n));
      expect(r.complete).toBe(false);
      for (const k of r.closedKeys) {
        // A closed member must equal its final value.
        expect((r.value as Record<string, unknown>)[k]).toEqual((JSON.parse(FULL) as Record<string, unknown>)[k]);
      }
    }
  });

  it("closes a criterion as soon as its object ends", () => {
    const cut = FULL.indexOf(',"lexical_resource"');
    expect(parsePartialJson(FULL.slice(0, cut - 1)).closedKeys).toEqual([]);
    expect(parsePartialJson(FULL.slice(0, cut)).closedKeys).toEqual(["fluency_coherence"]);
  });

  it("returns unfinished strings and arrays as they stand", () => {
    const r = parsePartialJson('{"a": {"evidence": ["one", "tw');
    expect(r.value).toEqual({ a: { evidence: ["one", "tw"] } });
    expect(r.closedKeys).toEqual([]);
  });

  it("doesn't take a number at the very end as final", () => {
    expect(parsePartialJson('{"band": 7').value).toEqual({});
    expect(parsePartialJson('{"band": 7,').value).toEqual({ band: 7 });
    expect(parsePartialJson('{"ok": tr').value).toEqual({});
  });

  it("handles escapes, including a cut in the middle of one", () => {
    expect(parsePartialJson('{"s": "a\\nb\\u00e9"}').value).toEqual({ s: "a\nbé" });
    expect(parsePartialJson('{"s": "a\\').value).toEqual({ s: "a" });
    expect(parsePartialJson('{"s": "a\\u00').value).toEqual({ s: "a" });
  });

  it("gives up quietly on text that isn't JSON", () => {
    expect(parsePartialJson("oops").value).toBeUndefined();
    expect(parsePartialJson("").complete).toBe(false);
  });
});
