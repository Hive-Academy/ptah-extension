import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import {
  AdminBuildersApiService,
  AdminCommunityTopic,
  AdminCommunityTopicsResponse,
  ReviewQueueItem,
  ReviewQueueResponse,
} from '../../services/admin-builders-api.service';
import { CommunityView } from './community-view';

function topic(
  overrides: Partial<AdminCommunityTopic> = {},
): AdminCommunityTopic {
  return {
    id: 101,
    title: 'Welcome thread',
    slug: 'welcome-thread',
    postsCount: 5,
    lastPostedAt: '2026-08-01T00:00:00.000Z',
    categoryName: 'General',
    ...overrides,
  };
}

function topicsResponse(
  overrides: Partial<AdminCommunityTopicsResponse> = {},
): AdminCommunityTopicsResponse {
  return {
    communityUrl: 'https://community.ptah.live',
    topics: [],
    enabled: true,
    ...overrides,
  };
}

function reviewItem(overrides: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
  return {
    id: 1,
    type: 'flag',
    topicTitle: 'Reported post',
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function reviewResponse(
  overrides: Partial<ReviewQueueResponse> = {},
): ReviewQueueResponse {
  return {
    items: [],
    count: 0,
    reviewUrl: 'https://community.ptah.live/review',
    ...overrides,
  };
}

describe('CommunityView', () => {
  let fixture: ComponentFixture<CommunityView>;
  let api: {
    listCommunityTopics: jest.Mock;
    getReviewQueue: jest.Mock;
  };

  const createComponent = (): void => {
    fixture = TestBed.createComponent(CommunityView);
    fixture.detectChanges();
  };

  beforeEach(() => {
    api = {
      listCommunityTopics: jest.fn().mockReturnValue(of(topicsResponse())),
      getReviewQueue: jest.fn().mockReturnValue(of(reviewResponse())),
    };
    TestBed.configureTestingModule({
      imports: [CommunityView],
      providers: [{ provide: AdminBuildersApiService, useValue: api }],
    });
  });

  describe('the two distinct empty states', () => {
    it('shows "Discourse is not configured" when enabled is false, not the generic empty-topics message', () => {
      api.listCommunityTopics.mockReturnValue(
        of(topicsResponse({ enabled: false, communityUrl: null, topics: [] })),
      );
      createComponent();

      expect(fixture.nativeElement.textContent).toContain(
        'Discourse is not configured on this server.',
      );
      expect(fixture.nativeElement.textContent).not.toContain(
        'No recent topics.',
      );
    });

    it('shows "No recent topics" when Discourse is enabled but has nothing to show, not the disabled message', () => {
      api.listCommunityTopics.mockReturnValue(
        of(topicsResponse({ enabled: true, topics: [] })),
      );
      createComponent();

      expect(fixture.nativeElement.textContent).toContain('No recent topics.');
      expect(fixture.nativeElement.textContent).not.toContain(
        'Discourse is not configured on this server.',
      );
    });
  });

  describe('Discourse deep links', () => {
    it('builds {communityUrl}/t/{slug}/{id} for each topic', () => {
      api.listCommunityTopics.mockReturnValue(
        of(
          topicsResponse({
            communityUrl: 'https://community.ptah.live/',
            topics: [topic({ id: 42, slug: 'hello-world' })],
          }),
        ),
      );
      createComponent();

      const link: HTMLAnchorElement =
        fixture.nativeElement.querySelector('a.link-hover');
      expect(link.getAttribute('href')).toBe(
        'https://community.ptah.live/t/hello-world/42',
      );
    });

    it('renders the title as plain text, not a dead link, when there is no communityUrl', () => {
      api.listCommunityTopics.mockReturnValue(
        of(
          topicsResponse({
            communityUrl: null,
            enabled: true,
            topics: [topic({ title: 'Orphan topic' })],
          }),
        ),
      );
      createComponent();

      expect(fixture.nativeElement.querySelector('a.link-hover')).toBeNull();
      expect(fixture.nativeElement.textContent).toContain('Orphan topic');
    });
  });

  describe('review queue — an awareness count, not an action surface', () => {
    it('lists pending items with a warning tone when the queue is non-empty', () => {
      api.getReviewQueue.mockReturnValue(
        of(
          reviewResponse({
            items: [reviewItem({ topicTitle: 'Reported post' })],
            count: 1,
          }),
        ),
      );
      createComponent();

      expect(fixture.nativeElement.textContent).toContain('needs a human');
      expect(fixture.nativeElement.textContent).toContain('Reported post');
      expect(fixture.nativeElement.textContent).toContain(
        'Review in Discourse',
      );
    });

    it('shows a calm "nothing waiting" message when the queue is empty', () => {
      createComponent();

      expect(fixture.nativeElement.textContent).toContain(
        'Nothing is waiting on a moderator right now.',
      );
      expect(fixture.nativeElement.textContent).toContain('nothing waiting');
    });
  });

  it('has no moderation controls anywhere in the rendered view (read-only by construction)', () => {
    api.listCommunityTopics.mockReturnValue(
      of(topicsResponse({ topics: [topic()] })),
    );
    createComponent();

    // The only buttons this view could ever render are per-panel "Retry"
    // buttons on a load error — never a status/pin/close/unlist toggle.
    // Neither panel errored here, so there should be none at all.
    const buttons = fixture.nativeElement.querySelectorAll('button');
    expect(buttons.length).toBe(0);
  });
});
