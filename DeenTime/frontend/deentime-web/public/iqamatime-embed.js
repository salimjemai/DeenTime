(() => {
  if (window.__iqamaTimeEmbedReady) return;
  window.__iqamaTimeEmbedReady = true;

  const frames = () => Array.from(document.querySelectorAll('iframe[data-iqamatime-auto-height]'));
  const requestMeasurement = frame => {
    try {
      const origin = new URL(frame.src, document.baseURI).origin;
      frame.contentWindow?.postMessage({ type: 'iqamatime:measure-widget' }, origin);
    } catch {
      // Leave the safe fallback height in place when a malformed URL is supplied.
    }
  };

  window.addEventListener('message', event => {
    const data = event.data;
    if (!data || data.type !== 'iqamatime:widget-resize') return;
    const frame = frames().find(candidate => candidate.contentWindow === event.source);
    if (!frame) return;

    let origin;
    try {
      origin = new URL(frame.src, document.baseURI).origin;
    } catch {
      return;
    }
    if (event.origin !== origin) return;

    const requestedHeight = Math.round(Number(data.height));
    if (!Number.isFinite(requestedHeight)) return;
    frame.style.height = `${Math.min(1600, Math.max(300, requestedHeight))}px`;
  });

  const connectFrame = frame => {
    if (frame.dataset.iqamatimeConnected === 'true') return;
    frame.dataset.iqamatimeConnected = 'true';
    frame.addEventListener('load', () => requestMeasurement(frame));
    requestMeasurement(frame);
  };

  frames().forEach(connectFrame);
  new MutationObserver(() => frames().forEach(connectFrame)).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
