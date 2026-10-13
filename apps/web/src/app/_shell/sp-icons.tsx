import type { ReactNode } from 'react';

type SpIconName =
  | 'dashboard' | 'studio' | 'scheduler' | 'analytics' | 'gallery' | 'connect'
  | 'chevronLeft' | 'chevronRight' | 'bell' | 'calendar' | 'arrowRight' | 'sparkle'
  | 'users' | 'hourglass' | 'checkCircle' | 'xCircle' | 'minus' | 'barsChart'
  | 'clock' | 'doc' | 'plus' | 'bolt' | 'pencil' | 'globe' | 'hamburger' | 'sun' | 'moon';

const PATHS: Record<SpIconName, ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7.5" height="9" rx="2" /><rect x="13.5" y="3" width="7.5" height="5.5" rx="2" /><rect x="13.5" y="11.5" width="7.5" height="9.5" rx="2" /><rect x="3" y="15" width="7.5" height="6" rx="2" /></>,
  studio: <><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z" /><path d="M13.5 8.5l3 3" /><path d="M19.5 2.5v3M18 4h3" /></>,
  scheduler: <><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M8 3v4M16 3v4M3.5 10h17" /><path d="M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01" /></>,
  analytics: <><path d="M3.5 3.5v17h17" /><path d="M7.5 15l3.5-4 3 2.5 5-6.5" /></>,
  gallery: <><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="9.5" r="1.8" /><path d="M21 15.5l-4.5-4.5L7 20" /></>,
  connect: <><path d="M10 13.5a4.5 4.5 0 0 0 6.4.4l2.7-2.7a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" /><path d="M14 10.5a4.5 4.5 0 0 0-6.4-.4l-2.7 2.7a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" /></>,
  chevronLeft: <path d="M14.5 6l-6 6 6 6" />,
  chevronRight: <path d="M9.5 6l6 6-6 6" />,
  bell: <><path d="M6 9a6 6 0 0 1 12 0c0 6.5 2.5 8 2.5 8h-17S6 15.5 6 9z" /><path d="M10.3 20.5a2 2 0 0 0 3.4 0" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M8 3v4M16 3v4M3.5 10h17" /></>,
  arrowRight: <path d="M5 12h14M13.5 6.5L19 12l-5.5 5.5" />,
  sparkle: <><path d="M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9z" /><path d="M18.5 15.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z" /></>,
  users: <><circle cx="12" cy="12" r="2" /><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5" /></>,
  hourglass: <><path d="M6 3h12M6 21h12" /><path d="M7.5 3c0 4.5 4.5 5.5 4.5 9s-4.5 4.5-4.5 9M16.5 3c0 4.5-4.5 5.5-4.5 9s4.5 4.5 4.5 9" /></>,
  checkCircle: <><circle cx="12" cy="12" r="9" /><path d="M8.3 12.4l2.5 2.5 4.9-5.3" /></>,
  xCircle: <><circle cx="12" cy="12" r="9" /><path d="M5.8 5.8l12.4 12.4" /></>,
  minus: <path d="M7 12h10" />,
  barsChart: <><path d="M3.5 20.5h17" /><rect x="5" y="11" width="3.4" height="6.5" rx="1" /><rect x="10.3" y="5" width="3.4" height="12.5" rx="1" /><rect x="15.6" y="13.5" width="3.4" height="4" rx="1" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></>,
  doc: <><path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z" /><path d="M14 3v5h5M9 13h6M9 16.5h4" /></>,
  plus: <path d="M12 6v12M6 12h12" />,
  bolt: <path d="M13 2.5L4.5 13.5h6.5l-1 8 8.5-11h-6.5l1-8z" />,
  pencil: <><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z" /><path d="M13.5 8.5l3 3" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.8 3.9 5.8 3.9 9s-1.3 6.2-3.9 9c-2.6-2.8-3.9-5.8-3.9-9S9.4 5.8 12 3z" /></>,
  hamburger: <path d="M4 7h16M4 12h16M4 17h11" />,
  sun: <><circle cx="12" cy="12" r="4.5" /><path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12h2.5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8" /></>,
  moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />,
};

export function SpIcon({ name, size = 18 }: { name: SpIconName; size?: number }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
