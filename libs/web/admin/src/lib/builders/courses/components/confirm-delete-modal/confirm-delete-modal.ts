import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';

/**
 * ConfirmDeleteModal — a presentational confirmation dialog for the three
 * soft-delete actions on the courses surface (course, module, lesson).
 *
 * ⚠️ IT MAKES NO REQUEST, AND THAT IS THE DIFFERENCE FROM `DeletePackModal`.
 * That component owns its own `deletePack()` call because there is exactly one
 * thing it can delete; here there are three endpoints on two screens, so the
 * parent keeps the call and this component keeps the chrome. `deleting` and
 * `errorMessage` are inputs rather than internal signals for the same reason —
 * the parent is the only thing that knows whether a request is in flight.
 *
 * ⚠️ NO TYPE-THE-SLUG STEP, DELIBERATELY. `DeletePackModal` asks for it because
 * a pack row is the ONLY record that a repository was ever shared with a
 * cohort — losing it loses information held nowhere else. Every delete behind
 * this dialog is a soft delete (AD-5) that a restore endpoint or a re-create
 * undoes, so a friction step here would be ceremony rather than a guard.
 */
@Component({
  selector: 'ptah-admin-confirm-delete-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './confirm-delete-modal.html',
})
export class ConfirmDeleteModal {
  /** Show/hide. The parent owns the signal. */
  public readonly open = input<boolean>(false);

  /** Dialog heading, e.g. `Delete Course`. */
  public readonly title = input<string>('Delete');

  /** The name of the row being deleted, shown verbatim in a bordered block. */
  public readonly subject = input<string>('');

  /** A second, muted line under the subject — a slug, a module title. */
  public readonly detail = input<string | null>(null);

  /** What the delete actually does. Always states that it is reversible. */
  public readonly consequence = input<string>(
    'This is a soft delete. The row is hidden from members and can be brought back.',
  );

  /** Label on the confirm button. */
  public readonly confirmLabel = input<string>('Delete');

  /** True while the parent's request is in flight. Disables every control. */
  public readonly deleting = input<boolean>(false);

  /** A message the parent extracted from a failed request, or `null`. */
  public readonly errorMessage = input<string | null>(null);

  /** The user asked to close without deleting. */
  public readonly closeModal = output<void>();

  /** The user confirmed. The PARENT issues the request. */
  public readonly confirmed = output<void>();

  protected onCloseClick(): void {
    if (this.deleting()) return;
    this.closeModal.emit();
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    if (this.deleting()) return;
    this.confirmed.emit();
  }
}
