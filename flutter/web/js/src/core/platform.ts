export function detectOs(): string {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) {
    return 'Android';
  }
  if (/iphone|ipad|ipod/i.test(ua)) {
    return 'iOS';
  }
  if (/windows/i.test(ua)) {
    return 'Windows';
  }
  if (/macintosh|mac os/i.test(ua)) {
    return 'Mac OS';
  }
  if (/linux/i.test(ua)) {
    return 'Linux';
  }
  return '';
}

export function isMobileDevice(): boolean {
  if (navigator.maxTouchPoints && navigator.maxTouchPoints > 1) {
    return true;
  }
  return /android|iphone|ipad|ipod|iemobile|opera mini/i.test(
    navigator.userAgent
  );
}

export function screenInfo(): string {
  return JSON.stringify({
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio
  });
}
