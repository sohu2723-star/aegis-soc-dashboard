// Vercel serverless entry point — wraps the Express app with serverless-http.
// All /api/* requests from the Vercel frontend are routed here.
import app from "@workspace/api-server/app";
import serverless from "serverless-http";

// SSE (/api/events/stream) won't stream on Vercel (functions terminate after
// the response completes), but all REST endpoints work normally.
export default serverless(app);
