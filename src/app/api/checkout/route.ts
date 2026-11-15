import {createCheckout} from '@/lib/shopify';
import {readJson, handleApiRequest} from '../_utils';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  return handleApiRequest('checkout', request, async () => {
    const body = await readJson(request);
    return Response.json(await createCheckout(body.lines));
  });
}
