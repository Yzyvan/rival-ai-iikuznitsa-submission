import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/app.css";
import { App } from "./App";

import { loadBrowserAccess } from "./api/mailBoard";

void loadBrowserAccess().then(() => createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>));
