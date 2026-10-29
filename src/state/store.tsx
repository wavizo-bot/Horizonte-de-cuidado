import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AppState,
  Appointment,
  AppointmentStatus,
  CareModel,
  ContactAttempt,
  DayOverride,
  ISODate,
  MessageTemplate,
  Patient,
  PatientNote,
  PatientStatus,
  Reminder,
  Settings,
  UnscheduledItem,
} from "../types";
import { nowISOString, todayISO } from "../lib/date";
import { newId } from "../lib/id";
import { demoState, emptyState } from "../lib/defaults";
import { buildPlan, nextAvailableDate } from "../lib/schedule";
import { clearStoredState, loadState, saveState } from "../lib/storage";
import { exportPatientsCsv, importFromJson, importFromTable, type ImportSummary } from "../lib/import";
import { useDriveSync } from "./sync";

export type PatientInput = Partial<Patient> & { name: string };
export type CareModelInput = Partial<CareModel> & { name: string };

export interface AppointmentInput {
  patientId: string;
  careModelId?: string;
  date: ISODate;
  time?: string;
  slotType: Appointment["slotType"];
  notes?: string;
  locked?: boolean;
}

interface StoreContextValue {
  state: AppState;
  loaded: boolean;
  saving: boolean;
  saveError?: string;
  unscheduled: UnscheduledItem[];
  retryLoad: () => Promise<void>;
  createPatient: (input: PatientInput) => string;
  updatePatient: (id: string, patch: Partial<Patient>) => void;
  deletePatient: (id: string) => void;
  setPatientStatus: (id: string, status: PatientStatus) => void;
  addPatientNote: (id: string, text: string) => void;
  addContactAttempt: (id: string, attempt: Omit<ContactAttempt, "id" | "at"> & { at?: string }) => void;
  createAppointment: (input: AppointmentInput) => string;
  updateAppointment: (id: string, patch: Partial<Appointment>) => void;
  markAppointment: (id: string, status: AppointmentStatus, notes?: string) => void;
  scheduleMakeup: (patientId: string, fromDate?: ISODate) => ISODate | null;
  createReminder: (input: Omit<Reminder, "id" | "createdAt" | "done"> & { done?: boolean }) => string;
  updateReminder: (id: string, patch: Partial<Reminder>) => void;
  deleteReminder: (id: string) => void;
  createCareModel: (input: CareModelInput) => string;
  saveCareModel: (model: CareModel) => void;
  deleteCareModel: (id: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  setDayOverride: (override: DayOverride) => void;
  removeDayOverride: (date: ISODate) => void;
  createTemplate: (input: Omit<MessageTemplate, "id" | "updatedAt">) => string;
  saveTemplate: (template: MessageTemplate) => void;
  deleteTemplate: (id: string) => void;
  importTable: (text: string) => ImportSummary;
  importJson: (text: string, mode: "merge" | "replace") => ImportSummary;
  exportJson: () => string;
  exportCsv: () => string;
  resetLocalData: () => Promise<void>;
  loadDemoData: () => Promise<void>;
  reloadFromDisk: () => Promise<void>;
  getPatient: (id: string) => Patient | undefined;
  getModel: (id?: string) => CareModel | undefined;
  drive: ReturnType<typeof useDriveSync>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

function sortAppointments(appointments: Appointment[]): Appointment[] {
  return appointments
    .slice()
    .sort((a, b) => `${a.date} ${a.time ?? "99:99"} ${a.patientId}`.localeCompare(`${b.date} ${b.time ?? "99:99"} ${b.patientId}`));
}

function applyPlan(state: AppState): { state: AppState; unscheduled: UnscheduledItem[] } {
  const today = todayISO();
  const plan = buildPlan(state, { today });
  const existing = new Map(state.appointments.map((appointment) => [appointment.id, appointment]));
  const generated = plan.appointments.map((appointment) => {
    const previous = existing.get(appointment.id);
    return previous
      ? { ...appointment, createdAt: previous.createdAt, notes: previous.notes, updatedAt: previous.updatedAt }
      : appointment;
  });
  const history = state.appointments.filter(
    (appointment) =>
      appointment.status !== "scheduled" ||
      appointment.locked ||
      appointment.source === "manual" ||
      appointment.date < today,
  );
  const byId = new Map(history.map((appointment) => [appointment.id, appointment]));
  for (const appointment of generated) byId.set(appointment.id, appointment);
  return {
    state: { ...state, appointments: sortAppointments([...byId.values()]) },
    unscheduled: plan.unscheduled,
  };
}

function audit(state: AppState, action: string, detail: string, patientId?: string): AppState {
  const event = { id: newId("audit"), at: nowISOString(), action, detail, patientId };
  return { ...state, audit: [...state.audit.slice(-499), event] };
}

function touch(state: AppState): AppState {
  return { ...state, meta: { ...state.meta, updatedAt: nowISOString() } };
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(() => demoState());
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [unscheduled, setUnscheduled] = useState<UnscheduledItem[]>([]);
  const stateRef = useRef(state);

  const applyExternalState = useCallback((next: AppState) => {
    const planned = applyPlan(next);
    stateRef.current = planned.state;
    setState(planned.state);
    setUnscheduled(planned.unscheduled);
    void saveState(planned.state);
  }, []);

  const drive = useDriveSync({ state, stateRef, applyExternalState, loaded });

  const commit = useCallback(
    (producer: (previous: AppState) => AppState, options?: { replan?: boolean }) => {
      const previous = stateRef.current;
      const produced = producer(previous);
      const next = touch(produced);
      const planned = options?.replan === false ? { state: next, unscheduled } : applyPlan(next);
      stateRef.current = planned.state;
      setState(planned.state);
      setUnscheduled(planned.unscheduled);
      drive.recordChanges(previous, planned.state);
    },
    [drive, unscheduled],
  );

  const load = useCallback(async () => {
    setSaveError(undefined);
    const result = await loadState();
    if (result.error) {
      setSaveError(result.error);
    }
    const next = result.state ?? demoState();
    const planned = applyPlan(next);
    stateRef.current = planned.state;
    setState(planned.state);
    setUnscheduled(planned.unscheduled);
    setLoaded(true);
    if (!result.state) void saveState(planned.state);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!loaded) return;
    setSaving(true);
    const timer = window.setTimeout(async () => {
      try {
        await saveState(stateRef.current);
        setSaveError(undefined);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Falha ao salvar.");
      } finally {
        setSaving(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [state, loaded]);

  const createPatient = useCallback(
    (input: PatientInput) => {
      const now = nowISOString();
      const patient: Patient = {
        id: newId("pac"),
        name: input.name.trim(),
        registrationNumber: (input.registrationNumber ?? "").trim(),
        age: input.age,
        birthDate: input.birthDate,
        phone: input.phone,
        noWhatsapp: input.noWhatsapp ?? !input.phone,
        phoneNote: input.phoneNote,
        referralDate: input.referralDate ?? todayISO(),
        referralReason: input.referralReason ?? "",
        referringTeam: input.referringTeam ?? "",
        triageDate: input.triageDate,
        careModelId: input.careModelId ?? stateRef.current.settings.defaultTriageModelId ?? "cm-triage",
        status: input.status ?? (input.triageDate ? "active" : "waiting_triage"),
        priority: input.priority ?? false,
        priorityReason: input.priorityReason,
        recurrence: input.recurrence ?? "none",
        preferredWeekday: input.preferredWeekday,
        observations: input.observations,
        notes: [],
        contactAttempts: [],
        createdAt: now,
        updatedAt: now,
      };
      commit(
        (previous) =>
          audit(
            { ...previous, patients: [...previous.patients, patient] },
            "paciente.criado",
            `Cadastro de ${patient.name}.`,
            patient.id,
          ),
        { replan: true },
      );
      return patient.id;
    },
    [commit],
  );

  const updatePatient = useCallback(
    (id: string, patch: Partial<Patient>) => {
      commit(
        (previous) => {
          const current = previous.patients.find((patient) => patient.id === id);
          if (!current) return previous;
          const next: Patient = { ...current, ...patch, updatedAt: nowISOString() };
          if (patch.triageDate && !current.triageDate && next.status === "waiting_triage") {
            next.status = "active";
          }
          return audit(
            { ...previous, patients: previous.patients.map((patient) => (patient.id === id ? next : patient)) },
            "paciente.editado",
            `Dados de ${next.name} atualizados.`,
            id,
          );
        },
        { replan: true },
      );
    },
    [commit],
  );

  const deletePatient = useCallback(
    (id: string) => {
      commit(
        (previous) => {
          const patient = previous.patients.find((item) => item.id === id);
          return audit(
            {
              ...previous,
              patients: previous.patients.filter((item) => item.id !== id),
              appointments: previous.appointments.filter((appointment) => appointment.patientId !== id),
            },
            "paciente.excluido",
            `Cadastro de ${patient?.name ?? id} excluído.`,
            id,
          );
        },
        { replan: true },
      );
    },
    [commit],
  );

  const setPatientStatus = useCallback(
    (id: string, status: PatientStatus) => {
      updatePatient(id, { status });
    },
    [updatePatient],
  );

  const addPatientNote = useCallback(
    (id: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const note: PatientNote = { id: newId("nota"), at: nowISOString(), text: trimmed };
      commit((previous) => {
        const patient = previous.patients.find((item) => item.id === id);
        if (!patient) return previous;
        const next = { ...patient, notes: [...patient.notes, note], updatedAt: nowISOString() };
        return audit(
          { ...previous, patients: previous.patients.map((item) => (item.id === id ? next : item)) },
          "paciente.anotacao",
          `Anotação registrada no perfil de ${patient.name}.`,
          id,
        );
      });
    },
    [commit],
  );

  const addContactAttempt = useCallback(
    (id: string, attempt: Omit<ContactAttempt, "id" | "at"> & { at?: string }) => {
      const record: ContactAttempt = {
        ...attempt,
        id: newId("contato"),
        at: attempt.at ?? nowISOString(),
      };
      commit((previous) => {
        const patient = previous.patients.find((item) => item.id === id);
        if (!patient) return previous;
        const next: Patient = {
          ...patient,
          contactAttempts: [...patient.contactAttempts, record],
          noWhatsapp: attempt.outcome === "no_whatsapp" ? true : patient.noWhatsapp,
          updatedAt: nowISOString(),
        };
        return audit(
          { ...previous, patients: previous.patients.map((item) => (item.id === id ? next : item)) },
          "paciente.contato",
          `Tentativa de contato registrada para ${patient.name}.`,
          id,
        );
      });
    },
    [commit],
  );

  const createAppointment = useCallback(
    (input: AppointmentInput) => {
      const now = nowISOString();
      const patient = stateRef.current.patients.find((item) => item.id === input.patientId);
      const appointment: Appointment = {
        id: newId("ag"),
        patientId: input.patientId,
        careModelId: input.careModelId ?? patient?.careModelId ?? "",
        date: input.date,
        time: input.time,
        slotType: input.slotType,
        status: "scheduled",
        source: "manual",
        locked: input.locked ?? true,
        notes: input.notes,
        createdAt: now,
        updatedAt: now,
      };
      commit(
        (previous) =>
          audit(
            { ...previous, appointments: [...previous.appointments, appointment] },
            "agenda.manual",
            `Agendamento manual em ${input.date} para ${patient?.name ?? input.patientId}.`,
            input.patientId,
          ),
        { replan: true },
      );
      return appointment.id;
    },
    [commit],
  );

  const updateAppointment = useCallback(
    (id: string, patch: Partial<Appointment>) => {
      commit(
        (previous) => ({
          ...previous,
          appointments: previous.appointments.map((appointment) =>
            appointment.id === id
              ? { ...appointment, ...patch, locked: patch.locked ?? true, updatedAt: nowISOString() }
              : appointment,
          ),
        }),
        { replan: true },
      );
    },
    [commit],
  );

  const markAppointment = useCallback(
    (id: string, status: AppointmentStatus, notes?: string) => {
      commit(
        (previous) => {
          const appointment = previous.appointments.find((item) => item.id === id);
          if (!appointment) return previous;
          const patient = previous.patients.find((item) => item.id === appointment.patientId);
          const updatedAppointment: Appointment = {
            ...appointment,
            status,
            notes: notes ?? appointment.notes,
            locked: true,
            updatedAt: nowISOString(),
          };
          let patients = previous.patients;
          if (status === "done" && appointment.slotType === "triage" && patient) {
            patients = previous.patients.map((item) =>
              item.id === patient.id
                ? {
                    ...item,
                    triageDate: appointment.date,
                    status: item.status === "waiting_triage" ? "active" : item.status,
                    updatedAt: nowISOString(),
                  }
                : item,
            );
          }
          return audit(
            {
              ...previous,
              patients,
              appointments: previous.appointments.map((item) => (item.id === id ? updatedAppointment : item)),
            },
            "agenda.status",
            `Agendamento de ${patient?.name ?? appointment.patientId} em ${appointment.date} marcado como ${status}.`,
            appointment.patientId,
          );
        },
        { replan: true },
      );
    },
    [commit],
  );

  const scheduleMakeup = useCallback(
    (patientId: string, fromDate: ISODate = todayISO()) => {
      const current = stateRef.current;
      const patient = current.patients.find((item) => item.id === patientId);
      if (!patient) return null;
      let date = nextAvailableDate(current, patientId, "makeup", fromDate);
      let slotType: Appointment["slotType"] = "makeup";
      if (!date) {
        slotType = patient.careModelId?.includes("group") ? "group" : "individual";
        date = nextAvailableDate(current, patientId, slotType, fromDate);
      }
      if (!date) return null;
      const now = nowISOString();
      const appointment: Appointment = {
        id: newId("ag"),
        patientId,
        careModelId: patient.careModelId ?? "",
        date,
        slotType,
        status: "scheduled",
        source: "manual",
        locked: true,
        notes: "Reposição de falta",
        createdAt: now,
        updatedAt: now,
      };
      commit(
        (previous) =>
          audit(
            { ...previous, appointments: [...previous.appointments, appointment] },
            "agenda.reposicao",
            `Reposição de falta de ${patient.name} em ${date}.`,
            patientId,
          ),
        { replan: true },
      );
      return date;
    },
    [commit],
  );

  const createReminder = useCallback(
    (input: Omit<Reminder, "id" | "createdAt" | "done"> & { done?: boolean }) => {
      const reminder: Reminder = {
        ...input,
        id: newId("lembrete"),
        done: input.done ?? false,
        createdAt: nowISOString(),
      };
      commit(
        (previous) => ({
          ...previous,
          reminders: [...previous.reminders, reminder],
        }),
        { replan: false },
      );
      return reminder.id;
    },
    [commit],
  );

  const updateReminder = useCallback(
    (id: string, patch: Partial<Reminder>) => {
      commit(
        (previous) => ({
          ...previous,
          reminders: previous.reminders.map((reminder) => (reminder.id === id ? { ...reminder, ...patch } : reminder)),
        }),
        { replan: false },
      );
    },
    [commit],
  );

  const deleteReminder = useCallback(
    (id: string) => {
      commit(
        (previous) => ({ ...previous, reminders: previous.reminders.filter((reminder) => reminder.id !== id) }),
        { replan: false },
      );
    },
    [commit],
  );

  const createCareModel = useCallback(
    (input: CareModelInput) => {
      const model: CareModel = {
        id: newId("modelo"),
        name: input.name.trim(),
        kind: input.kind ?? "group",
        slotType: input.slotType ?? (input.kind === "individual" ? "individual" : input.kind === "collective" ? "collective" : "group"),
        color: input.color ?? "#5b7a63",
        active: input.active ?? true,
        description: input.description,
        schedule: input.schedule,
        maxMembers: input.maxMembers,
      };
      commit((previous) => ({ ...previous, careModels: [...previous.careModels, model] }), { replan: true });
      return model.id;
    },
    [commit],
  );

  const saveCareModel = useCallback(
    (model: CareModel) => {
      commit(
        (previous) => ({
          ...previous,
          careModels: previous.careModels.some((item) => item.id === model.id)
            ? previous.careModels.map((item) => (item.id === model.id ? model : item))
            : [...previous.careModels, model],
        }),
        { replan: true },
      );
    },
    [commit],
  );

  const deleteCareModel = useCallback(
    (id: string) => {
      commit(
        (previous) => {
          const fallback = previous.settings.defaultTriageModelId ?? "cm-triage";
          return audit(
            {
              ...previous,
              careModels: previous.careModels.filter((model) => model.id !== id),
              patients: previous.patients.map((patient) =>
                patient.careModelId === id
                  ? { ...patient, careModelId: fallback, updatedAt: nowISOString() }
                  : patient,
              ),
            },
            "modelo.excluido",
            `Modelo de atendimento removido; pacientes vinculados voltaram para matriciamento.`,
          );
        },
        { replan: true },
      );
    },
    [commit],
  );

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      commit((previous) => ({ ...previous, settings: { ...previous.settings, ...patch } }), { replan: true });
    },
    [commit],
  );

  const setDayOverride = useCallback(
    (override: DayOverride) => {
      commit(
        (previous) => ({
          ...previous,
          settings: {
            ...previous.settings,
            dayOverrides: [
              ...previous.settings.dayOverrides.filter((item) => item.date !== override.date),
              override,
            ].sort((a, b) => a.date.localeCompare(b.date)),
          },
        }),
        { replan: true },
      );
    },
    [commit],
  );

  const removeDayOverride = useCallback(
    (date: ISODate) => {
      commit(
        (previous) => ({
          ...previous,
          settings: {
            ...previous.settings,
            dayOverrides: previous.settings.dayOverrides.filter((item) => item.date !== date),
          },
        }),
        { replan: true },
      );
    },
    [commit],
  );

  const createTemplate = useCallback(
    (input: Omit<MessageTemplate, "id" | "updatedAt">) => {
      const template: MessageTemplate = { ...input, id: newId("tpl"), updatedAt: nowISOString() };
      commit((previous) => ({ ...previous, templates: [...previous.templates, template] }), { replan: false });
      return template.id;
    },
    [commit],
  );

  const saveTemplate = useCallback(
    (template: MessageTemplate) => {
      commit(
        (previous) => ({
          ...previous,
          templates: previous.templates.some((item) => item.id === template.id)
            ? previous.templates.map((item) => (item.id === template.id ? { ...template, updatedAt: nowISOString() } : item))
            : [...previous.templates, template],
        }),
        { replan: false },
      );
    },
    [commit],
  );

  const deleteTemplate = useCallback(
    (id: string) => {
      commit((previous) => ({ ...previous, templates: previous.templates.filter((item) => item.id !== id) }), {
        replan: false,
      });
    },
    [commit],
  );

  const importTable = useCallback(
    (text: string) => {
      const result = importFromTable(stateRef.current, text);
      commit(() => result.state, { replan: true });
      return result.summary;
    },
    [commit],
  );

  const importJson = useCallback(
    (text: string, mode: "merge" | "replace") => {
      const result = importFromJson(stateRef.current, text, mode);
      commit(() => result.state, { replan: true });
      return result.summary;
    },
    [commit],
  );

  const exportJson = useCallback(() => {
    return JSON.stringify(
      {
        app: "horizonte-de-cuidado",
        version: 1,
        exportedAt: nowISOString(),
        ...stateRef.current,
      },
      null,
      2,
    );
  }, []);

  const exportCsv = useCallback(() => exportPatientsCsv(stateRef.current), []);

  const resetLocalData = useCallback(async () => {
    await clearStoredState();
    const next = emptyState();
    const planned = applyPlan(next);
    stateRef.current = planned.state;
    setState(planned.state);
    setUnscheduled(planned.unscheduled);
    await saveState(planned.state);
  }, []);

  const loadDemoData = useCallback(async () => {
    const previous = stateRef.current;
    const next = demoState();
    const planned = applyPlan(next);
    stateRef.current = planned.state;
    setState(planned.state);
    setUnscheduled(planned.unscheduled);
    await saveState(planned.state);
    drive.recordChanges(previous, planned.state);
  }, [drive]);

  const reloadFromDisk = useCallback(async () => {
    await load();
  }, [load]);

  const getPatient = useCallback(
    (id: string) => stateRef.current.patients.find((patient) => patient.id === id),
    [],
  );

  const getModel = useCallback(
    (id?: string) => stateRef.current.careModels.find((model) => model.id === id),
    [],
  );

  const value = useMemo<StoreContextValue>(
    () => ({
      state,
      loaded,
      saving,
      saveError,
      unscheduled,
      retryLoad: load,
      createPatient,
      updatePatient,
      deletePatient,
      setPatientStatus,
      addPatientNote,
      addContactAttempt,
      createAppointment,
      updateAppointment,
      markAppointment,
      scheduleMakeup,
      createReminder,
      updateReminder,
      deleteReminder,
      createCareModel,
      saveCareModel,
      deleteCareModel,
      updateSettings,
      setDayOverride,
      removeDayOverride,
      createTemplate,
      saveTemplate,
      deleteTemplate,
      importTable,
      importJson,
      exportJson,
      exportCsv,
      resetLocalData,
      loadDemoData,
      reloadFromDisk,
      getPatient,
      getModel,
      drive,
    }),
    [
      state,
      loaded,
      saving,
      saveError,
      unscheduled,
      load,
      createPatient,
      updatePatient,
      deletePatient,
      setPatientStatus,
      addPatientNote,
      addContactAttempt,
      createAppointment,
      updateAppointment,
      markAppointment,
      scheduleMakeup,
      createReminder,
      updateReminder,
      deleteReminder,
      createCareModel,
      saveCareModel,
      deleteCareModel,
      updateSettings,
      setDayOverride,
      removeDayOverride,
      createTemplate,
      saveTemplate,
      deleteTemplate,
      importTable,
      importJson,
      exportJson,
      exportCsv,
      resetLocalData,
      loadDemoData,
      reloadFromDisk,
      getPatient,
      getModel,
      drive,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const context = useContext(StoreContext);
  if (!context) throw new Error("useStore precisa estar dentro de StoreProvider.");
  return context;
}
