# Social Media Manager Dashboard

AI-powered social media content creation and LinkedIn publishing platform.

## Features

- **Content Generation**: Create engaging LinkedIn posts using OpenAI GPT
- **Image Generation**: Generate stunning images using Stability AI
- **Audio Generation**: Convert text to speech using ElevenLabs
- **LinkedIn Publishing**: Direct publishing to LinkedIn
- **Preview**: Real-time post preview with audio playback

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables in `.env.local`:
   ```
   OPENAI_API_KEY=your_openai_api_key
   STABILITY_API_KEY=your_stability_api_key
   ELEVENLABS_API_KEY=your_elevenlabs_api_key
   LINKEDIN_ACCESS_TOKEN=your_linkedin_access_token
   LINKEDIN_PERSON_URN=your_linkedin_person_urn
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

1. Enter a prompt or topic for your post
2. Select tone, image style, and voice
3. Click "Generate Content" to create post text
4. Click "Generate Image" to create a visual
5. Click "Generate Audio" to create speech version
6. Edit the generated content if needed
7. Enter LinkedIn credentials
8. Click "Publish to LinkedIn"

## API Endpoints

- `POST /api/generate-content` - Generate post content
- `POST /api/generate-image` - Generate image from prompt
- `GET/POST /api/generate-speech` - Generate speech from text (ElevenLabs)
- `POST /api/publish-linkedin` - Publish to LinkedIn

## Technologies

- Next.js 14
- React
- TypeScript
- Tailwind CSS
- OpenAI API
- Stability AI API
- ElevenLabs API
- LinkedIn API
