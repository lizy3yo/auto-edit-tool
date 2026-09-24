/**
 * scripts/stress/tailor.mts — write each stress-test channel its own long script, built on the
 * structure of Hank's real 21-minute script (job 110) but set in that channel's own world.
 *
 *   npx tsx scripts/stress/tailor.mts            # writes scripts/stress/scripts/<channel>.txt
 *
 * Every script deliberately carries the things that broke before, so the stress runs exercise
 * them: a self-introduction line, places where the things are used/sold/come from, prices and
 * hourly figures (the chalkboard bait), long comma-chained sentences (mid-sentence host cuts),
 * and two marked CTA blocks that say the book title out loud — one using the fixed trigger line,
 * one worded freely.
 */
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { invokeClaude } from "../../server/claude";

const TEMPLATE = readFileSync(path.join("scripts", "stress", "scripts", "hank_hardwood.txt"), "utf8");

const CHANNELS = [
  {
    key: "granny_mae",
    host: "Granny Mae",
    world:
      "a grandmother who crochets at her kitchen table with worsted-weight yarn and a hook; " +
      "warm, plain-spoken, patient; sells at church bazaars, craft fairs and to neighbours",
    topic: "10 crochet projects made from cheap yarn, ranked by what they earned per hour",
    book: "The Kitchen Table Crochet Book",
  },
  {
    key: "hannah_yoder",
    host: "Hannah Yoder",
    world:
      "a Plain (Amish) woman who sews by hand and on a treadle from worn work clothes, feed " +
      "sacks and bedsheets; calm and practical; sells at an Amish market stand and a roadside table",
    topic: "10 plain sewing projects made from cloth already in the house, ranked by what they earned per hour",
    book: "Plain Sewing: 50 Simple Projects for the Home",
  },
  {
    key: "quilting_with_granny_ruth",
    host: "Granny Ruth",
    world:
      "a grandmother who quilts in her sewing room with fabric scraps and a straight-stitch " +
      "machine; encouraging and funny; sells at quilt shows, a church hall sale and online",
    topic: "10 scrap-quilting projects, ranked by what they earned per hour",
    book: "Scrap Quilts That Sell",
  },
];

const SYSTEM =
  "You write long-form YouTube narration scripts. You will be given a TEMPLATE script from " +
  "another channel. Write a NEW script for a different channel that keeps the template's " +
  "structure, pacing, length and tone of voice, but is entirely about the new channel's own " +
  "craft and world. Output ONLY the script text — no title, no notes, no markdown.";

function brief(c: (typeof CHANNELS)[number]): string {
  return [
    `NEW CHANNEL: host "${c.host}" — ${c.world}.`,
    `TOPIC: ${c.topic}.`,
    `BOOK the host sells: "${c.book}".`,
    "",
    "REQUIREMENTS (all of them):",
    `- About the same length as the template (4,000–4,600 words), paragraphs separated by blank lines.`,
    `- Open with a numbers-driven hook, then early on a line where the host introduces themself: "I'm ${c.host}, and …".`,
    "- A countdown of 10 projects, worst to best, each with what it cost, how long it took, and what people paid, with the hourly figure said out loud.",
    "- At least six lines that name a REAL place where a finished piece is used, sold or comes from (a church hall, a market stall, a customer's porch, a nursery, a hospital bedside, a farmhouse kitchen …) — the way the template mentions Japanese sliding doors.",
    "- Plenty of long sentences chained with commas, like the template.",
    `- Exactly TWO CTA blocks, each on its own lines between marker lines written EXACTLY as:\n===START CTA(${c.book})===\n…spoken pitch…\n===END CTA===`,
    `- The FIRST CTA (mid-roll, around a third of the way in): name the book title out loud in its second or third sentence, say one or two more sentences about it, then say the line "Now go ahead and grab your phone, open up your camera, and point it at that code on your screen." followed later by "I'll wait right here." and then one more sentence before the block ends.`,
    `- The SECOND CTA (the close): name the book title out loud, then tell the viewer to scan the QR code on the screen in your own words (do NOT use "grab your phone"), then ask them to subscribe to ${c.host} and comment.`,
    "- After the second CTA, one short closing paragraph.",
    "- No stage directions, no brackets, no scene notes — only words the host speaks.",
    "",
    "TEMPLATE SCRIPT:",
    TEMPLATE,
  ].join("\n");
}

const outDir = path.join("scripts", "stress", "scripts");
mkdirSync(outDir, { recursive: true });
for (const c of CHANNELS) {
  const r = await invokeClaude({
    systemPrompt: SYSTEM,
    userMessage: brief(c),
    maxTokens: 14000,
  });
  const text = r.text.trim();
  writeFileSync(path.join(outDir, `${c.key}.txt`), text + "\n");
  const words = text.split(/\s+/).length;
  const ctas = (text.match(/===START CTA/g) ?? []).length;
  console.log(`${c.key}: ${words} words, ${ctas} CTA blocks`);
}
process.exit(0);
