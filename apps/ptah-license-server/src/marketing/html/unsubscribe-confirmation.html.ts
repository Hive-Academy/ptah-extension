/**
 * HTML templates for unsubscribe/resubscribe confirmation pages.
 * Minimal inline CSS for standalone delivery.
 */

export function getUnsubscribePage(params: {
  title: string;
  message: string;
  actionUrl?: string;
  actionLabel?: string;
}) {
  const { title, message, actionUrl, actionLabel } = params;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background-color: #0f172a;
            color: #f1f5f9;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
        }
        .container {
            background-color: #1e293b;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            max-width: 400px;
            text-align: center;
        }
        h1 {
            color: #d4af37;
            font-size: 24px;
            margin-bottom: 16px;
        }
        p {
            color: #94a3b8;
            font-size: 16px;
            line-height: 1.5;
            margin-bottom: 24px;
        }
        .btn {
            display: inline-block;
            background-color: #d4af37;
            color: #0a0a0a;
            padding: 12px 24px;
            border-radius: 6px;
            text-decoration: none;
            font-weight: 700;
            font-size: 14px;
            transition: background-color 0.2s;
        }
        .btn:hover {
            background-color: #f4d47c;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>${title}</h1>
        <p>${message}</p>
        ${actionUrl && actionLabel ? `<a href="${actionUrl}" class="btn">${actionLabel}</a>` : ''}
    </div>
</body>
</html>
  `.trim();
}
