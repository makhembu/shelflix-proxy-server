const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

const FORWARD_HEADERS = [
  'content-type', 'content-length', 'cache-control',
  'etag', 'last-modified', 'accept-ranges', 'content-range',
];

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Origin');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

app.get(['/', '/proxy'], async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    const rawUrl = req.query.url;
    // rawUrl is decoded once by Express from the outer query param.
    // URL constructor handles %7B/%22 etc fine — do NOT decodeURIComponent on full URL.
    const parsedUrl = new URL(rawUrl);

    // Parse headers from URL params
    let customHeaders = {};
    const headersParam = parsedUrl.searchParams.get('headers');
    if (headersParam) {
      try { customHeaders = JSON.parse(decodeURIComponent(headersParam)); } catch {}
    }

    const requestHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    if (customHeaders.referer) requestHeaders['Referer'] = customHeaders.referer;
    if (customHeaders.origin) requestHeaders['Origin'] = customHeaders.origin;
    if (req.headers.range) requestHeaders['Range'] = req.headers.range;

    // Remove internal params before fetch
    parsedUrl.searchParams.delete('headers');
    parsedUrl.searchParams.delete('host');
    const streamUrl = parsedUrl.toString();

    const response = await fetch(streamUrl, {
      method: req.method,
      headers: requestHeaders,
      timeout: 30000,
    });

    const contentType = response.headers.get('content-type') || '';

    // Status code guard — don't try to rewrite error pages
    if (response.status !== 200 && response.status !== 206 && response.status !== 302 && response.status !== 301) {
      const errorBody = await response.text();
      res.setHeader('Content-Type', contentType);
      return res.status(response.status).send(errorBody);
    }

    if (contentType.includes('vnd.apple.mpegurl') || contentType.includes('x-mpegURL') || streamUrl.includes('.m3u8')) {
      const m3u8Text = await response.text();
      const base = new URL(streamUrl);
      const rewrittenLines = m3u8Text.split('\n').map(line => {
        if (line.startsWith('#') || line.trim() === '') return line;
        let absoluteUrl;
        if (line.match(/^https?:\/\//)) absoluteUrl = line;
        else if (line.startsWith('/')) absoluteUrl = `${base.origin}${line}`;
        else {
          const basePath = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
          absoluteUrl = `${base.origin}${basePath}${line}`;
        }
        return `/proxy?url=${encodeURIComponent(absoluteUrl)}`;
      });

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      return res.status(response.status).send(rewrittenLines.join('\n'));
    }

    for (const header of FORWARD_HEADERS) {
      const value = response.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.setHeader('Content-Type', contentType);

    response.body.pipe(res.status(response.status));
  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(500).json({ error: 'Proxy failed', message: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});
