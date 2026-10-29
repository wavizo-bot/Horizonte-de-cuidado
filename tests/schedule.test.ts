import { describe, expect, it } from "vitest";
import {
  buildPlan,
  capacityForDate,
  meetingDates,
  nextAvailableDate,
} from "../src/lib/schedule";
import { appointment, capacity, groupModel, individualModel, patient, testState, triageModel } from "./fixtures";

const TODAY = "2026-11-02"; // segunda-feira

function onlyMondayTriage(capacityValue = 1) {
  const weekly = ([0, 1, 2, 3, 4, 5, 6] as const).map((weekday) =>
    capacity(weekday, { triage: weekday === 1 ? capacityValue : 0 }),
  );
  return testState({
    careModels: [triageModel()],
    settings: { ...testState().settings, workdays: [1], weeklyCapacity: weekly },
  });
}

describe("capacityForDate", () => {
  it("usa a capacidade semanal apenas nos dias de funcionamento", () => {
    const state = onlyMondayTriage(2);
    expect(capacityForDate(state, "2026-11-02").capacity.triage).toBe(2);
    expect(capacityForDate(state, "2026-11-03").capacity.triage).toBe(0);
    expect(capacityForDate(state, "2026-11-03").closed).toBe(false);
  });

  it("respeita dia fechado e capacidade especial", () => {
    const base = onlyMondayTriage(2);
    const closed = {
      ...base,
      settings: {
        ...base.settings,
        dayOverrides: [{ date: "2026-11-02", closed: true, reason: "Reunião" }],
      },
    };
    expect(capacityForDate(closed, "2026-11-02")).toMatchObject({ closed: true, reason: "Reunião" });
    expect(capacityForDate(closed, "2026-11-02").capacity.triage).toBe(0);

    const special = {
      ...base,
      settings: {
        ...base.settings,
        dayOverrides: [{ date: "2026-11-03", closed: false, capacity: { triage: 3 } }],
      },
    };
    expect(capacityForDate(special, "2026-11-03").capacity.triage).toBe(3);
    expect(capacityForDate(special, "2026-11-03").capacity.individual).toBe(0);
  });
});

describe("buildPlan — matriciamento", () => {
  it("coloca pacientes prioritários antes, mesmo com encaminhamento mais recente", () => {
    const state = onlyMondayTriage(1);
    state.patients = [
      patient({ id: "normal", name: "Pessoa Normal", referralDate: "2026-09-01" }),
      patient({ id: "prioridade", name: "Pessoa Prioritária", referralDate: "2026-10-20", priority: true }),
    ];
    const plan = buildPlan(state, { today: TODAY, horizonDays: 30 });
    const byPatient = new Map(plan.appointments.map((item) => [item.patientId, item]));
    expect(byPatient.get("prioridade")?.date).toBe("2026-11-02");
    expect(byPatient.get("normal")?.date).toBe("2026-11-09");
    expect(plan.unscheduled).toHaveLength(0);
  });

  it("pula dia fechado e mantém a ordem da fila", () => {
    const state = onlyMondayTriage(1);
    state.patients = [
      patient({ id: "prioridade", name: "Pessoa Prioritária", referralDate: "2026-10-20", priority: true }),
      patient({ id: "normal", name: "Pessoa Normal", referralDate: "2026-09-01" }),
    ];
    state.settings.dayOverrides = [{ date: "2026-11-02", closed: true }];
    const plan = buildPlan(state, { today: TODAY, horizonDays: 30 });
    const byPatient = new Map(plan.appointments.map((item) => [item.patientId, item]));
    expect(byPatient.get("prioridade")?.date).toBe("2026-11-09");
    expect(byPatient.get("normal")?.date).toBe("2026-11-16");
  });

  it("não esconde quem ficou sem vaga no horizonte", () => {
    const state = onlyMondayTriage(0);
    state.patients = [patient({ id: "sem-vaga", name: "Pessoa Sem Vaga", referralDate: "2026-09-01" })];
    const plan = buildPlan(state, { today: TODAY, horizonDays: 14 });
    expect(plan.appointments).toHaveLength(0);
    expect(plan.unscheduled).toEqual([
      expect.objectContaining({ patientId: "sem-vaga", slotType: "triage" }),
    ]);
  });
});

describe("buildPlan — individual e grupos", () => {
  it("preserva encaixe manual e não cria duplicata no mesmo dia", () => {
    const state = testState({ careModels: [individualModel()] });
    state.patients = [
      patient({
        id: "individual",
        name: "Pessoa Individual",
        status: "active",
        triageDate: "2026-10-01",
        careModelId: "cm-individual",
        recurrence: "none",
      }),
    ];
    state.appointments = [
      appointment({
        id: "manual-1",
        patientId: "individual",
        careModelId: "cm-individual",
        date: "2026-11-03",
        source: "manual",
        locked: true,
      }),
    ];
    const plan = buildPlan(state, { today: TODAY, horizonDays: 30 });
    expect(plan.appointments).toHaveLength(0);
  });

  it("gera um encontro por participante em cada data do grupo", () => {
    const model = groupModel();
    const state = testState({ careModels: [model] });
    state.patients = [
      patient({
        id: "g1",
        name: "Participante Um",
        status: "active",
        triageDate: "2026-10-01",
        careModelId: model.id,
        recurrence: "weekly",
      }),
      patient({
        id: "g2",
        name: "Participante Dois",
        status: "active",
        triageDate: "2026-10-01",
        careModelId: model.id,
        recurrence: "weekly",
      }),
    ];
    const plan = buildPlan(state, { today: TODAY, horizonDays: 28 });
    expect(plan.appointments).toHaveLength(8);
    expect(plan.appointments.every((item) => item.slotType === "group")).toBe(true);
    expect(plan.appointments.every((item) => item.careModelId === model.id)).toBe(true);
    const dates = [...new Set(plan.appointments.map((item) => item.date))].sort();
    expect(dates).toEqual(["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"]);
    const keys = plan.appointments.map((item) => `${item.patientId}:${item.date}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("respeita o limite de participantes do grupo", () => {
    const model = groupModel({ maxMembers: 1 });
    const state = testState({ careModels: [model] });
    state.patients = [
      patient({ id: "g1", name: "Ana", status: "active", triageDate: "2026-10-01", careModelId: model.id }),
      patient({ id: "g2", name: "Bruno", status: "active", triageDate: "2026-10-01", careModelId: model.id }),
    ];
    const plan = buildPlan(state, { today: TODAY, horizonDays: 7 });
    expect(plan.appointments).toHaveLength(1);
    expect(plan.appointments[0].patientId).toBe("g1");
    expect(plan.unscheduled).toEqual([
      expect.objectContaining({ patientId: "g2", reason: expect.stringContaining("limite") }),
    ]);
  });
});

describe("meetingDates", () => {
  it("calcula semanal, quinzenal e mensal", () => {
    const weekly = groupModel({ schedule: { weekday: 1, recurrence: "weekly" } });
    expect(meetingDates(weekly, "2026-11-02", "2026-11-23")).toEqual([
      "2026-11-02",
      "2026-11-09",
      "2026-11-16",
      "2026-11-23",
    ]);

    const biweekly = groupModel({ schedule: { weekday: 1, recurrence: "biweekly", anchorDate: "2026-11-02" } });
    expect(meetingDates(biweekly, "2026-11-10", "2026-11-30")).toEqual(["2026-11-16", "2026-11-30"]);

    const monthly = groupModel({ schedule: { weekday: 1, recurrence: "monthly", monthlyWeek: 5 } });
    expect(meetingDates(monthly, "2026-11-01", "2026-11-30")).toEqual(["2026-11-30"]);
  });
});

describe("nextAvailableDate", () => {
  it("considera vagas já ocupadas e dia preferido", () => {
    const state = onlyMondayTriage(1);
    state.patients = [
      patient({ id: "a", name: "Pessoa A", referralDate: "2026-10-01" }),
      patient({ id: "b", name: "Pessoa B", referralDate: "2026-10-01" }),
    ];
    state.appointments = [
      appointment({ id: "a-1", patientId: "a", date: "2026-11-02", slotType: "triage", source: "auto" }),
    ];
    expect(nextAvailableDate(state, "b", "triage", "2026-11-02", undefined, 30)).toBe("2026-11-09");
  });
});
