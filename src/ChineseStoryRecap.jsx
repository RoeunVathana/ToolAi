import React, { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download, FileText, Film, Home, Languages, Mic2, Moon, Sun, Upload, WandSparkles, X } from "lucide-react";
import "./chinese-story-recap.css";
import { useLanguage, text } from "./language.jsx";

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

export default function ChineseStoryRecap({ onBack, theme = "dark", onTheme, onOpenPublisher }) {
  const token = localStorage.getItem("toolaime-token") || "";
  const { language, toggleLanguage } = useLanguage();
  const [catalog, setCatalog] = useState(null);
  const [projects, setProjects] = useState([]);
  const [title, setTitle] = useState("Chinese story recap");
  const [targetLanguage, setTargetLanguage] = useState("km");
  const [voice, setVoice] = useState("Kore");
  const [projectId, setProjectId] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [recap, setRecap] = useState("");
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState("");
  const [extractBusy, setExtractBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [timeline, setTimeline] = useState(null);

  useEffect(() => {
    document.documentElement.classList.add("recap-mode");
    return () => document.documentElement.classList.remove("recap-mode");
  }, []);

  useEffect(() => {
    Promise.allSettled([request("/api/v1/voice/catalog", {}, token), request("/api/v1/projects", {}, token)]).then(([catalogResult, projectResult]) => {
      if (catalogResult.status === "fulfilled") setCatalog(catalogResult.value);
      if (projectResult.status === "fulfilled") setProjects(projectResult.value.projects || []);
    });
  }, []);

  useEffect(() => {
    if (!videoFile) {
      setVideoPreviewUrl("");
      return undefined;
    }
    const url = URL.createObjectURL(videoFile);
    setVideoPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [videoFile]);

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

  async function extractVideoText() {
    setError(""); setNotice("");
    if (!videoFile) { setError("Choose an MP4 video first."); return; }
    setExtractBusy(true);
    try {
      const form = new FormData();
      form.append("file", videoFile);
      form.append("extractOnly", "true");
      form.append("sourceLanguage", "auto");
      form.append("targetLanguage", "zh");
      form.append("translate", "true");
      const data = await request("/api/media/process", { method: "POST", body: form }, token);
      const extractedText = data.transcript || (data.captionSegments || []).map((segment) => segment.text).join("\n");
      if (!extractedText.trim()) {
        setNotice(data.warnings?.[0] || "No transcript was returned. You can write or paste the source text yourself.");
        return;
      }
      setSourceText(extractedText.trim());
      setNotice(text(language, "videoTextReady", language === "km" ? "អត្ថបទពីវីដេអូរួចរាល់។ សូមពិនិត្យមុនបង្កើតសម្រាយ។" : "Video text is ready. Review it before generating the recap."));
    } catch (extractError) { setError(extractError.message); } finally { setExtractBusy(false); }
  }

  async function exportRecap() {
    setError(""); setNotice("");
    if (!videoFile) { setError("Choose the authorized Chinese MP4 before creating the recap video."); return; }
    if (!recap.trim()) { setError("Generate or write the recap before creating the video."); return; }
    setExportBusy(true);
    let createdProjectId = "";
    try {
      let targetProjectId = projectId;
      if (!targetProjectId) {
        const created = await request("/api/v1/projects", { method: "POST", body: JSON.stringify({
          title: title.trim() || "Chinese story recap",
          topic: `Chinese story recap · ${title.trim() || "Untitled story"}`,
          language: targetLanguage,
          durationMinutes: 1,
          script: recap,
        }) }, token);
        targetProjectId = created.project.id;
        createdProjectId = targetProjectId;
        setProjectId(targetProjectId);
        setProjects((current) => [created.project, ...current]);
      }
      const form = new FormData();
      form.append("video", videoFile); form.append("title", title); form.append("voice", voice); form.append("script", recap);
      form.append("projectId", targetProjectId);
      const data = await request("/api/v1/voice/timelines", { method: "POST", body: form }, token);
      setTimeline(data.timeline); setNotice("Recap MP4 generated. Preview it before publishing.");
      if (targetProjectId && data.asset && onOpenPublisher) onOpenPublisher(targetProjectId);
    } catch (exportError) {
      if (createdProjectId) await request(`/api/v1/projects/${createdProjectId}`, { method: "DELETE" }, token).catch(() => {});
      setError(exportError.message);
    } finally { setExportBusy(false); }
  }

  function mediaUrl(url) { return url ? `${url}?token=${encodeURIComponent(token)}` : ""; }
  const voices = catalog?.voices || [{ id: "Kore", label: "Kore", description: "Clear and balanced" }];
  const segmentCount = sourceText.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean).length;
  const durationLabel = timeline?.durationSeconds ? `${Math.round(timeline.durationSeconds)}s` : "00:00";

  return <section className="chinese-recap-shell recap-reference-shell">
    <div className="recap-reference-header"><div className="recap-reference-brand"><div className="recap-brand-icon"><Film size={22} /></div><div><strong>TIMELINE VOICE STUDIO</strong><span>{text(language, "recapDescription")}</span></div></div><div className="recap-reference-actions"><button aria-label="Toggle theme" onClick={onTheme}>{theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}</button><button className="recap-language-button" onClick={toggleLanguage}>{text(language, "language")}</button><button type="button">{text(language, "admin")}</button><button onClick={onBack}><Home size={14} /> {text(language, "home")}</button></div></div>
    <div className="recap-reference-subbar"><button className="text-button" onClick={onBack}><ArrowLeft size={15} /> {text(language, "back")}</button><span><Languages size={14} /> {text(language, "recap")}</span></div>
    {error && <div className="alert error"><X size={16} />{error}<button onClick={() => setError("")}><X size={15} /></button></div>}
    {notice && <div className="alert success"><Check size={16} />{notice}<button onClick={() => setNotice("")}><X size={15} /></button></div>}
    <div className="recap-reference-grid">
      <aside className="recap-reference-sidebar">
        <section className="recap-mini-card recap-audio-card"><div className="recap-section-title"><span><Mic2 size={15} /> {text(language, "generatedAudio")}</span><span>{timeline ? text(language, "ready") : "00:00 / 00:00"}</span></div>{timeline?.audioUrl ? <audio controls preload="metadata" src={mediaUrl(timeline.audioUrl)} /> : <div className="recap-audio-placeholder"><Mic2 size={18} /><span>Your generated narration will appear here.</span></div>}</section>
        <section className="recap-mini-card recap-summary-card"><div className="recap-section-title"><span><FileText size={15} /> {text(language, "timelineSummary")}</span><span className="recap-live-dot">● {text(language, "ready")}</span></div><div className="recap-stats"><div><strong>{segmentCount}</strong><span>Segments</span></div><div><strong>{durationLabel}</strong><span>Duration</span></div><div><strong>{voice}</strong><span>Voice</span></div></div><label className="field"><span>Recap title</span><input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} /></label><label className="field"><span>Attach to project</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Keep in recap history</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label></section>
        <section className="recap-mini-card recap-voice-card"><span className="recap-kicker">{text(language, "selectedVoice")}</span><div className="recap-voice-orb"><Mic2 size={30} /></div><h2>{voices.find((item) => item.id === voice)?.label || voice}</h2><p>Khmer narration voice</p><label className="field"><span>Change voice</span><select value={voice} onChange={(event) => setVoice(event.target.value)}>{voices.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.description}</option>)}</select></label><div className="recap-voice-status"><span>● {text(language, "ready")}</span><small>{catalog?.configured ? "Gemini TTS" : "Provider setup required"}</small></div></section>
      </aside>
      <main className="recap-reference-main">
        <section className="recap-panel recap-video-panel">
          <div className="recap-panel-heading">
            <div><span className="recap-kicker">{text(language, "videoPreview")}</span><h2>{timeline ? "Generated recap video" : "Choose your Chinese source"}</h2></div>
            <div className="recap-video-tools">
              <label className="recap-file-button"><Film size={15} /><span>{videoFile?.name || text(language, "chooseMp4")}</span><input type="file" accept="video/mp4,.mp4" onChange={(event) => setVideoFile(event.target.files?.[0] || null)} /></label>
              <button className="recap-ai-button" type="button" onClick={extractVideoText} disabled={!videoFile || extractBusy}>{extractBusy ? <Spinner /> : <WandSparkles size={15} />} {extractBusy ? text(language, "readingVideo", language === "km" ? "កំពុងអានវីដេអូ…" : "Reading video…") : text(language, "readVideo", language === "km" ? "AI អានវីដេអូ" : "AI read video")}</button>
            </div>
          </div>
          {timeline ? <video className="recap-video-preview" src={mediaUrl(timeline.videoUrl)} controls preload="metadata" /> : videoPreviewUrl ? <video className="recap-video-preview" src={videoPreviewUrl} controls preload="metadata" /> : <div className="recap-video-empty"><Film size={38} /><strong>MP4 video preview</strong><span>Your Chinese story preview will appear here.</span></div>}
          {videoFile && !timeline && <div className="recap-video-hint"><WandSparkles size={14} /> {text(language, "readVideoHint", language === "km" ? "ចុច AI អានវីដេអូ ដើម្បីបញ្ចូលអត្ថបទចិនដោយស្វ័យប្រវត្តិ។" : "Click AI read video to fill the Chinese text automatically.")}</div>}
        </section>
        <form className="recap-panel recap-source-panel" onSubmit={generateRecap}><div className="recap-panel-heading"><div><span className="recap-kicker">SUBTITLE · SOURCE TEXT</span><h2>{text(language, "sourceText")}</h2></div><span className="recap-count">{sourceText.length.toLocaleString()} chars</span></div><textarea className="recap-source-editor" value={sourceText} onChange={(event) => setSourceText(event.target.value)} maxLength={50000} placeholder={text(language, "subtitleHint")} /><div className="recap-source-footer"><label className="recap-language-select"><Languages size={15} /><span>{text(language, "output")}</span><select value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)}><option value="km">{text(language, "outputKhmer")}</option><option value="en">{text(language, "outputEnglish")}</option></select></label><button className="recap-purple-button" type="submit" disabled={busy || !catalog?.configured}>{busy ? <Spinner /> : <><WandSparkles size={16} /> {text(language, "generateRecap")}</>}</button></div></form>
        <section className="recap-panel recap-script-panel"><div className="recap-panel-heading"><div><span className="recap-kicker">AI RECAP SCRIPT</span><h2>{text(language, "recapScript")}</h2></div><span className="recap-count">{recap.length.toLocaleString()} chars</span></div><textarea className="recap-script-editor" value={recap} onChange={(event) => setRecap(event.target.value)} placeholder={text(language, "scriptHint")} /><div className="recap-action-bar"><span><span className="recap-ready-dot" />{videoFile ? text(language, "sourceReady") : text(language, "chooseSource")}</span><button className="recap-purple-button" type="button" onClick={exportRecap} disabled={exportBusy || !videoFile || !recap.trim()}>{exportBusy ? <Spinner /> : <><Upload size={16} /> {text(language, "generateVoice")}</>}</button>{timeline && <a className="recap-export-button" href={mediaUrl(timeline.downloadUrl)}><Download size={15} /> {text(language, "exportVideo")}</a>}{timeline && onOpenPublisher && <button className="recap-export-button recap-publish-button" type="button" onClick={() => onOpenPublisher(timeline.projectId || projectId)}><ArrowRight size={15} /> Open Auto Publisher</button>}</div></section>
      </main>
    </div>
    <div className="recap-reference-footnote"><Mic2 size={15} /><span>Review your recap and generated audio before publishing. Use only Chinese video and subtitle content you are authorized to process.</span></div>
  </section>;
}
