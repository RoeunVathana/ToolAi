import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const fallbackScenes = [
  {
    id: "fallback-1",
    title: "Kitchen surprise",
    duration: 16,
    color: "coral",
    status: "ready",
  },
  {
    id: "fallback-2",
    title: "Rescue delivery",
    duration: 16,
    color: "blue",
    status: "ready",
  },
  {
    id: "fallback-3",
    title: "Tiny picnic",
    duration: 16,
    color: "yellow",
    status: "ready",
  },
  {
    id: "fallback-4",
    title: "Playset finale",
    duration: 16,
    color: "purple",
    status: "ready",
  },
];

const initialForm = {
  prompt:
    "A cheerful toy kitchen and rescue vehicle adventure on a soft blue playmat. Colorful original toys, gentle camera motion, bright studio lighting, and a playful family-friendly story.",
  title: "Miniature Toy Kitchen & Rescue Vehicles Playset Fun!",
  description:
    "Watch a colorful miniature toy kitchen playset and rescue vehicles come to life in a cheerful pretend-play adventure!\n\nWelcome to Michael Me — fun, creative toy stories for kids and families. New original playset videos every week.\n\n#Toys #KidsToys #PretendPlay #MiniatureKitchen #MichaelMe",
  tags: [
    "toys",
    "kids toys",
    "miniature kitchen",
    "rescue vehicles",
    "pretend play",
    "Michael Me",
  ],
};

function formatRetryDelay(value) {
  const match = String(value || "").match(/([0-9]+(?:\.[0-9]+)?)s/i);
  if (!match) return "";
  const totalSeconds = Math.max(0, Math.round(Number(match[1])));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours) return `${hours} hour${hours === 1 ? "" : "s"}${minutes ? ` ${minutes} minute${minutes === 1 ? "" : "s"}` : ""}`;
  return `${Math.max(1, minutes)} minute${minutes === 1 ? "" : "s"}`;
}

function friendlyApiError(value, fallbackMessage) {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      // Keep the original text for ordinary, non-JSON errors.
    }
  }
  if (parsed?.error && typeof parsed.error === "object") parsed = parsed.error;
  const message = String(parsed?.message || parsed || "").trim();
  const status = String(parsed?.status || parsed?.code || "").toUpperCase();
  const retryInfo = Array.isArray(parsed?.details)
    ? parsed.details.find((detail) => String(detail?.["@type"] || "").includes("RetryInfo"))
    : null;
  const retryDelay = formatRetryDelay(retryInfo?.retryDelay);
  if (/^Gemini quota is exhausted/i.test(message)) return message;
  if (status === "429" || status === "RESOURCE_EXHAUSTED" || /quota|rate limit|too many requests|exceeded your current/i.test(message)) {
    return `Gemini quota is exhausted${retryDelay ? `; try again in about ${retryDelay}` : ""}. Use Built-in planner/demo mode now, or add billing/use another Gemini project when you need live AI processing.`;
  }
  if (/^upstream error$/i.test(message)) {
    return "The remote AI service is temporarily unavailable. Please try again in a few seconds.";
  }
  return message || fallbackMessage;
}

async function readApiResponse(response, fallbackMessage) {
  const raw = await response.text();
  if (!raw.trim()) return {};
  try {
    const data = JSON.parse(raw);
    if (!response.ok && data.error) data.error = friendlyApiError(data.error, fallbackMessage);
    return data;
  } catch {
    return {
      error: response.ok ? fallbackMessage : friendlyApiError(raw, `${fallbackMessage} (HTTP ${response.status}).`),
    };
  }
}

function App() {
  const [activeNav, setActiveNav] = useState("new");
  const [form, setForm] = useState(initialForm);
  const [duration, setDuration] = useState(60);
  const [sceneCount, setSceneCount] = useState(4);
  const [scenes, setScenes] = useState([]);
  const [demoPreviewUrl, setDemoPreviewUrl] = useState(null);
  const [storyPlan, setStoryPlan] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [localVideoFile, setLocalVideoFile] = useState(null);
  const [processedVideoUrl, setProcessedVideoUrl] = useState(null);
  const [mediaFile, setMediaFile] = useState(null);
  const [mediaSourceLanguage, setMediaSourceLanguage] = useState("auto");
  const [mediaTargetLanguage, setMediaTargetLanguage] = useState("km");
  const [mediaMode, setMediaMode] = useState("both");
  const [mediaVoice, setMediaVoice] = useState("Kore");
  const [mediaTranscript, setMediaTranscript] = useState("");
  const [isProcessingMedia, setIsProcessingMedia] = useState(false);
  const [mediaResult, setMediaResult] = useState(null);
  const [textProvider, setTextProvider] = useState("gemini");
  const [videoProvider, setVideoProvider] = useState("gemini");
  const [youtubeSourceUrl, setYoutubeSourceUrl] = useState("");
  const [youtubeSourceInfo, setYoutubeSourceInfo] = useState(null);
  const [isCheckingYoutube, setIsCheckingYoutube] = useState(false);
  const [notice, setNotice] = useState(null);
  const [health, setHealth] = useState({
    demoMode: true,
    youtubeConnected: false,
    facebookConnected: false,
    geminiConfigured: false,
  });
  const [library, setLibrary] = useState([]);

  async function loadWorkspace() {
    const [healthResult, libraryResult] = await Promise.all([
      fetch("/api/health").then((response) =>
        readApiResponse(response, "The health check returned an invalid response."),
      ),
      fetch("/api/library").then((response) =>
        readApiResponse(response, "The library returned an invalid response."),
      ),
    ]);
    setHealth(healthResult);
    setLibrary(libraryResult.items || []);
    if (!health.aiProviders && healthResult.aiProviders?.activeTextProvider) setTextProvider(healthResult.aiProviders.activeTextProvider);
    if (!health.aiProviders && healthResult.aiProviders?.activeVideoProvider) setVideoProvider(healthResult.aiProviders.activeVideoProvider);
    return healthResult;
  }

  useEffect(() => {
    loadWorkspace()
      .catch(() =>
        setNotice({
          type: "error",
          text: "The local API is not running yet. Start it with npm run dev.",
        }),
      );
  }, []);

  const totalDuration = useMemo(
    () =>
      scenes.reduce((total, scene) => total + Number(scene.duration || 0), 0),
    [scenes],
  );

  const updateField = (field, value) =>
    setForm((current) => ({ ...current, [field]: value }));

  async function planWithAI() {
    setIsPlanning(true);
    setNotice(null);
    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: form.prompt, duration, sceneCount, provider: textProvider }),
      });
      const data = await readApiResponse(response, "Gemini planning failed.");
      if (!response.ok) throw new Error(data.error || "Gemini planning failed.");
      setStoryPlan(data.storyPlan);
      setForm((current) => ({
        ...current,
        title: data.storyPlan.title,
        description: data.storyPlan.description,
        tags: data.storyPlan.tags,
      }));
      setNotice({
        type: data.warning ? "info" : "success",
        text: data.warning || (textProvider === "gemini"
          ? "Gemini created the title, description, tags, scene plan, and sound directions."
          : "The built-in planner created the title, description, tags, scene plan, and sound directions."),
      });
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setIsPlanning(false);
    }
  }

  async function waitForGeneration(jobId) {
    for (let attempt = 0; attempt < 360; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 5000));
      const response = await fetch(`/api/generate/${encodeURIComponent(jobId)}`);
      const data = await readApiResponse(response, "Video generation status was invalid.");
      if (!response.ok) throw new Error(data.error || "Video generation failed.");
      if (data.status === "completed") return data;
      if (data.status === "failed") throw new Error(data.error || "Video generation failed.");
      setNotice({
        type: "info",
        text: data.status === "queued"
          ? "Your video is queued. This page will keep checking for the finished scenes."
          : "Gemini is generating the scenes. This can take several minutes, so you can leave this tab open.",
      });
    }
    throw new Error("Video generation took too long. Check Railway logs and try again.");
  }

  async function generateVideo() {
    setIsGenerating(true);
    setNotice(null);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: form.prompt,
          duration,
          sceneCount,
          textProvider,
          videoProvider,
          storyPlan: storyPlan?.sourcePrompt === form.prompt ? storyPlan : null,
        }),
      });
      let data = await readApiResponse(response, "Video generation failed.");
      if (!response.ok)
        throw new Error(data.error || "Video generation failed.");
      if (data.jobId) data = await waitForGeneration(data.jobId);
      setScenes(data.scenes || []);
      setDemoPreviewUrl(data.previewVideoUrl || null);
      if (data.storyPlan) {
        setStoryPlan(data.storyPlan);
        setForm((current) => ({
          ...current,
          title: data.storyPlan.title,
          description: data.storyPlan.description,
          tags: data.storyPlan.tags,
        }));
      }
      setNotice({
        type: data.warning || data.mode === "demo" ? "info" : "success",
        text: data.warning ||
          (data.mode === "demo"
            ? "Preview generated in demo mode. Add your Gemini API key when you are ready for real clips with sound."
            : "Your scenes are ready. Review the title and publish settings before sending them to YouTube or Facebook."),
      });
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setIsGenerating(false);
    }
  }

  async function processMedia() {
    if (!mediaFile) {
      setNotice({ type: "error", text: "Choose a video first in AI Media Lab." });
      return;
    }
    const isVideo = mediaFile.type.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(mediaFile.name);
    if (!isVideo || mediaFile.size > 500 * 1024 * 1024) {
      setNotice({ type: "error", text: "Choose a video smaller than 500 MB." });
      return;
    }
    setIsProcessingMedia(true);
    setNotice(null);
    setMediaResult(null);
    setProcessedVideoUrl(null);
    try {
      const payload = new FormData();
      payload.append("file", mediaFile);
      payload.append("sourceLanguage", mediaSourceLanguage);
      payload.append("targetLanguage", mediaTargetLanguage);
      payload.append("voice", mediaVoice);
      payload.append("translate", String(mediaMode === "translate" || mediaMode === "dub" || mediaMode === "both"));
      payload.append("includeSubtitles", String(mediaMode === "subtitle" || mediaMode === "translate" || mediaMode === "both"));
      payload.append("includeDubbing", String(mediaMode === "dub" || mediaMode === "both"));
      if (mediaTranscript.trim()) payload.append("transcript", mediaTranscript.trim());
      const response = await fetch("/api/media/process", { method: "POST", body: payload });
      const data = await readApiResponse(response, "Media processing failed.");
      if (!response.ok) {
        const error = new Error(data.error || "Media processing failed.");
        error.code = data.code;
        throw error;
      }
      setMediaResult(data);
      setProcessedVideoUrl(data.videoUrl);
      setNotice({
        type: data.mode === "demo" || data.warnings?.length ? "info" : "success",
        text: data.warnings?.[0] || "Your processed video is ready. It is now available in the publishing panel.",
      });
    } catch (error) {
      setNotice({ type: error.code === "GEMINI_QUOTA_EXHAUSTED" ? "info" : "error", text: error.message });
    } finally {
      setIsProcessingMedia(false);
    }
  }

  async function uploadVideo() {
    if (!scenes.length && !localVideoFile && !processedVideoUrl) {
      setNotice({
        type: "error",
        text: "Generate a video first, then upload the finished MP4.",
      });
      return;
    }
    setIsUploading(true);
    setNotice(null);
    try {
      const payload = new FormData();
      payload.append("title", form.title);
      payload.append("description", form.description);
      payload.append("tags", JSON.stringify(form.tags));
      payload.append("privacyStatus", "private");
      payload.append("madeForKids", "true");
      payload.append("containsSyntheticMedia", "true");
      payload.append(
        "videoUrls",
        JSON.stringify(publishVideoUrls),
      );
      if (localVideoFile) payload.append("file", localVideoFile);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: payload,
      });
      const data = await readApiResponse(response, "Upload failed.");
      if (!response.ok) throw new Error(data.error || "Upload failed.");
      setLibrary((items) => [data.item, ...items]);
      setNotice({
        type: "success",
        text: "Uploaded to YouTube as private. Open YouTube Studio to review and publish.",
      });
      setLocalVideoFile(null);
      setProcessedVideoUrl(null);
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setIsUploading(false);
    }
  }

  async function uploadFacebookVideo() {
    if (!scenes.length && !localVideoFile && !processedVideoUrl) {
      setNotice({
        type: "error",
        text: "Generate a video first, then upload the finished MP4.",
      });
      return;
    }
    setIsUploading(true);
    setNotice(null);
    try {
      const payload = new FormData();
      payload.append("title", form.title);
      payload.append("description", form.description);
      payload.append(
        "videoUrls",
        JSON.stringify(publishVideoUrls),
      );
      if (localVideoFile) payload.append("file", localVideoFile);

      const response = await fetch("/api/upload/facebook", {
        method: "POST",
        body: payload,
      });
      const data = await readApiResponse(response, "Facebook upload failed.");
      if (!response.ok) throw new Error(data.error || "Facebook upload failed.");
      setLibrary((items) => [data.item, ...items]);
      setNotice({
        type: "success",
        text: "Published to your Facebook Page.",
      });
      setLocalVideoFile(null);
      setProcessedVideoUrl(null);
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setIsUploading(false);
    }
  }

  async function publishBoth() {
    if (!scenes.length && !localVideoFile && !processedVideoUrl) {
      setNotice({
        type: "error",
        text: "Generate a video first, then publish the finished MP4.",
      });
      return;
    }
    setIsUploading(true);
    setNotice(null);
    try {
      const payload = new FormData();
      payload.append("title", form.title);
      payload.append("description", form.description);
      payload.append("tags", JSON.stringify(form.tags));
      payload.append("privacyStatus", "private");
      payload.append("madeForKids", "true");
      payload.append("containsSyntheticMedia", "true");
      payload.append("targets", JSON.stringify(["youtube", "facebook"]));
      payload.append(
        "videoUrls",
        JSON.stringify(publishVideoUrls),
      );
      if (localVideoFile) payload.append("file", localVideoFile);

      const response = await fetch("/api/publish", {
        method: "POST",
        body: payload,
      });
      const data = await readApiResponse(response, "Publishing failed.");
      if (!response.ok) throw new Error(data.error || "Publishing failed.");
      const items = data.items || Object.values(data.results || {});
      setLibrary((current) => [...items, ...current]);
      setNotice({
        type: "success",
        text: data.error
          ? `YouTube succeeded, but Facebook needs attention: ${data.error}`
          : "Uploaded privately to YouTube and published as a Facebook Page Reel.",
      });
      setLocalVideoFile(null);
      setProcessedVideoUrl(null);
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setIsUploading(false);
    }
  }

  async function switchConnection(kind, id) {
    if (!id) return;
    setNotice(null);
    try {
      const response = await fetch(`/api/connections/${kind}/active`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "youtube" ? { accountId: id } : { pageId: id }),
      });
      const data = await readApiResponse(response, "Could not change the connection.");
      if (!response.ok) throw new Error(data.error || "Could not change the connection.");
      await loadWorkspace();
      setNotice({ type: "success", text: kind === "youtube" ? "YouTube channel changed." : "Facebook Page changed." });
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function inspectYoutubeSource() {
    setIsCheckingYoutube(true);
    setYoutubeSourceInfo(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/youtube/metadata?url=${encodeURIComponent(youtubeSourceUrl)}`);
      const data = await readApiResponse(response, "Could not inspect the YouTube link.");
      if (!response.ok) throw new Error(data.error || "Could not inspect the YouTube link.");
      setYoutubeSourceInfo(data);
      setNotice({ type: "success", text: "YouTube link checked. Download your own video in YouTube Studio, then import the MP4 here." });
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setIsCheckingYoutube(false);
    }
  }

  function openMediaLab(nextMode = "both", targetLanguage = "km") {
    setMediaMode(nextMode);
    setMediaTargetLanguage(targetLanguage);
    setActiveNav("media");
  }

  const hasRealVideo = Boolean(localVideoFile || processedVideoUrl || scenes.some((scene) => scene.videoUrl));
  const publishVideoUrls = processedVideoUrl
    ? [processedVideoUrl]
    : scenes.map((scene) => scene.videoUrl).filter(Boolean);
  const youtubeChannelLabel = health.youtubeChannel
    ? `${health.youtubeChannel.title}${health.youtubeChannel.handle ? ` · ${health.youtubeChannel.handle}` : ""}`
    : "One-time sign-in required";
  const facebookPageLabel = health.facebookPage?.name || "One-time Page sign-in required";
  const textProviders = health.aiProviders?.text || [];
  const videoProviders = health.aiProviders?.video || [];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <span className="brand-play">▶</span>
            <span className="brand-spark">✦</span>
          </div>
          <div>
            <div className="brand-name">ToyPost</div>
            <div className="brand-subtitle">STUDIO</div>
          </div>
        </div>

        <div className="workspace-chip">
          <span className="avatar">M</span>
          <span>
            <strong>Michael Me</strong>
            <small>Creator workspace</small>
          </span>
          <span className="chip-dot" />
        </div>

        <nav className="main-nav" aria-label="Main navigation">
          <button
            className={activeNav === "new" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveNav("new")}
          >
            <span className="nav-icon">✦</span> New post{" "}
            <span className="nav-shortcut">N</span>
          </button>
          <button
            className={activeNav === "library" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveNav("library")}
          >
            <span className="nav-icon">▤</span> Library{" "}
            <span className="nav-count">{library.length}</span>
          </button>
          <button
            className={activeNav === "media" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveNav("media")}
          >
            <span className="nav-icon">◌</span> AI Media Lab <span className="nav-badge">AI</span>
          </button>
          <button
            className={activeNav === "tools" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveNav("tools")}
          >
            <span className="nav-icon">⌘</span> AI Toolchain
          </button>
          <button
            className={activeNav === "source" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveNav("source")}
          >
            <span className="nav-icon">⇩</span> YouTube source
          </button>
          <button
            className={activeNav === "channel" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveNav("channel")}
          >
            <span className="nav-icon">◉</span> Channel setup
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="usage-card">
            <div className="usage-heading">
              <span>Monthly generation</span>
              <span>0 / 20</span>
            </div>
            <div className="usage-bar">
              <span style={{ width: "4%" }} />
            </div>
            <small>Demo mode is unlimited</small>
          </div>
          <button className="help-link">
            <span>?</span> Help center
          </button>
          <div className="version">
            ToyPost Studio <span>v1.0</span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            <span>{activeNav === "media" ? "AI Media Lab" : activeNav === "tools" ? "AI Toolchain" : activeNav === "source" ? "YouTube source" : activeNav === "channel" ? "Channel setup" : "New post"}</span>
            <i>/</i>
            <strong>{activeNav === "media" ? "Dub and translate" : activeNav === "tools" ? "Choose your process" : activeNav === "source" ? "Import your own video" : activeNav === "channel" ? "Connections" : "Generate a video"}</strong>
          </div>
          <div className="top-actions">
            <div
              className={`status-pill ${health.youtubeConnected ? "connected" : ""}`}
              title={health.youtubeError || health.youtubeChannel?.title || "YouTube connection status"}
            >
              <span className="status-dot" />
              {health.youtubeConnected
                ? "YouTube connected"
                : "YouTube not connected"}
            </div>
            <button className="icon-button" aria-label="Notifications">
              ♢
            </button>
            <button
              className="icon-button refresh-button"
              aria-label="Refresh connection status"
              onClick={() => loadWorkspace().catch(() => setNotice({ type: "error", text: "Could not refresh the connection status." }))}
            >
              ↻
            </button>
            <button className="profile-button">M</button>
          </div>
        </header>

        <div className="page-wrap">
          <section className={`page-heading ${activeNav}-page`}>
            <div>
              <p className="eyebrow">{activeNav === "media" ? "PREPARE YOUR MEDIA" : activeNav === "tools" ? "AI PRODUCTION WORKFLOW" : activeNav === "channel" ? "PUBLISHING CONNECTIONS" : "CREATE A NEW POST"}</p>
              <h1>{activeNav === "media" ? <>Make one video work in <em>every language.</em></> : activeNav === "channel" ? <>Choose where your <em>video goes.</em></> : <>Turn a toy idea into a <em>YouTube video.</em></>}</h1>
              <p className="heading-copy">{activeNav === "media" ? "Create subtitles, translations, and a realistic voice track, then keep using the same publishing workflow." : activeNav === "channel" ? "Switch the YouTube channel or Facebook Page used by your next upload." : "Describe the playset adventure you want to make. ToyPost turns it into a bright, original video that is ready for review."}</p>
              {activeNav === "tools" && (
                <div className="toolchain-heading-override">
                  <p className="eyebrow">AI PRODUCTION WORKFLOW</p>
                  <h1>Build faster with an <em>AI toolchain.</em></h1>
                  <p className="heading-copy">Pick the right AI tool for each stage, then move the finished video into one publishing workflow.</p>
                </div>
              )}
              {activeNav === "source" && (
                <div className="youtube-source-heading-override">
                  <p className="eyebrow">YOUTUBE SOURCE</p>
                  <h1>Bring your own video <em>back into ToyPost.</em></h1>
                  <p className="heading-copy">Check a YouTube link, download your authorized video from YouTube Studio, and import the MP4 for Khmer localization or publishing.</p>
                </div>
              )}
            </div>
            <div className="heading-badge">
              <span className="sparkle">✦</span>
              <span>
                <strong>Made for kids</strong>
                <small>Safety defaults are on</small>
              </span>
            </div>
          </section>

          {notice && (
            <div className={`notice ${notice.type}`} role="status">
              <span>
                {notice.type === "error"
                  ? "!"
                  : notice.type === "success"
                    ? "✓"
                    : "i"}
              </span>
              <p>{notice.text}</p>
              <button onClick={() => setNotice(null)}>×</button>
            </div>
          )}

          {activeNav === "library" ? (
            <LibraryView library={library} onNew={() => setActiveNav("new")} />
          ) : activeNav === "source" ? (
            <YouTubeSourceView
              url={youtubeSourceUrl}
              setUrl={setYoutubeSourceUrl}
              info={youtubeSourceInfo}
              isChecking={isCheckingYoutube}
              onCheck={inspectYoutubeSource}
              onImportVideo={(file) => {
                setLocalVideoFile(file);
                setActiveNav("new");
                setNotice({ type: "success", text: `${file.name} is ready in the publishing panel.` });
              }}
            />
          ) : activeNav === "tools" ? (
            <AiToolchainView
              health={health}
              textProviders={textProviders}
              videoProviders={videoProviders}
              textProvider={textProvider}
              setTextProvider={setTextProvider}
              videoProvider={videoProvider}
              setVideoProvider={setVideoProvider}
              onOpenComposer={() => setActiveNav("new")}
              onOpenMedia={openMediaLab}
              onOpenChannels={() => setActiveNav("channel")}
              hasVideo={hasRealVideo}
            />
          ) : activeNav === "media" ? (
            <MediaLabView
              health={health}
              mediaFile={mediaFile}
              onSelectFile={(file) => {
                setMediaFile(file);
                setMediaResult(null);
                setProcessedVideoUrl(null);
              }}
              sourceLanguage={mediaSourceLanguage}
              setSourceLanguage={setMediaSourceLanguage}
              targetLanguage={mediaTargetLanguage}
              setTargetLanguage={setMediaTargetLanguage}
              mode={mediaMode}
              setMode={setMediaMode}
              voice={mediaVoice}
              setVoice={setMediaVoice}
              transcript={mediaTranscript}
              setTranscript={setMediaTranscript}
              isProcessing={isProcessingMedia}
              onProcess={processMedia}
              result={mediaResult}
              onUseForPublishing={() => {
                setActiveNav("new");
                setNotice({ type: "success", text: "Processed video attached to the publishing panel." });
              }}
            />
          ) : activeNav === "channel" ? (
            <ChannelView health={health} onSwitch={switchConnection} />
          ) : (
            <>
              <div className="content-grid">
                <section className="composer-card card">
                  <div className="card-header">
                    <div>
                      <span className="step-label">
                        01 <i>—</i> THE IDEA
                      </span>
                      <h2>Describe your video</h2>
                    </div>
                    <span className="mini-label">AI VIDEO</span>
                  </div>
                  <label className="field-label" htmlFor="prompt">
                    What should happen in the video?
                  </label>
                  <div className="prompt-wrap">
                    <textarea
                      id="prompt"
                      value={form.prompt}
                      onChange={(event) =>
                        updateField("prompt", event.target.value)
                      }
                      maxLength={1000}
                    />
                    <span className="prompt-sparkle">✦</span>
                    <span className="char-count">
                      {form.prompt.length} / 1,000
                    </span>
                  </div>
                  <div className="prompt-suggestions">
                    <span>Try a preset</span>
                    <button
                      onClick={() =>
                        updateField(
                          "prompt",
                          "A tiny pink toy kitchen makes a colorful pretend breakfast while a friendly original rescue truck delivers fruit. Bright overhead studio video, gentle playful movement, no logos.",
                        )
                      }
                    >
                      Kitchen morning
                    </button>
                    <button
                      onClick={() =>
                        updateField(
                          "prompt",
                          "Original toy rescue vehicles race down a soft playmat ramp to help at a miniature picnic. Cheerful colors, macro camera, smooth movement, no branded characters.",
                        )
                      }
                    >
                      Rescue mission
                    </button>
                    <button
                      onClick={() =>
                        updateField(
                          "prompt",
                          "A pastel toy picnic is packed with plastic fruit and tiny sandwiches, then shared with a small toy car. Warm studio light, gentle stop-motion feeling, no text.",
                        )
                      }
                    >
                      Tiny picnic
                    </button>
                    <button
                      className="gemini-plan-button"
                      onClick={planWithAI}
                      disabled={isPlanning || !textProviders.find((provider) => provider.id === textProvider)?.configured}
                      title="Prepare the title, scenes, tags, and sound directions"
                    >
                      {isPlanning ? "Planning…" : `Improve with ${textProviders.find((provider) => provider.id === textProvider)?.label || "AI"}`}
                    </button>
                  </div>

                  <div className="ai-provider-grid">
                    <label className="provider-field">
                      <span>Story planner</span>
                      <select value={textProvider} onChange={(event) => setTextProvider(event.target.value)}>
                        {textProviders.map((provider) => (
                          <option key={provider.id} value={provider.id} disabled={!provider.configured}>
                            {provider.label}{provider.configured ? "" : " · setup needed"}
                          </option>
                        ))}
                      </select>
                      <small>{textProviders.find((provider) => provider.id === textProvider)?.description || "Choose how the production plan is prepared."}</small>
                    </label>
                    <label className="provider-field">
                      <span>Video tool</span>
                      <select value={videoProvider} onChange={(event) => setVideoProvider(event.target.value)}>
                        {videoProviders.map((provider) => (
                          <option key={provider.id} value={provider.id} disabled={!provider.configured}>
                            {provider.label}{provider.configured ? "" : " · setup needed"}
                          </option>
                        ))}
                      </select>
                      <small>{videoProviders.find((provider) => provider.id === videoProvider)?.description || "Choose where the video is created."}</small>
                    </label>
                  </div>

                  <div className="field-row">
                    <div>
                      <label className="field-label" htmlFor="duration">
                        Video length
                      </label>
                      <div className="segmented" id="duration">
                        {[60, 90, 120].map((value) => (
                          <button
                            key={value}
                            className={duration === value ? "selected" : ""}
                            onClick={() => setDuration(value)}
                          >
                            {value === 90 ? "1.5 min" : `${value / 60} min`}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="field-label" htmlFor="scenes">
                        Scenes
                      </label>
                      <div className="select-wrap">
                        <select
                          id="scenes"
                          value={sceneCount}
                          onChange={(event) =>
                            setSceneCount(Number(event.target.value))
                          }
                        >
                          <option value="3">3 scenes</option>
                          <option value="4">4 scenes</option>
                          <option value="6">6 scenes</option>
                          <option value="8">8 scenes</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="safety-note">
                    <span className="shield">♢</span>
                    <p>
                      <strong>Original toy designs only</strong>
                      <br />
                      ToyPost avoids copyrighted characters and keeps your
                      prompt family-friendly.
                    </p>
                    <button aria-label="Learn more">?</button>
                  </div>
                  <button
                    className="primary-button generate-button"
                    onClick={generateVideo}
                    disabled={isGenerating || videoProvider === "external-upload"}
                  >
                    <span>
                      {isGenerating ? "Generating scenes…" : "Generate video"}
                    </span>
                    <span className="button-icon">
                      {isGenerating ? "◌" : "✦"}
                    </span>
                  </button>
                  <p className="generation-note">
                    {videoProvider === "external-upload"
                      ? "Use another AI tool, export an MP4, then choose it below"
                      : health.geminiConfigured
                        ? "Powered by Gemini Omni · synchronized audio requested"
                        : "Preview mode · add a Gemini API key for real video generation with sound"}
                  </p>
                </section>

                <section className="preview-card card">
                  <div className="card-header">
                    <div>
                      <span className="step-label">
                        02 <i>—</i> PREVIEW
                      </span>
                      <h2>Your video</h2>
                    </div>
                    <span
                      className={`mode-label ${health.geminiConfigured ? "live" : "demo"}`}
                    >
                      {health.geminiConfigured ? "LIVE MODE" : "DEMO MODE"}
                    </span>
                  </div>
                  {scenes.length === 0 ? (
                    <EmptyPreview onGenerate={generateVideo} />
                  ) : (
                    <>
                      <div className="video-preview">
                        {demoPreviewUrl ? (
                          <video className="demo-video" controls preload="metadata" src={demoPreviewUrl} />
                        ) : (
                          <div className="preview-art">
                            <div className="art-orbit orbit-one" />
                            <div className="art-orbit orbit-two" />
                            <div className="toy-kitchen">
                              <div className="toy-roof" />
                              <div className="toy-counter">
                                <span />
                                <span />
                                <span />
                              </div>
                              <div className="toy-oven" />
                            </div>
                            <div className="toy-truck">
                              <div className="truck-cab" />
                              <div className="truck-body" />
                              <div className="truck-wheel wheel-a" />
                              <div className="truck-wheel wheel-b" />
                            </div>
                            <div className="preview-play">▶</div>
                            <span className="preview-duration">
                              {Math.floor(totalDuration / 60)}:
                              {String(totalDuration % 60).padStart(2, "0")}
                            </span>
                          </div>
                        )}
                        <div className="preview-meta">
                          <div>
                            <strong>{form.title}</strong>
                            <span>
                              {scenes.length} scenes · {totalDuration}s total
                            </span>
                          </div>
                          <button
                            onClick={() => { setScenes([]); setDemoPreviewUrl(null); }}
                            aria-label="Clear preview"
                          >
                            ⌫
                          </button>
                        </div>
                      </div>
                      <div className="timeline">
                        {scenes.map((scene, index) => (
                          <div
                            key={scene.id}
                            className={`timeline-scene ${scene.color}`}
                          >
                            <div className="scene-number">
                              {String(index + 1).padStart(2, "0")}
                            </div>
                            <div className="scene-thumb">
                              <span>
                                {scene.color === "coral"
                                  ? "♨"
                                  : scene.color === "blue"
                                    ? "♢"
                                    : scene.color === "yellow"
                                      ? "✦"
                                      : "◈"}
                              </span>
                            </div>
                            <div>
                              <strong>{scene.title}</strong>
                              <small>
                                {scene.duration}s · {scene.status}
                              </small>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="preview-footer">
                        <span className="ready-dot" />
                        {health.geminiConfigured
                          ? "Ready to upload"
                          : "Preview only until Gemini is connected"}
                        <button
                          className="ghost-button"
                          onClick={() => setActiveNav("new")}
                        >
                          Edit idea
                        </button>
                      </div>
                    </>
                  )}
                </section>
              </div>

              <section className="upload-card card">
                <div className="upload-header">
                  <div>
                    <span className="step-label">
                      03 <i>—</i> PUBLISHING DETAILS
                    </span>
                    <h2>Review before you upload</h2>
                  </div>
                  <div className="upload-policy">
                    <span className="policy-check">✓</span>
                    <span>
                      <strong>Private by default</strong>
                      <small>You decide when it goes public</small>
                    </span>
                  </div>
                </div>
                <div className="upload-grid">
                  <div className="details-fields">
                    <label className="field-label" htmlFor="title">
                      Video title <span>{form.title.length}/100</span>
                    </label>
                    <input
                      id="title"
                      value={form.title}
                      onChange={(event) =>
                        updateField("title", event.target.value)
                      }
                      maxLength={100}
                    />
                    <label className="field-label" htmlFor="description">
                      Description
                    </label>
                    <textarea
                      className="description-input"
                      id="description"
                      value={form.description}
                      onChange={(event) =>
                        updateField("description", event.target.value)
                      }
                    />
                    <label className="field-label" htmlFor="tags">
                      Tags
                    </label>
                    <div className="tag-input">
                      <div className="tag-list">
                        {form.tags.map((tag) => (
                          <span className="tag" key={tag}>
                            {tag}
                            <button
                              onClick={() =>
                                updateField(
                                  "tags",
                                  form.tags.filter((item) => item !== tag),
                                )
                              }
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                      <input
                        id="tags"
                        placeholder="Add a tag and press Enter"
                        onKeyDown={(event) => {
                          if (
                            event.key === "Enter" &&
                            event.currentTarget.value.trim()
                          ) {
                            event.preventDefault();
                            updateField("tags", [
                              ...form.tags,
                              event.currentTarget.value.trim(),
                            ]);
                            event.currentTarget.value = "";
                          }
                        }}
                      />
                    </div>
                  </div>
                  <div className="settings-panel">
                    <div className="settings-heading">
                      <span>Upload settings</span>
                      <span className="settings-lock">⌑</span>
                    </div>
                    <div className="setting-row">
                      <span className="setting-icon audience">●</span>
                      <span>
                        <strong>Audience</strong>
                        <small>Made for kids</small>
                      </span>
                      <span className="toggle on">
                        <i />
                      </span>
                    </div>
                    <div className="setting-row">
                      <span className="setting-icon sparkle-icon">✦</span>
                      <span>
                        <strong>AI disclosure</strong>
                        <small>Altered or synthetic content</small>
                      </span>
                      <span className="toggle on">
                        <i />
                      </span>
                    </div>
                    <div className="setting-row">
                      <span className="setting-icon lock-icon">⌑</span>
                      <span>
                        <strong>Visibility</strong>
                        <small>Private until you review</small>
                      </span>
                      <span className="setting-value">Private</span>
                    </div>
                    <div className="settings-divider" />
                    <div className="channel-connection">
                      <div className="youtube-badge">▶</div>
                      <div>
                        <strong>
                          {health.youtubeConnected
                            ? "YouTube connected"
                            : "Connect YouTube"}
                        </strong>
                        <small>
                          {health.youtubeConnected ? youtubeChannelLabel : health.youtubeError || youtubeChannelLabel}
                        </small>
                      </div>
                      <a className="connect-button" href="/api/auth/youtube">
                        {health.youtubeConnected ? "Add / switch" : "Connect"}
                      </a>
                    </div>
                    {health.youtubeChannels?.length > 1 && (
                      <label className="connection-selector">
                        <span>Active YouTube channel</span>
                        <select
                          value={health.activeYoutubeChannelId || ""}
                          onChange={(event) => switchConnection("youtube", event.target.value)}
                        >
                          {health.youtubeChannels.map((channel) => (
                            <option key={channel.id} value={channel.id}>
                              {channel.title}{channel.handle ? ` · ${channel.handle}` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <div className="channel-connection">
                      <div className="facebook-badge">f</div>
                      <div>
                        <strong>
                          {health.facebookConnected
                            ? "Facebook Page connected"
                            : "Connect Facebook Page"}
                        </strong>
                        <small>
                          {health.facebookConnected
                            ? facebookPageLabel
                            : health.facebookError || "Meta app setup required"}
                        </small>
                      </div>
                      <a className="connect-button" href="/api/auth/facebook">
                        {health.facebookConnected ? "Add / switch" : "Connect"}
                      </a>
                    </div>
                    {health.facebookPages?.length > 1 && (
                      <label className="connection-selector">
                        <span>Active Facebook Page</span>
                        <select
                          value={health.activeFacebookPageId || ""}
                          onChange={(event) => switchConnection("facebook", event.target.value)}
                        >
                          {health.facebookPages.map((page) => (
                            <option key={page.id} value={page.id}>
                              {page.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="local-file-control">
                      <input
                        type="file"
                        accept="video/mp4,video/quicktime,video/webm"
                        onChange={(event) => setLocalVideoFile(event.target.files?.[0] || null)}
                      />
                      <span className="file-icon">▣</span>
                      <span>
                        <strong>{localVideoFile ? localVideoFile.name : "Use an existing video"}</strong>
                        <small>{localVideoFile ? `${(localVideoFile.size / 1024 / 1024).toFixed(1)} MB · ready to upload` : "Choose an MP4, MOV, or WebM file"}</small>
                      </span>
                      <span className="file-action">{localVideoFile ? "Change" : "Choose"}</span>
                    </label>
                    <button
                      className="upload-button"
                      onClick={uploadVideo}
                      disabled={
                        isUploading ||
                        !hasRealVideo ||
                        !health.youtubeConnected
                      }
                    >
                      <span>
                        {isUploading ? "Uploading…" : "Upload as private"}
                      </span>
                      <span>↗</span>
                    </button>
                    <button
                      className="secondary-button upload-button"
                      onClick={uploadFacebookVideo}
                      disabled={
                        isUploading ||
                        !hasRealVideo ||
                        !health.facebookConnected
                      }
                    >
                      <span>
                        {isUploading ? "Uploading…" : "Publish to Facebook Page"}
                      </span>
                      <span>↗</span>
                    </button>
                    <button
                      className="primary-button upload-button"
                      onClick={publishBoth}
                      disabled={
                        isUploading ||
                        !hasRealVideo ||
                        !health.youtubeConnected ||
                        !health.facebookConnected
                      }
                    >
                      <span>
                        {isUploading ? "Publishing…" : "Publish to YouTube + Facebook"}
                      </span>
                      <span>↗</span>
                    </button>
                    <p className="upload-footnote">
                      {!health.youtubeConnected
                        ? "Connect the correct YouTube channel to enable upload."
                        : !health.facebookConnected
                          ? "Connect a Facebook Page to publish there too."
                        : !hasRealVideo
                          ? "Generate a real clip or choose an existing video first."
                          : "YouTube stays private; Facebook publishes the Reel immediately."}
                    </p>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function EmptyPreview({ onGenerate }) {
  return (
    <div className="empty-preview">
      <div className="empty-orb">
        <span>✦</span>
      </div>
      <h3>Your scenes will appear here</h3>
      <p>Generate a first preview to see your toy story take shape.</p>
      <button className="secondary-button" onClick={onGenerate}>
        Generate preview <span>✦</span>
      </button>
    </div>
  );
}

function YouTubeSourceView({ url, setUrl, info, isChecking, onCheck, onImportVideo }) {
  return (
    <section className="youtube-source-view card">
      <div className="youtube-source-hero">
        <div>
          <span className="step-label">YOUTUBE SOURCE</span>
          <h2>Import an authorized YouTube video</h2>
          <p>Check the link here, then use the official YouTube Studio download for a video you own or have permission to reuse.</p>
        </div>
        <span className="mode-label live">OFFICIAL WORKFLOW</span>
      </div>

      <div className="youtube-source-layout">
        <div className="youtube-source-form">
          <label className="field-label" htmlFor="youtube-source-url">YouTube video URL</label>
          <div className="youtube-url-row">
            <input
              id="youtube-source-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && url.trim()) onCheck();
              }}
              placeholder="https://www.youtube.com/watch?v=..."
              type="url"
            />
            <button className="primary-button" onClick={onCheck} disabled={isChecking || !url.trim()}>
              {isChecking ? "Checking…" : "Check link"}
            </button>
          </div>
          <small className="youtube-source-hint">Supported links: youtube.com/watch, youtu.be, Shorts, and embed URLs.</small>

          {info && (
            <article className="youtube-source-result">
              <img src={info.thumbnailUrl} alt="" />
              <div>
                <span className="step-label">VIDEO FOUND</span>
                <h3>{info.title}</h3>
                <p>{info.authorName}</p>
                <a href={info.url} target="_blank" rel="noreferrer">Open watch page</a>
              </div>
            </article>
          )}
        </div>

        <div className="youtube-download-guide">
          <span className="step-label">SAFE IMPORT PROCESS</span>
          <h3>Download your own video in Studio</h3>
          <ol>
            <li>Open YouTube Studio and sign in.</li>
            <li>Open Content, choose your video, then select the menu.</li>
            <li>Choose Download, return here, and import the MP4.</li>
          </ol>
          <a className="secondary-button youtube-studio-link" href="https://studio.youtube.com/" target="_blank" rel="noreferrer">Download my video in YouTube Studio</a>
          <label className="local-file-control source-file-control">
            <input type="file" accept="video/mp4,video/quicktime,video/webm" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImportVideo(file); }} />
            <span className="file-icon">▣</span>
            <span>
              <strong>Import downloaded MP4</strong>
              <small>Continue to Khmer audio, captions, or publishing</small>
            </span>
            <span className="file-action">Choose</span>
          </label>
        </div>
      </div>

      <div className="toolchain-note youtube-source-note">
        <span>i</span>
        <p><strong>Important:</strong> this does not download arbitrary YouTube streams. It keeps your workflow inside the official Studio download path for videos you own or are authorized to reuse.</p>
      </div>
    </section>
  );
}

function AiToolchainView({
  health,
  textProviders,
  videoProviders,
  textProvider,
  setTextProvider,
  videoProvider,
  setVideoProvider,
  onOpenComposer,
  onOpenMedia,
  onOpenChannels,
  hasVideo,
}) {
  const mediaReady = Boolean(health.aiProviders?.media?.configured || health.geminiConfigured);
  const publishReady = Boolean(health.youtubeConnected || health.facebookConnected);
  const youtubeLabel = health.youtubeChannel?.title || "YouTube channel not connected";
  const facebookLabel = health.facebookPage?.name || "Facebook Page not connected";
  const plannerReady = Boolean(textProviders.find((provider) => provider.id === textProvider)?.configured);
  const videoReady = videoProvider === "external-upload" || health.geminiConfigured;
  const pipelineSteps = [
    { number: "01", title: "Creative brief", detail: "Prompt and audience", status: "READY", tone: "ready", action: "Open brief", onClick: onOpenComposer },
    { number: "02", title: "Script + metadata", detail: "Title, tags, scene plan", status: plannerReady ? "READY" : "KEY NEEDED", tone: plannerReady ? "ready" : "setup", action: "Open planner", onClick: onOpenComposer },
    { number: "03", title: "Video + sound", detail: "Scenes and audio direction", status: videoReady ? "READY" : "DEMO", tone: videoReady ? "ready" : "demo", action: "Open generator", onClick: onOpenComposer },
    { number: "04", title: "Khmer voice", detail: "Natural Cambodian narration", status: mediaReady ? "READY" : "KEY NEEDED", tone: mediaReady ? "ready" : "setup", action: "Open voice lab", onClick: () => onOpenMedia("dub", "km") },
    { number: "05", title: "Captions + translation", detail: "SRT and translated subtitles", status: mediaReady ? "READY" : "KEY NEEDED", tone: mediaReady ? "ready" : "setup", action: "Open captions", onClick: () => onOpenMedia("translate", "en") },
    { number: "06", title: "Quality review", detail: "Preview, audio, and export", status: hasVideo ? "READY" : "WAITING", tone: hasVideo ? "ready" : "waiting", action: "Review video", onClick: onOpenComposer },
    { number: "07", title: "Publish", detail: "YouTube and Facebook", status: publishReady ? "READY" : "CONNECT", tone: publishReady ? "ready" : "setup", action: "Manage destinations", onClick: onOpenChannels },
  ];
  const completedSteps = pipelineSteps.filter((step) => step.tone === "ready" || step.tone === "demo").length;

  return (
    <section className="toolchain-view card">
      <div className="toolchain-hero">
        <div>
          <span className="step-label">AI TOOLCHAIN</span>
          <h2>One workflow, several AI tools</h2>
          <p>Choose the best tool for each stage, keep the video in one place, and publish when the result is ready.</p>
        </div>
        <span className={`mode-label ${health.geminiConfigured ? "live" : "demo"}`}>
          {health.geminiConfigured ? "LIVE PROVIDERS" : "SETUP NEEDED"}
        </span>
      </div>

      <div className="toolchain-steps" aria-label="AI production steps">
        <span className="toolchain-step active"><b>01</b> Plan</span>
        <i aria-hidden="true">→</i>
        <span className="toolchain-step"><b>02</b> Generate</span>
        <i aria-hidden="true">→</i>
        <span className="toolchain-step"><b>03</b> Localize</span>
        <i aria-hidden="true">→</i>
        <span className="toolchain-step"><b>04</b> Publish</span>
      </div>

      <div className="toolchain-grid">
        <section className="toolchain-card">
          <div className="toolchain-card-icon">✦</div>
          <div className="toolchain-card-heading">
            <div>
              <span className="step-label">01 · PLAN</span>
              <h3>Script & metadata</h3>
            </div>
            <span className="toolchain-status">READY</span>
          </div>
          <p>Create a title, description, tags, scene prompts, and sound directions before you generate.</p>
          <label className="provider-field">
            <span>Planner</span>
            <select value={textProvider} onChange={(event) => setTextProvider(event.target.value)}>
              {textProviders.map((provider) => (
                <option key={provider.id} value={provider.id} disabled={!provider.configured}>
                  {provider.label}{provider.configured ? "" : " · setup needed"}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary-button toolchain-action" onClick={onOpenComposer}>Open story planner</button>
        </section>

        <section className="toolchain-card">
          <div className="toolchain-card-icon coral">◉</div>
          <div className="toolchain-card-heading">
            <div>
              <span className="step-label">02 · GENERATE</span>
              <h3>Video + sound</h3>
            </div>
            <span className={`toolchain-status ${videoProvider === "external-upload" ? "external" : ""}`}>
              {videoProvider === "external-upload" ? "MP4 IMPORT" : health.geminiConfigured ? "READY" : "DEMO"}
            </span>
          </div>
          <p>Use Gemini for synchronized audio directions, or create an MP4 in another AI tool and bring it here.</p>
          <label className="provider-field">
            <span>Video tool</span>
            <select value={videoProvider} onChange={(event) => setVideoProvider(event.target.value)}>
              {videoProviders.map((provider) => (
                <option key={provider.id} value={provider.id} disabled={!provider.configured}>
                  {provider.label}{provider.configured ? "" : " · setup needed"}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary-button toolchain-action" onClick={onOpenComposer}>Open video generator</button>
        </section>

        <section className="toolchain-card">
          <div className="toolchain-card-icon green">♫</div>
          <div className="toolchain-card-heading">
            <div>
              <span className="step-label">03 · LOCALIZE</span>
              <h3>Khmer voice & subtitles</h3>
            </div>
            <span className={`toolchain-status ${mediaReady ? "" : "external"}`}>
              {mediaReady ? "READY" : "KEY NEEDED"}
            </span>
          </div>
          <p>Upload any MP4, create Khmer speech, translate the script, and export a finished video with captions.</p>
          <div className="toolchain-inline-actions">
            <button className="secondary-button" onClick={() => onOpenMedia("both", "km")}>Khmer dubbing</button>
            <button className="secondary-button" onClick={() => onOpenMedia("translate", "en")}>Translate + subtitles</button>
          </div>
        </section>

        <section className="toolchain-card">
          <div className="toolchain-card-icon purple">↗</div>
          <div className="toolchain-card-heading">
            <div>
              <span className="step-label">04 · PUBLISH</span>
              <h3>YouTube & Facebook</h3>
            </div>
            <span className={`toolchain-status ${publishReady ? "" : "external"}`}>
              {publishReady ? "CONNECTED" : "CONNECT"}
            </span>
          </div>
          <p>Keep publishing settings in one place and switch the destination before each upload.</p>
          <div className="toolchain-connections">
            <span><b>YouTube</b>{youtubeLabel}</span>
            <span><b>Facebook</b>{facebookLabel}</span>
          </div>
          <button className="secondary-button toolchain-action" onClick={onOpenChannels}>Manage channels and Pages</button>
        </section>
      </div>

      <section className="process-panel" aria-labelledby="process-panel-title">
        <div className="process-panel-heading">
          <div>
            <span className="step-label">FULL PRODUCTION CHECKLIST</span>
            <h3 id="process-panel-title">Seven steps from idea to upload</h3>
          </div>
          <span className="process-progress-label">{completedSteps} / {pipelineSteps.length} ready</span>
        </div>
        <div className="process-progress" aria-label={`${completedSteps} of ${pipelineSteps.length} steps ready`}>
          <span style={{ width: `${(completedSteps / pipelineSteps.length) * 100}%` }} />
        </div>
        <div className="process-list">
          {pipelineSteps.map((step) => (
            <div className={`process-row ${step.tone}`} key={step.number}>
              <span className="process-number">{step.number}</span>
              <span className="process-check">{step.tone === "ready" ? "✓" : step.tone === "demo" ? "•" : "○"}</span>
              <span className="process-copy">
                <strong>{step.title}</strong>
                <small>{step.detail}</small>
              </span>
              <span className="process-status">{step.status}</span>
              <button className="process-action" onClick={step.onClick}>{step.action}</button>
            </div>
          ))}
        </div>
      </section>

      <div className="toolchain-note">
        <span>i</span>
        <p><strong>How “another AI tool” works:</strong> create the video with that provider, export an MP4, then choose “Use an existing video” in New post. This keeps the workflow reliable without pretending an unconnected provider is already integrated.</p>
      </div>
    </section>
  );
}

const mediaLanguages = [
  { id: "auto", label: "Auto detect" },
  { id: "en", label: "English" },
  { id: "th", label: "Thai" },
  { id: "km", label: "Khmer · ខ្មែរ" },
  { id: "vi", label: "Vietnamese" },
  { id: "zh", label: "Chinese" },
  { id: "ja", label: "Japanese" },
  { id: "ko", label: "Korean" },
  { id: "es", label: "Spanish" },
];

function MediaLabView({
  health,
  mediaFile,
  onSelectFile,
  sourceLanguage,
  setSourceLanguage,
  targetLanguage,
  setTargetLanguage,
  mode,
  setMode,
  voice,
  setVoice,
  transcript,
  setTranscript,
  isProcessing,
  onProcess,
  result,
  onUseForPublishing,
}) {
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState(null);
  const geminiReady = Boolean(health.aiProviders?.media?.configured || health.geminiConfigured);
  const modes = [
    { id: "both", icon: "✦", title: "Dubbing + subtitles", copy: "Translate the voice and burn captions into the MP4." },
    { id: "subtitle", icon: "CC", title: "AI subtitles", copy: "Create timed captions and an SRT download." },
    { id: "translate", icon: "A文", title: "AI translate", copy: "Translate captions into a new language." },
    { id: "dub", icon: "◖", title: "Realistic voice", copy: "Generate a warm Gemini voiceover." },
  ];
  const featureCards = [
    ["◖", "AI Dubbing", "New language voice", "dub"],
    ["CC", "AI Subtitle", "Timed captions", "subtitle"],
    ["A文", "AI Translate", "Natural translation", "translate"],
    ["♬", "Realistic Voice", "Warm narration", "dub"],
  ];
  const isKhmer = targetLanguage === "km";
  useEffect(() => {
    if (!mediaFile) {
      setSourcePreviewUrl(null);
      return undefined;
    }
    const previewUrl = URL.createObjectURL(mediaFile);
    setSourcePreviewUrl(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [mediaFile]);
  return (
    <section className="media-lab card">
      <div className="media-lab-hero">
        <div>
          <span className="step-label">AI MEDIA LAB</span>
          <h2>Dub, subtitle, and translate your video</h2>
          <p>Use one finished MP4, prepare the language track, then send the result to the same YouTube and Facebook publishing flow.</p>
        </div>
        <span className={`mode-label ${geminiReady ? "live" : "demo"}`}>{isKhmer ? "ខ្មែរ READY" : geminiReady ? "GEMINI READY" : "DEMO MODE"}</span>
      </div>

      {isKhmer && (
        <div className="khmer-callout">
          <span className="khmer-callout-mark">ខ្មែរ</span>
          <div><strong>Khmer voice selected</strong><small>Gemini will translate and speak natural Cambodian Khmer.</small></div>
          <span className="khmer-callout-check">✓</span>
        </div>
      )}

      <div className="media-feature-grid">
        {featureCards.map(([icon, title, copy, action]) => (
          <button type="button" className={`media-feature ${mode === action ? "selected" : ""}`} key={title} onClick={() => setMode(action)}>
            <span className="media-feature-icon">{icon}</span>
            <strong>{title}</strong>
            <small>{copy}</small>
            {mode === action && <span className="media-feature-check">✓</span>}
          </button>
        ))}
      </div>

      <div className="media-workflow" aria-label="Media workflow">
        <span className="media-workflow-step active"><b>01</b> Choose video</span>
        <i>→</i>
        <span className={mediaFile ? "media-workflow-step active" : "media-workflow-step"}><b>02</b> Prepare language</span>
        <i>→</i>
        <span className={result ? "media-workflow-step active" : "media-workflow-step"}><b>03</b> Publish result</span>
      </div>

      <div className="media-lab-grid">
        <div className="media-lab-inputs">
          <label className="local-file-control media-file-control">
            <input type="file" accept="video/mp4,video/quicktime,video/webm" onChange={(event) => onSelectFile(event.target.files?.[0] || null)} />
            <span className="file-icon">▣</span>
            <span>
              <strong>{mediaFile ? mediaFile.name : "Choose a video to process"}</strong>
              <small>{mediaFile ? `${(mediaFile.size / 1024 / 1024).toFixed(1)} MB · ready for AI` : "MP4, MOV, or WebM · up to 500 MB"}</small>
            </span>
            <span className="file-action">{mediaFile ? "Change" : "Choose"}</span>
          </label>
          {sourcePreviewUrl && (
            <div className="media-source-preview">
              <div className="media-preview-heading"><span>Original video</span><small>Preview only</small></div>
              <video controls preload="metadata" src={sourcePreviewUrl} />
            </div>
          )}

          <label className="field-label" htmlFor="media-transcript">
            Transcript <span>Optional with Gemini · helpful in demo mode</span>
          </label>
          <textarea
            id="media-transcript"
            className="media-transcript"
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            placeholder="Paste a transcript here, or leave it blank and Gemini will listen to the uploaded video."
          />
        </div>

        <div className="media-lab-settings">
          <label className="provider-field">
            <span>Process</span>
            <select value={mode} onChange={(event) => setMode(event.target.value)}>
              {modes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </label>
          <div className="media-mode-copy">{modes.find((item) => item.id === mode)?.copy}</div>
          <div className="media-language-row">
            <label className="provider-field">
              <span>Source language</span>
              <select value={sourceLanguage} onChange={(event) => setSourceLanguage(event.target.value)}>
                {mediaLanguages.map((language) => <option key={language.id} value={language.id}>{language.label}</option>)}
              </select>
            </label>
            <label className="provider-field">
              <span>Target language</span>
              <select value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)}>
                {mediaLanguages.filter((language) => language.id !== "auto").map((language) => <option key={language.id} value={language.id}>{language.label}</option>)}
              </select>
            </label>
          </div>
          {(mode === "dub" || mode === "both") && (
            <label className="provider-field">
              <span>Voice</span>
              <select value={voice} onChange={(event) => setVoice(event.target.value)}>
                <option value="Kore">Kore · warm</option>
                <option value="Aoede">Aoede · bright</option>
                <option value="Puck">Puck · playful</option>
                <option value="Charon">Charon · calm</option>
              </select>
            </label>
          )}
          <button className="primary-button media-process-button" onClick={onProcess} disabled={isProcessing || !mediaFile}>
            {isProcessing ? "Processing media…" : "Process video"} <span>✦</span>
          </button>
          <small className="media-hint">{targetLanguage === "km" && (mode === "dub" || mode === "both") ? "Khmer voice is generated as natural Cambodian narration." : geminiReady ? "Gemini can transcribe the video, translate it, and create the selected voice track." : "Add GEMINI_API_KEY to enable automatic transcription, translation, and realistic voice."}</small>
        </div>
      </div>

      {result && (
        <div className="media-result">
          <div className="media-result-preview">
            <video controls preload="metadata" src={result.videoUrl} />
          </div>
          <div className="media-result-meta">
            <span className="ready-dot" />
            <strong>Processed video ready</strong>
            <small>{result.captions} caption segments · {result.voice}</small>
          </div>
          <div className="media-result-actions">
            <a className="secondary-button" href={result.videoUrl} target="_blank" rel="noreferrer">Preview MP4 ↗</a>
            <a className="secondary-button" href={result.videoUrl} download>Download MP4</a>
            {result.subtitleUrl && <a className="secondary-button" href={result.subtitleUrl} download>Download SRT</a>}
            <button className="primary-button" onClick={onUseForPublishing}>Use for publishing</button>
          </div>
          {result.warnings?.length > 0 && <p>{result.warnings.join(" ")}</p>}
        </div>
      )}
    </section>
  );
}

function LibraryView({ library, onNew }) {
  return (
    <section className="library-view card">
      <div className="library-top">
        <div>
          <span className="step-label">YOUR WORK</span>
          <h2>Video library</h2>
          <p>Private uploads and finished toy stories stay organized here.</p>
        </div>
        <button className="primary-button" onClick={onNew}>
          Create new <span>✦</span>
        </button>
      </div>
      {library.length === 0 ? (
        <div className="library-empty">
          <div>▤</div>
          <h3>No uploads yet</h3>
          <p>Your generated videos will show up here after a private upload.</p>
        </div>
      ) : (
        <div className="library-list">
          {library.map((item) => (
            <div className="library-item" key={item.id}>
              <div className="library-thumb">▶</div>
              <div>
                <strong>{item.title}</strong>
                <small>
                  {item.status} ·{" "}
                  {new Date(item.createdAt).toLocaleDateString()}
                </small>
              </div>
              {item.url ? (
                <a href={item.url} target="_blank" rel="noreferrer">
                  Open Studio ↗
                </a>
              ) : (
                <span className="library-destination">{item.destination || "Published"}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ChannelView({ health, onSwitch }) {
  return (
    <section className="channel-view card">
      <div className="channel-hero">
        <div className="channel-logo">M</div>
        <div>
          <span className="step-label">CHANNEL SETUP</span>
        <h2>{health.youtubeChannel?.title || "Michael Me"}</h2>
        <p>
          {health.youtubeChannel
            ? `${health.youtubeChannel.handle || "Connected YouTube channel"} · ${health.youtubeChannel.videos} videos`
            : "Set the defaults that keep every upload consistent."}
        </p>
        </div>
      </div>
      <div className="channel-settings">
        <div>
          <span className="setting-icon audience">●</span>
          <div>
            <strong>Made for kids</strong>
            <p>New uploads are prepared with a kids-safe audience setting.</p>
          </div>
          <span className="check-badge">✓ On</span>
        </div>
        <div>
          <span className="setting-icon sparkle-icon">✦</span>
          <div>
            <strong>AI disclosure</strong>
            <p>Generated videos include synthetic-media metadata.</p>
          </div>
          <span className="check-badge">✓ On</span>
        </div>
        <div>
          <span className="setting-icon lock-icon">⌑</span>
          <div>
            <strong>YouTube connection</strong>
            <p>
              {health.youtubeConnected
                ? "Connected and ready for private uploads."
                : health.youtubeError || "Connect from the upload panel to enable uploads."}
            </p>
          </div>
          <span className="check-badge muted">
            {health.youtubeConnected ? "Ready" : "Not connected"}
          </span>
        </div>
        {health.youtubeChannels?.length > 1 && (
          <div className="channel-switch-row">
            <label>
              <strong>Active YouTube channel</strong>
              <select
                value={health.activeYoutubeChannelId || ""}
                onChange={(event) => onSwitch("youtube", event.target.value)}
              >
                {health.youtubeChannels.map((channel) => (
                  <option key={channel.id} value={channel.id}>{channel.title}</option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div>
          <span className="setting-icon facebook-badge">f</span>
          <div>
            <strong>Facebook Page connection</strong>
            <p>
              {health.facebookConnected
                ? `${health.facebookPage?.name || "Connected Page"} · Reel publishing ready.`
                : health.facebookError || "Connect a Page to publish Reels."}
            </p>
          </div>
          <span className="check-badge muted">
            {health.facebookConnected ? "Ready" : "Not connected"}
          </span>
        </div>
        {health.facebookPages?.length > 1 && (
          <div className="channel-switch-row">
            <label>
              <strong>Active Facebook Page</strong>
              <select
                value={health.activeFacebookPageId || ""}
                onChange={(event) => onSwitch("facebook", event.target.value)}
              >
                {health.facebookPages.map((page) => (
                  <option key={page.id} value={page.id}>{page.name}</option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")).render(<App />);
