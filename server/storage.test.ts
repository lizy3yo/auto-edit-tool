import { afterEach, expect, test, vi } from "vitest";
import { rehostToR2 } from "./storage";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("rehostToR2 passes through URLs already on R2 without fetching", async () => {
  vi.stubEnv("R2_PUBLIC_URL", "https://cdn.example.com");
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);

  const url = "https://cdn.example.com/refs/cover-abc.jpg";
  await expect(rehostToR2(url, "cover")).resolves.toBe(url);
  expect(fetchSpy).not.toHaveBeenCalled();
});
