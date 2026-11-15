import {getCatalog} from '@/lib/shopify';
import {handleApiRequest} from '../_utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleApiRequest('catalog', request, async () =>
    Response.json(await getCatalog()),
  );
}
