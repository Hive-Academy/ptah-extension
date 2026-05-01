export function injectCampaignFooter(
  html: string,
  postalAddress: string,
  unsubscribeUrl: string,
): string {
  const footer = `
<div style="margin-top:40px;padding:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:center;">
  <p>You are receiving this email because you signed up for Ptah.</p>
  <p>${postalAddress}</p>
  <p><a href="${unsubscribeUrl}" style="color:#6b7280;">Unsubscribe</a></p>
</div>`;
  // Append before </body> if present, else append at end
  if (html.includes('</body>')) {
    return html.replace('</body>', `${footer}</body>`);
  }
  return html + footer;
}
