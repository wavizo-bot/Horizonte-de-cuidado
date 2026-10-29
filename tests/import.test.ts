import { describe, expect, it } from "vitest";
import {
  exportPatientsCsv,
  importFromJson,
  importFromTable,
  mergePatients,
  parseDateBR,
  parseTable,
  patientFromRow,
} from "../src/lib/import";
import { emptyState } from "../src/lib/defaults";
import { patient, testState } from "./fixtures";

const HEADER = "F,CADASTRO,IDADE,TELEFONE,DATA DE ENCAMINHAMENTO,MOTIVO,EQUIPE,DATA DE TRIAGEM,MODELO ,OBS:";
const ROW =
  '"PACIENTE EXEMPLO ALFA","900001","6","11900000001","02/03/2026","comportamental","EQUIPE EXEMPLO","04/11/2026","orientação de pais",""';
const ROW_NO_PHONE =
  '"PACIENTE EXEMPLO BETA","900002","10","","07/04/2026","conflitos familiares","EQUIPE EXEMPLO","","GRUPO DE CRIANÇAS",""';

describe("parseDateBR", () => {
  it("aceita data brasileira e ISO", () => {
    expect(parseDateBR("02/03/2026")).toBe("2026-03-02");
    expect(parseDateBR("2/3/26")).toBe("2026-03-02");
    expect(parseDateBR("2026-03-02")).toBe("2026-03-02");
    expect(parseDateBR("")).toBeUndefined();
    expect(parseDateBR("sem data")).toBeUndefined();
  });
});

describe("parseTable", () => {
  it("mapeia a primeira coluna F para o nome quando não há cabeçalho de nome", () => {
    const rows = parseTable(`${HEADER}\n${ROW}\n${ROW_NO_PHONE}`);
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("PACIENTE EXEMPLO ALFA");
    expect(rows[0].registrationNumber).toBe("900001");
    expect(rows[0].careModel).toBe("orientação de pais");
    expect(rows[1].phone).toBe("");
  });

  it("reconhece cabeçalho com nome explícito e tolera BOM", () => {
    const rows = parseTable(`\uFEFFNome;Cadastro;Idade;Telefone\nAna;1;30;11999999999`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Ana",
      registrationNumber: "1",
      age: "30",
      phone: "11999999999",
    });
  });
});

describe("patientFromRow", () => {
  it("normaliza nome em caixa alta, telefone, idade, prioridade e modelo", () => {
    const state = emptyState();
    const created: string[] = [];
    const parsed = patientFromRow(
      state,
      {
        name: "PACIENTE EXEMPLO ALFA",
        registrationNumber: "900001",
        age: "6",
        phone: "(11) 90000-0001",
        referralDate: "02/03/2026",
        referralReason: "risco e conflitos familiares",
        referringTeam: "EQUIPE EXEMPLO",
        triageDate: "04/11/2026",
        careModel: "orientação de pais",
        observations: "",
      },
      created,
    );
    expect(parsed.name).toBe("Paciente Exemplo Alfa");
    expect(parsed.phone).toBe("11900000001");
    expect(parsed.age).toBe(6);
    expect(parsed.referralDate).toBe("2026-03-02");
    expect(parsed.triageDate).toBe("2026-11-04");
    expect(parsed.careModelId).toBe("cm-parents");
    expect(parsed.status).toBe("active");
    expect(parsed.priority).toBe(true);
    expect(parsed.recurrence).toBe("weekly");
    expect(parsed.preferredWeekday).toBe(2);
    expect(parsed.noWhatsapp).toBe(false);
    expect(created).toHaveLength(0);
  });

  it("marca sem WhatsApp quando não há telefone", () => {
    const state = emptyState();
    const parsed = patientFromRow(
      state,
      {
        name: "PACIENTE EXEMPLO BETA",
        registrationNumber: "900002",
        age: "10",
        phone: "",
        referralDate: "07/04/2026",
        referralReason: "",
        referringTeam: "",
        triageDate: "",
        careModel: "GRUPO DE CRIANÇAS",
        observations: "",
      },
      [],
    );
    expect(parsed.noWhatsapp).toBe(true);
    expect(parsed.phoneNote).toContain("Telefone");
    expect(parsed.status).toBe("waiting_triage");
  });
});

describe("importFromTable", () => {
  it("importa a planilha e cria modelos de grupo desconhecidos", () => {
    const state = emptyState();
    const result = importFromTable(state, `${HEADER}\n${ROW}\n${ROW_NO_PHONE}`);
    expect(result.summary.added).toBe(2);
    expect(result.summary.updated).toBe(0);
    expect(result.summary.skipped).toBe(0);
    expect(result.state.patients.map((item) => item.name)).toEqual([
      "Paciente Exemplo Alfa",
      "Paciente Exemplo Beta",
    ]);

    const unknown = importFromTable(
      state,
      `${HEADER}\n"ANA","1","30","11999999999","01/01/2026","","","01/01/2026","GRUPO NOVO",""`,
    );
    expect(unknown.summary.createdModels).toContain("Grupo Novo");
    expect(unknown.state.patients[0].careModelId).toBe("cm-import-grupo-novo");
  });

  it("atualiza duplicata pela matrícula em vez de criar outro cadastro", () => {
    const state = emptyState();
    const first = importFromTable(state, `${HEADER}\n${ROW}`);
    const second = importFromTable(first.state, `${HEADER}\n${ROW.replace("PACIENTE EXEMPLO ALFA", "PACIENTE EXEMPLO A.")}`);
    expect(second.summary.added).toBe(0);
    expect(second.summary.updated).toBe(1);
    expect(second.state.patients).toHaveLength(1);
    expect(second.state.patients[0].name).toBe("Paciente Exemplo A.");
  });

  it("limpa a marca de demonstração ao importar dados", () => {
    const state = emptyState();
    state.meta.seedSource = "demonstracao";
    const result = importFromTable(state, `${HEADER}\n${ROW}`);
    expect(result.state.meta.seedSource).toBeUndefined();
  });
});

describe("mergePatients", () => {
  it("preserva anotações e contatos do cadastro existente", () => {
    const state = testState();
    const existing = patient({
      id: "pac-1",
      name: "Pessoa Existente",
      registrationNumber: "123",
      notes: [{ id: "n1", at: "2026-01-01", text: "Anotação" }],
      contactAttempts: [{ id: "c1", at: "2026-01-01", channel: "whatsapp", outcome: "sent" }],
    });
    state.patients = [existing];
    const incoming = {
      ...patient({ id: "pac-2", name: "Pessoa Existente", registrationNumber: "123" }),
      observations: "Atualizada",
    };
    const result = mergePatients(state, [incoming]);
    expect(result.summary.updated).toBe(1);
    expect(result.state.patients[0].id).toBe("pac-1");
    expect(result.state.patients[0].notes).toHaveLength(1);
    expect(result.state.patients[0].contactAttempts).toHaveLength(1);
    expect(result.state.patients[0].observations).toBe("Atualizada");
  });
});

describe("importFromJson", () => {
  it("substitui pacientes no modo replace e mantém o restante da base", () => {
    const state = testState();
    state.patients = [patient({ id: "antigo", name: "Paciente Antigo" })];
    const payload = JSON.stringify({
      patients: [patient({ id: "novo", name: "Paciente Novo" })],
    });
    const result = importFromJson(state, payload, "replace");
    expect(result.state.patients.map((item) => item.name)).toEqual(["Paciente Novo"]);
    expect(result.summary.added).toBe(1);
  });

  it("rejeita JSON sem lista de pacientes", () => {
    expect(() => importFromJson(testState(), "{}", "merge")).toThrow(/lista de pacientes/);
  });
});

describe("exportPatientsCsv", () => {
  it("exporta cabeçalho e escapa aspas", () => {
    const state = testState();
    state.patients = [patient({ id: "p1", name: 'Pessoa "Teste"', registrationNumber: "1" })];
    const csv = exportPatientsCsv(state);
    expect(csv.split("\r\n")[0]).toContain('"Nome";"Cadastro";"Idade"');
    expect(csv).toContain('"Pessoa ""Teste"""');
  });
});
