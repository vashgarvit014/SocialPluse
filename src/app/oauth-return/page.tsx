'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function OAuthReturn() {
  const router = useRouter();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get('editor_return');
    if (!id) return;
    const target = '/?' + params.toString();
    if (window.opener && !window.opener.closed) {
      const onAck = (event: MessageEvent) => {
        if (event.origin === location.origin && event.source === window.opener && event.data?.type === 'socialpulse-oauth-ack' && event.data.id === id) window.close();
      };
      window.addEventListener('message', onAck);
      window.opener.postMessage({ type: 'socialpulse-oauth-return', id, provider: params.get('provider'), error: params.get('error') }, location.origin);
      return () => window.removeEventListener('message', onAck);
    }
    location.replace(target);
  }, []);
  return <main style={{ padding: 40 }}><h1>Connection returned</h1><p>Your editor content is saved. This window closes when SocialPulse receives the result.</p><button onClick={() => router.push('/' + location.search)}>Return to my editor</button></main>;
}
