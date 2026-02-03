/**
 * CustomPromptEditorComponent - Editor for user-created custom prompt sections
 *
 * TASK_2025_135 Batch 6: Frontend components for prompt harness system
 *
 * Complexity Level: 2 (Medium - form state, validation, CRUD operations)
 * Patterns Applied:
 * - Signal-based state management
 * - OnPush change detection
 * - Input/Output bindings for parent communication
 * - Live token estimation
 *
 * Responsibilities:
 * - List existing custom prompt sections
 * - Add/Edit/Delete custom sections
 * - Validate content (max 2000 tokens ~ 8000 chars)
 * - Live token count display
 */
import {
  Component,
  signal,
  computed,
  input,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Plus,
  Trash2,
  Edit2,
  X,
  Save,
  AlertTriangle,
} from 'lucide-angular';
import type { UserPromptSectionInfo } from '@ptah-extension/shared';

/**
 * Max character limit (approx 2000 tokens at ~4 chars/token)
 */
const MAX_CHARS = 8000;

/**
 * Estimate token count from character count (rough approximation)
 * Claude typically uses ~4 characters per token for English text
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Generate a unique ID for new sections using crypto.randomUUID()
 * This is collision-safe even under rapid creation scenarios
 */
function generateSectionId(): string {
  return `custom_${crypto.randomUUID()}`;
}

@Component({
  selector: 'ptah-custom-prompt-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  templateUrl: './custom-prompt-editor.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomPromptEditorComponent {
  // Lucide icons
  readonly PlusIcon = Plus;
  readonly Trash2Icon = Trash2;
  readonly Edit2Icon = Edit2;
  readonly XIcon = X;
  readonly SaveIcon = Save;
  readonly AlertTriangleIcon = AlertTriangle;

  // Input from parent (bound sections list)
  readonly sections = input<UserPromptSectionInfo[]>([]);

  // Output event when sections change
  readonly sectionsChange = output<UserPromptSectionInfo[]>();

  // Output event for save errors
  readonly saveError = output<string>();

  // Editor state
  readonly isEditorOpen = signal(false);
  readonly editingSection = signal<UserPromptSectionInfo | null>(null);
  readonly isSaving = signal(false);

  // Form fields
  readonly editName = signal('');
  readonly editContent = signal('');
  readonly editPriority = signal(50);
  readonly editEnabled = signal(true);

  // Computed: estimated token count for current content
  readonly estimatedTokens = computed(() => estimateTokens(this.editContent()));

  // Computed: whether content exceeds limit
  readonly isOverLimit = computed(() => this.editContent().length > MAX_CHARS);

  // Computed: character count display
  readonly charCount = computed(() => this.editContent().length);

  // Computed: whether form is valid
  readonly isFormValid = computed(() => {
    const name = this.editName().trim();
    const content = this.editContent().trim();
    return name.length > 0 && content.length > 0 && !this.isOverLimit();
  });

  // Computed: whether we're creating new or editing existing
  readonly isNewSection = computed(() => {
    const editing = this.editingSection();
    if (!editing) return true;
    // Check if section exists in current list
    return !this.sections().some((s) => s.id === editing.id);
  });

  /**
   * Open editor to create a new section
   */
  addSection(): void {
    const newSection: UserPromptSectionInfo = {
      id: generateSectionId(),
      name: '',
      content: '',
      enabled: true,
      priority: 50,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.editingSection.set(newSection);
    this.editName.set('');
    this.editContent.set('');
    this.editPriority.set(50);
    this.editEnabled.set(true);
    this.isEditorOpen.set(true);
  }

  /**
   * Open editor to edit existing section
   */
  editSection(section: UserPromptSectionInfo): void {
    this.editingSection.set(section);
    this.editName.set(section.name);
    this.editContent.set(section.content);
    this.editPriority.set(section.priority);
    this.editEnabled.set(section.enabled);
    this.isEditorOpen.set(true);
  }

  /**
   * Save the current section (create or update)
   * Sets isSaving state and emits change - parent should call confirmSave() or handleSaveError()
   */
  saveSection(): void {
    if (!this.isFormValid() || this.isSaving()) {
      return;
    }

    const editing = this.editingSection();
    if (!editing) {
      return;
    }

    this.isSaving.set(true);

    const now = Date.now();
    const updatedSection: UserPromptSectionInfo = {
      ...editing,
      name: this.editName().trim(),
      content: this.editContent().trim(),
      priority: this.editPriority(),
      enabled: this.editEnabled(),
      updatedAt: now,
    };

    const currentSections = this.sections();
    let newSections: UserPromptSectionInfo[];

    // Check if this is an update or create
    const existingIndex = currentSections.findIndex((s) => s.id === editing.id);
    if (existingIndex >= 0) {
      // Update existing
      newSections = [...currentSections];
      newSections[existingIndex] = updatedSection;
    } else {
      // Create new
      updatedSection.createdAt = now;
      newSections = [...currentSections, updatedSection];
    }

    // Sort by priority (lower first)
    newSections.sort((a, b) => a.priority - b.priority);

    // Emit updated sections - parent will call confirmSave() or handleSaveError()
    this.sectionsChange.emit(newSections);
  }

  /**
   * Called by parent when save is successful
   */
  confirmSave(): void {
    this.isSaving.set(false);
    this.closeEditor();
  }

  /**
   * Called by parent when save fails
   */
  handleSaveError(error: string): void {
    this.isSaving.set(false);
    this.saveError.emit(error);
  }

  /**
   * Delete a section by ID
   */
  deleteSection(sectionId: string): void {
    const currentSections = this.sections();
    const newSections = currentSections.filter((s) => s.id !== sectionId);
    this.sectionsChange.emit(newSections);

    // Close editor if we're editing the deleted section
    if (this.editingSection()?.id === sectionId) {
      this.closeEditor();
    }
  }

  /**
   * Toggle section enabled/disabled directly in list
   */
  toggleSectionEnabled(sectionId: string): void {
    const currentSections = this.sections();
    const newSections = currentSections.map((s) =>
      s.id === sectionId
        ? { ...s, enabled: !s.enabled, updatedAt: Date.now() }
        : s
    );
    this.sectionsChange.emit(newSections);
  }

  /**
   * Close the editor without saving
   */
  closeEditor(): void {
    this.isEditorOpen.set(false);
    this.editingSection.set(null);
    this.editName.set('');
    this.editContent.set('');
    this.editPriority.set(50);
    this.editEnabled.set(true);
  }

  /**
   * Track function for ngFor
   */
  trackBySection(index: number, section: UserPromptSectionInfo): string {
    return section.id;
  }
}
