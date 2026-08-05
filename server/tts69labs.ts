/**
 * 69Labs Text-to-Speech integration.
 * Uses the /api/v1/tts/* endpoints — same ElevenLabs voice IDs as GenAIPro.
 * Mirrors the GenAIPro tts.ts interface (createTTSTask, pollTTSTask, listVoices).
 */

const BASE_URL = "https://69labs.vip/api/v1";

export interface TTSParams {
  text: string;
  voiceId: string;
  modelId?: string;
  /** Wire-level provider: "elevenlabs" (default), "edgetts", or "minimax" (catalog voices) */
  voiceProvider?: "elevenlabs" | "edgetts" | "minimax";
  speed?: number;
  stability?: number;
  similarity?: number;
  style?: number;
  /** Minimax catalog-voice tuning (overrides individual fields below if set) */
  minimaxSettings?: {
    speed?: number; // 0.01–10
    pitch?: number; // -12 to 12
    volume?: number; // 0.5–2
    languageBoost?: string; // defaults to English
  };
}

export interface TTSResult {
  taskId: string;
  status: "pending" | "processing" | "completed" | "failed" | "censored";
  audioUrl?: string;
  subtitleUrl?: string;
  error?: string;
  /** If censored, contains the blocked chunks that need rewriting */
  blockedChunks?: Array<{ index: number; text: string }>;
}

/**
 * Create a TTS task on 69Labs.
 * Returns the job ID for polling.
 */
export async function createTTSTask69Labs(
  apiKey: string,
  params: TTSParams
): Promise<string> {
  const isMinimax = params.voiceProvider === "minimax";
  const body: Record<string, any> = {
    text: params.text,
    voiceId: params.voiceId,
    // Catalog (minimax) voices default to speech-02-hd, not the elevenlabs model
    modelId:
      params.modelId || (isMinimax ? "speech-02-hd" : "eleven_multilingual_v2"),
    splitType: "smart",
  };
  if (params.voiceProvider) body.voiceProvider = params.voiceProvider;

  if (isMinimax) {
    // Catalog voice mode: speed/pitch/volume/languageBoost go in minimaxSettings, not voiceSettings.
    const minimaxSettings: Record<string, any> = { ...params.minimaxSettings };
    if (minimaxSettings.speed === undefined && params.speed !== undefined) {
      minimaxSettings.speed = params.speed;
    }
    if (Object.keys(minimaxSettings).length > 0) {
      body.minimaxSettings = minimaxSettings;
    }
  } else {
    // Build voiceSettings if any are provided (elevenlabs / edgetts)
    const voiceSettings: Record<string, any> = {};
    if (params.speed !== undefined) voiceSettings.speed = params.speed;
    if (params.stability !== undefined)
      voiceSettings.stability = params.stability;
    if (params.similarity !== undefined)
      voiceSettings.similarityBoost = params.similarity;
    if (params.style !== undefined) voiceSettings.style = params.style;
    if (Object.keys(voiceSettings).length > 0) {
      body.voiceSettings = voiceSettings;
    }
  }

  const response = await fetch(`${BASE_URL}/tts/generate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    const lowerErr = errText.toLowerCase();
    if (
      lowerErr.includes("credit") ||
      lowerErr.includes("limit") ||
      lowerErr.includes("quota")
    ) {
      throw new Error(
        "TTS credits depleted on 69Labs. Check your 69Labs dashboard for remaining credits."
      );
    }
    // 409: an identical TTS job is still running. The error body carries no task ID, so we
    // can't resume it here — surface a clear, retryable message. (The caller normally avoids
    // this by reusing the original task ID across retries instead of re-creating.)
    if (
      response.status === 409 ||
      errText.includes("DUPLICATE_TTS_IN_PROGRESS")
    ) {
      throw new Error(
        "69Labs TTS job already in progress (DUPLICATE_TTS_IN_PROGRESS) — a matching job is still running."
      );
    }
    throw new Error(
      `69Labs TTS task creation failed (${response.status}): ${errText}`
    );
  }

  const data = await response.json();
  const taskId = data.id || data.jobId;
  if (!taskId) {
    throw new Error(
      `69Labs TTS task creation returned no ID: ${JSON.stringify(data)}`
    );
  }

  console.log(
    `[69Labs TTS] Created task ${taskId} for voice ${params.voiceId}`
  );
  return taskId;
}

/**
 * Poll a 69Labs TTS task for its current status.
 */
export async function pollTTSTask69Labs(
  apiKey: string,
  taskId: string
): Promise<TTSResult> {
  const response = await fetch(`${BASE_URL}/tts/status/${taskId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`69Labs TTS poll failed (${response.status}): ${errText}`);
  }

  const data = await response.json();

  if (data.status === "COMPLETED") {
    // 69Labs requires a separate download endpoint — construct the download URL
    const audioUrl = `${BASE_URL}/tts/download/${taskId}`;
    return {
      taskId,
      status: "completed",
      audioUrl,
    };
  }

  if (data.status === "FAILED") {
    return {
      taskId,
      status: "failed",
      error: data.error || data.message || "TTS generation failed",
    };
  }

  if (data.status === "CANCELLED") {
    return {
      taskId,
      status: "failed",
      error: "TTS job was cancelled",
    };
  }

  if (data.status === "CENSORED") {
    return {
      taskId,
      status: "censored",
      error:
        "Some chunks were blocked by content moderation. Rewrite and retry.",
      blockedChunks: data.blockedChunks,
    };
  }

  // Still PENDING, PROCESSING, or FINALIZING
  return {
    taskId,
    status: data.status === "PENDING" ? "pending" : "processing",
  };
}

/**
 * Download the audio file from 69Labs TTS.
 * Returns the actual audio URL after following the redirect.
 */
export async function downloadTTSAudio69Labs(
  apiKey: string,
  taskId: string
): Promise<string> {
  const response = await fetch(`${BASE_URL}/tts/download/${taskId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    redirect: "follow",
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `69Labs TTS download failed (${response.status}): ${errText}`
    );
  }

  // The response URL after redirect is the actual presigned URL
  return response.url;
}
