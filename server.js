const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

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
    const decodedUrl = decodeURIComponent(targetUrl);

    let streamUrl = decodedUrl;
    let customHeaders = {};
    let hostOverride = '';

    const headersMatch = decodedUrl.match(/^(.+?)\?headers=({[^}]+})/);
    if (headersMatch) {
      streamUrl = headersMatch[1];
      try {
        customHeaders = JSON.parse(decodeURIComponent(headersMatch[2]));
      } catch {}
    }

    const hostMatch = decodedUrl.match(/[?&]host=([^&]+)/);
    if (hostMatch) {
      hostOverride = decodeURIComponent(hostMatch[1]);
    }

    streamUrl = streamUrl.replace(/\?headers=\{[^}]+\}/, '').replace(/&host=[^&]+/, '');

    const requestHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    if (customHeaders.referer) requestHeaders['Referer'] = customHeaders.referer;
    if (customHeaders.origin) requestHeaders['Origin'] = customHeaders.origin;
    if (hostOverride) requestHeaders['Host'] = hostOverride;

    if (req.headers.range) requestHeaders['Range'] = req.headers.range;

    const response = await fetch(streamUrl, {
      method: req.method,
      headers: requestHeaders,
      timeout: 30000,
    });

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('vnd.apple.mpegurl') || contentType.includes('x-mpegURL') || streamUrl.includes('.m3u8')) {
      const m3u8Text = await response.text();
      const base = new URL(streamUrl);
      const rewrittenLines = m3u8Text.split('\n').map(line => {
        if (line.startsWith('#') || line.trim() === '') return line;

        let absoluteUrl;
        if (line.match(/^https?:\/\//)) {
          absoluteUrl = line;
        } else if (line.startsWith('/')) {
          absoluteUrl = `${base.origin}${line}`;
        } else {
          const basePath = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
          absoluteUrl = `${base.origin}${basePath}${line}`;
        }

        return `/proxy?url=${encodeURIComponent(absoluteUrl)}`;
      });

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      if (response.headers.get('cache-control')) res.setHeader('Cache-Control', response.headers.get('cache-control'));
      return res.status(response.status).send(rewrittenLines.join('\n'));
    }

    if (response.headers.get('content-length')) res.setHeader('Content-Length', response.headers.get('content-length'));
    if (response.headers.get('content-range')) res.setHeader('Content-Range', response.headers.get('content-range'));
    if (response.headers.get('accept-ranges')) res.setHeader('Accept-Ranges', response.headers.get('accept-ranges'));
    if (response.headers.get('cache-control')) res.setHeader('Cache-Control', response.headers.get('cache-control'));
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
