import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { prompt, style, size } = await request.json();

    if (!prompt) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }

    // Map style to enhance the prompt
    const styleMap: Record<string, string> = {
      'photographic': 'photorealistic, high quality photography, detailed',
      'digital-art': 'digital art, vibrant colors, illustration',
      'cinematic': 'cinematic lighting, dramatic, movie quality',
      'anime': 'anime style, Japanese animation, colorful',
    };

    const styleText = styleMap[style as keyof typeof styleMap] || styleMap['photographic'];
    const enhancedPrompt = `${prompt}, ${styleText}`;
    
    const width = size?.width || 768;
    const height = size?.height || 768;

    // Use Pollinations authenticated API with user's API key
    const apiKey = process.env.POLLINATIONS_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Pollinations API key not configured' },
        { status: 500 }
      );
    }

    const callImageAPI = async (model: string): Promise<{ image?: string; blocked?: boolean }> => {
      try {
        console.log(`[Image] Calling ${model} via POST (size: ${width}x${height}, no timeout)...`);
        const response = await fetch('https://gen.pollinations.ai/v1/images/generations', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt: enhancedPrompt,
            model,
            size: `${width}x${height}`,
            response_format: 'b64_json',
            n: 1,
          }),
        });
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[Image] ${model} failed: ${response.status} - ${errorText.slice(0, 300)}`);
          // Azure's content-safety filter rejects gibberish/vague prompts with
          // a 400. Retrying the same words never works - surface it distinctly
          // so the UI can explain that instead of a generic "unavailable".
          if (response.status === 400 && /safety system/i.test(errorText)) {
            return { blocked: true };
          }
          return {};
        }
        const data = await response.json();
        const imageBase64 = data.data?.[0]?.b64_json;
        if (!imageBase64) { console.error(`[Image] ${model} returned no b64`); return {}; }
        const mime = imageBase64.startsWith('iVBORw0KGgo') ? 'image/png' : 'image/jpeg';
        console.log(`[Image] Generated with ${model} ✅ ${Math.round(imageBase64.length/1024)}KB`);
        return { image: `data:${mime};base64,${imageBase64}` };
      } catch (err) {
        console.error(`[Image] ${model} failed:`, err instanceof Error ? err.message : err);
        return {};
      }
    };

    const PRIMARY_MODEL = 'gpt-image-2'; // Only model — no fallback, no timeout limit (user requested)

    const primaryImage = await callImageAPI(PRIMARY_MODEL);

    if (primaryImage.image) {
      return NextResponse.json({ image: primaryImage.image, success: true, model: PRIMARY_MODEL });
    }

    if (primaryImage.blocked) {
      return NextResponse.json(
        {
          error: {
            code: 'IMAGE_SAFETY_BLOCKED',
            message: 'The image model refused this prompt (content-safety filter). Use a clear, descriptive sentence — retrying the same words will be blocked again.',
          },
          model: PRIMARY_MODEL,
        },
        { status: 422 }
      );
    }

    return NextResponse.json(
      {
        error: 'generation_failed',
        model: PRIMARY_MODEL,
        message: `${PRIMARY_MODEL} is currently unavailable. Please try again in a moment — no fallback will be used (hold).`,
      },
      { status: 503 }
    );
  } catch (error) {
    console.error('Error generating image:', error);
    return NextResponse.json(
      { error: 'Failed to generate image' },
      { status: 500 }
    );
  }
}