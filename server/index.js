import "dotenv/config";
import cors from "cors";
import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import { GoogleGenAI } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const generatedDir = path.join(__dirname, "generated");
const incomingDir = path.join(__dirname, "incoming");
const dataDir = path.join(__dirname, "data");
const libraryPath = path.join(dataDir, "library.json");
const youtubeTokenPath = path.join(dataDir, "youtube-token.json");
const facebookTokenPath = path.join(dataDir, "facebook-token.json");
const port = Number(process.env.PORT || 8787);
const app = express();
const execFileAsync = promisify(execFile);
const facebookGraphVersion = process.env.FB_GRAPH_VERSION || "v27.0";
const geminiApiVersion = process.env.GEMINI_API_VERSION || "v1beta";
const geminiRequestTimeout = Number(process.env.GEMINI_REQUEST_TIMEOUT_MS || 20000);
const geminiVideoRequestTimeout = Number(process.env.GEMINI_VIDEO_REQUEST_TIMEOUT_MS || 30000);
const geminiVideoJobTimeout = Number(process.env.GEMINI_VIDEO_JOB_TIMEOUT_MS || 360000);
const ffmpegThreads = String(Math.max(1, Number(process.env.FFMPEG_THREADS || 2)));
const generationJobs = new Map();

const uploadMiddleware = multer({
  dest: incomingDir,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const isVideo = file.mimetype.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(file.originalname);
    callback(isVideo ? null : new Error("Only MP4, MOV, or WebM video files are supported."), isVideo);
  },
});

const mediaUploadMiddleware = multer({
  dest: incomingDir,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const isMedia =
      file.mimetype.startsWith("video/") ||
      file.mimetype.startsWith("audio/") ||
      /\.(mp4|mov|webm|mp3|wav|m4a|aac|ogg)$/i.test(file.originalname);
    callback(isMedia ? null : new Error("Only common video or audio files are supported."), isMedia);
  },
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/generated", express.static(generatedDir));

const defaultPrompt =
  "A colorful miniature toy kitchen playset on a soft blue playmat. A tiny pink toaster pops up plastic toast while a toy rescue truck rolls in to deliver ingredients. Bright studio lighting, overhead macro camera, clean original toy designs, gentle playful movement, no branded characters, no text.";

const scenePresets = [
  {
    title: "Kitchen surprise",
    prompt:
      "Top-down macro studio video of an original pink miniature toy kitchen. A tiny toaster pops up plastic toast, colorful pretend vegetables move into a toy pan, and a small kettle wiggles gently. Bright softbox light, crisp detail, playful family-friendly tone, no logos or branded characters.",
    color: "coral",
  },
  {
    title: "Rescue delivery",
    prompt:
      "Overhead studio video of original colorful miniature rescue vehicles driving down a toy ramp toward a pretend kitchen. A red fire truck and yellow ambulance stop beside a tiny playset, with soft plastic wheels and a cheerful blue playmat. Smooth camera motion, bright clean lighting, no branded characters.",
    color: "blue",
  },
  {
    title: "Tiny picnic",
    prompt:
      "Close-up macro video of a miniature toy picnic on a pastel table: plastic fruit, tiny sandwiches, a tea set, and a little basket being arranged by playful hands. Warm studio lighting, vivid colors, gentle stop-motion feeling, original toy designs, no logos or text.",
    color: "yellow",
  },
  {
    title: "Playset finale",
    prompt:
      "Wide overhead studio shot of a colorful original toy town playset. Miniature kitchen, rescue station, toy cars, and pretend food come together for a cheerful finale with gentle movement and a slow camera push-in. Clean bright background, family-friendly, no branded characters.",
    color: "purple",
  },
];

let youtubeAuth = null;
let youtubeAccounts = [];
let activeYoutubeAccountId = null;
let facebookAuth = null;
let facebookOAuthState = null;

function tokenEncryptionKey() {
  const secret =
    process.env.APP_TOKEN_ENCRYPTION_KEY ||
    process.env.YT_TOKEN_ENCRYPTION_KEY ||
    process.env.FB_TOKEN_ENCRYPTION_KEY;
  return secret ? crypto.createHash("sha256").update(secret).digest() : null;
}

function encryptJson(value) {
  const key = tokenEncryptionKey();
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return JSON.stringify({
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  });
}

function decryptJson(payload) {
  const key = tokenEncryptionKey();
  if (!key) return null;
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const data = Buffer.concat([
    decipher.update(Buffer.from(payload.data, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(data.toString("utf8"));
}

async function loadAuth(filePath) {
  try {
    return decryptJson(JSON.parse(await fs.readFile(filePath, "utf8")));
  } catch {
    return null;
  }
}

async function saveAuth(filePath, value) {
  const payload = encryptJson(value);
  if (!payload) return;
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(filePath, payload, "utf8");
}

function hasGeminiConfig() {
  return Boolean(process.env.GEMINI_API_KEY);
}

function getGeminiVideoModel() {
  const configured = String(process.env.GEMINI_VIDEO_MODEL || "").trim();
  // Veo 3 model IDs previously used by this app are no longer valid here.
  if (!configured || /^(models\/)?veo-/i.test(configured)) return "gemini-omni-1.2-flash";
  return configured;
}

function hasYoutubeConfig() {
  return Boolean(process.env.YT_CLIENT_ID && process.env.YT_CLIENT_SECRET);
}

function hasFacebookConfig() {
  return Boolean(
    (process.env.FB_APP_ID && process.env.FB_APP_SECRET) ||
      (process.env.FB_PAGE_ID && process.env.FB_PAGE_ACCESS_TOKEN),
  );
}

function createGeminiClient({ timeout = geminiRequestTimeout } = {}) {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    apiVersion: geminiApiVersion,
    httpOptions: { timeout },
  });
}

function youtubeRedirectUri(req) {
  const forwardedProtocol = req.get("x-forwarded-proto")?.split(",")[0] || req.protocol;
  return process.env.YT_REDIRECT_URI || `${forwardedProtocol}://${req.get("host")}/api/auth/youtube/callback`;
}

function facebookRedirectUri(req) {
  const forwardedProtocol = req.get("x-forwarded-proto")?.split(",")[0] || req.protocol;
  return process.env.FB_REDIRECT_URI || `${forwardedProtocol}://${req.get("host")}/api/auth/facebook/callback`;
}

function createOAuthClient(redirectUri) {
  if (!hasYoutubeConfig()) return null;
  return new google.auth.OAuth2(
    process.env.YT_CLIENT_ID,
    process.env.YT_CLIENT_SECRET,
    redirectUri || process.env.YT_REDIRECT_URI || `http://localhost:${port}/api/auth/youtube/callback`,
  );
}

function facebookGraphUrl(pathname) {
  return `https://graph.facebook.com/${facebookGraphVersion}${pathname}`;
}

async function facebookJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.text();
  let data = {};
  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    data = { raw: body };
  }
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || data.raw || `Facebook API request failed (${response.status}).`);
  }
  return data;
}

function getFacebookPageCredentials() {
  if (process.env.FB_PAGE_ID && process.env.FB_PAGE_ACCESS_TOKEN) {
    return {
      id: process.env.FB_PAGE_ID,
      accessToken: process.env.FB_PAGE_ACCESS_TOKEN,
      name: process.env.FB_PAGE_NAME || "Configured Facebook Page",
    };
  }
  const requestedId = facebookAuth?.activePageId || process.env.FB_PAGE_ID;
  return (
    facebookAuth?.pages?.find((page) => page.access_token && (!requestedId || page.id === requestedId)) ||
    facebookAuth?.pages?.find((page) => page.access_token) ||
    null
  );
}

function getFacebookPageOptions() {
  if (process.env.FB_PAGE_ID && process.env.FB_PAGE_ACCESS_TOKEN) {
    return [{
      id: process.env.FB_PAGE_ID,
      name: process.env.FB_PAGE_NAME || "Configured Facebook Page",
      active: true,
      managedByEnvironment: true,
    }];
  }
  const activeId = facebookAuth?.activePageId || facebookAuth?.pages?.[0]?.id || null;
  return (facebookAuth?.pages || []).map((page) => ({
    id: page.id,
    name: page.name || "Facebook Page",
    active: page.id === activeId,
    tasks: page.tasks || [],
  }));
}

function getActiveYoutubeAccount() {
  return youtubeAccounts.find((account) => account.id === activeYoutubeAccountId) || youtubeAccounts[0] || null;
}

function youtubeAccountTokens(account) {
  return account?.tokens || (account?.access_token || account?.refresh_token ? account : null);
}

function getYoutubeAccountOptions() {
  return youtubeAccounts.map((account) => ({
    id: account.id,
    title: account.title || "Connected YouTube channel",
    handle: account.handle || "",
    subscribers: account.subscribers || "0",
    videos: account.videos || "0",
    active: account.id === (activeYoutubeAccountId || youtubeAccounts[0]?.id),
  }));
}

async function saveYoutubeAccounts() {
  await saveAuth(youtubeTokenPath, {
    activeId: activeYoutubeAccountId,
    accounts: youtubeAccounts,
  });
}

function aiProviderOptions() {
  const activeTextProvider = process.env.AI_TEXT_PROVIDER || "gemini";
  const activeVideoProvider = process.env.AI_VIDEO_PROVIDER || "gemini";
  return {
    activeTextProvider,
    activeVideoProvider,
    text: [
      { id: "gemini", label: "Gemini normal planner", configured: hasGeminiConfig(), description: "Creates titles, tags, scenes, and sound directions." },
      { id: "template", label: "Built-in planner", configured: true, description: "Uses the safe ToyPost workflow without an external AI key." },
    ],
    video: [
      { id: "gemini", label: "Gemini Omni video + sound", configured: hasGeminiConfig(), description: "Generates clips with synchronized audio directions." },
      { id: "external-upload", label: "Another AI tool", configured: true, description: "Generate with another tool, then upload its MP4 through the same publishing flow." },
    ],
    media: {
      configured: hasGeminiConfig(),
      label: "Gemini media lab",
      description: "Transcribes, translates, captions, and creates a voice track from an uploaded video.",
    },
  };
}

async function verifyFacebookPage() {
  const page = getFacebookPageCredentials();
  if (!page) return null;
  try {
    const url = new URL(facebookGraphUrl(`/${page.id}`));
    url.searchParams.set("fields", "id,name");
    url.searchParams.set("access_token", page.accessToken || page.access_token);
    const data = await facebookJson(url.toString());
    return { id: data.id || page.id, name: data.name || page.name || "Connected Facebook Page" };
  } catch (error) {
    return { error: error.message || "Facebook Page could not be verified." };
  }
}

async function readLibrary() {
  try {
    return JSON.parse(await fs.readFile(libraryPath, "utf8"));
  } catch {
    return [];
  }
}

async function writeLibrary(items) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(libraryPath, JSON.stringify(items, null, 2));
}

function createGenerationPlan(sceneCount, duration) {
  const requestedCount = Math.min(Math.max(Number(sceneCount) || 4, 2), 8);
  const targetDuration = Math.min(Math.max(Number(duration) || 60, 15), 120);
  const count = Math.min(Math.max(requestedCount, Math.ceil(targetDuration / 15)), 8);
  const baseDuration = Math.floor(targetDuration / count);
  const remainder = targetDuration % count;
  const durations = Array.from({ length: count }, (_, index) => baseDuration + (index < remainder ? 1 : 0));
  return { count, targetDuration, durations };
}

const audioDirection =
  "Audio direction: include synchronized cheerful original toy sound effects, soft plastic movement sounds, light kitchen clinks, and gentle original background music. No copyrighted songs, logos, or spoken dialogue.";

function createStoryPlanSchema(sceneCount) {
  return {
    type: "object",
    properties: {
      title: { type: "string", description: "A clear YouTube title under 100 characters." },
      description: { type: "string", description: "A family-friendly video description with a short story summary and relevant hashtags." },
      tags: { type: "array", items: { type: "string" }, description: "Five to twelve useful search tags." },
      scenes: {
        type: "array",
        minItems: sceneCount,
        maxItems: sceneCount,
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            prompt: { type: "string", description: "Visual action, camera, lighting, original toy design, and continuity details." },
            audio: { type: "string", description: "Sound effects, music, or silence for this scene. Do not request copyrighted songs." },
          },
          required: ["title", "prompt", "audio"],
        },
      },
    },
    required: ["title", "description", "tags", "scenes"],
  };
}

function findTextContent(interaction) {
  if (interaction.output_text) return interaction.output_text;
  return interaction.steps
    ?.filter((step) => step.type === "model_output")
    .flatMap((step) => step.content || [])
    .find((content) => content.type === "text")?.text;
}

function normalizeStoryPlan(value, generationPlan, sourcePrompt, model = process.env.GEMINI_TEXT_MODEL || "gemini-3.8-flash") {
  const fallbackTitle = "Original Toy Playset Adventure";
  const fallbackDescription = "A cheerful original toy playset adventure with gentle movement, playful sound, and family-friendly fun. #Toys #PretendPlay #KidsToys";
  const scenes = Array.from({ length: generationPlan.count }, (_, index) => {
    const preset = scenePresets[index % scenePresets.length];
    const scene = value?.scenes?.[index] || {};
    return {
      title: String(scene.title || preset.title).slice(0, 80),
      prompt: String(scene.prompt || preset.prompt).slice(0, 1800),
      audio: String(scene.audio || audioDirection).slice(0, 700),
      color: preset.color,
      duration: generationPlan.durations[index],
    };
  });
  const tags = Array.isArray(value?.tags) ? value.tags : ["toys", "kids toys", "pretend play", "original toy story"];
  return {
    sourcePrompt,
    title: String(value?.title || fallbackTitle).slice(0, 100),
    description: String(value?.description || fallbackDescription).slice(0, 5000),
    tags: tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 15),
    scenes,
    model,
  };
}

async function planStoryWithGemini({ prompt = defaultPrompt, sceneCount = 4, duration = 60 }) {
  const generationPlan = createGenerationPlan(sceneCount, duration);
  const ai = createGeminiClient();
  const model = process.env.GEMINI_TEXT_MODEL || "gemini-3.8-flash";
  const interaction = await withGeminiRetry(() => ai.interactions.create({
    model,
    input: `You are the normal Gemini story producer for a safe family-friendly toy video channel. Turn this idea into a production-ready plan for exactly ${generationPlan.count} scenes totaling ${generationPlan.targetDuration} seconds. Keep all characters and toys original; never use brand names or copyrighted characters. Write vivid but practical prompts for a video model. Include natural, original sound directions. Avoid scary, dangerous, sexual, political, or realistic child content.\n\nIDEA:\n${String(prompt).slice(0, 4000)}`,
    store: false,
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: createStoryPlanSchema(generationPlan.count),
    },
  }));
  const text = findTextContent(interaction);
  if (!text) throw new Error("Gemini returned no story plan.");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini returned an invalid story plan. Please try again.");
  }
  return normalizeStoryPlan(parsed, generationPlan, prompt);
}

function planStoryWithTemplate({ prompt = defaultPrompt, sceneCount = 4, duration = 60 }) {
  const generationPlan = createGenerationPlan(sceneCount, duration);
  return normalizeStoryPlan({
    title: "Original Toy Playset Adventure",
    description: "A cheerful original toy playset adventure with gentle movement, playful sound, and family-friendly fun. #Toys #PretendPlay #KidsToys",
    tags: ["toys", "kids toys", "pretend play", "miniature toys", "toy story"],
    scenes: Array.from({ length: generationPlan.count }, (_, index) => {
      const preset = scenePresets[index % scenePresets.length];
      return { title: preset.title, prompt: preset.prompt, audio: audioDirection };
    }),
  }, generationPlan, prompt, "built-in");
}

function isTransientGeminiError(error) {
  const status = Number(error?.status || error?.code || error?.response?.status);
  const message = String(error?.message || error || "");
  return [429, 500, 502, 503, 504].includes(status) || /high demand|temporar|overload|unavailable|resource exhausted|try again later/i.test(message);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withGeminiRetry(operation, { attempts = 4, baseDelayMs = 1000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientGeminiError(error) || attempt === attempts - 1) throw error;
      const delay = baseDelayMs * (2 ** attempt) + Math.floor(Math.random() * 500);
      await sleep(delay);
    }
  }
  throw lastError || new Error("Gemini request failed.");
}

async function planStoryWithProvider({ provider = process.env.AI_TEXT_PROVIDER || "gemini", prompt = defaultPrompt, sceneCount = 4, duration = 60 }) {
  if (provider === "template") return planStoryWithTemplate({ prompt, sceneCount, duration });
  if (provider !== "gemini") throw new Error(`Unsupported story planner: ${provider}.`);
  if (!hasGeminiConfig()) throw new Error("Add GEMINI_API_KEY to use Gemini planning, or choose the built-in planner.");
  try {
    return await planStoryWithGemini({ prompt, sceneCount, duration });
  } catch (error) {
    if (!isTransientGeminiError(error)) throw error;
    const fallback = planStoryWithTemplate({ prompt, sceneCount, duration });
    return {
      ...fallback,
      provider: "template",
      warning: "Gemini is temporarily busy, so ToyPost used its built-in planner. Try Gemini again later for AI-written metadata.",
    };
  }
}

function createDemoScenes(sceneCount, duration) {
  const plan = createGenerationPlan(sceneCount, duration);
  return Array.from({ length: plan.count }, (_, index) => {
    const preset = scenePresets[index % scenePresets.length];
    return {
      id: `scene-${Date.now()}-${index}`,
      title: preset.title,
      duration: plan.durations[index],
      color: preset.color,
      status: "ready",
      prompt: `${preset.prompt}\n\n${audioDirection}`,
      demo: true,
    };
  });
}

function findVideoContent(interaction) {
  if (interaction.output_video) return interaction.output_video;
  return interaction.steps
    ?.filter((step) => step.type === "model_output")
    .flatMap((step) => step.content || [])
    .find((content) => content.type === "video");
}

async function generateGeminiClip(prompt, index, total, duration) {
  const ai = createGeminiClient({ timeout: geminiVideoRequestTimeout });
  const model = getGeminiVideoModel();
  let interaction = await ai.interactions.create({
    model,
    input: prompt,
    store: false,
    response_format: {
      type: "video",
      aspect_ratio: "16:9",
      duration: `${duration}s`,
      delivery: "uri",
      resolution: "720p",
    },
  });

  const deadline = Date.now() + geminiVideoJobTimeout;
  let video = findVideoContent(interaction);
  while (!video && !["completed", "failed", "cancelled", "incomplete"].includes(interaction.status)) {
    if (Date.now() >= deadline) throw new Error("Gemini video generation timed out. Try a shorter video or try again later.");
    await sleep(8000);
    interaction = await withGeminiRetry(() => ai.interactions.get(interaction.id), { attempts: 3, baseDelayMs: 1000 });
    video = findVideoContent(interaction);
  }

  if (!video && interaction.status !== "completed") {
    const detail = interaction.errors?.map((item) => item.message).filter(Boolean).join("; ");
    throw new Error(detail || `Gemini video generation ended with status: ${interaction.status}.`);
  }

  if (!video?.data && !video?.uri) throw new Error("Gemini returned no generated video.");

  const filename = `scene-${Date.now()}-${index + 1}.mp4`;
  const outputPath = path.join(generatedDir, filename);
  if (video.data) {
    await fs.writeFile(outputPath, Buffer.from(video.data, "base64"));
  } else {
    const fileId = video.uri.match(/\/files\/([^/:?]+)/)?.[1];
    if (fileId) {
      while (Date.now() < deadline) {
        const file = await withGeminiRetry(() => ai.files.get({ name: `files/${fileId}` }), { attempts: 3, baseDelayMs: 1000 });
        const state = String(file.state || "").toUpperCase();
        if (state === "ACTIVE") break;
        if (state === "FAILED") throw new Error(file.error?.message || "Gemini video processing failed.");
        await sleep(5000);
      }
      if (Date.now() >= deadline) throw new Error("Gemini video processing timed out. Try a shorter video or try again later.");
    }
    const response = await fetch(video.uri, { headers: { "x-goog-api-key": process.env.GEMINI_API_KEY } });
    if (!response.ok) throw new Error(`Gemini video download failed with status ${response.status}.`);
    await fs.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
  }
  return {
    id: `scene-${Date.now()}-${index}`,
    title: `Scene ${index + 1} of ${total}`,
    duration,
    color: scenePresets[index % scenePresets.length].color,
    status: "ready",
    prompt,
    videoUrl: `/generated/${filename}`,
    demo: false,
  };
}

function getYoutubeClient() {
  const client = createOAuthClient();
  if (!client) return null;
  const activeAccount = getActiveYoutubeAccount();
  const activeTokens = youtubeAccountTokens(activeAccount);
  if (activeTokens) client.setCredentials(activeTokens);
  else if (process.env.YT_REFRESH_TOKEN) client.setCredentials({ refresh_token: process.env.YT_REFRESH_TOKEN });
  else if (youtubeAuth) client.setCredentials(youtubeAuth);
  return client;
}

async function getYoutubeChannelFromClient(auth) {
  try {
    const youtube = google.youtube({ version: "v3", auth });
    const response = await youtube.channels.list({ part: ["snippet", "statistics"], mine: true });
    const channel = response.data.items?.[0];
    if (!channel) return null;
    return {
      id: channel.id,
      title: channel.snippet?.title || "Connected YouTube channel",
      handle: channel.snippet?.customUrl || "",
      subscribers: channel.statistics?.subscriberCount || "0",
      videos: channel.statistics?.videoCount || "0",
    };
  } catch (error) {
    return { error: error.message || "YouTube connection could not be verified." };
  }
}

async function getYoutubeChannel() {
  const auth = getYoutubeClient();
  const activeAccount = getActiveYoutubeAccount();
  if (!auth || (!activeAccount && !process.env.YT_REFRESH_TOKEN && !youtubeAuth)) return null;
  return getYoutubeChannelFromClient(auth);
}

async function getYoutubeConnectionOptions() {
  const options = getYoutubeAccountOptions();
  if (!options.length && process.env.YT_REFRESH_TOKEN) {
    const channel = await getYoutubeChannel();
    if (channel && !channel.error) {
      return [{ ...channel, active: true }];
    }
  }
  return options;
}

function parseTags(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return value.split(",").map((tag) => tag.trim()).filter(Boolean);
  }
}

function parseVideoUrls(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function resolveGeneratedPath(videoUrl) {
  if (!videoUrl || typeof videoUrl !== "string") return null;
  const filename = path.basename(videoUrl.split("?")[0]);
  if (!filename || filename === "." || filename === "..") return null;
  const resolved = path.resolve(generatedDir, filename);
  return resolved.startsWith(path.resolve(generatedDir) + path.sep) ? resolved : null;
}

async function hasAudioStream(filePath) {
  try {
    const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", filePath]);
    return Boolean(stdout.trim());
  } catch {
    return true;
  }
}

async function renderVideo(inputPath, outputPath, format, inputHasAudio = true) {
  const videoFilter = format === "facebook"
    ? "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920"
    : "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2";
  const args = ["-y", "-i", inputPath];
  if (!inputHasAudio) args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
  args.push(
    "-map", "0:v:0", "-map", inputHasAudio ? "0:a:0?" : "1:a:0", "-vf", videoFilter,
    "-c:v", "libx264", "-preset", "veryfast", "-threads", ffmpegThreads, "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", "-shortest", outputPath,
  );
  try {
    await execFileAsync("ffmpeg", args);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("FFmpeg and ffprobe are required to render the final video.");
    throw new Error(error.stderr || "FFmpeg could not render the final video.");
  }
  return outputPath;
}

function parseMediaSeconds(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  const match = String(value || "").match(/([0-9]+(?:\.[0-9]+)?)s?$/i);
  return match ? Math.max(0, Number(match[1])) : fallback;
}

async function getMediaDuration(filePath) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath,
    ]);
    const duration = Number(stdout.trim());
    return Number.isFinite(duration) && duration > 0 ? duration : 60;
  } catch {
    return 60;
  }
}

function createMediaCaptionSchema() {
  return {
    type: "object",
    properties: {
      segments: {
        type: "array",
        minItems: 1,
        maxItems: 120,
        items: {
          type: "object",
          properties: {
            start: { type: "number", description: "Start time in seconds." },
            end: { type: "number", description: "End time in seconds." },
            text: { type: "string", description: "Caption text in the target language." },
          },
          required: ["start", "end", "text"],
        },
      },
    },
    required: ["segments"],
  };
}

function mediaLanguageLabel(language) {
  return {
    auto: "the original spoken language",
    en: "English",
    th: "Thai",
    km: "Khmer (ភាសាខ្មែរ)",
    vi: "Vietnamese",
    zh: "Chinese",
    ja: "Japanese",
    ko: "Korean",
    es: "Spanish",
  }[language] || language;
}

function splitCaptionText(text) {
  return String(text || "")
    .split(/(?<=[.!?。！？])\s+|\r?\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function createDemoMediaSegments(transcript, duration) {
  const parts = splitCaptionText(transcript);
  const lines = parts.length
    ? parts
    : ["Demo caption: add a transcript or connect Gemini for automatic captions."];
  const slot = Math.max(2, duration / lines.length);
  return lines.map((text, index) => ({
    start: Number((index * slot).toFixed(2)),
    end: Number(Math.min(duration, (index + 1) * slot).toFixed(2)),
    text: text.slice(0, 240),
  }));
}

function normalizeMediaSegments(value, duration, fallbackText) {
  const raw = Array.isArray(value) ? value : value?.segments;
  const segments = (raw || [])
    .map((segment, index) => {
      const start = Math.min(duration, parseMediaSeconds(segment?.start, index * 4));
      const end = Math.min(duration, Math.max(start + 0.5, parseMediaSeconds(segment?.end, start + 4)));
      return { start: Number(start.toFixed(2)), end: Number(end.toFixed(2)), text: String(segment?.text || "").trim().slice(0, 240) };
    })
    .filter((segment) => segment.text && segment.end > segment.start)
    .slice(0, 120);
  return segments.length ? segments : createDemoMediaSegments(fallbackText, duration);
}

async function waitForGeminiFile(ai, uploaded) {
  if (!uploaded?.name || uploaded.state !== "PROCESSING") return uploaded;
  let file = uploaded;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    file = await ai.files.get({ name: uploaded.name });
    if (file.state === "ACTIVE") return file;
    if (file.state === "FAILED") throw new Error(file.error?.message || "Gemini could not process the uploaded media.");
  }
  throw new Error("Gemini media processing timed out. Try a shorter video.");
}

async function createGeminiMediaSegments({ filePath, mimeType, transcript, sourceLanguage, targetLanguage, duration }) {
  const ai = createGeminiClient();
  const model = process.env.GEMINI_MEDIA_MODEL || process.env.GEMINI_TEXT_MODEL || "gemini-3.8-flash";
  const translationRequest = targetLanguage && targetLanguage !== "auto" && targetLanguage !== sourceLanguage
    ? `Translate every caption into ${mediaLanguageLabel(targetLanguage)}. Keep the meaning natural and concise.`
    : "Keep the captions in the spoken language.";
  let mediaPart = null;
  if (!transcript?.trim()) {
    const uploaded = await waitForGeminiFile(ai, await ai.files.upload({ file: filePath, config: { mimeType } }));
    if (!uploaded?.uri) throw new Error("Gemini did not return a usable media URI.");
    mediaPart = { fileData: { fileUri: uploaded.uri, mimeType: uploaded.mimeType || mimeType } };
  }
  const prompt = [
    "Create subtitle segments for this family-friendly video.",
    `The video duration is about ${duration.toFixed(2)} seconds.`,
    sourceLanguage && sourceLanguage !== "auto" ? `The spoken language is ${mediaLanguageLabel(sourceLanguage)}.` : "Detect the spoken language automatically.",
    translationRequest,
    "Return only JSON matching the schema. Use short captions, avoid overlapping segments, and keep timestamps inside the video duration.",
    transcript?.trim() ? `Transcript supplied by the creator:\n${transcript.slice(0, 20000)}` : "Listen to the uploaded media and transcribe the spoken words.",
  ].join("\n\n");
  const contents = mediaPart ? [{ role: "user", parts: [{ text: prompt }, mediaPart] }] : prompt;
  const response = await ai.models.generateContent({
    model,
    contents,
    config: {
      responseMimeType: "application/json",
      responseSchema: createMediaCaptionSchema(),
      temperature: 0.2,
    },
  });
  let parsed;
  try {
    parsed = JSON.parse(response.text || "{}");
  } catch {
    throw new Error("Gemini returned invalid caption data. Please try again.");
  }
  return normalizeMediaSegments(parsed, duration, transcript);
}

function srtTimestamp(seconds) {
  const milliseconds = Math.max(0, Math.round(Number(seconds || 0) * 1000));
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);
  const remaining = milliseconds % 60000;
  const secs = Math.floor(remaining / 1000);
  const ms = remaining % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

async function writeSrt(segments, filePath) {
  const contents = segments.map((segment, index) => `${index + 1}\n${srtTimestamp(segment.start)} --> ${srtTimestamp(segment.end)}\n${segment.text}\n`).join("\n");
  await fs.writeFile(filePath, contents, "utf8");
}

function escapeSubtitleFilterPath(filePath) {
  return `'${filePath.replaceAll("\\", "/").replaceAll(":", "\\:").replaceAll("'", "\\'")}'`;
}

async function burnSubtitles(inputPath, outputPath, subtitlePath) {
  try {
    await execFileAsync("ffmpeg", [
      "-y", "-i", inputPath, "-vf", `subtitles=${escapeSubtitleFilterPath(subtitlePath)}:force_style='FontName=Arial,FontSize=20,Outline=2,Shadow=1,Alignment=2'`,
      "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outputPath,
    ]);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("FFmpeg is required to burn subtitles into the video.");
    throw new Error(error.stderr || "FFmpeg could not burn the subtitle track.");
  }
  return outputPath;
}

async function createGeminiVoiceover(text, language, voice, outputBasePath) {
  const ai = createGeminiClient();
  const model = process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts";
  const style = language === "km"
    ? "warm, natural Cambodian Khmer narration with clear Khmer pronunciation"
    : "warm, natural family-friendly narration";
  const interaction = await ai.interactions.create({
    model,
    input: [{
      type: "user_input",
      content: [{
        type: "text",
        text: text.slice(0, 30000),
        annotations: [{ type: "speech_metadata", style }],
      }],
    }],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice: voice || process.env.GEMINI_TTS_VOICE || "Kore" }] },
    store: false,
  });
  const audioData = interaction.output_audio?.data || interaction.steps
    ?.filter((step) => step.type === "model_output")
    .flatMap((step) => step.content || [])
    .find((content) => content.type === "audio")?.data;
  if (!audioData) throw new Error("Gemini did not return voice audio. Check the configured TTS model.");
  const filePath = `${outputBasePath}.wav`;
  await fs.writeFile(filePath, Buffer.from(audioData, "base64"));
  return filePath;
}

async function mixVoiceover(inputPath, voicePath, outputPath) {
  const inputHasAudio = await hasAudioStream(inputPath);
  const args = ["-y", "-i", inputPath, "-i", voicePath];
  if (inputHasAudio) {
    args.push(
      "-filter_complex", "[0:a]volume=0.18[original];[1:a]volume=1.0,apad[dub];[original][dub]amix=inputs=2:duration=first:dropout_transition=2[a]",
      "-map", "0:v:0", "-map", "[a]",
    );
  } else {
    args.push("-filter_complex", "[1:a]apad[dub]", "-map", "0:v:0", "-map", "[dub]");
  }
  args.push("-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-shortest", outputPath);
  try {
    await execFileAsync("ffmpeg", args);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("FFmpeg is required to add the generated voice track.");
    throw new Error(error.stderr || "FFmpeg could not add the generated voice track.");
  }
  return outputPath;
}

async function stitchScenes(videoUrls, format = "youtube") {
  const scenePaths = videoUrls.map(resolveGeneratedPath).filter(Boolean);
  if (!scenePaths.length || scenePaths.some((scenePath) => !fsSync.existsSync(scenePath))) throw new Error("Generated video files are no longer available. Generate the scenes again.");
  if (scenePaths.length === 1) {
    const outputPath = path.join(generatedDir, `toypost-${format}-${Date.now()}.mp4`);
    return renderVideo(scenePaths[0], outputPath, format, await hasAudioStream(scenePaths[0]));
  }

  const manifestPath = path.join(generatedDir, `concat-${Date.now()}.txt`);
  const sourcePath = path.join(generatedDir, `concat-source-${Date.now()}.mp4`);
  const outputPath = path.join(generatedDir, `toypost-${format}-${Date.now()}.mp4`);
  const manifest = scenePaths.map((scenePath) => `file '${scenePath.replaceAll("'", "'\\''")}'`).join("\n");
  await fs.writeFile(manifestPath, manifest, "utf8");
  try {
    await execFileAsync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", manifestPath, "-c:v", "libx264", "-preset", "veryfast", "-threads", ffmpegThreads, "-c:a", "aac", "-ar", "48000", "-ac", "2", sourcePath]);
    return await renderVideo(sourcePath, outputPath, format, await hasAudioStream(sourcePath));
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("FFmpeg and ffprobe are required to stitch the generated scenes.");
    throw new Error(error.stderr || "FFmpeg could not stitch the generated scenes.");
  } finally {
    await fs.rm(manifestPath, { force: true });
    await fs.rm(sourcePath, { force: true });
  }
}

async function uploadToYoutube({ filePath, title, description, tags, privacyStatus, madeForKids, containsSyntheticMedia }) {
  const auth = getYoutubeClient();
  if (!auth || (!process.env.YT_REFRESH_TOKEN && !youtubeAuth)) throw new Error("Connect YouTube or set YT_REFRESH_TOKEN in .env first.");
  const youtube = google.youtube({ version: "v3", auth });
  const result = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: { title: title.trim(), description: description || "Fun original toy playset adventures from ToyPost Studio.", tags: parseTags(tags), categoryId: "24" },
      status: { privacyStatus: ["private", "unlisted", "public"].includes(privacyStatus) ? privacyStatus : "private", selfDeclaredMadeForKids: Boolean(madeForKids), containsSyntheticMedia: Boolean(containsSyntheticMedia) },
    },
    media: { body: fsSync.createReadStream(filePath) },
  });
  const item = { id: result.data.id, title, status: privacyStatus, destination: "YouTube", createdAt: new Date().toISOString(), url: `https://studio.youtube.com/video/${result.data.id}/edit` };
  const library = await readLibrary();
  await writeLibrary([item, ...library]);
  return item;
}

async function publishFacebookReel({ filePath, title, description, isAiGenerated = true }) {
  const page = getFacebookPageCredentials();
  if (!page) throw new Error("Connect a Facebook Page or set FB_PAGE_ID and FB_PAGE_ACCESS_TOKEN first.");
  const accessToken = page.accessToken || page.access_token;
  const startUrl = new URL(facebookGraphUrl(`/${page.id}/video_reels`));
  startUrl.searchParams.set("upload_phase", "start");
  startUrl.searchParams.set("access_token", accessToken);
  const start = await facebookJson(startUrl.toString(), { method: "POST" });
  if (!start.video_id || !start.upload_url) throw new Error("Facebook did not return an upload session.");

  const fileSize = (await fs.stat(filePath)).size;
  await facebookJson(start.upload_url, {
    method: "POST",
    headers: { Authorization: `OAuth ${accessToken}`, "Content-Type": "application/octet-stream", offset: "0", file_size: String(fileSize) },
    body: fsSync.createReadStream(filePath),
    duplex: "half",
  });

  const statusUrl = new URL(facebookGraphUrl(`/${start.video_id}`));
  statusUrl.searchParams.set("fields", "status");
  statusUrl.searchParams.set("access_token", accessToken);
  const deadline = Date.now() + 180000;
  let ready = false;
  while (Date.now() < deadline) {
    const status = await facebookJson(statusUrl.toString());
    const videoStatus = status.status?.video_status;
    const processingError = status.status?.processing_phase?.error?.message;
    if (processingError) throw new Error(processingError);
    if (["ready", "upload_complete"].includes(videoStatus)) { ready = true; break; }
    if (["error", "upload_failed", "expired"].includes(videoStatus)) throw new Error(`Facebook video processing failed with status: ${videoStatus}.`);
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  if (!ready) throw new Error("Facebook video processing timed out. Check the Page video status and try again.");

  const finishUrl = new URL(facebookGraphUrl(`/${page.id}/video_reels`));
  finishUrl.searchParams.set("video_id", start.video_id);
  finishUrl.searchParams.set("upload_phase", "finish");
  finishUrl.searchParams.set("video_state", "PUBLISHED");
  finishUrl.searchParams.set("title", title.trim());
  finishUrl.searchParams.set("description", description || title.trim());
  finishUrl.searchParams.set("is_ai_generated", String(Boolean(isAiGenerated)));
  finishUrl.searchParams.set("access_token", accessToken);
  await facebookJson(finishUrl.toString(), { method: "POST" });
  return { id: start.video_id, title, page: page.name || page.id, status: "published" };
}

async function prepareVideo(req, videoUrls, format) {
  if (!videoUrls.length && !req.file?.path) throw new Error("Choose a local video or generate real Gemini scenes before uploading. Demo scenes are preview-only.");
  if (req.file?.path) {
    const outputPath = path.join(generatedDir, `toypost-${format}-${Date.now()}.mp4`);
    return renderVideo(req.file.path, outputPath, format, await hasAudioStream(req.file.path));
  }
  return stitchScenes(videoUrls, format);
}

async function publishTargets({ req, targets }) {
  const { title, description, tags = [], privacyStatus = "private", madeForKids = true, containsSyntheticMedia = true } = req.body || {};
  const videoUrls = parseVideoUrls(req.body?.videoUrls || []);
  if (!title?.trim()) throw new Error("A video title is required.");
  if (!targets.length) throw new Error("Choose at least one publishing destination.");
  if (targets.includes("youtube") && (!getYoutubeClient() || (!process.env.YT_REFRESH_TOKEN && !youtubeAuth))) throw new Error("Connect YouTube or set YT_REFRESH_TOKEN in .env first.");
  if (targets.includes("facebook") && !getFacebookPageCredentials()) throw new Error("Connect a Facebook Page or set FB_PAGE_ID and FB_PAGE_ACCESS_TOKEN first.");

  await fs.mkdir(generatedDir, { recursive: true });
  const tempInput = req.file?.path;
  const results = {};
  try {
    let youtubePath = null;
    let facebookPath = null;
    if (targets.includes("youtube")) youtubePath = await prepareVideo(req, videoUrls, "youtube");
    if (targets.includes("facebook")) {
      facebookPath = youtubePath
        ? await renderVideo(youtubePath, path.join(generatedDir, `toypost-facebook-${Date.now()}.mp4`), "facebook", await hasAudioStream(youtubePath))
        : await prepareVideo(req, videoUrls, "facebook");
    }
    if (youtubePath) results.youtube = await uploadToYoutube({ filePath: youtubePath, title, description, tags, privacyStatus, madeForKids, containsSyntheticMedia });
    if (facebookPath) {
      const facebookResult = await publishFacebookReel({ filePath: facebookPath, title, description, isAiGenerated: containsSyntheticMedia });
      results.facebook = { id: facebookResult.id, title, status: facebookResult.status, destination: "Facebook Page Reel", createdAt: new Date().toISOString() };
      const library = await readLibrary();
      await writeLibrary([results.facebook, ...library]);
    }
    return results;
  } finally {
    if (tempInput) await fs.rm(tempInput, { force: true });
  }
}

app.get("/api/health", async (_req, res) => {
  const youtubeChannel = await getYoutubeChannel();
  const youtubeChannels = await getYoutubeConnectionOptions();
  const facebookPage = await verifyFacebookPage();
  res.json({
    ok: true,
    geminiConfigured: hasGeminiConfig(),
    youtubeConfigured: hasYoutubeConfig(),
    youtubeConnected: Boolean(youtubeChannel && !youtubeChannel.error),
    youtubeChannel: youtubeChannel && !youtubeChannel.error ? youtubeChannel : null,
    youtubeChannels,
    activeYoutubeChannelId: getActiveYoutubeAccount()?.id || youtubeChannel?.id || null,
    youtubeError: youtubeChannel?.error || null,
    facebookConfigured: hasFacebookConfig(),
    facebookConnected: Boolean(facebookPage && !facebookPage.error),
    facebookPage: facebookPage && !facebookPage.error ? facebookPage : null,
    facebookPages: getFacebookPageOptions(),
    activeFacebookPageId: getFacebookPageCredentials()?.id || null,
    facebookError: facebookPage?.error || null,
    aiProviders: aiProviderOptions(),
    demoMode: !hasGeminiConfig(),
  });
});

app.post("/api/connections/youtube/active", async (req, res) => {
  const accountId = String(req.body?.accountId || "");
  const account = youtubeAccounts.find((item) => item.id === accountId);
  if (!account) return res.status(404).json({ error: "That YouTube channel is not connected yet. Use Add / switch to connect it." });
  activeYoutubeAccountId = account.id;
  youtubeAuth = youtubeAccountTokens(account);
  await saveYoutubeAccounts();
  return res.json({ ok: true, activeYoutubeChannelId: account.id, youtubeChannel: getYoutubeAccountOptions().find((item) => item.id === account.id) });
});

app.post("/api/connections/facebook/active", async (req, res) => {
  const pageId = String(req.body?.pageId || "");
  if (process.env.FB_PAGE_ID && process.env.FB_PAGE_ACCESS_TOKEN) {
    return res.status(409).json({ error: "The Facebook Page is fixed by FB_PAGE_ID in the environment." });
  }
  const page = facebookAuth?.pages?.find((item) => item.id === pageId);
  if (!page) return res.status(404).json({ error: "That Facebook Page is not connected yet. Use Add / switch to connect it." });
  facebookAuth = { ...facebookAuth, activePageId: page.id };
  await saveAuth(facebookTokenPath, facebookAuth);
  return res.json({ ok: true, activeFacebookPageId: page.id, facebookPage: { id: page.id, name: page.name } });
});

app.get("/api/presets", (_req, res) => res.json({ defaultPrompt, presets: scenePresets }));
app.get("/api/library", async (_req, res) => res.json({ items: await readLibrary() }));

app.get("/api/auth/youtube", (req, res) => {
  const redirectUri = youtubeRedirectUri(req);
  const client = createOAuthClient(redirectUri);
  if (!client) return res.status(503).send(`YouTube setup required. Add YT_CLIENT_ID and YT_CLIENT_SECRET. Callback: ${redirectUri}`);
  const authUrl = client.generateAuthUrl({ access_type: "offline", prompt: "select_account consent", scope: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"] });
  return res.redirect(authUrl);
});

app.get("/api/auth/youtube/callback", async (req, res) => {
  try {
    if (req.query.error) return res.status(400).send(`YouTube connection cancelled: ${req.query.error_description || req.query.error}`);
    const client = createOAuthClient(youtubeRedirectUri(req));
    if (!client || !req.query.code) return res.status(400).send("YouTube connection failed: Google did not return an authorization code.");
    const { tokens } = await client.getToken(req.query.code);
    client.setCredentials(tokens);
    const channel = await getYoutubeChannelFromClient(client);
    if (channel?.error) throw new Error(channel.error);
    const accountId = channel?.id || crypto.randomUUID();
    const account = {
      id: accountId,
      title: channel?.title || "Connected YouTube channel",
      handle: channel?.handle || "",
      subscribers: channel?.subscribers || "0",
      videos: channel?.videos || "0",
      tokens,
      connectedAt: new Date().toISOString(),
    };
    youtubeAccounts = [account, ...youtubeAccounts.filter((item) => item.id !== accountId)];
    activeYoutubeAccountId = accountId;
    youtubeAuth = tokens;
    await saveYoutubeAccounts();
    res.send("<h1>YouTube connected</h1><p>You can close this tab and return to ToyPost Studio.</p>");
  } catch (error) {
    res.status(400).send(`YouTube connection failed: ${error.message}`);
  }
});

app.get("/api/auth/facebook", (req, res) => {
  const redirectUri = facebookRedirectUri(req);
  if (!process.env.FB_APP_ID || !process.env.FB_APP_SECRET) return res.status(503).send(`Facebook setup required. Add FB_APP_ID and FB_APP_SECRET. Callback: ${redirectUri}`);
  if (!process.env.FB_LOGIN_CONFIG_ID) {
    return res.status(503).send("Facebook setup required. Add FB_LOGIN_CONFIG_ID from Meta > Facebook Login for Business > Configurations.");
  }
  facebookOAuthState = crypto.randomBytes(24).toString("hex");
  const authUrl = new URL(`https://www.facebook.com/${facebookGraphVersion}/dialog/oauth`);
  authUrl.searchParams.set("client_id", process.env.FB_APP_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", facebookOAuthState);
  authUrl.searchParams.set("config_id", process.env.FB_LOGIN_CONFIG_ID);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("override_default_response_type", "true");
  res.redirect(authUrl.toString());
});

app.get("/api/auth/facebook/callback", async (req, res) => {
  try {
    if (req.query.error) return res.status(400).send(`Facebook connection cancelled: ${req.query.error_description || req.query.error}`);
    if (!process.env.FB_APP_ID || !process.env.FB_APP_SECRET || !req.query.code) return res.status(400).send("Facebook connection failed: no authorization code was returned.");
    if (!facebookOAuthState || req.query.state !== facebookOAuthState) return res.status(400).send("Facebook connection failed: the OAuth state expired. Start Connect again.");
    const redirectUri = facebookRedirectUri(req);
    const tokenUrl = new URL(facebookGraphUrl("/oauth/access_token"));
    tokenUrl.searchParams.set("client_id", process.env.FB_APP_ID);
    tokenUrl.searchParams.set("client_secret", process.env.FB_APP_SECRET);
    tokenUrl.searchParams.set("redirect_uri", redirectUri);
    tokenUrl.searchParams.set("code", req.query.code);
    const shortLived = await facebookJson(tokenUrl.toString());
    let userAccessToken = shortLived.access_token;
    const exchangeUrl = new URL(facebookGraphUrl("/oauth/access_token"));
    exchangeUrl.searchParams.set("grant_type", "fb_exchange_token");
    exchangeUrl.searchParams.set("client_id", process.env.FB_APP_ID);
    exchangeUrl.searchParams.set("client_secret", process.env.FB_APP_SECRET);
    exchangeUrl.searchParams.set("fb_exchange_token", userAccessToken);
    try {
      const longLived = await facebookJson(exchangeUrl.toString());
      userAccessToken = longLived.access_token || userAccessToken;
    } catch {
      // App development mode may not permit token exchange; the returned token can still be used.
    }
    const pagesUrl = new URL(facebookGraphUrl("/me/accounts"));
    pagesUrl.searchParams.set("fields", "id,name,access_token,tasks");
    pagesUrl.searchParams.set("access_token", userAccessToken);
    const pagesResponse = await facebookJson(pagesUrl.toString());
    const pages = (pagesResponse.data || []).filter((page) => page.id && page.access_token).map((page) => ({ id: page.id, name: page.name || "Facebook Page", access_token: page.access_token, tasks: page.tasks || [] }));
    if (!pages.length) throw new Error("No Facebook Page with publishing access was returned.");
    facebookAuth = { userAccessToken, pages, activePageId: pages[0].id, connectedAt: new Date().toISOString() };
    await saveAuth(facebookTokenPath, facebookAuth);
    facebookOAuthState = null;
    res.send(`<h1>Facebook Page connected</h1><p>${pages[0].name} is ready for Reel publishing.</p><p>You can close this tab and return to ToyPost Studio.</p>`);
  } catch (error) {
    res.status(400).send(`Facebook connection failed: ${error.message}`);
  }
});

app.post("/api/plan", async (req, res) => {
  try {
    const storyPlan = await planStoryWithProvider(req.body || {});
    return res.json({ storyPlan, warning: storyPlan.warning || null });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Gemini planning failed." });
  }
});

function pruneGenerationJobs() {
  const expiry = Date.now() - 30 * 60 * 1000;
  for (const [jobId, job] of generationJobs) {
    if (["completed", "failed"].includes(job.status) && job.updatedAt < expiry) generationJobs.delete(jobId);
  }
}

function serializeGenerationJob(job) {
  return {
    mode: "gemini",
    jobId: job.id,
    status: job.status,
    storyPlan: job.storyPlan || null,
    warning: job.warning || null,
    scenes: job.scenes || [],
    totalDuration: job.totalDuration || 0,
    sceneCount: job.sceneCount || 0,
    error: job.error || null,
  };
}

async function generateGeminiScenes({ prompt, sceneCount, duration, textProvider, suppliedStoryPlan }) {
  const plan = createGenerationPlan(sceneCount, duration);
  const storyPlan = suppliedStoryPlan?.sourcePrompt === prompt
    ? normalizeStoryPlan(suppliedStoryPlan, plan, prompt)
    : await planStoryWithProvider({ provider: textProvider, prompt, sceneCount, duration });
  const prompts = storyPlan.scenes.map((scene) =>
    `${prompt}\n\nScene direction: ${scene.prompt}\n\n${scene.audio}\n\n${audioDirection}`,
  );
  const scenes = [];
  for (let index = 0; index < prompts.length; index += 1) {
    scenes.push(await generateGeminiClip(prompts[index], index, prompts.length, plan.durations[index]));
  }
  return {
    storyPlan,
    warning: storyPlan.warning || null,
    scenes,
    totalDuration: scenes.reduce((total, scene) => total + scene.duration, 0),
    sceneCount: scenes.length,
  };
}

function startGenerationJob(payload) {
  pruneGenerationJobs();
  const id = crypto.randomUUID();
  const now = Date.now();
  const job = { id, status: "queued", createdAt: now, updatedAt: now, sceneCount: createGenerationPlan(payload.sceneCount, payload.duration).count };
  generationJobs.set(id, job);
  void (async () => {
    job.status = "running";
    job.updatedAt = Date.now();
    try {
      Object.assign(job, await generateGeminiScenes(payload), { status: "completed", updatedAt: Date.now() });
    } catch (error) {
      Object.assign(job, { status: "failed", error: error.message || "Video generation failed.", updatedAt: Date.now() });
    }
  })();
  return job;
}

app.post("/api/generate", async (req, res) => {
  const {
    prompt = defaultPrompt,
    sceneCount = 4,
    duration = 60,
    textProvider = process.env.AI_TEXT_PROVIDER || "gemini",
    videoProvider = process.env.AI_VIDEO_PROVIDER || "gemini",
    storyPlan: suppliedStoryPlan = null,
  } = req.body || {};
  try {
    await fs.mkdir(generatedDir, { recursive: true });
    if (videoProvider === "external-upload") {
      return res.status(400).json({ error: "Choose another AI tool, export its MP4, and use Use an existing video below to continue publishing." });
    }
    if (!hasGeminiConfig()) {
      const scenes = createDemoScenes(sceneCount, duration);
      return res.json({ mode: "demo", message: "Demo scenes ready. Add GEMINI_API_KEY to generate real Gemini clips.", scenes, totalDuration: scenes.reduce((total, scene) => total + scene.duration, 0), sceneCount: scenes.length });
    }
    const job = startGenerationJob({ prompt, sceneCount, duration, textProvider, suppliedStoryPlan });
    return res.status(202).json(serializeGenerationJob(job));
  } catch (error) {
    return res.status(500).json({ error: error.message || "Video generation failed." });
  }
});

app.get("/api/generate/:jobId", (req, res) => {
  pruneGenerationJobs();
  const job = generationJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "That video generation job is no longer available. Start it again." });
  return res.status(job.status === "failed" ? 500 : 200).json(serializeGenerationJob(job));
});

app.post("/api/media/process", mediaUploadMiddleware.single("file"), async (req, res) => {
  const tempInput = req.file?.path;
  const cleanupPaths = [];
  try {
    if (!tempInput) throw new Error("Choose a video file for the AI Media Lab.");
    if (!req.file.mimetype.startsWith("video/") && !/\.(mp4|mov|webm)$/i.test(req.file.originalname)) {
      throw new Error("The AI Media Lab needs a video file so it can return a finished MP4.");
    }
    const includeSubtitles = String(req.body?.includeSubtitles) !== "false";
    const includeDubbing = String(req.body?.includeDubbing) === "true";
    const translate = String(req.body?.translate) !== "false";
    const sourceLanguage = String(req.body?.sourceLanguage || "auto");
    const requestedTargetLanguage = String(req.body?.targetLanguage || sourceLanguage || "auto");
    const targetLanguage = translate ? requestedTargetLanguage : sourceLanguage;
    const transcript = String(req.body?.transcript || "").trim();
    const voice = String(req.body?.voice || "Kore");
    const duration = await getMediaDuration(tempInput);
    const usingGemini = hasGeminiConfig();
    await fs.mkdir(generatedDir, { recursive: true });
    const segments = usingGemini
      ? await createGeminiMediaSegments({ filePath: tempInput, mimeType: req.file.mimetype || "video/mp4", transcript, sourceLanguage, targetLanguage, duration })
      : normalizeMediaSegments(null, duration, transcript);
    const warnings = [];
    if (!usingGemini) {
      warnings.push("Demo mode created a timed caption preview. Add GEMINI_API_KEY for automatic transcription, translation, and realistic voice.");
    }

    let subtitlePath = null;
    if (includeSubtitles) {
      subtitlePath = path.join(generatedDir, `toypost-captions-${Date.now()}.srt`);
      await writeSrt(segments, subtitlePath);
    }

    let currentPath = tempInput;
    let voiceGenerated = false;
    if (includeDubbing && usingGemini) {
      const voicePath = await createGeminiVoiceover(
        segments.map((segment) => segment.text).join(" "),
        targetLanguage,
        voice,
        path.join(generatedDir, `toypost-voice-${Date.now()}`),
      );
      cleanupPaths.push(voicePath);
      const mixedPath = path.join(generatedDir, `toypost-mixed-${Date.now()}.mp4`);
      await mixVoiceover(currentPath, voicePath, mixedPath);
      cleanupPaths.push(mixedPath);
      currentPath = mixedPath;
      voiceGenerated = true;
    } else if (includeDubbing) {
      warnings.push("The original audio was kept because realistic voice needs a configured Gemini API key.");
    }

    const outputPath = path.join(generatedDir, `toypost-media-${Date.now()}.mp4`);
    if (subtitlePath) {
      try {
        await burnSubtitles(currentPath, outputPath, subtitlePath);
      } catch (error) {
        warnings.push(`Subtitle burn-in was skipped: ${error.message}`);
        await fs.copyFile(currentPath, outputPath);
      }
    } else {
      await fs.copyFile(currentPath, outputPath);
    }

    return res.json({
      mode: usingGemini ? "gemini" : "demo",
      videoUrl: `/generated/${path.basename(outputPath)}`,
      subtitleUrl: subtitlePath ? `/generated/${path.basename(subtitlePath)}` : null,
      captions: segments.length,
      language: targetLanguage,
      voice: voiceGenerated ? "Gemini realistic voice" : "Original audio",
      warnings,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Media processing failed." });
  } finally {
    if (tempInput) await fs.rm(tempInput, { force: true });
    await Promise.all(cleanupPaths.map((filePath) => fs.rm(filePath, { force: true })));
  }
});

app.post("/api/publish", uploadMiddleware.single("file"), async (req, res) => {
  const targets = (() => {
    try {
      const value = JSON.parse(req.body?.targets || "[\"youtube\"]");
      return Array.isArray(value) ? value.filter((target) => ["youtube", "facebook"].includes(target)) : ["youtube"];
    } catch {
      return ["youtube"];
    }
  })();
  try {
    const results = await publishTargets({ req, targets });
    return res.json({ results, items: Object.values(results) });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Publishing failed." });
  }
});

app.post("/api/upload", uploadMiddleware.single("file"), async (req, res) => {
  try {
    const item = (await publishTargets({ req, targets: ["youtube"] })).youtube;
    return res.json({ item });
  } catch (error) {
    return res.status(500).json({ error: error.message || "YouTube upload failed." });
  }
});

app.post("/api/upload/facebook", uploadMiddleware.single("file"), async (req, res) => {
  try {
    const item = (await publishTargets({ req, targets: ["facebook"] })).facebook;
    return res.json({ item });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Facebook Reel upload failed." });
  }
});

if (process.env.NODE_ENV === "production" || fsSync.existsSync(path.join(rootDir, "dist", "index.html"))) {
  app.use(express.static(path.join(rootDir, "dist")));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(rootDir, "dist", "index.html")));
}

const savedYoutubeAuth = await loadAuth(youtubeTokenPath);
if (Array.isArray(savedYoutubeAuth?.accounts)) {
  youtubeAccounts = savedYoutubeAuth.accounts;
  activeYoutubeAccountId = savedYoutubeAuth.activeId || youtubeAccounts[0]?.id || null;
  youtubeAuth = youtubeAccountTokens(getActiveYoutubeAccount());
} else if (savedYoutubeAuth?.access_token || savedYoutubeAuth?.refresh_token) {
  youtubeAuth = savedYoutubeAuth;
}
facebookAuth = await loadAuth(facebookTokenPath);

app.listen(port, () => console.log(`ToyPost API listening on http://localhost:${port}`));
