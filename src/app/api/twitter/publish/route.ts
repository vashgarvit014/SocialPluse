import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { content, accessToken, videoUrl, mediaUrl, mediaType, imageUrl } = await request.json();

    if (!content || !accessToken) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const rawMedia = mediaUrl || videoUrl || imageUrl;
    const resolvedType = mediaType || (videoUrl ? 'video' : imageUrl ? 'image' : null);
    if (resolvedType === 'video' && rawMedia?.startsWith('data:')) {
      console.warn('Twitter publish: data: video not supported, requires upload to Twitter media endpoint — publishing text only');
    }

    const postResponse = await fetch('https://api.twitter.com/2/tweets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        text: content.substring(0, 280),
      }),
    });

    if (!postResponse.ok) {
      const err = await postResponse.text();
      console.error('Twitter post error:', err);
      throw new Error('Failed to create tweet');
    }

    const postData = await postResponse.json();

    return NextResponse.json({
      success: true,
      postId: postData.data?.id,
      message: 'Tweet published!',
    });
  } catch (error) {
    console.error('Twitter publish error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to publish';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
