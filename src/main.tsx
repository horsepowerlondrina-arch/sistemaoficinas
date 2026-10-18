import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { PublicOrder } from "./pages/PublicOrder";
import { Activate } from "./pages/Activate";
import { App } from "./App";
import "./styles.css";
import "./document.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <div className="development-notice" role="status">
      HPDesenvolvimento · Ambiente de testes · Alterações não afetam a oficina
    </div>
    <BrowserRouter>
      <Routes>
        <Route path="/ativar" element={<Activate />} />
        <Route path="/p/:token" element={<PublicOrder />} />
        <Route path="*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
