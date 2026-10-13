export function DashboardHeroCoin({ connectedCount }: { connectedCount: number }) {
  const html = `<div class="sp-stage" aria-hidden="true" style="flex: 1 1 420px; min-width: 0">
<span class="sp-bracket" style="left: 8px; top: 6px; border-top-width: 1.5px; border-left-width: 1.5px; border-top-left-radius: 6px"></span>
<span class="sp-bracket" style="right: 8px; top: 6px; border-top-width: 1.5px; border-right-width: 1.5px; border-top-right-radius: 6px"></span>
<span class="sp-bracket" style="left: 8px; bottom: 40px; border-bottom-width: 1.5px; border-left-width: 1.5px; border-bottom-left-radius: 6px"></span>
<span class="sp-bracket" style="right: 8px; bottom: 40px; border-bottom-width: 1.5px; border-right-width: 1.5px; border-bottom-right-radius: 6px"></span>

<span class="sp-halo"></span>
<div class="sp-pad">
<span style="width: 300px; height: 300px; margin: -150px 0 0 -150px; border: 1px solid rgba(160,242,255,.42); box-shadow: inset 0 0 40px rgba(100,230,255,.35), 0 0 30px rgba(100,230,255,.25)"></span>
<span class="sp-ticks sp-spin-rev" style="width: 276px; height: 276px; margin: -138px 0 0 -138px"></span>
<span class="sp-spin-slow" style="width: 228px; height: 228px; margin: -114px 0 0 -114px; border: 1.5px dashed rgba(172,242,255,.5)"></span>
<span class="sp-sweep sp-spin-fast" style="width: 228px; height: 228px; margin: -114px 0 0 -114px"></span>
<span style="width: 168px; height: 168px; margin: -84px 0 0 -84px; background: radial-gradient(circle, rgba(130,221,255,.75) 0%, rgba(100,240,255,.28) 42%, transparent 70%)"></span>
</div>
<span class="sp-beam"></span>
<span class="sp-mote" style="left: 44%; animation-delay: 0s"></span>
<span class="sp-mote" style="left: 51%; animation-delay: -1.2s; animation-duration: 6s"></span>
<span class="sp-mote" style="left: 56%; animation-delay: -2.6s; animation-duration: 8s"></span>
<span class="sp-mote" style="left: 47%; animation-delay: -3.4s; animation-duration: 6.5s"></span>
<span class="sp-mote" style="left: 53.5%; animation-delay: -4.8s"></span>
<span class="sp-mote" style="left: 41.5%; animation-delay: -5.6s; animation-duration: 7.5s"></span>
<span class="sp-mote" style="left: 58.5%; animation-delay: -6.3s; animation-duration: 6.8s"></span>

<div class="sp-layer3d sp-orbit-back">
<span class="sp-ring" style="border: 1px solid rgba(168,242,255,.26); transform: rotateX(72deg)"></span>
</div>

<div class="sp-layer3d" style="z-index: 2">
<div class="sp-float">
<div class="sp-coin" style="animation-duration: 14s">
<span class="sp-plate" style="transform: translateZ(-10px); background: #296C6D"></span>
<span class="sp-plate" style="transform: translateZ(-9px); background: #3E878C"></span>
<span class="sp-plate" style="transform: translateZ(-8px); background: #4E9DA3"></span>
<span class="sp-plate" style="transform: translateZ(-7px); background: #5BB1B8"></span>
<span class="sp-plate" style="transform: translateZ(-6px); background: #66C1C9"></span>
<span class="sp-plate" style="transform: translateZ(-5px); background: #6FCDD7"></span>
<span class="sp-plate" style="transform: translateZ(-4px); background: #76D6E2"></span>
<span class="sp-plate" style="transform: translateZ(-3px); background: #7CDFEB"></span>
<span class="sp-plate" style="transform: translateZ(-2px); background: #80E5F1"></span>
<span class="sp-plate" style="transform: translateZ(-1px); background: #82E8F5"></span>
<span class="sp-plate" style="transform: translateZ(0px); background: #83E9F6"></span>
<span class="sp-plate" style="transform: translateZ(1px); background: #82E8F5"></span>
<span class="sp-plate" style="transform: translateZ(2px); background: #80E5F1"></span>
<span class="sp-plate" style="transform: translateZ(3px); background: #7CDFEB"></span>
<span class="sp-plate" style="transform: translateZ(4px); background: #76D6E2"></span>
<span class="sp-plate" style="transform: translateZ(5px); background: #6FCDD7"></span>
<span class="sp-plate" style="transform: translateZ(6px); background: #66C1C9"></span>
<span class="sp-plate" style="transform: translateZ(7px); background: #5BB1B8"></span>
<span class="sp-plate" style="transform: translateZ(8px); background: #4E9DA3"></span>
<span class="sp-plate" style="transform: translateZ(9px); background: #3E878C"></span>
<span class="sp-plate" style="transform: translateZ(10px); background: #296C6D"></span>

<span class="sp-face" style="transform: rotateY(180deg) translateZ(11px)"></span>
<svg class="sp-gl" viewBox="0 0 2048 2048" aria-hidden="true" style="transform: rotateY(180deg) translateZ(11.6px); stroke: #6BE9FF; stroke-width: 150px; filter: blur(10px); opacity: .5"><path d="M1148.5 692.8A353.85 353.85 0 0 0 719.4 1204.1"></path><path d="M899.5 1355.2A353.85 353.85 0 0 0 1328.6 843.9"></path><circle cx="1024" cy="1024" r="128" style="fill: #B0F3FF; stroke: none"></circle></svg>
<svg class="sp-gl" viewBox="0 0 2048 2048" aria-hidden="true" style="transform: rotateY(180deg) translateZ(12px); stroke: #174D52; stroke-width: 121.3px"><path d="M1148.5 692.8A353.85 353.85 0 0 0 719.4 1204.1"></path><path d="M899.5 1355.2A353.85 353.85 0 0 0 1328.6 843.9"></path><circle cx="1024" cy="1024" r="111.5" style="fill: #3A7D82; stroke: none"></circle></svg>
<svg class="sp-gl" viewBox="0 0 2048 2048" aria-hidden="true" style="transform: rotateY(180deg) translateZ(13.4px); stroke: #23656C; stroke-width: 121.3px"><path d="M1148.5 692.8A353.85 353.85 0 0 0 719.4 1204.1"></path><path d="M899.5 1355.2A353.85 353.85 0 0 0 1328.6 843.9"></path><circle cx="1024" cy="1024" r="111.5" style="fill: #51979E; stroke: none"></circle></svg>
<svg class="sp-gl" viewBox="0 0 2048 2048" aria-hidden="true" style="transform: rotateY(180deg) translateZ(14.8px); stroke: #2F7E87; stroke-width: 121.3px"><path d="M1148.5 692.8A353.85 353.85 0 0 0 719.4 1204.1"></path><path d="M899.5 1355.2A353.85 353.85 0 0 0 1328.6 843.9"></path><circle cx="1024" cy="1024" r="111.5" style="fill: #69B1B9; stroke: none"></circle></svg>
<svg class="sp-gl" viewBox="0 0 2048 2048" aria-hidden="true" style="transform: rotateY(180deg) translateZ(16.2px); stroke: #3A95A1; stroke-width: 121.3px"><path d="M1148.5 692.8A353.85 353.85 0 0 0 719.4 1204.1"></path><path d="M899.5 1355.2A353.85 353.85 0 0 0 1328.6 843.9"></path><circle cx="1024" cy="1024" r="111.5" style="fill: #84C8D0; stroke: none"></circle></svg>
<svg class="sp-gl" viewBox="0 0 2048 2048" aria-hidden="true" style="transform: rotateY(180deg) translateZ(17.6px); stroke: #46AEBC; stroke-width: 121.3px"><path d="M1148.5 692.8A353.85 353.85 0 0 0 719.4 1204.1"></path><path d="M899.5 1355.2A353.85 353.85 0 0 0 1328.6 843.9"></path><circle cx="1024" cy="1024" r="111.5" style="fill: #9FDDE3; stroke: none"></circle></svg>
<svg class="sp-gl" viewBox="0 0 2048 2048" aria-hidden="true" style="transform: rotateY(180deg) translateZ(19px); stroke: #52C6D6; stroke-width: 121.3px"><path d="M1148.5 692.8A353.85 353.85 0 0 0 719.4 1204.1"></path><path d="M899.5 1355.2A353.85 353.85 0 0 0 1328.6 843.9"></path><circle cx="1024" cy="1024" r="111.5" style="fill: #B9EAF0; stroke: none"></circle></svg>
<svg class="sp-gl" viewBox="0 0 2048 2048" aria-hidden="true" style="transform: rotateY(180deg) translateZ(20.4px); stroke-width: 121.3px; filter: drop-shadow(0 0 7px rgba(110,230,255,.65))"><defs><linearGradient id="spArcB" gradientUnits="userSpaceOnUse" x1="608" y1="608" x2="1440" y2="1440"><stop offset="0" style="stop-color: #5C8CFD"></stop><stop offset="0.26" style="stop-color: #6A78FE"></stop><stop offset="0.44" style="stop-color: #63E6FE"></stop><stop offset="0.56" style="stop-color: #5CD0FC"></stop><stop offset="0.74" style="stop-color: #5CB3F7"></stop><stop offset="1" style="stop-color: #5C9AF1"></stop></linearGradient></defs><path d="M1148.5 692.8A353.85 353.85 0 0 0 719.4 1204.1" stroke="url(#spArcB)"></path><path d="M899.5 1355.2A353.85 353.85 0 0 0 1328.6 843.9" stroke="url(#spArcB)"></path><circle cx="1024" cy="1024" r="111.5" style="fill: #CEF2F7; stroke: none"></circle></svg>
<svg class="sp-gl" viewBox="0 0 2048 2048" aria-hidden="true" style="transform: rotateY(180deg) translateZ(21.8px)"><circle cx="1024" cy="1024" r="111.5" style="fill: #DFF7FB"></circle></svg>
<svg class="sp-gl" viewBox="0 0 2048 2048" aria-hidden="true" style="transform: rotateY(180deg) translateZ(23.2px); filter: drop-shadow(0 0 6px rgba(242,253,255,.75))"><defs><radialGradient id="spDotB" cx="0.4" cy="0.36" r="0.72"><stop offset="0" style="stop-color: #FFFFFF"></stop><stop offset="0.62" style="stop-color: #F2FDFF"></stop><stop offset="1" style="stop-color: #CFF6FF"></stop></radialGradient></defs><circle cx="1024" cy="1024" r="111.5" fill="url(#spDotB)"></circle></svg>

<span class="sp-face" style="transform: translateZ(11px)"></span>
<svg class="sp-gl" viewBox="0 0 2048 2048" aria-hidden="true" style="transform: translateZ(11.6px); stroke: #6BE9FF; stroke-width: 150px; filter: blur(10px); opacity: .5"><path d="M1148.5 692.8A353.85 353.85 0 0 0 719.4 1204.1"></path><path d="M899.5 1355.2A353.85 353.85 0 0 0 1328.6 843.9"></path><circle cx="1024" cy="1024" r="128" style="fill: #B0F3FF; stroke: none"></circle></svg>
<svg class="sp-gl" viewBox="0 0 2048 2048" aria-hidden="true" style="transform: translateZ(12px); stroke: #174D52; stroke-width: 121.3px"><path d="M1148.5 692.8A353.85 353.85 0 0 0 719.4 1204.1"></path><path d="M899.5 1355.2A353.85 353.85 0 0 0 1328.6 843.9"></path><circle cx="1024" cy="1024" r="111.5" style="fill: #3A7D82; stroke: none"></circle></svg>
<svg class="sp-gl" viewBox="0 0 2048 2048" aria-hidden="true" style="transform: translateZ(13.4px); stroke: #23656C; stroke-width: 121.3px"><path d="M1148.5 692.8A353.85 353.85 0 0 0 719.4 1204.1"></path><path d="M899.5 1355.2A353.85 353.85 0 0 0 1328.6 843.9"></path><circle cx="1024" cy="1024" r="111.5" style="fill: #51979E; stroke: none"></circle></svg>
<svg class="sp-gl" viewBox="0 0 2048 2048" aria-hidden="true" style="transform: translateZ(14.8px); stroke: #2F7E87; stroke-width: 121.3px"><path d="M1148.5 692.8A353.85 353.85 0 0 0 719.4 1204.1"></path><path d="M899.5 1355.2A353.85 353.85 0 0 0 1328.6 843.9"></path><circle cx="1024" cy="1024" r="111.5" style="fill: #69B1B9; stroke: none"></circle></svg>
<svg class="sp-gl" viewBox="0 0 2048 2048" aria-hidden="true" style="transform: translateZ(16.2px); stroke: #3A95A1; stroke-width: 121.3px"><path d="M1148.5 692.8A353.85 353.85 0 0 0 719.4 1204.1"></path><path d="M899.5 1355.2A353.85 353.85 0 0 0 1328.6 843.9"></path><circle cx="1024" cy="1024" r="111.5" style="fill: #84C8D0; stroke: none"></circle></svg>
<svg class="sp-gl" viewBox="0 0 2048 2048" aria-hidden="true" style="transform: translateZ(17.6px); stroke: #46AEBC; stroke-width: 121.3px"><path d="M1148.5 692.8A353.85 353.85 0 0 0 719.4 1204.1"></path><path d="M899.5 1355.2A353.85 353.85 0 0 0 1328.6 843.9"></path><circle cx="1024" cy="1024" r="111.5" style="fill: #9FDDE3; stroke: none"></circle></svg>
<svg class="sp-gl" viewBox="0 0 2048 2048" aria-hidden="true" style="transform: translateZ(19px); stroke: #52C6D6; stroke-width: 121.3px"><path d="M1148.5 692.8A353.85 353.85 0 0 0 719.4 1204.1"></path><path d="M899.5 1355.2A353.85 353.85 0 0 0 1328.6 843.9"></path><circle cx="1024" cy="1024" r="111.5" style="fill: #B9EAF0; stroke: none"></circle></svg>
<svg class="sp-gl" viewBox="0 0 2048 2048" aria-hidden="true" style="transform: translateZ(20.4px); stroke-width: 121.3px; filter: drop-shadow(0 0 7px rgba(110,230,255,.65))"><defs><linearGradient id="spArcF" gradientUnits="userSpaceOnUse" x1="608" y1="608" x2="1440" y2="1440"><stop offset="0" style="stop-color: #5C8CFD"></stop><stop offset="0.26" style="stop-color: #6A78FE"></stop><stop offset="0.44" style="stop-color: #63E6FE"></stop><stop offset="0.56" style="stop-color: #5CD0FC"></stop><stop offset="0.74" style="stop-color: #5CB3F7"></stop><stop offset="1" style="stop-color: #5C9AF1"></stop></linearGradient></defs><path d="M1148.5 692.8A353.85 353.85 0 0 0 719.4 1204.1" stroke="url(#spArcF)"></path><path d="M899.5 1355.2A353.85 353.85 0 0 0 1328.6 843.9" stroke="url(#spArcF)"></path><circle cx="1024" cy="1024" r="111.5" style="fill: #CEF2F7; stroke: none"></circle></svg>
<svg class="sp-gl" viewBox="0 0 2048 2048" aria-hidden="true" style="transform: translateZ(21.8px)"><circle cx="1024" cy="1024" r="111.5" style="fill: #DFF7FB"></circle></svg>
<svg class="sp-gl" viewBox="0 0 2048 2048" aria-hidden="true" style="transform: translateZ(23.2px); filter: drop-shadow(0 0 6px rgba(242,253,255,.75))"><defs><radialGradient id="spDotF" cx="0.4" cy="0.36" r="0.72"><stop offset="0" style="stop-color: #FFFFFF"></stop><stop offset="0.62" style="stop-color: #F2FDFF"></stop><stop offset="1" style="stop-color: #CFF6FF"></stop></radialGradient></defs><circle cx="1024" cy="1024" r="111.5" fill="url(#spDotF)"></circle></svg>
</div>
</div>
</div>

<div class="sp-layer3d sp-orbit-front" style="z-index: 3">
<span class="sp-ring" style="border: 1px solid rgba(168,242,255,.26); transform: rotateX(72deg)"></span>
<span class="sp-ring sp-streak"></span>
</div>

<div class="sp-sat" style="color: #8DBBFF; animation-delay: 0s">
<svg class="ico" viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="7" width="18" height="13" rx="2.5"></rect><path d="M8.5 7V5.5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2V7M3 12.5h18"></path></svg>
</div>
<div class="sp-sat" style="color: #F9A8D4; animation-delay: -8s">
<svg class="ico" viewBox="0 0 24 24" width="18" height="18"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.7l1.5-2.2h4.6L15.8 6h1.7A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z"></path><circle cx="12" cy="13" r="3.5"></circle></svg>
</div>
<div class="sp-sat" style="color: #A5B4FF; animation-delay: -16s">
<svg class="ico" viewBox="0 0 24 24" width="18" height="18"><circle cx="9" cy="8" r="3.5"></circle><path d="M2.5 20a6.5 6.5 0 0 1 13 0"></path><path d="M15.5 4.7a3.5 3.5 0 0 1 0 6.6M18 14.2a6.5 6.5 0 0 1 3.5 5.8"></path></svg>
</div>
<div class="sp-sat" style="color: #6EE7B7; animation-delay: -24s">
<svg class="ico" viewBox="0 0 24 24" width="18" height="18"><path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4A8.5 8.5 0 1 1 20.5 11.5z"></path></svg>
</div>

<div class="sp-mono" style="position: absolute; left: 0; right: 0; bottom: 8px; display: flex; align-items: center; justify-content: center; gap: 12px; font-size: 10.5px; letter-spacing: 0.2em; text-transform: uppercase; color: #9DA3CB">
<span style="width: 30px; height: 1px; background: linear-gradient(90deg, transparent, rgba(168,242,255,.7))"></span>
<span>Platforms in orbit</span>
<span style="color: #FFFFFF; letter-spacing: 0.08em; font-weight: 600">__CONNECTED_COUNT__ / 4</span>
<span style="width: 30px; height: 1px; background: linear-gradient(90deg, rgba(168,242,255,.7), transparent)"></span>
</div>
</div>
`.replace('__CONNECTED_COUNT__', String(connectedCount));
  return <div style={{ flex: '1 1 420px', minWidth: 0 }} dangerouslySetInnerHTML={{ __html: html }} />;
}
