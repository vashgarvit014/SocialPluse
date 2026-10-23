'use client';

import AIGenerationModal from '../../_shell/ai-generation-modal';

// DEVELOPMENT ONLY — renders the generating-phase modal with no real
// request behind it, purely for visual review of the loader animation.
export default function PreviewClient() {
  return (
    <div style={{ minHeight: '100vh', background: '#0b0f1f' }}>
      <AIGenerationModal
        mode="image"
        phase="generating"
        items={[]}
        error=""
        onUseSelected={() => {}}
        onRegenerate={() => {}}
        onRetry={() => {}}
        onClose={() => {}}
      />
    </div>
  );
}
