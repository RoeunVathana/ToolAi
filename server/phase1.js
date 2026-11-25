import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import multer from "multer";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { GoogleGenAI } from "@google/genai";

const execFileAsync = promisify(execFile);
const prisma = new PrismaClient();
const accessSecret = process.env.JWT_ACCESS_SECRET || "development-only-change-me";
const accessTokenTtl = process.env.JWT_ACCESS_TTL || "2h";
const allowedImageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const allowedAudioExtensions = new Set([".mp3", ".wav"]);
const allowedVideoExtensions = new Set([".mp4"]);
const supportedTtsVoices = [
  { id: "Kore", label: "Kore", description: "Clear and balanced" },
  { id: "Puck", label: "Puck", description: "Bright and friendly" },
  { id: "Charon", label: "Charon", description: "Deep and steady" },
  { id: "Aoede", label: "Aoede", description: "Warm and expressive" },
  { id: "Leda", label: "Leda", description: "Soft and calm" },
  { id: "Orus", label: "Orus", description: "Confident and clear" },
  { id: "Fenrir", label: "Fenrir", description: "Strong and dramatic" },
  { id: "Zephyr", label: "Zephyr", description: "Gentle and natural" },
  { id: "Rasalgethi", label: "Rasalgethi", description: "Narration-focused" },
];

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isTransientGeminiError(error) {
  const status = Number(error?.status || error?.code || error?.response?.status);
  const message = String(error?.message || error || "");
  return [429, 500, 502, 503, 504].includes(status)
    || /high demand|temporar|overload|unavailable|resource exhausted|try again later/i.test(message);
}

function providerErrorMessage(error, fallbackMessage) {
  const rawMessage = String(error?.message || "").trim();
  if (!rawMessage) return fallbackMessage;
  try {
    const parsed = JSON.parse(rawMessage);
    return parsed?.error?.message || parsed?.message || fallbackMessage;
  } catch {
    return rawMessage;
  }
}

async function withGeminiRetry(operation, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientGeminiError(error) || attempt === attempts - 1) throw error;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastError;
}

function phase1Paths(rootDir) {
  const storageRoot = path.resolve(process.env.STORAGE_PATH || path.join(rootDir, "storage"), "phase1");
  const incomingRoot = path.join(rootDir, "server", "incoming", "phase1");
  const voiceRoot = path.join(storageRoot, "voices");
  return { storageRoot, incomingRoot, voiceRoot };
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
}

function issueAccessToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, name: user.name }, accessSecret, { expiresIn: accessTokenTtl });
}

function getBearerToken(req) {
  const value = String(req.headers.authorization || "");
  if (value.startsWith("Bearer ")) return value.slice(7);
  return typeof req.query.token === "string" ? req.query.token : "";
}

function requireAuth(req, res, next) {
  try {
    const payload = jwt.verify(getBearerToken(req), accessSecret);
    req.userId = String(payload.sub);
    return next();
  } catch {
    return res.status(401).json({ error: "Authentication is required." });
  }
}

function safeExtension(filename) {
  const extension = path.extname(String(filename || "")).toLowerCase();
  return extension.replace(/[^.a-z0-9]/g, "");
}

function formatProject(project) {
  return {
    ...project,
    mediaAssets: project.mediaAssets?.map((asset) => ({
      ...asset,
      previewUrl: `/api/v1/media/${asset.id}/preview`,
    })),
    renderJobs: project.renderJobs?.map((job) => ({
      ...job,
      downloadUrl: job.status === "COMPLETED" ? `/api/v1/render-jobs/${job.id}/download` : null,
    })),
  };
}

function validateProjectInput(body, partial = false) {
  const schema = z.object({
    title: z.string().trim().min(1).max(120),
    topic: z.string().trim().min(1).max(500),
    language: z.string().trim().min(2).max(10).default("km"),
    durationMinutes: z.coerce.number().int().min(1).max(15),
    script: z.string().max(50000).default(""),
    aspectRatio: z.enum(["16:9", "9:16"]).default("16:9"),
    resolution: z.enum(["1920x1080", "1080x1920", "1280x720", "720x1280"]).default("1280x720"),
  });
  if (partial) return schema.partial().parse(body);
  return schema.parse(body);
}

function pickScriptText(response) {
  if (typeof response?.text === "string") return response.text.trim();
  return response?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n").trim() || "";
}

async function generateKhmerScript({ topic, durationMinutes, language }) {
  if (!process.env.GEMINI_API_KEY) {
    const error = new Error("Gemini is not configured. You can still write and save the script manually.");
    error.code = "GEMINI_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = process.env.GEMINI_MODEL || process.env.GEMINI_TEXT_MODEL || "gemini-3.5-flash-lite";
  const prompt = [
    "Write an original, natural Khmer narration script for a short video.",
    `Topic: ${topic}`,
    `Target language: ${language === "km" ? "Khmer" : language}`,
    `Target duration: ${durationMinutes} minute(s).`,
    "Use clear spoken Khmer, a strong opening, short paragraphs, and only events supported by the topic.",
    "Return only the narration script in Khmer. Do not include headings, markdown, or production notes.",
  ].join("\n");
  const response = await withGeminiRetry(() => ai.models.generateContent({ model, contents: prompt }));
  const script = pickScriptText(response);
  if (!script) throw new Error("Gemini returned an empty script.");
  return { script, provider: "gemini", model };
}

async function normalizeVoiceClip(ffmpegCommand, inputPath, outputPath) {
  await execFileAsync(ffmpegCommand, [
    "-y", "-i", inputPath, "-ar", "24000", "-ac", "1", "-sample_fmt", "s16", outputPath,
  ]);
}

function interactionAudioData(interaction) {
  return interaction?.output_audio?.data || interaction?.outputAudio?.data || interaction?.steps
    ?.filter((step) => step.type === "model_output")
    .flatMap((step) => step.content || [])
    .find((content) => content.type === "audio")?.data || "";
}

async function generateReplicatedVoiceover({ script, sourceAudioPath, consentAudioPath, ffmpegCommand }) {
  if (!process.env.GEMINI_API_KEY) {
    const error = new Error("Gemini is not configured. Upload a recorded narration instead, or configure Gemini voice replication.");
    error.code = "GEMINI_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }
  const model = process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts";
  const tempDir = path.dirname(sourceAudioPath);
  const normalizedSource = path.join(tempDir, `${crypto.randomUUID()}-source.wav`);
  const normalizedConsent = path.join(tempDir, `${crypto.randomUUID()}-consent.wav`);
  try {
    await normalizeVoiceClip(ffmpegCommand, sourceAudioPath, normalizedSource);
    await normalizeVoiceClip(ffmpegCommand, consentAudioPath, normalizedConsent);
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { apiVersion: process.env.GEMINI_API_VERSION || "v1beta" } });
    const replicatedVoice = await ai.voices.create({
      store: false,
      voice: {
        model,
        type: "replicated",
        display_name: "ToolAiMe one-off user voice",
        replicated: {
          source_audio: { mime_type: "audio/wav", data: (await fs.readFile(normalizedSource)).toString("base64") },
          consent_audio: { mime_type: "audio/wav", data: (await fs.readFile(normalizedConsent)).toString("base64") },
        },
      },
    });
    if (!replicatedVoice?.key) throw new Error("Gemini did not return a temporary replicated voice key.");
    const interaction = await ai.interactions.create({
      model,
      input: [{
        type: "user_input",
        content: [{
          type: "text",
          text: script.slice(0, 30000),
          annotations: [{ type: "speech_metadata", style: "natural Cambodian Khmer narration, warm and conversational, clear pronunciation, similar vocal character to the authorized reference speaker" }],
        }],
      }],
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: replicatedVoice.key }] },
      store: false,
    });
    const audioData = interactionAudioData(interaction);
    if (!audioData) throw new Error("Gemini did not return generated voice audio.");
    return { audio: Buffer.from(audioData, "base64"), model, provider: "gemini", storageMode: "stateless" };
  } finally {
    await fs.rm(normalizedSource, { force: true }).catch(() => {});
    await fs.rm(normalizedConsent, { force: true }).catch(() => {});
  }
}

function voiceCatalog() {
  return {
    provider: "gemini",
    model: process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts",
    configured: Boolean(process.env.GEMINI_API_KEY),
    language: "km",
    voices: supportedTtsVoices,
  };
}

async function publishingConfig(getProviderConfig) {
  if (typeof getProviderConfig === "function") return await getProviderConfig();
  const youtubeConfigured = Boolean(process.env.YT_CLIENT_ID && process.env.YT_CLIENT_SECRET && process.env.YT_REDIRECT_URI);
  const youtubeConnected = Boolean(process.env.YT_REFRESH_TOKEN);
  const facebookConfigured = Boolean(process.env.FB_APP_ID && process.env.FB_APP_SECRET && process.env.FB_REDIRECT_URI);
  const facebookConnected = Boolean(process.env.FB_PAGE_ID && process.env.FB_PAGE_ACCESS_TOKEN);
  return {
    timezone: process.env.DEFAULT_TIMEZONE || "Asia/Phnom_Penh",
    youtube: {
      configured: youtubeConfigured,
      connected: youtubeConnected,
      canPublish: youtubeConfigured && youtubeConnected,
      label: "YouTube",
      message: youtubeConfigured && youtubeConnected ? "Credentials are present; provider verification is still required." : "Add YouTube OAuth credentials and a connected channel to publish.",
    },
    facebook: {
      configured: facebookConfigured,
      connected: facebookConnected,
      canPublish: facebookConfigured && facebookConnected,
      label: "Facebook Page",
      message: facebookConfigured && facebookConnected ? "Page credentials are present; provider verification is still required." : "Add Meta credentials and a Page access token to publish.",
    },
  };
}

function publishJobResponse(job) {
  return {
    ...job,
    project: job.project ? { id: job.project.id, title: job.project.title, status: job.project.status } : undefined,
  };
}

function voiceRequestSchema(body, options = {}) {
  const projectId = options.allowProject === false
    ? z.string().uuid().optional().nullable()
    : z.string().uuid().optional().nullable();
  return z.object({
    script: z.string().trim().min(1, "Write a Khmer script before generating audio.").max(30000),
    title: z.string().trim().min(1).max(120).default("Khmer narration"),
    voice: z.string().trim().min(1).default("Kore").refine((value) => supportedTtsVoices.some((item) => item.id === value), "Choose a supported Gemini voice."),
    speed: z.coerce.number().min(0.75, "Speed must be at least 0.75x.").max(1.5, "Speed cannot exceed 1.5x.").default(1),
    projectId,
  }).parse(body || {});
}

async function generateStandardVoiceover({ script, voice, speed, ffmpegCommand, tempDir }) {
  if (!process.env.GEMINI_API_KEY) {
    const error = new Error("Gemini TTS is not configured. You can upload a recorded narration instead.");
    error.code = "GEMINI_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }
  const model = process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts";
  const rawPath = path.join(tempDir, `${crypto.randomUUID()}-tts-raw.wav`);
  const finalPath = path.join(tempDir, `${crypto.randomUUID()}-tts-final.wav`);
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { apiVersion: process.env.GEMINI_API_VERSION || "v1beta" } });
    const interaction = await ai.interactions.create({
      model,
      input: [{
        type: "user_input",
        content: [{
          type: "text",
          text: script.slice(0, 30000),
          annotations: [{ type: "speech_metadata", style: "natural Khmer narration, warm, clear pronunciation, conversational pacing" }],
        }],
      }],
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice }] },
      store: false,
    });
    const audioData = interactionAudioData(interaction);
    if (!audioData) throw new Error("Gemini did not return generated voice audio.");
    await fs.writeFile(rawPath, Buffer.from(audioData, "base64"));
    if (speed === 1) await fs.copyFile(rawPath, finalPath);
    else await execFileAsync(ffmpegCommand, ["-y", "-i", rawPath, "-filter:a", `atempo=${speed}`, "-ar", "24000", "-ac", "1", finalPath]);
    const audio = await fs.readFile(finalPath);
    return { audio, model, provider: "gemini", speed };
  } finally {
    await fs.rm(rawPath, { force: true }).catch(() => {});
    await fs.rm(finalPath, { force: true }).catch(() => {});
  }
}

function srtToText(srt) {
  return String(srt || "").replace(/\r/g, "").split(/\n\s*\n/).map((block) => block.split("\n").filter((line) => line.trim() && !/^\d+$/.test(line.trim()) && !/-->/.test(line)).join(" ").trim()).filter(Boolean).join("\n\n").slice(0, 30000);
}

function subtitleFilterPath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

async function burnTimelineSubtitles({ inputPath, subtitlePath, outputPath, ffmpegCommand }) {
  await execFileAsync(ffmpegCommand, [
    "-y", "-i", inputPath,
    "-vf", `subtitles='${subtitleFilterPath(subtitlePath)}':force_style='FontName=Arial,FontSize=20,Outline=2,Shadow=1,Alignment=2'`,
    "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outputPath,
  ], { maxBuffer: 1024 * 1024 * 4 });
}

function narrationResponse(narration, storageRoot, includeScript = false) {
  return {
    ...narration,
    ...(includeScript ? {} : { script: undefined }),
    previewUrl: `/api/v1/voice/narrations/${narration.id}/preview`,
    downloadUrl: `/api/v1/voice/narrations/${narration.id}/download`,
  };
}

function ensureContained(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("The requested file is outside the project storage directory.");
  }
  return resolvedCandidate;
}

async function probeDuration(ffprobeCommand, filePath) {
  const { stdout } = await execFileAsync(ffprobeCommand, [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath,
  ]);
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("FFprobe could not read the narration duration.");
  return duration;
}

function concatPath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/'/g, "'\\''");
}

async function renderProject({ jobId, project, images, audio, music, outputPath, ffmpegCommand, ffprobeCommand }) {
  const tempRoot = path.dirname(outputPath);
  const manifestPath = path.join(tempRoot, `${jobId}.txt`);
  try {
    await prisma.renderJob.update({ where: { id: jobId }, data: { status: "RUNNING", progress: 10, startedAt: new Date() } });
    const duration = await probeDuration(ffprobeCommand, audio.storagePath);
    const perImage = Math.max(0.5, duration / images.length);
    const manifest = images.flatMap((image) => [
      `file '${concatPath(image.storagePath)}'`,
      `duration ${perImage.toFixed(3)}`,
    ]);
    manifest.push(`file '${concatPath(images.at(-1).storagePath)}'`);
    await fs.writeFile(manifestPath, `${manifest.join("\n")}\n`, "utf8");
    await prisma.renderJob.update({ where: { id: jobId }, data: { progress: 25 } });

    const isPortrait = project.aspectRatio === "9:16";
    const [width, height] = project.resolution.split("x").map(Number);
    const filter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`;
    const renderArgs = [
      "-y", "-f", "concat", "-safe", "0", "-i", manifestPath,
      "-i", audio.storagePath,
    ];
    if (music) {
      // Loop the user-provided music so short tracks still cover the narration.
      // The music is intentionally mixed below the narration instead of replacing it.
      renderArgs.push("-stream_loop", "-1", "-i", music.storagePath);
    }
    renderArgs.push(
      "-vf", filter,
      "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
      "-map", "0:v:0",
    );
    if (music) {
      renderArgs.push(
        "-filter_complex", "[1:a]aresample=48000,volume=1.0[narration];[2:a]aresample=48000,volume=0.16[music];[narration][music]amix=inputs=2:duration=first:dropout_transition=2[aout]",
        "-map", "[aout]", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
      );
    } else {
      renderArgs.push("-map", "1:a:0", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2");
    }
    renderArgs.push("-t", String(duration), "-movflags", "+faststart", "-shortest", outputPath);
    await execFileAsync(ffmpegCommand, renderArgs, { maxBuffer: 1024 * 1024 * 4 });
    await prisma.renderJob.update({ where: { id: jobId }, data: { status: "COMPLETED", progress: 100, outputPath, completedAt: new Date() } });
    await prisma.videoProject.update({ where: { id: project.id }, data: { status: "COMPLETED" } });
    return { duration, orientation: isPortrait ? "portrait" : "landscape" };
  } catch (error) {
    const details = String(error?.stderr || error?.message || "FFmpeg render failed.").slice(-4000);
    await prisma.renderJob.update({ where: { id: jobId }, data: { status: "FAILED", progress: 0, errorMessage: details, completedAt: new Date() } }).catch(() => {});
    await prisma.videoProject.update({ where: { id: project.id }, data: { status: "RENDER_FAILED" } }).catch(() => {});
    return null;
  } finally {
    await fs.rm(manifestPath, { force: true }).catch(() => {});
  }
}

export function registerPhase1Routes(app, { rootDir, ffmpegCommand, ffprobeCommand, getPublishingConfig, publishVideo, getDemoVideoPath }) {
  const { storageRoot, incomingRoot, voiceRoot } = phase1Paths(rootDir);
  fsSync.mkdirSync(storageRoot, { recursive: true });
  fsSync.mkdirSync(incomingRoot, { recursive: true });
  fsSync.mkdirSync(voiceRoot, { recursive: true });
  const upload = multer({
    dest: incomingRoot,
    limits: { fileSize: 80 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
      const extension = safeExtension(file.originalname);
      const isImage = file.mimetype.startsWith("image/") && allowedImageExtensions.has(extension);
      const isAudio = file.mimetype.startsWith("audio/") && allowedAudioExtensions.has(extension);
      const isVideo = (file.mimetype === "video/mp4" || extension === ".mp4") && allowedVideoExtensions.has(extension);
      callback(isImage || isAudio || isVideo ? null : new Error("Only JPG, PNG, WebP, MP4, MP3, and WAV files are supported."), isImage || isAudio || isVideo);
    },
  });
  const voiceUpload = multer({
    dest: incomingRoot,
    limits: { fileSize: 30 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
      const extension = safeExtension(file.originalname);
      const valid = file.mimetype.startsWith("audio/") && allowedAudioExtensions.has(extension);
      callback(valid ? null : new Error("Voice samples must be MP3 or WAV files."), valid);
    },
  });
  const timelineUpload = multer({
    dest: incomingRoot,
    limits: { fileSize: 500 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
      const extension = safeExtension(file.originalname);
      const validVideo = (file.mimetype === "video/mp4" || extension === ".mp4") && allowedVideoExtensions.has(extension);
      const validAudio = file.mimetype.startsWith("audio/") && allowedAudioExtensions.has(extension);
      callback(validVideo || validAudio ? null : new Error("Timeline input must be an MP4 video or MP3/WAV narration."), validVideo || validAudio);
    },
  });

  async function ownedProject(projectId, userId, includeMedia = false) {
    return prisma.videoProject.findFirst({
      where: { id: projectId, userId },
      include: includeMedia ? { mediaAssets: { orderBy: [{ type: "asc" }, { displayOrder: "asc" }, { createdAt: "asc" }] }, renderJobs: { orderBy: { createdAt: "desc" }, take: 5 } } : undefined,
    });
  }

  async function persistNarration({ userId, input, audio, provider, model, mode, durationSeconds }) {
    const userVoiceRoot = path.join(voiceRoot, userId);
    await fs.mkdir(userVoiceRoot, { recursive: true });
    const filename = `${crypto.randomUUID()}.wav`;
    const storagePath = ensureContained(storageRoot, path.join(userVoiceRoot, filename));
    await fs.writeFile(storagePath, audio);
    try {
      const narration = await prisma.voiceNarration.create({
        data: {
          userId,
          projectId: input.projectId || null,
          title: input.title,
          script: input.script,
          voice: input.voice,
          speed: input.speed,
          provider,
          model,
          mode,
          status: "COMPLETED",
          storagePath,
          mimeType: "audio/wav",
          size: audio.length,
          durationSeconds,
        },
      });
      let asset = null;
      if (input.projectId) {
        const project = await ownedProject(input.projectId, userId);
        if (!project) throw new Error("Project not found.");
        const last = await prisma.mediaAsset.findFirst({ where: { projectId: project.id, type: "AUDIO" }, orderBy: { displayOrder: "desc" } });
        asset = await prisma.mediaAsset.create({
          data: { projectId: project.id, type: "AUDIO", filename: `${input.title}.wav`, storagePath, mimeType: "audio/wav", size: audio.length, displayOrder: (last?.displayOrder ?? -1) + 1 },
        });
      }
      return { narration: narrationResponse(narration, storageRoot, true), asset: asset ? { ...asset, previewUrl: `/api/v1/media/${asset.id}/preview` } : null };
    } catch (error) {
      await fs.rm(storagePath, { force: true }).catch(() => {});
      throw error;
    }
  }

  function timelineResponse(timeline) {
    return {
      ...timeline,
      videoUrl: timeline.outputPath ? `/api/v1/voice/timelines/${timeline.id}/video` : null,
      downloadUrl: timeline.outputPath ? `/api/v1/voice/timelines/${timeline.id}/download` : null,
      subtitleUrl: timeline.subtitlePath ? `/api/v1/voice/timelines/${timeline.id}/subtitles` : null,
      audioUrl: timeline.audioPath ? `/api/v1/voice/timelines/${timeline.id}/audio` : null,
    };
  }

  app.post("/api/v1/auth/register", async (req, res) => {
    try {
      const body = z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email().max(200), password: z.string().min(8).max(128) }).parse(req.body);
      const email = body.email.toLowerCase();
      const passwordHash = await bcrypt.hash(body.password, 12);
      const user = await prisma.user.create({ data: { name: body.name, email, passwordHash } });
      return res.status(201).json({ user: publicUser(user), accessToken: issueAccessToken(user) });
    } catch (error) {
      const status = error?.code === "P2002" ? 409 : error?.name === "ZodError" ? 400 : 500;
      return res.status(status).json({ error: status === 409 ? "An account with that email already exists." : error?.name === "ZodError" ? error.issues[0]?.message : "Registration failed." });
    }
  });

  app.post("/api/v1/auth/login", async (req, res) => {
    try {
      const body = z.object({ email: z.string().trim().email(), password: z.string().min(1) }).parse(req.body);
      const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
      if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) return res.status(401).json({ error: "Email or password is incorrect." });
      return res.json({ user: publicUser(user), accessToken: issueAccessToken(user) });
    } catch (error) {
      return res.status(error?.name === "ZodError" ? 400 : 500).json({ error: error?.name === "ZodError" ? error.issues[0]?.message : "Login failed." });
    }
  });

  app.get("/api/v1/auth/me", requireAuth, async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(401).json({ error: "Your session is no longer valid." });
    return res.json({ user: publicUser(user) });
  });

  app.get("/api/v1/projects", requireAuth, async (req, res) => {
    const projects = await prisma.videoProject.findMany({ where: { userId: req.userId }, include: { mediaAssets: true, renderJobs: { orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" } });
    return res.json({ projects: projects.map(formatProject) });
  });

  app.post("/api/v1/projects", requireAuth, async (req, res) => {
    try {
      const input = validateProjectInput(req.body);
      const project = await prisma.videoProject.create({ data: { ...input, userId: req.userId }, include: { mediaAssets: true, renderJobs: true } });
      return res.status(201).json({ project: formatProject(project) });
    } catch (error) {
      return res.status(error?.name === "ZodError" ? 400 : 500).json({ error: error?.name === "ZodError" ? error.issues[0]?.message : "Project could not be created." });
    }
  });

  app.get("/api/v1/projects/:id", requireAuth, async (req, res) => {
    const project = await ownedProject(req.params.id, req.userId, true);
    if (!project) return res.status(404).json({ error: "Project not found." });
    return res.json({ project: formatProject(project) });
  });

  app.patch("/api/v1/projects/:id", requireAuth, async (req, res) => {
    try {
      const existing = await ownedProject(req.params.id, req.userId);
      if (!existing) return res.status(404).json({ error: "Project not found." });
      const input = validateProjectInput(req.body, true);
      const project = await prisma.videoProject.update({ where: { id: existing.id }, data: input, include: { mediaAssets: true, renderJobs: true } });
      return res.json({ project: formatProject(project) });
    } catch (error) {
      return res.status(error?.name === "ZodError" ? 400 : 500).json({ error: error?.name === "ZodError" ? error.issues[0]?.message : "Project could not be updated." });
    }
  });

  app.delete("/api/v1/projects/:id", requireAuth, async (req, res) => {
    const project = await ownedProject(req.params.id, req.userId);
    if (!project) return res.status(404).json({ error: "Project not found." });
    await prisma.videoProject.delete({ where: { id: project.id } });
    await fs.rm(path.join(storageRoot, project.id), { recursive: true, force: true });
    return res.status(204).end();
  });

  app.post("/api/v1/gemini/generate-script", requireAuth, async (req, res) => {
    try {
      const body = z.object({ projectId: z.string().uuid(), topic: z.string().trim().min(1).max(500), language: z.string().default("km"), durationMinutes: z.coerce.number().int().min(1).max(15) }).parse(req.body);
      const project = await ownedProject(body.projectId, req.userId);
      if (!project) return res.status(404).json({ error: "Project not found." });
      const result = await generateKhmerScript(body);
      const updated = await prisma.videoProject.update({ where: { id: project.id }, data: { topic: body.topic, language: body.language, durationMinutes: body.durationMinutes, script: result.script, status: "SCRIPT_READY" } });
      return res.json({ script: result.script, provider: result.provider, model: result.model, status: "completed", project: formatProject(updated) });
    } catch (error) {
      const transient = isTransientGeminiError(error);
      const status = error?.name === "ZodError" ? 400 : transient ? 503 : (error?.status || 502);
      const message = error?.name === "ZodError"
        ? error.issues[0]?.message
        : transient
          ? "Gemini is temporarily busy. Please try generating the script again in a moment."
          : providerErrorMessage(error, "Gemini script generation failed.");
      return res.status(status).json({ error: message, code: transient ? "GEMINI_TEMPORARILY_BUSY" : error?.code || "GEMINI_ERROR" });
    }
  });

  app.post("/api/v1/projects/:id/voice/generate", requireAuth, voiceUpload.fields([{ name: "sourceAudio", maxCount: 1 }, { name: "consentAudio", maxCount: 1 }]), async (req, res) => {
    const files = req.files || {};
    const sourceAudio = files.sourceAudio?.[0];
    const consentAudio = files.consentAudio?.[0];
    const tempPaths = [sourceAudio?.path, consentAudio?.path].filter(Boolean);
    try {
      const project = await ownedProject(req.params.id, req.userId);
      if (!project) return res.status(404).json({ error: "Project not found." });
      const body = z.object({ script: z.string().trim().min(1).max(30000), consent: z.string().refine((value) => value === "true", "Voice ownership consent is required.") }).parse(req.body || {});
      if (!sourceAudio || !consentAudio) return res.status(400).json({ error: "Upload both a clean voice sample and a consent recording." });
      const sourceDuration = await probeDuration(ffprobeCommand, sourceAudio.path);
      if (sourceDuration < 10 || sourceDuration > 30) return res.status(400).json({ error: "The voice sample must be between 10 and 30 seconds." });
      const consentDuration = await probeDuration(ffprobeCommand, consentAudio.path);
      if (consentDuration < 2 || consentDuration > 30) return res.status(400).json({ error: "The consent recording must be between 2 and 30 seconds." });
      const generated = await generateReplicatedVoiceover({ script: body.script, sourceAudioPath: sourceAudio.path, consentAudioPath: consentAudio.path, ffmpegCommand });
      const projectDir = path.join(storageRoot, project.id);
      await fs.mkdir(projectDir, { recursive: true });
      const storedName = `${crypto.randomUUID()}-similar-voice.wav`;
      const storagePath = ensureContained(storageRoot, path.join(projectDir, storedName));
      await fs.writeFile(storagePath, generated.audio);
      await prisma.mediaAsset.updateMany({ where: { projectId: project.id, type: "AUDIO" }, data: { displayOrder: { increment: 1 } } });
      const asset = await prisma.mediaAsset.create({ data: { projectId: project.id, type: "AUDIO", filename: "generated-similar-voice.wav", storagePath, mimeType: "audio/wav", size: generated.audio.length, displayOrder: 0 } });
      return res.status(201).json({ asset: { ...asset, previewUrl: `/api/v1/media/${asset.id}/preview` }, provider: generated.provider, model: generated.model, voiceMode: "similar-to-authorized-sample", storageMode: generated.storageMode, status: "completed" });
    } catch (error) {
      const status = error?.status || (error?.name === "ZodError" ? 400 : 502);
      return res.status(status).json({ error: error?.name === "ZodError" ? error.issues[0]?.message : error.message || "Similar voice generation failed.", code: error?.code || "VOICE_GENERATION_ERROR" });
    } finally {
      await Promise.all(tempPaths.map((filePath) => fs.rm(filePath, { force: true }).catch(() => {})));
    }
  });

  app.get("/api/v1/voice/catalog", requireAuth, (_req, res) => {
    return res.json(voiceCatalog());
  });

  app.post("/api/v1/recap/chinese", requireAuth, async (req, res) => {
    let input = null;
    try {
      input = z.object({
        text: z.string().trim().min(20, "Paste at least 20 characters of Chinese subtitles or story text.").max(50000),
        targetLanguage: z.enum(["km", "en"]).default("km"),
        title: z.string().trim().max(120).default("Chinese story recap"),
      }).parse(req.body || {});
      if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: "Gemini is not configured. Add GEMINI_API_KEY before generating a recap.", code: "GEMINI_NOT_CONFIGURED" });
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const language = input.targetLanguage === "km" ? "natural spoken Khmer" : "clear spoken English";
      const prompt = [
        "You are a professional Chinese drama and movie recap writer.",
        `Rewrite the Chinese source into an original ${language} story recap for a short-form video.`,
        "Preserve the main characters, conflict, turning points, and ending supported by the source.",
        "Do not invent facts, do not mention translation, do not use markdown headings, and do not include timestamps.",
        "Use short paragraphs with natural narration, a strong opening hook, and a concise ending.",
        `Title: ${input.title}`,
        "Chinese source subtitles/story:",
        input.text,
      ].join("\n\n");
      const model = process.env.GEMINI_TEXT_MODEL || process.env.GEMINI_MODEL || "gemini-3.8-flash";
      const response = await withGeminiRetry(() => ai.models.generateContent({ model, contents: prompt }));
      const recap = typeof response?.text === "string"
        ? response.text.trim()
        : response?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n").trim() || "";
      if (!recap) throw new Error("Gemini returned an empty recap.");
      return res.json({ recap, targetLanguage: input.targetLanguage, provider: "gemini", model });
    } catch (error) {
      const status = error?.name === "ZodError" ? 400 : isTransientGeminiError(error) ? 503 : (error?.status || 502);
      const message = error?.name === "ZodError"
        ? error.issues[0]?.message
        : isTransientGeminiError(error)
          ? "Gemini is temporarily busy. Please try the recap again in a moment; your source text is still saved in this form."
          : error.message || "Chinese story recap failed.";
      return res.status(status).json({ error: message, code: isTransientGeminiError(error) ? "GEMINI_TEMPORARILY_BUSY" : error?.code || "CHINESE_RECAP_ERROR" });
    }
  });

  app.get("/api/v1/voice/narrations", requireAuth, async (req, res) => {
    const narrations = await prisma.voiceNarration.findMany({ where: { userId: req.userId }, orderBy: { createdAt: "desc" }, take: 50 });
    return res.json({ narrations: narrations.map((item) => narrationResponse(item, storageRoot)) });
  });

  app.patch("/api/v1/voice/narrations/:id", requireAuth, async (req, res) => {
    try {
      const title = z.object({ title: z.string().trim().min(1, "Enter a narration title.").max(120) }).parse(req.body || {}).title;
      const narration = await prisma.voiceNarration.findFirst({ where: { id: req.params.id, userId: req.userId } });
      if (!narration) return res.status(404).json({ error: "Narration not found." });
      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.voiceNarration.update({ where: { id: narration.id }, data: { title } });
        if (narration.projectId) {
          await tx.mediaAsset.updateMany({ where: { projectId: narration.projectId, storagePath: narration.storagePath }, data: { filename: `${title}.wav` } });
        }
        return result;
      });
      return res.json({ narration: narrationResponse(updated, storageRoot, true) });
    } catch (error) {
      return res.status(error?.name === "ZodError" ? 400 : 500).json({ error: error?.name === "ZodError" ? error.issues[0]?.message : error.message || "Narration update failed." });
    }
  });

  app.delete("/api/v1/voice/narrations/:id", requireAuth, async (req, res) => {
    try {
      const narration = await prisma.voiceNarration.findFirst({ where: { id: req.params.id, userId: req.userId } });
      if (!narration) return res.status(404).json({ error: "Narration not found." });
      await prisma.$transaction(async (tx) => {
        if (narration.projectId) await tx.mediaAsset.deleteMany({ where: { projectId: narration.projectId, storagePath: narration.storagePath } });
        await tx.voiceNarration.delete({ where: { id: narration.id } });
      });
      await fs.rm(ensureContained(storageRoot, narration.storagePath), { force: true });
      return res.json({ ok: true, id: narration.id });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Narration deletion failed." });
    }
  });

  app.post("/api/v1/voice/narrations", requireAuth, async (req, res) => {
    try {
      const input = voiceRequestSchema(req.body);
      if (input.projectId && !(await ownedProject(input.projectId, req.userId))) return res.status(404).json({ error: "Project not found." });
      const generated = await generateStandardVoiceover({ script: input.script, voice: input.voice, speed: input.speed, ffmpegCommand, tempDir: incomingRoot });
      const durationSeconds = await (async () => {
        const temporaryPath = path.join(incomingRoot, `${crypto.randomUUID()}-duration.wav`);
        try { await fs.writeFile(temporaryPath, generated.audio); return await probeDuration(ffprobeCommand, temporaryPath); }
        finally { await fs.rm(temporaryPath, { force: true }).catch(() => {}); }
      })();
      const saved = await persistNarration({ userId: req.userId, input, audio: generated.audio, provider: generated.provider, model: generated.model, mode: "TTS", durationSeconds });
      return res.status(201).json({ ...saved, status: "completed" });
    } catch (error) {
      const status = error?.status || (error?.name === "ZodError" ? 400 : 502);
      return res.status(status).json({ error: error?.name === "ZodError" ? error.issues[0]?.message : error.message || "Khmer narration generation failed.", code: error?.code || "VOICE_GENERATION_ERROR" });
    }
  });

  app.post("/api/v1/voice/narrations/:id/regenerate-paragraph", requireAuth, async (req, res) => {
    try {
      const parent = await prisma.voiceNarration.findFirst({ where: { id: req.params.id, userId: req.userId } });
      if (!parent) return res.status(404).json({ error: "Narration not found." });
      const paragraphs = parent.script.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
      const paragraphIndex = z.coerce.number().int().min(0).max(Math.max(0, paragraphs.length - 1)).parse(req.body?.paragraphIndex);
      const input = voiceRequestSchema({
        script: paragraphs[paragraphIndex],
        title: `${parent.title} · paragraph ${paragraphIndex + 1}`,
        voice: req.body?.voice || parent.voice,
        speed: req.body?.speed ?? parent.speed,
        projectId: parent.projectId,
      });
      const generated = await generateStandardVoiceover({ script: input.script, voice: input.voice, speed: input.speed, ffmpegCommand, tempDir: incomingRoot });
      const durationPath = path.join(incomingRoot, `${crypto.randomUUID()}-duration.wav`);
      let durationSeconds;
      try { await fs.writeFile(durationPath, generated.audio); durationSeconds = await probeDuration(ffprobeCommand, durationPath); }
      finally { await fs.rm(durationPath, { force: true }).catch(() => {}); }
      const saved = await persistNarration({ userId: req.userId, input, audio: generated.audio, provider: generated.provider, model: generated.model, mode: "PARAGRAPH", durationSeconds });
      return res.status(201).json({ ...saved, paragraphIndex, status: "completed" });
    } catch (error) {
      const status = error?.status || (error?.name === "ZodError" ? 400 : 502);
      return res.status(status).json({ error: error?.name === "ZodError" ? error.issues[0]?.message : error.message || "Paragraph regeneration failed.", code: error?.code || "VOICE_GENERATION_ERROR" });
    }
  });

  app.post("/api/v1/voice/upload", requireAuth, voiceUpload.single("file"), async (req, res) => {
    const tempPath = req.file?.path;
    try {
      if (!req.file) return res.status(400).json({ error: "Choose an MP3 or WAV narration file." });
      const projectId = req.body?.projectId ? z.string().uuid().parse(req.body.projectId) : null;
      if (projectId && !(await ownedProject(projectId, req.userId))) return res.status(404).json({ error: "Project not found." });
      const input = { script: String(req.body?.script || "Recorded narration"), title: String(req.body?.title || req.file.originalname.replace(/\.[^.]+$/, "")).trim().slice(0, 120) || "Recorded narration", voice: "uploaded", speed: 1, projectId };
      const audio = await fs.readFile(tempPath);
      const durationSeconds = await probeDuration(ffprobeCommand, tempPath);
      const saved = await persistNarration({ userId: req.userId, input, audio, provider: "manual-upload", model: null, mode: "UPLOAD", durationSeconds });
      return res.status(201).json({ ...saved, status: "completed" });
    } catch (error) {
      return res.status(error?.name === "ZodError" ? 400 : 500).json({ error: error?.name === "ZodError" ? error.issues[0]?.message : error.message || "Recorded narration upload failed." });
    } finally {
      if (tempPath) await fs.rm(tempPath, { force: true }).catch(() => {});
    }
  });

  app.get("/api/v1/voice/narrations/:id/preview", requireAuth, async (req, res) => {
    const narration = await prisma.voiceNarration.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!narration) return res.status(404).json({ error: "Narration not found." });
    const filePath = ensureContained(storageRoot, narration.storagePath);
    if (!fsSync.existsSync(filePath)) return res.status(404).json({ error: "Narration file is missing from local storage." });
    res.type(narration.mimeType);
    return res.sendFile(filePath);
  });

  app.get("/api/v1/voice/narrations/:id/download", requireAuth, async (req, res) => {
    const narration = await prisma.voiceNarration.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!narration) return res.status(404).json({ error: "Narration not found." });
    const filePath = ensureContained(storageRoot, narration.storagePath);
    if (!fsSync.existsSync(filePath)) return res.status(404).json({ error: "Narration file is missing from local storage." });
    return res.download(filePath, `${narration.title.replace(/[^a-z0-9\u1780-\u17ff]+/gi, "-") || "khmer-narration"}.wav`);
  });

  app.get("/api/v1/voice/timelines", requireAuth, async (req, res) => {
    const timelines = await prisma.voiceTimeline.findMany({ where: { userId: req.userId }, orderBy: { createdAt: "desc" }, take: 30 });
    return res.json({ timelines: timelines.map(timelineResponse) });
  });

  app.post("/api/v1/voice/timelines", requireAuth, timelineUpload.fields([{ name: "video", maxCount: 1 }, { name: "audio", maxCount: 1 }]), async (req, res) => {
    const files = req.files || {};
    const videoFile = files.video?.[0];
    const audioFile = files.audio?.[0];
    const cleanupPaths = [videoFile?.path, audioFile?.path].filter(Boolean);
    let timelineDir = null;
    try {
      if (!videoFile) return res.status(400).json({ error: "Choose an MP4 video for the timeline." });
      const body = z.object({
        title: z.string().trim().min(1).max(120).default("Khmer timeline voice"),
        voice: z.string().trim().min(1).default("Kore").refine((value) => supportedTtsVoices.some((item) => item.id === value), "Choose a supported Gemini voice."),
        srt: z.string().max(500000).default(""),
        script: z.string().trim().max(30000).default(""),
        projectId: z.string().uuid().optional().nullable(),
      }).parse(req.body || {});
      if (body.projectId && !(await ownedProject(body.projectId, req.userId))) return res.status(404).json({ error: "Project not found." });
      const subtitleText = srtToText(body.srt);
      const script = body.script || subtitleText;
      if (!audioFile && !script) return res.status(400).json({ error: "Paste an SRT/script or upload an MP3/WAV narration." });
      const durationSeconds = await probeDuration(ffprobeCommand, videoFile.path);
      const id = crypto.randomUUID();
      timelineDir = ensureContained(voiceRoot, path.join(voiceRoot, req.userId, "timelines", id));
      await fs.mkdir(timelineDir, { recursive: true });
      const sourcePath = ensureContained(storageRoot, path.join(timelineDir, "source.mp4"));
      await fs.copyFile(videoFile.path, sourcePath);
      let subtitlePath = null;
      if (body.srt.trim()) {
        subtitlePath = ensureContained(storageRoot, path.join(timelineDir, "captions.srt"));
        await fs.writeFile(subtitlePath, body.srt.replace(/\r/g, ""), "utf8");
      }
      const audioPath = ensureContained(storageRoot, path.join(timelineDir, "narration.wav"));
      if (audioFile) await normalizeVoiceClip(ffmpegCommand, audioFile.path, audioPath);
      else {
        const generated = await generateStandardVoiceover({ script, voice: body.voice, speed: 1, ffmpegCommand, tempDir: incomingRoot });
        await fs.writeFile(audioPath, generated.audio);
      }
      const mixedPath = ensureContained(storageRoot, path.join(timelineDir, "mixed.mp4"));
      await execFileAsync(ffmpegCommand, ["-y", "-i", sourcePath, "-i", audioPath, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", mixedPath], { maxBuffer: 1024 * 1024 * 4 });
      const outputPath = ensureContained(storageRoot, path.join(timelineDir, "timeline.mp4"));
      if (subtitlePath) {
        try { await burnTimelineSubtitles({ inputPath: mixedPath, subtitlePath, outputPath, ffmpegCommand }); }
        catch { await fs.copyFile(mixedPath, outputPath); }
      } else await fs.copyFile(mixedPath, outputPath);
      const timeline = await prisma.voiceTimeline.create({ data: { id, userId: req.userId, projectId: body.projectId || null, title: body.title, voice: body.voice, sourcePath, audioPath, subtitlePath, outputPath, subtitleText: subtitleText || script, status: "COMPLETED", durationSeconds } });
      let asset = null;
      if (body.projectId) {
        const last = await prisma.mediaAsset.findFirst({ where: { projectId: body.projectId, type: "VIDEO" }, orderBy: { displayOrder: "desc" } });
        asset = await prisma.mediaAsset.create({ data: { projectId: body.projectId, type: "VIDEO", filename: `${body.title}.mp4`, storagePath: outputPath, mimeType: "video/mp4", size: (await fs.stat(outputPath)).size, displayOrder: (last?.displayOrder ?? -1) + 1 } });
        const now = new Date();
        await prisma.renderJob.create({ data: { projectId: body.projectId, status: "COMPLETED", progress: 100, outputPath, startedAt: now, completedAt: now } });
        await prisma.videoProject.update({ where: { id: body.projectId }, data: { status: "COMPLETED", script: script || undefined } });
      }
      return res.status(201).json({ timeline: timelineResponse(timeline), asset: asset ? { ...asset, previewUrl: `/api/v1/media/${asset.id}/preview` } : null });
    } catch (error) {
      if (timelineDir) await fs.rm(timelineDir, { recursive: true, force: true }).catch(() => {});
      const status = error?.status || (error?.name === "ZodError" ? 400 : 502);
      return res.status(status).json({ error: error?.name === "ZodError" ? error.issues[0]?.message : error.message || "Timeline voice export failed.", code: error?.code || "TIMELINE_VOICE_ERROR" });
    } finally {
      await Promise.all(cleanupPaths.map((filePath) => fs.rm(filePath, { force: true }).catch(() => {})));
    }
  });

  async function sendTimelineFile(req, res, field, mimeType, downloadName) {
    const timeline = await prisma.voiceTimeline.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!timeline) return res.status(404).json({ error: "Timeline not found." });
    const filePath = timeline[field];
    if (!filePath) return res.status(404).json({ error: "This timeline file is not available." });
    const safePath = ensureContained(storageRoot, filePath);
    if (!fsSync.existsSync(safePath)) return res.status(404).json({ error: "Timeline file is missing from local storage." });
    res.type(mimeType);
    return downloadName ? res.download(safePath, downloadName) : res.sendFile(safePath);
  }

  app.get("/api/v1/voice/timelines/:id/video", requireAuth, (req, res) => sendTimelineFile(req, res, "outputPath", "video/mp4"));
  app.get("/api/v1/voice/timelines/:id/download", requireAuth, (req, res) => sendTimelineFile(req, res, "outputPath", "video/mp4", "khmer-timeline.mp4"));
  app.get("/api/v1/voice/timelines/:id/audio", requireAuth, (req, res) => sendTimelineFile(req, res, "audioPath", "audio/wav"));
  app.get("/api/v1/voice/timelines/:id/subtitles", requireAuth, (req, res) => sendTimelineFile(req, res, "subtitlePath", "application/x-subrip"));

  app.get("/api/v1/publishing/config", requireAuth, async (_req, res) => {
    return res.json({ config: await publishingConfig(getPublishingConfig) });
  });

  app.post("/api/v1/publishing/generate-metadata", requireAuth, async (req, res) => {
    try {
      const input = z.object({
        projectId: z.string().uuid(),
        platform: z.enum(["YOUTUBE", "FACEBOOK"]).default("YOUTUBE"),
      }).parse(req.body || {});
      const project = await prisma.videoProject.findFirst({ where: { id: input.projectId, userId: req.userId } });
      if (!project) return res.status(404).json({ error: "Project not found." });
      if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: "Gemini metadata is not configured. Use the project fields manually.", code: "GEMINI_NOT_CONFIGURED" });

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const model = process.env.GEMINI_TEXT_MODEL || process.env.GEMINI_MODEL || "gemini-3.8-flash";
      const prompt = [
        "Create publication metadata for an original Chinese story recap video.",
        `Destination platform: ${input.platform === "FACEBOOK" ? "Facebook Page" : "YouTube"}.`,
        "Write a clear, clickable title under 100 characters, a natural Khmer description under 5000 characters, and 5 to 12 useful search tags.",
        "Use only facts present in the project data. Do not invent characters, events, claims, links, or rights. Do not use markdown fences.",
        "Return JSON only in this exact shape: {\"title\":\"...\",\"description\":\"...\",\"tags\":[\"...\"]}.",
        `Project title: ${project.title}`,
        `Topic: ${project.topic}`,
        `Narration script: ${String(project.script || "").slice(0, 30000)}`,
      ].join("\n\n");
      const response = await withGeminiRetry(() => ai.models.generateContent({ model, contents: prompt }));
      const raw = pickScriptText(response).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      let parsed;
      try { parsed = JSON.parse(raw); } catch { throw new Error("Gemini returned invalid publication metadata. Please use the project fields manually."); }
      const title = String(parsed?.title || "").trim().slice(0, 100);
      const description = String(parsed?.description || "").trim().slice(0, 5000);
      const tags = Array.isArray(parsed?.tags) ? parsed.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12).join(", ") : "";
      if (!title || !description || !tags) throw new Error("Gemini returned incomplete publication metadata. Please use the project fields manually.");
      return res.json({ title, description, tags, provider: "gemini", model, status: "completed" });
    } catch (error) {
      const status = error?.status || (error?.name === "ZodError" ? 400 : 502);
      return res.status(status).json({ error: error?.name === "ZodError" ? error.issues[0]?.message : error.message || "Gemini metadata generation failed.", code: error?.code || "GEMINI_METADATA_ERROR" });
    }
  });

  app.get("/api/v1/publishing/jobs", requireAuth, async (req, res) => {
    const jobs = await prisma.publishJob.findMany({
      where: { userId: req.userId },
      include: { project: true },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
    return res.json({ jobs: jobs.map(publishJobResponse) });
  });

  app.post("/api/v1/publishing/jobs", requireAuth, async (req, res) => {
    try {
      const input = z.object({
        projectId: z.string().uuid(),
        platform: z.enum(["YOUTUBE", "FACEBOOK"]),
        title: z.string().trim().min(1).max(100),
        description: z.string().max(5000).default(""),
        tags: z.string().max(500).default(""),
        privacyStatus: z.enum(["private", "unlisted", "public"]).default("private"),
        scheduledAt: z.string().trim().optional().nullable().refine((value) => !value || !Number.isNaN(Date.parse(value)), "Use a valid schedule date."),
        timezone: z.string().trim().min(1).max(80).default("Asia/Phnom_Penh"),
        rightsVerified: z.literal(true, "Confirm that you have permission to publish this video."),
      }).parse(req.body || {});
      const project = await prisma.videoProject.findFirst({
        where: { id: input.projectId, userId: req.userId },
        include: { renderJobs: { orderBy: { createdAt: "desc" }, take: 1 } },
      });
      if (!project) return res.status(404).json({ error: "Project not found." });
      const latestRender = project.renderJobs[0];
      if (!latestRender || latestRender.status !== "COMPLETED" || !latestRender.outputPath || !fsSync.existsSync(ensureContained(storageRoot, latestRender.outputPath))) {
        return res.status(409).json({ error: "Only a completed rendered MP4 can be added to the publishing queue.", code: "RENDER_REQUIRED" });
      }
      const job = await prisma.publishJob.create({
        data: {
          userId: req.userId,
          projectId: project.id,
          platform: input.platform,
          status: "PENDING_APPROVAL",
          title: input.title,
          description: input.description,
          tags: input.tags || null,
          privacyStatus: input.privacyStatus,
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
          timezone: input.timezone,
          rightsVerified: true,
        },
        include: { project: true },
      });
      return res.status(201).json({ job: publishJobResponse(job) });
    } catch (error) {
      const status = error?.name === "ZodError" ? 400 : 500;
      return res.status(status).json({ error: error?.name === "ZodError" ? error.issues[0]?.message : "Publishing draft could not be created." });
    }
  });

  app.post("/api/v1/publishing/jobs/:id/approve", requireAuth, async (req, res) => {
    const job = await prisma.publishJob.findFirst({ where: { id: req.params.id, userId: req.userId }, include: { project: true } });
    if (!job) return res.status(404).json({ error: "Publishing draft not found." });
    if (!job.rightsVerified) return res.status(409).json({ error: "Rights confirmation is required before approval." });
    if (job.status !== "PENDING_APPROVAL") return res.status(409).json({ error: `This draft is already ${job.status.toLowerCase().replaceAll("_", " ")}.` });
    const updated = await prisma.publishJob.update({ where: { id: job.id }, data: { status: job.scheduledAt ? "SCHEDULED" : "APPROVED", approvedAt: new Date() }, include: { project: true } });
    return res.json({ job: publishJobResponse(updated) });
  });

  app.post("/api/v1/publishing/jobs/:id/cancel", requireAuth, async (req, res) => {
    const job = await prisma.publishJob.findFirst({ where: { id: req.params.id, userId: req.userId }, include: { project: true } });
    if (!job) return res.status(404).json({ error: "Publishing draft not found." });
    if (["PUBLISHED", "CANCELLED"].includes(job.status)) return res.status(409).json({ error: `This draft is already ${job.status.toLowerCase()}.` });
    const updated = await prisma.publishJob.update({ where: { id: job.id }, data: { status: "CANCELLED" }, include: { project: true } });
    return res.json({ job: publishJobResponse(updated) });
  });

  app.post("/api/v1/publishing/jobs/:id/publish", requireAuth, async (req, res) => {
    const job = await prisma.publishJob.findFirst({
      where: { id: req.params.id, userId: req.userId },
      include: { project: { include: { renderJobs: { orderBy: { createdAt: "desc" }, take: 1 } } } },
    });
    if (!job) return res.status(404).json({ error: "Publishing draft not found." });
    if (!["APPROVED", "SCHEDULED"].includes(job.status)) return res.status(409).json({ error: "Approve this draft before attempting publication." });
    const config = await publishingConfig(getPublishingConfig);
    const provider = job.platform === "YOUTUBE" ? config.youtube : config.facebook;
    if (!provider.canPublish) return res.status(409).json({ error: `${provider.label} is not configured for this server. Connect the official provider first; the draft remains approved.`, code: "PUBLISHING_NOT_CONFIGURED" });
    if (typeof publishVideo !== "function") return res.status(503).json({ error: "The provider upload adapter is not available in this deployment. No publication was attempted.", code: "PUBLISHING_ADAPTER_UNAVAILABLE" });
    const latestRender = job.project.renderJobs?.[0];
    if (!latestRender || latestRender.status !== "COMPLETED" || !latestRender.outputPath || !fsSync.existsSync(latestRender.outputPath)) {
      return res.status(409).json({ error: "Only a completed rendered MP4 can be published.", code: "RENDER_REQUIRED" });
    }

    await prisma.publishJob.update({ where: { id: job.id }, data: { status: "UPLOADING", errorMessage: null } });
    try {
      const result = await publishVideo({
        filePath: latestRender.outputPath,
        platform: job.platform,
        title: job.title,
        description: job.description,
        tags: job.tags || "",
        privacyStatus: job.privacyStatus,
      });
      const publishedUrl = result?.url || result?.publishedUrl || null;
      const updated = await prisma.publishJob.update({
        where: { id: job.id },
        data: { status: "PUBLISHED", publishedUrl, errorMessage: null },
        include: { project: true },
      });
      return res.json({ job: publishJobResponse(updated), result });
    } catch (error) {
      const message = error?.message || "Provider upload failed.";
      const failed = await prisma.publishJob.update({
        where: { id: job.id },
        data: { status: "FAILED", errorMessage: message },
        include: { project: true },
      });
      return res.status(502).json({ error: message, code: "PUBLISHING_FAILED", job: publishJobResponse(failed) });
    }
  });

  app.post("/api/v1/publishing/demo-project", requireAuth, async (req, res) => {
    if (typeof getDemoVideoPath !== "function") return res.status(503).json({ error: "The free demo video is not available in this deployment." });
    try {
      const sourcePath = await getDemoVideoPath();
      if (!sourcePath || !fsSync.existsSync(sourcePath)) return res.status(503).json({ error: "The free demo video could not be prepared." });
      const { storageRoot } = phase1Paths(rootDir);
      const projectId = crypto.randomUUID();
      const projectDir = path.join(storageRoot, projectId);
      await fs.mkdir(projectDir, { recursive: true });
      const outputPath = path.join(projectDir, "free-demo.mp4");
      await fs.copyFile(sourcePath, outputPath);
      const size = (await fs.stat(outputPath)).size;
      const now = new Date();
      const project = await prisma.videoProject.create({
        data: {
          id: projectId,
          userId: req.userId,
          title: "ToolAiMe free demo test",
          topic: "A free test video for the publishing workflow",
          language: "en",
          durationMinutes: 1,
          script: "Free demo test video generated by ToolAiMe.",
          status: "COMPLETED",
          aspectRatio: "16:9",
          resolution: "1280x720",
          mediaAssets: { create: { type: "VIDEO", filename: "free-demo.mp4", storagePath: outputPath, mimeType: "video/mp4", size } },
          renderJobs: { create: { status: "COMPLETED", progress: 100, outputPath, startedAt: now, completedAt: now } },
        },
        include: { mediaAssets: true, renderJobs: true },
      });
      return res.status(201).json({ project: formatProject(project) });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "The free demo project could not be created." });
    }
  });

  app.post("/api/v1/projects/:id/media", requireAuth, upload.single("file"), async (req, res) => {
    const tempPath = req.file?.path;
    try {
      const project = await ownedProject(req.params.id, req.userId);
      if (!project) return res.status(404).json({ error: "Project not found." });
      if (!req.file) return res.status(400).json({ error: "Choose an image, MP4 source video, narration, or background music file." });
      const extension = safeExtension(req.file.originalname);
      const requestedRole = String(req.body?.role || "").toUpperCase();
      const type = requestedRole === "MUSIC" && allowedAudioExtensions.has(extension)
        ? "MUSIC"
        : allowedAudioExtensions.has(extension) ? "AUDIO" : allowedVideoExtensions.has(extension) ? "VIDEO" : "IMAGE";
      const projectDir = path.join(storageRoot, project.id);
      await fs.mkdir(projectDir, { recursive: true });
      const storedName = `${crypto.randomUUID()}${extension}`;
      const storagePath = ensureContained(storageRoot, path.join(projectDir, storedName));
      // Railway's multer temp directory can be on the container filesystem
      // while STORAGE_PATH is a mounted volume. Copy across filesystems,
      // then remove the temporary upload instead of relying on rename().
      await fs.copyFile(tempPath, storagePath);
      await fs.rm(tempPath, { force: true });
      if (type === "VIDEO") {
        await execFileAsync(ffprobeCommand, ["-v", "error", "-show_entries", "format=format_name,duration", "-of", "json", storagePath]);
      }
      const last = await prisma.mediaAsset.findFirst({ where: { projectId: project.id, type }, orderBy: { displayOrder: "desc" } });
      const asset = await prisma.mediaAsset.create({ data: { projectId: project.id, type, filename: req.file.originalname, storagePath, mimeType: req.file.mimetype, size: req.file.size, displayOrder: (last?.displayOrder ?? -1) + 1 } });
      return res.status(201).json({ asset: { ...asset, previewUrl: `/api/v1/media/${asset.id}/preview` } });
    } catch (error) {
      if (tempPath) await fs.rm(tempPath, { force: true }).catch(() => {});
      return res.status(500).json({ error: error.message || "Media upload failed." });
    }
  });

  app.get("/api/v1/projects/:id/media", requireAuth, async (req, res) => {
    const project = await ownedProject(req.params.id, req.userId);
    if (!project) return res.status(404).json({ error: "Project not found." });
    const media = await prisma.mediaAsset.findMany({ where: { projectId: project.id }, orderBy: [{ type: "asc" }, { displayOrder: "asc" }] });
    return res.json({ media: media.map((asset) => ({ ...asset, previewUrl: `/api/v1/media/${asset.id}/preview` })) });
  });

  app.patch("/api/v1/media/:id", requireAuth, async (req, res) => {
    const asset = await prisma.mediaAsset.findFirst({ where: { id: req.params.id, project: { userId: req.userId } } });
    if (!asset) return res.status(404).json({ error: "Media asset not found." });
    const order = z.coerce.number().int().min(0).parse(req.body?.displayOrder);
    const updated = await prisma.mediaAsset.update({ where: { id: asset.id }, data: { displayOrder: order } });
    return res.json({ asset: { ...updated, previewUrl: `/api/v1/media/${updated.id}/preview` } });
  });

  app.delete("/api/v1/media/:id", requireAuth, async (req, res) => {
    const asset = await prisma.mediaAsset.findFirst({ where: { id: req.params.id, project: { userId: req.userId } } });
    if (!asset) return res.status(404).json({ error: "Media asset not found." });
    await prisma.mediaAsset.delete({ where: { id: asset.id } });
    await fs.rm(asset.storagePath, { force: true });
    return res.status(204).end();
  });

  app.get("/api/v1/media/:id/preview", requireAuth, async (req, res) => {
    const asset = await prisma.mediaAsset.findFirst({ where: { id: req.params.id, project: { userId: req.userId } } });
    if (!asset) return res.status(404).json({ error: "Media asset not found." });
    const filePath = ensureContained(storageRoot, asset.storagePath);
    if (!fsSync.existsSync(filePath)) return res.status(404).json({ error: "Media file is missing from local storage." });
    res.type(asset.mimeType);
    return res.sendFile(filePath);
  });

  app.post("/api/v1/projects/:id/render", requireAuth, async (req, res) => {
    try {
      const project = await ownedProject(req.params.id, req.userId, true);
      if (!project) return res.status(404).json({ error: "Project not found." });
      const input = z.object({ aspectRatio: z.enum(["16:9", "9:16"]).default(project.aspectRatio), resolution: z.enum(["1920x1080", "1080x1920", "1280x720", "720x1280"]).default(project.resolution) }).parse(req.body || {});
      const images = project.mediaAssets.filter((asset) => asset.type === "IMAGE").sort((a, b) => a.displayOrder - b.displayOrder);
      const audio = project.mediaAssets.find((asset) => asset.type === "AUDIO");
      const music = project.mediaAssets.find((asset) => asset.type === "MUSIC");
      if (!images.length) return res.status(400).json({ error: "Upload at least one image before rendering." });
      if (!audio) return res.status(400).json({ error: "Upload one narration MP3 or WAV before rendering." });
      for (const asset of [...images, audio, ...(music ? [music] : [])]) {
        if (!fsSync.existsSync(ensureContained(storageRoot, asset.storagePath))) return res.status(400).json({ error: `Missing media file: ${asset.filename}` });
      }
      const updatedProject = await prisma.videoProject.update({ where: { id: project.id }, data: { aspectRatio: input.aspectRatio, resolution: input.resolution, status: "RENDERING" } });
      const job = await prisma.renderJob.create({ data: { projectId: project.id, status: "QUEUED", progress: 0 } });
      const renderDir = path.join(storageRoot, project.id, "renders");
      await fs.mkdir(renderDir, { recursive: true });
      const outputPath = ensureContained(storageRoot, path.join(renderDir, `${job.id}.mp4`));
      void renderProject({ jobId: job.id, project: updatedProject, images, audio, music, outputPath, ffmpegCommand, ffprobeCommand });
      return res.status(202).json({ job: { ...job, status: "QUEUED", progress: 0 } });
    } catch (error) {
      return res.status(error?.name === "ZodError" ? 400 : 500).json({ error: error?.name === "ZodError" ? error.issues[0]?.message : error.message || "Render could not be started." });
    }
  });

  app.get("/api/v1/render-jobs/:id", requireAuth, async (req, res) => {
    const job = await prisma.renderJob.findFirst({ where: { id: req.params.id, project: { userId: req.userId } }, include: { project: true } });
    if (!job) return res.status(404).json({ error: "Render job not found." });
    return res.json({ job: { ...job, downloadUrl: job.status === "COMPLETED" ? `/api/v1/render-jobs/${job.id}/download` : null } });
  });

  app.get("/api/v1/render-jobs/:id/download", requireAuth, async (req, res) => {
    const job = await prisma.renderJob.findFirst({ where: { id: req.params.id, project: { userId: req.userId } } });
    if (!job) return res.status(404).json({ error: "Render job not found." });
    if (job.status !== "COMPLETED" || !job.outputPath) return res.status(409).json({ error: "This render is not ready yet." });
    const filePath = ensureContained(storageRoot, job.outputPath);
    if (!fsSync.existsSync(filePath)) return res.status(404).json({ error: "Rendered MP4 is missing from local storage." });
    if (req.query.inline === "1") {
      res.type("video/mp4");
      return res.sendFile(filePath);
    }
    return res.download(filePath, `${job.projectId}.mp4`);
  });

  app.use("/api/v1", (error, _req, res, next) => {
    if (!error) return next();
    return res.status(400).json({ error: error.message || "Phase 1 request failed." });
  });
}

export async function disconnectPhase1() {
  await prisma.$disconnect();
}
