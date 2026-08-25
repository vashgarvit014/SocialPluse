import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { content, imageUrl, LinkedInCredentials } = await request.json();

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

    // First, upload the image if provided
    let imageUrn = null;
    if (imageUrl) {
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
              recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
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
          shareMediaCategory: imageUrn ? 'IMAGE' : 'NONE',
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
