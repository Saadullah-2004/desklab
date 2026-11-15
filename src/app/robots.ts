import type {MetadataRoute} from 'next';
import {publicIndexingOrigin} from './_metadata';

export default function robots(): MetadataRoute.Robots {
  const origin = publicIndexingOrigin();
  if (!origin) return {rules: {userAgent: '*', disallow: '/'}};
  return {
    rules: {userAgent: '*', allow: '/', disallow: '/api/'},
    sitemap: `${origin}/sitemap.xml`,
  };
}
