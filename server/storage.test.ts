import { afterEach, expect, test, vi } from "vitest";
import { presignOwnBucketUrl, rehostToR2 } from "./storage";

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

// NOTE: this one runs FIRST on purpose. `getS3Client` memoizes the client in a module-level
// `s3Client`, so once a test presigns successfully the credential check never runs again and
// this case would silently pass through the cached client instead of the fallback path.
test("presignOwnBucketUrl falls back to the public URL when R2 creds are missing", async () => {
  vi.stubEnv("R2_PUBLIC_URL", "https://pub-abc.r2.dev");
  vi.stubEnv("R2_ACCOUNT_ID", "");
  vi.stubEnv("R2_ACCESS_KEY_ID", "");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "");

  const url = "https://pub-abc.r2.dev/jobs/1/seg-0.mp3";
  await expect(presignOwnBucketUrl(url)).resolves.toBe(url);
});

test("presignOwnBucketUrl leaves URLs outside our bucket untouched", async () => {
  vi.stubEnv("R2_PUBLIC_URL", "https://pub-abc.r2.dev");

  // A provider result, and a lookalike host that must not be treated as ours.
  for (const url of [
    "https://resource.heygen.ai/video/xyz.mp4",
    "https://pub-abc.r2.dev.attacker.test/seg-0.mp3",
  ]) {
    await expect(presignOwnBucketUrl(url)).resolves.toBe(url);
  }
});

test("presignOwnBucketUrl rewrites our own public URLs onto the S3 endpoint", async () => {
  vi.stubEnv("R2_PUBLIC_URL", "https://pub-abc.r2.dev/");
  vi.stubEnv("R2_ACCOUNT_ID", "acct123");
  vi.stubEnv("R2_ACCESS_KEY_ID", "key");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
  vi.stubEnv("R2_BUCKET", "longform");

  const signed = await presignOwnBucketUrl(
    "https://pub-abc.r2.dev/jobs/1/seg-0.mp3"
  );
  const u = new URL(signed);

  // The whole point: a different hostname from the public one. The SDK addresses R2
  // virtual-hosted style, so the bucket is a subdomain rather than the first path segment.
  expect(u.host).toBe("longform.acct123.r2.cloudflarestorage.com");
  expect(u.pathname).toBe("/jobs/1/seg-0.mp3");
  expect(u.searchParams.get("X-Amz-Signature")).toBeTruthy();
});
