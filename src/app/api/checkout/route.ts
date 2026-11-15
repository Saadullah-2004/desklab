import {createCheckout} from '@/lib/shopify';
import {readJson, errorResponse} from '../_utils';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    return Response.json(await createCheckout(body.lines), {
      headers: {'Cache-Control': 'no-store'},
    });
  } catch (error) {
    return errorResponse(error);
  }
}
