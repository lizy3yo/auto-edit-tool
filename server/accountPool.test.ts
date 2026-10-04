import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PROVIDER_ACCOUNT_MAX,
  apimartAccountOf,
  countByAccount,
  heygenAccountOf,
  pickLeastBusyAccount,
} from "../shared/accountPool";

describe("pickLeastBusyAccount", () => {
  it("takes the account with the fewest videos running", () => {
    expect(pickLeastBusyAccount([0, 1, 2], [0, 0, 1])).toBe(2);
    expect(pickLeastBusyAccount([0, 1, 2], [0, 2, 2, 1, 1])).toBe(0);
  });

  it("takes the lowest number on a tie, whatever order the accounts come in", () => {
    expect(pickLeastBusyAccount([0, 1, 2], [])).toBe(0);
    expect(pickLeastBusyAccount([4, 2, 3], [2, 3, 4])).toBe(2);
  });

  it("spreads videos started one after another across every account", () => {
    const busy: number[] = [];
    for (let i = 0; i < 6; i++) busy.push(pickLeastBusyAccount([0, 1, 2], busy)!);
    expect(busy).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it("only ever picks an account that has a key", () => {
    // Accounts 0 and 1 have no key: however idle, they are never chosen.
    expect(pickLeastBusyAccount([2, 5], [2, 2, 2])).toBe(5);
    expect(pickLeastBusyAccount([], [0, 1])).toBeNull();
  });

  it("ignores videos with no account, and videos on an account since removed", () => {
    expect(pickLeastBusyAccount([0, 1], [null, null, 7, 7, 0])).toBe(1);
  });

  it("works past the five accounts the tabs used to allow", () => {
    const all = Array.from({ length: PROVIDER_ACCOUNT_MAX }, (_, i) => i);
    expect(pickLeastBusyAccount(all, all.slice(0, 6))).toBe(6);
  });
});

describe("a job's accounts", () => {
  it("uses the account picked at Generate", () => {
    const params = { apimartAccount: 6, heygenAccount: 0, apimartSlot: 3 };
    expect(apimartAccountOf(params)).toBe(6);
    expect(heygenAccountOf(params)).toBe(0);
  });

  it("a job made before the pool keeps its tab's account for both providers", () => {
    expect(apimartAccountOf({ apimartSlot: 3 })).toBe(3);
    expect(heygenAccountOf({ apimartSlot: 3 })).toBe(3);
    // Account 0 is a real account, not "unset".
    expect(apimartAccountOf({ apimartSlot: 0 })).toBe(0);
  });

  it("has none when nothing was picked and it had no tab", () => {
    expect(apimartAccountOf({})).toBeNull();
    expect(heygenAccountOf({ apimartAccount: 2 })).toBeNull();
    expect(apimartAccountOf({ apimartAccount: null, apimartSlot: null })).toBeNull();
  });

  it("counts running videos per account", () => {
    expect([...countByAccount([1, 1, null, 4])]).toEqual([
      [1, 2],
      [4, 1],
    ]);
  });
});

/**
 * TRIPWIRE. A video's provider key is read in exactly one place — `apimartKeyForJob` /
 * `heygenKeyForJob` — so "which account is this video on" has one answer. A new
 * `params.apimartSlot ? getApimartSlotKey(…)` anywhere else would put that video back on its tab
 * number's key while the pool believes it is on another account.
 */
describe("one reader of a job's key", () => {
  const serverDir = __dirname;
  const files = readdirSync(serverDir, { recursive: true })
    .map(String)
    .filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("no server file reads a job's tab number to find a key", () => {
    const offenders = files.filter(f =>
      /(?:params|inputParams)\??\.apimartSlot\b/.test(
        readFileSync(path.join(serverDir, f), "utf8")
      )
    );
    expect(offenders).toEqual([]);
  });

  it("a HeyGen test or VSL run is given its account by the server, never by the page", () => {
    const routers = readFileSync(path.join(serverDir, "routers.ts"), "utf8");
    const starts = [
      ...routers.matchAll(
        /^  ([a-zA-Z0-9_]+): (?:approved|manager|admin)Procedure/gm
      ),
    ];
    const takesAccount = starts
      .map((m, i) => ({
        name: m[1],
        body: routers.slice(m.index!, starts[i + 1]?.index ?? routers.length),
      }))
      .filter(
        r => r.body.includes("startHeygenTest(") && /\baccount:/.test(r.body)
      )
      .map(r => r.name);
    expect(takesAccount).toEqual([]);
    // The engine has one key lookup (`heygenKeyFor`), fed by the run's own stored account.
    const engine = readFileSync(path.join(serverDir, "heygenTest.ts"), "utf8");
    expect(engine.match(/getHeygen(?:Slot|Test)Key\(/g)?.length).toBe(2);
    expect(engine).toContain("assignHeygenTestAccount(");
  });

  it("the per-account key getters are called with a job's params nowhere but the helpers", () => {
    const offenders = files.filter(f =>
      /get(?:Apimart|Heygen)SlotKey\(\s*(?:params|job)\b/.test(
        readFileSync(path.join(serverDir, f), "utf8")
      )
    );
    expect(offenders).toEqual([]);
  });
});
