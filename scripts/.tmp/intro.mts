import { introducesHost } from "../../server/longformVideo";
const t = "So we're counting all of them down, worst to best, with what each one cost me, how long it took, and what folks actually laid their money down for. I'm Hannah Yoder, and this one's for anybody sitting by a window with a needle, a spool of thread,";
console.log(introducesHost(t, "Hannah Yoder"), [...t.slice(t.indexOf("Hannah")-4, t.indexOf("Hannah"))].map(c => c.charCodeAt(0)));
