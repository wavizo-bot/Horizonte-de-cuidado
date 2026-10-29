export type ID = string;
/** Data civil no formato YYYY-MM-DD. Nunca usar toISOString() para datas civis. */
export type ISODate = string;
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type SlotType = "triage" | "individual" | "group" | "collective" | "makeup";
export type CareKind = "triage" | "individual" | "group" | "collective" | "other";
export type Recurrence = "weekly" | "biweekly" | "monthly" | "none";
export type MonthlyWeek = 1 | 2 | 3 | 4 | 5;

export type PatientStatus =
  | "waiting_triage"
  | "active"
  | "paused"
  | "discharged"
  | "transferred"
  | "refused"
  | "deceased";

export type AppointmentStatus = "scheduled" | "done" | "missed" | "cancelled";
export type ContactChannel = "whatsapp" | "call" | "sms" | "in_person" | "other";
export type ContactOutcome =
  | "sent"
  | "answered"
  | "no_answer"
  | "wrong_number"
  | "no_whatsapp"
  | "scheduled"
  | "other";
export type MessageCategory = "group" | "return" | "no_show" | "first" | "custom";

export interface ScheduleRule {
  weekday: Weekday;
  recurrence: Recurrence;
  /** Para recorrência mensal: 1ª, 2ª, 3ª, 4ª ou última semana do mês. */
  monthlyWeek?: MonthlyWeek;
  /** Primeira data de referência da recorrência (quinzenal/mensal). */
  anchorDate?: ISODate;
  time?: string;
}

export interface CareModel {
  id: ID;
  name: string;
  kind: CareKind;
  slotType: SlotType;
  color: string;
  active: boolean;
  description?: string;
  schedule?: ScheduleRule;
  /** Limite de participantes para modelos de grupo/coletivo. */
  maxMembers?: number;
}

export interface PatientNote {
  id: ID;
  at: string;
  text: string;
  author?: string;
}

export interface ContactAttempt {
  id: ID;
  at: string;
  channel: ContactChannel;
  outcome: ContactOutcome;
  note?: string;
  templateId?: ID;
}

export interface Patient {
  id: ID;
  name: string;
  registrationNumber: string;
  age?: number;
  birthDate?: ISODate;
  phone?: string;
  noWhatsapp: boolean;
  phoneNote?: string;
  referralDate: ISODate;
  referralReason: string;
  referringTeam: string;
  triageDate?: ISODate;
  careModelId?: ID;
  status: PatientStatus;
  priority: boolean;
  priorityReason?: string;
  /** Usado quando o modelo é individual. Grupos usam a recorrência do modelo. */
  recurrence: Recurrence;
  preferredWeekday?: Weekday;
  observations?: string;
  notes: PatientNote[];
  contactAttempts: ContactAttempt[];
  createdAt: string;
  updatedAt: string;
  source?: string;
}

export interface Appointment {
  id: ID;
  patientId: ID;
  careModelId: ID;
  date: ISODate;
  time?: string;
  slotType: SlotType;
  status: AppointmentStatus;
  source: "auto" | "manual";
  /** Preservado pelo replanejamento e pode exceder a capacidade com aviso. */
  locked?: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Reminder {
  id: ID;
  date: ISODate;
  time?: string;
  title: string;
  notes?: string;
  careModelId?: ID;
  done: boolean;
  createdAt: string;
}

export interface MessageTemplate {
  id: ID;
  name: string;
  category: MessageCategory;
  body: string;
  active: boolean;
  updatedAt: string;
}

export interface DayCapacity {
  weekday: Weekday;
  triage: number;
  individual: number;
  group: number;
  collective: number;
  makeup: number;
}

export interface DayOverride {
  date: ISODate;
  closed: boolean;
  reason?: string;
  capacity?: Partial<Record<SlotType, number>>;
}

export interface Settings {
  unitName: string;
  teamName: string;
  professionalName: string;
  professionalRole: string;
  workdays: Weekday[];
  weeklyCapacity: DayCapacity[];
  dayOverrides: DayOverride[];
  horizonDays: number;
  defaultTriageModelId: ID | null;
  defaultIndividualModelId: ID | null;
  messageSignature: string;
  defaultDdd: string;
  onboarded: boolean;
  termsAcceptedAt?: string;
  termsVersion?: string;
}

export interface AuditEvent {
  id: ID;
  at: string;
  action: string;
  detail: string;
  patientId?: ID;
}

export interface AppState {
  schemaVersion: number;
  patients: Patient[];
  careModels: CareModel[];
  appointments: Appointment[];
  reminders: Reminder[];
  templates: MessageTemplate[];
  settings: Settings;
  audit: AuditEvent[];
  meta: {
    createdAt: string;
    updatedAt: string;
    lastBackupAt?: string;
    seedSource?: string;
  };
}

export interface UnscheduledItem {
  patientId: ID;
  careModelId?: ID;
  slotType: SlotType;
  dueDate: ISODate;
  reason: string;
}

export interface PlanResult {
  appointments: Appointment[];
  unscheduled: UnscheduledItem[];
}

export interface DaySummary {
  date: ISODate;
  closed: boolean;
  reason?: string;
  capacity: Record<SlotType, number>;
  used: Record<SlotType, number>;
  appointments: Appointment[];
  reminders: Reminder[];
}

export interface MessageContext {
  patient?: Patient;
  careModel?: CareModel;
  date?: ISODate;
  time?: string;
  status?: AppointmentStatus;
  extra?: string;
}
