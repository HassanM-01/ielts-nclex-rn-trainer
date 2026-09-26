// A small, forgiving JSON parser for a stream that is still arriving (SPEC
// 11: "parse the stream with a partial-JSON parser and render each criterion
// as soon as its object closes"). Pure.
//
// It parses as far as the text goes. Unfinished strings, arrays and objects
// come back with what they hold so far, and the root object reports which of
// its members are complete, so the screen can show a section only once it
// has closed.

export interface PartialResult {
  /** The value so far (undefined if nothing parseable yet). */
  value: unknown;
  /** The whole text is one complete JSON value. */
  complete: boolean;
  /** Root object members whose values are complete, in order. */
  closedKeys: string[];
}

class Parser {
  i = 0;
  closedKeys: string[] = [];
  constructor(readonly s: string) {}

  get eof(): boolean {
    return this.i >= this.s.length;
  }

  ws(): void {
    while (!this.eof && " \t\n\r".includes(this.s[this.i]!)) this.i++;
  }

  /** Returns [value, complete]. */
  value(depth: number): [unknown, boolean] {
    this.ws();
    if (this.eof) return [undefined, false];
    const c = this.s[this.i]!;
    if (c === "{") return this.object(depth);
    if (c === "[") return this.array(depth);
    if (c === '"') return this.string();
    return this.literal();
  }

  object(depth: number): [Record<string, unknown>, boolean] {
    const out: Record<string, unknown> = {};
    this.i++; // {
    for (;;) {
      this.ws();
      if (this.eof) return [out, false];
      if (this.s[this.i] === "}") {
        this.i++;
        return [out, true];
      }
      if (this.s[this.i] === ",") {
        this.i++;
        continue;
      }
      if (this.s[this.i] !== '"') throw new SyntaxError(`unexpected ${this.s[this.i]} at ${this.i}`);
      const [key, keyDone] = this.string();
      if (!keyDone) return [out, false];
      this.ws();
      if (this.eof) return [out, false];
      if (this.s[this.i] !== ":") throw new SyntaxError(`expected : at ${this.i}`);
      this.i++;
      const [v, done] = this.value(depth + 1);
      if (v !== undefined) out[key] = v;
      if (!done) return [out, false];
      if (depth === 0) this.closedKeys.push(key);
    }
  }

  array(depth: number): [unknown[], boolean] {
    const out: unknown[] = [];
    this.i++; // [
    for (;;) {
      this.ws();
      if (this.eof) return [out, false];
      if (this.s[this.i] === "]") {
        this.i++;
        return [out, true];
      }
      if (this.s[this.i] === ",") {
        this.i++;
        continue;
      }
      const [v, done] = this.value(depth + 1);
      if (v !== undefined) out.push(v);
      if (!done) return [out, false];
    }
  }

  string(): [string, boolean] {
    this.i++; // "
    let out = "";
    while (!this.eof) {
      const c = this.s[this.i]!;
      if (c === '"') {
        this.i++;
        return [out, true];
      }
      if (c === "\\") {
        const n = this.s[this.i + 1];
        if (n === undefined) break;
        if (n === "u") {
          const hex = this.s.slice(this.i + 2, this.i + 6);
          if (hex.length < 4) break;
          out += String.fromCharCode(parseInt(hex, 16));
          this.i += 6;
          continue;
        }
        const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };
        out += map[n] ?? n;
        this.i += 2;
        continue;
      }
      out += c;
      this.i++;
    }
    this.i = this.s.length;
    return [out, false];
  }

  literal(): [unknown, boolean] {
    const rest = this.s.slice(this.i);
    const m = /^-?[0-9.eE+-]+|^true|^false|^null/.exec(rest);
    if (!m) {
      // "tr" at the end of the text is the start of "true".
      if (["true", "false", "null"].some((w) => w.startsWith(rest))) {
        this.i = this.s.length;
        return [undefined, false];
      }
      throw new SyntaxError(`unexpected ${this.s[this.i]} at ${this.i}`);
    }
    this.i += m[0].length;
    // A number at the very end may still be growing ("7" before "75").
    if (this.eof && /^-?[0-9]/.test(m[0])) return [undefined, false];
    const v: unknown = JSON.parse(m[0]);
    return [v, true];
  }
}

export function parsePartialJson(text: string): PartialResult {
  const p = new Parser(text);
  try {
    const [value, done] = p.value(0);
    p.ws();
    return { value, complete: done && p.eof, closedKeys: p.closedKeys };
  } catch {
    return { value: undefined, complete: false, closedKeys: p.closedKeys };
  }
}
