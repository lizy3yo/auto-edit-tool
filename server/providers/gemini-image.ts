import { GoogleGenAI } from "@google/genai";
import type { GenerationResult } from "../../shared/types";
import type {
  ProviderAdapter,
  VideoGenerationParams,
  ImageGenerationParams,
} from "./base";
import { ENV } from "../_core/env";
import { recordUsage } from "../costMeter";

/**
 * Google Gemini image-generation adapter — used as the automatic fallback when
 * the primary provider (69Labs / nano-banana-pro) fails. Implements the shared
 * ProviderAdapter contract so it is a drop-in replacement for image generation.
 *
 * Only `generateImage` is functional; video is not supported by this fallback.
 * The request shape mirrors the proven call in scripts/test-gemini-cover.ts.
 */

const MODEL = "gemini-3.1-flash-image";

/** Detect image MIME type from file magic bytes (PNG/JPEG/WebP/GIF). */
function detectImageMimeType(buffer: Buffer): string {
  if (buffer.length < 4) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return "image/jpeg";
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  )
    return "image/png";
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer.length >= 12 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  )
    return "image/webp";
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46)
    return "image/gif";
  return "image/png";
}

/**
 * Fetch a reference image URL and return it as a Gemini `inlineData` part
 * (base64 + detected MIME). Returns null on any failure so generation degrades
 * to text-only rather than throwing.
 */
async function fetchImageInlineData(
  url: string
): Promise<{ mimeType: string; data: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return { mimeType: detectImageMimeType(buf), data: buf.toString("base64") };
  } catch {
    return null;
  }
}

export class GeminiImageAdapter implements ProviderAdapter {
  private apiKey: string;

  constructor(apiKey: string = ENV.geminiApiKey) {
    this.apiKey = apiKey;
  }

  /** Generate a single image via Gemini. Returns success/false per the shared contract. */
  private async generateOne(
    params: ImageGenerationParams
  ): Promise<GenerationResult> {
    try {
      const ai = new GoogleGenAI({ apiKey: this.apiKey });
      // Optional identity/reference image (image-to-image). Gemini conditions on an
      // inline-data image part alongside the text prompt.
      const refUrl = params.imageUrls?.[0];
      const refPart = refUrl ? await fetchImageInlineData(refUrl) : null;
      const parts: any[] = [{ text: params.prompt }];
      if (refPart) parts.push({ inlineData: refPart });
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: "user", parts }],
        config: {
          responseModalities: ["IMAGE"],
          outputMimeType: "image/jpeg",
          // Gemini honors aspect ratio but has no equivalent of imageSize (1K/2K/4K),
          // so imageSize is intentionally ignored for the fallback.
          aspectRatio: params.aspectRatio,
        } as any,
      });

      const imagePart = response.candidates?.[0]?.content?.parts?.find(
        (p: any) => p.inlineData
      ) as any;

      if (!imagePart?.inlineData?.data) {
        return { success: false, error: "Gemini did not return an image" };
      }

      const fileData = Buffer.from(imagePart.inlineData.data, "base64");
      const mimeType =
        imagePart.inlineData.mimeType || detectImageMimeType(fileData);

      recordUsage({
        lane: "image",
        provider: "gemini",
        model: MODEL,
        calls: 1,
        quantity: 1,
      });

      return {
        success: true,
        fileData,
        mimeType,
        taskId: "gemini-fallback",
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || "Gemini image generation failed",
      };
    }
  }

  async generateImage(
    params: ImageGenerationParams
  ): Promise<GenerationResult[]> {
    if (!this.apiKey) {
      const failure: GenerationResult = {
        success: false,
        error: "GEMINI_API_KEY not configured",
      };
      return Array.from({ length: params.count }, () => ({ ...failure }));
    }

    // Gemini generates one image per call — run the batch concurrently.
    const count = Math.max(1, params.count);
    return Promise.all(
      Array.from({ length: count }, () =>
        this.generateOne({ ...params, count: 1 })
      )
    );
  }

  async generateVideo(
    _params: VideoGenerationParams
  ): Promise<GenerationResult[]> {
    return [
      { success: false, error: "Gemini fallback does not support video" },
    ];
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.apiKey) {
      return { success: false, message: "GEMINI_API_KEY not configured" };
    }
    return { success: true, message: "Gemini image fallback configured" };
  }
}
