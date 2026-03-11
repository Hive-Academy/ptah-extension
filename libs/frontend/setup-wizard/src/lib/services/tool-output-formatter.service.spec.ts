import { TestBed } from '@angular/core/testing';
import { ToolOutputFormatterService } from './tool-output-formatter.service';

describe('ToolOutputFormatterService', () => {
  let service: ToolOutputFormatterService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ToolOutputFormatterService],
    });

    service = TestBed.inject(ToolOutputFormatterService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('stripSystemReminders', () => {
    it('should remove system-reminder tags and their content', () => {
      const input =
        'Before <system-reminder>secret content here</system-reminder> After';
      const result = service.stripSystemReminders(input);
      expect(result).toBe('Before  After');
    });

    it('should remove multiline system-reminder blocks', () => {
      const input =
        'Start\n<system-reminder>\nline1\nline2\n</system-reminder>\nEnd';
      const result = service.stripSystemReminders(input);
      expect(result).toBe('Start\n\nEnd');
    });

    it('should handle content without system-reminder tags', () => {
      const input = 'Normal content without tags';
      const result = service.stripSystemReminders(input);
      expect(result).toBe('Normal content without tags');
    });

    it('should remove multiple system-reminder blocks', () => {
      const input =
        'A <system-reminder>x</system-reminder> B <system-reminder>y</system-reminder> C';
      const result = service.stripSystemReminders(input);
      expect(result).toBe('A  B  C');
    });
  });

  describe('stripLineNumbers', () => {
    it('should remove line number prefixes from content', () => {
      const input =
        '     1\u2192import { Module }\n     2\u2192export class Foo {}';
      const result = service.stripLineNumbers(input);
      expect(result).toBe('import { Module }\nexport class Foo {}');
    });

    it('should handle lines without line number prefixes', () => {
      const input = 'regular line\nanother line';
      const result = service.stripLineNumbers(input);
      expect(result).toBe('regular line\nanother line');
    });

    it('should handle mixed lines with and without prefixes', () => {
      const input =
        '     1\u2192import { A }\nno prefix here\n     3\u2192export {}';
      const result = service.stripLineNumbers(input);
      expect(result).toBe('import { A }\nno prefix here\nexport {}');
    });
  });

  describe('getLanguageFromPath', () => {
    it('should return correct language for TypeScript files', () => {
      expect(service.getLanguageFromPath('src/app/main.ts')).toBe('typescript');
    });

    it('should return correct language for Python files', () => {
      expect(service.getLanguageFromPath('scripts/run.py')).toBe('python');
    });

    it('should return correct language for JSON files', () => {
      expect(service.getLanguageFromPath('package.json')).toBe('json');
    });

    it('should return correct language for Kotlin files', () => {
      expect(service.getLanguageFromPath('Main.kt')).toBe('kotlin');
    });

    it('should return correct language for Swift files', () => {
      expect(service.getLanguageFromPath('ViewController.swift')).toBe('swift');
    });

    it('should return correct language for Prisma files', () => {
      expect(service.getLanguageFromPath('schema.prisma')).toBe('prisma');
    });

    it('should return correct language for Vue files', () => {
      expect(service.getLanguageFromPath('App.vue')).toBe('vue');
    });

    it('should return correct language for Svelte files', () => {
      expect(service.getLanguageFromPath('Component.svelte')).toBe('svelte');
    });

    it('should return correct language for Dockerfile', () => {
      expect(service.getLanguageFromPath('build.dockerfile')).toBe(
        'dockerfile'
      );
    });

    it('should return correct language for Terraform files', () => {
      expect(service.getLanguageFromPath('main.tf')).toBe('hcl');
    });

    it('should return empty string for unknown extensions', () => {
      expect(service.getLanguageFromPath('file.xyz')).toBe('');
    });

    it('should return empty string for files without extension', () => {
      expect(service.getLanguageFromPath('Makefile')).toBe('');
    });

    it('should handle Windows-style backslash paths', () => {
      expect(service.getLanguageFromPath('D:\\projects\\src\\main.ts')).toBe(
        'typescript'
      );
    });
  });

  describe('extractMCPContent', () => {
    it('should extract text from MCP content blocks', () => {
      const input = JSON.stringify([
        { type: 'text', text: 'First line' },
        { type: 'text', text: 'Second line' },
      ]);
      const result = service.extractMCPContent(input);
      expect(result).toBe('First line\nSecond line');
    });

    it('should return original content when not MCP format', () => {
      const input = 'Just plain text';
      const result = service.extractMCPContent(input);
      expect(result).toBe('Just plain text');
    });

    it('should return original content for non-array JSON', () => {
      const input = JSON.stringify({ type: 'text', text: 'Not an array' });
      const result = service.extractMCPContent(input);
      expect(result).toBe(input);
    });

    it('should return original content for invalid JSON starting with [', () => {
      const input = '[not valid json';
      const result = service.extractMCPContent(input);
      expect(result).toBe(input);
    });

    it('should return original for arrays that are not MCP format', () => {
      const input = JSON.stringify([1, 2, 3]);
      const result = service.extractMCPContent(input);
      expect(result).toBe(input);
    });
  });

  describe('getToolGroupLabel', () => {
    it('should extract ptah API call from tool input content', () => {
      const toolInput = `const result = await ptah.workspace.analyze();`;
      const result = service.getToolGroupLabel('execute_code', toolInput);
      expect(result).toBe('ptah.workspace.analyze()');
    });

    it('should extract ptah API call with arguments', () => {
      const toolInput = `await ptah.files.readFile('/src/main.ts')`;
      const result = service.getToolGroupLabel('execute_code', toolInput);
      expect(result).toBe("ptah.files.readFile('/src/main.ts')");
    });

    it('should fall back to tool name when no ptah pattern matches', () => {
      const toolInput = 'some random code without ptah calls';
      const result = service.getToolGroupLabel('execute_code', toolInput);
      expect(result).toBe('execute_code');
    });

    it('should fall back to tool name when no tool input provided', () => {
      const result = service.getToolGroupLabel('read_file');
      expect(result).toBe('read_file');
    });

    it('should fall back to tool name with undefined input', () => {
      const result = service.getToolGroupLabel('write_file', undefined);
      expect(result).toBe('write_file');
    });
  });

  describe('formatToolInput', () => {
    it('should format JSON content with syntax highlighting', () => {
      const rawJson = JSON.stringify({ key: 'value' });
      const result = service.formatToolInput(rawJson, rawJson);
      expect(result).toContain('```json');
      expect(result).toContain('"key": "value"');
    });

    it('should detect language from file_path in JSON', () => {
      const rawJson = JSON.stringify({
        file_path: 'src/main.ts',
        content: 'const x = 1;',
      });
      const result = service.formatToolInput(rawJson, rawJson);
      expect(result).toContain('```typescript');
      expect(result).toContain('const x = 1;');
    });

    it('should wrap non-JSON content in generic code block', () => {
      const content = 'plain text content';
      const result = service.formatToolInput(content, content);
      expect(result).toBe('```\nplain text content\n```');
    });
  });

  describe('formatToolResult', () => {
    it('should return placeholder for empty content', () => {
      const result = service.formatToolResult('');
      expect(result).toBe('_No output_');
    });

    it('should apply MCP extraction for execute_code tool', () => {
      const mcpContent = JSON.stringify([
        { type: 'text', text: 'Extracted content' },
      ]);
      const result = service.formatToolResult(mcpContent, 'execute_code');
      expect(result).toContain('Extracted content');
      expect(result).not.toContain('[{');
    });

    it('should detect JSON content and wrap in json code block', () => {
      const jsonContent = JSON.stringify({ status: 'ok' });
      const result = service.formatToolResult(jsonContent);
      expect(result).toContain('```json');
    });

    it('should detect code content and wrap in code block', () => {
      const codeContent =
        'import { Module } from "@angular/core";\nconst x = {};';
      const result = service.formatToolResult(codeContent);
      expect(result).toContain('```\n');
    });

    it('should return markdown for plain text', () => {
      const result = service.formatToolResult('Simple text result');
      expect(result).toBe('Simple text result');
    });

    it('should strip system-reminder tags from results', () => {
      const content = 'Before <system-reminder>hidden</system-reminder> After';
      const result = service.formatToolResult(content);
      expect(result).not.toContain('system-reminder');
      expect(result).not.toContain('hidden');
    });

    it('should strip line numbers from results', () => {
      const content = '     1\u2192import { A }';
      const result = service.formatToolResult(content);
      expect(result).toContain('import { A }');
      expect(result).not.toMatch(/^\s*1\u2192/);
    });

    it.skip('should unescape string literals (\\n to newlines)', () => {
      const content = 'Line 1\\\\nLine 2\\\\nLine 3';
      const result = service.formatToolResult(content);
      expect(result).toContain('Line 1\nLine 2\nLine 3');
      expect(result.includes('\\n')).toBe(false);
    });

    it.skip('should unescape multiple escape sequences', () => {
      const content = 'Tab\\\\there\\\\nNewline\\\\rReturn\\\\"Quote';
      const result = service.formatToolResult(content);
      expect(result).toContain('\t');
      expect(result).toContain('\n');
      expect(result).toContain('\r');
      expect(result).toContain('"');
      // Should not contain literal backslash-n
      expect(result.includes('\\n')).toBe(false);
      expect(result.includes('\\t')).toBe(false);
    });
  });

  describe('formatTextContent', () => {
    it('should return empty string for empty content', () => {
      const result = service.formatTextContent('');
      expect(result).toBe('');
    });

    it.skip('should unescape string literals in text content', () => {
      const content = 'Project Type\\\\nReact\\\\nCustom entry';
      const result = service.formatTextContent(content);
      expect(result).toContain('Project Type\nReact\nCustom entry');
      expect(result.includes('\\n')).toBe(false);
    });

    it('should preserve code blocks in text content', () => {
      const content = '```typescript\nconst x = 1;\n```';
      const result = service.formatTextContent(content);
      expect(result).toBe('```typescript\nconst x = 1;\n```');
    });

    it.skip('should unescape newlines and tabs', () => {
      const content = 'Line 1\\\\nLine 2\\\\tTabbed';
      const result = service.formatTextContent(content);
      expect(result).toBe('Line 1\nLine 2\tTabbed');
    });

    it('should handle content without escape sequences', () => {
      const content = 'Normal text without escapes';
      const result = service.formatTextContent(content);
      expect(result).toBe('Normal text without escapes');
    });
  });
});
