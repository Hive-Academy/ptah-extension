import 'reflect-metadata';
import { FrameworkDetectorService } from './framework-detector.service';
import { FileSystemService } from '../services/file-system.service';
import { Framework, ProjectType } from '../types/workspace.types';

describe('FrameworkDetectorService', () => {
  let service: FrameworkDetectorService;
  let mockFileSystem: jest.Mocked<FileSystemService>;
  const testPath = '/test/workspace';

  beforeEach(() => {
    // Create mock FileSystemService
    mockFileSystem = {
      readFile: jest.fn(),
      readDirectory: jest.fn(),
      stat: jest.fn(),
      exists: jest.fn(),
      isVirtualWorkspace: jest.fn(),
    } as unknown as jest.Mocked<FileSystemService>;

    service = new FrameworkDetectorService(mockFileSystem);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('detectFramework', () => {
    it('should return undefined for general project type', async () => {
      const result = await service.detectFramework(
        testPath,
        ProjectType.General
      );

      expect(result).toBeUndefined();
      expect(mockFileSystem.exists).not.toHaveBeenCalled();
    });

    it('should detect Angular from angular.json', async () => {
      mockFileSystem.exists.mockImplementation(async (path: string) => {
        return path.endsWith('angular.json');
      });

      const result = await service.detectFramework(testPath, ProjectType.Node);

      expect(result).toBe(Framework.Angular);
    });

    it('should detect Next.js from next.config.js', async () => {
      mockFileSystem.exists.mockImplementation(async (path: string) => {
        return path.endsWith('next.config.js');
      });

      const result = await service.detectFramework(testPath, ProjectType.React);

      expect(result).toBe(Framework.NextJS);
    });

    it('should detect Next.js from next.config.mjs', async () => {
      mockFileSystem.exists.mockImplementation(async (path: string) => {
        return path.endsWith('next.config.mjs');
      });

      const result = await service.detectFramework(testPath, ProjectType.React);

      expect(result).toBe(Framework.NextJS);
    });

    it('should detect Next.js from next.config.ts', async () => {
      mockFileSystem.exists.mockImplementation(async (path: string) => {
        return path.endsWith('next.config.ts');
      });

      const result = await service.detectFramework(testPath, ProjectType.React);

      expect(result).toBe(Framework.NextJS);
    });

    it('should detect Nuxt from nuxt.config.js', async () => {
      mockFileSystem.exists.mockImplementation(async (path: string) => {
        return path.endsWith('nuxt.config.js');
      });

      const result = await service.detectFramework(testPath, ProjectType.Node);

      expect(result).toBe(Framework.Nuxt);
    });

    it('should detect Nuxt from nuxt.config.ts', async () => {
      mockFileSystem.exists.mockImplementation(async (path: string) => {
        return path.endsWith('nuxt.config.ts');
      });

      const result = await service.detectFramework(testPath, ProjectType.Node);

      expect(result).toBe(Framework.Nuxt);
    });

    it('should return undefined when error occurs', async () => {
      mockFileSystem.exists.mockRejectedValue(new Error('File system error'));

      const result = await service.detectFramework(testPath, ProjectType.Node);

      expect(result).toBeUndefined();
    });
  });

  describe('detectFromPackageJson', () => {
    it('should detect Next.js from package.json dependencies', async () => {
      mockFileSystem.exists.mockImplementation(async (path: string) => {
        return path.endsWith('package.json');
      });

      mockFileSystem.readFile.mockResolvedValue(
        JSON.stringify({
          dependencies: {
            next: '^14.0.0',
            react: '^18.0.0',
          },
        })
      );

      const result = await service.detectFramework(testPath, ProjectType.Node);

      expect(result).toBe(Framework.NextJS);
    });

    it('should detect Nuxt from package.json dependencies', async () => {
      mockFileSystem.exists.mockImplementation(async (path: string) => {
        return path.endsWith('package.json');
      });

      mockFileSystem.readFile.mockResolvedValue(
        JSON.stringify({
          dependencies: {
            nuxt: '^3.0.0',
          },
        })
      );

      const result = await service.detectFramework(testPath, ProjectType.Node);

      expect(result).toBe(Framework.Nuxt);
    });

    it('should detect Angular from package.json dependencies', async () => {
      mockFileSystem.exists.mockImplementation(async (path: string) => {
        return path.endsWith('package.json');
      });

      mockFileSystem.readFile.mockResolvedValue(
        JSON.stringify({
          dependencies: {
            '@angular/core': '^17.0.0',
            '@angular/common': '^17.0.0',
          },
        })
      );

      const result = await service.detectFramework(testPath, ProjectType.Node);

      expect(result).toBe(Framework.Angular);
    });

    it('should detect React from package.json dependencies', async () => {
      mockFileSystem.exists.mockImplementation(async (path: string) => {
        return path.endsWith('package.json');
      });

      mockFileSystem.readFile.mockResolvedValue(
        JSON.stringify({
          dependencies: {
            react: '^18.0.0',
            'react-dom': '^18.0.0',
          },
        })
      );

      const result = await service.detectFramework(testPath, ProjectType.React);

      expect(result).toBe(Framework.React);
    });

    it('should detect Vue from package.json dependencies', async () => {
      mockFileSystem.exists.mockImplementation(async (path: string) => {
        return path.endsWith('package.json');
      });

      mockFileSystem.readFile.mockResolvedValue(
        JSON.stringify({
          dependencies: {
            vue: '^3.0.0',
          },
        })
      );

      const result = await service.detectFramework(testPath, ProjectType.Node);

      expect(result).toBe(Framework.Vue);
    });

    it('should detect Express from package.json dependencies', async () => {
      mockFileSystem.exists.mockImplementation(async (path: string) => {
        return path.endsWith('package.json');
      });

      mockFileSystem.readFile.mockResolvedValue(
        JSON.stringify({
          dependencies: {
            express: '^4.18.0',
          },
        })
      );

      const result = await service.detectFramework(testPath, ProjectType.Node);

      expect(result).toBe(Framework.Express);
    });

    it('should check devDependencies as well', async () => {
      mockFileSystem.exists.mockImplementation(async (path: string) => {
        return path.endsWith('package.json');
      });

      mockFileSystem.readFile.mockResolvedValue(
        JSON.stringify({
          devDependencies: {
            '@angular/core': '^17.0.0',
          },
        })
      );

      const result = await service.detectFramework(testPath, ProjectType.Node);

      expect(result).toBe(Framework.Angular);
    });

    it('should return undefined when package.json does not exist', async () => {
      mockFileSystem.exists.mockResolvedValue(false);

      const result = await service.detectFramework(testPath, ProjectType.Node);

      expect(result).toBeUndefined();
    });

    it('should return undefined when package.json is malformed', async () => {
      mockFileSystem.exists.mockImplementation(async (path: string) => {
        return path.endsWith('package.json');
      });

      mockFileSystem.readFile.mockResolvedValue('{ invalid json');

      const result = await service.detectFramework(testPath, ProjectType.Node);

      expect(result).toBeUndefined();
    });

    it('should return undefined when no framework found in package.json', async () => {
      mockFileSystem.exists.mockImplementation(async (path: string) => {
        return path.endsWith('package.json');
      });

      mockFileSystem.readFile.mockResolvedValue(
        JSON.stringify({
          dependencies: {
            lodash: '^4.17.21',
          },
        })
      );

      const result = await service.detectFramework(testPath, ProjectType.Node);

      expect(result).toBeUndefined();
    });
  });

  describe('detectPythonFramework', () => {
    it('should detect Django from manage.py', async () => {
      mockFileSystem.exists.mockImplementation(async (path: string) => {
        return path.endsWith('manage.py');
      });

      const result = await service.detectFramework(
        testPath,
        ProjectType.Python
      );

      expect(result).toBe(Framework.Django);
    });

    it('should detect Django from requirements.txt', async () => {
      mockFileSystem.exists.mockImplementation(async (path: string) => {
        if (path.endsWith('manage.py')) return false;
        if (path.endsWith('requirements.txt')) return true;
        return false;
      });

      mockFileSystem.readFile.mockResolvedValue(
        'Django==4.2.0\npsycopg2-binary==2.9.0'
      );

      const result = await service.detectFramework(
        testPath,
        ProjectType.Python
      );

      expect(result).toBe(Framework.Django);
    });

    it('should be case-insensitive when detecting Django', async () => {
      mockFileSystem.exists.mockImplementation(async (path: string) => {
        if (path.endsWith('manage.py')) return false;
        if (path.endsWith('requirements.txt')) return true;
        return false;
      });

      mockFileSystem.readFile.mockResolvedValue('django==4.2.0');

      const result = await service.detectFramework(
        testPath,
        ProjectType.Python
      );

      expect(result).toBe(Framework.Django);
    });

    it('should return undefined when no Python framework detected', async () => {
      mockFileSystem.exists.mockResolvedValue(false);

      const result = await service.detectFramework(
        testPath,
        ProjectType.Python
      );

      expect(result).toBeUndefined();
    });

    it('should return undefined when requirements.txt read fails', async () => {
      mockFileSystem.exists.mockImplementation(async (path: string) => {
        if (path.endsWith('manage.py')) return false;
        if (path.endsWith('requirements.txt')) return true;
        return false;
      });

      mockFileSystem.readFile.mockRejectedValue(new Error('Read error'));

      const result = await service.detectFramework(
        testPath,
        ProjectType.Python
      );

      expect(result).toBeUndefined();
    });
  });

  describe('detectPHPFramework', () => {
    it('should detect Laravel from artisan file', async () => {
      mockFileSystem.exists.mockImplementation(async (path: string) => {
        return path.endsWith('artisan');
      });

      const result = await service.detectFramework(testPath, ProjectType.PHP);

      expect(result).toBe(Framework.Laravel);
    });

    it('should detect Laravel from composer.json', async () => {
      mockFileSystem.exists.mockImplementation(async (path: string) => {
        if (path.endsWith('artisan')) return false;
        if (path.endsWith('composer.json')) return true;
        return false;
      });

      mockFileSystem.readFile.mockResolvedValue(
        JSON.stringify({
          require: {
            'laravel/framework': '^10.0',
          },
        })
      );

      const result = await service.detectFramework(testPath, ProjectType.PHP);

      expect(result).toBe(Framework.Laravel);
    });

    it('should return undefined when no PHP framework detected', async () => {
      mockFileSystem.exists.mockResolvedValue(false);

      const result = await service.detectFramework(testPath, ProjectType.PHP);

      expect(result).toBeUndefined();
    });

    it('should return undefined when composer.json is malformed', async () => {
      mockFileSystem.exists.mockImplementation(async (path: string) => {
        if (path.endsWith('artisan')) return false;
        if (path.endsWith('composer.json')) return true;
        return false;
      });

      mockFileSystem.readFile.mockResolvedValue('{ invalid json');

      const result = await service.detectFramework(testPath, ProjectType.PHP);

      expect(result).toBeUndefined();
    });
  });

  describe('detectRubyFramework', () => {
    it('should detect Rails from config/application.rb', async () => {
      mockFileSystem.exists.mockImplementation(async (path: string) => {
        return path.includes('config') && path.endsWith('application.rb');
      });

      const result = await service.detectFramework(testPath, ProjectType.Ruby);

      expect(result).toBe(Framework.Rails);
    });

    it('should detect Rails from Gemfile', async () => {
      mockFileSystem.exists.mockImplementation(async (path: string) => {
        if (path.includes('config') && path.endsWith('application.rb'))
          return false;
        if (path.endsWith('Gemfile')) return true;
        return false;
      });

      mockFileSystem.readFile.mockResolvedValue("gem 'rails', '~> 7.0.0'");

      const result = await service.detectFramework(testPath, ProjectType.Ruby);

      expect(result).toBe(Framework.Rails);
    });

    it('should return undefined when no Ruby framework detected', async () => {
      mockFileSystem.exists.mockResolvedValue(false);

      const result = await service.detectFramework(testPath, ProjectType.Ruby);

      expect(result).toBeUndefined();
    });

    it('should return undefined when Gemfile read fails', async () => {
      mockFileSystem.exists.mockImplementation(async (path: string) => {
        if (path.includes('config') && path.endsWith('application.rb'))
          return false;
        if (path.endsWith('Gemfile')) return true;
        return false;
      });

      mockFileSystem.readFile.mockRejectedValue(new Error('Read error'));

      const result = await service.detectFramework(testPath, ProjectType.Ruby);

      expect(result).toBeUndefined();
    });
  });

  describe('detectFrameworks (multi-root)', () => {
    it('should detect frameworks for multiple workspace folders', async () => {
      const projectTypes = new Map<string, ProjectType>([
        ['/workspace1', ProjectType.React],
        ['/workspace2', ProjectType.Python],
        ['/workspace3', ProjectType.PHP],
      ]);

      // Setup mocks for different frameworks
      mockFileSystem.exists.mockImplementation(async (path: string) => {
        if (path.includes('workspace1') && path.endsWith('next.config.js'))
          return true;
        if (path.includes('workspace2') && path.endsWith('manage.py'))
          return true;
        if (path.includes('workspace3') && path.endsWith('artisan'))
          return true;
        return false;
      });

      const result = await service.detectFrameworks(projectTypes);

      expect(result.size).toBe(3);
      expect(result.get('/workspace1')).toBe(Framework.NextJS);
      expect(result.get('/workspace2')).toBe(Framework.Django);
      expect(result.get('/workspace3')).toBe(Framework.Laravel);
    });

    it('should handle mixed detection results', async () => {
      const projectTypes = new Map<string, ProjectType>([
        ['/workspace1', ProjectType.React],
        ['/workspace2', ProjectType.General],
      ]);

      mockFileSystem.exists.mockImplementation(async (path: string) => {
        return path.includes('workspace1') && path.endsWith('next.config.js');
      });

      const result = await service.detectFrameworks(projectTypes);

      expect(result.size).toBe(2);
      expect(result.get('/workspace1')).toBe(Framework.NextJS);
      expect(result.get('/workspace2')).toBeUndefined();
    });

    it('should return empty map when no project types provided', async () => {
      const projectTypes = new Map<string, ProjectType>();

      const result = await service.detectFrameworks(projectTypes);

      expect(result.size).toBe(0);
    });
  });
});
