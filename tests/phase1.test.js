import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const execFileAsync = promisify(execFile);
const baseUrl = process.env.TEST_BASE_URL || "http://localhost:8787";

async function request(pathname, options = {}, token) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  return { response, data };
}

test("Phase 1 auth, ownership, media upload, render, preview, and download", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const ownerEmail = `phase1-owner-${suffix}@example.com`;
  const otherEmail = `phase1-other-${suffix}@example.com`;
  const ownerRegistration = await request("/api/v1/auth/register", { method: "POST", body: JSON.stringify({ name: "Phase One Owner", email: ownerEmail, password: "PhaseOne123!" }) });
  assert.equal(ownerRegistration.response.status, 201);
  assert.ok(ownerRegistration.data.accessToken);
  const ownerToken = ownerRegistration.data.accessToken;
  const me = await request("/api/v1/auth/me", {}, ownerToken);
  assert.equal(me.response.status, 200);
  assert.equal(me.data.user.email, ownerEmail);
  const voiceCatalog = await request("/api/v1/voice/catalog", {}, ownerToken);
  assert.equal(voiceCatalog.response.status, 200);
  assert.equal(voiceCatalog.data.language, "km");
  assert.ok(voiceCatalog.data.voices.some((voice) => voice.id === "Kore"));
  const voiceTimelines = await request("/api/v1/voice/timelines", {}, ownerToken);
  assert.equal(voiceTimelines.response.status, 200);
  const publishingConfig = await request("/api/v1/publishing/config", {}, ownerToken);
  assert.equal(publishingConfig.response.status, 200);
  assert.equal(publishingConfig.data.config.timezone, "Asia/Phnom_Penh");
  const publishingJobs = await request("/api/v1/publishing/jobs", {}, ownerToken);
  assert.equal(publishingJobs.response.status, 200);
  assert.deepEqual(publishingJobs.data.jobs, []);
  const missingTimelineVideo = new FormData();
  missingTimelineVideo.append("srt", "1\n00:00:00,000 --> 00:00:01,000\nសំឡេងសាកល្បង");
  const timelineValidation = await request("/api/v1/voice/timelines", { method: "POST", body: missingTimelineVideo }, ownerToken);
  assert.equal(timelineValidation.response.status, 400);

  const login = await request("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email: ownerEmail, password: "PhaseOne123!" }) });
  assert.equal(login.response.status, 200);
  assert.ok(login.data.accessToken);

  const created = await request("/api/v1/projects", { method: "POST", body: JSON.stringify({ title: "សេចក្តីសប្បុរសក្នុងភូមិ", topic: "ក្មេងប្រុសម្នាក់ជួយអ្នកជិតខាងក្នុងភូមិ", language: "km", durationMinutes: 1, script: "ស្គ្រីបសាកល្បងសម្រាប់ការរៀបចំវីដេអូ។" }) }, ownerToken);
  assert.equal(created.response.status, 201);
  const projectId = created.data.project.id;

  const otherRegistration = await request("/api/v1/auth/register", { method: "POST", body: JSON.stringify({ name: "Other User", email: otherEmail, password: "OtherUser123!" }) });
  assert.equal(otherRegistration.response.status, 201);
  const forbidden = await request(`/api/v1/projects/${projectId}`, {}, otherRegistration.data.accessToken);
  assert.equal(forbidden.response.status, 404);

  const gemini = await request("/api/v1/gemini/generate-script", { method: "POST", body: JSON.stringify({ projectId, topic: "សេចក្តីសប្បុរសក្នុងភូមិ", language: "km", durationMinutes: 1 }) }, ownerToken);
  if (process.env.EXPECT_LIVE_GEMINI === "1") {
    assert.equal(gemini.response.status, 200);
    assert.equal(gemini.data.provider, "gemini");
    assert.ok(gemini.data.script);
  } else {
    assert.equal(gemini.response.status, 503);
    assert.equal(gemini.data.code, "GEMINI_NOT_CONFIGURED");
  }

  const missingVoiceInputs = new FormData();
  missingVoiceInputs.append("script", "ស្គ្រីបសម្រាប់សម្លេងសាកល្បង");
  missingVoiceInputs.append("consent", "true");
  const missingVoice = await request(`/api/v1/projects/${projectId}/voice/generate`, { method: "POST", body: missingVoiceInputs }, ownerToken);
  assert.equal(missingVoice.response.status, 400);
  assert.match(missingVoice.data.error, /clean voice sample and a consent recording/i);

  const mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), "toolaime-phase1-"));
  const imagePath = path.join(mediaDir, "sample.png");
  const audioPath = path.join(mediaDir, "sample.wav");
  const videoPath = path.join(mediaDir, "sample.mp4");
  await execFileAsync(ffmpegStatic, ["-y", "-f", "lavfi", "-i", "color=c=0x91a8e6:s=640x360", "-frames:v", "1", imagePath]);
  await execFileAsync(ffmpegStatic, ["-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "2", audioPath]);
  await execFileAsync(ffmpegStatic, ["-y", "-f", "lavfi", "-i", "color=c=0x91a8e6:s=640x360", "-t", "1", "-r", "10", "-pix_fmt", "yuv420p", videoPath]);
  const imageForm = new FormData(); imageForm.append("file", new Blob([await fs.readFile(imagePath)], { type: "image/png" }), "sample.png");
  const imageUpload = await request(`/api/v1/projects/${projectId}/media`, { method: "POST", body: imageForm }, ownerToken);
  assert.equal(imageUpload.response.status, 201);
  const audioForm = new FormData(); audioForm.append("file", new Blob([await fs.readFile(audioPath)], { type: "audio/wav" }), "sample.wav");
  const audioUpload = await request(`/api/v1/projects/${projectId}/media`, { method: "POST", body: audioForm }, ownerToken);
  assert.equal(audioUpload.response.status, 201);
  assert.equal(audioUpload.data.asset.type, "AUDIO");
  const videoForm = new FormData(); videoForm.append("file", new Blob([await fs.readFile(videoPath)], { type: "video/mp4" }), "sample.mp4");
  const videoUpload = await request(`/api/v1/projects/${projectId}/media`, { method: "POST", body: videoForm }, ownerToken);
  assert.equal(videoUpload.response.status, 201);
  assert.equal(videoUpload.data.asset.type, "VIDEO");
  const videoPreview = await fetch(`${baseUrl}${videoUpload.data.asset.previewUrl}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  assert.equal(videoPreview.status, 200);
  assert.match(videoPreview.headers.get("content-type") || "", /video\/mp4/);
  const invalidForm = new FormData(); invalidForm.append("file", new Blob(["not media"], { type: "text/plain" }), "bad.txt");
  const invalidUpload = await request(`/api/v1/projects/${projectId}/media`, { method: "POST", body: invalidForm }, ownerToken);
  assert.equal(invalidUpload.response.status, 400);

  const render = await request(`/api/v1/projects/${projectId}/render`, { method: "POST", body: JSON.stringify({ aspectRatio: "16:9", resolution: "1280x720" }) }, ownerToken);
  assert.equal(render.response.status, 202);
  let job = render.data.job;
  for (let attempt = 0; attempt < 60 && !["COMPLETED", "FAILED"].includes(job.status); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    job = (await request(`/api/v1/render-jobs/${job.id}`, {}, ownerToken)).data.job;
  }
  assert.equal(job.status, "COMPLETED", job.errorMessage || "The render job did not complete.");
  assert.equal(job.progress, 100);
  const completedProject = await request(`/api/v1/projects/${projectId}`, {}, ownerToken);
  assert.equal(completedProject.data.project.status, "COMPLETED");
  const publishDraft = await request("/api/v1/publishing/jobs", { method: "POST", body: JSON.stringify({ projectId, platform: "YOUTUBE", title: "Phase 1 test publication", description: "Approval workflow test", tags: "khmer,test", privacyStatus: "private", scheduledAt: null, timezone: "Asia/Phnom_Penh", rightsVerified: true }) }, ownerToken);
  assert.equal(publishDraft.response.status, 201);
  assert.equal(publishDraft.data.job.status, "PENDING_APPROVAL");
  const approvedPublish = await request(`/api/v1/publishing/jobs/${publishDraft.data.job.id}/approve`, { method: "POST" }, ownerToken);
  assert.equal(approvedPublish.response.status, 200);
  assert.equal(approvedPublish.data.job.status, "APPROVED");
  const publishAttempt = await request(`/api/v1/publishing/jobs/${publishDraft.data.job.id}/publish`, { method: "POST" }, ownerToken);
  assert.ok([409, 501].includes(publishAttempt.response.status));
  assert.ok(["PUBLISHING_NOT_CONFIGURED", "PUBLISHING_ADAPTER_NOT_VERIFIED"].includes(publishAttempt.data.code));
  const cancelledPublish = await request(`/api/v1/publishing/jobs/${publishDraft.data.job.id}/cancel`, { method: "POST" }, ownerToken);
  assert.equal(cancelledPublish.response.status, 200);
  assert.equal(cancelledPublish.data.job.status, "CANCELLED");
  const previewResponse = await fetch(`${baseUrl}/api/v1/render-jobs/${job.id}/download?inline=1`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  assert.equal(previewResponse.status, 200);
  assert.match(previewResponse.headers.get("content-type") || "", /video\/mp4/);
  const outputPath = path.join(mediaDir, "result.mp4");
  await fs.writeFile(outputPath, Buffer.from(await previewResponse.arrayBuffer()));
  const probe = await execFileAsync(ffprobeStatic.path, ["-v", "error", "-show_entries", "format=format_name,duration", "-of", "json", outputPath]);
  assert.match(probe.stdout, /mp4/);
  assert.ok(Number(JSON.parse(probe.stdout).format.duration) > 0);
  const download = await request(`/api/v1/render-jobs/${job.id}/download`, {}, ownerToken);
  assert.equal(download.response.status, 200);
  const deleted = await request(`/api/v1/projects/${projectId}`, { method: "DELETE" }, ownerToken);
  assert.equal(deleted.response.status, 204);
  await fs.rm(mediaDir, { recursive: true, force: true });
});
