import { provideHttpClient, withXhr } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { GitHubReleaseService } from './github-release.service';

const RELEASES_URL =
  'https://api.github.com/repos/Hive-Academy/ptah-extension/releases?per_page=3';

describe('GitHubReleaseService error messages', () => {
  let service: GitHubReleaseService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withXhr()), provideHttpClientTesting()],
    });
    service = TestBed.inject(GitHubReleaseService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reports the rate limit as core.releases.rateLimited', () => {
    service.fetchReleases(3);
    http
      .expectOne(RELEASES_URL)
      .flush(null, { status: 403, statusText: 'Forbidden' });

    expect(service.error()).toEqual({ key: 'core.releases.rateLimited' });
    expect(service.loading()).toBe(false);
  });

  it('reports any other failure as core.releases.loadFailed', () => {
    service.fetchReleases(3);
    http
      .expectOne(RELEASES_URL)
      .flush(null, { status: 500, statusText: 'Server Error' });

    expect(service.error()).toEqual({ key: 'core.releases.loadFailed' });
  });

  it('clears the message when a later fetch starts', () => {
    service.fetchReleases(3);
    http
      .expectOne(RELEASES_URL)
      .flush(null, { status: 500, statusText: 'Server Error' });

    service.fetchReleases(3);
    expect(service.error()).toBeNull();
    http.expectOne(RELEASES_URL).flush([]);
    expect(service.releases()).toEqual([]);
  });
});
