import { describe, expect, it } from "vitest";
import {
  accentOf,
  availableAccents,
  examinerName,
  nextAccent,
  pickLocalFallback,
  pickVoice,
  rankVoice,
  type VoiceInfo,
} from "./voices";

const v = (name: string, lang: string, localService = true): VoiceInfo => ({
  name,
  lang,
  localService,
  voiceURI: name,
  default: false,
});

const edge = [
  v("Microsoft David - English (United States)", "en-US"),
  v("Microsoft Hazel - English (United Kingdom)", "en-GB"),
  v("Microsoft Sonia Online (Natural) - English (United Kingdom)", "en-GB", false),
  v("Microsoft AvaMultilingual Online (Natural) - English (United States)", "en-US", false),
  v("Microsoft Natasha Online (Natural) - English (Australia)", "en-AU", false),
  v("Microsoft Sabina - Spanish (Mexico)", "es-MX"),
];

const chrome = [
  v("Microsoft Zira - English (United States)", "en-US"),
  v("Google US English", "en-US", false),
  v("Google UK English Female", "en-GB", false),
  v("Google UK English Male", "en-GB", false),
  v("Google español de Estados Unidos", "es-US", false),
];

describe("rankVoice", () => {
  it("orders Natural > Google > any English > other", () => {
    expect(rankVoice(edge[2]!)).toBe(3);
    expect(rankVoice(chrome[1]!)).toBe(2);
    expect(rankVoice(edge[0]!)).toBe(1);
    expect(rankVoice(edge[5]!)).toBe(0);
  });
});

describe("accents", () => {
  it("normalizes lang codes", () => {
    expect(accentOf("en_GB")).toBe("en-GB");
    expect(accentOf("en-au")).toBe("en-AU");
    expect(accentOf("en-IN")).toBeNull();
  });
  it("lists the accents that have a voice", () => {
    expect(availableAccents(edge)).toEqual(["en-GB", "en-US", "en-AU"]);
    expect(availableAccents(chrome)).toEqual(["en-GB", "en-US"]);
  });
  it("rotates GB -> US -> AU and wraps", () => {
    const all = availableAccents(edge);
    expect(nextAccent(all, null, null)).toBe("en-GB");
    expect(nextAccent(all, "en-GB", null)).toBe("en-US");
    expect(nextAccent(all, "en-US", null)).toBe("en-AU");
    expect(nextAccent(all, "en-AU", null)).toBe("en-GB");
  });
  it("skips accents without a voice", () => {
    expect(nextAccent(["en-GB", "en-US"], "en-US", null)).toBe("en-GB");
    expect(nextAccent(["en-GB", "en-US"], "en-AU", null)).toBe("en-GB");
  });
  it("honours a pinned accent when available", () => {
    expect(nextAccent(["en-GB", "en-US"], "en-GB", "en-GB")).toBe("en-GB");
    expect(nextAccent(["en-GB", "en-US"], "en-GB", "en-AU")).toBe("en-US");
  });
  it("returns null with no English voices", () => {
    expect(nextAccent([], null, null)).toBeNull();
  });
});

describe("pickVoice", () => {
  it("prefers the Natural voice for the accent", () => {
    expect(pickVoice(edge, "en-GB")?.name).toContain("Sonia");
    expect(pickVoice(edge, "en-AU")?.name).toContain("Natasha");
  });
  it("prefers Google voices in Chrome", () => {
    expect(pickVoice(chrome, "en-US")?.name).toBe("Google US English");
  });
  it("falls back to the best English voice when the accent is missing", () => {
    expect(pickVoice(chrome, "en-AU")?.name).toBe("Google US English");
  });
  it("picks a local fallback voice, same accent first", () => {
    expect(pickLocalFallback(edge, "en-GB")?.name).toContain("Hazel");
    expect(pickLocalFallback(chrome, "en-GB")?.name).toContain("Zira");
  });
});

describe("examinerName", () => {
  it("uses the Microsoft voice's first name", () => {
    expect(examinerName(edge[2]!)).toBe("Sonia");
    expect(examinerName(edge[3]!)).toBe("Ava");
    expect(examinerName(edge[0]!)).toBe("David");
  });
  it("matches gender for Google voices", () => {
    expect(examinerName(chrome[2]!)).toBe("Emma");
    expect(examinerName(chrome[3]!)).toBe("James");
    expect(examinerName(chrome[1]!)).toBe("Sarah");
  });
  it("uses single-word voice names as they are", () => {
    expect(examinerName(v("Karen", "en-AU"))).toBe("Karen");
  });
});
