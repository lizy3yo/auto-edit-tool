/**
 * The book cover starts when the host NAMES the book, not where the beat that names it starts.
 *
 * Jobs 411 and 412 (round-12 verification films): the cover took the whole storyboard beat that said
 * the title, and that beat began a sentence or clause earlier, so the cover sat on screen 4-7 s before
 * the book was mentioned — 411 at 160.1 s on "What bird scientists and patient window-watchers…", the
 * book named ("one digital book") at 165.7 s; 412 at 155.7 s on "along with what behaviorists…", "my
 * book" at 159.9 s. The beat is now split at the clause that names the book, and the words before
 * stay with the host.
 */
import { describe, expect, it } from "vitest";
import type { LongformInputParams, StoryboardScene } from "@shared/types";
import {
  bookNamedAt,
  COVER_HEAD_ALONE_MIN_WORDS,
  COVER_LEAD_MAX_WORDS,
  coverCutAt,
  markCoverReveal,
  markCtaQrBlock,
  splitCoverAtNaming,
} from "./longformVideo";
import { assignSceneRanges } from "./narrationAlignment";

const before = (text: string, title: string) => {
  const cut = coverCutAt(text, title);
  return cut < 0 ? null : [text.slice(0, cut).trim(), text.slice(cut)];
};

describe("coverCutAt — where the cover beat is cut", () => {
  it("411: at the comma before the clause that names it ('I boiled down into one digital book')", () => {
    expect(
      before(
        "What bird scientists and patient window-watchers have learned over the years, I boiled down into one digital book, The Backyard Birder.",
        "The Backyard Birder"
      )
    ).toEqual([
      "What bird scientists and patient window-watchers have learned over the years,",
      "I boiled down into one digital book, The Backyard Birder.",
    ]);
  });

  it("412: at the comma before 'into my book', never at the 'cat' said before the title", () => {
    expect(
      before(
        "along with what behaviorists and lifelong cat people have worked out, into my book, Everything Your Cat Can’t Tell You.",
        "Everything Your Cat Can't Tell You"
      )
    ).toEqual([
      "along with what behaviorists and lifelong cat people have worked out,",
      "into my book, Everything Your Cat Can’t Tell You.",
    ]);
  });

  it(`a long clause hands over at the naming itself, past ${COVER_LEAD_MAX_WORDS} words (jobs 403, 352, 156)`, () => {
    // 403: its first five words pass as naming "Werner's 101 Free Repairs" ("a hundred and one" +
    // "repairs"); the book is named at "a digital book".
    expect(
      before(
        "A hundred and one repairs of that kind are gathered in a digital book called Werner's One Hundred and One Free Repairs, and free there means the repairs, not the book.",
        "Werner's 101 Free Repairs"
      )
    ).toEqual([
      "A hundred and one repairs of that kind are gathered in",
      "a digital book called Werner's One Hundred and One Free Repairs, and free there means the repairs, not the book.",
    ]);
    expect(
      before(
        "and I gathered as much of it as I could into a digital book called The Ultimate DIY Woodworking Guide.",
        "The Ultimate DIY Woodworking Guide"
      )?.[1]
    ).toBe("a digital book called The Ultimate DIY Woodworking Guide.");
    expect(
      before(
        "Everything I've learned about what actually earns its keep is gathered up in my book, 101 Lessons From Grandma's Sewing Chair.",
        "101 Lessons From Grandma's Sewing Chair"
      )?.[1]
    ).toBe("my book, 101 Lessons From Grandma's Sewing Chair.");
  });

  it("a beat that opens on the book, or on fewer than five words before it, stays whole", () => {
    // 351: the title opens the beat; the "a digital book" after it is not where it is named.
    expect(before("The Kitchen Table Crochet Book is a digital book with ten chapters,", "The Kitchen Table Crochet Book")).toBeNull();
    expect(before("The Last Dog Training Book You'll Ever Need.", "The Last Dog Training Book You'll Ever Need")).toBeNull();
    // 406: three words before it.
    expect(
      before(
        "That pattern fills a digital book called The Garage to Profit Bible, put together under this channel’s name from the honest arithmetic working people actually run.",
        "The Garage To Profitable Bible"
      )
    ).toBeNull();
    // 399: "It's called A Hundred Air Hostess Secrets" — the title starts at "A Hundred", not "Air".
    const hostess = "It's called A Hundred Air Hostess Secrets, a four hundred eighty-five page PDF, and every secret gives you the exact words,";
    expect(bookNamedAt(hostess, "100 Air Hostess Secrets")).toBe(hostess.indexOf("A Hundred"));
    expect(before(hostess, "100 Air Hostess Secrets")).toBeNull();
  });

  it("a clause that starts too near the beat's start for the host hands over at the naming instead", () => {
    // "Over the years," alone would be three words on the host: the cover would have kept all eight.
    expect(
      before("Over the years, I wrote it all into my book, The Backyard Birder.", "The Backyard Birder")
    ).toEqual(["Over the years, I wrote it all into", "my book, The Backyard Birder."]);
    // …but a whole beat that is only a short lead-in still keeps the cover.
    expect(before("Over the years, it went into my book, The Backyard Birder.", "The Backyard Birder")).toBeNull();
  });

  it("a short lead-in inside the beat's own clause keeps it whole (401: 'my work was gathering it into')", () => {
    expect(
      before(
        "my work was gathering it into a digital book called The Stoic Way — a hundred and one lessons on money, grief, people, and more.",
        "The Stoic Way"
      )
    ).toBeNull();
  });
});

describe("bookNamedAt — the host's own words for the book, else the title", () => {
  it("finds the title where most of it is said, not a title word said earlier", () => {
    const cat = "along with what behaviorists and lifelong cat people have worked out, into Everything Your Cat Can’t Tell You.";
    expect(bookNamedAt(cat, "Everything Your Cat Can't Tell You")).toBe(cat.indexOf("Everything"));
    const birder = "What bird scientists have learned over the years went into The Backyard Birder.";
    expect(bookNamedAt(birder, "The Backyard Birder")).toBe(birder.indexOf("The Backyard"));
  });

  it("'the guide I put together' is the host's book; 'one of the books', 'a way to guide' and 'the book of' are not", () => {
    const guide = "Everything from those winters went into the guide I put together, The Backyard Birder.";
    expect(bookNamedAt(guide, "The Backyard Birder")).toBe(guide.indexOf("the guide"));
    expect(bookNamedAt("one of the books on my shelf says so", undefined)).toBe(-1);
    expect(bookNamedAt("it is a simple way to guide your cat back to bed", undefined)).toBe(-1);
    expect(bookNamedAt("as the book of nature puts it", undefined)).toBe(-1);
  });
});

describe("splitCoverAtNaming", () => {
  const beat = (scriptText: string, over: Partial<StoryboardScene> = {}) =>
    ({ index: 1, scriptText, narration: scriptText, cta: true, ctaIndex: 0, visualPrompt: "a frosty yard", ...over }) as StoryboardScene;

  it("splits the beat in two, both keeping the beat's own register, and returns the cover's index", () => {
    const scenes = [
      beat("While the robins work on that holly, here’s something to help you name everything else out there.", { visualPrompt: "the host" }),
      beat("What bird scientists and patient window-watchers have learned over the years, I boiled down into one digital book, The Backyard Birder."),
    ];
    expect(splitCoverAtNaming(scenes, 1, "The Backyard Birder")).toBe(2);
    expect(scenes.slice(1).map(s => [s.scriptText, s.cta, s.ctaIndex, s.visualPrompt])).toEqual([
      ["What bird scientists and patient window-watchers have learned over the years,", true, 0, "a frosty yard"],
      ["I boiled down into one digital book, The Backyard Birder.", true, 0, "a frosty yard"],
    ]);
  });

  it(`a beat that opens its block splits only when the head can stand alone (${COVER_HEAD_ALONE_MIN_WORDS} words)`, () => {
    // Nothing folds or joins across a marked CTA edge, so a short head would be held to the host
    // floor over silence. 411's eleven words ("…over the years,") measured 3.9 s against that 4 s.
    const short = "What bird scientists and patient window-watchers have learned over the years, I boiled down into one digital book, The Backyard Birder.";
    const opening = [content(1, "and that’s easy to miss with the storm windows shut."), beat(short)];
    expect(splitCoverAtNaming(opening, 1, "The Backyard Birder")).toBe(1);
    expect(opening).toHaveLength(2);
    // After an operator's asset in the same block: nothing to join either.
    const afterAsset = [beat("Here is the stand.", { assetImageUrl: "a.png" }), beat(short)];
    expect(splitCoverAtNaming(afterAsset, 1, "The Backyard Birder")).toBe(1);
    // A head long enough to stand alone is still split, at the block's start too.
    const long = "What bird scientists, banders and patient window-watchers all over the country have learned over the last fifty years, I boiled down into one digital book, The Backyard Birder.";
    const opensLong = [content(1, "and that’s easy to miss with the storm windows shut."), beat(long)];
    expect(splitCoverAtNaming(opensLong, 1, "The Backyard Birder")).toBe(2);
    expect(opensLong[2].scriptText).toBe("I boiled down into one digital book, The Backyard Birder.");
    // An unmarked script (no `ctaIndex`) folds across its CTA edge as before, so it always splits.
    const unmarked = [content(1, "and that’s easy to miss with the storm windows shut."), beat(short, { ctaIndex: undefined })];
    expect(splitCoverAtNaming(unmarked, 1, "The Backyard Birder")).toBe(2);
  });

  it("leaves a cold-open, scan-window, cover or asset beat alone", () => {
    const text = "What bird scientists and patient window-watchers have learned over the years, I boiled down into one digital book, The Backyard Birder.";
    for (const over of [{ hostOpener: true }, { qrHero: true }, { coverHero: true }, { assetImageUrl: "a.png" }]) {
      const scenes = [beat(text, over)];
      expect(splitCoverAtNaming(scenes, 0, "The Backyard Birder")).toBe(0);
      expect(scenes).toHaveLength(1);
    }
  });
});

// The two CTA blocks as the storyboard wrote them (each block `ctaIndex` 0, a book uploaded for it).
const content = (index: number, scriptText: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, scriptText, narration: scriptText, hostPresent: false, stillImage: true, visualPrompt: "x", ...over }) as StoryboardScene;
const pitch = (index: number, scriptText: string, hostPresent = true) =>
  ({ index, scriptText, narration: scriptText, hostPresent, cta: true, ctaIndex: 0, visualPrompt: "x" }) as StoryboardScene;
const book = (title: string) =>
  ({ ctaBooks: [{ ctaIndex: 0, bookId: 0, title, coverImageUrl: "cover.png" }] }) as unknown as LongformInputParams;
const order = (scenes: StoryboardScene[]) =>
  scenes.filter(s => s.cta).map(s => (s.qrHero ? "Q" : s.coverHero ? "B" : "H")).join("");

const robins = () => [
  content(24, "and that’s easy to miss with the storm windows shut."),
  pitch(25, "While the robins work on that holly, here’s something to help you name everything else out there."),
  pitch(26, "What bird scientists and patient window-watchers have learned over the years, I boiled down into one digital book, The Backyard Birder.", false),
  pitch(27, "It covers more than thirty birds over nine chapters, and every bird’s profile runs the same six parts, from how to identify it, to a surprising fact, to the common mistake to avoid. The robin has its own profile, so when yours slip off the lawn, you’ll know what draws them back."),
  pitch(28, "If your phone’s within reach, point its camera at the code in this video, and when a link shows on the phone, tap it. Or scroll down to the description below the video, and it’s on the very first line. Today, next week, or once the snow flies, any of those works just as well. Back to the robins, who’ve picked up some company."),
  content(29, "The robins are not alone out there."),
];
const cats = () => [
  content(27, "Think of her as a shift worker who moved into your home. A lovely roommate, on very different hours. And three in the morning sits close enough to her pre-dawn window that her body starts stirring right when yours is at its deepest."),
  pitch(28, "Freeze that picture for a minute, because a cat training a person is exactly the kind of signal I’ve gathered,"),
  pitch(29, "along with what behaviorists and lifelong cat people have worked out, into my book, Everything Your Cat Can’t Tell You.", false),
  pitch(30, "It’s a digital download, five hundred and ninety-two pages, and every signal comes with the same six parts, from what it really means and the common mistake, to what to do and when a change belongs in front of a vet. Tonight’s mystery is in there too, in the chapter on what so-called bad behavior is really telling you. Getting it is simple."),
  pitch(31, "Aim your phone’s camera at the code on your screen, hold steady, and tap the message that appears, or the first line of the description under this video goes to the same place. And there’s no clock on this, because the pages read the same tonight or next month. Allora, back to the bedroom, because her wake-up call has a second engine, and this one runs on breakfast."),
  content(32, "Breakfast is the second engine."),
];

/** The transcript of each film's stretch (job 411 151.6-187.5 s, job 412 134.9-183.6 s), as heard. */
const heard = (packed: string) =>
  packed.split("|").map(t => {
    const [word, start, end] = t.split(" ");
    return { word, start: Number(start), end: Number(end) };
  });
const WORDS_411 = heard(
  "and 151.645 151.725|that's 151.765 151.945|easy 152.025 152.226|to 152.246 152.346|miss 152.406 152.646|with 152.706 152.846|the 152.866 152.946|storm 153.006 153.286|windows 153.326 153.666|shut. 153.746 154.006|While 154.706 154.886|the 154.926 155.006|robins 155.046 155.426|work 155.486 155.686|on 155.746 155.826|that 155.866 156.026|holly, 156.106 156.526|here's 156.966 157.147|something 157.207 157.487|to 157.527 157.607|help 157.647 157.787|you 157.827 157.947|name 157.987 158.187|everything 158.367 158.727|else 158.807 158.987|out 159.087 159.207|there. 159.267 159.467|What 160.198 160.358|bird 160.418 160.678|scientists 160.718 161.399|and 161.479 161.579|patient 161.679 162.08|window 162.14 162.44|watchers 162.5 162.92|have 162.96 163.1|learned 163.16 163.421|over 163.501 163.641|the 163.681 163.761|years, 163.821 164.141|I 164.562 164.662|boil 164.682 165.002|down 165.042 165.282|into 165.342 165.522|one 165.742 165.883|digital 166.003 166.423|book, 166.463 166.723|The 167.144 167.264|Backyard 167.324 167.864|Birder. 167.924 168.305|It 169.485 169.546|covers 169.586 169.886|more 169.946 170.086|than 170.126 170.266|30 170.286 170.686|birds 170.746 171.107|over 171.247 171.427|nine 171.527 171.807|chapters, 171.867 172.408|and 172.708 172.808|every 172.988 173.208|bird's 173.249 173.529|profile 173.589 174.129|runs 174.189 174.429|the 174.51 174.59|same 174.65 174.93|six 175.05 175.31|parts, 175.37 175.73|from 176.251 176.451|how 176.591 176.731|to 176.751 176.871|identify 176.951 177.532|it, 177.592 177.672|to 177.972 178.092|a 178.132 178.172|surprising 178.212 178.773|fact, 178.873 179.233|to 179.554 179.674|the 179.694 179.774|common 179.834 180.174|mistake 180.214 180.654|to 180.694 180.815|avoid. 180.895 181.295|The 181.955 182.056|robin 182.116 182.456|has 182.516 182.696|its 182.756 182.876|own 183.016 183.156|profile, 183.237 183.837|so 184.217 184.377|when 184.437 184.578|yours 184.598 184.858|slip 184.898 185.138|off 185.218 185.338|the 185.378 185.478|lawn, 185.518 185.879|you'll 186.079 186.299|know 186.339 186.479|what 186.519 186.659|draws 186.699 186.96|them 187 187.14|back. 187.18 187.48"
);
const WORDS_412 = heard(
  "Think 134.953 135.153|of 135.193 135.253|her 135.313 135.493|as 135.553 135.653|a 135.693 135.733|shift 135.833 136.134|worker 136.214 136.554|who 136.614 136.714|moved 136.774 136.994|into 137.034 137.214|your 137.234 137.394|home, 137.434 137.714|a 138.374 138.414|lovely 138.494 138.815|roommate 138.875 139.355|on 139.735 139.835|very 140.015 140.275|different 140.315 140.615|hours, 140.655 140.995|and 141.616 141.716|three 141.776 141.976|in 141.996 142.056|the 142.096 142.176|morning 142.236 142.596|sits 142.696 142.916|close 143.016 143.316|enough 143.376 143.617|to 143.657 143.757|her 143.797 143.917|pre-dawn 143.997 144.517|window 144.557 144.957|that 145.117 145.277|her 145.317 145.417|body 145.477 145.757|starts 145.817 146.138|stirring 146.198 146.638|right 146.818 147.078|when 147.138 147.298|yours 147.338 147.698|is 147.838 147.918|at 147.978 148.038|its 148.098 148.218|deepest. 148.319 148.779|Freeze 149.479 149.739|that 149.779 149.939|picture 149.979 150.259|for 150.299 150.419|a 150.459 150.499|minute, 150.539 150.8|because 151.1 151.36|a 151.38 151.4|cat 151.7 151.98|training 152.04 152.38|a 152.42 152.46|person 152.54 153.02|is 153.241 153.321|exactly 153.401 154.001|the 154.041 154.121|kind 154.161 154.381|of 154.421 154.481|signal 154.541 154.861|I've 154.901 155.041|gathered, 155.081 155.521|along 155.822 156.042|with 156.082 156.202|what 156.242 156.362|behaviourists 156.402 157.142|and 157.222 157.342|lifelong 157.422 157.862|cat 157.902 158.123|people 158.163 158.403|have 158.443 158.543|worked 158.583 158.823|out, 158.943 159.083|into 159.458 159.638|my 159.678 159.818|book 159.858 160.058|Everything 160.359 160.759|Your 160.799 160.959|Cat 160.999 161.259|Can't 161.359 161.66|Tell 161.74 161.98|You. 162.02 162.14|It's 162.74 162.84|a 162.88 162.9|digital 162.96 163.361|download, 163.401 163.921|592 164.161 164.802|pages, 165.382 165.802|and 166.103 166.183|every 166.403 166.643|signal 166.703 167.063|comes 167.123 167.303|with 167.343 167.463|the 167.503 167.584|same 167.664 167.984|six 168.104 168.384|parts, 168.464 168.864|from 169.285 169.405|what 169.445 169.565|it 169.625 169.665|really 169.785 170.065|means 170.125 170.465|and 170.586 170.666|the 170.686 170.746|common 170.786 171.046|mistake, 171.066 171.566|to 171.926 172.047|what 172.127 172.287|to 172.327 172.427|do 172.467 172.687|and 172.887 172.987|when 173.007 173.147|a 173.187 173.207|change 173.287 173.628|belongs 173.688 174.068|in 174.148 174.248|front 174.288 174.508|of 174.528 174.568|a 174.588 174.608|vet. 174.768 175.069|Tonight's 175.689 176.069|mystery 176.129 176.57|is 176.67 176.75|in 176.81 176.87|there 176.91 177.09|too, 177.15 177.41|in 177.89 177.971|the 177.991 178.071|chapter 178.091 178.471|on 178.591 178.671|what 178.731 178.891|so-called 178.991 179.512|bad 179.672 179.952|behavior 180.032 180.652|is 180.772 180.852|really 180.993 181.313|telling 181.373 181.673|you. 181.713 181.853|Getting 182.514 182.774|it 182.834 182.914|is 183.034 183.114|simple. 183.194 183.574"
);
/** The real pauses between those words (≥ 120 ms — what silencedetect finds between them). */
const pausesOf = (words: { start: number; end: number }[]) =>
  words.slice(1).flatMap((w, k) => (w.start - words[k].end >= 0.12 ? [{ start: words[k].end, end: w.start }] : []));

describe("the CTA blocks of jobs 411 and 412", () => {
  it("411: host → host → cover from 'I boiled down into one digital book' → host → big QR", () => {
    const out = markCtaQrBlock(robins(), book("The Backyard Birder"), true);
    expect(order(out)).toBe("HHBHQ");
    expect(out.find(s => s.coverHero)?.scriptText).toBe("I boiled down into one digital book, The Backyard Birder.");
    expect(out.find(s => /over the years,$/.test(s.scriptText ?? ""))?.coverHero).toBeFalsy();
    expect(out.map(s => s.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("412: the cover from 'into my book', the clause before it kept with the host", () => {
    const out = markCtaQrBlock(cats(), book("Everything Your Cat Can't Tell You"), true);
    expect(order(out)).toBe("HHBHQ");
    expect(out.find(s => s.coverHero)?.scriptText).toBe("into my book, Everything Your Cat Can’t Tell You.");
    expect(out.find(s => s.qrHero)?.scriptText).toMatch(/^Aim your phone’s camera/);
  });

  it("a block that opens on the naming beat keeps it whole when its head is short (no frozen host before the book)", () => {
    const [before412, , ...rest] = cats(); // the block now opens on "along with what behaviorists…"
    const out = markCtaQrBlock([before412, ...rest], book("Everything Your Cat Can't Tell You"), true);
    expect(order(out)).toBe("BHQ");
    expect(out.find(s => s.coverHero)?.scriptText).toMatch(/^along with what behaviorists/);
  });

  it("the cut lands in the real pause before the clause once the voice is aligned (411: 164.14-164.56 s, 412: 159.08-159.46 s)", () => {
    for (const [scenes, title, words, pause, named] of [
      [robins(), "The Backyard Birder", WORDS_411, [164.141, 164.562], 165.742],
      [cats(), "Everything Your Cat Can't Tell You", WORDS_412, [159.083, 159.458], 159.678],
    ] as const) {
      const marked = markCtaQrBlock(scenes, book(title), true);
      // The stretch the transcript covers: up to the host take after the cover.
      const upTo = marked.findIndex(s => s.coverHero) + 2;
      const film = marked.slice(0, upTo);
      const end = words[words.length - 1].end + 0.3;
      const ranges = assignSceneRanges(film, [...words], end, pausesOf(words));
      const cover = ranges[upTo - 2];
      expect(cover.startSec).toBeGreaterThan(pause[0]);
      expect(cover.startSec).toBeLessThan(pause[1]);
      expect(cover.startSec).toBeLessThan(named);
      expect(ranges[upTo - 3].endSec).toBe(cover.startSec);
    }
  });
});

describe("markCoverReveal (a block with no scan window yet) cuts the same way", () => {
  it("splits, renumbers, and a second pass adds no second cover — even when the words kept before pass as naming it (403)", () => {
    const scenes = [
      pitch(1, "A heavy strike with long screws is everyday repair work,"),
      pitch(2, "A hundred and one repairs of that kind are gathered in a digital book called Werner's One Hundred and One Free Repairs, and free there means the repairs, not the book."),
    ];
    const params = book("Werner's 101 Free Repairs");
    const once = markCoverReveal(scenes, params);
    expect(once.map(s => [s.index, !!s.coverHero, s.scriptText?.slice(0, 30)])).toEqual([
      [1, false, "A heavy strike with long screw"],
      [2, false, "A hundred and one repairs of t"],
      [3, true, "a digital book called Werner's"],
    ]);
    const twice = markCoverReveal(once, params);
    expect(twice.filter(s => s.coverHero)).toHaveLength(1);
    expect(twice).toHaveLength(3);
  });

  it("a title at the start of its beat is unchanged", () => {
    const scenes = [
      pitch(1, "And when you're ready for more, here is where it all lives."),
      pitch(2, "The Kitchen Table Crochet Book is a digital book with ten chapters,"),
    ];
    const out = markCoverReveal(scenes, book("The Kitchen Table Crochet Book"));
    expect(out.map(s => [s.index, !!s.coverHero])).toEqual([
      [1, false],
      [2, true],
    ]);
  });
});
