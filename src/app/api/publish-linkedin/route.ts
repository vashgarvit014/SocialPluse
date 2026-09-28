import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/auth/api';

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    const { content, imageUrl, videoUrl, mediaUrl, mediaType, LinkedInCredentials } = await request.json();

    if (!content) {
      return NextResponse.json(
        { error: 'Content is required' },
        { status: 400 }
      );
    }

    const accessToken = LinkedInCredentials?.accessToken || process.env.LINKEDIN_ACCESS_TOKEN;
    const personUrn = LinkedInCredentials?.personUrn || process.env.LINKEDIN_PERSON_URN;

    if (!accessToken || !personUrn) {
      return NextResponse.json(
        { error: 'LinkedIn credentials not configured' },
        { status: 500 }
      );
    }

    // First, upload the media if provided (image or video)
    let imageUrn: string | null = null;
    let shareMediaCategory: 'IMAGE' | 'VIDEO' | 'NONE' = 'NONE';
    const rawMedia = mediaUrl || videoUrl || imageUrl;
    const resolvedType = mediaType || (videoUrl ? 'video' : imageUrl ? 'image' : null) || (rawMedia?.startsWith('data:video/') ? 'video' : rawMedia?.startsWith('data:image/') ? 'image' : null);
    const isVideo = resolvedType === 'video';
    if (rawMedia && rawMedia.startsWith('data:')) {
      const recipe = isVideo ? 'urn:li:digitalmediaRecipe:feedshare-video' : 'urn:li:digitalmediaRecipe:feedshare-image';
      const uploadResponse = await fetch(
        'https://api.linkedin.com/v2/assets?action=registerUpload',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            registerUploadRequest: {
              recipes: [recipe],
              owner: `urn:li:person:${personUrn}`,
              serviceRelationships: [
                {
                  relationshipType: 'OWNER',
                  identifier: 'urn:li:userGeneratedContent',
                },
              ],
            },
          }),
        }
      );

      if (uploadResponse.ok) {
        const uploadData = await uploadResponse.json();
        imageUrn = uploadData.value.asset;
        shareMediaCategory = isVideo ? 'VIDEO' : 'IMAGE';
        // Note: actual binary upload omitted in legacy path — needs PUT to uploadUrl with binaryData
      }
    }

    // Create the post
    const postPayload: Record<string, unknown> = {
      author: `urn:li:person:${personUrn}`,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: {
            text: content,
          },
          shareMediaCategory,
        },
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
      },
    };

    if (imageUrn) {
      (postPayload.specificContent as Record<string, unknown>)['com.linkedin.ugc.ShareContent'] = {
        ...((postPayload.specificContent as Record<string, unknown>)['com.linkedin.ugc.ShareContent'] as Record<string, unknown>),
        media: [
          {
            status: 'READY',
            media: imageUrn,
          },
        ],
      };
    }

    const postResponse = await fetch('https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(postPayload),
    });

    if (!postResponse.ok) {
      const errorData = await postResponse.json();
      throw new Error(errorData.message || 'Failed to publish post');
    }

    const postData = await postResponse.json();
    
    return NextResponse.json({ 
      success: true, 
      postId: postData.id,
      message: 'Post published successfully to LinkedIn' 
    });
  } catch (error) {
    console.error('Error publishing to LinkedIn:', error);
    return NextResponse.json(
      { error: 'Failed to publish to LinkedIn' },
      { status: 500 }
    );
  }
}
