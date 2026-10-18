import { describe, expect, it } from "vitest";
import {
  hostNameForms,
  hostNameRanges,
  introducesHost,
  introSpans,
  namesHostBefore,
} from "./hostIntro";

// Job 407's self-introduction, verbatim (scene 9). The channel's host name is "Sawdust Sam".
const SAM_INTRO =
  "I am Sam, and this one is for anybody who has wondered how a family got through a mountain winter on a woodlot and very little cash.";

describe("hostNameForms", () => {
  it("adds the LAST word of a two-word name — the first name of '<descriptor> <first name>' (job 407)", () => {
    expect(hostNameForms("Sawdust Sam").map(f => f.words)).toEqual(["Sawdust Sam", "Sawdust", "Sam"]);
    expect(hostNameForms("Backyard Brenda").map(f => f.words)).toEqual([
      "Backyard Brenda",
      "Backyard",
      "Brenda",
    ]);
    // One word of a longer name is marked partial: it counts only written as a name.
    expect(hostNameForms("Sawdust Sam").filter(f => f.partial).map(f => f.words)).toEqual(["Sawdust", "Sam"]);
  });

  it("keeps the old forms: the honorific dropped, the first word of a longer name", () => {
    expect(hostNameForms("Granny Mae")).toEqual([
      { words: "Granny Mae", partial: false },
      { words: "Mae", partial: false },
    ]);
    // Three words: the first word stands for the host, the last does not (that is a two-word rule).
    expect(hostNameForms("Diane De Chambray").map(f => f.words)).toEqual(["Diane De Chambray", "Diane"]);
    expect(hostNameForms("Gary")).toEqual([{ words: "Gary", partial: false }]);
    expect(hostNameForms("  Norbert   Daniels ").map(f => f.words)).toEqual([
      "Norbert Daniels",
      "Norbert",
      "Daniels",
    ]);
    expect(hostNameForms(undefined)).toEqual([]);
    expect(hostNameForms("   ")).toEqual([]);
  });

  it("never lets a function word, an initial or a suffix stand for the host", () => {
    expect(hostNameForms("The Handyman").map(f => f.words)).toEqual(["The Handyman", "Handyman"]);
    expect(hostNameForms("Just Jim").map(f => f.words)).toEqual(["Just Jim", "Jim"]);
    expect(hostNameForms("Sam Jr").map(f => f.words)).toEqual(["Sam Jr", "Sam"]);
    expect(hostNameForms("J. Smith").map(f => f.words)).toEqual(["J. Smith", "Smith"]);
  });
});

describe("introducesHost — a two-word name said by its last word", () => {
  it("finds 'I am Sam' for Sawdust Sam and 'I'm Brenda' for Backyard Brenda", () => {
    expect(introducesHost(SAM_INTRO, "Sawdust Sam")).toBe(true);
    expect(introSpans(SAM_INTRO, "Sawdust Sam")).toEqual([[0, "I am Sam".length]]);
    expect(introducesHost("I'm Brenda, and if you keep a small yard, this one's for you.", "Backyard Brenda")).toBe(
      true
    );
    expect(introducesHost("Hi folks, Sam here, back in the shop.", "Sawdust Sam")).toBe(true);
    expect(introducesHost("Sam here again.", "Sawdust Sam")).toBe(true);
    expect(introducesHost("Call me Sam.", "Sawdust Sam")).toBe(true);
    // Before the fix only "Sawdust Sam" and "Sawdust" were looked for.
    expect(introducesHost(SAM_INTRO, "Sawdust")).toBe(false);
  });

  it("does not take a name's ordinary-word half, uncapitalised, for an introduction", () => {
    // The last word is often an ordinary word too — a surname or a descriptor.
    expect(introducesHost("Look at the backyard here, after the rain.", "Backyard Brenda")).toBe(false);
    expect(introducesHost("It's sawdust, mostly, and a little glue.", "Sawdust Sam")).toBe(false);
    expect(introducesHost("Sweep up the sawdust here, before it spreads.", "Sawdust Sam")).toBe(false);
    expect(introducesHost("Sawdust here gets into everything.", "Sawdust Sam")).toBe(false);
    expect(introducesHost("It's sterling silver, not plate.", "Scarlett Sterling")).toBe(false);
    expect(introducesHost("You can see the Carolina Wren here, on the feeder.", "Walter Wren")).toBe(false);
    expect(introducesHost("It's Sam's old saw.", "Sawdust Sam")).toBe(false);
    expect(introducesHost("I am Samuel's neighbour.", "Sawdust Sam")).toBe(false);
    // A function word never stands for the host.
    expect(introducesHost("This is the part that matters.", "The Handyman")).toBe(false);
    expect(introducesHost("This is The Handyman, back again.", "The Handyman")).toBe(true);
    expect(introducesHost("I'm just getting started.", "Just Jim")).toBe(false);
    expect(introducesHost("I'm Jim, and this is my shop.", "Just Jim")).toBe(true);
  });

  it("keeps every introduction it found before", () => {
    expect(introducesHost("I'm Hank Hardwood, and this one's for anybody standing in a garage with a saw,", "Hank Hardwood")).toBe(true);
    expect(introducesHost("Hank here, back in the shop.", "Hank Hardwood")).toBe(true);
    expect(introducesHost("I am Mae, and this is my table.", "Granny Mae")).toBe(true);
    expect(introducesHost("My name is Gideon Grant, and this channel is for", "Gideon Grant")).toBe(true);
    expect(introducesHost("I am Werner Finkbeiner. This channel is for you.", "Werner Finkbeiner")).toBe(true);
    expect(introducesHost("I'm Diane, and this channel is for women over sixty.", "Diane De Chambray")).toBe(true);
    expect(introducesHost("It's Hank's favourite saw.", "Hank Hardwood")).toBe(false);
    expect(introducesHost("I'm going to cut it now.", "Hank Hardwood")).toBe(false);
  });

  it("finds a sign-on after a greeting's comma or a dash however it goes on, as the first-word rule did", () => {
    // Mid-sentence the capital already says it is a name, so the next word may be anything.
    expect(introducesHost("Hi folks, Hank here in the shop today.", "Hank Hardwood")).toBe(true);
    expect(introducesHost("Howdy, Sam here at the bench with a new box.", "Sawdust Sam")).toBe(true);
    expect(introducesHost("Howdy — Hank here, back in the shop.", "Hank Hardwood")).toBe(true);
    expect(introducesHost("Well, folks—Brenda here in the garden.", "Backyard Brenda")).toBe(true);
    // At the start of a sentence every word has a capital, so the strict form still holds there…
    expect(introducesHost("Sawdust here in the corner gets into everything.", "Sawdust Sam")).toBe(false);
    expect(introducesHost("Hardwood here in the Midwest runs about four dollars a foot.", "Hank Hardwood")).toBe(false);
    // …and mid-sentence the word must still be the name, capitalised, and not "here's".
    expect(introducesHost("In this shop, sawdust here gets everywhere.", "Sawdust Sam")).toBe(false);
    expect(introducesHost("Folks, Sam here's the trick.", "Sawdust Sam")).toBe(false);
    expect(introducesHost("You can see the Carolina Wren here — on the feeder.", "Walter Wren")).toBe(false);
  });
});

describe("hostNameRanges / namesHostBefore", () => {
  it("joins the parts of one introduction, so a cut inside the name never counts as the name said", () => {
    const text = "My name is Gideon Grant, and this channel is for";
    expect(hostNameRanges(text, "Gideon Grant")).toEqual([[0, "My name is Gideon Grant".length]]);
    expect(namesHostBefore(text, "Gideon Grant", "My name is Gideon".length)).toBe(false);
    expect(namesHostBefore(text, "Gideon Grant", "My name is Gideon Grant,".length)).toBe(true);
  });

  it("finds the name said by its last word, and the whole name anywhere", () => {
    expect(namesHostBefore(SAM_INTRO, "Sawdust Sam", "I am Sam,".length)).toBe(true);
    expect(namesHostBefore(SAM_INTRO, "Sawdust Sam", "I am".length)).toBe(false);
    expect(hostNameRanges("Welcome back to Hank Hardwood, friends.", "Hank Hardwood")).toEqual([
      [16, 29],
    ]);
    expect(hostNameRanges(SAM_INTRO, undefined)).toEqual([]);
  });
});
