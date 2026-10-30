import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App.tsx";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/pixelify-sans/400.css";
import "@fontsource/pixelify-sans/500.css";
import "@fontsource/pixelify-sans/700.css";
import "@fontsource/vt323/400.css";
import "./ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
