import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ReferenceDeck } from "./ReferenceDeck";

const root = document.getElementById("root");
if (!root) throw new Error("Dashboard root element missing");
const isReferenceDeck =
  new URLSearchParams(window.location.search).get("window") ===
  "reference-deck";
createRoot(root).render(
  <StrictMode>{isReferenceDeck ? <ReferenceDeck /> : <App />}</StrictMode>,
);
