import {rateLimiterReady} from '@/lib/rate-limit';
import {originConfigurationReady} from '@/lib/server-config';
import {handleApiRequest} from '../_utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleApiRequest('health', request, async () => {
    const ready = originConfigurationReady() && (await rateLimiterReady());
    return Response.json(
      {status: ready ? 'ok' : 'unavailable'},
      {status: ready ? 200 : 503},
    );
  });
}
