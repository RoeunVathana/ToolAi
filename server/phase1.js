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

function phase1Paths(rootDir) {
  const storageRoot = path.resolve(process.env.STORAGE_PATH || path.join(rootDir, "storage"), "phase1");
  const incomingRoot = path.join(rootDir, "server", "incoming", "phase1");
  return { storageRoot, incomingRoot };
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
  const response = await ai.models.generateContent({ model, contents: prompt });
  const script = pickScriptText(response);
  if (!script) throw new Error("Gemini returned an empty script.");
  return { script, provider: "gemini", model };
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

async function renderProject({ jobId, project, images, audio, outputPath, ffmpegCommand, ffprobeCommand }) {
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
    await execFileAsync(ffmpegCommand, [
      "-y", "-f", "concat", "-safe", "0", "-i", manifestPath,
      "-i", audio.storagePath,
      "-vf", filter,
      "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
      "-map", "0:v:0", "-map", "1:a:0", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
      "-t", String(duration), "-movflags", "+faststart", outputPath,
    ], { maxBuffer: 1024 * 1024 * 4 });
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

export function registerPhase1Routes(app, { rootDir, ffmpegCommand, ffprobeCommand }) {
  const { storageRoot, incomingRoot } = phase1Paths(rootDir);
  fsSync.mkdirSync(storageRoot, { recursive: true });
  fsSync.mkdirSync(incomingRoot, { recursive: true });
  const upload = multer({
    dest: incomingRoot,
    limits: { fileSize: 80 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
      const extension = safeExtension(file.originalname);
      const isImage = file.mimetype.startsWith("image/") && allowedImageExtensions.has(extension);
      const isAudio = file.mimetype.startsWith("audio/") && allowedAudioExtensions.has(extension);
      callback(isImage || isAudio ? null : new Error("Only JPG, PNG, WebP, MP3, and WAV files are supported."), isImage || isAudio);
    },
  });

  async function ownedProject(projectId, userId, includeMedia = false) {
    return prisma.videoProject.findFirst({
      where: { id: projectId, userId },
      include: includeMedia ? { mediaAssets: { orderBy: [{ type: "asc" }, { displayOrder: "asc" }, { createdAt: "asc" }] }, renderJobs: { orderBy: { createdAt: "desc" }, take: 5 } } : undefined,
    });
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
      const status = error?.status || (error?.name === "ZodError" ? 400 : 502);
      return res.status(status).json({ error: error?.name === "ZodError" ? error.issues[0]?.message : error.message || "Gemini script generation failed.", code: error?.code || "GEMINI_ERROR" });
    }
  });

  app.post("/api/v1/projects/:id/media", requireAuth, upload.single("file"), async (req, res) => {
    const tempPath = req.file?.path;
    try {
      const project = await ownedProject(req.params.id, req.userId);
      if (!project) return res.status(404).json({ error: "Project not found." });
      if (!req.file) return res.status(400).json({ error: "Choose an image or narration file." });
      const extension = safeExtension(req.file.originalname);
      const type = allowedAudioExtensions.has(extension) ? "AUDIO" : "IMAGE";
      const projectDir = path.join(storageRoot, project.id);
      await fs.mkdir(projectDir, { recursive: true });
      const storedName = `${crypto.randomUUID()}${extension}`;
      const storagePath = ensureContained(storageRoot, path.join(projectDir, storedName));
      // Railway's multer temp directory can be on the container filesystem
      // while STORAGE_PATH is a mounted volume. Copy across filesystems,
      // then remove the temporary upload instead of relying on rename().
      await fs.copyFile(tempPath, storagePath);
      await fs.rm(tempPath, { force: true });
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
      if (!images.length) return res.status(400).json({ error: "Upload at least one image before rendering." });
      if (!audio) return res.status(400).json({ error: "Upload one narration MP3 or WAV before rendering." });
      for (const asset of [...images, audio]) {
        if (!fsSync.existsSync(ensureContained(storageRoot, asset.storagePath))) return res.status(400).json({ error: `Missing media file: ${asset.filename}` });
      }
      const updatedProject = await prisma.videoProject.update({ where: { id: project.id }, data: { aspectRatio: input.aspectRatio, resolution: input.resolution, status: "RENDERING" } });
      const job = await prisma.renderJob.create({ data: { projectId: project.id, status: "QUEUED", progress: 0 } });
      const renderDir = path.join(storageRoot, project.id, "renders");
      await fs.mkdir(renderDir, { recursive: true });
      const outputPath = ensureContained(storageRoot, path.join(renderDir, `${job.id}.mp4`));
      void renderProject({ jobId: job.id, project: updatedProject, images, audio, outputPath, ffmpegCommand, ffprobeCommand });
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
