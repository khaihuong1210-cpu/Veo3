// ===============================
// GEMINI / VEO BACKEND SERVICE
// FREE & PRO MODE – SAFE & SCALABLE
// ===============================

import { GoogleGenAI, VideoGenerationReferenceType } from "@google/genai";
import { Resolution, AspectRatio, VideoMode } from "../types";

// ===============================
// 🔐 PAID API KEY POOL (PRO USERS)
// ===============================
// Vercel ENV:
// VITE_GEMINI_API_KEYS_PAID=key1|key2|key3

const PAID_KEYS = (import.meta.env.VITE_GEMINI_API_KEYS_PAID || "")
  .split("|")
  .map(k => k.trim())
  .filter(Boolean);

let keyIndex = 0;

function getNextPaidKey(): string {
  if (PAID_KEYS.length === 0) {
    throw new Error("❌ Chủ app chưa cấu hình API key trả phí");
  }
  const key = PAID_KEYS[keyIndex];
  keyIndex = (keyIndex + 1) % PAID_KEYS.length;
  return key;
}

// ===============================
// TYPES
// ===============================

export interface VeoRequest {
  mode: VideoMode;                // FREE | PRO | CONSISTENCY | IMAGE_TO_VIDEO...
  prompt: string;
  resolution: Resolution;
  aspectRatio: AspectRatio;
  images?: string[];
  previousVideo?: any;
  negativePrompt?: string;
  onProgress?: (msg: string) => void;
  customApiKey?: string;          // API key của KHÁCH (FREE)
}

// ===============================
// UTILS
// ===============================

const getRawBase64 = (base64String: string) => {
  if (!base64String) return "";
  const parts = base64String.split(",");
  return parts.length > 1 ? parts[1] : parts[0];
};

const fetchVideoAsBlobUrl = async (uri: string, apiKey: string): Promise<string> => {
  const response = await fetch(`${uri}&key=${apiKey}`);
  if (!response.ok) throw new Error("Fetch video blob failed");
  const blob = await response.blob();
  return URL.createObjectURL(blob);
};

// ===============================
// MAIN FUNCTION
// ===============================

export const generateVeoVideo = async ({
  mode,
  prompt,
  resolution,
  aspectRatio,
  images = [],
  previousVideo,
  onProgress,
  customApiKey
}: VeoRequest): Promise<any> => {

  // ===============================
  // 🔑 CHỌN API KEY ĐÚNG LOGIC
  // ===============================
  let apiKey = "";

  if (mode === VideoMode.FREE) {
    // 👉 BẢN MIỄN PHÍ: DÙNG KEY CỦA KHÁCH
    if (!customApiKey) {
      throw new Error("Bản miễn phí cần API key Gemini của bạn");
    }
    apiKey = customApiKey;
  } else {
    // 👉 BẢN TRẢ PHÍ / VIP: DÙNG KEY CHỦ APP (XOAY)
    apiKey = getNextPaidKey();
  }

  // ===============================
  // INIT AI
  // ===============================
  const ai = new GoogleGenAI({ apiKey });

  const model =
    mode === VideoMode.CONSISTENCY || previousVideo
      ? "veo-3.1-generate-preview"
      : "veo-3.1-fast-generate-preview";

  onProgress?.("🎬 Khởi tạo Cinema Engine...");

  let apiAspectRatio: "16:9" | "9:16" = "16:9";
  if (
    aspectRatio === AspectRatio.PORTRAIT ||
    aspectRatio === AspectRatio.SUPER_TALL
  ) {
    apiAspectRatio = "9:16";
  }

  try {
    let operation;

    // ===============================
    // 🎞️ VIDEO GENERATION LOGIC
    // ===============================

    if (previousVideo) {
      onProgress?.("🔗 Nối cảnh liền mạch (Match Cut)...");
      operation = await ai.models.generateVideos({
        model: "veo-3.1-generate-preview",
        prompt,
        video: previousVideo,
        config: {
          numberOfVideos: 1,
          resolution,
          aspectRatio: apiAspectRatio
        }
      });

    } else if (mode === VideoMode.CONSISTENCY && images.length > 0) {
      const referenceImages = images.map(img => ({
        image: {
          imageBytes: getRawBase64(img),
          mimeType: "image/png"
        },
        referenceType: VideoGenerationReferenceType.ASSET
      }));

      operation = await ai.models.generateVideos({
        model: "veo-3.1-generate-preview",
        prompt,
        config: {
          numberOfVideos: 1,
          referenceImages,
          resolution,
          aspectRatio: apiAspectRatio
        }
      });

    } else if (mode === VideoMode.IMAGE_TO_VIDEO && images.length > 0) {
      operation = await ai.models.generateVideos({
        model,
        prompt,
        image: {
          imageBytes: getRawBase64(images[0]),
          mimeType: "image/png"
        },
        config: {
          numberOfVideos: 1,
          resolution,
          aspectRatio: apiAspectRatio
        }
      });

    } else if (mode === VideoMode.INTERPOLATION && images.length >= 2) {
      operation = await ai.models.generateVideos({
        model,
        prompt,
        image: {
          imageBytes: getRawBase64(images[0]),
          mimeType: "image/png"
        },
        config: {
          numberOfVideos: 1,
          resolution,
          aspectRatio: apiAspectRatio,
          lastFrame: {
            imageBytes: getRawBase64(images[1]),
            mimeType: "image/png"
          }
        }
      });

    } else {
      operation = await ai.models.generateVideos({
        model,
        prompt,
        config: {
          numberOfVideos: 1,
          resolution,
          aspectRatio: apiAspectRatio
        }
      });
    }

    // ===============================
    // ⏳ WAIT FOR RENDER
    // ===============================
    while (!operation.done) {
      await new Promise(r => setTimeout(r, 8000));
      operation = await ai.operations.getVideosOperation({ operation });
      onProgress?.("🧠 AI đang render khung hình...");
    }

    // ===============================
    // 📦 FINAL VIDEO
    // ===============================
    const videoRef = operation.response?.generatedVideos?.[0]?.video;
    if (!videoRef?.uri) throw new Error("Không nhận được video từ AI");

    const blobUrl = await fetchVideoAsBlobUrl(videoRef.uri, apiKey);

    return {
      finalUrl: blobUrl,
      videoRef
    };

  } catch (err) {
    console.error("❌ Gemini API Error:", err);
    throw err;
  }
};
