import { describe, it, expect } from "vitest";
import { summarizeHttpBody } from "./errorDetail";

/** Trimmed from the real 521 page 69labs.vip served on 2026-09-01 — ~6 KB verbatim in the UI. */
const CLOUDFLARE_521 = `<!DOCTYPE html>
<!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->
<html class="no-js" lang="en-US">
<head>
<title>69labs.vip | 521: Web server is down</title>
<meta charset="UTF-8" />
<link rel="stylesheet" id="cf_styles-css" href="/cdn-cgi/styles/main.css" />
</head>
<body>
<div id="cf-wrapper"><div id="cf-error-details" class="p-0">
<header><h1 class="inline-block"><span class="inline-block">Web server is down</span>
<span class="code-label">Error code 521</span></h1>
<div>Visit <a href="https://www.cloudflare.com/5xx-error-landing">cloudflare.com</a> for more information.</div>
<div class="mt-3">2026-09-01 23:10:40 UTC</div></header>
<div class="w-1/2"><h2>What happened?</h2><p>The web server is not returning a connection.</p></div>
<p class="text-13"><span class="cf-footer-item">Cloudflare Ray ID: <strong class="font-semibold">a347f31acb97798d</strong></span>
<span id="cf-footer-ip" class="hidden">223.25.59.156</span>
<span>Performance &amp; security by</span> <a href="https://www.cloudflare.com/">Cloudflare</a></p>
<script>(function(){var a=document;})();</script>
</div></div></body></html>`;

describe("summarizeHttpBody", () => {
  it("collapses a Cloudflare 521 page to its title and Ray ID", () => {
    const out = summarizeHttpBody(CLOUDFLARE_521);
    expect(out).toBe(
      "69labs.vip | 521: Web server is down [Cloudflare error page, Ray a347f31acb97798d]"
    );
    expect(out).not.toContain("<");
    // The visitor IP on the page is not diagnostic and should never reach a job row.
    expect(out).not.toContain("223.25.59.156");
  });

  it("falls back to the heading when an HTML page has no title", () => {
    const out = summarizeHttpBody(
      "<html><body><h1>502 Bad Gateway</h1><hr><center>nginx</center></body></html>"
    );
    expect(out).toBe("502 Bad Gateway [HTML error page]");
  });

  it("picks the message out of a JSON error envelope", () => {
    expect(
      summarizeHttpBody(
        JSON.stringify({
          error: {
            code: "invalid_voice",
            message: "This voice ID was not found",
          },
        })
      )
    ).toBe("This voice ID was not found (invalid_voice)");
    expect(summarizeHttpBody('{"message":"Insufficient credits"}')).toBe(
      "Insufficient credits"
    );
    expect(summarizeHttpBody('{"error":"DUPLICATE_TTS_IN_PROGRESS"}')).toBe(
      "DUPLICATE_TTS_IN_PROGRESS"
    );
  });

  it("keeps a JSON body without a message field, compacted and capped", () => {
    const out = summarizeHttpBody(
      '{ "status": 500,\n  "trace": "' + "x".repeat(600) + '" }',
      80
    );
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.startsWith('{"status":500,"trace":"xxx')).toBe(true);
    expect(out.endsWith("…")).toBe(true);
  });

  it("collapses whitespace in plain text and caps it", () => {
    expect(summarizeHttpBody("  upstream\n\n   timed   out  ")).toBe(
      "upstream timed out"
    );
    expect(summarizeHttpBody("a".repeat(500), 100)).toHaveLength(100);
  });

  it("names an empty body instead of returning nothing", () => {
    expect(summarizeHttpBody("")).toBe("(empty response body)");
    expect(summarizeHttpBody(undefined)).toBe("(empty response body)");
  });
});
