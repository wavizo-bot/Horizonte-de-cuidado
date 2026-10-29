import { useEffect } from "react";
import { Shell } from "./components/Shell";
import { Onboarding } from "./components/Onboarding";
import { useStore } from "./state/store";
import { useHashRoute } from "./navigation";
import { TodayView } from "./views/TodayView";
import { AgendaView } from "./views/AgendaView";
import { PatientsView } from "./views/PatientsView";
import { PatientDetailView } from "./views/PatientDetailView";
import { PatientFormView } from "./views/PatientFormView";
import { QueuesView } from "./views/QueuesView";
import { GroupsView } from "./views/GroupsView";
import { MessagesView } from "./views/MessagesView";
import { ReportsView } from "./views/ReportsView";
import { SettingsView } from "./views/SettingsView";

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-screen__mark">
        <svg viewBox="0 0 56 56" aria-hidden="true">
          <circle cx="28" cy="23" r="8" fill="currentColor" className="brand__sun" />
          <path d="M5 38c6-7 12-7 18 0s12 7 18 0 9-4 10-2" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
          <path d="M7 46c6-5 11-5 17 0s11 5 17 0 8-3 9-2" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" opacity=".55" />
        </svg>
      </div>
      <p className="eyebrow">Horizonte de Cuidado</p>
      <h1>Preparando seu caderno…</h1>
      <div className="loading-screen__bar"><span /></div>
    </div>
  );
}

export function App() {
  const { state, loaded } = useStore();
  const route = useHashRoute();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [route.name, route.patientId, route.date]);

  if (!loaded) return <LoadingScreen />;

  if (!state.settings.onboarded) {
    return <Onboarding />;
  }

  let page: React.ReactNode;
  switch (route.name) {
    case "agenda":
      page = <AgendaView routeDate={route.date} />;
      break;
    case "patients":
      page = <PatientsView />;
      break;
    case "patient":
      page = <PatientDetailView patientId={route.patientId ?? ""} />;
      break;
    case "patient-new":
      page = <PatientFormView />;
      break;
    case "patient-edit":
      page = <PatientFormView patientId={route.patientId} />;
      break;
    case "queues":
      page = <QueuesView />;
      break;
    case "groups":
      page = <GroupsView />;
      break;
    case "messages":
      page = <MessagesView routePatientId={route.patientId} />;
      break;
    case "reports":
      page = <ReportsView />;
      break;
    case "settings":
      page = <SettingsView initialTab={route.tab} />;
      break;
    case "today":
    default:
      page = <TodayView />;
  }

  return (
    <Shell route={route}>
      <div key={`${route.name}-${route.patientId ?? ""}-${route.date ?? ""}-${route.tab ?? ""}`} className="view-enter">
        {page}
      </div>
    </Shell>
  );
}
