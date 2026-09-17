const params = new URLSearchParams(window.location.search);

if (params.get('state') === 'recovery') {
  document.title = 'Ptah — Workspace recovery required';
  document.getElementById('title').textContent = 'Workspace recovery required';
  document.getElementById('detail').textContent =
    'Ptah stopped before opening workspace data to avoid using a stale copy.';
  const errorCode = document.getElementById('error-code');
  errorCode.textContent = `Error code: ${params.get('code') ?? 'startup-failed'}`;
  errorCode.hidden = false;
}
