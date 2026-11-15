import type {Metadata} from 'next';
import {
  appOrigin,
  isLoopbackOrigin,
  type ServerEnvironment,
} from '@/lib/server-config';

export const sitePages = {
  '/': {
    title: 'DeskLab | Make room for your best work',
    description:
      'Build a workspace around your space, style and budget. Explore an interactive 3D desk builder and a fictional Shopify storefront in this portfolio demo.',
  },
  '/shop': {
    title: 'The collection | DeskLab',
    description:
      'Explore 18 original fictional desks, keyboards, lights and accessories. A thoughtfully designed collection for the DeskLab portfolio demo.',
  },
  '/builder': {
    title: 'Build your workspace | DeskLab',
    description:
      'Describe your workspace or choose your preferences, then explore a 3D setup checked against your budget and available space. An interactive portfolio demo.',
  },
  '/about': {
    title: 'Inside DeskLab | Design, engineering and commerce',
    description:
      'Explore the design and engineering behind DeskLab: a 3D workspace builder, deterministic product matching and a Shopify test checkout portfolio project.',
  },
} as const;

export function publicIndexingOrigin(
  environment: ServerEnvironment = process.env,
): string | null {
  const origin = appOrigin(environment);
  if (!origin || !origin.startsWith('https://') || isLoopbackOrigin(origin))
    return null;
  if (environment.NODE_ENV !== 'production') return null;
  if (
    (environment.VERCEL || environment.VERCEL_ENV) &&
    environment.VERCEL_ENV !== 'production'
  )
    return null;
  return origin;
}

export function pageMetadata(
  path: keyof typeof sitePages,
  environment: ServerEnvironment = process.env,
): Metadata {
  const page = sitePages[path];
  const origin = appOrigin(environment);
  const publicOrigin = origin && !isLoopbackOrigin(origin) ? origin : null;
  const canonical = publicOrigin
    ? new URL(path, publicOrigin).toString()
    : undefined;
  const indexable = Boolean(publicIndexingOrigin(environment));
  return {
    title: page.title,
    description: page.description,
    alternates: canonical ? {canonical} : undefined,
    robots: {index: indexable, follow: indexable},
    openGraph: {
      type: 'website',
      siteName: 'DeskLab',
      locale: 'en_CA',
      title: page.title,
      description: page.description,
      url: canonical,
    },
    twitter: {
      card: 'summary_large_image',
      title: page.title,
      description: page.description,
      ...(publicOrigin
        ? {
            images: [
              {
                url: `${publicOrigin}/opengraph-image`,
                alt: 'DeskLab: an interactive workspace builder and portfolio storefront.',
              },
            ],
          }
        : {}),
    },
  };
}
