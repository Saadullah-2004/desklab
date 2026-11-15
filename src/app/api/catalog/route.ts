import {getCatalog} from '@/lib/shopify';
import {errorResponse} from '../_utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json(await getCatalog(), {
      headers: {'Cache-Control': 'no-store'},
    });
  } catch (error) {
    return errorResponse(error);
  }
}
