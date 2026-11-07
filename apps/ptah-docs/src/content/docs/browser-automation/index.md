---
title: Browser Automation
description: Let agents drive a Chrome browser — navigate, click, type, read pages, take screenshots, record GIFs, and read network traffic.
---

# Browser Automation

The Ptah MCP server gives agents a set of browser tools. The tools control a Google Chrome or Chromium browser on your computer through the Chrome DevTools Protocol.

:::note
Install Google Chrome or Chromium to use the browser tools. If PtahCode cannot find a browser, the tool returns the error "Chrome/Chromium not found".
:::

## Tools

| Tool                        | What it does                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `ptah_browser_navigate`     | Opens a URL and returns the final URL and page title. Starts a browser session if none exists    |
| `ptah_browser_content`      | Returns the HTML and the text of the page, or of one element (`selector`)                        |
| `ptah_browser_click`        | Clicks an element by CSS selector                                                                |
| `ptah_browser_type`         | Types text into an input element by CSS selector                                                 |
| `ptah_browser_evaluate`     | Runs a JavaScript expression in the page. `await` is supported. Maximum size is 64 KB            |
| `ptah_browser_screenshot`   | Takes a screenshot of the viewport or the full page                                              |
| `ptah_browser_network`      | Returns the captured requests: URL, method, status, type, and size                               |
| `ptah_browser_record_start` | Starts a GIF recording of the browser                                                            |
| `ptah_browser_record_stop`  | Stops the recording and saves the GIF. Returns the file path, frame count, duration, and size    |
| `ptah_browser_status`       | Returns the session state, URL, title, uptime, time until auto-close, headless mode, and viewport |
| `ptah_browser_close`        | Closes the browser session                                                                       |

## Browser sessions

- The first browser tool call starts a session.
- The `headless` and `viewport` options of `ptah_browser_navigate` apply only when a new session starts. The default is a visible window at 1920x1080.
- A session closes after 5 minutes without activity in headless mode, or 15 minutes in visible mode.
- A session closes after a maximum of 30 minutes.

## Allowed URLs

- `http:` and `https:` URLs are allowed.
- `file:` URLs are allowed only for files inside the workspace.
- `localhost`, `127.0.0.1`, `0.0.0.0`, and `[::1]` are blocked by default.
- `chrome:`, `about:`, `data:`, and `javascript:` URLs are blocked.

To let agents open local dev servers, open **Settings → Advanced → MCP & Browser** and turn on **Allow localhost**. The setting key is `browser.allowLocalhost`.

## Screenshots

- The default format is JPEG at quality 60. Use `format: "png"` for a lossless image. WebP is also available.
- Set `fullPage: true` to capture the full page.
- Set `saveTo` to a filename to save the image in `.ptah/screenshots/` in the workspace. You can also give an absolute path.

## Recordings

- A recording keeps a maximum of `maxFrames` frames (default 500, about 2.5 minutes).
- `frameDelay` sets the delay between frames in the GIF (default 200 ms).
- GIFs are saved to `browser.recordingDir`. When this setting is empty, GIFs go to `.ptah/recordings/` in the workspace.

## Network

PtahCode keeps the most recent 500 requests of the session. `ptah_browser_network` returns 50 requests by default. Use `limit` to get up to 500.
