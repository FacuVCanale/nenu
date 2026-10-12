import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./index.css";
import "./workbench.css";
// One stylesheet per area, after the shared frame; each is owned by the area that draws it.
import "./styles/nav.css";
import "./styles/shell.css";
import "./styles/strips.css";
import "./styles/project.css";
import "./styles/chat.css";
import "./styles/composer.css";
// Registers the service worker (precaches the app shell, enables install) and wires auto/manual
// updates. Guards on `serviceWorker in navigator`, so over plain HTTP (insecure context) it no-ops.
import "./lib/pwa";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
