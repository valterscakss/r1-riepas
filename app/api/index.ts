import { createApp } from '../src/app.js';

// Vercel serverless entrypoint. The exported Express app is the request handler;
// vercel.json rewrites all routes here so the app serves both /api/* and the UI.
export default createApp();
