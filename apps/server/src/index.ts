import { serve } from "@hono/node-server";
import { env } from "@github-profile-sam/env/server";
import { createApp } from "./app";

serve(
  {
    fetch: createApp({
      corsOrigin: env.CORS_ORIGIN,
      jwtSecret: env.JWT_SECRET,
      isProduction: env.NODE_ENV === "production"
    }).fetch,
    port: 3000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
