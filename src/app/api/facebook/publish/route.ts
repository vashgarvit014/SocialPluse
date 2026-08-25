import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { content, imageUrl, accessToken, userId } = await request.json();

    if (!content || !accessToken) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const postData: Record<string, unknown> = {
      message: content,
      access_token: accessToken,
    };

    if (imageUrl && !imageUrl.startsWith('data:')) {
      postData.link = imageUrl;
    }

    const postResponse = await fetch(
      `https://graph.facebook.com/v18.0/me/feed`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postData),
      }
    );

    if (!postResponse.ok) {
      const err = await postResponse.text();
      console.error('Facebook post error:', err);
      throw new Error('Failed to create post');
    }

    const postDataResult = await postResponse.json();

    return NextResponse.json({
      success: true,
      postId: postDataResult.id,
      message: 'Post published to Facebook!',
    });
  } catch (error) {
    console.error('Facebook publish error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to publish';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
