// Harness-only Vite config: the app config plus a POST /__save endpoint that writes a data URL
// to the scratchpad, so the timeline can be inspected as an image when no screenshot is possible.
import base from "../../vite.config";
import { defineConfig, mergeConfig, type Plugin } from "vite";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const OUT =
  process.env.HARNESS_OUT_DIR || path.resolve(process.cwd(), ".harness-out");

const savePlugin = (): Plugin => ({
  name: "harness-save",
  configureServer(server) {
    server.middlewares.use("/__save", (req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end();
        return;
      }
      let body = "";
      req.on("data", c => (body += c));
      req.on("end", () => {
        try {
          const { name, dataUrl } = JSON.parse(body);
          const b64 = String(dataUrl).split(",")[1];
          mkdirSync(OUT, { recursive: true });
          const file = path.join(
            OUT,
            String(name).replace(/[^a-z0-9._-]/gi, "_")
          );
          writeFileSync(file, Buffer.from(b64, "base64"));
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ ok: true, file }));
        } catch (e: any) {
          res.statusCode = 400;
          res.end(String(e?.message || e));
        }
      });
    });
  },
});

export default mergeConfig(base, defineConfig({ plugins: [savePlugin()] }));
