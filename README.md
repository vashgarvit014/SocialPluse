# SocialPulse Platform

AI-powered social media manager that generates content and images, then publishes to social platforms.

## Three Pipelines

### 1. Text-Only Content Generation
**Trigger:** User enters a topic → clicks "Generate Content"

| Component | Details |
|-----------|---------|
| **Model** | `nvidia/nemotron-3.5-lightning-30b-a3b` |
| **API** | NVIDIA Integrate API (`https://integrate.api.nvidia.com/v1/chat/completions`) |
| **Auth** | Bearer token (`NVIDIA_API_KEY`) |
| **Parameters** | `max_tokens: 1500`, `temperature: 0.7`, `chat_template_kwargs: { thinking: false }` |
| **Output** | JSON with `platforms.{linkedin}.caption` (100-150 words), `hashtags` (1 item), `image_prompt` |

---

### 2. Image Upload → Content Generation
**Trigger:** User uploads an image → clicks "Generate Content"

| Component | Details |
|-----------|---------|
| **Model** | `minimaxai/minimax-m3` |
| **API** | NVIDIA Integrate API (`https://integrate.api.nvidia.com/v1/chat/completions`) |
| **Auth** | Bearer token (`NVIDIA_API_KEY`) |
| **Input** | Base64 image + prompt in single multimodal request |
| **Output** | JSON with caption, hashtag, image_prompt based on image analysis |

---

### 3. Text-to-Image Generation
**Trigger:** User enters a prompt → clicks "Generate Image"

| Component | Details |
|-----------|---------|
| **Primary Model** | `vendouple/nano-banana-pro` |
| **Fallback Models** | `flux`, `zimage` |
| **API** | Pollinations (`https://gen.pollinations.ai/v1/images/generations`) |
| **Auth** | Bearer token (`POLLINATIONS_API_KEY`) |
| **Parameters** | `size: 768x768`, `response_format: b64_json`, `n: 1` |
| **Timeout** | 60s per model attempt |
| **Output** | Base64 image data URL (auto-detects PNG/JPEG) |

---

## Tech Stack
- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript
- **Deployment:** Vercel-ready
- **Storage:** Local JSON file for scheduled posts (replace with DB in production)

---

## Environment Variables

Create `.env.local` with:

```env
# NVIDIA (Nemotron + Minimax)
NVIDIA_API_KEY=nvapi-xxxxxxxxxxxxxxxxxxxxxxxx

# Pollinations (Image Generation)
POLLINATIONS_API_KEY=sk_xxxxxxxxxxxxxxxxxxxxxxxx

# LinkedIn OAuth
LINKEDIN_CLIENT_ID=xxxxxxxxxx
LINKEDIN_CLIENT_SECRET=xxxxxxxxxx
LINKEDIN_REDIRECT_URI=http://localhost:3000/api/linkedin/callback

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## Run Locally

```bash
npm install
npm run dev
# Open http://localhost:3000
```

---

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/generate-content` | POST | Generate text content (Pipeline 1 or 2) |
| `/api/generate-image` | POST | Generate image from prompt (Pipeline 3) |
| `/api/scheduler` | GET/POST | List/create scheduled posts |
| `/api/scheduler/check` | GET | Auto-publish due posts |
| `/api/linkedin/auth` | GET | Start LinkedIn OAuth |
| `/api/linkedin/callback` | GET | Handle OAuth callback |
| `/api/linkedin/publish` | POST | Publish to LinkedIn |

---

## Project Structure

```
src/
├── app/
│   ├── page.tsx                    # Main dashboard UI
│   ├── api/
│   │   ├── generate-content/
│   │   │   └── route.ts           # Pipelines 1 & 2
│   │   ├── generate-image/
│   │   │   └── route.ts           # Pipeline 3
│   │   ├── scheduler/
│   │   │   ├── route.ts           # CRUD scheduled posts
│   │   │   └── check/route.ts     # Auto-publish
│   │   └── linkedin/              # OAuth + publish
├── lib/
│   └── image-utils.ts             # Compression, base64 helpers
scheduled-posts.json               # Local storage
```

---

## Notes

- **Nemotron** uses `thinking: false` to disable chain-of-thought (avoids 30s+ latency).
- **Image generation** has automatic fallback: nano-banana-pro → flux → zimage.
- **Only LinkedIn** is active; Instagram/Facebook/Twitter are stubbed for future.
- **Images** are compressed to 1024px JPEG (80%) for API calls; original preserved for preview/publish.
- **Post scheduler** enforces 5-minute minimum buffer from current time.