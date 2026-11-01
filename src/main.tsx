import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { PublicOrder } from "./pages/PublicOrder";
import { Activate } from "./pages/Activate";
import { ActivateWorkshop } from "./pages/ActivateWorkshop";
import { PlatformAdmin } from "./pages/PlatformAdmin";
import { isPlatformAdminAvailable } from "./platformAdminAvailability";
import { App } from "./App";
import "./styles.css";
import "./document.css";

const platformAdminAvailable = isPlatformAdminAvailable({
  development: import.meta.env.DEV,
  enabled: import.meta.env.VITE_PLATFORM_ADMIN_ENABLED,
  allowedHosts: import.meta.env.VITE_PLATFORM_ADMIN_ALLOWED_HOSTS,
  hostname: window.location.hostname,
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/ativar" element={<Activate />} />
        <Route path="/ativar-oficina" element={<ActivateWorkshop />} />
        <Route path="/p/:token" element={<PublicOrder />} />
        {platformAdminAvailable && <Route path="/admin/*" element={<PlatformAdmin />} />}
        <Route path="*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
