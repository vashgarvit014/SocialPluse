'use client';

import { useEffect, useState } from 'react';

// TEMPORARY dev-only page to test the Meta app + JS SDK setup.
// Not linked from anywhere in the app. Delete this file before any commit.
const APP_ID = '1096578409692085';
const API_VERSION = 'v21.0';
const PAGE_SCOPES = 'public_profile,pages_show_list,pages_read_engagement,pages_manage_posts';

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    FB: any;
    fbAsyncInit: () => void;
  }
}

export default function FbSdkTestPage() {
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [output, setOutput] = useState('SDK loading…');
  const [loginState, setLoginState] = useState('unknown');

  const summarize = (label: string, res: { status?: string; authResponse?: { grantedScopes?: string } }) => {
    if (res?.status) setLoginState(res.status);
    const granted = res?.authResponse?.grantedScopes || res?.authResponse && '(no grantedScopes field)';
    setOutput(`${label} →\nstatus: ${res?.status || 'n/a'}\ngrantedScopes: ${granted || 'none'}\n\nFull response:\n${JSON.stringify(res, null, 2)}`);
  };

  useEffect(() => {
    window.fbAsyncInit = function () {
      window.FB.init({ appId: APP_ID, cookie: true, xfbml: false, version: API_VERSION });
      setSdkLoaded(true);
      // Per the docs: first thing on page load, check login status.
      window.FB.getLoginStatus((res: { status?: string; authResponse?: { grantedScopes?: string } }) => {
        summarize('getLoginStatus (auto, on load)', res);
      });
    };
    const js = document.createElement('script');
    js.id = 'facebook-jssdk-test';
    js.src = 'https://connect.facebook.net/en_US/sdk.js';
    document.body.appendChild(js);
    return () => { document.getElementById('facebook-jssdk-test')?.remove(); };
  }, []);

  const checkStatus = () => {
    window.FB.getLoginStatus((res: { status?: string; authResponse?: { grantedScopes?: string } }) => {
      summarize('getLoginStatus', res);
    });
  };

  const loginTest = () => {
    window.FB.login((res: { status?: string; authResponse?: { grantedScopes?: string } }) => {
      summarize('FB.login', res);
    }, { scope: PAGE_SCOPES });
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8FAFC', padding: 32, fontFamily: 'inherit' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', backgroundColor: '#fff', borderRadius: 16, padding: 28, border: '1px solid #E8EAF1' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A' }}>Meta App SDK test (temporary page)</div>
        <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>App {APP_ID} · {API_VERSION} · delete this file before committing</div>
        <div style={{ fontSize: 12, fontWeight: 700, marginTop: 10, color: loginState === 'connected' ? '#059669' : '#92400E' }}>Login status: {loginState}</div>
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button onClick={checkStatus} disabled={!sdkLoaded} style={{ padding: '10px 16px', borderRadius: 9, border: 'none', background: sdkLoaded ? '#0F172A' : '#DDD6FE', color: '#fff', fontSize: 13, fontWeight: 700, cursor: sdkLoaded ? 'pointer' : 'not-allowed' }}>Check login status</button>
          <button onClick={loginTest} disabled={!sdkLoaded} style={{ padding: '10px 16px', borderRadius: 9, border: 'none', background: sdkLoaded ? 'linear-gradient(135deg,#7C3AED,#8B5CF6)' : '#DDD6FE', color: '#fff', fontSize: 13, fontWeight: 700, cursor: sdkLoaded ? 'pointer' : 'not-allowed' }}>Login + request Page scopes</button>
        </div>
        <pre style={{ marginTop: 18, fontSize: 12, lineHeight: 1.6, color: '#0F172A', backgroundColor: '#F8FAFC', border: '1px solid #E8EAF1', borderRadius: 10, padding: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: 120 }}>{output}</pre>
        <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 10 }}>If login says “domain not allowed”, add <b>localhost</b> under App Settings → Basic → App Domains.</div>
      </div>
    </div>
  );
}
