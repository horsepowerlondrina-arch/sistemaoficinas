import { useContext, useEffect } from "react";
import { UNSAFE_NavigationContext } from "react-router-dom";

export function useUnsavedSettings(dirty: boolean) {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  useEffect(() => {
    if (!dirty) return;
    const confirmLeave = () => window.confirm("Há alterações não salvas. Deseja sair e descartá-las?");
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const push = navigator.push, replace = navigator.replace, go = navigator.go;
    navigator.push = (...args) => { if (confirmLeave()) push.apply(navigator, args); };
    navigator.replace = (...args) => { if (confirmLeave()) replace.apply(navigator, args); };
    navigator.go = (...args) => { if (confirmLeave()) go.apply(navigator, args); };
    let index = window.history.state?.idx;
    let restoring = false;
    const pop = (event: PopStateEvent) => {
      if (restoring) { restoring = false; event.stopImmediatePropagation(); return; }
      const next = event.state?.idx;
      if (typeof index === "number" && typeof next === "number" && !confirmLeave()) {
        event.stopImmediatePropagation();
        restoring = true;
        window.history.go(index - next);
      } else index = next;
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("popstate", pop, true);
    return () => {
      navigator.push = push; navigator.replace = replace; navigator.go = go;
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("popstate", pop, true);
    };
  }, [dirty, navigator]);
}
