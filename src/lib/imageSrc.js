export function imageSrc(url) {
  if (!url) return null
  if (url.startsWith('app-image://')) return url
  if (url.startsWith('http')) {
    // offline -> try local cache copy; protocol 404 + <img onError> hides broken images
    if (!navigator.onLine) {
      try { return 'app-image://cache/' + url.split('/').pop().split('?')[0] } catch { return url }
    }
    return url
  }
  if (url.startsWith('/products/')) return 'app-image://local/' + url.split('/').pop()
  return url
}
