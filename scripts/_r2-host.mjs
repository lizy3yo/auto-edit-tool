import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { readFileSync } from "fs";
import { spawnSync } from "child_process";
import ffmpegPath from "ffmpeg-static";
const env = Object.fromEntries(readFileSync(".env","utf8").split(/\r?\n/).filter(l=>/^R2_/.test(l)).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1).trim().replace(/^"|"$/g,"")];}));
const s3 = new S3Client({ region:"auto", endpoint:`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials:{accessKeyId:env.R2_ACCESS_KEY_ID, secretAccessKey:env.R2_SECRET_ACCESS_KEY}});
for (const id of process.argv.slice(2)) {
  let tok, objs=[]; do { const r=await s3.send(new ListObjectsV2Command({Bucket:env.R2_BUCKET,Prefix:`longform/${id}/`,ContinuationToken:tok})); objs.push(...(r.Contents??[])); tok=r.NextContinuationToken;} while(tok);
  const per = new Map();
  for (const c of objs.filter(o=>/\/clip-\d+-\d+-/.test(o.Key))) {
    const url = await getSignedUrl(s3, new GetObjectCommand({Bucket:env.R2_BUCKET,Key:c.Key}), {expiresIn:600});
    const out = spawnSync(ffmpegPath, ["-i", url], {encoding:"utf8"}).stderr;
    if (!/Video:.*1920x1080/.test(out)) continue;
    const d = out.match(/Duration:\s*(\d+):(\d+):([\d.]+)/); const sec = (+d[1])*3600+(+d[2])*60+(+d[3]);
    const k=Number(c.Key.match(/clip-(\d+)-/)[1]); const p=per.get(k)??{n:0,sec:[]}; p.n++; p.sec.push(sec); per.set(k,p);
  }
  const all=[...per.values()]; const renders=all.reduce((a,p)=>a+p.n,0); const rendered=all.reduce((a,p)=>a+p.sec.reduce((x,y)=>x+y,0),0);
  const onScreen=all.reduce((a,p)=>a+p.sec[p.sec.length-1],0); const again=[...per].filter(([,p])=>p.n>1);
  console.log(`job ${id}: ${per.size} host scenes, ${onScreen.toFixed(0)}s of host (one clip each) | ${renders} HeyGen clips stored, ${rendered.toFixed(0)}s | re-rendered: ${again.length} scenes, +${(rendered-onScreen).toFixed(0)}s`);
}
