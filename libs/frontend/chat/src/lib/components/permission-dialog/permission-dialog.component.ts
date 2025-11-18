import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

interface PendingPermission {
  requestId: string;
  type: string;
  details: Record<string, unknown>;
  timestamp: number;
}

@Component({
  selector: 'ptah-permission-dialog',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (permission(); as permissionData) {
    <div class="permission-dialog">
      <div class="dialog-header">
        <span class="permission-icon">🔐</span>
        <span class="permission-title">Permission Required</span>
      </div>

      <div class="dialog-content">
        <div class="permission-type">{{ permissionData.type }}</div>

        @if (permissionData.details['path']) {
        <div class="permission-detail">
          <strong>Path:</strong> {{ permissionData.details['path'] }}
        </div>
        } @if (permissionData.details['command']) {
        <div class="permission-detail">
          <strong>Command:</strong> {{ permissionData.details['command'] }}
        </div>
        }
      </div>

      <div class="dialog-actions">
        <button class="btn btn-approve" (click)="onApprove()">
          ✅ Approve
        </button>
        <button class="btn btn-deny" (click)="onDeny()">❌ Deny</button>
      </div>
    </div>
    }
  `,
  styles: [
    `
      .permission-dialog {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        min-width: 400px;
        max-width: 600px;
        background: var(--vscode-editor-background);
        border: 2px solid var(--vscode-editorWarning-foreground);
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        padding: 20px;
        z-index: 1000;
      }

      .dialog-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 16px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--vscode-panel-border);
      }

      .permission-icon {
        font-size: 24px;
      }

      .permission-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--vscode-editor-foreground);
      }

      .dialog-content {
        margin-bottom: 20px;
      }

      .permission-type {
        font-weight: 600;
        color: var(--vscode-editorWarning-foreground);
        margin-bottom: 12px;
        font-size: 14px;
      }

      .permission-detail {
        margin-bottom: 8px;
        font-size: 13px;
        color: var(--vscode-editor-foreground);
      }

      .dialog-actions {
        display: flex;
        gap: 12px;
        justify-content: flex-end;
      }

      .btn {
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: opacity 0.2s;
      }

      .btn:hover {
        opacity: 0.8;
      }

      .btn-approve {
        background: var(--vscode-testing-iconPassed);
        color: white;
      }

      .btn-deny {
        background: var(--vscode-errorForeground);
        color: white;
      }
    `,
  ],
})
export class PermissionDialogComponent {
  permission = input<PendingPermission | null>();

  approve = output<string>();
  deny = output<string>();

  onApprove(): void {
    const permission = this.permission();
    if (permission) {
      this.approve.emit(permission.requestId);
    }
  }

  onDeny(): void {
    const permission = this.permission();
    if (permission) {
      this.deny.emit(permission.requestId);
    }
  }
}
