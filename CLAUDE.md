# KitchenExplored

Migration of kitchenexplored.com from WordPress to a modern static site.

## Project Goal

Move off an expensive, unreliable shared WordPress host onto a fast, free static site with a significantly redesigned UI. The live site at kitchenexplored.com serves as the content source for migration.

## Tech Stack

- **Framework**: Astro (static output)
- **Hosting**: Vercel (free tier, auto-deploy from GitHub on push to `main`)
- **Styling**: Tailwind CSS
- **Content**: Markdown / MDX with Astro Content Collections
- **Design**: Pencil (.pen file) for mockups → `kitchenexplored.pen`

## Brand

- **Primary color**: Navy `#062451`
- **Accent**: Orange gradient `#f78745` → `#f85026`
- **Logo (light bg)**: `kitchen-explored-logo.svg`
- **Logo (dark bg)**: `kitchen-explored-logo-dark.svg`

## Site Structure

### Categories (from existing site)
- Blenders
- Cookware
- Faucet
- Ovens
- Knives
- Pressure Cooker

### Content Type
Primarily product comparisons (e.g., "Ninja fd401 vs fd402") — ~180+ articles across 18+ pages.

### Pages
- Home (featured + latest posts grid)
- Category archives
- Individual article pages
- About Us
- Contact
- Privacy Policy

## Repository

GitHub: `hickworks/kitchen-explored`

## Key Commands

```bash
# Dev server
npm run dev

# Production build
npm run build

# Preview build
npm run preview
```

## Design Files

Open `kitchenexplored.pen` in the Pencil VS Code extension for UI mockups.
The Pencil app must be running in VS Code before MCP tools can connect to it.

## Content Migration

WordPress XML export → convert to Markdown using `wordpress-export-to-markdown`.
Exported content goes in `src/content/posts/`.

## Design Reference

**Inspiration**: [Glide Blog](https://www.glideapps.com/blog)

Key aesthetic principles to borrow:
- **Generous whitespace** — substantial breathing room between all content blocks
- **Minimal elevation** — cards feel flat or near-flat; shadows are subtle, never dramatic
- **Slightly rounded corners** — present but restrained (~8px default); not pill-shaped
- **Neutral-first palette** — whites and light grays dominate; color used as accent only
- **Editorial clarity** — large, confident headings; clean typographic hierarchy
- **Imagery as anchor** — consistently sized hero/card images; no decorative clutter

The overall mood is: trustworthy, editorial, modern — not flashy.

## Deployment

Push to `main` → Vercel auto-builds and deploys.
Build command: `npm run build`
Output directory: `dist`
