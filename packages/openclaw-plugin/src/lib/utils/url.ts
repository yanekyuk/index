export interface DerivedUrls {
  protocolUrl: string;
  frontendUrl: string;
}

export function deriveUrls(input: string): DerivedUrls {
  const cleaned = input.replace(/\/+$/, '');

  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    return { protocolUrl: cleaned, frontendUrl: cleaned };
  }

  const hostname = parsed.hostname;

  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') {
    const protocolUrl = `${parsed.protocol}//localhost:3001`;
    return { protocolUrl, frontendUrl: cleaned };
  }

  if (hostname.startsWith('protocol.')) {
    const frontendHostname = hostname.slice('protocol.'.length);
    const frontendUrl = `${parsed.protocol}//${frontendHostname}`;
    return { protocolUrl: cleaned, frontendUrl };
  }

  // Port and path are intentionally dropped — production deployments use
  // subdomain-based routing (protocol.example.com), not port/path variants.
  const protocolUrl = `${parsed.protocol}//protocol.${hostname}`;
  return { protocolUrl, frontendUrl: cleaned };
}
