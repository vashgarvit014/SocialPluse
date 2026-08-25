import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { content, imageUrl, accessToken, userId } = await request.json();

    if (!content || !accessToken || !userId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    let imageUrn = null;

    if (imageUrl && imageUrl.startsWith('data:')) {
      const base64Data = imageUrl.split(',')[1];
      const binaryData = Buffer.from(base64Data, 'base64');
      
      const registerResponse = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          registerUploadRequest: {
            recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
            owner: `urn:li:person:${userId}`,
            serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }],
          },
        }),
      });

      if (registerResponse.ok) {
        const registerData = await registerResponse.json();
        const uploadUrl = registerData.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
        imageUrn = registerData.value.asset;

        await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/octet-stream',
          },
          body: binaryData,
        });
      }
    }

    const postPayload: Record<string, unknown> = {
      author: `urn:li:person:${userId}`,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: content },
          shareMediaCategory: imageUrn ? 'IMAGE' : 'NONE',
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    };

    if (imageUrn) {
      (postPayload.specificContent as Record<string, unknown>)['com.linkedin.ugc.ShareContent'] = {
        ...((postPayload.specificContent as Record<string, unknown>)['com.linkedin.ugc.ShareContent'] as Record<string, unknown>),
        media: [{ status: 'READY', media: imageUrn }],
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
      const errorData = await postResponse.text();
      console.error('LinkedIn post failed:', errorData);
      throw new Error('Failed to create post');
    }

    const postData = await postResponse.json();
    
    return NextResponse.json({ 
      success: true, 
      postId: postData.id,
      message: 'Post published to LinkedIn!' 
    });
  } catch (error) {
    console.error('LinkedIn publish error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to publish';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
