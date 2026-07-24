import { RouterProvider, createRouter } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";
import { createPerformanceSdk } from "@github-profile-sam/performance-sdk";
import { env } from "@github-profile-sam/env/web";

import Loader from "./components/loader";
import { routeTree } from "./routeTree.gen";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
  defaultPendingComponent: () => <Loader />,
  context: {},
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Root element not found");
}

if (!rootElement.innerHTML) {
  if (env.VITE_PERFORMANCE_ENABLED) {
    createPerformanceSdk({
      endpoint: `${env.VITE_SERVER_URL.replace(/\/+$/, "")}/api/performance/events`,
      appId: env.VITE_PERFORMANCE_APP_ID,
      release: env.VITE_RELEASE_VERSION,
      environment: env.VITE_APP_ENV,
      captureFetch: true,
      captureResources: true
    });
  }
  const root = ReactDOM.createRoot(rootElement);
  root.render(<RouterProvider router={router} />);
}
