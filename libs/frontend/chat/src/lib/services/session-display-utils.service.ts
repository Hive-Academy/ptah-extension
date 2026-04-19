import { Injectable } from '@angular/core';
import type { ChatSessionSummary } from '@ptah-extension/shared';

/**
 * SessionDisplayUtils - Shared utility service for session display formatting
 *
 * Extracted from AppShellComponent and OrchestraCanvasComponent to eliminate
 * duplicated logic for date formatting and session name display.
 *
 * Pure utility methods with no state or signals.
 */
@Injectable({ providedIn: 'root' })
export class SessionDisplayUtils {
  /** Pattern to detect UUID-style session names (fallback names) */
  readonly UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /**
   * Format a date into a human-readable relative string.
   *
   * Rules:
   *   < 1 minute:    "Just now"
   *   < 1 hour:      "Xm ago"    (e.g., "5m ago")
   *   < 24 hours:    "Xh ago"    (e.g., "2h ago")
   *   Yesterday:     "Yesterday"
   *   Current week:  "Mon", "Tue", etc.
   *   Current year:  "Jan 15"
   *   Previous year: "Jan 15, 2025"
   */
  formatRelativeDate(date: Date | string | number): string {
    if (!date || (typeof date === 'number' && date <= 0)) return '';
    const now = new Date();
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    const diffMs = now.getTime() - d.getTime();
    if (diffMs < 0) return 'Just now';
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;

    // Check if yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';

    // Current week: show day name
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays < 7) {
      return d.toLocaleDateString('en-US', { weekday: 'short' });
    }

    // Current year: "Jan 15"
    if (d.getFullYear() === now.getFullYear()) {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    // Previous year: "Jan 15, 2025"
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  /**
   * Get display name for a session.
   * Falls back to truncated UUID if no proper title.
   * Handles `<command-message>` tags from CLI system output.
   */
  getSessionDisplayName(session: ChatSessionSummary): string {
    const name = session.name;

    // Check if name is a UUID (fallback case)
    if (this.UUID_PATTERN.test(name)) {
      // Return truncated UUID with "Session" prefix
      return `Session ${name.substring(0, 8)}...`;
    }

    // Check if name starts with "<command-message>" (Claude CLI system output)
    if (name.startsWith('<command-message>')) {
      // Extract meaningful content or use fallback
      const cleaned = name.replace(/<\/?command-message>/g, '').trim();
      if (cleaned.length > 0 && cleaned.length < 80) {
        return cleaned;
      }
      return `Session ${session.id.substring(0, 8)}...`;
    }

    // Return the name, truncated if too long
    if (name.length > 50) {
      return name.substring(0, 47) + '...';
    }

    return name;
  }
}
