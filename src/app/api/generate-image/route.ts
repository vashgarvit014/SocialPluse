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

    const callImageAPI = async (model: string): Promise<string | null> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      try {
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
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Pollinations API error (${model}):`, response.status, errorText);
          return null;
        }

        const data = await response.json();
        const imageBase64 = data.data?.[0]?.b64_json;
        if (!imageBase64) return null;
        const mime = imageBase64.startsWith('iVBORw0KGgo') ? 'image/png' : 'image/jpeg';
        console.log(`[Image] Generated with ${model}`);
        return `data:${mime};base64,${imageBase64}`;
      } catch (err) {
        clearTimeout(timer);
        console.error(`[Image] ${model} failed:`, err instanceof Error ? err.message : err);
        return null;
      }
    };

    // Primary: nano-banana-pro; fallbacks in case the model is down
    const imageData =
      await callImageAPI('vendouple/nano-banana-pro') ||
      await callImageAPI('flux') ||
      await callImageAPI('zimage');

    if (!imageData) {
      throw new Error('All image models failed. Please try again.');
    }
    
    return NextResponse.json({ 
      image: imageData,
      success: true 
    });
  } catch (error) {
    console.error('Error generating image:', error);
    return NextResponse.json(
      { error: 'Failed to generate image' },
      { status: 500 }
    );
  }
}