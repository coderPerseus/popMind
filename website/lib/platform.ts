// The visitor's system, read in the browser after the page loads (the prerendered page, which crawlers
// read, offers the Mac download).
export type Platform = 'mac' | 'windows' | 'mobile' | 'other';

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'mac';
  const nav = navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } };
  const ua = nav.userAgent || '';
  const hint = (nav.userAgentData?.platform || nav.platform || '').toLowerCase();
  // iPadOS reports itself as a Mac: its touch screen tells it apart.
  const touchMac = /mac/.test(hint) && (nav.maxTouchPoints ?? 0) > 1;
  if (nav.userAgentData?.mobile || /android|iphone|ipad|ipod|mobile/i.test(ua) || touchMac) return 'mobile';
  if (/win/.test(hint) || /windows/i.test(ua)) return 'windows';
  if (/mac/.test(hint) || /macintosh|mac os x/i.test(ua)) return 'mac';
  return 'other';
}
