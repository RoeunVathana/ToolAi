import React, { useEffect, useState } from "react";
import { ArrowLeft, Check, Download, FileText, Film, Languages, Mic2, Upload, WandSparkles, X } from "lucide-react";
import "./chinese-story-recap.css";

async function request(path, options = {}, token) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw || "The server returned an invalid response." }; }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function Spinner() { return <span className="spinner" aria-label="Loading" />; }

export default function ChineseStoryRecap({ onBack }) {
  const token = localStorage.getItem("toolaime-token") || "";
  const [catalog, setCatalog] = useState(null);
  const [projects, setProjects] = useState([]);
  const [title, setTitle] = useState("Chinese story recap");
  const [targetLanguage, setTargetLanguage] = useState("km");
  const [voice, setVoice] = useState("Kore");
  const [projectId, setProjectId] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [recap, setRecap] = useState("");
  const [videoFile, setVideoFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [timeline, setTimeline] = useState(null);

  useEffect(() => {
    Promise.allSettled([request("/api/v1/voice/catalog", {}, token), request("/api/v1/projects", {}, token)]).then(([catalogResult, projectResult]) => {
      if (catalogResult.status === "fulfilled") setCatalog(catalogResult.value);
      if (projectResult.status === "fulfilled") setProjects(projectResult.value.projects || []);
    });
  }, []);

  async function generateRecap(event) {
    event.preventDefault(); setError(""); setNotice(""); setTimeline(null);
    if (!sourceText.trim()) { setError("Paste Chinese subtitles or story text first."); return; }
    setBusy(true);
    try {
      const data = await request("/api/v1/recap/chinese", { method: "POST", body: JSON.stringify({ title, text: sourceText, targetLanguage }) }, token);
      setRecap(data.recap || "");
      setNotice("Chinese story recap is ready. Review it before generating narration.");
    } catch (recapError) { setError(recapError.message); } finally { setBusy(false); }
  }

  async function exportRecap() {
    setError(""); setNotice("");
    if (!videoFile) { setError("Choose the authorized Chinese MP4 before creating the recap video."); return; }
    if (!recap.trim()) { setError("Generate or write the recap before creating the video."); return; }
    setExportBusy(true);
    try {
      const form = new FormData();
      form.append("video", videoFile);
      form.append("title", title);
      form.append("voice", voice);
      form.append("script", recap);
      if (projectId) form.append("projectId", projectId);
      const data = await request("/api/v1/voice/timelines", { method: "POST", body: form }, token);
      setTimeline(data.timeline);
      setNotice("Recap MP4 generated. Preview it before publishing.");
    } catch (exportError) { setError(exportError.message); } finally { setExportBusy(false); }
  }

  function mediaUrl(url) { return url ? `${url}?token=${encodeURIComponent(token)}` : ""; }
  const voices = catalog?.voices || [{ id: "Kore", label: "Kore", description: "Clear and balanced" }];

  return <section className="chinese-recap-shell">
    <div className="voice-studio-top"><button className="text-button" onClick={onBack}><ArrowLeft size={15} /> Back to overview</button><span className="phase-pill"><Languages size={14} /> Chinese story recap</span></div>
    <div className="page-intro compact chinese-recap-intro"><div><span className="eyebrow">សម្រាយរឿងចិន · CHINESE RECAP</span><h1>Turn a Chinese story into a Khmer recap.</h1><p>Paste Chinese subtitles or a transcript, let Gemini shape the story, then generate a narrated MP4 from your authorized source video.</p></div><div className={`voice-provider-badge ${catalog?.configured ? "ready" : "fallback"}`}><span className="status-dot" />{catalog?.configured ? "Gemini recap ready" : "Gemini setup required"}</div></div>
    {error && <div className="alert error"><X size={16} />{error}<button onClick={() => setError("")}><X size={15} /></button></div>}
    {notice && <div className="alert success"><Check size={16} />{notice}<button onClick={() => setNotice("")}><X size={15} /></button></div>}
    <div className="chinese-recap-grid">
      <form className="card chinese-recap-card" onSubmit={generateRecap}>
        <div className="voice-section-heading"><div><span className="eyebrow">1 · CHINESE SOURCE</span><h2>Story input</h2></div><FileText size={19} /></div>
        <label className="field"><span>Recap title</span><input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. The hidden identity" /></label>
        <div className="chinese-recap-form-grid"><label className="field"><span>Output language</span><select value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)}><option value="km">Khmer narration</option><option value="en">English recap</option></select></label><label className="field"><span>Attach project (optional)</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Keep as recap video</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label></div>
        <label className="field"><span>Chinese subtitles or transcript</span><textarea className="chinese-source-editor" value={sourceText} onChange={(event) => setSourceText(event.target.value)} maxLength={50000} placeholder="粘贴中文字幕或故事文字…" /></label>
        <div className="chinese-input-note"><FileText size={15} /><span>Chinese SRT text is accepted. Timestamps are ignored when creating the recap.</span></div>
        <button className="button primary" type="submit" disabled={busy || !catalog?.configured}>{busy ? <Spinner /> : <><WandSparkles size={16} /> Generate Chinese recap</>}</button>
      </form>
      <section className="card chinese-recap-card chinese-output-card">
        <div className="voice-section-heading"><div><span className="eyebrow">2 · RECAP + NARRATION</span><h2>Review the story</h2></div><span className="section-meta">{recap.length.toLocaleString()} chars</span></div>
        <label className="field"><span>Editable recap script</span><textarea className="chinese-recap-editor" value={recap} onChange={(event) => setRecap(event.target.value)} placeholder="Your generated recap will appear here…" /></label>
        <div className="chinese-recap-form-grid"><label className="field"><span>Khmer voice</span><select value={voice} onChange={(event) => setVoice(event.target.value)}>{voices.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.description}</option>)}</select></label><label className="field"><span>Authorized source MP4</span><label className="file-picker chinese-file-picker"><Film size={15} /><span>{videoFile?.name || "Choose MP4"}</span><input type="file" accept="video/mp4,.mp4" onChange={(event) => setVideoFile(event.target.files?.[0] || null)} /></label></label></div>
        <div className="chinese-recap-action"><span><span className="status-dot" />{videoFile ? "Source video ready" : "Choose an MP4 to continue"}</span><button className="button primary" type="button" onClick={exportRecap} disabled={exportBusy || !videoFile || !recap.trim()}>{exportBusy ? <Spinner /> : <><Upload size={16} /> Generate recap MP4</>}</button></div>
        {timeline && <div className="chinese-recap-result"><video src={mediaUrl(timeline.videoUrl)} controls preload="metadata" /><div><strong>{timeline.title}</strong><span>Preview generated successfully.</span></div><a className="button secondary" href={mediaUrl(timeline.downloadUrl)}><Download size={15} /> Download MP4</a></div>}
      </section>
    </div>
    <div className="publisher-footnote"><Mic2 size={15} /><span>Use only videos and subtitles you are authorized to process. Review the recap and MP4 before publishing to YouTube or Facebook.</span></div>
  </section>;
}
