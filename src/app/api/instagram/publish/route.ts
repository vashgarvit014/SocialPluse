import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { content, imageUrl, videoUrl, mediaUrl, mediaType, accessToken, userId } = await request.json();

    if (!content || !accessToken) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const rawMedia = mediaUrl || videoUrl || imageUrl;
    const resolvedType = mediaType || (videoUrl ? 'video' : imageUrl ? 'image' : null);
    const isVideo = resolvedType === 'video';

    if (isVideo && rawMedia?.startsWith('data:')) {
      return NextResponse.json({ error: 'Instagram video publish requires a public URL (data: URLs are rejected by IG). Upload video to external storage first.' }, { status: 400 });
    }

    // Step 1: Create media container (image vs video)
    const containerBody: Record<string, unknown> = {
      caption: content,
      access_token: accessToken,
    };
    if (isVideo) {
      containerBody.video_url = rawMedia;
      containerBody.media_type = 'VIDEO';
    } else {
      containerBody.image_url = rawMedia?.startsWith('data:') ? undefined : rawMedia || imageUrl?.startsWith('data:') ? undefined : imageUrl,
      containerBody.media_type = undefined;
    }

    const containerResponse = await fetch('https://graph.instagram.com/me/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(containerBody),
    });

    if (!containerResponse.ok) {
      const err = await containerResponse.text();
      console.error('Instagram container error:', err);
      throw new Error('Failed to create media container');
    }

    const containerData = await containerResponse.json();
    const containerId = containerData.id;

    // Step 2: Publish
    const publishResponse = await fetch('https://graph.instagram.com/me/media_publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: accessToken,
      }),
    });

    if (!publishResponse.ok) {
      throw new Error('Failed to publish');
    }

    const publishData = await publishResponse.json();

    return NextResponse.json({
      success: true,
      postId: publishData.id,
      message: 'Post published to Instagram!',
    });
  } catch (error) {
    console.error('Instagram publish error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to publish';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
