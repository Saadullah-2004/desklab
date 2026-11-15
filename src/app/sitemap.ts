import type {MetadataRoute} from 'next';
import {publicIndexingOrigin, sitePages} from './_metadata';

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = publicIndexingOrigin();
  if (!origin) return [];
  return Object.keys(sitePages).map((path) => ({
    url: new URL(path, origin).toString(),
  }));
}
