window.securityProbe = (async () => {
  let evalBlocked = false;
  try {
    eval('window.evalExecuted = true');
  } catch (error) {
    evalBlocked = error instanceof EvalError;
  }
  const script = document.createElement('script');
  script.textContent = 'window.inlineExecuted = true';
  document.head.appendChild(script);
  let microphone = false;
  let microphoneError;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    microphone = stream.getAudioTracks().length > 0;
    stream.getTracks().forEach((track) => track.stop());
  } catch (error) {
    microphoneError = String(error);
  }
  return {
    policy: document.querySelector('meta[http-equiv="Content-Security-Policy"]')
      .content,
    evalBlocked,
    inlineBlocked: window.inlineExecuted !== true,
    theme: document.documentElement.dataset.theme,
    microphone,
    microphoneError,
  };
})();
