/**
 * scripts/mock-store.ts — a throwaway stand-in for the real webstore.
 *
 * It does exactly the three things the SvelteKit store has to do, and nothing else:
 *
 *   1. catch `?ref=` on arrival and put it in a cookie      (their hooks.server.ts)
 *   2. save that ref on the order when payment clears        (their order table)
 *   3. POST the sale to this app's /api/sales                (their Stripe webhook)
 *
 * Point a book's shop link at it, render a video in MOCK MODE, then click the tracking link the
 * app gives you and press Buy. If the sale shows up under that video, the whole attribution loop
 * works — before a single line of the real store is written.
 *
 * Orders live in memory and vanish on restart. This is a test rig, not a shop.
 *
 *   npx tsx scripts/mock-store.ts          → http://localhost:4000
 *
 * Delete this file once the real store is wired up.
 */
import "dotenv/config";
import express from "express";

const PORT = Number(process.env.MOCK_STORE_PORT ?? 4000);
/**
 * Where to report sales. Defaults to LOCALHOST and deliberately ignores `PUBLIC_BASE_URL` — that
 * points at production, and a test rig that quietly writes fake orders into the live database is
 * worse than one that doesn't run. Override explicitly if you really mean to point elsewhere.
 */
const VIDEO_APP_URL = (
  process.env.MOCK_STORE_VIDEO_APP_URL ?? "http://localhost:3000"
).replace(/\/$/, "");
const SECRET = process.env.SALES_SECRET ?? "";

/** In-memory orders. A real store would write these to its database — that is step 2. */
type Order = {
  id: string;
  productId: string;
  ref: string | null;
  amountCents: number;
  at: string;
  reported: string;
};
const orders: Order[] = [];
let counter = 0;

const app = express();
app.use(express.urlencoded({ extended: true }));

// ── STEP 1 ────────────────────────────────────────────────────────────────
// Catch the tag on arrival and hold it in a cookie.
//
// This is the SvelteKit `hooks.server.ts` equivalent. `SameSite=Lax` is REQUIRED: with `Strict`
// the cookie is not sent when the visitor arrives from another site — which is every single
// visitor coming from YouTube.
app.use((req, res, next) => {
  const ref = typeof req.query.ref === "string" ? req.query.ref : null;
  if (ref && /^[0-9]{1,12}$/.test(ref)) {
    res.setHeader(
      "Set-Cookie",
      `ref=${ref}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax; HttpOnly`
    );
    (req as any).freshRef = ref;
  }
  next();
});

/** Read one cookie without pulling in a parser dependency. */
function cookie(req: express.Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, c =>
    c === "&"
      ? "&amp;"
      : c === "<"
        ? "&lt;"
        : c === ">"
          ? "&gt;"
          : c === '"'
            ? "&quot;"
            : "&#39;"
  );

const page = (body: string) => `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mock Store</title>
<style>
 body{font:16px/1.6 system-ui,sans-serif;max-width:44rem;margin:3rem auto;padding:0 1.25rem;
      background:#0f1115;color:#e6e8ec}
 .card{border:1px solid #2a2f3a;border-radius:12px;padding:1.25rem;margin:1rem 0;background:#161a21}
 .ok{color:#4ade80} .bad{color:#fbbf24} .muted{color:#8b93a3;font-size:.875rem}
 code{background:#0b0d11;padding:.15rem .4rem;border-radius:5px;font-size:.875rem}
 button{font:inherit;padding:.7rem 1.4rem;border-radius:9px;border:0;background:#4f7cff;
        color:#fff;cursor:pointer}
 table{border-collapse:collapse;width:100%;font-size:.875rem}
 td,th{border-bottom:1px solid #2a2f3a;padding:.5rem;text-align:left}
 a{color:#7aa2ff}
</style>
${body}`;

// ── The product page ──────────────────────────────────────────────────────
app.get("/buy/:productId", (req, res) => {
  const productId = req.params.productId;
  const ref = cookie(req, "ref") ?? (req as any).freshRef ?? null;
  res.send(
    page(`
<h1>Mock Store</h1>
<div class="card">
  <h2 style="margin:0 0 .5rem">${esc(productId)}</h2>
  <p class="muted">$11.00</p>
  <form method="post" action="/checkout">
    <input type="hidden" name="productId" value="${esc(productId)}">
    <button type="submit">Buy now</button>
  </form>
</div>
<div class="card">
  <strong>Step 1 — did the tag arrive?</strong><br>
  ${
    ref
      ? `<span class="ok">Yes — <code>ref=${esc(ref)}</code> is in the cookie.</span>
         <p class="muted">This survives browsing. Buy now and it lands on the order.</p>`
      : `<span class="bad">No tag.</span>
         <p class="muted">You arrived without <code>?ref=</code>. That is a direct visit —
         the sale will record as unattributed, which is correct behaviour.</p>`
  }
</div>
<p class="muted"><a href="/orders">See recorded orders →</a></p>
`)
  );
});

// ── STEPS 2 + 3 ───────────────────────────────────────────────────────────
app.post("/checkout", async (req, res) => {
  const productId = String(req.body.productId ?? "unknown");
  // STEP 2 — the ref goes onto the ORDER. This is the load-bearing line: without it, nothing
  // downstream can attribute anything.
  const ref = cookie(req, "ref");
  const order: Order = {
    id: `mock_${++counter}_${Date.now()}`,
    productId,
    ref,
    amountCents: 1100,
    at: new Date().toISOString(),
    reported: "…",
  };
  orders.unshift(order);

  // STEP 3 — tell the video app. Server-side, after "payment", never fatal.
  if (!SECRET) {
    order.reported = "skipped — SALES_SECRET not set in .env";
  } else {
    try {
      const r = await fetch(`${VIDEO_APP_URL}/api/sales`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-sales-secret": SECRET,
        },
        body: JSON.stringify({
          ref: order.ref,
          orderId: order.id,
          amountCents: order.amountCents,
          currency: "USD",
          productId: order.productId,
        }),
        signal: AbortSignal.timeout(5000),
      });
      const text = await r.text();
      order.reported = `HTTP ${r.status} ${text}`;
    } catch (err: any) {
      // A real store MUST swallow this — the customer has paid either way.
      order.reported = `failed: ${err?.message}`;
    }
  }
  res.redirect("/orders");
});

app.get("/orders", (req, res) => {
  res.send(
    page(`
<h1>Orders</h1>
<p class="muted">What a real store would have in its <code>orders</code> table, plus what it
told the video app.</p>
${
  orders.length === 0
    ? `<div class="card">Nothing yet. Open a tracking link and press Buy.</div>`
    : `<div class="card"><table>
<tr><th>Order</th><th>Product</th><th>ref</th><th>Reported to video app</th></tr>
${orders
  .map(
    o => `<tr>
  <td><code>${esc(o.id)}</code></td>
  <td>${esc(o.productId)}</td>
  <td>${o.ref ? `<span class="ok">${esc(o.ref)}</span>` : `<span class="bad">none</span>`}</td>
  <td class="muted">${esc(o.reported)}</td>
</tr>`
  )
  .join("")}
</table></div>`
}
<p class="muted"><a href="/">← back</a></p>
`)
  );
});

app.get("/", (_req, res) => {
  res.send(
    page(`
<h1>Mock Store</h1>
<div class="card">
  <p>Stands in for your Svelte webstore so the tracking loop can be tested end to end.</p>
  <p class="muted">Reporting sales to <code>${esc(VIDEO_APP_URL)}</code><br>
  Secret ${SECRET ? `<span class="ok">loaded</span>` : `<span class="bad">MISSING — set SALES_SECRET in .env</span>`}</p>
</div>
<div class="card">
  <strong>How to use it</strong>
  <ol>
    <li>Admin → Books: set a book's shop link to
        <code>http://localhost:${PORT}/buy/your-book</code></li>
    <li>Render a video with that book (turn on mock mode first — no credits)</li>
    <li>Copy the tracking link the app gives you and open it here</li>
    <li>Press Buy</li>
    <li>The sale appears under that video in the app</li>
  </ol>
</div>
<div class="card">
  <strong>Try it without a render</strong>
  <p class="muted">Any job id works — replace 12 with one of yours:</p>
  <p><a href="/buy/test-book?ref=12">/buy/test-book?ref=12</a></p>
</div>
<p class="muted"><a href="/orders">Recorded orders →</a></p>
`)
  );
});

app.listen(PORT, () => {
  console.log(`\nMock store  →  http://localhost:${PORT}`);
  console.log(`Reporting sales to  ${VIDEO_APP_URL}/api/sales`);
  if (!/localhost|127\.0\.0\.1/.test(VIDEO_APP_URL)) {
    console.log(
      `
*** WARNING: that is NOT localhost. Fake orders will be written there. ***
`
    );
  }
  if (!SECRET)
    console.log(`WARNING: SALES_SECRET is not set — step 3 will be skipped.`);
  console.log(`\nCtrl-C to stop. Orders are in memory only.\n`);
});
