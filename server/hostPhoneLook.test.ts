import { describe, expect, it } from "vitest";
import { parseHostSetting, phoneLookPrompt, PLAIN_SETTING } from "./hostPhoneLook";

describe("the phone-look recipe", () => {
  it("reads the setting the model describes, capped and cleaned", () => {
    const s = parseHostSetting(
      'Here: {"seat": "sitting at a workbench in a woodshop.", "place": "in the woodshop", "things": "a pegboard of hand tools, lumber racks, a window"}'
    );
    expect(s).toEqual({
      seat: "sitting at a workbench in a woodshop",
      place: "in the woodshop",
      things: "a pegboard of hand tools, lumber racks, a window",
    });
  });
  it("falls back to the plain setting when the answer cannot be read", () => {
    expect(parseHostSetting("sorry")).toEqual(PLAIN_SETTING);
    expect(parseHostSetting('{"seat": ""}').seat).toBe(PLAIN_SETTING.seat);
  });
  it("puts the setting into the approved recipe: phone framing, plain light, hands down", () => {
    const p = phoneLookPrompt({ seat: "sitting at a kitchen table", place: "in the kitchen", things: "a stove, a shelf of jars" });
    expect(p).toContain("sitting at a kitchen table");
    expect(p).toContain("a stove, a shelf of jars");
    expect(p).toMatch(/propped up in front of them/);
    expect(p).toMatch(/Framed from the chest up/);
    expect(p).toMatch(/No studio light, no rim light, no golden glow/);
    expect(p).toMatch(/not raised, not gesturing/);
    expect(p).toMatch(/No text, logos or brand names/);
  });
});
