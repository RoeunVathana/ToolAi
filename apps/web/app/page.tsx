type ApiStatus = {
  status: "ok" | "offline";
  service: "api";
  architecture: "nestjs" | "express" | "unknown";
  timestamp?: string;
};

const defaultApiUrl = "http://127.0.0.1:8788/api/v1/health";

async function getApiStatus(): Promise<ApiStatus> {
  const endpoint = process.env.TOOLAIME_API_HEALTH_URL || defaultApiUrl;

  try {
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) return { status: "offline", service: "api", architecture: "unknown" };

    const data = (await response.json()) as Partial<ApiStatus>;
    if (data.status !== "ok" || data.service !== "api") {
      return { status: "offline", service: "api", architecture: "unknown" };
    }

    return {
      status: "ok",
      service: "api",
      architecture: data.architecture === "nestjs" || data.architecture === "express" ? data.architecture : "unknown",
      timestamp: data.timestamp,
    };
  } catch {
    return { status: "offline", service: "api", architecture: "unknown" };
  }
}

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const api = await getApiStatus();
  const isOnline = api.status === "ok";

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">TOOLAIME · TYPED WEB BOUNDARY</p>
        <h1>Build original videos in Khmer.</h1>
        <p className="lede">
          This Next.js App Router surface is the first bounded migration slice. The existing Vite dashboard remains the production baseline while typed services are verified one capability at a time.
        </p>
        <div className={`status ${isOnline ? "online" : "offline"}`}>
          <span className="status-dot" />
          {isOnline ? `API online · ${api.architecture}` : "API offline · start the typed API on port 8788"}
        </div>
      </section>

      <section className="grid" aria-label="Migration status">
        <article className="card">
          <span className="card-label">WEB</span>
          <h2>Next.js App Router</h2>
          <p>Server-rendered typed page with an explicit API boundary.</p>
        </article>
        <article className="card">
          <span className="card-label">API</span>
          <h2>NestJS + TypeScript</h2>
          <p>Health contract verified without changing the existing Phase 1 routes.</p>
        </article>
      </section>
    </main>
  );
}
