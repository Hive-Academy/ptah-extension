# Ptah Landing Page

↩️ [Back to Main](../../CLAUDE.md)

## Purpose

The **ptah-landing-page** is a standalone Angular 20 marketing website for the Ptah Extension. It provides product information, feature showcases, and links to download the extension.

## Boundaries

**Belongs here**:

- Marketing pages (home, features, pricing, etc.)
- Product showcases and demos
- Download/installation instructions
- SEO optimization
- Analytics integration

**Does NOT belong**:

- VS Code extension logic (belongs in ptah-extension-vscode)
- Extension UI (belongs in ptah-extension-webview)
- Backend services (belongs in ptah-license-server)

## Key Files

- `src/main.ts` - Angular bootstrap
- `src/app/app.component.ts` - Root component with routing
- `src/styles.css` - Global styles (Tailwind CSS)
- `public/` - Static assets (images, icons, favicons)

## Tech Stack

- **Framework**: Angular 20
- **Styling**: Tailwind CSS + DaisyUI
- **Build**: Angular CLI + Nx
- **Deployment**: Static site hosting (Netlify, Vercel, GitHub Pages)

## Commands

```bash
# Development
nx serve ptah-landing-page      # Dev server (http://localhost:4200)
nx serve ptah-landing-page --open

# Build
nx build ptah-landing-page       # Production build
nx build ptah-landing-page --configuration=development

# Quality Gates
nx lint ptah-landing-page        # Lint code
nx test ptah-landing-page        # Run tests

# Preview Build
nx run ptah-landing-page:serve-static  # Serve built files
```

## Build Output

- **Location**: `dist/ptah-landing-page/browser/`
- **Type**: Static HTML/CSS/JS files
- **Optimizations**: Minification, tree-shaking, code splitting
- **Budget**: Max 1MB initial bundle, 4KB component styles

## Deployment

### Static Site Hosting

```bash
# Build for production
nx build ptah-landing-page

# Deploy to Netlify
netlify deploy --dir=dist/ptah-landing-page/browser --prod

# Deploy to Vercel
vercel --prod dist/ptah-landing-page/browser

# Deploy to GitHub Pages
# (configure GitHub Actions workflow)
```

### Environment Variables

Create `.env` files for different environments:

- `.env.development` - Local development
- `.env.production` - Production deployment

## Guidelines

### SEO Optimization

1. **Meta Tags**: Add proper title, description, og:image
2. **Structured Data**: Use schema.org JSON-LD
3. **Sitemap**: Generate sitemap.xml
4. **Robots.txt**: Configure crawling rules
5. **Performance**: Optimize images, lazy load content

### Analytics

```typescript
// Example: Google Analytics integration
export class AnalyticsService {
  trackPageView(url: string) {
    gtag('config', 'GA_MEASUREMENT_ID', {
      page_path: url,
    });
  }
}
```

### Content Guidelines

- **Clear Messaging**: Focus on user benefits
- **Call-to-Action**: Prominent download/install buttons
- **Screenshots**: High-quality extension screenshots
- **Documentation Links**: Link to user guide and docs

## Related Documentation

- [VS Code Extension](../ptah-extension-vscode/CLAUDE.md)
- [Webview App](../ptah-extension-webview/CLAUDE.md)
