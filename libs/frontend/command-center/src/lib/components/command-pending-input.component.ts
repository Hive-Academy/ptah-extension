import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import type { CommandPendingInput } from '../model/command-center.store';
import type { TribunalRosterProposal } from '../model/tribunal-roster-proposal';

@Component({
  selector: 'ptah-command-pending-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (pending(); as request) {
      <section
        class="rounded-xl border border-warning bg-base-200 p-4 text-base-content"
        aria-labelledby="pending-title"
      >
        <p class="text-xs font-semibold uppercase tracking-wide text-warning">
          Action required · {{ request.kind }}
        </p>
        <h2 id="pending-title" class="mt-2 font-semibold">
          {{ request.title }}
        </h2>
        <p class="mt-2 whitespace-pre-wrap text-sm">
          {{ request.description }}
        </p>
        @if (proposal(); as roster) {
          @if (validProposal()) {
            <p class="mt-3 text-sm">
              Tribunal mode: {{ roster.move }} · Rounds: {{ roster.rounds }}
            </p>
            <p class="mt-1 text-sm">Objective: {{ roster.objective }}</p>
            <ul class="mt-2 list-inside list-disc text-sm">
              @for (lane of roster.lanes; track lane.laneId) {
                <li>
                  {{ lane.displayName }} · {{ lane.family }} · {{ lane.cli }}
                  @if (lane.role) {
                    · {{ lane.role }}
                  }
                </li>
              }
            </ul>
            <p class="mt-2 text-xs">
              Confirm requires a click or keyboard activation here. Voice cannot
              confirm.
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                class="btn btn-outline min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
                [disabled]="declinedIds().has(roster.proposalId)"
                (click)="declineRoster(roster.proposalId)"
              >
                Decline
              </button>
              <button
                type="button"
                class="btn btn-warning min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
                [disabled]="confirmedId() === roster.proposalId || timedOut()"
                (click)="confirmRoster(roster)"
                (keydown)="confirmFromKey($event, roster)"
              >
                Confirm Tribunal
              </button>
            </div>
          } @else {
            <p class="mt-3 font-semibold text-error" role="status">
              Invalid Tribunal proposal. It cannot be confirmed.
            </p>
            <button
              type="button"
              class="btn btn-outline mt-3 min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
              [disabled]="declinedIds().has(roster.proposalId)"
              (click)="declineRoster(roster.proposalId)"
            >
              Decline
            </button>
          }
        } @else {
          @if (request.kind === 'question') {
            @if (choices().length) {
              <div
                class="mt-3 flex flex-wrap gap-2"
                aria-label="Answer choices"
              >
                @for (choice of choices(); track choice) {
                  <button
                    type="button"
                    class="btn btn-outline min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
                    [disabled]="
                      timedOut() ||
                      respondedIds().has(request.id) ||
                      inFlightIds().has(request.id)
                    "
                    (click)="respond(request.id, choice)"
                  >
                    {{ choice }}
                  </button>
                }
              </div>
            }
            <label class="mt-3 block text-sm" for="pending-answer"
              >Answer</label
            >
            <input
              #answerInput
              id="pending-answer"
              class="input input-bordered mt-1 min-h-11 w-full"
              [value]="answer()"
              (input)="answer.set(answerInput.value)"
              [disabled]="
                timedOut() ||
                respondedIds().has(request.id) ||
                inFlightIds().has(request.id)
              "
            />
            <button
              type="button"
              class="btn btn-warning mt-3 min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
              [disabled]="
                !answer().trim() ||
                timedOut() ||
                respondedIds().has(request.id) ||
                inFlightIds().has(request.id)
              "
              (click)="respond(request.id, answer().trim())"
            >
              Send answer
            </button>
          } @else {
            <p class="mt-2 text-xs">
              Permission requires a click or keyboard activation. Voice cannot
              approve.
            </p>
            <div class="mt-3 flex gap-2">
              <button
                type="button"
                class="btn btn-outline min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
                [disabled]="
                  timedOut() ||
                  respondedIds().has(request.id) ||
                  inFlightIds().has(request.id)
                "
                (click)="respond(request.id, 'Deny')"
              >
                Deny
              </button>
              <button
                type="button"
                class="btn btn-warning min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
                [disabled]="
                  timedOut() ||
                  respondedIds().has(request.id) ||
                  inFlightIds().has(request.id)
                "
                (click)="respond(request.id, 'Approve')"
              >
                Approve
              </button>
            </div>
          }
        }
        @if (rejectedId() === request.id) {
          <p class="mt-3 text-sm text-error" role="status">
            That answer is not accepted here. Choose Decline or try another
            answer.
          </p>
        }
        @if (timedOut()) {
          <p class="mt-3 text-sm font-semibold text-error" role="status">
            Request timed out. No action was taken.
          </p>
        }
      </section>
    }
  `,
})
export class CommandPendingInputComponent {
  public readonly pending = input<CommandPendingInput | null>(null);
  public readonly proposal = input<TribunalRosterProposal | null>(null);
  public readonly choices = input<readonly string[]>([]);
  public readonly timedOut = input(false);
  public readonly answerResult = input<{
    id: string;
    accepted: boolean;
  } | null>(null);
  public readonly answer = linkedSignal({
    source: () => this.pending()?.id,
    computation: () => '',
  });
  public readonly confirmedId = signal<string | null>(null);
  public readonly respondedIds = signal<ReadonlySet<string>>(new Set());
  public readonly inFlightIds = signal<ReadonlySet<string>>(new Set());
  public readonly rejectedId = signal<string | null>(null);
  public readonly declinedIds = signal<ReadonlySet<string>>(new Set());
  public readonly validProposal = computed(
    () => this.proposal()?.options[0] === 'Decline',
  );
  public readonly confirm = output<TribunalRosterProposal>();
  public readonly decline = output<string>();
  public readonly response = output<{ id: string; answer: string }>();

  public constructor() {
    effect(() => {
      const result = this.answerResult();
      if (!result) return;
      this.inFlightIds.update((ids) => {
        const next = new Set(ids);
        next.delete(result.id);
        return next;
      });
      if (result.accepted) {
        this.respondedIds.update((ids) => new Set([...ids, result.id]));
        this.rejectedId.set(null);
      } else {
        this.rejectedId.set(result.id);
      }
    });
  }

  public confirmRoster(roster: TribunalRosterProposal): void {
    if (
      this.timedOut() ||
      !this.validProposal() ||
      this.confirmedId() === roster.proposalId ||
      this.proposal()?.proposalId !== roster.proposalId
    )
      return;
    this.confirmedId.set(roster.proposalId);
    this.confirm.emit(roster);
  }

  public confirmFromKey(
    event: KeyboardEvent,
    roster: TribunalRosterProposal,
  ): void {
    if (
      (event.key !== 'Enter' && event.key !== ' ') ||
      event.target !== document.activeElement
    )
      return;
    event.preventDefault();
    this.confirmRoster(roster);
  }

  public declineRoster(id: string): void {
    if (this.proposal()?.proposalId !== id || this.declinedIds().has(id))
      return;
    this.declinedIds.update((ids) => new Set([...ids, id]));
    this.decline.emit(id);
  }
  public respond(id: string, answer: string): void {
    if (
      this.timedOut() ||
      this.pending()?.id !== id ||
      this.respondedIds().has(id) ||
      this.inFlightIds().has(id)
    )
      return;
    this.rejectedId.set(null);
    this.inFlightIds.update((ids) => new Set([...ids, id]));
    this.response.emit({ id, answer });
  }
}
