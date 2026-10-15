import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/training-role.ts", import.meta.url), "utf8");
const dictionary = JSON.parse(readFileSync(new URL("../src/config/training-role-tokens.json", import.meta.url), "utf8"));
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
}).outputText;
const module = { exports: {} };
new Function("require", "module", "exports", compiled)(
  (name) => {
    if (name === "@/config/training-role-tokens.json") return dictionary;
    throw new Error(`Unexpected import: ${name}`);
  },
  module,
  module.exports
);
const { classifyTrainingRole } = module.exports;

const cases = {
  HEAD: [
    "Руководитель",
    "Руководитель, Менеджер",
    "Руководитель, Менеджер, Менеджер (с ограничением в CRM)",
    "Руководитель, Менеджер (с ограничением в CRM)",
    "Руководитель, Отдел обучения KZ",
    "Руководитель, Тренировочный руководитель",
    "Руководитель, Тренировочный менеджер",
    "Тренировочный руководитель",
    "Тренировочный руководитель KZ"
  ],
  MANAGER: [
    "Менеджер",
    "Менеджер (с ограничением в CRM)",
    "Менеджер, Менеджер (с ограничением в CRM)",
    "Менеджер, Тренировочный менеджер",
    "Менеджер, Менеджер (с ограничением в CRM), Тренировочный менеджер, Profi",
    "Тренировочный менеджер",
    "Тренировочный менеджер, Profi",
    "Маркетолог, Менеджер, Контент менеджер",
    "Контент менеджер, Менеджер (с ограничением в CRM)"
  ],
  EMPLOYEE: [
    "Сотрудник отдела контроля, Руководитель, Менеджер",
    "Руководитель, Сотрудник отдела контроля и развития KZ, Отдел обучения KZ",
    "Руководитель, Сотрудник отдела контроля и развития KZ, Сотрудник отдела бронирования KZ, Отдел обучения KZ",
    "Руководитель, Сотрудник отдела контроля и развития KZ, Менеджер",
    "Сотрудник отдела контроля и развития KZ, Менеджер, Отдел обучения KZ, HR KZ",
    "Сотрудник отдела контроля и развития KZ, Менеджер, Сотрудник отдела бронирования KZ, Отдел обучения KZ",
    "Сотрудник отдела контроля и развития KZ",
    "Сотрудник отдела контроля и развития KZ, Бухгалтер KZ",
    "Сотрудник отдела контроля и развития KZ, Сотрудник отдела бронирования KZ",
    "Сотрудник отдела контроля и развития KZ, Отдел обучения KZ",
    "Сотрудник отдела контроля и развития KZ, Отдел обучения KZ, Администратор офиса ЦО KZ, HR KZ",
    "Сотрудник отдела контроля",
    "Сотрудник отдела контроля, Отдел развития",
    "Сотрудник отдела контроля, Контент менеджер",
    "Сотрудник отдела контроля, Контент менеджер, Отдел развития",
    "Гендиректор, Директор KZ",
    "Директор KZ",
    "Гендиректор, Отдел обучения",
    "Гендиректор, Сотрудник отдела контроля, Сотрудник отдела бронирования, Отдел обучения KZ",
    "Сотрудник отдела бронирования KZ",
    "Бухгалтер KZ",
    "Бухгалтер KZ, Сотрудник отдела бронирования KZ",
    "HR KZ",
    "Маркетолог",
    "Сотрудник Колл Центра"
  ],
  PARTNER: ["Intro", "Profi", "Фрилансер"],
  MANUAL_REVIEW: ["Администратор"]
};

for (const [expected, inputs] of Object.entries(cases)) {
  for (const input of inputs) {
    test(`${input} -> ${expected}`, () => {
      assert.equal(classifyTrainingRole([input]).role, expected);
    });
  }
}

test("unknown and empty types require review; token matching is exact", () => {
  assert.equal(classifyTrainingRole([]).role, "MANUAL_REVIEW");
  assert.deepEqual(classifyTrainingRole(["Контент менеджерский"]), {
    role: "MANUAL_REVIEW",
    unknownTokens: ["Контент менеджерский"]
  });
});

test("normalization and priority are stable across separate CRM rows", () => {
  assert.equal(classifyTrainingRole(["  РУКОВОДИТЕЛЬ  ", "Сотрудник   отдела контроля и развития KZ"]).role, "EMPLOYEE");
});

test("known tokens are not logged as unknown", () => {
  assert.deepEqual(classifyTrainingRole(["Руководитель", "Менеджер"]).unknownTokens, []);
});
