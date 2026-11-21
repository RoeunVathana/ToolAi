import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CalendarClock, Check, CirclePlay, Clock3, LockKeyhole, Send, ShieldCheck, Upload, X } from "lucide-react";
import "./auto-publisher.css";

async function request(path, options = {}, token) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw || "The server returned an invalid response." }; }
  if (!response.ok) { const error = new Error(data.error || `Request failed (${response.status}).`); error.code = data.code; throw error; }
  return data;
}

function jobLabel(status) { return String(status || "DRAFT").replaceAll("_", " "); }
function jobClass(status) {
  if (["APPROVED", "SCHEDULED", "PUBLISHED"].includes(status)) return "success";
  if (["UPLOADING", "PENDING_APPROVAL"].includes(status)) return "working";
  if (["FAILED", "CANCELLED"].includes(status)) return "danger";
  return "";
}

function ProviderState({ provider, onChange, busy }) {
  if (!provider) return <span className="publisher-provider unknown">Loading provider status…</span>;
  const label = provider.canPublish ? "Connected" : provider.connected ? "Needs verification" : "Not configured";
  const action = provider.canPublish ? "Add / switch" : "Connect";
  const href = provider.label === "YouTube" ? "/api/auth/youtube" : "/api/auth/facebook";
  const isYoutube = provider.label === "YouTube";
  const options = isYoutube ? (provider.channels || []) : (provider.pages || []);
  const activeId = isYoutube ? provider.activeChannelId : provider.activePageId;
  return <div className="publisher-provider-wrap">
    <div className="publisher-provider-line"><span className={`publisher-provider ${provider.canPublish ? "ready" : "blocked"}`}><i />{label}</span><a className="publisher-connect" href={href}>{action}</a></div>
    {options.length > 0 && <label className="publisher-provider-selector"><span>{isYoutube ? "Publishing channel" : "Publishing Page"}</span><select value={activeId || ""} onChange={(event) => onChange(event.target.value)} disabled={busy || options.length < 2}>{options.map((option) => <option key={option.id} value={option.id}>{isYoutube ? option.title : option.name}{option.handle ? ` · ${option.handle}` : ""}</option>)}</select></label>}
    {options.length > 1 && <span className="publisher-provider-hint">Change the destination used for new publications.</span>}
    {options.length === 1 && <span className="publisher-provider-hint">Only one {isYoutube ? "channel" : "Page"} is connected. Use Add / switch to connect another.</span>}
  </div>;
}

export default function AutoPublisher({ onBack }) {
  const token = localStorage.getItem("toolaime-token") || "";
  const [projects, setProjects] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({ projectId: "", platform: "YOUTUBE", title: "", description: "", tags: "", privacyStatus: "private", scheduledAt: "", rightsVerified: false });
  const [busy, setBusy] = useState(false);
  const [busyJob, setBusyJob] = useState("");
  const [demoBusy, setDemoBusy] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const completedProjects = useMemo(() => projects.filter((project) => project.renderJobs?.some((render) => render.status === "COMPLETED")), [projects]);
  const provider = form.platform === "YOUTUBE" ? config?.youtube : config?.facebook;

  async function load() {
    setError("");
    const results = await Promise.allSettled([request("/api/v1/projects", {}, token), request("/api/v1/publishing/config", {}, token), request("/api/v1/publishing/jobs", {}, token)]);
    const [projectResult, configResult, jobsResult] = results;
    if (projectResult.status === "fulfilled") setProjects(projectResult.value.projects || []);
    if (configResult.status === "fulfilled") setConfig(configResult.value.config || null);
    if (jobsResult.status === "fulfilled") setJobs(jobsResult.value.jobs || []);
    const failed = results.find((result) => result.status === "rejected");
    if (failed && results.every((result) => result.status === "rejected")) setError(failed.reason?.message || "Publishing center could not load.");
  }
  useEffect(() => { load(); }, []);
  function setField(name, value) { setForm((current) => ({ ...current, [name]: value })); }

  async function changeConnection(platform, id) {
    if (!id) return;
    setConnectionBusy(platform); setError(""); setNotice("");
    try {
      const path = platform === "YOUTUBE" ? "/api/connections/youtube/active" : "/api/connections/facebook/active";
      const body = platform === "YOUTUBE" ? { accountId: id } : { pageId: id };
      await request(path, { method: "POST", body: JSON.stringify(body) }, token);
      const data = await request("/api/v1/publishing/config", {}, token);
      setConfig(data.config || null);
      setNotice(platform === "YOUTUBE" ? "YouTube publishing channel changed." : "Facebook publishing Page changed.");
    } catch (switchError) { setError(switchError.message); } finally { setConnectionBusy(""); }
  }

  async function createDemoProject() {
    setDemoBusy(true); setError(""); setNotice("");
    try {
      const data = await request("/api/v1/publishing/demo-project", { method: "POST" }, token);
      setProjects((current) => [data.project, ...current.filter((item) => item.id !== data.project.id)]);
      setForm((current) => ({ ...current, projectId: data.project.id, title: "ToolAiMe free demo test", description: "A free demo video used to test the ToolAiMe publishing workflow.", tags: "toolaime, demo, test", privacyStatus: "public" }));
      setNotice("Free demo MP4 is ready. Review the details, confirm your rights, and add it to the approval queue.");
    } catch (demoError) { setError(demoError.message); } finally { setDemoBusy(false); }
  }

  async function createDraft(event) {
    event.preventDefault(); setError(""); setNotice("");
    if (!form.projectId) return setError("Choose a completed rendered project first.");
    if (!form.title.trim()) return setError("Add a title for this publication.");
    if (!form.rightsVerified) return setError("Confirm that you have permission to publish this video.");
    setBusy(true);
    try {
      const data = await request("/api/v1/publishing/jobs", { method: "POST", body: JSON.stringify({ ...form, title: form.title.trim(), scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null, timezone: config?.timezone || "Asia/Phnom_Penh" }) }, token);
      setJobs((current) => [data.job, ...current]); setNotice("Publication draft queued for approval.");
      setForm((current) => ({ ...current, title: "", description: "", tags: "", scheduledAt: "", rightsVerified: false }));
    } catch (createError) { setError(createError.message); } finally { setBusy(false); }
  }

  async function updateJob(id, action) {
    setBusyJob(id); setError(""); setNotice("");
    try {
      const data = await request(`/api/v1/publishing/jobs/${id}/${action}`, { method: "POST" }, token);
      setJobs((current) => current.map((item) => item.id === id ? data.job : item));
      setNotice(action === "approve" ? "Publication approved and ready for the configured provider." : action === "cancel" ? "Publication draft cancelled." : "Publication completed.");
    } catch (jobError) { setError(jobError.message); } finally { setBusyJob(""); }
  }

  return <section className="publisher-shell">
    <div className="publisher-top"><button className="text-button" onClick={onBack}><ArrowLeft size={15} /> Back to overview</button><span className="phase-pill"><CirclePlay size={14} /> Publishing center · Live</span></div>
    <div className="page-intro compact publisher-intro"><div><span className="eyebrow">AUTO PUBLISHER</span><h1>Approve before it goes live.</h1><p>Queue a finished MP4, verify your rights, prepare platform metadata, and keep publication under your control.</p></div><div className="publisher-safety"><ShieldCheck size={17} /> Approval required</div></div>
    {error && <div className="alert error"><X size={16} />{error}<button onClick={() => setError("")}><X size={15} /></button></div>}
    {notice && <div className="alert success"><Check size={16} />{notice}<button onClick={() => setNotice("")}><X size={15} /></button></div>}
    <div className="publisher-platforms"><div className="publisher-platform card"><div className="publisher-platform-icon youtube">▶</div><div><strong>YouTube</strong><span>Official channel upload</span></div><ProviderState provider={config?.youtube} onChange={(id) => changeConnection("YOUTUBE", id)} busy={connectionBusy === "YOUTUBE"} /></div><div className="publisher-platform card"><div className="publisher-platform-icon facebook">f</div><div><strong>Facebook Page</strong><span>Page video or Reel</span></div><ProviderState provider={config?.facebook} onChange={(id) => changeConnection("FACEBOOK", id)} busy={connectionBusy === "FACEBOOK"} /></div></div>
    <div className="publisher-grid">
      <form className="card publisher-card" onSubmit={createDraft}>
        <div className="publisher-card-heading"><div><span className="eyebrow">1 · CREATE DRAFT</span><h2>Prepare a publication</h2></div><LockKeyhole size={19} /></div>
        <label className="field"><span>Rendered project</span><select value={form.projectId} onChange={(event) => setField("projectId", event.target.value)}><option value="">Choose a completed MP4</option>{completedProjects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>
        {!completedProjects.length && <div className="publisher-empty"><AlertTriangle size={16} /><span>Render a project first. Only completed MP4 files can enter the publishing queue.</span><button className="button secondary" type="button" onClick={createDemoProject} disabled={demoBusy}>{demoBusy ? <span className="spinner" /> : "Create free demo MP4"}</button></div>}
        <div className="publisher-form-grid"><label className="field"><span>Platform</span><select value={form.platform} onChange={(event) => setField("platform", event.target.value)}><option value="YOUTUBE">YouTube</option><option value="FACEBOOK">Facebook Page</option></select></label><label className="field"><span>Privacy</span><select value={form.privacyStatus} onChange={(event) => setField("privacyStatus", event.target.value)}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></label></div>
        <label className="field"><span>Title</span><input value={form.title} maxLength={100} onChange={(event) => setField("title", event.target.value)} placeholder="Publication title" /></label>
        <label className="field"><span>Description</span><textarea value={form.description} maxLength={5000} onChange={(event) => setField("description", event.target.value)} placeholder="Add a clear description…" /></label>
        <label className="field"><span>Tags</span><input value={form.tags} maxLength={500} onChange={(event) => setField("tags", event.target.value)} placeholder="khmer, story recap, ..." /></label>
        <label className="field"><span><span><CalendarClock size={14} /> Schedule (optional)</span><em>{config?.timezone || "Asia/Phnom_Penh"}</em></span><input type="datetime-local" value={form.scheduledAt} onChange={(event) => setField("scheduledAt", event.target.value)} /></label>
        <label className="checkbox-field rights-check"><input type="checkbox" checked={form.rightsVerified} onChange={(event) => setField("rightsVerified", event.target.checked)} /><span>I have permission to publish the video and its source media.</span></label>
        <div className="publisher-provider-note"><span className={provider?.canPublish ? "status-dot" : "status-dot muted-dot"} />{provider?.message || "Checking provider configuration…"}</div>
        <button className="button primary" type="submit" disabled={busy || !completedProjects.length}>{busy ? <span className="spinner" /> : <><Upload size={16} /> Add to approval queue</>}</button>
      </form>
      <section className="card publisher-card publisher-queue">
        <div className="publisher-card-heading"><div><span className="eyebrow">2 · QUEUE</span><h2>Publication drafts</h2></div><span className="section-meta">{jobs.length} saved</span></div>
        {!jobs.length ? <div className="publisher-empty large"><Clock3 size={21} /><strong>No publication drafts yet</strong><span>Your approved workflow will appear here.</span></div> : <div className="publish-job-list">{jobs.map((job) => <article className="publish-job" key={job.id}><div className="publish-job-main"><div className="publish-job-title"><strong>{job.title}</strong><span>{job.platform === "YOUTUBE" ? "YouTube" : "Facebook Page"} · {job.project?.title || "Project"}</span></div><span className={`status-badge ${jobClass(job.status)}`}><i />{jobLabel(job.status)}</span></div><div className="publish-job-meta"><span>{job.privacyStatus} · {job.scheduledAt ? `Scheduled ${new Date(job.scheduledAt).toLocaleString()}` : "Publish when approved"}</span><span>{new Date(job.updatedAt).toLocaleString()}</span></div><div className="publish-job-actions">{job.status === "PENDING_APPROVAL" && <button className="button primary" onClick={() => updateJob(job.id, "approve")} disabled={busyJob === job.id}>{busyJob === job.id ? <span className="spinner" /> : <><Check size={15} /> Approve</>}</button>}{["PENDING_APPROVAL", "APPROVED", "SCHEDULED"].includes(job.status) && <button className="button ghost" onClick={() => updateJob(job.id, "cancel")} disabled={busyJob === job.id}><X size={15} /> Cancel</button>}{["APPROVED", "SCHEDULED"].includes(job.status) && <button className="button secondary" onClick={() => updateJob(job.id, "publish")} disabled={busyJob === job.id}><Send size={15} /> Publish now</button>}</div></article>)}</div>}
      </section>
    </div>
    <div className="publisher-footnote"><ShieldCheck size={15} /><span>Auto Publisher never marks a video as published without provider confirmation. YouTube and Facebook remain unavailable until their official credentials and authorization are configured.</span></div>
  </section>;
}
