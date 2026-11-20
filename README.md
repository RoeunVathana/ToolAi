# ToyPost Studio

ToyPost Studio is a React + Node starter for generating original toy-playset video scenes with Gemini Omni, rendering audio-ready MP4 files, uploading privately to YouTube, and publishing a Reel to an authorized Facebook Page.

## Run locally

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Open http://localhost:5173.

Without credentials, the app runs in demo mode so the interface can be explored safely. Demo scenes cannot be uploaded. To generate real clips, add `GEMINI_API_KEY` to `.env`. Normal Gemini (`GEMINI_TEXT_MODEL`) first creates the story plan and metadata; Gemini Omni (`GEMINI_VIDEO_MODEL`) then creates the video scenes with sound directions. To enable YouTube uploads, add `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, and complete the one-time OAuth connection from the upload panel.

You can also choose an existing MP4, MOV, or WebM in the upload panel. This is useful when a video was generated outside ToyPost or when you want to review a manually edited cut. The destination buttons stay disabled until a real video and the matching verified channel/Page are available.

## Railway YouTube setup

In the Railway service Variables tab, add:

```text
GEMINI_API_KEY=your-Gemini-key
YT_CLIENT_ID=your-Google-OAuth-client-id
YT_CLIENT_SECRET=your-Google-OAuth-client-secret
YT_REDIRECT_URI=https://toolyoutubeandfacebookpage-production.up.railway.app/api/auth/youtube/callback
```

In Google Cloud, register the same `YT_REDIRECT_URI` as an authorized redirect URI. After saving the Railway variables and redeploying, use Connect YouTube in the app. Never commit these values to the repository or paste them into chat.

The upload defaults are intentionally prefilled for this channel concept: Made for kids, altered/synthetic content disclosed, Entertainment category, and private visibility on YouTube. API keys and refresh tokens stay server-side in `.env`. Add `APP_TOKEN_ENCRYPTION_KEY` if you want OAuth tokens to survive restarts in encrypted local storage.

## Facebook Page setup

Create a Meta app with Facebook Login, add the Facebook Login valid OAuth redirect URI below, and add these Railway variables:

```text
FB_APP_ID=your-Meta-app-id
FB_APP_SECRET=your-Meta-app-secret
FB_LOGIN_CONFIG_ID=your-Facebook-Login-for-Business-configuration-id
FB_REDIRECT_URI=https://toolyoutubeandfacebookpage-production.up.railway.app/api/auth/facebook/callback
FB_GRAPH_VERSION=v27.0
```

The Facebook connection uses a Facebook Login for Business configuration. Create a configuration with a User access token and the Page permissions `pages_show_list`, `pages_read_engagement`, and `pages_manage_posts`, then set its ID as `FB_LOGIN_CONFIG_ID`. The app stores the returned Page token encrypted on the server and publishes vertical videos through the Facebook Reels upload flow (`/video_reels`) with the AI disclosure flag. Meta may require App Review for these permissions outside your own app roles.

For a direct Page-token setup instead of OAuth, set `FB_PAGE_ID`, `FB_PAGE_ACCESS_TOKEN`, and optionally `FB_PAGE_NAME`. The Reel renderer outputs 1080×1920 H.264/AAC video with 48 kHz stereo audio. YouTube receives a 1280×720 version and stays private until you review it.
