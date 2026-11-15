import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {
  pageMetadata,
  publicIndexingOrigin,
  sitePages,
} from '../src/app/_metadata';
import robots from '../src/app/robots';
import sitemap from '../src/app/sitemap';

const production = {
  NODE_ENV: 'production',
  APP_ORIGIN: 'https://desklab.example',
  VERCEL: '1',
  VERCEL_ENV: 'production',
} as const;

function environment(t: TestContext, values: NodeJS.ProcessEnv) {
  const before = process.env;
  process.env = values;
  t.after(() => {
    process.env = before;
  });
}

test('only configured public production origins can be indexed', () => {
  assert.equal(publicIndexingOrigin(production), production.APP_ORIGIN);
  for (const overrides of [
    {VERCEL_ENV: 'preview'},
    {VERCEL_ENV: 'development'},
    {VERCEL_ENV: ''},
    {NODE_ENV: 'development'},
    {APP_ORIGIN: ''},
    {APP_ORIGIN: 'not-a-url'},
    {APP_ORIGIN: 'https://localhost'},
    {APP_ORIGIN: 'http://127.0.0.1:3000'},
    {APP_ORIGIN: 'https://desklab.example/path'},
  ])
    assert.equal(publicIndexingOrigin({...production, ...overrides}), null);
});

test('each page has its own canonical and honest share copy', () => {
  for (const path of Object.keys(sitePages) as (keyof typeof sitePages)[]) {
    const metadata = pageMetadata(path, production);
    assert.equal(
      metadata.alternates?.canonical,
      new URL(path, production.APP_ORIGIN).toString(),
    );
    assert.equal(metadata.openGraph?.url, metadata.alternates?.canonical);
    assert.match(metadata.description ?? '', /portfolio/i);
    assert.deepEqual(metadata.robots, {index: true, follow: true});
    assert.deepEqual(
      pageMetadata(path, {...production, VERCEL_ENV: 'preview'}).robots,
      {index: false, follow: false},
    );
  }
  assert.equal(
    pageMetadata('/', {NODE_ENV: 'development'}).alternates,
    undefined,
  );
});

test('production robots block API crawls and sitemap lists only public pages', (t) => {
  environment(t, production);
  assert.deepEqual(robots(), {
    rules: {userAgent: '*', allow: '/', disallow: '/api/'},
    sitemap: 'https://desklab.example/sitemap.xml',
  });
  assert.deepEqual(
    sitemap().map((entry) => entry.url),
    [
      'https://desklab.example/',
      'https://desklab.example/shop',
      'https://desklab.example/builder',
      'https://desklab.example/about',
    ],
  );
});

test('preview deployments block crawling and publish no sitemap entries', (t) => {
  environment(t, {...production, VERCEL_ENV: 'preview'});
  assert.deepEqual(robots(), {rules: {userAgent: '*', disallow: '/'}});
  assert.deepEqual(sitemap(), []);
});
