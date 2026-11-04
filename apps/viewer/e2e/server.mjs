#!/usr/bin/env node
// Test server for the Playwright suite: serves the built viewer (dist/) under
// a path prefix, the way canopy_mcp's static routes do behind a host's proxy.
// It mirrors that route rule so the browser tests exercise the same URL shape
// the real deployment produces:
//
//   <prefix>/, <prefix>/s/*                    -> dist/index.html with exactly
//                                                one <base href="<prefix>/">
//                                                first in <head>
//   <prefix>/assets/*                          -> dist/assets/*
//   <prefix>/config.json                       -> the fixture config
//   <prefix>/drafts/*                          -> the fixture drafts folder
//   <prefix>/health                            -> {"status":"ok"}
//
// The hare PV socket (<prefix>/hare/v1/ws/pvs) and its REST writes are not
// served here: specs mock them in the page, so every heartbeat, close and
// write a spec drives stays in that test.
//
// Anything else is a 404, so a request the viewer should not make surfaces
// as a failure in the tests. Dependency-free: node: builtins only.
//
// Environment: E2E_PORT (default 4179), E2E_PREFIX (default /x/y),
// VIEWER_DIST (default ../dist), E2E_DRAFTS (default ./fixtures/drafts).

import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.E2E_PORT ?? 4179);
const prefix = (process.env.E2E_PREFIX ?? '/x/y').replace(/\/+$/, '');
const dist = resolve(process.env.VIEWER_DIST ?? join(here, '..', 'dist'));
const drafts = resolve(process.env.E2E_DRAFTS ?? join(here, 'fixtures', 'drafts'));
const config = readFileSync(join(here, 'fixtures', 'config.json'), 'utf8');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** index.html with exactly one <base href="<prefix>/">, first in <head> (static.inject_base). */
export function injectBase(indexHtml, basePrefix) {
  const tag = `<base href="${basePrefix}/">`;
  const stripped = indexHtml.replace(/<base\b[^>]*>/gi, '');
  const head = /<head\b[^>]*>/i.exec(stripped);
  if (head === null) return tag + stripped;
  const end = head.index + head[0].length;
  return stripped.slice(0, end) + tag + stripped.slice(end);
}

/** A regular file under `root` for a URL-relative path, or null (no traversal). */
function fileUnder(root, relpath) {
  let decoded;
  try {
    decoded = decodeURIComponent(relpath);
  } catch {
    return null;
  }
  const target = resolve(root, decoded);
  if (target !== root && !target.startsWith(root + sep)) return null;
  try {
    return statSync(target).isFile() ? target : null;
  } catch {
    return null;
  }
}

function send(res, status, body, type, cache = 'no-cache') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': cache });
  res.end(body);
}

function sendFile(res, path, cache) {
  send(res, 200, readFileSync(path), TYPES[extname(path)] ?? 'application/octet-stream', cache);
}

function notFound(res) {
  send(res, 404, 'not found', 'text/plain; charset=utf-8');
}

function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const { pathname } = url;
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return notFound(res);
  const path = pathname.slice(prefix.length) || '/';

  if (path === '/' || path.startsWith('/s/')) {
    const page = join(dist, 'index.html');
    let html;
    try {
      html = readFileSync(page, 'utf8');
    } catch {
      return send(res, 503, `viewer not built: ${page} missing`, 'text/plain; charset=utf-8');
    }
    return send(res, 200, injectBase(html, prefix), TYPES['.html']);
  }
  if (path.startsWith('/assets/')) {
    const target = fileUnder(join(dist, 'assets'), path.slice('/assets/'.length));
    return target ? sendFile(res, target, 'public, max-age=31536000, immutable') : notFound(res);
  }
  if (path === '/config.json') return send(res, 200, config, TYPES['.json']);
  if (path.startsWith('/drafts/')) {
    const target = fileUnder(drafts, path.slice('/drafts/'.length));
    return target ? sendFile(res, target, 'no-cache') : notFound(res);
  }
  if (path === '/health') return send(res, 200, '{"status":"ok"}', TYPES['.json']);
  return notFound(res);
}

createServer(handle).listen(port, '127.0.0.1', () => {
  console.log(`viewer e2e server: http://127.0.0.1:${port}${prefix}/ (dist ${dist})`);
});
