export function getCorsHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept',
    'Access-Control-Expose-Headers': 'X-Session-Id',
    'Access-Control-Max-Age': '86400',
  };

  const origin = req.headers.get('Origin');
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

/** Trusted origins for Better Auth: TRUSTED_ORIGINS env + reflective Origin from request */
export async function getTrustedOrigins(request?: Request): Promise<string[]> {
  const origins: string[] = [];

  const trusted = (process.env.TRUSTED_ORIGINS ?? process.env.TRUSTED_ORIGINS)?.split(',')
    .map((u) => u.trim())
    .filter(Boolean) ?? [];
  for (const u of trusted) {
    const url = u.startsWith('http') ? u : `https://${u}`;
    if (!origins.includes(url)) origins.push(url);
  }

  const origin = request?.headers?.get?.('Origin');
  if (origin && !origins.includes(origin)) origins.push(origin);

  return origins;
}
