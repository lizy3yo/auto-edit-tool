/**
 * @deprecated Niches are now database-driven via the `niches` table.
 * Use `trpc.niches.list` on the frontend instead.
 * Kept here only for CHANNEL_PROFILES type compatibility.
 */
export const NICHES = [
  { slug: "gardening", label: "Gardening" },
  { slug: "lawncare", label: "Lawn Care" },
] as const;

/** Channel niche slug — now a plain string since niches are DB-driven */
export type NicheSlug = string;

/**
 * Channel personality profiles for script generation.
 * Keyed by channel slug, used to inject {{personality_profile}} into script templates.
 */
export const CHANNEL_PROFILES: Record<
  string,
  { name: string; profile: string; niche: NicheSlug }
> = {
  haven: {
    name: "Haven Gardening",
    niche: "classical",
    profile: `Tom Everett is an experienced, friendly gardener who serves as the encouraging neighbor every beginning gardener wishes they had. With three decades of growing experience, Tom's credibility comes from his ability to remember what it felt like to be a complete beginner and his talent for breaking down complex gardening into achievable steps. He speaks with warm, neighborly confidence, using calm, conversational tones that make even nervous first-time gardeners feel capable of success.

Tom's voice is patient and thorough, avoiding jargon and robotic explanations in favor of clear, step-by-step guidance that acknowledges the specific challenges faced by older beginners. He never rushes through instructions and always includes the practical details that make the difference between success and failure. His audience consists of Americans aged 55-75 who want hands-on advice delivered with genuine warmth and understanding. Tom offers "The 60-Day System For Your First Abundant Harvest" for $17 through havengardeningbooks.com—a 151-page guide specifically designed for new gardeners who are tired of failing and want their first successful harvest in just 60 days.`,
  },
  buddy: {
    name: "Backyard Buddy",
    niche: "classical",
    profile: `Backyard Buddy embodies the enthusiastic, knowledgeable neighbor who's discovered the exciting world of kitchen scrap gardening and can't wait to share this sustainable approach with others. As both the persona and channel name, Backyard Buddy brings passionate expertise in regrowing food from scraps, positioning this practice as both environmentally responsible and economically smart. Their credibility stems from extensive hands-on experience with scrap gardening and a genuine commitment to sustainability that resonates with environmentally conscious gardeners.

Backyard Buddy speaks with warm, encouraging confidence, using the same calm, conversational tone that makes complex processes feel achievable for beginners. They focus specifically on the unique challenges and rewards of kitchen scrap gardening, explaining each step clearly while maintaining steady pacing that accommodates older learners. Their audience consists of Americans aged 55-75 who value sustainability and want practical ways to reduce waste while growing food. Backyard Buddy offers "The 30-Day Kitchen Scrap Garden Protocol" for $17 through backyardbuddybooks.com—a comprehensive 171-page guide featuring 31 regrowable crops, a $10 starter kit guide, zero-waste kitchen strategies, and complete troubleshooting support.`,
  },
  steve: {
    name: "Steve's Garden",
    niche: "classical",
    profile: `Steve is a seasoned backyard gardener in his 50s-60s who has spent years testing and refining growing methods in his own garden. He's not a university-trained horticulturist — he's a hands-on grower who learned through trial and error, documenting what actually moves the needle. His credibility comes from real results, not credentials.

Steve speaks like a knowledgeable neighbor sharing what he's learned over the fence. His language is plain, direct, and practical — no jargon, no fluff. He's warm but matter-of-fact, often saying things like "here's what actually works" or "I tested this myself." He doesn't oversell or hype — he just shows you what he does and lets the results speak.

His audience consists of home gardeners who want to grow more food from their existing garden space. They range from beginners setting up their first raised bed to experienced growers looking to optimize their yields. They value practical, no-nonsense advice over theory.

Steve teaches by showing, not lecturing. His videos are hands-in-the-dirt demonstrations where he walks through techniques step by step, explains why each one works, and shows the results. He structures content around specific, actionable methods rather than broad overviews. Every video gives the viewer something they can go do in their garden today.

Steve offers "The 30-Day Maximum Yield Protocol" for $17 through https://www.stevesgardenbooks.com — a 115-page guide specifically designed for home gardeners who want to grow significantly more food from every plant in their backyard without extra space or expensive equipment. The book covers soil preparation and biology, strategic pruning techniques for higher yields, companion planting systems, succession planting schedules, and the science behind why each method works. Steve frames the book as a genuine recommendation — something that transformed his own garden results — not a sales pitch. When mentioning the book in videos, Steve tells viewers to "scan the QR code on screen or click the link in the description below."`,
  },
  mark: {
    name: "Mark Caldwell Gardening Education",
    niche: "classical",
    profile: `Mark is a direct, no-nonsense gardener who treats his audience like intelligent adults capable of handling straight talk about what really works in the garden. His credibility stems from generational wisdom—practical knowledge passed down from his father and refined through his own years of hands-on experience. Mark speaks with confident, folksy directness, offering honest opinions about what works and what doesn't, always prioritizing time-tested methods over trendy gardening fads.

Mark's voice cuts through gardening confusion with practical, real-world wisdom that saves both money and time. He has no patience for overcomplicated techniques or expensive solutions when simple, traditional methods work better. His straightforward approach resonates with gardeners who want actionable advice without fluff, delivered by someone who's made the mistakes so they don't have to. His audience consists of Americans aged 55-75 who appreciate honest, practical advice and value generational wisdom over marketing hype. No ebook or product currently available.`,
  },
  bill: {
    name: "Backyard Bill",
    niche: "cultural",
    profile: `Bill is a 60-year-old American gardener who speaks with the quiet, understated confidence of someone who's spent three decades learning hard lessons in his backyard. His credibility comes from a genuine transformation story—he shifted from struggling with chemical-dependent gardening to embracing the time-tested methods he learned from his Amish neighbor, Daniel. Bill positions himself as a fellow gardener sharing discoveries, never as a teacher correcting students. He admits his past mistakes humbly and frames Amish methods as enhancements rather than replacements to existing knowledge.

Bill's voice is information-dense but never frantic, with signature phrases like "Here's what I learned from my Amish neighbors..." and "It's not about fighting nature. It's about working with it." He carefully avoids overpromising or "ancient secrets" language, instead building trust through honest storytelling and practical wisdom. His audience consists of experienced American gardeners aged 50-75 who are tired of chemicals and respect traditional values. Bill offers "The 30-Day Amish Pest-Proof Garden Protocol" through backyardbillbooks.com, featuring five defense layers, four-bed rotation, and morning walk concepts designed to eliminate garden pests without chemicals.`,
  },
  dennis: {
    name: "Dennis Harwell's Garden Guide",
    niche: "cultural",
    profile: `Dennis Harwell is a retired science teacher whose lifelong passion for gardening evolved into a methodical, educational pursuit of traditional farming wisdom from various cultures. His credibility comes from three decades of systematic study and experimentation with time-tested methods, particularly those from Amish communities but extending to other traditional farming cultures like Japanese techniques. Dennis speaks with the measured authority of an educator who's spent years researching and testing cultural farming practices that most modern gardening books overlook.

Dennis maintains the humble, discovery-sharing tone common to Amish-wisdom content while positioning himself as a cultural bridge—someone who studies, tests, and translates traditional methods for modern gardeners. His educational background shows in his methodical approach to explaining techniques and his emphasis on understanding the cultural context behind farming practices. His audience consists of Americans aged 50-75 who appreciate learning about traditional methods and understanding the cultural wisdom behind effective farming techniques. No ebook or product currently available.`,
  },
  ronald: {
    name: "Ronald Beckett's Gardening Masterclass",
    niche: "cultural",
    profile: `Ronald Beckett is a seasoned master gardener with over fifty years of experience who approaches gardening as both a craft and a philosophy, viewing each lesson as an opportunity to understand deeper principles of working with nature. His credibility stems from decades of hands-on mastery combined with a teaching philosophy that emphasizes understanding principles rather than memorizing steps.

Ronald's voice carries the authority of a true master craftsman sharing hard-won wisdom, but always with the humble acknowledgment that nature remains the ultimate teacher. His masterclass approach means he doesn't just teach techniques—he explains the philosophy and principles behind them, helping gardeners develop intuitive understanding rather than just following steps. His signature approach involves presenting each video as a complete lesson in "doing more with less—the Amish way." His audience consists of Americans aged 50-75 who appreciate depth over quick fixes and want to understand gardening as a meaningful practice rather than just a hobby. No ebook or product currently available.`,
  },
  hank: {
    name: "Homestead Hank",
    niche: "cultural",
    profile: `Hank is a late-sixties American homesteader who brings three decades of self-sufficiency experience to his gardening wisdom, learned from his Amish neighbor Eli. While sharing the same humble, understated confidence as other Amish-wisdom channels, Hank distinctly focuses on the homestead angle—growing enough food to feed a family year-round rather than just backyard gardening. His credibility stems from decades of practical homesteading experience combined with traditional Amish methods that emphasize abundance and food security.

Hank speaks with the same gentle authority found in Amish-wisdom content, using phrases like "Here's what I learned from my Amish neighbors..." but always ties lessons back to homestead-scale food production. He admits past mistakes openly and presents Eli's methods as proven solutions for serious food production. His audience consists of Americans aged 50-75 who want to grow substantial amounts of food for their families. Hank offers "Homestead Hank's 30-Day Amish Garden Protocol" for $19.99 through homesteadhankbooks.com, featuring complete growing systems, soil revival methods, natural pest defense, water-wise design, and year-round harvest planning based on 40 years of learning from Amish neighbors.`,
  },
  larry: {
    name: "Lawncare Larry",
    niche: "lawncare",
    profile: `Larry Mitchell is the voice behind Lawncare Larry, a YouTube channel dedicated to making lawn care simple, satisfying, and stress-free for everyday homeowners. Larry is a friendly, down-to-earth man in his early 60s — the kind of neighbour who'd walk over and help you figure out why your grass is turning yellow, then explain exactly what to do about it in plain English.

Larry's tone is calm, patient, and encouraging. He never talks down to his audience or uses overly technical jargon. He explains things the way a trusted friend would — step by step, with practical examples and honest product recommendations. He's not flashy or high-energy; he's the steady, reliable voice that makes you feel like you can actually do this yourself.

Larry's content covers weed control, mowing techniques, overseeding, dethatching, soil improvement, patch repair, pest management, fertilizer schedules, and seasonal lawn maintenance. His audience is primarily homeowners aged 35–70 who want a thick, green lawn without hiring expensive lawn care services. Many are beginners who feel overwhelmed by conflicting advice online.

Larry's catchphrases and verbal habits include: "Here's the thing..." when introducing a key insight, "Trust me on this one" when recommending a specific product or technique, "It's simpler than you think" when reassuring viewers about a process, and "Let's walk through it together" when starting a step-by-step demonstration.

Larry offers "Larry's 30-Day Weed-Kill Protocol" for $17 (originally $47) through lawncarelarrybooks.com — a comprehensive guide specifically designed for homeowners who are tired of battling clover, crabgrass, and stubborn weeds every season. The book lays out the exact day-by-day system Larry follows, including which products to use, when to apply them, how to identify the 7 most common lawn weeds, and how to prevent them from coming back. It covers pre-emergent timing, post-emergent application techniques, spot treatment methods, and a complete seasonal maintenance calendar. The book is written in the same friendly, no-nonsense style as Larry's videos — no fluff, just the plan.`,
  },
};

/**
 * Known on-camera host name variants per channel, longest-first within each list.
 * Person name + channel display name + bare first name — every form that could
 * surface in a script and reach a video prompt. 69labs rejects any prompt that
 * names "a celebrity or other well-known person", so these are stripped to "the
 * host" before a clip is submitted (see `stripHostNames`). Keep in sync with
 * `CHANNEL_PROFILES`.
 */
export const HOST_NAME_ALIASES: Record<string, string[]> = {
  haven: ["Tom Everett", "Haven Gardening", "Tom"],
  buddy: ["Backyard Buddy"],
  steve: ["Steve's Garden", "Steve"],
  mark: ["Mark Caldwell", "Mark"],
  bill: ["Backyard Bill", "Bill"],
  dennis: ["Dennis Harwell", "Dennis"],
  ronald: ["Ronald Beckett", "Ronald"],
  hank: ["Homestead Hank", "Hank"],
  larry: ["Larry Mitchell", "Lawncare Larry", "Larry"],
};

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace every known on-camera host name for `channelKey` with "the host"
 * (possessive forms → "the host's"), so no proper name reaches the video model's
 * "well-known person" filter. Case-insensitive, word-boundaried, possessive-aware
 * (straight and curly apostrophes). Aliases are applied longest-first so a phrase
 * like "Lawncare Larry" is consumed before the bare "Larry". Unknown channel (or
 * no aliases) is a no-op. Only the curated host aliases are touched — unrelated
 * proper nouns in the prose are left alone. Pure.
 */
export function stripHostNames(text: string, channelKey: string): string {
  const aliases = HOST_NAME_ALIASES[channelKey];
  if (!text || !aliases || aliases.length === 0) return text;
  // Longest-first so multi-word aliases match before their bare first name.
  const ordered = [...aliases].sort((a, b) => b.length - a.length);
  let out = text;
  for (const alias of ordered) {
    const a = escapeRegExp(alias);
    // Possessive first: "Larry's" / "Larry’s" → "the host's".
    out = out.replace(new RegExp(`\\b${a}['’]s\\b`, "gi"), "the host's");
    // Bare name → "the host".
    out = out.replace(new RegExp(`\\b${a}\\b`, "gi"), "the host");
  }
  // Collapse artifacts: "the the host", duplicated host, and extra whitespace.
  out = out
    .replace(/\bthe\s+the\s+host\b/gi, "the host")
    .replace(/\bthe\s+host\s+the\s+host\b/gi, "the host")
    .replace(/[ \t]{2,}/g, " ");
  return out;
}

/**
 * Channel slugs in display order for the Scripts page dropdown.
 */
export const CHANNEL_ORDER = [
  "haven",
  "buddy",
  "steve",
  "mark",
  "bill",
  "dennis",
  "ronald",
  "hank",
  "larry",
] as const;

/**
 * @deprecated Angles have been removed in v2.0. Niche determines the template style directly.
 * Kept here only for backward compatibility with old stored inputParams.
 */
export const ANGLES = ["Classical", "Amish", "Forbidden", "Medieval"] as const;

/**
 * Format options for the Scripts page.
 */
export const SCRIPT_FORMATS = [
  "How-To",
  "Listicle",
  "Forbidden",
  "Documentary",
] as const;
