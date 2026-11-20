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

async function readApiResponse(response, fallbackMessage) {
  const raw = await response.text();
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const detail = raw.trim();
    if (/^upstream error$/i.test(detail)) {
      return {
        error: `The remote server is temporarily unavailable (HTTP ${response.status}). Please try again in a few seconds.`,
      };
    }
    return {
      error: response.ok
        ? fallbackMessage
        : `${fallbackMessage} (HTTP ${response.status}).`,
    };
  }
}

function App() {
  const [activeNav, setActiveNav] = useState("new");
  const [form, setForm] = useState(initialForm);
  const [duration, setDuration] = useState(60);
  const [sceneCount, setSceneCount] = useState(4);
  const [scenes, setScenes] = useState([]);
  const [storyPlan, setStoryPlan] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [localVideoFile, setLocalVideoFile] = useState(null);
  const [textProvider, setTextProvider] = useState("gemini");
  const [videoProvider, setVideoProvider] = useState("gemini");
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
      const data = await readApiResponse(response, "Video generation failed.");
      if (!response.ok)
        throw new Error(data.error || "Video generation failed.");
      setScenes(data.scenes || []);
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

  async function uploadVideo() {
    if (!scenes.length && !localVideoFile) {
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
        JSON.stringify(scenes.map((scene) => scene.videoUrl).filter(Boolean)),
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
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setIsUploading(false);
    }
  }

  async function uploadFacebookVideo() {
    if (!scenes.length && !localVideoFile) {
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
        JSON.stringify(scenes.map((scene) => scene.videoUrl).filter(Boolean)),
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
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setIsUploading(false);
    }
  }

  async function publishBoth() {
    if (!scenes.length && !localVideoFile) {
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
        JSON.stringify(scenes.map((scene) => scene.videoUrl).filter(Boolean)),
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

  const hasRealVideo = Boolean(localVideoFile || scenes.some((scene) => scene.videoUrl));
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
            <span>New post</span>
            <i>/</i>
            <strong>Generate a video</strong>
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
          <section className="page-heading">
            <div>
              <p className="eyebrow">CREATE A NEW POST</p>
              <h1>
                Turn a toy idea into a <em>YouTube video.</em>
              </h1>
              <p className="heading-copy">
                Describe the playset adventure you want to make. ToyPost turns
                it into a bright, original video that is ready for review.
              </p>
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
                        <div className="preview-meta">
                          <div>
                            <strong>{form.title}</strong>
                            <span>
                              {scenes.length} scenes · {totalDuration}s total
                            </span>
                          </div>
                          <button
                            onClick={() => setScenes([])}
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
