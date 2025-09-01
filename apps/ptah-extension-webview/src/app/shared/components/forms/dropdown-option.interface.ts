/**
 * VS Code Dropdown Option Interface
 * - Shared type definition for dropdown options
 * - Used across all dropdown components
 */
export interface DropdownOption {
  value: string;
  label: string;
  description?: string;
  icon?: string;
  disabled?: boolean;
  group?: string;
}
