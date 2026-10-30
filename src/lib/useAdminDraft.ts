import {useEffect} from "react";
const draftEvent="admin:check-drafts";
export function confirmAdminNavigation() {
 const event=new Event(draftEvent,{cancelable:true});
 window.dispatchEvent(event);
 return !event.defaultPrevented || window.confirm("Há alterações não salvas. Deseja descartá-las e continuar?");
}
export function useAdminDraft(dirty:boolean) {
 useEffect(()=>{
  if(!dirty)return;
  const check=(event:Event)=>event.preventDefault();
  const unload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
  window.addEventListener(draftEvent,check);
  window.addEventListener("beforeunload",unload);
  return ()=>{window.removeEventListener(draftEvent,check);window.removeEventListener("beforeunload",unload);};
 },[dirty]);
}
