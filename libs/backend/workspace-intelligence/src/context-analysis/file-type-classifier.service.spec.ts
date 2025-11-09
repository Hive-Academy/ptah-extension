/**
 * File Type Classifier Service Unit Tests
 */

import 'reflect-metadata';
import { FileTypeClassifierService } from './file-type-classifier.service';
import { FileType } from '../types/workspace.types';

describe('FileTypeClassifierService', () => {
  let service: FileTypeClassifierService;

  beforeEach(() => {
    service = new FileTypeClassifierService();
  });

  describe('classifyFile', () => {
    describe('Source files', () => {
      it('should classify JavaScript files as source', () => {
        const result = service.classifyFile('src/app.js');

        expect(result.type).toBe(FileType.Source);
        expect(result.language).toBe('javascript');
        expect(result.confidence).toBe(1.0);
      });

      it('should classify TypeScript files as source', () => {
        const result = service.classifyFile('src/app.ts');

        expect(result.type).toBe(FileType.Source);
        expect(result.language).toBe('typescript');
        expect(result.confidence).toBe(1.0);
      });

      it('should classify Python files as source', () => {
        const result = service.classifyFile('src/main.py');

        expect(result.type).toBe(FileType.Source);
        expect(result.language).toBe('python');
        expect(result.confidence).toBe(1.0);
      });

      it('should classify Go files as source', () => {
        const result = service.classifyFile('cmd/main.go');

        expect(result.type).toBe(FileType.Source);
        expect(result.language).toBe('go');
        expect(result.confidence).toBe(1.0);
      });

      it('should classify Rust files as source', () => {
        const result = service.classifyFile('src/lib.rs');

        expect(result.type).toBe(FileType.Source);
        expect(result.language).toBe('rust');
        expect(result.confidence).toBe(1.0);
      });

      it('should classify Java files as source', () => {
        const result = service.classifyFile('src/Main.java');

        expect(result.type).toBe(FileType.Source);
        expect(result.language).toBe('java');
        expect(result.confidence).toBe(1.0);
      });

      it('should classify C# files as source', () => {
        const result = service.classifyFile('Program.cs');

        expect(result.type).toBe(FileType.Source);
        expect(result.language).toBe('csharp');
        expect(result.confidence).toBe(1.0);
      });

      it('should classify React files as source', () => {
        const result = service.classifyFile('src/App.tsx');

        expect(result.type).toBe(FileType.Source);
        expect(result.language).toBe('typescriptreact');
        expect(result.confidence).toBe(1.0);
      });

      it('should classify CSS files as source', () => {
        const result = service.classifyFile('src/styles.css');

        expect(result.type).toBe(FileType.Source);
        expect(result.language).toBe('css');
        expect(result.confidence).toBe(1.0);
      });

      it('should classify HTML files as source', () => {
        const result = service.classifyFile('public/index.html');

        expect(result.type).toBe(FileType.Source);
        expect(result.language).toBe('html');
        expect(result.confidence).toBe(1.0);
      });
    });

    describe('Test files', () => {
      it('should classify .test.js files as test', () => {
        const result = service.classifyFile('src/app.test.js');

        expect(result.type).toBe(FileType.Test);
        expect(result.language).toBe('javascript');
        expect(result.confidence).toBe(1.0);
      });

      it('should classify .spec.ts files as test', () => {
        const result = service.classifyFile('src/app.spec.ts');

        expect(result.type).toBe(FileType.Test);
        expect(result.language).toBe('typescript');
        expect(result.confidence).toBe(1.0);
      });

      it('should classify files in __tests__ directory as test', () => {
        const result = service.classifyFile('src/__tests__/app.js');

        expect(result.type).toBe(FileType.Test);
        expect(result.confidence).toBe(1.0);
      });

      it('should classify files in test/ directory as test', () => {
        const result = service.classifyFile('test/integration.ts');

        expect(result.type).toBe(FileType.Test);
        expect(result.confidence).toBe(1.0);
      });

      it('should classify Python test files as test', () => {
        const result = service.classifyFile('tests/test_main.py');

        expect(result.type).toBe(FileType.Test);
        expect(result.confidence).toBe(1.0);
      });

      it('should classify Go test files as test', () => {
        const result = service.classifyFile('pkg/server_test.go');

        expect(result.type).toBe(FileType.Test);
        expect(result.confidence).toBe(1.0);
      });

      it('should classify Rust test files as test', () => {
        const result = service.classifyFile('src/lib_test.rs');

        expect(result.type).toBe(FileType.Test);
        expect(result.confidence).toBe(1.0);
      });

      it('should classify Java test files as test', () => {
        const result = service.classifyFile('src/test/java/AppTest.java');

        expect(result.type).toBe(FileType.Test);
        expect(result.confidence).toBe(1.0);
      });

      it('should classify e2e test files as test', () => {
        const result = service.classifyFile('e2e/app.e2e-spec.ts');

        expect(result.type).toBe(FileType.Test);
        expect(result.confidence).toBe(1.0);
      });
    });

    describe('Configuration files', () => {
      it('should classify package.json as config', () => {
        const result = service.classifyFile('package.json');

        expect(result.type).toBe(FileType.Config);
        expect(result.confidence).toBe(1.0);
      });

      it('should classify tsconfig.json as config', () => {
        const result = service.classifyFile('tsconfig.json');

        expect(result.type).toBe(FileType.Config);
        expect(result.confidence).toBe(1.0);
      });

      it('should classify webpack.config.js as config', () => {
        const result = service.classifyFile('webpack.config.js');

        expect(result.type).toBe(FileType.Config);
        expect(result.confidence).toBe(1.0);
      });

      it('should classify .eslintrc.json as config', () => {
        const result = service.classifyFile('.eslintrc.json');

        expect(result.type).toBe(FileType.Config);
        expect(result.confidence).toBe(1.0);
      });

      it('should classify .env files as config', () => {
        const result = service.classifyFile('.env');

        expect(result.type).toBe(FileType.Config);
        expect(result.confidence).toBe(1.0);
      });

      it('should classify Dockerfile as config', () => {
        const result = service.classifyFile('Dockerfile');

        expect(result.type).toBe(FileType.Config);
        expect(result.confidence).toBe(1.0);
      });

      it('should classify docker-compose.yml as config', () => {
        const result = service.classifyFile('docker-compose.yml');

        expect(result.type).toBe(FileType.Config);
        expect(result.confidence).toBe(1.0);
      });

      it('should classify nx.json as config', () => {
        const result = service.classifyFile('nx.json');

        expect(result.type).toBe(FileType.Config);
        expect(result.confidence).toBe(1.0);
      });

      it('should classify Cargo.toml as config', () => {
        const result = service.classifyFile('Cargo.toml');

        expect(result.type).toBe(FileType.Config);
        expect(result.confidence).toBe(1.0);
      });

      it('should classify go.mod as config', () => {
        const result = service.classifyFile('go.mod');

        expect(result.type).toBe(FileType.Config);
        expect(result.confidence).toBe(1.0);
      });

      it('should classify requirements.txt as config', () => {
        const result = service.classifyFile('requirements.txt');

        expect(result.type).toBe(FileType.Config);
        expect(result.confidence).toBe(1.0);
      });

      it('should classify .gitignore as config', () => {
        const result = service.classifyFile('.gitignore');

        expect(result.type).toBe(FileType.Config);
        expect(result.confidence).toBe(1.0);
      });
    });

    describe('Documentation files', () => {
      it('should classify README.md as documentation', () => {
        const result = service.classifyFile('README.md');

        expect(result.type).toBe(FileType.Documentation);
        expect(result.confidence).toBe(1.0);
      });

      it('should classify CHANGELOG.md as documentation', () => {
        const result = service.classifyFile('CHANGELOG.md');

        expect(result.type).toBe(FileType.Documentation);
        expect(result.confidence).toBe(1.0);
      });

      it('should classify LICENSE as documentation', () => {
        const result = service.classifyFile('LICENSE');

        expect(result.type).toBe(FileType.Documentation);
        expect(result.confidence).toBe(1.0);
      });

      it('should classify files in docs/ as documentation', () => {
        const result = service.classifyFile('docs/api-guide.md');

        expect(result.type).toBe(FileType.Documentation);
        expect(result.confidence).toBe(1.0);
      });

      it('should classify .txt files as documentation', () => {
        const result = service.classifyFile('notes.txt');

        expect(result.type).toBe(FileType.Documentation);
        expect(result.confidence).toBe(1.0);
      });

      it('should classify .rst files as documentation', () => {
        const result = service.classifyFile('docs/index.rst');

        expect(result.type).toBe(FileType.Documentation);
        expect(result.confidence).toBe(1.0);
      });
    });

    describe('Asset files', () => {
      it('should classify .png files as assets', () => {
        const result = service.classifyFile('assets/logo.png');

        expect(result.type).toBe(FileType.Asset);
        expect(result.confidence).toBe(1.0);
      });

      it('should classify .svg files as assets', () => {
        const result = service.classifyFile('public/icon.svg');

        expect(result.type).toBe(FileType.Asset);
        expect(result.confidence).toBe(1.0);
      });

      it('should classify .woff2 font files as assets', () => {
        const result = service.classifyFile('fonts/roboto.woff2');

        expect(result.type).toBe(FileType.Asset);
        expect(result.confidence).toBe(1.0);
      });

      it('should classify .mp4 video files as assets', () => {
        const result = service.classifyFile('media/demo.mp4');

        expect(result.type).toBe(FileType.Asset);
        expect(result.confidence).toBe(1.0);
      });

      it('should classify .zip archive files as assets', () => {
        const result = service.classifyFile('downloads/package.zip');

        expect(result.type).toBe(FileType.Asset);
        expect(result.confidence).toBe(1.0);
      });
    });

    describe('Edge cases', () => {
      it('should classify unknown extensions as source with low confidence', () => {
        const result = service.classifyFile('data.unknown');

        expect(result.type).toBe(FileType.Source);
        expect(result.confidence).toBe(0.3);
      });

      it('should handle Windows-style paths', () => {
        const result = service.classifyFile('C:\\Users\\Project\\src\\app.ts');

        expect(result.type).toBe(FileType.Source);
        expect(result.language).toBe('typescript');
      });

      it('should handle nested test directories', () => {
        const result = service.classifyFile(
          'src/components/__tests__/Button.tsx'
        );

        expect(result.type).toBe(FileType.Test);
      });

      it('should prioritize test classification over source', () => {
        const result = service.classifyFile('utils.spec.ts');

        expect(result.type).toBe(FileType.Test);
        expect(result.language).toBe('typescript');
      });

      it('should handle case-insensitive file extensions', () => {
        const result = service.classifyFile('App.TS');

        expect(result.type).toBe(FileType.Source);
        expect(result.language).toBe('typescript');
      });

      it('should handle case-insensitive directory names', () => {
        const result = service.classifyFile('SRC/__TESTS__/app.js');

        expect(result.type).toBe(FileType.Test);
      });
    });
  });

  describe('classifyFiles', () => {
    it('should classify multiple files in batch', () => {
      const files = [
        'src/app.ts',
        'src/app.spec.ts',
        'package.json',
        'README.md',
        'assets/logo.png',
      ];

      const results = service.classifyFiles(files);

      expect(results.size).toBe(5);
      expect(results.get('src/app.ts')?.type).toBe(FileType.Source);
      expect(results.get('src/app.spec.ts')?.type).toBe(FileType.Test);
      expect(results.get('package.json')?.type).toBe(FileType.Config);
      expect(results.get('README.md')?.type).toBe(FileType.Documentation);
      expect(results.get('assets/logo.png')?.type).toBe(FileType.Asset);
    });

    it('should return empty map for empty input', () => {
      const results = service.classifyFiles([]);

      expect(results.size).toBe(0);
    });
  });

  describe('getStatistics', () => {
    it('should count files by type', () => {
      const files = [
        'src/app.ts',
        'src/utils.ts',
        'src/app.spec.ts',
        'src/utils.spec.ts',
        'package.json',
        'tsconfig.json',
        'README.md',
        'assets/logo.png',
      ];

      const classifications = service.classifyFiles(files);
      const stats = service.getStatistics(classifications);

      expect(stats.get(FileType.Source)).toBe(2);
      expect(stats.get(FileType.Test)).toBe(2);
      expect(stats.get(FileType.Config)).toBe(2);
      expect(stats.get(FileType.Documentation)).toBe(1);
      expect(stats.get(FileType.Asset)).toBe(1);
    });

    it('should return empty map for empty classifications', () => {
      const stats = service.getStatistics(new Map());

      expect(stats.size).toBe(0);
    });

    it('should handle all files of same type', () => {
      const files = ['src/app.ts', 'src/utils.ts', 'src/helper.ts'];
      const classifications = service.classifyFiles(files);
      const stats = service.getStatistics(classifications);

      expect(stats.get(FileType.Source)).toBe(3);
      expect(stats.size).toBe(1);
    });
  });
});
