import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';

export interface ReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

export interface GitHubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  html_url: string;
  assets: ReleaseAsset[];
}

export interface PlatformAsset {
  label: string;
  fileName: string;
  downloadUrl: string;
  size: string;
}

export interface ParsedRelease {
  version: string;
  tagName: string;
  name: string;
  publishedAt: string;
  releaseUrl: string;
  windows: PlatformAsset[];
  macos: PlatformAsset[];
  linux: PlatformAsset[];
}

const GITHUB_API =
  'https://api.github.com/repos/Hive-Academy/ptah-extension/releases';

@Injectable({ providedIn: 'root' })
export class GitHubReleaseService {
  private readonly http = inject(HttpClient);

  readonly releases = signal<ParsedRelease[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  fetchReleases(count = 3): void {
    this.loading.set(true);
    this.error.set(null);

    this.http
      .get<GitHubRelease[]>(GITHUB_API, {
        params: { per_page: count.toString() },
      })
      .subscribe({
        next: (data) => {
          this.releases.set(data.map((r) => this.parseRelease(r)));
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(
            err.status === 403
              ? 'GitHub API rate limit reached. Please try again later.'
              : 'Failed to load releases. Please try again.',
          );
          this.loading.set(false);
        },
      });
  }

  private parseRelease(release: GitHubRelease): ParsedRelease {
    const version = release.tag_name.replace('electron-v', '');
    const installAssets = release.assets.filter(
      (a) => !a.name.endsWith('.yml') && !a.name.endsWith('.yaml'),
    );

    return {
      version,
      tagName: release.tag_name,
      name: release.name,
      publishedAt: release.published_at,
      releaseUrl: release.html_url,
      windows: this.filterPlatform(installAssets, 'windows'),
      macos: this.filterPlatform(installAssets, 'macos'),
      linux: this.filterPlatform(installAssets, 'linux'),
    };
  }

  private filterPlatform(
    assets: ReleaseAsset[],
    platform: 'windows' | 'macos' | 'linux',
  ): PlatformAsset[] {
    return assets
      .filter((a) => this.matchesPlatform(a.name, platform))
      .map((a) => ({
        label: this.getAssetLabel(a.name, platform),
        fileName: a.name,
        downloadUrl: a.browser_download_url,
        size: this.formatSize(a.size),
      }));
  }

  private matchesPlatform(
    name: string,
    platform: 'windows' | 'macos' | 'linux',
  ): boolean {
    const lower = name.toLowerCase();
    switch (platform) {
      case 'windows':
        return lower.endsWith('.exe');
      case 'macos':
        return lower.endsWith('.dmg') || lower.includes('-mac.zip');
      case 'linux':
        return lower.endsWith('.appimage') || lower.endsWith('.deb');
    }
  }

  private getAssetLabel(
    name: string,
    platform: 'windows' | 'macos' | 'linux',
  ): string {
    const lower = name.toLowerCase();
    if (platform === 'windows') return 'Windows Installer (.exe)';
    if (platform === 'macos') {
      if (lower.endsWith('.dmg')) return 'macOS Apple Silicon (.dmg)';
      return 'macOS Apple Silicon (.zip)';
    }
    if (lower.endsWith('.appimage')) return 'Linux AppImage';
    if (lower.endsWith('.deb')) return 'Debian / Ubuntu (.deb)';
    return name;
  }

  private formatSize(bytes: number): string {
    const mb = bytes / (1024 * 1024);
    return mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
  }
}
