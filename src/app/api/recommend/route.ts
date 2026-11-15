import {
  DEFAULT_PREFERENCES,
  interpretBrief,
  validatePreferences,
} from '@/lib/ai';
import {recommendSetup} from '@/lib/recommend';
import {CommerceError, getCatalog} from '@/lib/shopify';
import {errorResponse, readJson} from '../_utils';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    if (typeof body.brief !== 'string' || body.brief.length > 1_000) {
      throw new CommerceError(
        'Keep your brief to 1,000 characters or fewer.',
        400,
      );
    }
    const defaults = validatePreferences(
      body.preferences ?? DEFAULT_PREFERENCES,
    );
    // Resolve commerce first, so unavailable catalog requests don't spend model tokens.
    const catalog = await getCatalog();
    const interpreted = await interpretBrief(body.brief, defaults);
    const recommendation = recommendSetup(
      interpreted.preferences,
      catalog.products,
    );
    return Response.json(
      {
        ...recommendation,
        engine: interpreted.engine,
        notices: interpreted.notices,
        catalogSource: catalog.source,
        catalogSnapshot: catalog.products,
        checkoutEnabled: catalog.checkoutEnabled,
      },
      {
        headers: {'Cache-Control': 'no-store'},
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
