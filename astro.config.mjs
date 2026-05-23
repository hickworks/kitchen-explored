// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import rehypeExternalLinks from 'rehype-external-links';

export default defineConfig({
  site: 'https://www.kitchenexplored.com',
  output: 'static',
  integrations: [mdx(), sitemap()],
  markdown: {
    rehypePlugins: [
      [rehypeExternalLinks, {
        target: '_blank',
        rel: ['nofollow', 'sponsored', 'noopener', 'noreferrer'],
      }],
    ],
  },
  vite: {
    plugins: [tailwindcss()],
    build: {
      rollupOptions: {
        external: ['/pagefind/pagefind.js'],
      },
    },
  }
});
