import { describe, expect, it } from "vitest";
import {
  MAX_HOST_REGENERATIONS,
  canOverrideHostRegenLimit,
  hostRegenerationLocked,
  hostRegenerationsUsed,
  isLimitedHostScene,
} from "../shared/hostRegenLimit";
import type { SceneSubmit, StoryboardScene } from "../shared/types";

const submit = (reason: SceneSubmit["reason"]): SceneSubmit => ({
  provider: "heygen",
  at: "2026-09-23T00:00:00.000Z",
  reason,
});

const host = (submits: SceneSubmit[]): StoryboardScene => ({
  index: 3,
  narration: "n",
  visualPrompt: "host on camera",
  hostPresent: true,
  submits,
});

describe("host regenerate limit", () => {
  it("counts only operator regenerations — automatic retries do not eat the operator's two", () => {
    const s = host([
      submit("first"),
      submit("transient"),
      submit("infra"),
      submit("resume"),
      submit("retry"),
    ]);
    expect(hostRegenerationsUsed(s)).toBe(0);
    expect(hostRegenerationLocked(s)).toBe(false);
  });

  it("locks after MAX_HOST_REGENERATIONS regenerations, not before", () => {
    const one = host([submit("first"), submit("regenerate")]);
    expect(hostRegenerationLocked(one)).toBe(false);
    const two = host([
      submit("first"),
      ...Array.from({ length: MAX_HOST_REGENERATIONS }, () =>
        submit("regenerate")
      ),
    ]);
    expect(hostRegenerationsUsed(two)).toBe(MAX_HOST_REGENERATIONS);
    expect(hostRegenerationLocked(two)).toBe(true);
  });

  it("never locks a b-roll scene or a split — neither regenerate touches the lip-sync lane", () => {
    const many = Array.from({ length: 5 }, () => submit("regenerate"));
    expect(hostRegenerationLocked({ ...host(many), hostPresent: false })).toBe(
      false
    );
    expect(
      hostRegenerationLocked({ ...host(many), splitVisual: "a still" })
    ).toBe(false);
    expect(isLimitedHostScene({ ...host([]), splitVisual: "a still" })).toBe(
      false
    );
  });

  it("a scene predating the ledger has no regenerations on record and is not locked", () => {
    expect(hostRegenerationLocked({ ...host([]), submits: undefined })).toBe(
      false
    );
  });

  it("admins and managers may override; editors may not", () => {
    expect(canOverrideHostRegenLimit("admin")).toBe(true);
    expect(canOverrideHostRegenLimit("manager")).toBe(true);
    expect(canOverrideHostRegenLimit("editor")).toBe(false);
  });
});
