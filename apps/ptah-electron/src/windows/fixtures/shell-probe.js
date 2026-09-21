window.securityProbe = (async () => {
  // Record what the document's own CSP actually blocked. `inlineExecuted`
  // alone cannot tell a CSP refusal from a syntax error, so every assertion
  // below is anchored on a real securitypolicyviolation event instead.
  const violations = [];
  document.addEventListener('securitypolicyviolation', (event) => {
    violations.push({
      directive: event.effectiveDirective || event.violatedDirective,
      blockedURI: event.blockedURI,
    });
  });

  let evalBlocked = false;
  try {
    eval('window.evalExecuted = true');
  } catch (error) {
    evalBlocked = error instanceof EvalError;
  }

  const script = document.createElement('script');
  script.textContent = 'window.inlineExecuted = true';
  document.head.appendChild(script);

  // img-src enforcement, without needing the network to answer. An https
  // host the policy allows produces a network error and NO violation; an http
  // host the policy denies produces a violation before any request is made.
  function probeImage(src) {
    return new Promise((resolve) => {
      const image = document.createElement('img');
      image.addEventListener('load', () => resolve());
      image.addEventListener('error', () => resolve());
      image.src = src;
      setTimeout(resolve, 2000);
    });
  }
  await probeImage('https://ptah-csp-probe.invalid/icon.png');
  await probeImage('http://ptah-csp-probe.invalid/icon.png');

  let microphone = false;
  let microphoneError;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    microphone = stream.getAudioTracks().length > 0;
    stream.getTracks().forEach((track) => track.stop());
  } catch (error) {
    microphoneError = String(error);
  }

  let camera = false;
  let cameraError;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    camera = stream.getVideoTracks().length > 0;
    stream.getTracks().forEach((track) => track.stop());
  } catch (error) {
    cameraError = String(error);
  }

  // `navigator.clipboard.writeText()` additionally requires a focused
  // document, which a hidden probe window does not have, so it cannot be the
  // assertion here. The permission query reaches the SAME check handler with
  // the same `clipboard-sanitized-write` name and needs no focus.
  let clipboardWriteState;
  try {
    clipboardWriteState = (
      await navigator.permissions.query({ name: 'clipboard-write' })
    ).state;
  } catch (error) {
    clipboardWriteState = String(error);
  }

  let microphoneState;
  try {
    microphoneState = (
      await navigator.permissions.query({ name: 'microphone' })
    ).state;
  } catch (error) {
    microphoneState = String(error);
  }

  let cameraState;
  try {
    cameraState = (await navigator.permissions.query({ name: 'camera' })).state;
  } catch (error) {
    cameraState = String(error);
  }

  return {
    policy: document.querySelector('meta[http-equiv="Content-Security-Policy"]')
      .content,
    metaCount: document.querySelectorAll(
      'meta[http-equiv="Content-Security-Policy"]',
    ).length,
    evalBlocked,
    inlineExecuted: window.inlineExecuted === true,
    violations,
    theme: document.documentElement.dataset.theme,
    microphone,
    microphoneError,
    camera,
    cameraError,
    clipboardWriteState,
    microphoneState,
    cameraState,
  };
})();
