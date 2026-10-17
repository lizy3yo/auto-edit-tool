import { describe, expect, it } from "vitest";
import {
  DEFAULT_DUB_LANGUAGES,
  DUB_END_HOLD_SEC,
  DUB_PART_GAP_SEC,
  DUB_CTA_PARTS,
  DUB_STALE_MS,
  dubClipState,
  dubLanguageBlocker,
  dubLanguageCode,
  dubLanguagesError,
  dubPartDurations,
  dubVoiceFor,
  channelDubVoicesError,
  cleanChannelDubVoices,
  clipMatchesScript,
  clipUsesBroll,
  parseDubBroll,
  dubScriptError,
  dubScriptLength,
  dubScriptLines,
  dubScriptSentences,
  splitDubScript,
  parseChannelDubVoices,
  parseDubCtaScript,
  parseDubLanguages,
} from "./dubCta";

const answer = (title: string) =>
  "```json\n" +
  JSON.stringify({
    lines: {
      lead: "Antes de seguir, quiero contarte algo.",
      title: `Se llama «${title}».`,
      pitch: "Ahí lo explico todo paso a paso.",
      scan: "Escanea el código en la pantalla. Y ahora, sigamos.",
    },
    pictures: {
      lead: "a workbench",
      pitch: "a stack of boards",
      scan: "a quiet garage",
    },
  }) +
  "\n```";

describe("the lines Claude writes", () => {
  it("reads a fenced answer and finds the title through quotes", () => {
    const r = parseDubCtaScript(
      answer("El Taller en Casa"),
      "El taller en casa"
    );
    expect("script" in r && r.script.lines.title).toContain(
      "El Taller en Casa"
    );
  });

  it("refuses a title line that does not say the book's title", () => {
    const r = parseDubCtaScript(answer("Otro libro"), "El taller en casa");
    expect(r).toEqual({
      error: "the title line does not say the book's title exactly",
    });
  });

  it("refuses an empty line or picture, and an answer with no JSON", () => {
    const empty = answer("X").replace("a quiet garage", "");
    expect(parseDubCtaScript(empty, "X")).toEqual({
      error: 'the "scan" picture is empty',
    });
    expect(parseDubCtaScript("Sorry, I can't.", "X")).toEqual({
      error: "no JSON in the answer",
    });
  });

  it("finds a Japanese title in 「」", () => {
    const text = JSON.stringify({
      lines: {
        lead: "a",
        title: "本のタイトルは「家の工房」です。",
        pitch: "b",
        scan: "c",
      },
      pictures: { lead: "x", pitch: "y", scan: "z" },
    });
    expect("script" in parseDubCtaScript(text, "家の工房")).toBe(true);
  });
});

describe("the voices", () => {
  it("falls back to the SOP's four languages when nothing readable is saved", () => {
    expect(parseDubLanguages(null)).toEqual(DEFAULT_DUB_LANGUAGES);
    expect(parseDubLanguages("not json")).toEqual(DEFAULT_DUB_LANGUAGES);
    expect(
      parseDubLanguages(
        '[{"code":"it","name":"Italian","voiceId":" abcdefgh12 "}]'
      )
    ).toEqual([{ code: "it", name: "Italian", voiceId: "abcdefgh12" }]);
  });

  it("gives a new language a key of its own", () => {
    expect(dubLanguageCode("Brazilian Português", [])).toBe(
      "brazilian-portugues"
    );
    expect(dubLanguageCode("German", ["german"])).toBe("german-2");
  });

  it("refuses a list with a name twice or a voice id that is not one", () => {
    expect(
      dubLanguagesError([
        { code: "a", name: "German", voiceId: "" },
        { code: "b", name: "german", voiceId: "" },
      ])
    ).toMatch(/twice/);
    expect(
      dubLanguagesError([{ code: "a", name: "German", voiceId: "Leo Marin" }])
    ).toMatch(/does not look like/);
    expect(dubLanguagesError(DEFAULT_DUB_LANGUAGES)).toBeNull();
  });
});

describe("what a language still needs", () => {
  const es = DEFAULT_DUB_LANGUAGES[1];
  const book = {
    title: "Libro",
    coverImageUrl: "https://x/c.png",
    shopUrl: "https://shop/es",
  };
  it("names the first thing missing", () => {
    const voices = { es: "69cPH0Ypmuc48Y3Ty25o" };
    expect(dubLanguageBlocker(DEFAULT_DUB_LANGUAGES[0], book)).toMatch(
      /no voice/
    );
    expect(dubLanguageBlocker(es, book)).toMatch(/no voice/);
    expect(dubLanguageBlocker(es, undefined, voices)).toMatch(/book first/);
    expect(
      dubLanguageBlocker(es, { ...book, coverImageUrl: null }, voices)
    ).toMatch(/cover/);
    expect(dubLanguageBlocker(es, { ...book, shopUrl: null }, voices)).toMatch(
      /link/
    );
    expect(dubLanguageBlocker(es, book, voices)).toBeNull();
  });
});

describe("timing and state", () => {
  it("leaves a short gap after each part and holds the big QR at the end", () => {
    expect(dubPartDurations([2, 3, 4, 5])).toEqual([
      2 + DUB_PART_GAP_SEC,
      3 + DUB_PART_GAP_SEC,
      4 + DUB_PART_GAP_SEC,
      5 + DUB_END_HOLD_SEC,
    ]);
  });

  it("calls a clip still working long after its last update interrupted", () => {
    const now = Date.now();
    expect(
      dubClipState({ status: "working", updatedAt: new Date(now - 1000) }, now)
    ).toBe("working");
    expect(
      dubClipState(
        { status: "working", updatedAt: new Date(now - DUB_STALE_MS - 1) },
        now
      )
    ).toBe("interrupted");
    expect(dubClipState({ status: "done", updatedAt: new Date(0) }, now)).toBe(
      "done"
    );
  });
});

describe("a channel's own dub voices", () => {
  const german = { code: "de", name: "German", voiceId: "" };
  const french = {
    code: "fr",
    name: "French",
    voiceId: "fEtpdogpDkBrq53KdupV",
  };
  const book = {
    title: "Le Livre",
    coverImageUrl: "https://x/c.png",
    shopUrl: "https://x/b",
  };

  it("uses only the channel's own voice — never the language's voice from Admin → Dub voices", () => {
    const roger = { fr: "AAAAAAAAAAAAAAAAAAAA" };
    expect(dubVoiceFor(french, roger)).toEqual({
      voiceId: "AAAAAAAAAAAAAAAAAAAA",
      source: "channel",
    });
    expect(dubVoiceFor(french, {})).toEqual({ voiceId: "", source: "none" });
    expect(dubVoiceFor(german, null)).toEqual({ voiceId: "", source: "none" });
  });

  it("blocks a language the channel has no voice for, even when the language has one", () => {
    expect(dubLanguageBlocker(german, book)).toMatch(
      /no voice for this channel/
    );
    expect(dubLanguageBlocker(french, book, {})).toMatch(
      /no voice for this channel/
    );
    expect(
      dubLanguageBlocker(german, book, { de: "ieOJeyXoXR1MBO5OFAti" })
    ).toBeNull();
  });

  it("reads only well-formed ids from storage", () => {
    expect(parseChannelDubVoices(null)).toEqual({});
    expect(
      parseChannelDubVoices('{"fr":" fEtpdogpDkBrq53KdupV ","ja":"bad id"}')
    ).toEqual({
      fr: "fEtpdogpDkBrq53KdupV",
    });
    expect(parseChannelDubVoices(["x"])).toEqual({});
  });

  it("refuses a malformed id but allows a blank one (= no voice)", () => {
    expect(
      channelDubVoicesError({ fr: "", de: "ieOJeyXoXR1MBO5OFAti" })
    ).toBeNull();
    expect(channelDubVoicesError({ fr: "not an id!" })).toMatch(/fr dub voice/);
  });

  it("stores trimmed ids and drops blanks", () => {
    expect(
      cleanChannelDubVoices({ fr: " fEtpdogpDkBrq53KdupV ", de: "  " })
    ).toEqual({
      fr: "fEtpdogpDkBrq53KdupV",
    });
    expect(cleanChannelDubVoices({ de: "" })).toBeNull();
  });
});

describe("a language's script", () => {
  const es =
    "Antes de seguir, te cuento algo. Tengo un libro: {book}. Encontrarás arreglos sencillos. Escanea el código QR de la pantalla.";

  it("splits into the four parts by sentence, around the {book} sentence", () => {
    const split = splitDubScript(es);
    expect("parts" in split && split.parts).toEqual({
      lead: "Antes de seguir, te cuento algo.",
      title: "Tengo un libro: {book}.",
      pitch: "Encontrarás arreglos sencillos.",
      scan: "Escanea el código QR de la pantalla.",
    });
  });

  it("keeps several middle sentences together as the pitch", () => {
    const split = splitDubScript("Uno. Dos {book}. Tres. Cuatro. Cinco.");
    expect("parts" in split && split.parts.pitch).toBe("Tres. Cuatro.");
    expect("parts" in split && split.parts.scan).toBe("Cinco.");
  });

  it("splits Japanese on 。 with no spaces", () => {
    expect(dubScriptSentences("まず一言。本があります。最後に。")).toEqual([
      "まず一言。",
      "本があります。",
      "最後に。",
    ]);
  });

  it("never cuts inside the title, since it splits the template", () => {
    const got = dubScriptLines(es, "Fontanería 101. Sin miedo!");
    expect("lines" in got && got.lines.title).toBe(
      "Tengo un libro: Fontanería 101. Sin miedo!."
    );
  });

  it("refuses a script missing a part, a second {book}, or none", () => {
    expect(dubScriptError("")).toMatch(/empty/);
    expect(dubScriptError("Hola. Adiós.")).toMatch(/Put \{book\}/);
    expect(dubScriptError("Hola {book}. Más. Fin.")).toMatch(/sentence before/);
    expect(dubScriptError("Hola. Mi libro {book}. Fin.")).toMatch(/After the/);
    expect(dubScriptError("Hola. {book}. {book}. Fin. Ya.")).toMatch(/once/);
    expect(dubScriptError(es)).toBeNull();
  });

  it("refuses a script that reads past the limit", () => {
    const long = `Uno. Mi libro {book}. ${"palabra ".repeat(90)}. Fin.`;
    expect(dubScriptError(long)).toMatch(/keep it under/);
  });

  it("counts Japanese by characters and spaced languages by words", () => {
    expect(dubScriptLength("まず一言。{book}。").unit).toBe("characters");
    const es2 = dubScriptLength("Hola amigo, mira esto.");
    expect(es2).toMatchObject({ count: 4, unit: "words" });
  });

  it("knows whether a made clip still says the saved script", () => {
    const got = dubScriptLines(es, "Mi Libro");
    const lines = "lines" in got ? got.lines : null;
    expect(clipMatchesScript(lines, es, "Mi Libro")).toBe(true);
    expect(
      clipMatchesScript(lines, es.replace("sencillos", "rápidos"), "Mi Libro")
    ).toBe(false);
    expect(clipMatchesScript(null, es, "Mi Libro")).toBe(false);
  });
});

describe("shared b-roll", () => {
  const set = {
    lead: { description: "a workbench", url: "https://x/a.png" },
    pitch: { description: "a stack of boards", url: "https://x/b.png" },
    scan: { description: "a quiet garage", url: "https://x/c.png" },
  };
  const urls = {
    lead: "https://x/a.png",
    pitch: "https://x/b.png",
    scan: "https://x/c.png",
  };

  it("reads a whole set and refuses a broken one", () => {
    expect(parseDubBroll(JSON.stringify(set))).toEqual(set);
    expect(parseDubBroll(null)).toBeNull();
    expect(parseDubBroll("not json")).toBeNull();
    expect(
      parseDubBroll(JSON.stringify({ ...set, scan: { description: "x" } }))
    ).toBeNull();
  });

  it("every language's clip of a position must be built from the same pictures", () => {
    expect(clipUsesBroll({ pictureUrls: urls }, set)).toBe(true);
    // Drawn again since: the clip shows the old pictures.
    expect(
      clipUsesBroll(
        { pictureUrls: { ...urls, pitch: "https://x/old.png" } },
        set
      )
    ).toBe(false);
    // Made before pictures were shared.
    expect(clipUsesBroll({}, set)).toBe(false);
    expect(clipUsesBroll(null, set)).toBe(false);
    // No shared set yet: nothing to differ from.
    expect(clipUsesBroll({}, null)).toBe(true);
  });
});

describe("QR in a dub CTA", () => {
  it("is big on every b-roll picture and small only on the book cover", () => {
    for (const p of DUB_CTA_PARTS)
      expect(p.qr).toBe(p.picture === "cover" ? "corner" : "center");
    expect(DUB_CTA_PARTS.find(p => p.key === "title")).toMatchObject({
      picture: "cover",
      qr: "corner",
    });
  });
});
