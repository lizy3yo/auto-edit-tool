// A CARD SAYS WHAT THE VOICE SAYS (round 14, the verification films 411-414). Four cards drew something
// the voice never said: a before and after of one state (job 411's "Hardly sings → Soft clucking", both
// in winter), a myth stamp on the host's own true statement (job 414's "The title says lost") and one with
// no words at all (job 412's "call it revenge"), a figure of speech counted up as a statistic (job 412's
// "a hundred times before"), and a unit never said after its number (job 414's "24 skills" for "24
// together"). Every case is the cue as the job stored it, resolved on the words as its film's transcript
// timed them; the clean cards beside them, from the same films, must not change.
import { describe, expect, it } from "vitest";
import { resolveCues, type CueSpec, type ResolvedCue, type Word } from "../cueResolve";
import { beforeAfterProblem, changeSaid, figureOfSpeech, mythStampProblem, numberCardProblem, systemPrompt, unitNotSaid } from "./planner";

/** Words as the transcriber timed them: "text@start-end …". */
const T = (s: string): Word[] =>
  s.split(" ").map(t => {
    const [text, range] = t.split("@");
    const [start, end] = range.split("-").map(Number);
    return { text, start, end };
  });
/** A stored cue resolved on its film's words, and the word the number / side lands on. */
const resolved = (spec: CueSpec, words: Word[]) => resolveCues([spec], words)[0];
const wordAt = (words: Word[], text: string) => words.findIndex(w => w.text === text);

// Walter's job 411: the opening (0:00-0:26), the bird count (0:52-0:60), the winter song (2:17-2:30).
const robinsOpening = T(
  "Every@0.251-0.471 fall,@0.571-0.972 the@1.212-1.312 robins@1.372-1.752 that@1.792-1.932 worked@1.972-2.192 your@2.232-2.373 lawn@2.413-2.693 all@2.833-3.013 summer@3.093-3.433 pack@3.573-3.853 up@3.994-4.094 and@4.194-4.294 head@4.374-4.534 for@4.574-4.714 Florida.@4.774-5.294 " +
    "The@6.195-6.295 song@6.355-6.675 at@6.735-6.795 first@6.855-7.116 light@7.196-7.416 goes@7.456-7.676 quiet,@7.776-8.216 the@8.617-8.717 grass@8.757-9.117 sits@9.157-9.397 empty@9.537-9.797 in@9.817-9.897 the@9.917-9.997 mornings,@10.037-10.438 and@10.938-11.058 nobody@11.178-11.538 sees@11.598-11.859 another@11.919-12.219 robin@12.279-12.639 until@12.699-12.979 spring.@13.059-13.46 " +
    "At@14.3-14.36 least,@14.4-14.66 that's@15.001-15.201 what@15.241-15.381 just@15.421-15.621 about@15.661-15.861 everybody@15.921-16.342 figures.@16.422-16.802 " +
    "Across@17.923-18.223 a@18.263-18.303 good@18.363-18.543 part@18.603-18.783 of@18.823-18.883 the@18.903-18.983 country,@19.023-19.484 plenty@19.764-20.084 of@20.104-20.164 those@20.204-20.404 robins@20.484-20.885 never@21.005-21.225 leave@21.285-21.465 at@21.505-21.545 all,@21.725-21.885 and@22.345-22.446 some@22.546-22.766 will@22.806-22.966 spend@23.006-23.206 the@23.246-23.326 whole@23.426-23.706 winter@23.786-24.087 within@24.147-24.387 a@24.427-24.467 short@24.567-24.847 walk@24.907-25.187 of@25.227-25.287 your@25.327-25.487 back@25.568-25.808 door.@25.868-26.108"
);
const birdCount = T(
  "head@52.042-52.202 out@52.282-52.382 every@52.442-52.662 winter@52.742-53.023 for@53.083-53.203 the@53.223-53.323 Christmas@53.363-53.783 bird@53.883-54.163 count.@54.223-54.563 The@55.472-55.552 big@55.572-55.752 holiday@55.832-56.293 tally@56.353-56.773 birders@56.833-57.193 have@57.233-57.353 kept@57.393-57.593 going@57.633-57.894 for@57.934-58.074 more@58.114-58.254 than@58.294-58.434 100@58.474-58.974 years,@59.034-59.415"
);
const winterSong = T(
  "is@137.123-137.223 his,@137.323-137.663 and@137.903-138.003 he's@138.043-138.223 looking@138.263-138.543 for@138.563-138.723 a@138.763-138.783 mate.@138.863-139.143 Once@139.943-140.103 nesting@140.183-140.563 season@140.603-140.963 is@141.023-141.123 over,@141.223-141.463 that@141.743-141.923 job@141.963-142.184 is@142.244-142.344 done,@142.404-142.704 and@143.104-143.184 through@143.204-143.424 the@143.444-143.524 winter,@143.584-143.904 a@144.104-144.144 robin@144.204-144.504 hardly@144.564-144.884 sings@144.924-145.184 at@145.244-145.284 all.@145.424-145.584 " +
    "Mostly@146.284-146.684 you'll@146.724-146.904 hear@146.944-147.125 a@147.185-147.205 low,@147.285-147.605 soft@147.745-148.085 clucking,@148.225-148.685 a@149.105-149.125 bit@149.165-149.305 like@149.345-149.505 somebody@149.565-149.925 tutting@150.005-150.345 under@150.405-150.565 their@150.605-150.765 breath,@150.805-151.125 " +
    "and@151.645-151.725 that's@151.765-151.945 easy@152.025-152.226 to@152.246-152.346 miss@152.406-152.646 with@152.706-152.846 the@152.866-152.946 storm@153.006-153.286 windows@153.326-153.666 shut.@153.746-154.006"
);
// Luca's job 412: the crossing (0:17-0:24), "revenge" (0:31-0:40), the nocturnal myth (1:39-1:48).
const crossing = T(
  "ribs,@17.489-17.789 steady@18.35-18.71 as@18.75-18.83 a@18.89-18.93 tightrope@18.99-19.47 walker,@19.51-19.85 because@20.291-20.531 she@20.591-20.731 has@20.751-20.871 made@20.931-21.111 this@21.151-21.291 crossing@21.351-21.751 a@21.892-21.952 hundred@22.052-22.412 times@22.452-22.772 before.@22.852-23.272 Then@23.913-24.133"
);
const revenge = T(
  "A@29.032-29.072 lot@29.112-29.232 of@29.272-29.332 people@29.392-29.672 call@29.732-29.973 this@29.993-30.133 random,@30.273-30.733 a@31.153-31.193 cat@31.253-31.493 just@31.553-31.733 being@31.833-32.114 a@32.154-32.194 cat.@32.254-32.594 " +
    "A@33.274-33.314 few@33.374-33.554 people,@33.614-33.995 half@34.275-34.495 awake@34.555-34.855 and@34.895-34.995 fully@35.135-35.395 annoyed,@35.455-35.875 call@36.116-36.336 it@36.376-36.436 revenge.@36.516-37.056 " +
    "Here's@37.736-37.916 the@37.957-38.037 thing@38.077-38.297 though,@38.337-38.557 it's@39.177-39.317 neither.@39.437-39.877"
);
const nocturnal = T(
  "not@99.087-99.387 your@99.568-99.848 clock.@99.888-100.208 There's@100.828-101.028 a@101.068-101.108 stubborn@101.188-101.569 old@101.629-101.789 myth@101.909-102.169 that@102.249-102.389 cats@102.449-102.729 are@102.789-102.849 nocturnal,@102.889-103.57 creatures@103.93-104.41 of@104.47-104.53 the@104.57-104.67 deep@104.75-105.01 night,@105.11-105.39 and@105.791-105.891 that's@105.911-106.111 mostly@106.191-106.511 a@106.551-106.591 costume@106.671-107.091 they@107.131-107.251 wear@107.271-107.452 in@107.492-107.552 cartoons.@107.612-108.232"
);
// Sam's job 414: the last skill (0:29-0:37), the title (0:47-1:12).
const lastSkill = T(
  "could@29.309-29.489 not@29.629-29.87 grow.@29.95-30.35 That@31.17-31.371 steel@31.491-31.991 is@32.591-32.671 why@32.731-32.872 the@32.912-33.012 last@33.112-33.452 skill@33.492-33.812 on@33.892-33.972 this@34.012-34.192 list@34.292-34.573 held@34.693-34.913 the@34.953-35.053 other@35.213-35.433 24@35.673-36.114 together.@36.154-36.594 I@37.795-37.875 am@37.935-38.055"
);
const title = T(
  "got@42.398-42.558 through@42.598-42.818 a@42.858-42.878 mountain@42.978-43.318 winter@43.398-43.698 on@43.779-43.859 a@43.899-43.939 woodlot@44.039-44.579 and@45.019-45.119 very@45.239-45.54 little@45.6-45.86 cash.@45.92-46.42 " +
    "The@47.181-47.281 title@47.341-47.721 says@47.801-48.061 Lost,@48.161-48.622 which@49.122-49.302 is@49.382-49.462 too@49.562-49.782 strong,@49.862-50.363 since@50.883-51.143 folk@51.243-51.524 schools@51.544-51.924 still@52.004-52.304 teach@52.364-52.624 plenty@52.744-53.105 of@53.145-53.185 these,@53.265-53.565 and@54.065-54.165 the@54.205-54.285 Foxfire@54.385-55.106 books@55.166-55.426 recorded@55.506-55.986 a@56.026-56.066 good@56.166-56.407 share.@56.487-56.887 " +
    "After@57.796-58.016 North@58.116-58.337 Georgia@58.397-58.817 high@58.877-59.077 school@59.117-59.378 students@59.438-59.878 began@59.958-60.319 interviewing@60.459-60.959 their@60.999-61.18 elders@61.32-61.7 in@62.021-62.101 the@62.121-62.181 1960s,@62.261-63.242 what@64.183-64.323 faded@64.423-64.783 was@64.843-64.964 the@65.004-65.104 everyday@65.244-65.664 habit,@65.704-66.085 so@66.525-66.645 we@66.685-66.765 will@66.785-66.946 go@66.986-67.106 from@67.186-67.326 that@67.366-67.526 cabin@67.626-68.047 roof@68.087-68.327 down@68.407-68.627 to@68.667-68.788 its@68.848-68.968 fire.@69.028-69.408 " +
    "Number@70.529-70.83 one@71.07-71.19 is@71.27-71.37 the@71.45-71.57 roof,@71.771-72.131 split@72.652-72.972 by@73.032-73.232 hand@73.372-73.753 from@73.853-74.013 white@74.153-74.413 oak@74.514-74.674 or@74.754-74.854 chestnut@74.934-75.495 with@75.535-75.675 a@75.715-75.735 fro,@75.835-76.235 and@77.056-77.156 the@77.196-77.296 direction@77.336-77.877 of@77.917-77.977 the@78.037-78.137 split@78.197-78.578 mattered@78.698-79.098 most.@79.178-79.559 " +
    "They@80.43-80.57 cut@80.63-80.83 the@80.87-80.97 log@81.05-81.43 into@81.49-81.69 short@81.79-82.071 bolts,@82.151-82.551 split@83.071-83.411 each@83.611-83.771 bolt@83.851-84.171 into@84.251-84.431 pie@84.491-84.831 wedges,@84.871-85.352"
);
// Gideon's jobs 401 / 409: the clock (1:00-1:06) and Seneca's opening (2:33-2:51).
const clock = T(
  "ahead@60.266-60.706 than@60.806-60.966 behind,@61.026-61.567 and@61.967-62.047 a@62.087-62.127 clock@62.187-62.487 that@62.527-62.647 was@62.687-62.807 background@62.907-63.408 noise@63.468-63.728 at@63.768-63.848 30@63.868-64.409 is@64.769-64.869 now@64.949-65.129 the@65.189-65.309 loudest@65.429-65.85 thing@65.89-66.07 in@66.11-66.15 the@66.19-66.29 room.@66.35-66.63"
);
const seneca = T(
  "Everyone@153.293-153.673 complains@153.733-154.353 that@154.433-154.593 life@154.693-154.934 is@155.014-155.094 too@155.174-155.374 short,@155.494-155.854 Seneca@156.294-156.695 says.@156.735-157.015 The@157.735-157.835 farmer@157.915-158.236 complains,@158.296-158.916 the@159.216-159.336 senator@159.416-159.836 complains,@159.896-160.517 the@160.897-161.017 old@161.197-161.397 complain,@161.497-162.078 and@162.438-162.518 the@162.538-162.638 young@162.718-163.038 are@163.178-163.298 already@163.439-163.819 rehearsing@163.879-164.419 the@164.459-164.539 complaint.@164.579-165.06 " +
    "Then@165.72-165.9 he@165.96-166.06 turns@166.12-166.42 the@166.48-166.6 whole@166.72-166.961 thing@167.021-167.221 over@167.381-167.601 in@167.741-167.841 a@167.861-167.901 single@168.061-168.381 motion.@168.441-168.862 Life@169.642-169.922 is@170.162-170.263 not@170.443-170.723 short.@170.843-171.183"
);
// Number cards that passed review: job 409's "17 summers left" and "seven of the thieves", job 406's
// "Nine times out of 10", job 397's "two in the morning", "15%." and "$10 off a $100 board".
const summers = T("He@29.059-29.139 has@29.199-29.379 about@29.439-29.659 17@29.799-30.44 summers@30.54-30.92 left.@30.98-31.3");
const thieves = T("you@96.294-96.394 will@96.434-96.574 be@96.614-96.694 able@96.754-96.934 to@96.974-97.054 name@97.114-97.334 all@97.594-97.774 seven@97.914-98.274 of@98.314-98.374 the@98.414-98.515 thieves.@98.575-98.975");
const fuel = T("Nine@125.103-125.303 times@125.323-125.563 out@125.623-125.743 of@125.783-125.823 10,@125.883-126.183 the@126.383-126.463 crime@126.523-126.783 is@126.843-126.923 stale@126.983-127.323 fuel@127.403-127.743 and@127.783-127.883 a@127.903-127.923 gummed@128.003-128.243 up@128.283-128.403 carburetor,@128.443-129.063");
const twoAm = T("open@80.059-80.259 at@80.299-80.379 two@80.499-80.719 in@80.759-80.839 the@80.859-80.959 morning,@81.019-81.38 and@81.58-81.68 a@81.72-81.76 buyer@81.82-82.18");
const adFee = T("that@149.877-150.077 order@150.177-150.397 carries@150.457-150.797 an@150.837-150.897 extra@151.117-151.457 fee@151.497-151.757 of@151.877-151.937 15%.@152.197-153.118");
const fees = T("Etsy's@138.337-138.717 regular@138.837-139.257 fees@139.317-139.658 take@139.738-139.938 roughly@139.998-140.318 $10@140.338-140.618 off@140.638-140.718 a@140.738-140.758 $100@140.778-140.938 board.@140.999-141.179");

describe("a number graphic counts a real figure, never a figure of speech (job 412's 'a hundred times before')", () => {
  it("412 hundred-crossings: 'made this crossing a hundred times before' means 'many' — the stored card is refused", () => {
    const spec: CueSpec = {
      id: "hundred-crossings",
      template: "BigNumberOverlay",
      start: "because she has made this crossing",
      startPad: -0.15,
      end: "a hundred times before",
      endPad: 0.3,
      props: { at: "@hundred", line: { text: "because she has made this crossing a", words: true }, unit: "times", value: 100, kicker: "Her crossing", countSec: 0.6 },
    };
    expect(figureOfSpeech(crossing, wordAt(crossing, "hundred"), 100)).toBe("a hundred times before.");
    expect(numberCardProblem(spec, resolved(spec, crossing), crossing)).toMatch(/^"a hundred times before\." is a figure of speech/);
  });

  it("411 bird-count: 'more than 100 years' is a fact, and a rate or a ratio of 'times' is a measure", () => {
    const spec: CueSpec = {
      id: "bird-count-hundred-years",
      template: "BigNumberOverlay",
      start: "the big holiday tally birders have",
      startPad: -0.15,
      end: "than a hundred years",
      endPad: 0.3,
      props: { at: "@a hundred years", line: { text: "the big holiday tally birders have kept going for more than", words: true }, unit: "years", value: 100, kicker: "Christmas Bird Count", countSec: 0.6 },
    };
    expect(numberCardProblem(spec, resolved(spec, birdCount), birdCount)).toBeUndefined();
    const said = (s: string, value: number) => {
      const words = s.split(" ").map((text, i) => ({ text, start: i, end: i + 0.5 }));
      return figureOfSpeech(words, 0, value);
    };
    expect(said("a hundred times faster than the old one.", 100)).toBeUndefined();
    expect(said("a hundred times a minute.", 100)).toBeUndefined();
    expect(said("a thousand times the size.", 1000)).toBeUndefined();
    // job 406's "Nine times out of 10": not a round figure
    expect(figureOfSpeech(fuel, 0, 9)).toBeUndefined();
    // the same figures of speech in other words
    expect(said("a million little reasons to quit.", 1e6)).toBe("a million little reasons to");
    expect(said("a thousand ways to get it wrong.", 1000)).toBe("a thousand ways to");
    expect(said("a hundred times over.", 100)).toBe("a hundred times over.");
  });

  it("a count a maker gives is no figure of speech: a hundred pieces sold, a thousand words a day; a million pieces is", () => {
    const said = (s: string, value: number) => {
      const words = s.split(" ").map((text, i) => ({ text, start: i, end: i + 0.5 }));
      return figureOfSpeech(words, 0, value);
    };
    expect(said("a hundred pieces at that fair.", 100)).toBeUndefined();
    expect(said("a thousand pieces in the puzzle.", 1000)).toBeUndefined();
    expect(said("a thousand words a day.", 1000)).toBeUndefined();
    expect(said("a hundred questions per class.", 100)).toBeUndefined();
    expect(said("a million pieces on the floor.", 1e6)).toBe("a million pieces on");
  });
});

describe("a number's unit is the words said right after it (job 414's '24 skills' for '24 together')", () => {
  const skills = (unit?: string): CueSpec => ({
    id: "twenty-four-skills",
    template: "BigNumber",
    start: "That steel is why the last",
    startPad: -0.15,
    end: "the other twenty-four together",
    endPad: 0.3,
    props: { at: "@twenty-four", line: { text: "That steel is why the last skill on this list held the other", words: true }, ...(unit ? { unit } : {}), value: 24, kicker: "The last skill", countSec: 0.6 },
  });

  it("414 twenty-four-skills: 'skills' is never said after 24 (only 'the last skill' before it) — refused, naming what is said", () => {
    expect(unitNotSaid("skills", lastSkill, wordAt(lastSkill, "24"), 24)).toBe("24 together.");
    expect(numberCardProblem(skills("skills"), resolved(skills("skills"), lastSkill), lastSkill)).toBe(
      'its unit "skills" is not what he says after the number — he says "24 together.". The unit is the word or two he says RIGHT AFTER the number, or none: leave "unit" out, or use those words'
    );
  });

  it("the same card with the words he says after the number, or with none, is placed", () => {
    for (const unit of ["together", undefined]) expect(numberCardProblem(skills(unit), resolved(skills(unit), lastSkill), lastSkill)).toBeUndefined();
  });

  it("units the films said are kept: 'summers left', 'seven of the thieves', 'out of 10', 'a.m.' for 'in the morning', '%'", () => {
    expect(unitNotSaid("summers left", summers, wordAt(summers, "17"), 17)).toBeUndefined();
    expect(unitNotSaid("thieves", thieves, wordAt(thieves, "seven"), 7)).toBeUndefined();
    expect(unitNotSaid("out of 10", fuel, wordAt(fuel, "Nine"), 9)).toBeUndefined();
    expect(unitNotSaid("a.m.", twoAm, wordAt(twoAm, "two"), 2)).toBeUndefined();
    expect(unitNotSaid("%", adFee, wordAt(adFee, "15%."), 15)).toBeUndefined();
    expect(unitNotSaid("years", birdCount, wordAt(birdCount, "100"), 100)).toBeUndefined();
  });

  it("job 397's '$10 in fees' for '$10 off a $100 board' would be refused today (an approved card is kept as it is)", () => {
    expect(unitNotSaid("in fees", fees, wordAt(fees, "$10"), 10)).toBe("$10 off a $100 board.");
  });

  it("a sign the transcriber writes on the number is said after it, and a unit said in the singular as a describing word is the same unit", () => {
    // "$10" is "ten dollars", "15%." is "fifteen percent": the unit spelled out is said
    expect(unitNotSaid("dollars", fees, wordAt(fees, "$10"), 10)).toBeUndefined();
    expect(unitNotSaid("percent", adFee, wordAt(adFee, "15%."), 15)).toBeUndefined();
    const w = "It was 40° outside, so leave a two-inch overhang on a six-foot fence.".split(" ").map((text, i) => ({ text, start: i, end: i + 0.5 }));
    expect(unitNotSaid("degrees", w, 2, 40)).toBeUndefined();
    expect(unitNotSaid("inches", w, 7, 2)).toBeUndefined();
    expect(unitNotSaid("feet", w, 11, 6)).toBeUndefined();
    // and the unit is still what is said: the same fence is not 6 "yards"
    expect(unitNotSaid("yards", w, 11, 6)).toBe("six-foot fence.");
  });
});

describe("a myth stamp stamps the belief the voice calls false (jobs 412 and 414)", () => {
  const stamp = (id: string, start: string, end: string, at: string, phrase?: string): CueSpec => ({
    id,
    template: "MythStamp",
    start,
    startPad: -0.15,
    end,
    endPad: 0.3,
    props: { at, label: "Myth", ...(phrase ? { phrase: { text: phrase, words: true } } : {}) },
  });

  it("414 title-says-lost: 'The title says lost' is the host's own true statement — refused", () => {
    const spec = stamp("title-says-lost", "The title says lost, which", "The title says lost", "@says lost", "The title says lost");
    expect(mythStampProblem(spec, resolved(spec, title), title)).toMatch(/^"The title says lost" is the host's own true statement about a claim/);
  });

  it("the host saying or naming something, or the film's own title, is never the belief; someone else's claim may be", () => {
    const own = (phrase: string) =>
      mythStampProblem({ id: "m", template: "MythStamp", start: "x", props: { at: "@x", label: "Myth", phrase: { text: phrase, words: true } } }, { sync: [] } as unknown as ResolvedCue, []);
    expect(own("I called it the strongest glue there is")).toMatch(/host's own true statement/);
    expect(own("So this video's title says forgotten")).toMatch(/host's own true statement/);
    expect(own("My book says to wait a week")).toMatch(/host's own true statement/);
    expect(own("Her book says to wait a week")).toBeUndefined();
    expect(own("I always thought the paint was dry")).toBeUndefined();
    // a bare "the title" is the film's own only when it then says something; "the video game…" may be the belief
    expect(own("The title is too strong")).toMatch(/host's own true statement/);
    expect(own("The video game makes kids violent")).toBeUndefined();
    expect(own("The headline rate is what you pay")).toBeUndefined();
  });

  it("414: a stamp on what follows ('Since folk schools still teach plenty of these') is refused — he only softens the title, never calls anything false", () => {
    const spec = stamp("folk-schools", "since folk schools still teach", "plenty of these,", "@folk schools", "Since folk schools still teach plenty of these");
    expect(mythStampProblem(spec, resolved(spec, title), title)).toMatch(/is stamped MYTH, but nothing he says around it calls it false/);
  });

  it("412 revenge-myth and 411 myth-robins-gone: MYTH with no phrase never says what the myth is — refused", () => {
    const rev = stamp("revenge-myth", "A few people, half awake", "call it revenge", "@call it revenge");
    expect(mythStampProblem(rev, resolved(rev, revenge), revenge)).toMatch(/^MYTH is stamped with no "phrase"/);
    const gone = stamp("myth-robins-gone", "and nobody sees another robin", "another robin until spring", "@nobody sees another robin");
    expect(mythStampProblem(gone, resolved(gone, robinsOpening), robinsOpening)).toMatch(/^MYTH is stamped with no "phrase"/);
  });

  it("the same beliefs with their phrase are placed: he calls them false ('that's what just about everybody figures… never leave', 'it's neither')", () => {
    const gone = stamp("myth-robins-gone", "and nobody sees another robin", "another robin until spring", "@nobody sees another robin", "Nobody sees another robin until spring.");
    expect(mythStampProblem(gone, resolved(gone, robinsOpening), robinsOpening)).toBeUndefined();
    const random = stamp("random-myth", "A lot of people call this", "call this random,", "@call this random", "A lot of people call this random,");
    expect(mythStampProblem(random, resolved(random, revenge), revenge)).toBeUndefined();
  });

  it("the clean stamps of 412 and 401 are unchanged: 'a stubborn old myth that cats are nocturnal', and Seneca's 'Life is not short.' three sentences on", () => {
    const night = stamp("nocturnal-myth", "There’s a stubborn old myth", "that cats are nocturnal", "@cats are nocturnal", "There’s a stubborn old myth that cats are nocturnal");
    expect(mythStampProblem(night, resolved(night, nocturnal), nocturnal)).toBeUndefined();
    const life = stamp("life-too-short-myth", "Everyone complains that life is too", "life is too short", "@life is too short", "Everyone complains that life is too short");
    expect(mythStampProblem(life, resolved(life, seneca), seneca)).toBeUndefined();
  });
});

describe("a before and after is a change the voice says (job 411's 'Hardly sings → Soft clucking')", () => {
  const card = (start: string, end: string, before: Record<string, unknown>, after: Record<string, unknown>, kicker: string): CueSpec => ({
    id: "before-after",
    template: "BeforeAfter",
    start,
    startPad: -0.15,
    end,
    endPad: 0.3,
    props: { kicker, before, after },
  });

  it("411 winter-voice: both sides are what a robin does in winter — refused", () => {
    const spec = card("and through the winter a robin", "tutting under their breath", { at: "@hardly sings at all", label: "Hardly sings" }, { at: "@a low, soft clucking", label: "Soft clucking" }, "In winter");
    const c = resolved(spec, winterSong);
    expect(beforeAfterProblem(spec, c, winterSong)).toBe(
      '"Hardly sings" → "Soft clucking" is no before and after: "hardly sings at all. Mostly you\'ll hear a low, soft clucking," says no change between two times or states (no "now", "used to", "became", "instead", no then against now) — the arrow says one turned into the other. Two sides of one state are shown another way (a caption), or not at all'
    );
  });

  it("401 clock-before-after: 'a clock that was background noise at 30 is now the loudest thing in the room' is unchanged", () => {
    const spec = card(
      "and a clock that was background",
      "the loudest thing in the room",
      { at: "@background noise at thirty", label: "Background noise at thirty" },
      { at: "@the loudest thing in the room", label: "The loudest thing now" },
      "The clock"
    );
    expect(beforeAfterProblem(spec, resolved(spec, clock), clock)).toBeUndefined();
  });

  it("a change said by a past and a present state, or by two seasons, is a before and after; one season said twice is not", () => {
    const words = (s: string) => s.split(" ").map((text, i) => ({ text, start: i, end: i + 0.5 }));
    const span = (w: Word[], a: [number, number], b: [number, number]) => changeSaid(w, { first: a[0], last: a[1] }, { first: b[0], last: b[1] });
    // "the shelf was empty. Today it is full." — a time set against another
    expect(span(words("the shelf was empty. Today it is full."), [0, 3], [5, 7])).toBe(true);
    // "the board was rough, and it is smooth." — was … is
    expect(span(words("the board was rough, and it is smooth."), [3, 3], [7, 7])).toBe(true);
    // "In summer it sings all day; in winter it barely chirps." — two seasons
    expect(span(words("In summer it sings all day; in winter it barely chirps."), [2, 5], [8, 10])).toBe(true);
    // "In winter it barely chirps; mostly it just clucks." — one season, said two ways
    expect(span(words("In winter it barely chirps; mostly it just clucks."), [2, 4], [6, 8])).toBe(false);
    // "may" and "fall" are a time only where a word names one: "it may barely chirp" is no second season…
    expect(span(words("In winter it may barely chirp; mostly it just clucks."), [3, 5], [7, 9])).toBe(false);
    expect(span(words("In winter the leaves fall and it barely chirps; mostly it clucks."), [4, 8], [10, 11])).toBe(false);
    // …"in March" and "by May" are
    expect(span(words("In March it barely chirps; by May it sings all day."), [2, 4], [8, 10])).toBe(true);
    // an old way the viewer is told to stop, and the new one: the catalogue's "old way replaced by a new one"
    expect(span(words("Stop rinsing it with bleach; use plain vinegar."), [1, 4], [5, 7])).toBe(true);
  });
});

describe("the catalogue states the four rules up front", () => {
  const prompt = systemPrompt({ kept: false });
  it("BigNumber: a real figure, and the unit said right after the number", () => {
    expect(prompt).toContain('a round number said to mean "many"');
    expect(prompt).toContain('The "unit" is the word or\n  two he says RIGHT AFTER the number');
  });
  it("BeforeAfter: the line says the change; MythStamp: the belief itself, called false, the phrase required", () => {
    expect(prompt).toContain("Two things true at the SAME time");
    expect(prompt).toContain('"phrase": phrase (REQUIRED, ≤10 words)');
    expect(prompt).toContain("Never the host's own true statement about a claim");
  });
});
