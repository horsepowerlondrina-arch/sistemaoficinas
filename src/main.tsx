import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { PublicOrder } from "./pages/PublicOrder";
import { Activate } from "./pages/Activate";
import { PlatformAdmin } from "./pages/PlatformAdmin";
import { App } from "./App";
import "./styles.css";
import "./document.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <div className="development-notice" role="status">
      Ambiente de testes · Dados de demonstração
    </div>
    <BrowserRouter>
      <Routes>
        <Route path="/ativar" element={<Activate />} />
        <Route path="/p/:token" element={<PublicOrder />} />
        {import.meta.env.DEV && <Route path="/admin/*" element={<PlatformAdmin />} />}
        <Route path="*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
