import express, { Router } from "express";
import swaggerUiDist from "swagger-ui-dist";
import { openApiSpec } from "./openapi.js";

// Interactive API docs at /api/docs, served from the swagger-ui-dist package
// (no CDN). The page has no inline script, so a strict CSP still applies.

const router = Router();

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Document Repository API</title>
  <link rel="icon" href="/api/docs/assets/favicon-32x32.png">
  <link rel="stylesheet" href="/api/docs/assets/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/api/docs/assets/swagger-ui-bundle.js"></script>
  <script src="/api/docs/init.js"></script>
</body>
</html>`;

const init = `window.ui = SwaggerUIBundle({
  url: "/api/docs/openapi.json",
  dom_id: "#swagger-ui",
  deepLinking: true,
  persistAuthorization: true,
  validatorUrl: null,
  // Send the session cookie with "Try it out" requests
  requestInterceptor: function (request) { request.credentials = "include"; return request; }
});`;

// Helmet's default policy adds "upgrade-insecure-requests", which would make the
// browser fetch this page's files over https when the app runs on plain http.
router.use((_req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
      "connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  );
  next();
});

router.get("/", (_req, res) => {
  res.type("html").send(page);
});

router.get("/init.js", (_req, res) => {
  res.type("application/javascript").send(init);
});

router.get("/openapi.json", (_req, res) => {
  res.json(openApiSpec);
});

router.use("/assets", express.static(swaggerUiDist.getAbsoluteFSPath(), { index: false, maxAge: "1d" }));

export default router;
