'use client';

import { useState, useEffect, useRef } from 'react';

interface SocialAccount {
  platform: string;
  connected: boolean;
  name: string;
  email: string;
  accessToken: string;
  userId: string;
}

const platformColors: Record<string, string> = {
  linkedin: '#0A66C2',
  instagram: '#E1306C',
  facebook: '#1877F2',
  twitter: '#000000',
};

const platformInitials: Record<string, string> = {
  linkedin: 'LI',
  instagram: 'IG',
  facebook: 'FB',
  twitter: 'TW',
};

export default function SocialMediaManager() {
  const [prompt, setPrompt] = useState('');
  const [content, setContent] = useState('');
  const [generatedImage, setGeneratedImage] = useState('');
  const [isGeneratingContent, setIsGeneratingContent] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [tone, setTone] = useState('Professional');
  const [imageStyle, setImageStyle] = useState('Photographic');
  const [publishResult, setPublishResult] = useState('');
  const [publishResultType, setPublishResultType] = useState<'success' | 'error'>('success');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [showToast, setShowToast] = useState(false);
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);
  const [editorTab, setEditorTab] = useState<'edit' | 'preview'>('preview');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [scheduledPosts, setScheduledPosts] = useState<Array<{ id: string; content: string; platforms: string[]; scheduledAt: string; status: string }>>([]);
  const [isScheduling, setIsScheduling] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const topicFileInputRef = useRef<HTMLInputElement>(null);
  const [platformContent, setPlatformContent] = useState<Record<string, { caption: string; hashtags: string[] }>>({});
  const [imagePrompt, setImagePrompt] = useState('');
  const [activePreviewPlatform, setActivePreviewPlatform] = useState('');
  const [generationError, setGenerationError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  const contentMessages = [
    'Analyzing your image with AI vision...',
    'Understanding the visual context...',
    'Crafting platform-specific captions...',
    'Generating relevant hashtags...',
    'Polishing your content...',
    'Almost there, finalizing...',
  ];

  const imageMessages = [
    'Sending your prompt to the image generator...',
    'AI is painting your vision...',
    'Rendering pixels into art...',
    'Adding finishing touches...',
    'Almost ready...',
  ];

  useEffect(() => {
    if (!isGeneratingContent && !isGeneratingImage) {
      setStatusMessage('');
      return;
    }
    const messages = isGeneratingContent ? contentMessages : imageMessages;
    let idx = 0;
    setStatusMessage(messages[0]);
    const interval = setInterval(() => {
      idx = (idx + 1) % messages.length;
      setStatusMessage(messages[idx]);
    }, 4000);
    return () => clearInterval(interval);
  }, [isGeneratingContent, isGeneratingImage]);

  useEffect(() => {
    const saved = localStorage.getItem('socialAccounts');
    if (saved) {
      try { setAccounts(JSON.parse(saved)); } catch { /* ignore */ }
    }

    const params = new URLSearchParams(window.location.search);
    const platform = params.get('platform');
    const connected = params.get('connected');
    const name = params.get('name');
    const email = params.get('email');
    const accessToken = params.get('access_token');
    const userId = params.get('user_id');
    const error = params.get('error');

    if (error) {
      setPublishResult(`Connection failed: ${error}`);
      setPublishResultType('error');
      setShowToast(true);
      window.history.replaceState({}, '', '/social-media-manager');
      setTimeout(() => setShowToast(false), 4000);
    } else if (platform && connected === 'true' && accessToken) {
      const newAccount: SocialAccount = {
        platform,
        connected: true,
        name: name || platform,
        email: email || '',
        accessToken,
        userId: userId || '',
      };
      setAccounts(prev => {
        const filtered = prev.filter(a => a.platform !== platform);
        const updated = [...filtered, newAccount];
        localStorage.setItem('socialAccounts', JSON.stringify(updated));
        return updated;
      });
      setPublishResult(`${platform.charAt(0).toUpperCase() + platform.slice(1)} connected successfully!`);
      setPublishResultType('success');
      setShowToast(true);
      window.history.replaceState({}, '', '/social-media-manager');
      setTimeout(() => setShowToast(false), 4000);
    }
  }, []);

  const loadScheduledPosts = async () => {
    try {
      const res = await fetch('/api/scheduler');
      const data = await res.json();
      setScheduledPosts(data.posts?.filter((p: { status: string }) => p.status === 'pending') || []);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    loadScheduledPosts();
    const interval = setInterval(async () => {
      try {
        await fetch('/api/scheduler/check', { method: 'POST' });
        loadScheduledPosts();
      } catch { /* ignore */ }
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const schedulePost = async () => {
    if (!content.trim() || !scheduleDate || !scheduleTime) return;

    const scheduledTime = new Date(`${scheduleDate}T${scheduleTime}`);
    const minTime = new Date(Date.now() + 5 * 60 * 1000);
    if (scheduledTime <= minTime) {
      setPublishResult('Schedule time must be at least 5 minutes from now');
      setPublishResultType('error');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 4000);
      return;
    }

    const connectedSelected = selectedPlatforms.filter(p =>
      accounts.some(a => a.platform === p && a.connected)
    );
    if (connectedSelected.length === 0) {
      setPublishResult('No connected platforms selected');
      setPublishResultType('error');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 4000);
      return;
    }

    setIsScheduling(true);
    try {
      const scheduledAt = scheduledTime.toISOString();
      const accountsData = connectedSelected.map(p => {
        const acc = accounts.find(a => a.platform === p && a.connected)!;
        return { platform: p, accessToken: acc.accessToken, userId: acc.userId };
      });

      const res = await fetch('/api/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          imageUrl: generatedImage,
          platforms: connectedSelected,
          accounts: accountsData,
          scheduledAt,
        }),
      });

      if (res.ok) {
        setPublishResult(`Post scheduled for ${new Date(scheduledAt).toLocaleString()}`);
        setPublishResultType('success');
        setScheduleDate('');
        setScheduleTime('');
        loadScheduledPosts();
      } else {
        setPublishResult('Failed to schedule post');
        setPublishResultType('error');
      }
    } catch {
      setPublishResult('Failed to schedule post');
      setPublishResultType('error');
    }
    setShowToast(true);
    setIsScheduling(false);
    setTimeout(() => setShowToast(false), 4000);
  };

  const cancelScheduled = async (id: string) => {
    try {
      await fetch('/api/scheduler', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      loadScheduledPosts();
    } catch { /* ignore */ }
  };

  const connectPlatform = (platform: string) => {
    window.location.href = `/api/${platform}/auth`;
  };

  const disconnectPlatform = (platform: string) => {
    setAccounts(prev => {
      const updated = prev.filter(a => a.platform !== platform);
      localStorage.setItem('socialAccounts', JSON.stringify(updated));
      return updated;
    });
  };

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(platform) ? prev.filter(p => p !== platform) : [...prev, platform]
    );
  };

  const generateContent = async () => {
    if (!prompt.trim() && !generatedImage) {
      setGenerationError('Please enter a topic or attach an image before generating.');
      return;
    }
    if (selectedPlatforms.length === 0) {
      setGenerationError('Please select at least one platform before generating.');
      return;
    }
    setGenerationError('');
    setIsGeneratingContent(true);
    setPlatformContent({});
    setContent('');
    const originalImage = generatedImage;
    setImagePrompt('');
    try {
      const imageDataForAPI = originalImage ? await getCompressedForAPI(originalImage) : undefined;
      const res = await fetch('/api/generate-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, tone, platforms: selectedPlatforms, hasImage: !!originalImage, imageData: imageDataForAPI }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate content');
      }
      if (!data.platforms || typeof data.platforms !== 'object') {
        throw new Error('Invalid response from AI. Please try again.');
      }
      setPlatformContent(data.platforms);
      setImagePrompt(data.image_prompt || '');
      const firstPlatform = selectedPlatforms[0];
      if (data.platforms[firstPlatform]) {
        setContent(data.platforms[firstPlatform].caption + '\n\n' + (data.platforms[firstPlatform].hashtags || []).map((t: string) => `#${t}`).join(' '));
        setActivePreviewPlatform(firstPlatform);
      }
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : 'Failed to generate content');
    }
    setIsGeneratingContent(false);
  };

  const generateImageFromPrompt = async (promptText: string) => {
    setIsGeneratingImage(true);
    try {
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptText, style: imageStyle }),
      });
      const data = await res.json();
      if (data.image) {
        setGeneratedImage(data.image);
      } else {
        console.error('Image generation returned no image');
      }
    } catch {
      console.error('Image generation failed');
    }
    setIsGeneratingImage(false);
  };

  const generateImage = async () => {
    const promptText = imagePrompt || content.trim().split('\n')[0].substring(0, 200) || prompt.trim();
    if (!promptText) return;
    await generateImageFromPrompt(promptText);
  };

  const handleUploadImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setGeneratedImage(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const getCompressedForAPI = (dataUrl: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX = 1024;
        let w = img.width;
        let h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = dataUrl;
    });
  };

  const [dragOverTopic, setDragOverTopic] = useState(false);
  const [dragOverPreview, setDragOverPreview] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => setGeneratedImage(reader.result as string);
      reader.readAsDataURL(file);
    }
    setDragOverTopic(false);
    setDragOverPreview(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const switchPreviewPlatform = (platform: string) => {
    setActivePreviewPlatform(platform);
    if (platformContent[platform]) {
      setContent(platformContent[platform].caption + '\n\n' + (platformContent[platform].hashtags || []).map((t: string) => `#${t}`).join(' '));
    }
  };

  const publishToAll = async () => {
    const connectedSelected = selectedPlatforms.filter(p =>
      accounts.some(a => a.platform === p && a.connected)
    );
    if (connectedSelected.length === 0) {
      setPublishResult('No connected platforms selected');
      setPublishResultType('error');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 4000);
      return;
    }

    setIsPublishing(true);
    const results: string[] = [];
    let hasError = false;

    for (const platform of connectedSelected) {
      const account = accounts.find(a => a.platform === platform && a.connected);
      // Use platform-specific content if available
      const platformData = platformContent[platform];
      const publishContent = platformData
        ? platformData.caption + '\n\n' + (platformData.hashtags || []).map((t: string) => `#${t}`).join(' ')
        : content;
      try {
        const res = await fetch(`/api/${platform}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: publishContent,
            imageUrl: generatedImage,
            accessToken: account?.accessToken,
            userId: account?.userId,
          }),
        });
        if (res.ok) {
          results.push(`${platform}: Success`);
        } else {
          const err = await res.json().catch(() => ({}));
          results.push(`${platform}: ${err.error || 'Failed'}`);
          hasError = true;
        }
      } catch {
        results.push(`${platform}: Error`);
        hasError = true;
      }
    }

    setPublishResult(results.join(' | '));
    setPublishResultType(hasError ? 'error' : 'success');
    setShowToast(true);
    setIsPublishing(false);
    setTimeout(() => setShowToast(false), 5000);
  };

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const charCount = content.length;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif', backgroundColor: '#f1f5f9' }}>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideInRight { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        textarea:focus, select:focus, input:focus { border-color: #6366f1 !important; box-shadow: 0 0 0 3px rgba(99,102,241,0.12) !important; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #f1f5f9; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
      `}</style>

      {/* Sidebar */}
      <aside style={{ width: '260px', backgroundColor: '#0f172a', color: '#fff', display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'fixed', height: '100vh', zIndex: 10, boxShadow: '4px 0 24px rgba(0,0,0,0.15)' }}>
        <div style={{ padding: '24px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg, #6366f1, #a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 700 }}>SP</div>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '-0.02em' }}>SocialPulse</div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '1px' }}>Content Manager</div>
          </div>
        </div>

        <nav style={{ flex: 1, padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={{ padding: '0 16px', marginBottom: '10px', fontSize: '10px', fontWeight: 600, color: '#475569', textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>Main</div>
          {[
            { icon: '📊', label: 'Dashboard', active: true },
            { icon: '✏️', label: 'Content Studio', active: false },
            { icon: '📅', label: 'Scheduler', active: false },
            { icon: '📈', label: 'Analytics', active: false },
          ].map(item => (
            <button
              key={item.label}
              style={{
                padding: '11px 16px', borderRadius: '8px', fontSize: '13px', color: item.active ? '#fff' : '#94a3b8',
                cursor: 'pointer', border: 'none', background: item.active ? 'rgba(99,102,241,0.15)' : 'transparent',
                display: 'flex', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'left',
                fontFamily: 'inherit', transition: 'all 0.2s',
              }}
              onMouseEnter={e => { if (!item.active) { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#e2e8f0'; } }}
              onMouseLeave={e => { if (!item.active) { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#94a3b8'; } }}
            >
              <span style={{ fontSize: '16px' }}>{item.icon}</span> {item.label}
            </button>
          ))}

          <div style={{ padding: '0 16px', marginTop: '20px', marginBottom: '10px', fontSize: '10px', fontWeight: 600, color: '#475569', textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>Tools</div>
          {[
            { icon: '🖼️', label: 'Media Library' },
            { icon: '💡', label: 'Ideas Bank' },
            { icon: '⚙️', label: 'Settings' },
          ].map(item => (
            <button
              key={item.label}
              style={{
                padding: '11px 16px', borderRadius: '8px', fontSize: '13px', color: '#94a3b8',
                cursor: 'pointer', border: 'none', background: 'transparent',
                display: 'flex', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'left',
                fontFamily: 'inherit', transition: 'all 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#e2e8f0'; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#94a3b8'; }}
            >
              <span style={{ fontSize: '16px' }}>{item.icon}</span> {item.label}
            </button>
          ))}
        </nav>

        <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 600 }}>A</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: 500 }}>Admin</div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>Free Plan</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div style={{ flex: 1, marginLeft: '260px', display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        {/* Top Bar */}
        <header style={{
          height: '64px', background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px',
          color: '#fff', boxShadow: '0 2px 16px rgba(99,102,241,0.25)', position: 'sticky', top: 0, zIndex: 5,
        }}>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 600, letterSpacing: '-0.01em' }}>Content Studio</div>
            <div style={{ fontSize: '12px', opacity: 0.8, marginTop: '2px' }}>Create, edit, and publish your content</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <div style={{ fontSize: '13px', opacity: 0.8 }}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</div>
            <div style={{
              width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px',
              fontWeight: 600, cursor: 'pointer', transition: 'background 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.3)'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.2)'; }}
            >A</div>
          </div>
        </header>

        {/* Dashboard Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr 340px', gap: '24px', padding: '24px 32px', flex: 1, alignItems: 'start' }}>

          {/* Left Panel - Controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Topic Input */}
            <div style={{ backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px' }}>💡</span>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>Topic & Idea</span>
              </div>
              <div
                style={{
                  padding: '20px',
                  border: dragOverTopic ? '2px dashed #6366f1' : '2px dashed transparent',
                  borderRadius: dragOverTopic ? '10px' : '0',
                  backgroundColor: dragOverTopic ? '#eef2ff' : 'transparent',
                  transition: 'all 0.2s',
                }}
                onDragOver={handleDragOver}
                onDragEnter={e => { e.preventDefault(); setDragOverTopic(true); }}
                onDragLeave={e => { e.preventDefault(); setDragOverTopic(false); }}
                onDrop={handleDrop}
              >
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#64748b', marginBottom: '8px', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>What&apos;s your post about?</label>
                <textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder="e.g., 5 tips for boosting productivity in remote work..."
                  style={{
                    width: '100%', minHeight: '100px', padding: '12px 14px', border: '2px solid #e2e8f0', borderRadius: '10px',
                    fontSize: '13px', lineHeight: 1.6, color: '#0f172a', backgroundColor: '#fafbfc',
                    fontFamily: 'system-ui, -apple-system, sans-serif', resize: 'vertical', outline: 'none',
                  }}
                />
                <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button
                    onClick={() => topicFileInputRef.current?.click()}
                    style={{
                      padding: '8px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 500,
                      border: '2px dashed #d1d5db', backgroundColor: '#fafbfc', color: '#64748b',
                      cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s',
                      display: 'flex', alignItems: 'center', gap: '6px',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.color = '#6366f1'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.color = '#64748b'; }}
                  >
                    <span>📎</span> Attach media
                  </button>
                  {generatedImage && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <img src={generatedImage} alt="Attached" style={{ width: '36px', height: '36px', borderRadius: '6px', objectFit: 'cover', border: '1px solid #e2e8f0' }} />
                      <button
                        onClick={() => setGeneratedImage('')}
                        style={{
                          width: '20px', height: '20px', borderRadius: '50%', backgroundColor: '#fee2e2',
                          color: '#dc2626', border: 'none', cursor: 'pointer', fontSize: '12px',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >×</button>
                    </div>
                  )}
                </div>
                <input
                  ref={topicFileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleUploadImage}
                  style={{ display: 'none' }}
                />
              </div>
            </div>

            {/* Tone Selector */}
            <div style={{ backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px' }}>🎨</span>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>Content Settings</span>
              </div>
              <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#64748b', marginBottom: '8px', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Tone</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    {['Professional', 'Casual', 'Inspirational', 'Educational'].map(t => (
                      <button
                        key={t}
                        onClick={() => setTone(t)}
                        style={{
                          padding: '10px 8px', borderRadius: '8px', fontSize: '12px', fontWeight: 500,
                          border: tone === t ? '2px solid #6366f1' : '2px solid #e2e8f0',
                          backgroundColor: tone === t ? '#eef2ff' : '#fafbfc',
                          color: tone === t ? '#6366f1' : '#475569',
                          cursor: 'pointer', transition: 'all 0.2s', fontFamily: 'inherit',
                        }}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#64748b', marginBottom: '8px', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Image Style</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    {['Photographic', 'Digital Art', 'Cinematic', 'Anime'].map(s => (
                      <button
                        key={s}
                        onClick={() => setImageStyle(s)}
                        style={{
                          padding: '10px 8px', borderRadius: '8px', fontSize: '12px', fontWeight: 500,
                          border: imageStyle === s ? '2px solid #6366f1' : '2px solid #e2e8f0',
                          backgroundColor: imageStyle === s ? '#eef2ff' : '#fafbfc',
                          color: imageStyle === s ? '#6366f1' : '#475569',
                          cursor: 'pointer', transition: 'all 0.2s', fontFamily: 'inherit',
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Generate Buttons */}
            <div style={{ backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px' }}>⚡</span>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>Generate</span>
              </div>
              <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button
                  onClick={generateContent}
                  disabled={isGeneratingContent || (!prompt.trim() && !generatedImage) || selectedPlatforms.length === 0}
                  style={{
                    padding: '12px 20px', borderRadius: '10px', fontSize: '13px', fontWeight: 600, border: 'none',
                    background: isGeneratingContent || (!prompt.trim() && !generatedImage) || selectedPlatforms.length === 0 ? '#c7d2fe' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    color: '#fff', cursor: isGeneratingContent || (!prompt.trim() && !generatedImage) || selectedPlatforms.length === 0 ? 'not-allowed' : 'pointer',
                    boxShadow: isGeneratingContent || (!prompt.trim() && !generatedImage) || selectedPlatforms.length === 0 ? 'none' : '0 2px 8px rgba(99,102,241,0.3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    fontFamily: 'inherit', transition: 'all 0.2s',
                    transform: hoveredBtn === 'gen' && !isGeneratingContent ? 'translateY(-1px)' : 'none',
                  }}
                  onMouseEnter={() => !isGeneratingContent && setHoveredBtn('gen')}
                  onMouseLeave={() => setHoveredBtn(null)}
                >
                  {isGeneratingContent ? (
                    <><span style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /> Generating...</>
                  ) : (
                    <><span>✨</span> Generate Content</>
                  )}
                </button>

                <button
                  onClick={generateImage}
                  disabled={isGeneratingImage || !content.trim()}
                  style={{
                    padding: '12px 20px', borderRadius: '10px', fontSize: '13px', fontWeight: 600, border: '2px solid #e2e8f0',
                    backgroundColor: isGeneratingImage || !content.trim() ? '#f8fafc' : '#fff',
                    color: isGeneratingImage || !content.trim() ? '#94a3b8' : '#6366f1',
                    cursor: isGeneratingImage || !content.trim() ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    fontFamily: 'inherit', transition: 'all 0.2s',
                    transform: hoveredBtn === 'img' && !isGeneratingImage ? 'translateY(-1px)' : 'none',
                  }}
                  onMouseEnter={() => !isGeneratingImage && setHoveredBtn('img')}
                  onMouseLeave={() => setHoveredBtn(null)}
                >
                  {isGeneratingImage ? (
                    <><span style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid #c7d2fe', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /> Generating Image...</>
                  ) : (
                    <><span>🖼️</span> Generate Image</>
                  )}
                </button>
              </div>
            </div>
          </div>
          <div style={{ backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px' }}>📝</span>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>Content</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                  <span style={{ fontWeight: 600, color: '#6366f1' }}>{charCount}</span> chars
                </span>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                  <span style={{ fontWeight: 600, color: '#6366f1' }}>{wordCount}</span> words
                </span>
              </div>
            </div>

            {/* Error banner */}
            {generationError && (
              <div style={{ padding: '12px 20px', backgroundColor: '#fef2f2', borderBottom: '1px solid #fecaca', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px', color: '#dc2626' }}>⚠️</span>
                <span style={{ fontSize: '13px', color: '#991b1b', flex: 1 }}>{generationError}</span>
                <button onClick={() => setGenerationError('')} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '16px', padding: 0, lineHeight: 1 }}>×</button>
              </div>
            )}

            {/* Platform preview tabs */}
            {Object.keys(platformContent).length > 0 && (
              <div style={{ display: 'flex', borderBottom: '1px solid #f1f5f9', overflowX: 'auto' }}>
                {Object.keys(platformContent).map(platform => (
                  <button
                    key={platform}
                    onClick={() => switchPreviewPlatform(platform)}
                    style={{
                      padding: '10px 16px', fontSize: '12px', fontWeight: 600, border: 'none', whiteSpace: 'nowrap',
                      borderBottom: activePreviewPlatform === platform ? `2px solid ${platformColors[platform] || '#6366f1'}` : '2px solid transparent',
                      backgroundColor: activePreviewPlatform === platform ? '#fafbfc' : '#fff',
                      color: activePreviewPlatform === platform ? (platformColors[platform] || '#6366f1') : '#64748b',
                      cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s', textTransform: 'capitalize' as const,
                    }}
                  >
                    {platform}
                  </button>
                ))}
                <button
                  onClick={() => setEditorTab('edit')}
                  style={{
                    padding: '10px 16px', fontSize: '12px', fontWeight: 600, border: 'none',
                    borderBottom: editorTab === 'edit' ? '2px solid #6366f1' : '2px solid transparent',
                    backgroundColor: editorTab === 'edit' ? '#fafbfc' : '#fff',
                    color: editorTab === 'edit' ? '#6366f1' : '#64748b',
                    cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s',
                  }}
                >
                  Edit
                </button>
              </div>
            )}

            <div style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
              {isGeneratingContent ? (
                <div style={{
                  flex: 1, minHeight: '400px', padding: '20px', border: '2px solid #c7d2fe',
                  borderRadius: '10px', backgroundColor: '#f0f4ff',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px',
                }}>
                  <span style={{ display: 'inline-block', width: '40px', height: '40px', border: '3px solid #c7d2fe', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                  <div style={{ textAlign: 'center' as const }}>
                    <div style={{ fontSize: '14px', color: '#4338ca', fontWeight: 600 }}>{statusMessage}</div>
                    <div style={{ fontSize: '11px', color: '#818cf8', marginTop: '4px' }}>Est. ~25-30 seconds</div>
                  </div>
                </div>
              ) : editorTab === 'edit' ? (
                <textarea
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  placeholder="Your generated content will appear here. You can also write or edit content directly...

Tips:
• Start with a hook to grab attention
• Use line breaks for readability
• Include a clear call-to-action
• Keep your brand voice consistent"
                  style={{
                    width: '100%', flex: 1, minHeight: '400px', padding: '16px', border: '2px solid #e2e8f0',
                    borderRadius: '10px', fontSize: '14px', lineHeight: 1.8, color: '#0f172a',
                    backgroundColor: '#fafbfc', fontFamily: 'system-ui, -apple-system, sans-serif',
                    resize: 'vertical', outline: 'none',
                  }}
                />
              ) : (
                <div style={{ flex: 1, minHeight: '400px', padding: '16px', border: '2px solid #e2e8f0', borderRadius: '10px', backgroundColor: '#fff', overflow: 'auto' }}>
                  {content ? (
                    <div style={{ fontSize: '14px', lineHeight: 1.8, color: '#0f172a', whiteSpace: 'pre-wrap' as const }}>
                      {content}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', gap: '8px' }}>
                      <span style={{ fontSize: '32px', opacity: 0.3 }}>📄</span>
                      <span style={{ fontSize: '13px' }}>No content to preview</span>
                    </div>
                  )}
                </div>
              )}

              {/* Stats Bar */}
              <div style={{ marginTop: '16px', padding: '12px 16px', backgroundColor: '#f8fafc', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', gap: '24px' }}>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>
                    Sentences: <span style={{ fontWeight: 600, color: '#334155' }}>{content ? content.split(/[.!?]+/).filter(s => s.trim()).length : 0}</span>
                  </span>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>
                    Paragraphs: <span style={{ fontWeight: 600, color: '#334155' }}>{content ? content.split(/\n\n+/).filter(s => s.trim()).length : 0}</span>
                  </span>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>
                    Read time: <span style={{ fontWeight: 600, color: '#334155' }}>{Math.max(1, Math.ceil(wordCount / 200))} min</span>
                  </span>
                </div>
                <button
                  onClick={() => { navigator.clipboard.writeText(content); }}
                  style={{
                    padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                    border: '1px solid #e2e8f0', backgroundColor: '#fff', color: '#64748b',
                    cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#f1f5f9'; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#fff'; }}
                >
                  📋 Copy
                </button>
              </div>
            </div>
          </div>

          {/* Right Panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Image Preview */}
            <div style={{ backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '14px' }}>🖼️</span>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>Image Preview</span>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {generatedImage && !isGeneratingImage && (
                    <>
                      <button
                        onClick={generateImage}
                        disabled={isGeneratingImage || !content.trim()}
                        style={{
                          padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                          border: 'none', backgroundColor: '#eef2ff', color: '#6366f1',
                          cursor: isGeneratingImage || !content.trim() ? 'not-allowed' : 'pointer',
                          fontFamily: 'inherit', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '4px',
                        }}
                      >
                        <span>🔄</span> Regenerate
                      </button>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        style={{
                          padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                          border: 'none', backgroundColor: '#ecfdf5', color: '#059669',
                          cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '4px',
                        }}
                      >
                        <span>📤</span> Upload
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div style={{ padding: '20px' }}>
                {isGeneratingImage ? (
                  <div style={{
                    width: '100%', height: '200px', borderRadius: '10px', backgroundColor: '#f0f4ff',
                    border: '2px solid #c7d2fe',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px',
                  }}>
                    <span style={{ display: 'inline-block', width: '32px', height: '32px', border: '3px solid #c7d2fe', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    <div style={{ textAlign: 'center' as const }}>
                      <div style={{ fontSize: '13px', color: '#4338ca', fontWeight: 600 }}>{statusMessage}</div>
                      <div style={{ fontSize: '10px', color: '#818cf8', marginTop: '2px' }}>Est. ~15-20 seconds</div>
                    </div>
                  </div>
                ) : generatedImage ? (
                  <div
                    style={{ position: 'relative', border: dragOverPreview ? '2px dashed #6366f1' : '2px solid transparent', borderRadius: '10px', transition: 'all 0.2s' }}
                    onDragOver={handleDragOver}
                    onDragEnter={e => { e.preventDefault(); setDragOverPreview(true); }}
                    onDragLeave={e => { e.preventDefault(); setDragOverPreview(false); }}
                    onDrop={handleDrop}
                  >
                    <img src={generatedImage} alt="Generated" style={{ width: '100%', borderRadius: '10px', display: 'block' }} />
                    <button
                      onClick={() => setGeneratedImage('')}
                      style={{
                        position: 'absolute', top: '8px', right: '8px', width: '28px', height: '28px',
                        borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.5)', color: '#fff',
                        border: 'none', cursor: 'pointer', fontSize: '14px', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', transition: 'background 0.2s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.7)'; }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.5)'; }}
                    >×</button>
                  </div>
                ) : (
                  <div style={{
                    width: '100%', height: '200px', borderRadius: '10px',
                    border: dragOverPreview ? '2px dashed #6366f1' : '2px dashed #e2e8f0',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px',
                    backgroundColor: dragOverPreview ? '#eef2ff' : '#fafbfc',
                    cursor: 'pointer', transition: 'all 0.2s',
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={handleDragOver}
                  onDragEnter={e => { e.preventDefault(); setDragOverPreview(true); }}
                  onDragLeave={e => { e.preventDefault(); setDragOverPreview(false); }}
                  onDrop={handleDrop}
                  onMouseEnter={e => { if (!dragOverPreview) { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.backgroundColor = '#eef2ff'; }}}
                  onMouseLeave={e => { if (!dragOverPreview) { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.backgroundColor = '#fafbfc'; }}}
                  >
                    <span style={{ fontSize: '32px', opacity: dragOverPreview ? 0.8 : 0.4 }}>{dragOverPreview ? '📥' : '🖼️'}</span>
                    <span style={{ fontSize: '12px', color: dragOverPreview ? '#6366f1' : '#94a3b8', fontWeight: 500 }}>
                      {dragOverPreview ? 'Drop image here' : 'Click to upload an image'}
                    </span>
                    <span style={{ fontSize: '10px', color: '#cbd5e1' }}>or drag & drop</span>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleUploadImage}
                style={{ display: 'none' }}
              />
            </div>
            <div style={{ backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px' }}>🌐</span>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>Platforms</span>
              </div>
              <div style={{ padding: '12px 20px' }}>
                {['linkedin', 'instagram', 'facebook', 'twitter'].map(platform => {
                  const isConnected = accounts.some(a => a.platform === platform && a.connected);
                  const isSelected = selectedPlatforms.includes(platform);
                  const isComingSoon = platform !== 'linkedin';
                  return (
                    <div key={platform} style={{
                      display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0',
                      borderBottom: platform !== 'twitter' ? '1px solid #f1f5f9' : 'none',
                      opacity: isComingSoon ? 0.5 : 1,
                    }}>
                      <div
                        onClick={() => !isComingSoon && togglePlatform(platform)}
                        style={{
                          width: '20px', height: '20px', borderRadius: '4px',
                          cursor: isComingSoon ? 'not-allowed' : 'pointer',
                          border: isSelected ? '2px solid #6366f1' : '2px solid #d1d5db',
                          backgroundColor: isSelected ? '#6366f1' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'all 0.2s', flexShrink: 0,
                        }}
                      >
                        {isSelected && <span style={{ color: '#fff', fontSize: '12px', fontWeight: 700 }}>✓</span>}
                      </div>
                      <div
                        style={{
                          width: '32px', height: '32px', borderRadius: '50%',
                          backgroundColor: platformColors[platform], color: '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '11px', fontWeight: 700, flexShrink: 0, letterSpacing: '-0.02em',
                        }}
                      >
                        {platformInitials[platform]}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '13px', fontWeight: 500, color: '#0f172a', textTransform: 'capitalize' as const }}>
                            {platform}
                          </span>
                          {isComingSoon && (
                            <span style={{
                              fontSize: '9px', fontWeight: 700, color: '#f59e0b', backgroundColor: '#fef3c7',
                              padding: '2px 6px', borderRadius: '4px', letterSpacing: '0.03em', textTransform: 'uppercase' as const,
                            }}>
                              Coming Soon
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '11px', color: isConnected ? '#10b981' : '#94a3b8' }}>
                          {isConnected ? '● Connected' : isComingSoon ? '○ Not available yet' : '○ Not connected'}
                        </div>
                      </div>
                      <button
                        onClick={() => !isComingSoon && (isConnected ? disconnectPlatform(platform) : connectPlatform(platform))}
                        disabled={isComingSoon}
                        style={{
                          padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                          border: 'none', cursor: isComingSoon ? 'not-allowed' : 'pointer', fontFamily: 'inherit', transition: 'all 0.2s',
                          backgroundColor: isComingSoon ? '#f1f5f9' : isConnected ? '#fef2f2' : '#eef2ff',
                          color: isComingSoon ? '#94a3b8' : isConnected ? '#dc2626' : '#6366f1',
                        }}
                      >
                        {isComingSoon ? 'Soon' : isConnected ? 'Disconnect' : 'Connect'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Connected Accounts */}
            <div style={{ backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px' }}>👥</span>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>Accounts</span>
              </div>
              <div style={{ padding: '12px 20px' }}>
                {accounts.length === 0 ? (
                  <div style={{ padding: '16px 0', textAlign: 'center' as const }}>
                    <div style={{ fontSize: '12px', color: '#94a3b8' }}>No accounts connected yet</div>
                    <div style={{ fontSize: '11px', color: '#cbd5e1', marginTop: '4px' }}>Connect platforms above to get started</div>
                  </div>
                ) : (
                  accounts.map(account => (
                    <div key={account.platform} style={{
                      display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0',
                      borderBottom: '1px solid #f1f5f9',
                    }}>
                      <div style={{
                        width: '28px', height: '28px', borderRadius: '50%',
                        backgroundColor: platformColors[account.platform], color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '10px', fontWeight: 700,
                      }}>
                        {platformInitials[account.platform]}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: 500, color: '#0f172a' }}>{account.name}</div>
                        <div style={{ fontSize: '11px', color: '#94a3b8' }}>{account.email || account.platform}</div>
                      </div>
                      <span style={{ fontSize: '10px', color: '#10b981', fontWeight: 600 }}>●</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Publish Button */}
            <button
              onClick={publishToAll}
              disabled={isPublishing || selectedPlatforms.length === 0 || !content.trim()}
              style={{
                padding: '14px 24px', borderRadius: '10px', fontSize: '14px', fontWeight: 600, border: 'none',
                background: isPublishing || selectedPlatforms.length === 0 || !content.trim()
                  ? '#c7d2fe'
                  : 'linear-gradient(135deg, #10b981, #059669)',
                color: '#fff',
                cursor: isPublishing || selectedPlatforms.length === 0 || !content.trim() ? 'not-allowed' : 'pointer',
                boxShadow: isPublishing || selectedPlatforms.length === 0 || !content.trim()
                  ? 'none'
                  : '0 2px 8px rgba(16,185,129,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                fontFamily: 'inherit', transition: 'all 0.2s', width: '100%',
                transform: hoveredBtn === 'publish' && !isPublishing ? 'translateY(-1px)' : 'none',
              }}
              onMouseEnter={() => { if (!isPublishing && content.trim() && selectedPlatforms.length > 0) setHoveredBtn('publish'); }}
              onMouseLeave={() => setHoveredBtn(null)}
            >
              {isPublishing ? (
                <><span style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /> Publishing...</>
              ) : (
                <><span>🚀</span> Publish to {selectedPlatforms.length || 0} Platform{selectedPlatforms.length !== 1 ? 's' : ''}</>
              )}
            </button>

            {/* Scheduler */}
            <div style={{ backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px' }}>📅</span>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>Schedule Post</span>
              </div>
              <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ fontSize: '11px', color: '#6366f1', backgroundColor: '#eef2ff', padding: '8px 10px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>⏱️</span> Posts schedule at least 5 minutes from now
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#64748b', marginBottom: '6px', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Date</label>
                  <input
                    type="date"
                    value={scheduleDate}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={e => setScheduleDate(e.target.value)}
                    style={{
                      width: '100%', padding: '10px 12px', border: '2px solid #e2e8f0', borderRadius: '8px',
                      fontSize: '13px', color: '#0f172a', backgroundColor: '#fafbfc', outline: 'none',
                      fontFamily: 'inherit',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#64748b', marginBottom: '6px', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Time</label>
                  <input
                    type="time"
                    value={scheduleTime}
                    min={scheduleDate === new Date().toISOString().split('T')[0]
                      ? new Date(Date.now() + 5 * 60 * 1000).toTimeString().slice(0, 5)
                      : '00:00'}
                    onChange={e => setScheduleTime(e.target.value)}
                    style={{
                      width: '100%', padding: '10px 12px', border: '2px solid #e2e8f0', borderRadius: '8px',
                      fontSize: '13px', color: '#0f172a', backgroundColor: '#fafbfc', outline: 'none',
                      fontFamily: 'inherit',
                    }}
                  />
                </div>
                <button
                  onClick={schedulePost}
                  disabled={isScheduling || !content.trim() || !scheduleDate || !scheduleTime || selectedPlatforms.length === 0}
                  style={{
                    padding: '10px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, border: 'none',
                    background: isScheduling || !content.trim() || !scheduleDate || !scheduleTime || selectedPlatforms.length === 0
                      ? '#e2e8f0'
                      : 'linear-gradient(135deg, #f59e0b, #d97706)',
                    color: isScheduling || !content.trim() || !scheduleDate || !scheduleTime || selectedPlatforms.length === 0
                      ? '#94a3b8'
                      : '#fff',
                    cursor: isScheduling || !content.trim() || !scheduleDate || !scheduleTime || selectedPlatforms.length === 0
                      ? 'not-allowed'
                      : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    fontFamily: 'inherit', transition: 'all 0.2s',
                  }}
                >
                  {isScheduling ? (
                    <><span style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /> Scheduling...</>
                  ) : (
                    <><span>📅</span> Schedule</>
                  )}
                </button>

                {scheduledPosts.length > 0 && (
                  <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '12px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', marginBottom: '8px', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Upcoming</div>
                    {scheduledPosts.map(post => (
                      <div key={post.id} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '8px 10px', backgroundColor: '#fffbeb', borderRadius: '6px', marginBottom: '6px',
                        border: '1px solid #fef3c7',
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '11px', color: '#92400e', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                            {post.content.substring(0, 40)}...
                          </div>
                          <div style={{ fontSize: '10px', color: '#b45309', marginTop: '2px' }}>
                            {new Date(post.scheduledAt).toLocaleString()} · {post.platforms.join(', ')}
                          </div>
                        </div>
                        <button
                          onClick={() => cancelScheduled(post.id)}
                          style={{
                            padding: '3px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 600,
                            border: 'none', backgroundColor: '#fef2f2', color: '#dc2626',
                            cursor: 'pointer', fontFamily: 'inherit', marginLeft: '8px', flexShrink: 0,
                          }}
                        >Cancel</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Toast Notification */}
      {showToast && (
        <div style={{
          position: 'fixed', top: '24px', right: '24px', zIndex: 1000,
          padding: '14px 20px', borderRadius: '10px',
          backgroundColor: publishResultType === 'success' ? '#10b981' : '#ef4444',
          color: '#fff', fontSize: '13px', fontWeight: 500,
          boxShadow: publishResultType === 'success'
            ? '0 4px 16px rgba(16,185,129,0.4)'
            : '0 4px 16px rgba(239,68,68,0.4)',
          display: 'flex', alignItems: 'center', gap: '10px',
          animation: 'slideInRight 0.3s ease-out',
          maxWidth: '400px',
        }}>
          <span style={{ fontSize: '16px' }}>{publishResultType === 'success' ? '✓' : '✕'}</span>
          <span>{publishResult}</span>
          <button
            onClick={() => setShowToast(false)}
            style={{
              marginLeft: '8px', background: 'none', border: 'none', color: '#fff',
              cursor: 'pointer', fontSize: '16px', padding: '0', lineHeight: 1, opacity: 0.8,
            }}
          >×</button>
        </div>
      )}
    </div>
  );
}
