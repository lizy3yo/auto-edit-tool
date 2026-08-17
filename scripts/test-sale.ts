/**
 * scripts/test-sale.ts — send a FAKE sale to this app's own /api/sales endpoint.
 *
 * The point: prove the whole attribution path works before a single real order exists. It sends
 * exactly what the webstore will send, so a pass here means the only thing left to verify is the
 * store's own three changes.
 *
 * No provider calls, no credits, no real money. Reads SALES_SECRET from .env so the secret never
 * has to be typed on a command line (where it lands in shell history).
 *
 *   npx tsx scripts/test-sale.ts <jobId> [productId] [amountInDollars]
 *
 * Examples:
 *   npx tsx scripts/test-sale.ts 183
 *   npx tsx scripts/test-sale.ts 183 soil-handbook 11
 *
 * Rows it writes are tagged `test_` and can be removed with:
 *   npx tsx scripts/test-sale.ts --cleanup
 */
import "dotenv/config";

const BASE =
  process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
const SECRET = process.env.SALES_SECRET;

const args = process.argv.slice(2);

async function cleanup() {
  const { getDb } = await import("../server/db");
  const { longformSales } = await import("../drizzle/schema");
  const { like } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) {
    console.error("No database connection.");
    process.exit(1);
  }
  await db
    .delete(longformSales)
    .where(like(longformSales.externalOrderId, "test\\_%"));
  console.log("Removed every test sale (externalOrderId starting `test_`).");
  process.exit(0);
}

async function main() {
  if (args[0] === "--cleanup") return cleanup();

  const jobId = Number(args[0]);
  const productId = args[1] ?? "test-product";
  const dollars = Number(args[2] ?? 11);

  if (!Number.isInteger(jobId) || jobId <= 0) {
    console.error(
      "Usage: npx tsx scripts/test-sale.ts <jobId> [productId] [amountInDollars]\n" +
        "       npx tsx scripts/test-sale.ts --cleanup"
    );
    process.exit(1);
  }
  if (!SECRET) {
    console.error(
      "SALES_SECRET is not set in .env — the endpoint will answer 503 by design.\n" +
        "Set it, restart the server, and try again."
    );
    process.exit(1);
  }

  // A stable-per-run id: re-running with the same arguments exercises the DUPLICATE path, which
  // is exactly what you want to see working before the store starts retrying for real.
  const orderId = `test_${jobId}_${productId}`;
  const body = {
    ref: String(jobId),
    orderId,
    amountCents: Math.round(dollars * 100),
    currency: "USD",
    productId,
  };

  console.log(`POST ${BASE}/api/sales`);
  console.log(`  ${JSON.stringify({ ...body })}`);

  let res: Response;
  try {
    res = await fetch(`${BASE}/api/sales`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sales-secret": SECRET,
      },
      body: JSON.stringify(body),
    });
  } catch (err: any) {
    console.error(`\n✗ Could not reach ${BASE} — is the server running?`);
    console.error(`  ${err?.message}`);
    process.exit(1);
  }

  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* leave it as text */
  }

  console.log(`\n← HTTP ${res.status}  ${text}`);
  console.log();

  if (res.status === 200 && parsed?.duplicate) {
    console.log("✓ ALREADY RECORDED — the duplicate guard worked.");
    console.log(
      "  This is what a webstore retry looks like. Nothing was double-counted."
    );
    console.log(`  Run with --cleanup to clear test rows and try a fresh one.`);
  } else if (res.status === 200 && parsed?.jobId) {
    console.log(`✓ RECORDED against video ${parsed.jobId}.`);
    console.log(
      "  Open that video in the app — sales should now show under it,"
    );
    console.log("  and in the library list.");
    console.log("  Run this again to confirm a retry is ignored.");
  } else if (res.status === 200) {
    console.log("⚠ RECORDED, but UNATTRIBUTED — no video matched that ref.");
    console.log(`  Check ${jobId} is a real job id in this database.`);
  } else if (res.status === 401) {
    console.log("✗ Rejected: the secret did not match.");
    console.log(
      "  The server was started BEFORE SALES_SECRET was added — restart it."
    );
  } else if (res.status === 503) {
    console.log("✗ Rejected: the server has no SALES_SECRET loaded.");
    console.log("  Add it to .env and restart the server.");
  } else {
    console.log("✗ Unexpected response — see above.");
  }
  process.exit(res.status === 200 ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
